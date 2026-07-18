import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildAmyAnamCapabilityReadiness } from '../lib/anam/capability-readiness.ts';
import { isAmyAnamHermesWorkerAuthorized } from '../lib/anam/hermes-worker-bridge.ts';

const WORKER_SECRET = 'w'.repeat(48);

const BASE_ENV = {
    VERCEL_ENV: 'preview',
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 's'.repeat(32),
    AMY_ANAM_REDIS_REST_URL: 'https://example.upstash.io',
    AMY_ANAM_REDIS_REST_TOKEN: 'redis-secret-value',
    AMY_ANAM_RECOVERY_ENABLED: 'true',
    AMY_ANAM_RECOVERY_KILL_SWITCH: 'false',
    AMY_ANAM_RECOVERY_SECRET: 'r'.repeat(32),
    AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
    AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
    AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
    AMY_EMAIL_PROVIDER: 'off',
};

test('Amy readiness exposes the shadow spine without exposing secret values', () => {
    const readiness = buildAmyAnamCapabilityReadiness(BASE_ENV);

    assert.equal(readiness.environment, 'preview');
    assert.equal(readiness.sessionSpine.gatesOpen, true);
    assert.equal(readiness.recovery.authenticationConfigured, true);
    assert.equal(readiness.recovery.gatesOpen, true);
    assert.equal(readiness.hermesShadow.gatesOpen, true);
    assert.equal(readiness.hermesShadow.pointerOnlyQueue, true);
    assert.equal(readiness.hermesShadow.cloudContentAllowed, false);
    assert.equal(readiness.contentIncluded, false);
    assert.equal(readiness.outboundActionTaken, false);

    const serialized = JSON.stringify(readiness);
    assert.equal(serialized.includes('redis-secret-value'), false);
    assert.equal(serialized.includes('https://example.upstash.io'), false);
    assert.equal(serialized.includes('ssssssss'), false);
    assert.equal(serialized.includes('rrrrrrrr'), false);
});

test('recovery readiness reflects its fail-closed gate and production approval', () => {
    const killed = buildAmyAnamCapabilityReadiness({
        ...BASE_ENV,
        AMY_ANAM_RECOVERY_KILL_SWITCH: 'true',
    });
    assert.equal(killed.recovery.authenticationConfigured, true);
    assert.equal(killed.recovery.gatesOpen, false);

    const production = buildAmyAnamCapabilityReadiness({
        ...BASE_ENV,
        VERCEL_ENV: 'production',
    });
    assert.equal(production.recovery.productionApprovalRequired, true);
    assert.equal(production.recovery.productionPromotionApproved, false);
    assert.equal(production.recovery.gatesOpen, false);

    const approved = buildAmyAnamCapabilityReadiness({
        ...BASE_ENV,
        VERCEL_ENV: 'production',
        AMY_ANAM_PRODUCTION_PROMOTION_APPROVED: 'true',
    });
    assert.equal(approved.recovery.gatesOpen, true);
    assert.equal(approved.productionPromotionApproved, true);
});

test('memory opens while AgentMail stays fail-closed without provider configuration', () => {
    const readiness = buildAmyAnamCapabilityReadiness({
        ...BASE_ENV,
        AMY_ANAM_MEMORY_ENABLED: 'true',
        AMY_ANAM_MEMORY_KILL_SWITCH: 'false',
        AMY_ANAM_MEMORY_ACCESS_CODE: 'fixture-access-code',
        AMY_ANAM_MEMORY_IDENTITY_SALT: 'm'.repeat(48),
        AMY_ANAM_MEMORY_PROMOTION_ENABLED: 'true',
        AMY_ANAM_MEMORY_PROMOTION_KILL_SWITCH: 'false',
        AMY_ANAM_MEMORY_OPERATOR_SECRET: 'o'.repeat(48),
        AMY_ANAM_TOOLS_ENABLED: 'true',
        AMY_ANAM_TOOLS_KILL_SWITCH: 'false',
        AMY_ANAM_AGENTMAIL_ENABLED: 'true',
        AMY_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
        AMY_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true',
        AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
    });

    assert.equal(readiness.memory.requestedGateOpen, true);
    assert.equal(readiness.memory.implemented, true);
    assert.equal(readiness.memory.effectiveGateOpen, true);
    assert.equal(readiness.memory.consentBound, true);
    assert.equal(readiness.memory.operatorApprovalRequired, true);
    assert.equal(readiness.memory.promotionGateOpen, true);
    assert.equal(readiness.memory.rawEmailStored, false);

    for (const capability of [
        readiness.tools,
        readiness.agentMail,
        readiness.globalOutbound,
    ]) {
        assert.equal(capability.requestedGateOpen, true);
        assert.equal(capability.implemented, true);
        assert.equal(capability.effectiveGateOpen, false);
    }
    assert.equal(readiness.tools.invocationsPerformed, 0);
    assert.equal(readiness.agentMail.emailsSent, 0);
    assert.equal(readiness.globalOutbound.actionsPerformed, 0);
    assert.equal(readiness.productionPromotionApproved, false);
});

test('AgentMail, its tool, and global outbound open together only when fully configured', () => {
    const readiness = buildAmyAnamCapabilityReadiness({
        ...BASE_ENV,
        AMY_EMAIL_PROVIDER: 'agentmail',
        AMY_AGENTMAIL_ADDRESS: 'amy-insight@agentmail.to',
        AGENTMAIL_API_KEY: 'am_fixture_agentmail_secret',
        AMY_ANAM_TOOLS_ENABLED: 'true',
        AMY_ANAM_TOOLS_KILL_SWITCH: 'false',
        AMY_ANAM_AGENTMAIL_ENABLED: 'true',
        AMY_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
        AMY_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true',
        AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
    });

    assert.equal(readiness.tools.implemented, true);
    assert.equal(readiness.tools.effectiveGateOpen, true);
    assert.deepEqual(readiness.tools.availableToolNames, ['send_follow_up_email']);
    assert.equal(readiness.agentMail.implemented, true);
    assert.equal(readiness.agentMail.provider, 'agentmail');
    assert.equal(readiness.agentMail.configured, true);
    assert.equal(readiness.agentMail.effectiveGateOpen, true);
    assert.equal(readiness.agentMail.inboxAddressConfigured, true);
    assert.equal(readiness.agentMail.apiKeyConfigured, true);
    assert.equal(readiness.globalOutbound.implemented, true);
    assert.equal(readiness.globalOutbound.effectiveGateOpen, true);

    const killed = buildAmyAnamCapabilityReadiness({
        ...BASE_ENV,
        AMY_EMAIL_PROVIDER: 'agentmail',
        AMY_AGENTMAIL_ADDRESS: 'amy-insight@agentmail.to',
        AGENTMAIL_API_KEY: 'am_fixture_agentmail_secret',
        AMY_ANAM_AGENTMAIL_ENABLED: 'true',
        AMY_ANAM_AGENTMAIL_KILL_SWITCH: 'true',
    });
    assert.equal(killed.agentMail.effectiveGateOpen, false);
});

test('all future capability requests fail closed when variables are absent', () => {
    const readiness = buildAmyAnamCapabilityReadiness({});

    assert.equal(readiness.sessionSpine.gatesOpen, false);
    assert.equal(readiness.recovery.authenticationConfigured, false);
    assert.equal(readiness.hermesShadow.gatesOpen, false);
    assert.equal(readiness.memory.killSwitchActive, true);
    assert.equal(readiness.tools.killSwitchActive, true);
    assert.equal(readiness.agentMail.killSwitchActive, true);
    assert.equal(readiness.globalOutbound.killSwitchActive, true);
    assert.equal(readiness.agentMail.providerForcedOff, true);
});

test('the readiness route reuses constant-time worker bearer authentication', async () => {
    const env = { AMY_ANAM_HERMES_WORKER_SECRET: WORKER_SECRET };
    const authorized = new Request('https://preview.example.test/api/anam/amy/readiness', {
        headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    });
    const denied = new Request('https://preview.example.test/api/anam/amy/readiness', {
        headers: { Authorization: `Bearer ${'x'.repeat(WORKER_SECRET.length)}` },
    });
    assert.equal(isAmyAnamHermesWorkerAuthorized(authorized, env), true);
    assert.equal(isAmyAnamHermesWorkerAuthorized(denied, env), false);

    const route = await readFile(
        new URL('../app/api/anam/amy/readiness/route.ts', import.meta.url),
        'utf8',
    );
    assert.match(route, /export async function GET\(request: Request\)/);
    assert.match(route, /readAmyAnamHermesWorkerBridgeConfig\(\)/);
    assert.match(route, /isAmyAnamHermesWorkerAuthorized\(request\)/);
    assert.match(route, /Cache-Control', 'no-store'/);
    assert.doesNotMatch(route, /console\.(?:log|info|warn|error)/);
});
