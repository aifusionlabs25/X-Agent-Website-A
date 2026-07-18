import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AMY_ANAM_HERMES_SHADOW_EXECUTION_GRACE_SECONDS,
    createAmyAnamHermesShadowPointer,
} from '../lib/anam/hermes-shadow.ts';
import {
    AMY_ANAM_HERMES_SHADOW_DUE_KEY,
    acknowledgeAmyAnamHermesShadowJob,
    amyAnamHermesShadowExecutionKey,
    beginAmyAnamHermesShadowExecution,
    buildAmyAnamHermesShadowJob,
    leaseNextAmyAnamHermesShadowJob,
    retryOrDeadLetterAmyAnamHermesShadowJob,
} from '../lib/anam/hermes-shadow-store.ts';
import { buildAmyAnamReceipt } from '../lib/anam/session-spine.ts';

const NOW = Date.parse('2026-07-15T12:00:00.000Z');
const ENV = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 's'.repeat(32),
    AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
    AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
    AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
    AMY_ANAM_REDIS_REST_URL: 'https://redis.example.test',
    AMY_ANAM_REDIS_REST_TOKEN: 'redis-secret',
    AMY_ANAM_HERMES_SHADOW_MAX_ATTEMPTS: '3',
};

function fixtureLease() {
    const session = {
        schemaVersion: 'amy_anam_session_v1',
        browserSessionId: 'browser-12345678',
        launchId: '11111111-2222-4333-8444-555555555555',
        externalSessionId: 'anam_session_at_most_once_1234',
        clientLabel: 'xagent-amy-at-most-once',
        resolvedPersonaId: 'persona-amy-cara4',
        provider: 'anam',
        agentSlug: 'amy',
        variant: 'amy-cara4',
        state: 'completed',
        createdAt: '2026-07-15T11:50:00.000Z',
    };
    const receipt = buildAmyAnamReceipt({
        externalSessionId: session.externalSessionId,
        source: 'anam_api',
        turns: [{ role: 'user', content: 'Please review the integration.' }],
        now: NOW,
    });
    const pointer = createAmyAnamHermesShadowPointer({ session, receipt, now: NOW });
    return {
        job: { ...buildAmyAnamHermesShadowJob(pointer), attempts: 1 },
        leaseToken: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        leaseUntil: NOW + 180_000,
    };
}

function redisResult(result, capture) {
    return async (_url, init) => {
        capture.push(JSON.parse(init.body)[0]);
        return new Response(JSON.stringify([{ result }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };
}

function fixtureOutput() {
    return {
        schema_version: 'amy_anam_hermes_shadow_output_v1',
        summary: 'The visitor requested an integration review.',
        inquiry_type: 'integration review',
        recommended_next_steps: ['Review the factual recap.'],
        needs_human_review: false,
        quality_review: {
            repeated_question_risk: false,
            unsupported_claim_risk: false,
            pricing_or_inventory_claim_risk: false,
            technical_term_risk: false,
            privacy_risk: false,
        },
        safety: {
            shadow_only: true,
            tools_called: 0,
            emails_sent: 0,
            memory_writes: 0,
            outbound_actions: 0,
        },
    };
}

test('post-provider failures exhaust the retry budget and dead-letter atomically', async () => {
    const commands = [];
    const status = await retryOrDeadLetterAmyAnamHermesShadowJob({
        lease: fixtureLease(),
        failureCode: 'hermes_timeout',
        hermesExecutionHappened: true,
    }, {
        env: ENV,
        now: NOW,
        fetchImpl: redisResult('dead_letter', commands),
    });

    assert.equal(status, 'dead_letter');
    assert.equal(commands.length, 1);
    assert.equal(commands[0][0], 'EVAL');
    assert.equal(commands[0][13], 0);
    assert.match(commands[0][1], /attempts.*ARGV\[3\]/s);
    assert.ok(commands[0].includes(amyAnamHermesShadowExecutionKey(
        fixtureLease().job.pointer.jobId,
    )));
    assert.match(commands[0][1], /DEL', KEYS\[8\]/);
});

test('pre-provider failures retain the bounded retry budget', async () => {
    const commands = [];
    const status = await retryOrDeadLetterAmyAnamHermesShadowJob({
        lease: fixtureLease(),
        failureCode: 'transcript_not_ready',
        hermesExecutionHappened: false,
    }, {
        env: ENV,
        now: NOW,
        fetchImpl: redisResult('retry_scheduled', commands),
    });

    assert.equal(status, 'retry_scheduled');
    assert.equal(commands.length, 1);
    assert.equal(commands[0][13], 3);
});

test('provider execution requires a durable content-free start marker', async () => {
    const commands = [];
    const lease = fixtureLease();
    const status = await beginAmyAnamHermesShadowExecution(lease, {
        env: ENV,
        now: NOW,
        fetchImpl: redisResult('started', commands),
    });

    assert.equal(status, 'started');
    assert.equal(commands.length, 1);
    assert.equal(commands[0][0], 'EVAL');
    assert.ok(commands[0].includes(amyAnamHermesShadowExecutionKey(
        lease.job.pointer.jobId,
    )));
    assert.match(commands[0][1], /hermesExecutionHappened = true/);
    assert.match(commands[0][1], /EXPIRE', KEYS\[1\].*ZADD', KEYS\[6\]/);
    assert.ok(commands[0].includes(AMY_ANAM_HERMES_SHADOW_DUE_KEY));
    assert.ok(commands[0].includes(AMY_ANAM_HERMES_SHADOW_EXECUTION_GRACE_SECONDS));
    assert.ok(commands[0].includes(
        NOW + AMY_ANAM_HERMES_SHADOW_EXECUTION_GRACE_SECONDS * 1000,
    ));
    assert.equal(JSON.stringify(commands[0]).includes('Please review the integration.'), false);
});

test('completion cannot acknowledge a job without its matching execution marker', async () => {
    const lease = fixtureLease();
    const commands = [];
    const acknowledged = await acknowledgeAmyAnamHermesShadowJob({
        lease,
        output: fixtureOutput(),
    }, {
        env: ENV,
        now: NOW,
        fetchImpl: redisResult(0, commands),
    });

    assert.equal(acknowledged, false);
    assert.equal(commands.length, 1);
    assert.ok(commands[0].includes(amyAnamHermesShadowExecutionKey(
        lease.job.pointer.jobId,
    )));
    assert.match(commands[0][1], /GET', KEYS\[6\].*ARGV\[7\]/);
});

test('an expired lease with a durable execution marker dead-letters without another lease', async () => {
    const lease = fixtureLease();
    const commands = [];
    const results = [
        [lease.job.pointer.jobId],
        '1',
        JSON.stringify(lease.job),
        'dead_letter',
    ];
    const claimed = await leaseNextAmyAnamHermesShadowJob({
        env: ENV,
        now: NOW,
        fetchImpl: async (_url, init) => {
            commands.push(JSON.parse(init.body)[0]);
            return new Response(JSON.stringify([{ result: results.shift() }]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    });

    assert.equal(claimed, null);
    assert.equal(results.length, 0);
    assert.equal(commands.some(command => String(command[1]).includes('job.attempts =')), false);
    const transition = commands.at(-1);
    assert.match(transition[1], /provider_execution_ambiguous|dead_letter/);
    assert.ok(transition.includes(amyAnamHermesShadowExecutionKey(
        lease.job.pointer.jobId,
    )));
});

test('a stale execution marker with no job is removed from due and lease namespaces', async () => {
    const lease = fixtureLease();
    const commands = [];
    const results = [
        [lease.job.pointer.jobId],
        '1',
        null,
        1,
    ];
    const claimed = await leaseNextAmyAnamHermesShadowJob({
        env: ENV,
        now: NOW,
        fetchImpl: async (_url, init) => {
            commands.push(JSON.parse(init.body)[0]);
            return new Response(JSON.stringify([{ result: results.shift() }]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    });

    assert.equal(claimed, null);
    assert.equal(results.length, 0);
    const cleanup = commands.at(-1);
    assert.equal(cleanup[0], 'EVAL');
    assert.match(cleanup[1], /DEL', KEYS\[1\].*DEL', KEYS\[3\].*ZREM', KEYS\[2\]/);
    assert.ok(cleanup.includes(amyAnamHermesShadowExecutionKey(
        lease.job.pointer.jobId,
    )));
});
