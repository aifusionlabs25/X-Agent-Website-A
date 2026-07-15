import assert from 'node:assert/strict';
import test from 'node:test';
import { createAmyAnamHermesShadowPointer } from '../lib/anam/hermes-shadow.ts';
import {
    AMY_ANAM_HERMES_SHADOW_DUE_KEY,
    buildAmyAnamHermesShadowQueuedEnvelope,
} from '../lib/anam/hermes-shadow-store.ts';
import { buildAmyAnamReceipt } from '../lib/anam/session-spine.ts';
import { writeAmyAnamReceipt } from '../lib/anam/session-spine-store.ts';

const NOW = Date.parse('2026-07-14T22:00:00.000Z');
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const OPEN_ENV = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 's'.repeat(32),
    AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
    AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
    AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
    AMY_ANAM_REDIS_REST_URL: 'https://redis.example.test',
    AMY_ANAM_REDIS_REST_TOKEN: 'redis-secret',
};

function fixtureSession() {
    return {
        schemaVersion: 'amy_anam_session_v1',
        browserSessionId: 'browser-session-id',
        launchId: '99999999-8888-4777-8666-555555555555',
        externalSessionId: SESSION_ID,
        clientLabel: 'xagent-amy:99999999-8888-4777-8666-555555555555',
        resolvedPersonaId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        provider: 'anam',
        agentSlug: 'amy',
        variant: 'amy-cara4',
        state: 'awaiting_transcript',
        createdAt: '2026-07-14T21:55:00.000Z',
        boundAt: '2026-07-14T21:55:01.000Z',
        closeReceivedAt: '2026-07-14T21:59:00.000Z',
    };
}

function fixtureFinalization() {
    return {
        schemaVersion: 'amy_anam_finalization_v1',
        browserSessionId: 'browser-session-id',
        launchId: '99999999-8888-4777-8666-555555555555',
        externalSessionId: SESSION_ID,
        state: 'awaiting_transcript',
        closeReason: 'CONNECTION_CLOSED_CODE_NORMAL',
        receivedAt: '2026-07-14T21:59:00.000Z',
        updatedAt: '2026-07-14T21:59:30.000Z',
        attempts: 1,
        nextAttemptAt: '2026-07-14T22:00:00.000Z',
    };
}

function fixtureReceipt() {
    return buildAmyAnamReceipt({
        externalSessionId: SESSION_ID,
        closeReason: 'CONNECTION_CLOSED_CODE_NORMAL',
        source: 'anam_api',
        turns: [
            { role: 'agent', content: 'Hello from Amy.' },
            { role: 'user', content: 'Please prepare a roadmap.' },
        ],
        now: NOW,
    });
}

function redisOk() {
    return new Response(JSON.stringify([{ result: 'OK' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

test('canonical receipt and pointer-only Hermes job commit in one Redis transaction', async () => {
    const session = fixtureSession();
    const finalization = fixtureFinalization();
    const receipt = fixtureReceipt();
    const pointer = createAmyAnamHermesShadowPointer({ session, receipt, now: NOW });
    const envelope = buildAmyAnamHermesShadowQueuedEnvelope(pointer, {
        env: OPEN_ENV,
        now: NOW,
    });
    const calls = [];

    await writeAmyAnamReceipt(session, finalization, receipt, {
        env: OPEN_ENV,
        hermesShadowEnvelope: envelope,
        fetchImpl: async (_url, init) => {
            calls.push(JSON.parse(init.body)[0]);
            return redisOk();
        },
    });

    assert.equal(calls.length, 1);
    const command = calls[0];
    assert.equal(command[0], 'EVAL');
    assert.equal(command[2], 9);
    assert.ok(command.includes(AMY_ANAM_HERMES_SHADOW_DUE_KEY));
    assert.ok(command.includes(envelope.jobJson));
    assert.ok(command.includes(envelope.receiptJson));
    assert.match(command[1], /ZREM.*ZADD/s);
    assert.match(command[1], /SET.*NX.*EX/s);

    const serialized = JSON.stringify(command);
    assert.equal(serialized.includes('Hello from Amy.'), false);
    assert.equal(serialized.includes('Please prepare a roadmap.'), false);
    assert.equal(serialized.includes('redacted_text'), false);
    assert.equal(serialized.includes('recommended_next_steps'), false);
});

test('an envelope that does not match the canonical receipt fails before Redis', async () => {
    const session = fixtureSession();
    const finalization = fixtureFinalization();
    const receipt = fixtureReceipt();
    const pointer = createAmyAnamHermesShadowPointer({ session, receipt, now: NOW });
    const envelope = buildAmyAnamHermesShadowQueuedEnvelope(pointer, {
        env: OPEN_ENV,
        now: NOW,
    });
    let called = false;

    await assert.rejects(
        writeAmyAnamReceipt(session, finalization, receipt, {
            env: OPEN_ENV,
            hermesShadowEnvelope: {
                ...envelope,
                job: {
                    ...envelope.job,
                    pointer: { ...envelope.job.pointer, expectedMessageCount: 99 },
                },
            },
            fetchImpl: async () => {
                called = true;
                return redisOk();
            },
        }),
        /did not match the canonical receipt/,
    );
    assert.equal(called, false);
});
