import { createHash } from 'node:crypto';

const env = process.env;
const production = env.VERCEL_ENV === 'production';

if (!production) {
    console.log('[deploy-contract] Non-production build; production contract skipped.');
    process.exit(0);
}

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

const branch = requireValue('VERCEL_GIT_COMMIT_REF');
if (branch !== 'main') {
    failures.push('Production deployments are allowed only from the main branch.');
}

requireValue('ANAM_API_KEY', 16);
requireValue('ANAM_AMY_CARA4_PERSONA_ID', 16);

requireExact('AMY_ANAM_SESSION_SPINE_ENABLED', 'true');
requireExact('AMY_ANAM_SESSION_SPINE_KILL_SWITCH', 'false');
requireValue('AMY_ANAM_SESSION_SECRET', 32);

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

if (failures.length > 0) {
    console.error('[deploy-contract] Production deployment blocked:');
    for (const failure of failures) {
        console.error(` - ${failure}`);
    }
    console.error(
        '[deploy-contract] Restore and verify the production memory triple, calculate its fingerprint, and follow docs/operations/PRODUCTION_RUNBOOK.md.',
    );
    process.exit(1);
}

console.log('[deploy-contract] Production configuration verified.');
