import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAmyAnamReceipt, createAmyAnamLaunch } from '../lib/anam/session-spine.ts';
import { EVAN_PERSONA_ID } from '../lib/anam/persona-ids.ts';
import {
    acquireAmyAnamRecoveryDrainLock,
    hasDaniAnamEmailRetryDueEntry,
    listDueAmyAnamFinalizationIds,
    listDueDaniAnamEmailRetryIds,
    markAmyAnamFinalizationFailed,
    markAmyAnamFinalizationPending,
    markAmyAnamVerificationPending,
    recordAmyAnamCompletion,
    releaseAmyAnamRecoveryDrainLock,
    removeAmyAnamFinalizationDueEntry,
    removeDaniAnamEmailRetryDueEntry,
    requeueAmyAnamProviderResponseFailure,
    scheduleAmyAnamFinalizationDueEntry,
    scheduleDaniAnamEmailRetryDueEntry,
    writeAmyAnamReceipt,
} from '../lib/anam/session-spine-store.ts';

const BASE_ENV = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 'test-signing-secret-with-at-least-32-characters',
    AMY_ANAM_REDIS_REST_URL: 'https://redis.example.test',
    AMY_ANAM_REDIS_REST_TOKEN: 'test-redis-token',
};
const NAMESPACE = 'evan-6097-candidate';
const CANDIDATE_ENV = { ...BASE_ENV, ANAM_RECOVERY_NAMESPACE: NAMESPACE };
const NOW = Date.parse('2026-10-17T12:00:00Z');
const PROD_SESSION = '11111111-1111-4111-8111-111111111111';
const CANDIDATE_SESSION = '22222222-2222-4222-8222-222222222222';
const FINALIZATION_QUEUE = 'xagent:amy:anam:finalization-due:v1';
const DANI_QUEUE = 'xagent:dani:anam:agentmail:retry-due:v1';
const DRAIN_LOCK = 'xagent:amy:anam:recovery-drain-lock:v1';
const scoped = key => `${key}:scope:${NAMESPACE}`;

function redisTransport() {
    const commands = [];
    const sortedSets = new Map();
    const values = new Map();
    function execute(command) {
        commands.push(command);
        const [operation, key, ...args] = command;
        if (operation === 'ZADD') {
            if (!sortedSets.has(key)) sortedSets.set(key, new Map());
            sortedSets.get(key).set(args[1], args[0]);
            return 1;
        }
        if (operation === 'EXPIRE') return 1;
        if (operation === 'ZRANGEBYSCORE') {
            return [...(sortedSets.get(key) ?? new Map()).entries()]
                .filter(([, dueAt]) => dueAt <= args[1])
                .slice(0, args[4])
                .map(([id]) => id);
        }
        if (operation === 'ZSCORE') return sortedSets.get(key)?.get(args[0]) ?? null;
        if (operation === 'ZREM') return Number(sortedSets.get(key)?.delete(args[0]) ?? false);
        if (operation === 'GET') return values.get(key) ?? null;
        if (operation === 'SET') {
            if (args.includes('NX') && values.has(key)) return null;
            values.set(key, args[0]);
            return 'OK';
        }
        if (operation === 'EVAL') {
            const keyCount = Number(args[0]);
            const keys = args.slice(1, keyCount + 1);
            const argv = args.slice(keyCount + 1);
            if (key.includes("if redis.call('GET', KEYS[1]) == ARGV[1] then")) {
                if (values.get(keys[0]) !== argv[0]) return 0;
                values.delete(keys[0]);
                return 1;
            }
            return key.includes('local launchRaw') ? 'queued' : 'OK';
        }
        throw new Error(`Unexpected command ${operation}`);
    }
    return {
        commands,
        sortedSets,
        values,
        fetchImpl: async (_url, init) => new Response(JSON.stringify(
            JSON.parse(init.body).map(command => ({ result: execute(command) })),
        ), { status: 200, headers: { 'content-type': 'application/json' } }),
    };
}

test('candidate and production recovery list, schedule, and remove only their own due work', async () => {
    const redis = redisTransport();
    const production = { env: BASE_ENV, fetchImpl: redis.fetchImpl };
    const candidate = { env: CANDIDATE_ENV, fetchImpl: redis.fetchImpl };
    for (const schedule of [scheduleAmyAnamFinalizationDueEntry, scheduleDaniAnamEmailRetryDueEntry]) {
        await schedule({ externalSessionId: PROD_SESSION, dueAt: NOW }, production);
        await schedule({ externalSessionId: CANDIDATE_SESSION, dueAt: NOW }, candidate);
    }
    for (const list of [listDueAmyAnamFinalizationIds, listDueDaniAnamEmailRetryIds]) {
        assert.deepEqual(await list({ dueAt: NOW, limit: 8 }, production), [PROD_SESSION]);
        assert.deepEqual(await list({ dueAt: NOW, limit: 8 }, candidate), [CANDIDATE_SESSION]);
    }
    assert.equal(await hasDaniAnamEmailRetryDueEntry(PROD_SESSION, candidate), false);
    assert.equal(await hasDaniAnamEmailRetryDueEntry(CANDIDATE_SESSION, candidate), true);
    await removeAmyAnamFinalizationDueEntry(CANDIDATE_SESSION, candidate);
    await removeDaniAnamEmailRetryDueEntry(CANDIDATE_SESSION, candidate);
    assert.deepEqual(await listDueAmyAnamFinalizationIds({ dueAt: NOW, limit: 8 }, candidate), []);
    assert.deepEqual(await listDueDaniAnamEmailRetryIds({ dueAt: NOW, limit: 8 }, candidate), []);
    assert.deepEqual(await listDueAmyAnamFinalizationIds({ dueAt: NOW, limit: 8 }, production), [PROD_SESSION]);
    assert.deepEqual(await listDueDaniAnamEmailRetryIds({ dueAt: NOW, limit: 8 }, production), [PROD_SESSION]);
    assert.deepEqual([...redis.sortedSets.keys()].sort(), [FINALIZATION_QUEUE, DANI_QUEUE, scoped(FINALIZATION_QUEUE), scoped(DANI_QUEUE)].sort());
});

test('candidate recovery drain has a separate ownership lock', async () => {
    const redis = redisTransport();
    const production = { env: BASE_ENV, fetchImpl: redis.fetchImpl };
    const candidate = { env: CANDIDATE_ENV, fetchImpl: redis.fetchImpl };
    assert.equal(await acquireAmyAnamRecoveryDrainLock('prod-lock', production), true);
    assert.equal(await acquireAmyAnamRecoveryDrainLock('candidate-lock', candidate), true);
    assert.equal(await acquireAmyAnamRecoveryDrainLock('other-candidate', candidate), false);
    await releaseAmyAnamRecoveryDrainLock('wrong-owner', candidate);
    assert.equal(redis.values.get(scoped(DRAIN_LOCK)), 'candidate-lock');
    await releaseAmyAnamRecoveryDrainLock('candidate-lock', candidate);
    assert.equal(redis.values.has(scoped(DRAIN_LOCK)), false);
    assert.equal(redis.values.get(DRAIN_LOCK), 'prod-lock');
});

test('completion, retry, failure, and receipt Lua transactions all receive the scoped due queue', async () => {
    const redis = redisTransport();
    const options = { env: CANDIDATE_ENV, fetchImpl: redis.fetchImpl };
    const launch = createAmyAnamLaunch('browser-session-id', EVAN_PERSONA_ID, NOW, 'evan');
    const session = {
        schemaVersion: 'amy_anam_session_v1',
        provider: 'anam',
        browserSessionId: launch.browserSessionId,
        launchId: launch.launchId,
        externalSessionId: CANDIDATE_SESSION,
        resolvedPersonaId: EVAN_PERSONA_ID,
        agentSlug: 'evan',
        variant: 'evan-mullins',
        clientLabel: launch.clientLabel,
        state: 'awaiting_transcript',
        createdAt: new Date(NOW).toISOString(),
    };
    const finalization = {
        schemaVersion: 'amy_anam_finalization_v1',
        browserSessionId: launch.browserSessionId,
        launchId: launch.launchId,
        externalSessionId: CANDIDATE_SESSION,
        state: 'verification_pending',
        closeReason: 'user_exit',
        receivedAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
        attempts: 0,
        nextAttemptAt: new Date(NOW).toISOString(),
    };
    await recordAmyAnamCompletion({ launch, browserSessionId: launch.browserSessionId, externalSessionId: CANDIDATE_SESSION, closeReason: 'user_exit', now: NOW }, options);
    await markAmyAnamVerificationPending({ finalization, retryAfterMs: 1_000, now: NOW }, options);
    await markAmyAnamFinalizationPending({ session, finalization, retryAfterMs: 1_000, now: NOW }, options);
    await markAmyAnamFinalizationFailed({ session, finalization, failureCode: 'provider_response', now: NOW }, options);
    redis.values.set(`xagent:amy:anam:session:v1:${CANDIDATE_SESSION}`, JSON.stringify(session));
    redis.values.set(`xagent:amy:anam:finalization:v1:${CANDIDATE_SESSION}`, JSON.stringify({ ...finalization, state: 'failed', failureCode: 'provider_response' }));
    assert.equal(await requeueAmyAnamProviderResponseFailure(CANDIDATE_SESSION, options), 'requeued');
    const receipt = buildAmyAnamReceipt({ externalSessionId: CANDIDATE_SESSION, closeReason: 'user_exit', source: 'anam_api', turns: [{ role: 'user', content: 'Moving to Phoenix.' }], variant: 'evan-mullins', now: NOW });
    assert.equal(await writeAmyAnamReceipt(session, finalization, receipt, options), 'stored');
    const transactions = redis.commands.filter(command => command[0] === 'EVAL');
    assert.equal(transactions.length, 6);
    for (const command of transactions) {
        const keys = command.slice(3, 3 + Number(command[2]));
        assert.ok(keys.includes(scoped(FINALIZATION_QUEUE)));
        assert.ok(!keys.includes(FINALIZATION_QUEUE));
        const luaKey = `KEYS[${keys.indexOf(scoped(FINALIZATION_QUEUE)) + 1}]`;
        assert.ok(command[1].includes(`'ZADD', ${luaKey}`) || command[1].includes(`'ZREM', ${luaKey}`));
    }
});

test('invalid configured namespaces fail before any Redis request instead of using production queues', async () => {
    for (const namespace of ['', ' ', ' evan', 'evan ', 'EVAN', '-evan', 'evan:prod', 'evan\n', 'evan/preview', 'x'.repeat(33)]) {
        let requests = 0;
        const options = {
            env: { ...BASE_ENV, ANAM_RECOVERY_NAMESPACE: namespace },
            fetchImpl: async () => { requests += 1; throw new Error('must not request Redis'); },
        };
        for (const operation of [
            () => listDueAmyAnamFinalizationIds({ dueAt: NOW, limit: 8 }, options),
            () => scheduleAmyAnamFinalizationDueEntry({ externalSessionId: CANDIDATE_SESSION, dueAt: NOW }, options),
            () => listDueDaniAnamEmailRetryIds({ dueAt: NOW, limit: 8 }, options),
            () => acquireAmyAnamRecoveryDrainLock('lock', options),
        ]) await assert.rejects(operation, /Anam recovery namespace/);
        assert.equal(requests, 0);
    }
});

test('runtime namespace is read dynamically and an explicit env object does not inherit it', async () => {
    const oldValues = Object.fromEntries(Object.keys(CANDIDATE_ENV).map(key => [key, process.env[key]]));
    const redis = redisTransport();
    try {
        Object.assign(process.env, CANDIDATE_ENV);
        await listDueAmyAnamFinalizationIds({ dueAt: NOW, limit: 8 }, { fetchImpl: redis.fetchImpl });
        await listDueAmyAnamFinalizationIds({ dueAt: NOW, limit: 8 }, { env: BASE_ENV, fetchImpl: redis.fetchImpl });
        assert.equal(redis.commands[0][1], scoped(FINALIZATION_QUEUE));
        assert.equal(redis.commands[1][1], FINALIZATION_QUEUE);
    } finally {
        for (const [key, value] of Object.entries(oldValues)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
