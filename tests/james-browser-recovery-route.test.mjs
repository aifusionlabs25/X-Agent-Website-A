import { authorizedRequest, installJamesSharedAccess } from './helpers/james-shared-access.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { get as publicGet, post as publicPost } from '../lib/james-canary/public-server.ts';
import { get as candidateGet, post as candidatePost } from '../lib/james-canary/prompt-candidate-server.ts';
import { createJamesServer, seal, unseal } from '../lib/james-canary/server.ts';
import { applyTurn, emptyIntake, PERSONA_ID, sha } from '../lib/james-canary/state.ts';
import { candidateRuntimeConfig, RUNTIME_CANDIDATE_ID } from '../lib/james-canary/runtime-session.ts';
import { AMY_ANAM_BROWSER_TTL_SECONDS, createAmyAnamBrowserSessionWithSecret } from '../lib/anam/session-spine.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/james-candidate-runtime.json', import.meta.url), 'utf8'));
const id = '11111111-2222-4333-8444-555555555555';
const providerId = '4056f1c6-bd11-4682-bcc8-fddcbc8fa22e';
const prefix = 'xagent:james:notepad:v2:';
const cookieName = 'xagent_james_notepad_v2';
const signingSecret = 'fake-browser-recovery-signing-secret'.repeat(3);
const secretFor = surfacePrefix => createHmac('sha256', signingSecret).update(surfacePrefix).digest('hex');
const request = (body, cookie, origin = 'https://xagent.aifusionlabs.app') => authorizedRequest('https://xagent.aifusionlabs.app/api/james-notepad', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
});
const getRequest = cookie => authorizedRequest('https://xagent.aifusionlabs.app/api/james-notepad?id=' + id,
    { headers: cookie ? { cookie } : {} });

async function withRecoveryFixture(run) {
    const previousEnv = { ...process.env }, previousFetch = globalThis.fetch;
    Object.assign(process.env, { AMY_ANAM_SESSION_SPINE_ENABLED: 'true', AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_SESSION_SECRET: signingSecret, AMY_ANAM_REDIS_REST_URL: 'https://redis.invalid',
        AMY_ANAM_REDIS_REST_TOKEN: 'fake', ANAM_API_KEY: 'fake', JAMES_DEMO_EMAIL_ENABLED: 'false' });
    const key = secretFor(prefix), owner = createAmyAnamBrowserSessionWithSecret(key);
    const createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { config: runtimeConfig, binding } = candidateRuntimeConfig(structuredClone(fixture.candidate));
    let session = { id, browserId: owner.session.id, clientLabel: 'xagent-james-notepad:' + id, createdAt,
        personaId: RUNTIME_CANDIDATE_ID, providerId, state: 'ACTIVE', revision: 0, stateHash: 'initial',
        config: { promptHash: sha(fixture.candidate.brain.systemPrompt), configHash: sha(JSON.stringify(fixture.candidate)),
            voiceId: fixture.candidate.voice.id, voiceName: fixture.candidate.voice.displayName },
        turns: [], intake: emptyIntake(), receipts: [], intakeBrief: { version: 2 },
        websiteClosing: { policy: 'JAMES-CLOSE-001', runtimeOwned: true }, runtimeBinding: binding };
    session = applyTurn(session, { id: 'saved-intake', role: 'user', content: 'I was rear-ended at a stoplight in Mesa.' });
    session.stateHash = sha(JSON.stringify(session));
    const db = new Map([[prefix + id, seal(session, key, prefix)]]);
    const providerCalls = [], redisWrites = [], redisReads = [];
    const cookie = cookieName + '=' + owner.token;
    const config = structuredClone(fixture.resolvedConfig);
    config.systemPrompt = runtimeConfig.systemPrompt;
    config.llmConfig = { id: binding.llmId, modelName: 'qwen/qwen3.6-27b' };
    const endedMetadata = () => ({ id: providerId, personaId: null, clientLabel: session.clientLabel,
        startTime: session.createdAt, endTime: new Date(Date.now() - 60000).toISOString(), exitStatus: 'CLOSED_BY_ENGINE',
        personaConfig: config });
    const behavior = { tokenFailure: false, transcript: 'empty', list: null, redisFailure: false };
    globalThis.fetch = async (url, options = {}) => {
        const target = String(url), body = options.body ? JSON.parse(options.body) : null;
        if (target === 'https://redis.invalid/pipeline') return Response.json([{ result: [1, 600] }]);
        if (target === 'https://redis.invalid') {
            if (behavior.redisFailure) return Response.json({ error: 'mocked outage' }, { status: 503 });
            if (body[0] === 'GET') { redisReads.push(body[1]); return Response.json({ result: db.get(body[1]) ?? null }); }
            if (body[0] === 'SET') {
                redisWrites.push(structuredClone(body));
                if (body.includes('NX') && db.has(body[1])) return Response.json({ result: null });
                db.set(body[1], body[2]); return Response.json({ result: 'OK' });
            }
            if (body[0] === 'EVAL') {
                redisWrites.push(structuredClone(body));
                const keyCount = body[2], recordKey = body[3], argumentIndex = 3 + keyCount;
                if (body[1].includes("redis.call('DEL'")) {
                    if (db.get(recordKey) !== body[argumentIndex]) return Response.json({ result: 0 });
                    db.delete(recordKey); return Response.json({ result: 1 });
                }
                const previousRevision = body[argumentIndex], value = body[argumentIndex + 1];
                const previous = db.get(recordKey);
                if (previousRevision === -1 ? previous !== undefined
                    : previous === undefined || JSON.parse(previous).revision !== previousRevision)
                    return Response.json({ result: 0 });
                db.set(recordKey, value); return Response.json({ result: 1 });
            }
            throw new Error('Unexpected mocked Redis operation ' + body[0]);
        }
        providerCalls.push({ target, method: options.method ?? 'GET', body });
        if (target === 'https://api.anam.ai/v1/personas/' + RUNTIME_CANDIDATE_ID)
            return Response.json(fixture.candidate);
        if (target === 'https://api.anam.ai/v1/auth/session-token') {
            if (behavior.tokenFailure) return Response.json({ error: 'mocked token failure' }, { status: 500 });
            return Response.json({ sessionToken: 'fake-fresh-session-token' });
        }
        if (target.startsWith('https://api.anam.ai/v1/sessions?')) {
            return Response.json(behavior.list ?? { data: [{ id: providerId, clientLabel: session.clientLabel }],
                meta: { total: 1, currentPage: 1, lastPage: 1, perPage: 100, prev: null, next: null } });
        }
        if (target === 'https://api.anam.ai/v1/sessions/' + providerId) return Response.json(endedMetadata());
        if (target === 'https://api.anam.ai/v1/sessions/' + providerId + '/transcript') {
            const messages = behavior.transcript === 'matching'
                ? session.turns.map(turn => ({ role: turn.role === 'persona' ? 'agent' : 'user', message: turn.content })) : [];
            return Response.json({ sessionId: providerId, transcriptsEnabled: true,
                endTime: endedMetadata().endTime, totalMessages: messages.length, messages });
        }
        throw new Error('Unexpected mocked provider target ' + target);
    };
    const access = installJamesSharedAccess({ browserIds: [owner.session.id] });
    const stored = () => unseal(db.get(prefix + id), id, key, RUNTIME_CANDIDATE_ID, prefix);
    const replace = next => { session = next; db.set(prefix + id, seal(session, key, prefix)); };
    const action = async (action, extra = {}, useCookie = cookie) => {
        const response = await publicPost(request({ action, id, ...extra }, useCookie));
        return { response, body: await response.json() };
    };
    try { await run({ session, stored, replace, action, cookie, owner, db, behavior, providerCalls, redisWrites, redisReads, key, access }); }
    finally {
        globalThis.fetch = previousFetch;
        for (const name of Object.keys(process.env)) if (!(name in previousEnv)) delete process.env[name];
        Object.assign(process.env, previousEnv);
    }
}

test('public browser recovery rejects unauthorized, cross-origin, and different-browser requests before provider I/O', async () => {
    await withRecoveryFixture(async h => {
        const foreign = createAmyAnamBrowserSessionWithSecret(h.key);
        for (const [cookie, origin, status, error] of [
            ['', 'https://xagent.aifusionlabs.app', 400, /authorization expired/],
            [h.cookie, 'https://foreign.invalid', 403, /origin is not allowed/],
            [cookieName + '=' + foreign.token, 'https://xagent.aifusionlabs.app', 403, /fresh session/],
        ]) {
            const response = await publicPost(request({ action: 'release-browser-session', id }, cookie, origin));
            assert.equal(response.status, status); assert.match((await response.json()).error, error);
        }
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('ended call with pending empty transcript permits restart while preserving draft notes and final-evidence boundary', async () => {
    await withRecoveryFixture(async h => {
        const before = h.stored();
        const { response, body } = await h.action('release-browser-session');
        assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.restartAllowed, true);
        const saved = h.stored();
        assert.equal(saved.state, before.state); assert.equal(saved.providerRelease, undefined);
        assert.equal(saved.closedAt, undefined); assert.equal(saved.browserRelease.source, 'PROVIDER_END');
        assert.equal(saved.browserRelease.providerId, providerId);
        assert.deepEqual(saved.turns, before.turns); assert.deepEqual(saved.intake, before.intake);
        assert.deepEqual(saved.intakeBrief, before.intakeBrief);
        assert.equal(saved.revision, before.revision + 1); assert.equal(saved.receipts.length, before.receipts.length + 1);
        assert.ok(h.providerCalls.some(call => call.target.endsWith('/transcript')));
        assert.ok(h.providerCalls.every(call => call.method === 'GET'), 'already ended calls must not be stopped again');
    });
});

test('unbound launch finds its exact ended provider and preserves LAUNCHING as a draft with separate restart proof', async () => {
    await withRecoveryFixture(async h => {
        h.replace({ ...h.session, providerId: undefined, state: 'LAUNCHING' });
        const before = h.stored(), { response, body } = await h.action('release-browser-session');
        assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.restartAllowed, true);
        const saved = h.stored();
        assert.equal(saved.state, 'LAUNCHING'); assert.equal(saved.providerId, undefined);
        assert.equal(saved.browserRelease.providerId, providerId); assert.equal(saved.providerRelease, undefined);
        assert.deepEqual(saved.turns, before.turns); assert.deepEqual(saved.intake, before.intake);
        assert.ok(h.providerCalls[0].target.includes('search=' + encodeURIComponent(saved.clientLabel)));
        assert.equal(h.providerCalls.length, 2);
    });
});

test('replaying browser release preserves the same receipt and performs no further provider I/O', async () => {
    await withRecoveryFixture(async h => {
        const first = await h.action('release-browser-session'); assert.equal(first.response.status, 200);
        const saved = h.db.get(prefix + id), calls = h.providerCalls.length, writes = h.redisWrites.length;
        const second = await h.action('release-browser-session', { providerId: 'unexpected-id-is-not-a-new-stop' });
        assert.equal(second.response.status, 200); assert.equal(second.body.restartAllowed, true);
        assert.equal(h.db.get(prefix + id), saved); assert.equal(h.providerCalls.length, calls);
        assert.equal(h.redisWrites.length, writes);
    });
});

test('recent unbound launch with no listed provider remains blocked and unchanged', async () => {
    await withRecoveryFixture(async h => {
        h.replace({ ...h.session, providerId: undefined, state: 'LAUNCHING' });
        h.behavior.list = { data: [], meta: { total: 0, currentPage: 1, lastPage: 1, perPage: 100, prev: null, next: null } };
        const before = h.db.get(prefix + id), { response, body } = await h.action('release-browser-session');
        assert.equal(response.status, 400); assert.match(body.error, /launch is still pending/);
        assert.equal(h.db.get(prefix + id), before); assert.equal(h.redisWrites.length, 0);
        assert.equal(h.providerCalls.length, 1);
    });
});

test('candidate and default servers do not expose browser recovery', async () => {
    await withRecoveryFixture(async h => {
        const surfaces = [
            { post: candidatePost, prefix: 'xagent:james:prompt-candidate:v1:', cookie: 'xagent_james_prompt_candidate', personaId: RUNTIME_CANDIDATE_ID },
            { post: createJamesServer().post, prefix: 'xagent:james:canary:v1:', cookie: 'xagent_james_canary', personaId: PERSONA_ID },
        ];
        for (const surface of surfaces) {
            const key = secretFor(surface.prefix), owner = createAmyAnamBrowserSessionWithSecret(key);
            const record = { ...h.session, browserId: owner.session.id, personaId: surface.personaId };
            h.access.bind(owner.session.id);
            h.db.set(surface.prefix + id, seal(record, key, surface.prefix));
            const response = await surface.post(request({ action: 'release-browser-session', id, sdkNeverStarted: true }, surface.cookie + '=' + owner.token));
            assert.equal(response.status, 400); assert.match((await response.json()).error, /unavailable on this surface/);
        }
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('restart from an unreleased saved call rejects before persona lookup or token mint', async () => {
    await withRecoveryFixture(async h => {
        const { response, body } = await h.action('start', { restartFrom: id });
        assert.equal(response.status, 400); assert.match(body.error, /End the saved James call/);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('released predecessor permits exactly one fresh token and preserves the previous encrypted notes', async () => {
    await withRecoveryFixture(async h => {
        assert.equal((await h.action('release-browser-session')).response.status, 200);
        const previousNotes = h.db.get(prefix + id);
        const first = await h.action('start', { restartFrom: id });
        assert.equal(first.response.status, 200, JSON.stringify(first.body));
        assert.equal(first.body.sessionToken, 'fake-fresh-session-token'); assert.notEqual(first.body.id, id);
        assert.equal(first.body.demo_email_authorized, false); assert.ok(first.body.intakeBrief);
        const second = await h.action('start', { restartFrom: id });
        assert.equal(second.response.status, 400); assert.match(second.body.error, /Another tab already restarted/);
        assert.equal(h.providerCalls.filter(call => call.target.endsWith('/auth/session-token')).length, 1);
        assert.equal(h.providerCalls.filter(call => call.target.includes('/personas/')).length, 1);
        assert.equal(h.db.get(prefix + id), previousNotes);
        assert.equal(h.db.get(prefix + 'restart:' + id), first.body.id);
    });
});

test('failed token mint clears only its own restart claim so a corrected attempt can proceed', async () => {
    await withRecoveryFixture(async h => {
        assert.equal((await h.action('release-browser-session')).response.status, 200);
        const oldNotes = h.db.get(prefix + id); h.behavior.tokenFailure = true;
        const failed = await h.action('start', { restartFrom: id });
        assert.equal(failed.response.status, 400); assert.match(failed.body.error, /Anam request failed/);
        assert.equal(h.db.has(prefix + 'restart:' + id), false);
        assert.equal(h.db.get(prefix + id), oldNotes);
        h.behavior.tokenFailure = false;
        const retry = await h.action('start', { restartFrom: id });
        assert.equal(retry.response.status, 200, JSON.stringify(retry.body));
        assert.equal(h.db.get(prefix + 'restart:' + id), retry.body.id);
        assert.equal(h.db.get(prefix + id), oldNotes);
    });
});

test('two tabs concurrently restarting the same released call can mint only one new token', async () => {
    await withRecoveryFixture(async h => {
        assert.equal((await h.action('release-browser-session')).response.status, 200);
        const previousNotes = h.db.get(prefix + id);
        const results = await Promise.all([
            h.action('start', { restartFrom: id }), h.action('start', { restartFrom: id }),
        ]);
        assert.deepEqual(results.map(result => result.response.status).sort(), [200, 400]);
        assert.match(results.find(result => result.response.status === 400).body.error, /Another tab already restarted/);
        assert.equal(h.providerCalls.filter(call => call.target.endsWith('/auth/session-token')).length, 1);
        assert.equal(h.db.get(prefix + id), previousNotes);
    });
});

test('public cancellation before SDK creation preserves a draft and reports cancellation rather than provider release', async () => {
    await withRecoveryFixture(async h => {
        h.replace({ ...h.session, providerId: undefined, state: 'LAUNCHING' });
        h.behavior.list = { data: [], meta: { total: 0, currentPage: 1, lastPage: 1, perPage: 100, prev: null, next: null } };
        const before = h.stored(), released = await h.action('release-browser-session', { sdkNeverStarted: true });
        assert.equal(released.response.status, 200, JSON.stringify(released.body));
        assert.equal(released.body.restartAllowed, true);
        assert.match(released.body.operation_notice, /cancelled before James connected/);
        const saved = h.stored();
        assert.equal(saved.state, 'LAUNCHING'); assert.equal(saved.browserRelease.source, 'BROWSER_CANCELLED_BEFORE_SDK');
        assert.equal(saved.providerRelease, undefined); assert.equal(saved.closedAt, undefined);
        assert.equal(saved.browserRelease.providerId, undefined); assert.equal(saved.browserRelease.endTime, undefined);
        assert.deepEqual(saved.turns, before.turns); assert.deepEqual(saved.intake, before.intake);
        assert.equal(h.providerCalls.length, 1); assert.ok(h.providerCalls[0].target.includes('/sessions?search='));
        const calls = h.providerCalls.length, writes = h.redisWrites.length;
        const replay = await h.action('release-browser-session', { sdkNeverStarted: true });
        assert.equal(replay.response.status, 200); assert.match(replay.body.operation_notice, /cancelled before James connected/);
        assert.equal(h.providerCalls.length, calls); assert.equal(h.redisWrites.length, writes);
        for (const action of ['bind', 'turn']) {
            const blocked = await h.action(action, { providerId, finalized: true, turn: { id: 'late', role: 'user', content: 'Late turn.' } });
            assert.equal(blocked.response.status, 400); assert.match(blocked.body.error, /has ended/);
        }
        assert.equal(h.providerCalls.length, calls);
        const restart = await h.action('start', { restartFrom: id });
        assert.equal(restart.response.status, 200, JSON.stringify(restart.body));
        assert.equal(h.db.get(prefix + 'restart:' + id), restart.body.id);
        assert.deepEqual(h.stored().turns, before.turns);
    });
});

test('forged never-started attestation on a bound call is rejected before provider I/O', async () => {
    await withRecoveryFixture(async h => {
        const before = h.db.get(prefix + id), result = await h.action('release-browser-session', { sdkNeverStarted: true });
        assert.equal(result.response.status, 400); assert.match(result.body.error, /not valid for an identified or connected/);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
        assert.equal(h.db.get(prefix + id), before);
    });
});

test('unbound cancellation attestation does not bypass an existing matching provider or incomplete list', async () => {
    await withRecoveryFixture(async h => {
        h.replace({ ...h.session, providerId: undefined, state: 'LAUNCHING' });
        const result = await h.action('release-browser-session', { sdkNeverStarted: true });
        assert.equal(result.response.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.browserRelease.source, 'PROVIDER_END');
        assert.equal(result.body.browserRelease.providerId, providerId);
        assert.doesNotMatch(result.body.operation_notice, /cancelled before James connected/);
    });
    await withRecoveryFixture(async h => {
        h.replace({ ...h.session, providerId: undefined, state: 'LAUNCHING' }); h.behavior.list = { data: [] };
        const result = await h.action('release-browser-session', { sdkNeverStarted: true });
        assert.equal(result.response.status, 400); assert.match(result.body.error, /lookup is incomplete/);
        assert.equal(h.stored().browserRelease, undefined); assert.equal(h.redisWrites.length, 0);
    });
});

test('only boolean true carries browser cancellation attestation; restored unknown launches remain blocked', async () => {
    await withRecoveryFixture(async h => {
        h.replace({ ...h.session, providerId: undefined, state: 'LAUNCHING' });
        h.behavior.list = { data: [], meta: { total: 0, currentPage: 1, lastPage: 1, perPage: 100, prev: null, next: null } };
        for (const sdkNeverStarted of [undefined, false, 'true', 1]) {
            const result = await h.action('release-browser-session', { sdkNeverStarted });
            assert.equal(result.response.status, 400); assert.match(result.body.error, /still pending/);
        }
        assert.equal(h.stored().browserRelease, undefined); assert.equal(h.redisWrites.length, 0);
    });
});

test('public GET marks a missing stored record unavailable without writes or provider requests', async () => {
    await withRecoveryFixture(async h => {
        h.db.delete(prefix + id);
        const response = await publicGet(getRequest(h.cookie)), body = await response.json();
        assert.equal(response.status, 400); assert.match(body.error, /Session is unavailable or expired/);
        assert.equal(body.recoveryUnavailable, true);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('public GET signals unavailable expired browser authorization while retaining the stored encrypted notes', async () => {
    await withRecoveryFixture(async h => {
        const original = h.db.get(prefix + id);
        const expired = createAmyAnamBrowserSessionWithSecret(h.key,
            Date.now() - AMY_ANAM_BROWSER_TTL_SECONDS * 1000 - 1000);
        const response = await publicGet(getRequest(cookieName + '=' + expired.token)), body = await response.json();
        assert.equal(response.status, 400); assert.match(body.error, /authorization expired/);
        assert.equal(body.recoveryUnavailable, true);
        assert.equal(h.db.get(prefix + id), original);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('public GET never classifies a foreign browser, storage outage, or disabled configuration as expired recovery', async () => {
    await withRecoveryFixture(async h => {
        const original = h.db.get(prefix + id), foreign = createAmyAnamBrowserSessionWithSecret(h.key);
        const response = await publicGet(getRequest(cookieName + '=' + foreign.token)), body = await response.json();
        assert.equal(response.status, 403); assert.match(body.error, /fresh session/);
        assert.equal(body.recoveryUnavailable, undefined); assert.equal(h.db.get(prefix + id), original);
        h.behavior.redisFailure = true;
        const outage = await publicGet(getRequest(h.cookie)), outageBody = await outage.json();
        assert.equal(outage.status, 400); assert.match(outageBody.error, /Session storage unavailable/);
        assert.equal(outageBody.recoveryUnavailable, undefined);
        h.behavior.redisFailure = false; process.env.AMY_ANAM_SESSION_SPINE_ENABLED = 'false';
        const disabled = await publicGet(getRequest(h.cookie)), disabledBody = await disabled.json();
        assert.equal(disabled.status, 400); assert.match(disabledBody.error, /Hosted session storage is unavailable/);
        assert.equal(disabledBody.recoveryUnavailable, undefined);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('candidate and default GET surfaces do not expose the public unavailable-recovery flag', async () => {
    await withRecoveryFixture(async h => {
        for (const surface of [
            { get: candidateGet, prefix: 'xagent:james:prompt-candidate:v1:', cookie: 'xagent_james_prompt_candidate' },
            { get: createJamesServer().get, prefix: 'xagent:james:canary:v1:', cookie: 'xagent_james_canary' },
        ]) {
            const owner = createAmyAnamBrowserSessionWithSecret(secretFor(surface.prefix));
            h.access.bind(owner.session.id);
            const missing = await surface.get(getRequest(surface.cookie + '=' + owner.token)), missingBody = await missing.json();
            assert.equal(missing.status, 400); assert.match(missingBody.error, /Session is unavailable or expired/);
            assert.equal(missingBody.recoveryUnavailable, undefined);
            const unauthorized = await surface.get(getRequest('')), unauthorizedBody = await unauthorized.json();
            assert.equal(unauthorized.status, 400); assert.match(unauthorizedBody.error, /authorization expired/);
            assert.equal(unauthorizedBody.recoveryUnavailable, undefined);
        }
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

const successorId = '22222222-2222-4333-8444-555555555555';
const nextUnbound = (h, nextId = successorId) => ({ ...h.session, id: nextId,
    clientLabel: 'xagent-james-notepad:' + nextId, providerId: undefined, state: 'LAUNCHING',
    turns: [], intake: emptyIntake(), receipts: [], revision: 0, stateHash: 'new-launch',
    browserRelease: undefined, providerRelease: undefined, closedAt: undefined });
const storeSuccessor = (h, nextId = successorId, overrides = {}) => {
    const record = { ...nextUnbound(h, nextId), ...overrides };
    h.db.set(prefix + nextId, seal(record, h.key, prefix)); return record;
};

test('public GET follows an owned restart successor without minting or starting another session', async () => {
    await withRecoveryFixture(async h => {
        h.db.set(prefix + 'restart:' + id, successorId); storeSuccessor(h);
        const oldNotes = h.db.get(prefix + id), newLaunch = h.db.get(prefix + successorId);
        const response = await publicGet(getRequest(h.cookie)), body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.id, successorId);
        assert.equal(body.previousSessionId, id); assert.equal(body.state, 'LAUNCHING');
        assert.equal(body.providerRelease, undefined); assert.equal(body.sessionToken, undefined);
        assert.equal(h.db.get(prefix + id), oldNotes); assert.equal(h.db.get(prefix + successorId), newLaunch);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('public notes-only GET retains the exact old note record instead of following its successor', async () => {
    await withRecoveryFixture(async h => {
        h.replace({ ...h.session, providerId: undefined, state: 'LAUNCHING' });
        h.db.set(prefix + 'restart:' + id, successorId); storeSuccessor(h);
        const response = await publicGet(authorizedRequest('https://xagent.aifusionlabs.app/api/james-notepad?id=' + id + '&notesOnly=1',
            { headers: { cookie: h.cookie } })), body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.id, id);
        assert.equal(body.previousSessionId, undefined); assert.equal(body.acceptedVisitorTurns, 1);
        assert.deepEqual(h.redisReads, [prefix + id]);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('foreign, missing, and malformed successors fail without authorizing a fresh launch', async () => {
    for (const mode of ['foreign', 'missing', 'malformed']) await withRecoveryFixture(async h => {
        h.db.set(prefix + 'restart:' + id, mode === 'malformed' ? 'invalid-reference' : successorId);
        if (mode === 'foreign') storeSuccessor(h, successorId, { browserId: 'another-browser' });
        const oldNotes = h.db.get(prefix + id), response = await publicGet(getRequest(h.cookie)), body = await response.json();
        assert.equal(response.status, 400); assert.match(body.error, mode === 'foreign' ? /different browser/
            : mode === 'missing' ? /Restarted James session is unavailable/ : /restart reference is invalid/);
        assert.equal(body.recoveryUnavailable, undefined);
        assert.equal(h.db.get(prefix + id), oldNotes); assert.equal(h.providerCalls.length, 0);
        assert.equal(h.redisWrites.length, 0);
    });
});

test('successor cycles and chains exceeding eight records remain bounded errors', async () => {
    await withRecoveryFixture(async h => {
        h.db.set(prefix + 'restart:' + id, successorId); storeSuccessor(h);
        h.db.set(prefix + 'restart:' + successorId, id);
        const response = await publicGet(getRequest(h.cookie)), body = await response.json();
        assert.equal(response.status, 400); assert.match(body.error, /contain a cycle/);
        assert.equal(h.redisReads.length, 4); assert.equal(body.recoveryUnavailable, undefined);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
    await withRecoveryFixture(async h => {
        const ids = [id, ...Array.from({ length: 8 }, (_, index) =>
            '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'))];
        for (let index = 1; index < ids.length; index++) {
            storeSuccessor(h, ids[index]); h.db.set(prefix + 'restart:' + ids[index - 1], ids[index]);
        }
        const response = await publicGet(getRequest(h.cookie)), body = await response.json();
        assert.equal(response.status, 400); assert.match(body.error, /too long/);
        assert.equal(h.redisReads.length, 16); assert.equal(body.recoveryUnavailable, undefined);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
    await withRecoveryFixture(async h => {
        const ids = [id, ...Array.from({ length: 7 }, (_, index) =>
            '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'))];
        for (let index = 1; index < ids.length; index++) {
            storeSuccessor(h, ids[index]); h.db.set(prefix + 'restart:' + ids[index - 1], ids[index]);
        }
        const response = await publicGet(getRequest(h.cookie)), body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.id, ids.at(-1));
        assert.equal(body.previousSessionId, id); assert.equal(h.redisReads.length, 16);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('nil public successor claim preserves the old unbound state without provider I/O or writes', async () => {
    await withRecoveryFixture(async h => {
        h.replace({ ...h.session, providerId: undefined, state: 'LAUNCHING' });
        const before = h.db.get(prefix + id), response = await publicGet(getRequest(h.cookie)), body = await response.json();
        assert.equal(response.status, 200); assert.equal(body.id, id); assert.equal(body.state, 'LAUNCHING');
        assert.equal(body.previousSessionId, undefined); assert.equal(h.db.get(prefix + id), before);
        assert.deepEqual(h.redisReads, [prefix + id, prefix + 'restart:' + id]);
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});

test('candidate and default GET do not follow restart claims or perform their extra Redis lookup', async () => {
    await withRecoveryFixture(async h => {
        for (const surface of [
            { get: candidateGet, prefix: 'xagent:james:prompt-candidate:v1:', cookie: 'xagent_james_prompt_candidate', personaId: RUNTIME_CANDIDATE_ID },
            { get: createJamesServer().get, prefix: 'xagent:james:canary:v1:', cookie: 'xagent_james_canary', personaId: PERSONA_ID },
        ]) {
            const key = secretFor(surface.prefix), owner = createAmyAnamBrowserSessionWithSecret(key);
            h.access.bind(owner.session.id);
            const record = { ...h.session, browserId: owner.session.id, personaId: surface.personaId, providerId: undefined, state: 'LAUNCHING' };
            h.db.set(surface.prefix + id, seal(record, key, surface.prefix));
            h.db.set(surface.prefix + 'restart:' + id, successorId); h.redisReads.length = 0;
            const response = await surface.get(getRequest(surface.cookie + '=' + owner.token)), body = await response.json();
            assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.id, id);
            assert.equal(body.previousSessionId, undefined); assert.deepEqual(h.redisReads, [surface.prefix + id]);
        }
        assert.equal(h.providerCalls.length, 0); assert.equal(h.redisWrites.length, 0);
    });
});
