import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
    verifyDaniEmailRecoveryCronContract,
    verifyProductionDeployContract,
} from '../scripts/ops/verify-deploy-contract.mjs';

function fingerprint(values) {
    return createHash('sha256').update(values.join('\0'), 'utf8').digest('hex');
}

const amyRedisUrl = 'https://amy-redis.invalid';
const amyRedisToken = `amy-redis-${'r'.repeat(32)}`;
const amyIdentitySalt = `amy-salt-${'i'.repeat(32)}`;
const daniRedisUrl = 'https://dani-redis.invalid';
const daniRedisToken = `dani-redis-${'t'.repeat(32)}`;
const daniIdentitySalt = `dani-salt-${'s'.repeat(32)}`;
const daniEncryptionKey = Buffer.from('e'.repeat(32), 'utf8').toString('base64');
const daniVerificationSecret = `dani-verification-${'v'.repeat(32)}`;

const productionFixture = {
    VERCEL_ENV: 'production',
    VERCEL_GIT_COMMIT_REF: 'main',
    ANAM_API_KEY: `anam-api-${'a'.repeat(32)}`,
    ANAM_AMY_CARA4_PERSONA_ID: '0fb9f31e-2f04-4d82-bf3a-cc40f4e51ac0',
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: `amy-session-${'m'.repeat(32)}`,
    AMY_ANAM_MEMORY_ENABLED: 'true',
    AMY_ANAM_MEMORY_KILL_SWITCH: 'false',
    AMY_ANAM_MEMORY_PROMOTION_ENABLED: 'true',
    AMY_ANAM_MEMORY_PROMOTION_KILL_SWITCH: 'false',
    AMY_ANAM_MEMORY_ACCESS_CODE: 'amy-access-code',
    AMY_ANAM_MEMORY_OPERATOR_SECRET: `amy-operator-${'o'.repeat(32)}`,
    AMY_ANAM_REDIS_REST_URL: amyRedisUrl,
    AMY_ANAM_REDIS_REST_TOKEN: amyRedisToken,
    AMY_ANAM_MEMORY_IDENTITY_SALT: amyIdentitySalt,
    AMY_ANAM_MEMORY_CONFIG_FINGERPRINT: fingerprint([
        amyRedisUrl,
        amyRedisToken,
        amyIdentitySalt,
    ]),
    AMY_EMAIL_PROVIDER: 'agentmail',
    AMY_AGENTMAIL_ADDRESS: 'amy-insight@agentmail.to',
    AGENTMAIL_API_KEY: `agentmail-${'g'.repeat(32)}`,
    AMY_ANAM_AGENTMAIL_ENABLED: 'true',
    AMY_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
    AMY_ANAM_TOOLS_ENABLED: 'true',
    AMY_ANAM_TOOLS_KILL_SWITCH: 'false',
    AMY_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true',
    AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
    DANI_ANAM_SESSION_SECRET: `dani-session-${'d'.repeat(32)}`,
    DANI_ANAM_CONTACT_SECRET: `dani-contact-${'c'.repeat(32)}`,
    DANI_ANAM_MEMORY_ENABLED: 'false',
    DANI_ANAM_MEMORY_KILL_SWITCH: 'true',
    DANI_ANAM_MEMORY_PROMOTION_ENABLED: 'false',
    DANI_ANAM_MEMORY_PROMOTION_KILL_SWITCH: 'true',
    DANI_EMAIL_PROVIDER: 'agentmail',
    DANI_AGENTMAIL_ADDRESS: 'hermes-hal@agentmail.to',
    DANI_ADMIN_EMAIL: 'aifusionlabs@gmail.com',
    DANI_CALL_SUMMARY_EMAIL: 'aifusionlabs@gmail.com',
    DANI_ANAM_AGENTMAIL_ENABLED: 'true',
    DANI_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
    DANI_ANAM_TOOLS_ENABLED: 'true',
    DANI_ANAM_TOOLS_KILL_SWITCH: 'false',
    DANI_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true',
    DANI_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
    DANI_ANAM_EMAIL_RECOVERY_ENABLED: 'true',
    DANI_ANAM_EMAIL_RECOVERY_KILL_SWITCH: 'false',
    DANI_ANAM_EMAIL_RECOVERY_PRODUCTION_APPROVED: 'true',
    CRON_SECRET: `cron-${'q'.repeat(32)}`,
};

function runContract(overrides = {}) {
    const result = verifyProductionDeployContract({
        ...productionFixture,
        ...overrides,
    });
    return {
        status: result.failures.length > 0 ? 1 : 0,
        output: result.failures.join('\n') || 'Production configuration verified',
    };
}

test('production accepts Dani session isolation with memory explicitly fail-closed', () => {
    const result = runContract();
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Production configuration verified/);
});

test('production requires Dani email recovery gates and a strong, distinct cron secret', () => {
    const closed = runContract({ DANI_ANAM_EMAIL_RECOVERY_KILL_SWITCH: 'true' });
    assert.equal(closed.status, 1);
    assert.match(closed.output, /DANI_ANAM_EMAIL_RECOVERY_KILL_SWITCH must equal "false"/);

    const missingSecret = runContract({ CRON_SECRET: '' });
    assert.equal(missingSecret.status, 1);
    assert.match(missingSecret.output, /CRON_SECRET must be configured/);

    const reusedSecret = runContract({ CRON_SECRET: productionFixture.DANI_ANAM_CONTACT_SECRET });
    assert.equal(reusedSecret.status, 1);
    assert.match(reusedSecret.output, /must use distinct values/);
});

test('Dani email recovery cron slots remain twelve hours apart', () => {
    assert.deepEqual(verifyDaniEmailRecoveryCronContract(), { failures: [] });
});

test('production requires separate Dani session and contact secrets', () => {
    const missing = runContract({ DANI_ANAM_CONTACT_SECRET: '' });
    assert.equal(missing.status, 1);
    assert.match(missing.output, /DANI_ANAM_CONTACT_SECRET must be configured/);

    const reused = runContract({
        DANI_ANAM_CONTACT_SECRET: productionFixture.DANI_ANAM_SESSION_SECRET,
    });
    assert.equal(reused.status, 1);
    assert.match(reused.output, /must use distinct values/);
});

test('production accepts an open Dani memory configuration only with its exact fingerprint', () => {
    const openMemory = {
        DANI_ANAM_MEMORY_ENABLED: 'true',
        DANI_ANAM_MEMORY_KILL_SWITCH: 'false',
        DANI_ANAM_REDIS_REST_URL: daniRedisUrl,
        DANI_ANAM_REDIS_REST_TOKEN: daniRedisToken,
        DANI_ANAM_MEMORY_IDENTITY_SALT: daniIdentitySalt,
        DANI_ANAM_MEMORY_ENCRYPTION_KEY: daniEncryptionKey,
        DANI_ANAM_MEMORY_VERIFICATION_SECRET: daniVerificationSecret,
        DANI_ANAM_MEMORY_CONFIG_FINGERPRINT: fingerprint([
            daniRedisUrl,
            daniRedisToken,
            daniIdentitySalt,
            daniEncryptionKey,
            daniVerificationSecret,
        ]),
    };
    const accepted = runContract(openMemory);
    assert.equal(accepted.status, 0, accepted.output);

    const mismatch = runContract({
        ...openMemory,
        DANI_ANAM_MEMORY_CONFIG_FINGERPRINT: '0'.repeat(64),
    });
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.output, /Dani memory configuration fingerprint does not match/);
});

test('production keeps Dani promotion closed independently of recall', () => {
    const result = runContract({
        DANI_ANAM_MEMORY_PROMOTION_ENABLED: 'true',
        DANI_ANAM_MEMORY_PROMOTION_KILL_SWITCH: 'false',
        DANI_ANAM_MEMORY_OPERATOR_SECRET: `dani-operator-${'p'.repeat(32)}`,
    });
    assert.equal(result.status, 1);
    assert.match(result.output, /memory must be enabled and open before promotion may be enabled/i);
});
