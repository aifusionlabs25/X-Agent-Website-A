import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
    normalizeAmyAnamHermesWorkerBridgeRequest,
    normalizeAmyAnamHermesWorkerRetirementResponse,
    normalizeAmyAnamHermesWorkerStatusResponse,
} from '../lib/anam/hermes-worker-bridge.ts';
import {
    AMY_ANAM_HERMES_STALE_RETIREMENT_CONFIRMATION,
    buildAmyAnamHermesShadowJob,
    readAmyAnamHermesShadowBacklogStatus,
    retireAmyAnamHermesShadowJobsBefore,
} from '../lib/anam/hermes-shadow-store.ts';
import { buildAmyAnamReceipt } from '../lib/anam/session-spine.ts';
import { createAmyAnamHermesShadowPointer } from '../lib/anam/hermes-shadow.ts';
import {
    readAmyAnamHermesBacklogCommand,
    runAmyAnamHermesBacklogCommand,
} from '../scripts/hermes/amy-anam-shadow-backlog.mjs';

const SECRET = 'backlog-secret-that-is-at-least-32-characters';
const CUTOFF = '2026-08-15T20:00:00.000Z';
const ENV = {
    AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
    AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
    AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
    AMY_ANAM_REDIS_REST_URL: 'https://redis.example.test',
    AMY_ANAM_REDIS_REST_TOKEN: 'server-only-token',
    AMY_ANAM_HERMES_WORKER_BRIDGE_URL: 'https://xagent.example.test/api/anam/hermes/worker',
    AMY_ANAM_HERMES_WORKER_SECRET: SECRET,
};

function jobFor(index, enqueuedAt) {
    const externalSessionId = `anam_backlog_session_${String(index).padStart(8, '0')}`;
    const session = {
        schemaVersion: 'amy_anam_session_v1',
        browserSessionId: `browser-${index}`,
        launchId: `launch-${index}`,
        externalSessionId,
        clientLabel: `xagent-amy:${index}`,
        resolvedPersonaId: 'persona-amy-cara4',
        provider: 'anam',
        agentSlug: 'amy',
        variant: 'amy-cara4',
        state: 'completed',
        createdAt: enqueuedAt,
        boundAt: enqueuedAt,
        completedAt: enqueuedAt,
    };
    const receipt = buildAmyAnamReceipt({
        externalSessionId,
        source: 'anam_api',
        turns: [
            { role: 'user', content: `Synthetic backlog request ${index}.` },
            { role: 'agent', content: 'Synthetic response.' },
        ],
        now: Date.parse(enqueuedAt),
    });
    return buildAmyAnamHermesShadowJob(createAmyAnamHermesShadowPointer({
        session,
        receipt,
        now: Date.parse(enqueuedAt),
    }));
}

function makeRedisFetch(initialJobs, options = {}) {
    const jobs = new Map(initialJobs.map(job => [job.pointer.jobId, job]));
    const leases = new Set(options.leases ?? []);
    const executions = new Set(options.executions ?? []);
    const dead = new Set();
    let retirementCalls = 0;
    const fetchImpl = async (_url, init) => {
        const commands = JSON.parse(String(init.body));
        const results = commands.map((command) => {
            const [verb, ...args] = command;
            if (verb === 'ZCARD') {
                return { result: String(args[0]).includes(':dead:') ? dead.size : jobs.size };
            }
            if (verb === 'ZRANGE') return { result: [...jobs.keys()] };
            if (verb === 'GET') {
                const key = String(args[0]);
                const jobId = key.slice(key.lastIndexOf(':') + 1);
                if (key.includes(':job:v1:')) {
                    return { result: jobs.has(jobId) ? JSON.stringify(jobs.get(jobId)) : null };
                }
                if (key.includes(':lease:v1:')) return { result: leases.has(jobId) ? 'lease' : null };
                if (key.includes(':execution-started:v1:')) {
                    return { result: executions.has(jobId) ? '1' : null };
                }
                return { result: null };
            }
            if (verb === 'EVAL') {
                retirementCalls += 1;
                const keyCount = Number(args[1]);
                const keys = args.slice(2, 2 + keyCount).map(String);
                const values = args.slice(2 + keyCount).map(String);
                const jobId = values[0];
                if (!jobs.has(jobId)) return { result: 'stale' };
                if (leases.has(jobId) || executions.has(jobId)) {
                    return { result: 'protected_active' };
                }
                jobs.delete(jobId);
                dead.add(jobId);
                assert.ok(keys.some(key => key.includes(':dead-job:v1:')));
                assert.equal(JSON.parse(values[3]).failureCode, 'operator_retired_stale');
                return { result: 'retired' };
            }
            throw new Error(`Unsupported test Redis command: ${verb}`);
        });
        return new Response(JSON.stringify(results), { status: 200 });
    };
    return { fetchImpl, jobs, dead, get retirementCalls() { return retirementCalls; } };
}

test('backlog status is read-only, content-free, and separates pre-checkpoint jobs', async () => {
    const oldJob = jobFor(1, '2026-08-01T12:00:00.000Z');
    const newJob = jobFor(2, '2026-08-15T20:00:00.000Z');
    const redis = makeRedisFetch([oldJob, newJob], { leases: [oldJob.pointer.jobId] });
    const status = await readAmyAnamHermesShadowBacklogStatus(CUTOFF, {
        env: ENV,
        fetchImpl: redis.fetchImpl,
        now: Date.parse(CUTOFF),
    });
    assert.equal(status.dueCount, 2);
    assert.equal(status.queuedBeforeCutoff, 1);
    assert.equal(status.queuedAtOrAfterCutoff, 1);
    assert.equal(status.retirableBeforeCutoff, 0);
    assert.equal(status.protectedBeforeCutoff, 1);
    assert.equal(status.contentIncluded, false);
    assert.match(status.snapshotDigest, /^[a-f0-9]{64}$/);
    assert.equal(redis.retirementCalls, 0);
    const serialized = JSON.stringify(status);
    assert.equal(serialized.includes(oldJob.pointer.externalSessionId), false);
    assert.equal(serialized.includes('Synthetic backlog request'), false);
});

test('retirement requires an exact inspected digest and preserves active work', async () => {
    const oldJob = jobFor(3, '2026-08-01T12:00:00.000Z');
    const activeJob = jobFor(4, '2026-08-02T12:00:00.000Z');
    const redis = makeRedisFetch([oldJob, activeJob], { executions: [activeJob.pointer.jobId] });
    const status = await readAmyAnamHermesShadowBacklogStatus(CUTOFF, {
        env: ENV,
        fetchImpl: redis.fetchImpl,
    });
    await assert.rejects(
        retireAmyAnamHermesShadowJobsBefore({
            cutoff: CUTOFF,
            expectedSnapshotDigest: '0'.repeat(64),
            confirmation: AMY_ANAM_HERMES_STALE_RETIREMENT_CONFIRMATION,
        }, { env: ENV, fetchImpl: redis.fetchImpl }),
        /changed after inspection/,
    );
    assert.equal(redis.retirementCalls, 0);

    const result = await retireAmyAnamHermesShadowJobsBefore({
        cutoff: CUTOFF,
        expectedSnapshotDigest: status.snapshotDigest,
        confirmation: AMY_ANAM_HERMES_STALE_RETIREMENT_CONFIRMATION,
    }, { env: ENV, fetchImpl: redis.fetchImpl, now: Date.parse(CUTOFF) });
    assert.deepEqual({
        attempted: result.attempted,
        retired: result.retired,
        protectedActive: result.protectedActive,
        stale: result.stale,
        contentIncluded: result.contentIncluded,
    }, {
        attempted: 2,
        retired: 1,
        protectedActive: 1,
        stale: 0,
        contentIncluded: false,
    });
    assert.equal(redis.jobs.has(oldJob.pointer.jobId), false);
    assert.equal(redis.jobs.has(activeJob.pointer.jobId), true);
    assert.equal(redis.dead.has(oldJob.pointer.jobId), true);
});

test('bridge backlog contracts reject extras and validate content-free count relationships', () => {
    assert.deepEqual(normalizeAmyAnamHermesWorkerBridgeRequest({
        operation: 'status',
        protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
        cutoff: CUTOFF,
    }), {
        operation: 'status',
        protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
        cutoff: CUTOFF,
    });
    assert.throws(() => normalizeAmyAnamHermesWorkerBridgeRequest({
        operation: 'status',
        protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
        cutoff: CUTOFF,
        transcript: 'forbidden',
    }), /protocol/);
    assert.throws(() => normalizeAmyAnamHermesWorkerBridgeRequest({
        operation: 'retire_stale',
        protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
        cutoff: CUTOFF,
        expectedSnapshotDigest: 'a'.repeat(64),
        confirmation: 'yes',
    }), /confirmation/);

    const status = normalizeAmyAnamHermesWorkerStatusResponse({
        ok: true,
        operation: 'status',
        schemaVersion: 'amy_anam_hermes_backlog_status_v1',
        cutoff: CUTOFF,
        dueCount: 2,
        scannedCount: 2,
        missingJobCount: 0,
        queuedBeforeCutoff: 1,
        queuedAtOrAfterCutoff: 1,
        retirableBeforeCutoff: 1,
        protectedBeforeCutoff: 0,
        deadLetterCount: 0,
        oldestEnqueuedAt: '2026-08-01T12:00:00.000Z',
        newestEnqueuedAt: CUTOFF,
        snapshotDigest: 'b'.repeat(64),
        contentIncluded: false,
    });
    assert.equal(status.contentIncluded, false);
    assert.throws(() => normalizeAmyAnamHermesWorkerStatusResponse({
        ...status,
        queuedBeforeCutoff: 2,
    }), /relationships/);

    const retired = normalizeAmyAnamHermesWorkerRetirementResponse({
        ok: true,
        operation: 'retire_stale',
        schemaVersion: 'amy_anam_hermes_backlog_retirement_v1',
        cutoff: CUTOFF,
        expectedSnapshotDigest: 'b'.repeat(64),
        attempted: 2,
        retired: 1,
        protectedActive: 1,
        stale: 0,
        contentIncluded: false,
    });
    assert.equal(retired.attempted, 2);
});

test('operator command defaults to inspection and requires explicit apply proof', async () => {
    const inspection = readAmyAnamHermesBacklogCommand([`--cutoff=${CUTOFF}`]);
    assert.equal(inspection.apply, false);
    assert.throws(() => readAmyAnamHermesBacklogCommand([
        `--cutoff=${CUTOFF}`,
        '--apply',
    ]), /expected-snapshot-digest/);

    const responseBody = {
        ok: true,
        operation: 'status',
        schemaVersion: 'amy_anam_hermes_backlog_status_v1',
        cutoff: CUTOFF,
        dueCount: 0,
        scannedCount: 0,
        missingJobCount: 0,
        queuedBeforeCutoff: 0,
        queuedAtOrAfterCutoff: 0,
        retirableBeforeCutoff: 0,
        protectedBeforeCutoff: 0,
        deadLetterCount: 0,
        oldestEnqueuedAt: null,
        newestEnqueuedAt: null,
        snapshotDigest: 'c'.repeat(64),
        contentIncluded: false,
    };
    const calls = [];
    const result = await runAmyAnamHermesBacklogCommand(inspection, {
        env: ENV,
        fetchImpl: async (_url, init) => {
            calls.push(JSON.parse(String(init.body)));
            return new Response(JSON.stringify(responseBody), { status: 200 });
        },
    });
    assert.equal(result.dueCount, 0);
    assert.deepEqual(calls, [{
        operation: 'status',
        protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
        cutoff: CUTOFF,
    }]);
});
