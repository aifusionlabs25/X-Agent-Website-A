import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    AMY_ANAM_RECOVERY_BATCH_SIZE,
    AMY_ANAM_RECOVERY_CONCURRENCY,
    drainDueAmyAnamFinalizations,
    isAmyAnamRecoveryRequestAuthorized,
    readAmyAnamRecoveryConfig,
} from '../lib/anam/session-recovery.ts';

const SESSION_ONE = '11111111-1111-4111-8111-111111111111';
const SESSION_TWO = '22222222-2222-4222-8222-222222222222';
const SESSION_THREE = '33333333-3333-4333-8333-333333333333';
const SESSION_FOUR = '44444444-4444-4444-8444-444444444444';
const OPEN_RECOVERY_ENV = {
    VERCEL_ENV: 'preview',
    AMY_ANAM_RECOVERY_ENABLED: 'true',
    AMY_ANAM_RECOVERY_KILL_SWITCH: 'false',
    AMY_ANAM_RECOVERY_SECRET: 'r'.repeat(32),
};

function recoveryDependencies(overrides = {}) {
    return {
        acquireDrainLock: async () => true,
        releaseDrainLock: async () => undefined,
        listDue: async () => [],
        removeDue: async () => undefined,
        finalize: async () => 'pending',
        now: () => 1_900_000_000_000,
        createLockToken: () => 'recovery-lock-token',
        ...overrides,
    };
}

test('recovery authentication accepts either a dedicated or Vercel cron bearer secret', () => {
    const dedicated = 'd'.repeat(32);
    const cron = 'c'.repeat(32);
    const env = {
        ...OPEN_RECOVERY_ENV,
        AMY_ANAM_RECOVERY_SECRET: dedicated,
        CRON_SECRET: cron,
    };

    const config = readAmyAnamRecoveryConfig(env);
    assert.equal(config.authenticationConfigured, true);
    assert.equal(config.gatesOpen, true);
    assert.equal(isAmyAnamRecoveryRequestAuthorized(
        new Request('https://example.test/api/anam/session/recover', {
            headers: { Authorization: `Bearer ${dedicated}` },
        }),
        env,
    ), true);
    assert.equal(isAmyAnamRecoveryRequestAuthorized(
        new Request('https://example.test/api/anam/session/recover', {
            headers: { Authorization: `Bearer ${cron}` },
        }),
        env,
    ), true);
    assert.equal(isAmyAnamRecoveryRequestAuthorized(
        new Request('https://example.test/api/anam/session/recover', {
            headers: { Authorization: `Bearer ${'x'.repeat(32)}` },
        }),
        env,
    ), false);
});

test('recovery authentication fails closed when no sufficiently strong secret exists', () => {
    const env = { ...OPEN_RECOVERY_ENV, AMY_ANAM_RECOVERY_SECRET: 'short', CRON_SECRET: '' };
    const config = readAmyAnamRecoveryConfig(env);
    assert.equal(config.authenticationConfigured, false);
    assert.equal(config.gatesOpen, false);
    assert.equal(isAmyAnamRecoveryRequestAuthorized(
        new Request('https://example.test/api/anam/session/recover'),
        env,
    ), false);
});

test('recovery needs enabled, kill-switch, authentication, and production approval gates', () => {
    assert.equal(readAmyAnamRecoveryConfig({}).gatesOpen, false);
    assert.equal(readAmyAnamRecoveryConfig({
        ...OPEN_RECOVERY_ENV,
        AMY_ANAM_RECOVERY_ENABLED: 'false',
    }).gatesOpen, false);
    assert.equal(readAmyAnamRecoveryConfig({
        ...OPEN_RECOVERY_ENV,
        AMY_ANAM_RECOVERY_KILL_SWITCH: 'true',
    }).gatesOpen, false);
    assert.equal(readAmyAnamRecoveryConfig(OPEN_RECOVERY_ENV).gatesOpen, true);
    assert.equal(readAmyAnamRecoveryConfig({
        ...OPEN_RECOVERY_ENV,
        AMY_ANAM_PRODUCTION_PROMOTION_APPROVED: 'true',
    }).productionPromotionApproved, false);

    const closedProduction = readAmyAnamRecoveryConfig({
        ...OPEN_RECOVERY_ENV,
        VERCEL_ENV: 'production',
    });
    assert.equal(closedProduction.productionApprovalRequired, true);
    assert.equal(closedProduction.productionPromotionApproved, false);
    assert.equal(closedProduction.gatesOpen, false);
    assert.equal(readAmyAnamRecoveryConfig({
        ...OPEN_RECOVERY_ENV,
        VERCEL_ENV: 'production',
        AMY_ANAM_PRODUCTION_PROMOTION_APPROVED: 'true',
    }).gatesOpen, true);
});

test('the drain processes a bounded batch and cleans only terminal due entries', async () => {
    const removed = [];
    const lockEvents = [];
    const statuses = new Map([
        [SESSION_ONE, 'completed'],
        [SESSION_TWO, 'pending'],
        [SESSION_THREE, 'busy'],
        [SESSION_FOUR, 'missing'],
    ]);

    const summary = await drainDueAmyAnamFinalizations({
        batchSize: 99,
        concurrency: 1,
        dependencies: recoveryDependencies({
            acquireDrainLock: async token => {
                lockEvents.push(['acquire', token]);
                return true;
            },
            releaseDrainLock: async token => { lockEvents.push(['release', token]); },
            listDue: async ({ limit }) => {
                assert.equal(limit, AMY_ANAM_RECOVERY_BATCH_SIZE);
                return [SESSION_ONE, SESSION_TWO, SESSION_THREE, SESSION_FOUR];
            },
            removeDue: async sessionId => { removed.push(sessionId); },
            finalize: async sessionId => statuses.get(sessionId),
        }),
    });

    assert.equal(summary.status, 'drained');
    assert.equal(summary.selected, 4);
    assert.equal(summary.attempted, 4);
    assert.equal(summary.cleaned, 2);
    assert.equal(summary.errors, 0);
    assert.deepEqual(summary.results, {
        busy: 1,
        bound: 0,
        completed: 1,
        failed: 0,
        missing: 1,
        pending: 1,
    });
    assert.deepEqual(removed, [SESSION_ONE, SESSION_FOUR]);
    assert.deepEqual(lockEvents, [
        ['acquire', 'recovery-lock-token'],
        ['release', 'recovery-lock-token'],
    ]);
});

test('the global drain lease makes overlapping scheduler invocations a no-op', async () => {
    let listed = false;
    let released = false;
    const summary = await drainDueAmyAnamFinalizations({
        dependencies: recoveryDependencies({
            acquireDrainLock: async () => false,
            releaseDrainLock: async () => { released = true; },
            listDue: async () => {
                listed = true;
                return [SESSION_ONE];
            },
        }),
    });

    assert.equal(summary.status, 'busy');
    assert.equal(summary.attempted, 0);
    assert.equal(listed, false);
    assert.equal(released, false);
});

test('the drain caps worker concurrency even if a larger value is requested', async () => {
    let active = 0;
    let maximumActive = 0;
    const summary = await drainDueAmyAnamFinalizations({
        concurrency: 99,
        dependencies: recoveryDependencies({
            listDue: async () => [SESSION_ONE, SESSION_TWO, SESSION_THREE, SESSION_FOUR],
            finalize: async () => {
                active += 1;
                maximumActive = Math.max(maximumActive, active);
                await new Promise(resolve => setImmediate(resolve));
                active -= 1;
                return 'pending';
            },
        }),
    });

    assert.equal(AMY_ANAM_RECOVERY_CONCURRENCY, 2);
    assert.equal(maximumActive, AMY_ANAM_RECOVERY_CONCURRENCY);
    assert.equal(summary.attempted, 4);
});

test('the drain stops dispatching new sessions after its deadline', async () => {
    let clockReads = 0;
    const summary = await drainDueAmyAnamFinalizations({
        dispatchWindowMs: 1_000,
        dependencies: recoveryDependencies({
            now: () => {
                clockReads += 1;
                return clockReads === 1 ? 0 : 2_000;
            },
            listDue: async () => [SESSION_ONE, SESSION_TWO],
        }),
    });

    assert.equal(summary.selected, 2);
    assert.equal(summary.attempted, 0);
    assert.equal(summary.skippedDueToDeadline, 2);
    assert.ok(summary.durationMs >= 2_000);
});

test('invalid and missing queue members are pruned without provider calls', async () => {
    const removed = [];
    let providerCalls = 0;
    const summary = await drainDueAmyAnamFinalizations({
        dependencies: recoveryDependencies({
            listDue: async () => ['not-a-session-id', SESSION_ONE],
            removeDue: async sessionId => { removed.push(sessionId); },
            finalize: async () => {
                providerCalls += 1;
                return 'missing';
            },
        }),
    });

    assert.equal(summary.invalid, 1);
    assert.equal(summary.attempted, 1);
    assert.equal(providerCalls, 1);
    assert.deepEqual(removed, ['not-a-session-id', SESSION_ONE]);
});

test('the recovery route is scheduler-compatible, bearer-authenticated, and has no outbound lane', async () => {
    const route = await readFile(
        new URL('../app/api/anam/session/recover/route.ts', import.meta.url),
        'utf8',
    );
    const store = await readFile(
        new URL('../lib/anam/session-spine-store.ts', import.meta.url),
        'utf8',
    );

    assert.match(route, /export async function GET\(request: Request\)/);
    assert.match(route, /export async function POST\(request: Request\)/);
    assert.match(route, /isAmyAnamRecoveryRequestAuthorized\(request\)/);
    assert.match(route, /Targeted recovery requires POST/);
    assert.match(route, /requeueAmyAnamProviderResponseFailure\(targetSessionId\)/);
    assert.match(route, /finalizeAmyAnamSession\(targetSessionId\)/);
    assert.match(
        route,
        /if \(!recoveryConfig\.gatesOpen\) \{[\s\S]*?Amy session recovery is unavailable[\s\S]*?status: 503/,
    );
    assert.ok(
        route.indexOf('if (!recoveryConfig.gatesOpen)')
            < route.indexOf('if (!isAmyAnamRecoveryRequestAuthorized(request))'),
        'a closed recovery gate must return 503 before an unconditional cron is authenticated',
    );
    assert.match(route, /outbound:\s*false/);
    assert.match(route, /maxDuration = 60/);
    assert.match(store, /'ZRANGEBYSCORE'/);
    assert.match(store, /recovery-drain-lock:v1/);
    assert.match(store, /'NX',[\s\S]*'EX',[\s\S]*55/);
    assert.match(
        store,
        /current\.state ~= 'failed' or current\.failureCode ~= 'provider_response'/,
    );
});
test('owner email recovery requires the signed session browser and a same-origin POST', async () => {
    const route = await readFile(
        new URL('../app/support/amy-email-recovery/route.ts', import.meta.url),
        'utf8',
    );

    assert.match(route, /readAmyAnamBrowserSession\(request, config\.signingSecret\)/);
    assert.match(route, /session\.browserSessionId !== browserSession\.id/);
    assert.match(route, /finalization\.browserSessionId !== browserSession\.id/);
    assert.match(route, /request\.headers\.get\('origin'\) !== new URL\(request\.url\)\.origin/);
    assert.match(route, /failureCode !== 'provider_response'/);
    assert.match(route, /requeueAmyAnamProviderResponseFailure\(owned\.sessionId\)/);
    assert.match(route, /X-Robots-Tag', 'noindex, nofollow'/);
});
