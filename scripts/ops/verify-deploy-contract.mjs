import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_DANI_EMAIL_RECOVERY_CRONS = [
    { path: '/api/anam/session/recover?slot=a', schedule: '0 10 * * *' },
    { path: '/api/anam/session/recover?slot=b', schedule: '0 22 * * *' },
];

export function verifyDaniEmailRecoveryCronContract(configPath = fileURLToPath(
    new URL('../../vercel.json', import.meta.url),
)) {
    try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        const crons = Array.isArray(config?.crons) ? config.crons : [];
        const failures = EXPECTED_DANI_EMAIL_RECOVERY_CRONS.flatMap(expected => (
            crons.some(cron => cron?.path === expected.path && cron?.schedule === expected.schedule)
                ? []
                : [`vercel.json must schedule ${expected.path} at ${expected.schedule}.`]
        ));
        return { failures };
    } catch {
        return { failures: ['vercel.json could not be read for the Dani email recovery cron contract.'] };
    }
}

export function verifyProductionDeployContract(env = process.env) {
const production = env.VERCEL_ENV === 'production';
if (!production) return { production: false, failures: [] };

const failures = [];
const value = (name) => String(env[name] ?? '').trim();

function requireValue(name, minimumLength = 1) {
    const current = value(name);
    if (current.length < minimumLength) {
        failures.push(`${name} must be configured (minimum ${minimumLength} characters).`);
    }
    if (/example\.com|replace[-_ ]?me|changeme|placeholder/i.test(current)) {
        failures.push(`${name} still contains a placeholder value.`);
    }
    return current;
}

function requireExact(name, expected) {
    const current = value(name);
    if (current !== expected) {
        failures.push(`${name} must equal ${JSON.stringify(expected)}.`);
    }
    return current;
}

function requireBoolean(name) {
    const current = value(name);
    if (current !== 'true' && current !== 'false') {
        failures.push(`${name} must be explicitly set to "true" or "false".`);
    }
    return current === 'true';
}

function requireDistinct(names) {
    const configured = names
        .map(name => ({ name, current: value(name) }))
        .filter(item => item.current);
    for (let left = 0; left < configured.length; left += 1) {
        for (let right = left + 1; right < configured.length; right += 1) {
            if (configured[left].current === configured[right].current) {
                failures.push(`${configured[left].name} and ${configured[right].name} must use distinct values.`);
            }
        }
    }
}

function requireEmail(name) {
    const current = requireValue(name, 3);
    if (current && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current)) {
        failures.push(`${name} must be a valid email address.`);
    }
    return current;
}

function isDaniMemoryEncryptionKey(current) {
    if (/^[a-f0-9]{64}$/i.test(current)) return true;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(current)) return false;
    try {
        return Buffer.from(current, 'base64').length === 32;
    } catch {
        return false;
    }
}

const branch = requireValue('VERCEL_GIT_COMMIT_REF');
if (branch !== 'main') {
    failures.push('Production deployments are allowed only from the main branch.');
}

requireValue('ANAM_API_KEY', 16);
requireValue('ANAM_AMY_CARA4_PERSONA_ID', 16);

requireExact('AMY_ANAM_SESSION_SPINE_ENABLED', 'true');
requireExact('AMY_ANAM_SESSION_SPINE_KILL_SWITCH', 'false');
requireValue('AMY_ANAM_SESSION_SECRET', 32);

requireValue('DANI_ANAM_SESSION_SECRET', 32);
requireValue('DANI_ANAM_CONTACT_SECRET', 32);
requireDistinct([
    'ANAM_API_KEY',
    'AMY_ANAM_SESSION_SECRET',
    'DANI_ANAM_SESSION_SECRET',
    'DANI_ANAM_CONTACT_SECRET',
]);

requireExact('AMY_ANAM_MEMORY_ENABLED', 'true');
requireExact('AMY_ANAM_MEMORY_KILL_SWITCH', 'false');
requireExact('AMY_ANAM_MEMORY_PROMOTION_ENABLED', 'true');
requireExact('AMY_ANAM_MEMORY_PROMOTION_KILL_SWITCH', 'false');
requireValue('AMY_ANAM_MEMORY_ACCESS_CODE', 8);
requireValue('AMY_ANAM_MEMORY_OPERATOR_SECRET', 32);

const redisUrl = requireValue('AMY_ANAM_REDIS_REST_URL', 12).replace(/\/$/, '');
const redisToken = requireValue('AMY_ANAM_REDIS_REST_TOKEN', 24);
const identitySalt = requireValue('AMY_ANAM_MEMORY_IDENTITY_SALT', 32);

if (redisUrl && !redisUrl.startsWith('https://')) {
    failures.push('AMY_ANAM_REDIS_REST_URL must use HTTPS.');
}

const expectedFingerprint = createHash('sha256')
    .update([redisUrl, redisToken, identitySalt].join('\0'), 'utf8')
    .digest('hex');
const configuredFingerprint = requireValue('AMY_ANAM_MEMORY_CONFIG_FINGERPRINT', 64);

if (
    configuredFingerprint
    && !/^[a-f0-9]{64}$/i.test(configuredFingerprint)
) {
    failures.push('AMY_ANAM_MEMORY_CONFIG_FINGERPRINT must be a SHA-256 hex digest.');
}

if (
    configuredFingerprint
    && /^[a-f0-9]{64}$/i.test(configuredFingerprint)
    && configuredFingerprint.toLowerCase() !== expectedFingerprint
) {
    failures.push(
        'Amy memory configuration fingerprint does not match the Redis URL/token/identity-salt combination.',
    );
}

const daniMemoryEnabled = requireBoolean('DANI_ANAM_MEMORY_ENABLED');
const daniMemoryKillSwitchActive = requireBoolean('DANI_ANAM_MEMORY_KILL_SWITCH');
const daniPromotionEnabled = requireBoolean('DANI_ANAM_MEMORY_PROMOTION_ENABLED');
requireBoolean('DANI_ANAM_MEMORY_PROMOTION_KILL_SWITCH');

if (!daniMemoryEnabled) {
    requireExact('DANI_ANAM_MEMORY_KILL_SWITCH', 'true');
} else {
    requireExact('DANI_ANAM_MEMORY_KILL_SWITCH', 'false');

    const daniRedisUrl = requireValue('DANI_ANAM_REDIS_REST_URL', 12).replace(/\/+$/, '');
    const daniRedisToken = requireValue('DANI_ANAM_REDIS_REST_TOKEN', 24);
    const daniIdentitySalt = requireValue('DANI_ANAM_MEMORY_IDENTITY_SALT', 32);
    const daniEncryptionKey = requireValue('DANI_ANAM_MEMORY_ENCRYPTION_KEY', 43);
    const daniVerificationSecret = requireValue('DANI_ANAM_MEMORY_VERIFICATION_SECRET', 32);

    if (daniRedisUrl && !daniRedisUrl.startsWith('https://')) {
        failures.push('DANI_ANAM_REDIS_REST_URL must use HTTPS.');
    }
    if (daniEncryptionKey && !isDaniMemoryEncryptionKey(daniEncryptionKey)) {
        failures.push('DANI_ANAM_MEMORY_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    }

    requireDistinct([
        'AMY_ANAM_SESSION_SECRET',
        'DANI_ANAM_SESSION_SECRET',
        'DANI_ANAM_CONTACT_SECRET',
        'DANI_ANAM_REDIS_REST_TOKEN',
        'DANI_ANAM_MEMORY_IDENTITY_SALT',
        'DANI_ANAM_MEMORY_ENCRYPTION_KEY',
        'DANI_ANAM_MEMORY_VERIFICATION_SECRET',
    ]);

    const expectedDaniFingerprint = createHash('sha256')
        .update([
            daniRedisUrl,
            daniRedisToken,
            daniIdentitySalt,
            daniEncryptionKey,
            daniVerificationSecret,
        ].join('\0'), 'utf8')
        .digest('hex');
    const configuredDaniFingerprint = requireValue('DANI_ANAM_MEMORY_CONFIG_FINGERPRINT', 64);

    if (
        configuredDaniFingerprint
        && !/^[a-f0-9]{64}$/i.test(configuredDaniFingerprint)
    ) {
        failures.push('DANI_ANAM_MEMORY_CONFIG_FINGERPRINT must be a SHA-256 hex digest.');
    }
    if (
        configuredDaniFingerprint
        && /^[a-f0-9]{64}$/i.test(configuredDaniFingerprint)
        && configuredDaniFingerprint.toLowerCase() !== expectedDaniFingerprint
    ) {
        failures.push(
            'Dani memory configuration fingerprint does not match the Redis URL/token/identity-salt/encryption-key/verification-secret combination.',
        );
    }
}

if (!daniPromotionEnabled) {
    requireExact('DANI_ANAM_MEMORY_PROMOTION_KILL_SWITCH', 'true');
} else {
    if (!daniMemoryEnabled || daniMemoryKillSwitchActive) {
        failures.push('Dani memory must be enabled and open before promotion may be enabled.');
    }
    requireExact('DANI_ANAM_MEMORY_PROMOTION_KILL_SWITCH', 'false');
    requireValue('DANI_ANAM_MEMORY_OPERATOR_SECRET', 32);
    requireDistinct([
        'DANI_ANAM_SESSION_SECRET',
        'DANI_ANAM_CONTACT_SECRET',
        'DANI_ANAM_MEMORY_VERIFICATION_SECRET',
        'DANI_ANAM_MEMORY_OPERATOR_SECRET',
    ]);
}

const emailProvider = value('AMY_EMAIL_PROVIDER');
if (emailProvider === 'agentmail') {
    requireExact('AMY_AGENTMAIL_ADDRESS', 'amy-insight@agentmail.to');
    requireValue('AGENTMAIL_API_KEY', 16);
    requireExact('AMY_ANAM_AGENTMAIL_ENABLED', 'true');
    requireExact('AMY_ANAM_AGENTMAIL_KILL_SWITCH', 'false');
    requireExact('AMY_ANAM_TOOLS_ENABLED', 'true');
    requireExact('AMY_ANAM_TOOLS_KILL_SWITCH', 'false');
    requireExact('AMY_ANAM_OUTBOUND_ACTIONS_ENABLED', 'true');
    requireExact('AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH', 'false');
}

const daniEmailProvider = requireExact('DANI_EMAIL_PROVIDER', 'agentmail');
if (daniEmailProvider === 'agentmail') {
    requireEmail('DANI_AGENTMAIL_ADDRESS');
    requireEmail('DANI_ADMIN_EMAIL');
    requireEmail('DANI_CALL_SUMMARY_EMAIL');
    requireValue('AGENTMAIL_API_KEY', 16);
    requireExact('DANI_ANAM_AGENTMAIL_ENABLED', 'true');
    requireExact('DANI_ANAM_AGENTMAIL_KILL_SWITCH', 'false');
    requireExact('DANI_ANAM_TOOLS_ENABLED', 'true');
    requireExact('DANI_ANAM_TOOLS_KILL_SWITCH', 'false');
    requireExact('DANI_ANAM_OUTBOUND_ACTIONS_ENABLED', 'true');
    requireExact('DANI_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH', 'false');
    requireExact('DANI_ANAM_EMAIL_RECOVERY_ENABLED', 'true');
    requireExact('DANI_ANAM_EMAIL_RECOVERY_KILL_SWITCH', 'false');
    requireExact('DANI_ANAM_EMAIL_RECOVERY_PRODUCTION_APPROVED', 'true');
    requireValue('CRON_SECRET', 32);
    requireDistinct([
        'AMY_ANAM_SESSION_SECRET',
        'DANI_ANAM_SESSION_SECRET',
        'DANI_ANAM_CONTACT_SECRET',
        'CRON_SECRET',
    ]);
}

return { production: true, failures };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    const result = verifyProductionDeployContract();
    if (result.production) {
        result.failures.push(...verifyDaniEmailRecoveryCronContract().failures);
    }
    if (!result.production) {
        console.log('[deploy-contract] Non-production build; production contract skipped.');
    } else if (result.failures.length > 0) {
        console.error('[deploy-contract] Production deployment blocked:');
        for (const failure of result.failures) {
            console.error(` - ${failure}`);
        }
        console.error(
            '[deploy-contract] Restore and verify the production memory configuration, calculate its fingerprint, and follow docs/operations/PRODUCTION_RUNBOOK.md.',
        );
        process.exitCode = 1;
    } else {
        console.log('[deploy-contract] Production configuration verified.');
    }
}
