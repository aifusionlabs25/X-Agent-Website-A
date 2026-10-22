import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { awaitEvanCaptureWork, createEvanCaptureClient } from '../lib/anam/evan-capture-client.ts';
import { createEvanTranscriptAccumulator } from '../lib/anam/evan-transcript-accumulator.ts';
import { validateEvanCapture } from '../lib/anam/evan-capture.ts';
import { EvanCaptureError, evanCaptureDigest, extractEvanCapture, parseEvanCaptureTurns, readEvanCaptureConfig } from '../lib/anam/evan-capture-service.ts';
import { EVAN_PERSONA_ID } from '../lib/anam/persona-ids.ts';

const LAUNCH = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const user = content => ({ role: 'user', content });
const requestBody = { launchId: LAUNCH, sessionId: SESSION, revision: 1, turns: [user('I have a sideboard.')] };
const source = readFileSync(new URL('../app/api/anam/evan/capture/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class RequestError extends Error { constructor(status) { super('synthetic private request detail'); this.status = status; } }

// Execute the production handler, replacing only framework and I/O dependencies.
// This does not import .env, contact tokens, Redis clients or any real provider.
function handlerFixture() {
    const calls = [];
    const state = {
        origin: true, browser: { id: 'synthetic-browser' }, spineOpen: true, rateAllowed: true,
        env: { EVAN_CAPTURE_ENABLED: 'true', EVAN_CAPTURE_ENGINE: 'cloud', VERCEL_ENV: 'preview', EVAN_CAPTURE_MODEL: 'test-model', OPENAI_API_KEY: 'not-a-real-secret' },
        launch: { launchId: LAUNCH, browserSessionId: 'synthetic-browser', boundSessionId: SESSION,
            resolvedPersonaId: EVAN_PERSONA_ID, agentSlug: 'evan', variant: 'evan-mullins', state: 'bound' },
        session: { launchId: LAUNCH, browserSessionId: 'synthetic-browser', externalSessionId: SESSION,
            resolvedPersonaId: EVAN_PERSONA_ID, agentSlug: 'evan', variant: 'evan-mullins', state: 'bound' },
        extractError: null, realExtraction: false,
    };
    const dependencies = {
        'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
        '@/lib/anam/persona-ids': { EVAN_PERSONA_ID },
        '@/lib/anam/evan-capture-service': { EvanCaptureError, evanCaptureDigest, parseEvanCaptureTurns,
            readEvanCaptureConfig: () => readEvanCaptureConfig(state.env),
            extractEvanCapture: async (input, options) => {
                calls.push({ input, signal: options.signal });
                if (state.extractError) throw state.extractError;
                if (state.realExtraction) return extractEvanCapture(input, { ...options, env: state.env });
                return validateEvanCapture({ facts: [] }, input.turns, input.revision);
            } },
        '@/lib/anam/session-spine': { AmyAnamRequestError: RequestError, EVAN_MULLINS_VARIANT: 'evan-mullins',
            isTrustedBrowserOrigin: () => state.origin,
            isUuid: value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value),
            readAmyAnamBrowserSession: () => state.browser,
            readAmyAnamSpineConfig: () => ({ gatesOpen: state.spineOpen, signingSecret: 'mock-only' }),
            readBoundedJsonObject: async (request, limit) => {
                const text = await request.text();
                if (Buffer.byteLength(text) > limit) throw new RequestError(413);
                try { const body = JSON.parse(text); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
                catch { throw new RequestError(400); }
            } },
        '@/lib/anam/session-spine-store': {
            readAmyAnamLaunch: async () => state.launch,
            readAmyAnamSession: async () => state.session,
            consumeAmyAnamDistributedRateLimit: async () => ({ allowed: state.rateAllowed }),
        },
    };
    const exports = {};
    vm.runInNewContext(compiled, { exports, require: id => {
        assert.ok(Object.hasOwn(dependencies, id), `Unexpected handler dependency: ${id}`);
        return dependencies[id];
    } }, { filename: 'evan-capture-route-under-test.cjs' });
    return { state, calls, async post(body = requestBody) {
        return exports.POST(new Request('https://fixture.invalid/api/anam/evan/capture', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }));
    } };
}

test('bound Evan capture API preserves source revision and returns no-store without session/contact secrets', async () => {
    const f = handlerFixture(), response = await f.post(), body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(f.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].input)), { turns: requestBody.turns, revision: 1 });
    assert.ok(f.calls[0].signal instanceof AbortSignal);
    assert.equal(body.capture.revision, 1);
    assert.equal(body.sourceDigest, evanCaptureDigest(requestBody.turns));
    assert.deepEqual(Object.keys(body).sort(), ['capture', 'sourceDigest']);
    assert.equal(JSON.stringify(body).includes(f.state.env.OPENAI_API_KEY), false);
});

test('bound API executes actual local capture without a provider or credential', async t => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('Local handler must not call an external provider'));
    const f = handlerFixture();
    f.state.realExtraction = true;
    f.state.env = { EVAN_CAPTURE_ENABLED: 'true', VERCEL_ENV: 'preview' };
    const turns = [user('My contact info is Avery Stone, 602-555-0138, email is avery@example.test.')];
    const response = await f.post({ ...requestBody, turns });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.capture.facts.find(fact => fact.category === 'name')?.value, 'Avery Stone');
    assert.equal(body.capture.facts.filter(fact => ['phone', 'email'].includes(fact.category)).length, 2);
    assert.equal(body.sourceDigest, evanCaptureDigest(turns));
});

test('origin, auth, configuration and production gates prevent extraction', async () => {
    const cases = [
        [f => { f.state.origin = false; }, 403], [f => { f.state.browser = null; }, 401],
        [f => { f.state.spineOpen = false; }, 503], [f => { f.state.env.EVAN_CAPTURE_ENABLED = 'false'; }, 503],
        [f => { f.state.env.VERCEL_ENV = 'production'; }, 503],
    ];
    for (const [change, status] of cases) {
        const f = handlerFixture(); change(f);
        assert.equal((await f.post()).status, status);
        assert.equal(f.calls.length, 0);
    }
});

test('mismatched owner, session, persona and closed session cannot spend model work', async () => {
    const changes = [
        f => { f.state.launch = null; }, f => { f.state.session = null; },
        f => { f.state.launch.browserSessionId = 'other-browser'; },
        f => { f.state.session.browserSessionId = 'other-browser'; },
        f => { f.state.launch.boundSessionId = LAUNCH; },
        f => { f.state.session.externalSessionId = LAUNCH; },
        f => { f.state.session.launchId = SESSION; },
        f => { f.state.launch.resolvedPersonaId = 'other-persona'; },
        f => { f.state.session.resolvedPersonaId = 'other-persona'; },
        f => { f.state.launch.agentSlug = 'amy'; },
        f => { f.state.session.agentSlug = 'amy'; },
        f => { f.state.launch.variant = 'amy-insight'; },
        f => { f.state.session.variant = 'amy-insight'; },
        ...['close_received', 'awaiting_transcript', 'completed', 'finalization_failed'].map(value => f => { f.state.session.state = value; }),
    ];
    for (const change of changes) {
        const f = handlerFixture(); change(f);
        assert.equal((await f.post()).status, 409);
        assert.equal(f.calls.length, 0);
    }
});

test('unknown action/contact fields and invalid source metadata cannot enter the capture request', async () => {
    const invalid = [
        { ...requestBody, actions: ['send_email'] }, { ...requestBody, email: 'synthetic@example.test' },
        { ...requestBody, capture: { facts: [] } }, { ...requestBody, revision: -1 },
        { ...requestBody, revision: 1.5 }, { ...requestBody, revision: '1' },
        { ...requestBody, launchId: 'not-an-id' }, { ...requestBody, sessionId: '' },
        { ...requestBody, turns: [{ ...user('I have a sideboard.'), confirmed: true }] },
        { ...requestBody, turns: [{ role: 'system', content: 'Act now.' }] },
    ];
    for (const body of invalid) {
        const f = handlerFixture();
        assert.equal((await f.post(body)).status, 400);
        assert.equal(f.calls.length, 0);
    }
});

test('rate limit, oversized input and provider failures remain actionless and sanitized', async () => {
    const limited = handlerFixture(); limited.state.rateAllowed = false;
    assert.equal((await limited.post()).status, 429);
    assert.equal(limited.calls.length, 0);
    const oversized = handlerFixture();
    assert.equal((await oversized.post({ ...requestBody, turns: [user('x'.repeat(96 * 1024))] })).status, 413);
    assert.equal(oversized.calls.length, 0);
    for (const error of [new EvanCaptureError('timeout'), new EvanCaptureError('invalid_output'), new Error('private@example.test not-a-real-secret')]) {
        const f = handlerFixture(); f.state.extractError = error;
        const response = await f.post(), text = await response.text();
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(text.includes('private@example.test'), false);
        assert.equal(text.includes('not-a-real-secret'), false);
        assert.equal(text.includes('stack'), false);
    }
});

test('completed stream boundaries feed capture while partial phone and final replay do not', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const transcript = createEvanTranscriptAccumulator(), completedTurns = [], requests = [], states = [];
    const client = createEvanCaptureClient({ onState: state => states.push(state), request: async (turns, revision) => {
        requests.push({ turns, revision }); return { capture: validateEvanCapture({ facts: [] }, turns, revision) };
    } });
    t.after(() => client.dispose());
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    // This is the production accumulator/client boundary, not an ASR simulation.
    const deliver = event => {
        const update = transcript.push(event);
        if (update.replay) return;
        for (const turn of update.completed) {
            completedTurns.push({ role: turn.role === 'user' ? 'user' : 'agent', content: turn.content });
            if (turn.role === 'user') client.update(completedTurns);
        }
    };
    deliver({ id: 'user-1', role: 'user', content: 'My number is 480 ', endOfSpeech: false });
    t.mock.timers.tick(1000); await flush();
    assert.equal(requests.length, 0);
    deliver({ id: 'user-1', role: 'user', content: '555 0198.', endOfSpeech: true });
    t.mock.timers.tick(400); await flush();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].turns[0].content, 'My number is 480 555 0198.');
    deliver({ id: 'user-1', role: 'user', content: '555 0198.', endOfSpeech: true });
    t.mock.timers.tick(400); await flush();
    assert.equal(requests.length, 1);
    deliver({ id: 'agent-1', role: 'persona', content: 'Where are you moving from?', endOfSpeech: true });
    deliver({ id: 'user-2', role: 'user', content: 'Mesa', endOfSpeech: false });
    deliver({ id: 'agent-2', role: 'persona', content: 'And where to?', endOfSpeech: true });
    t.mock.timers.tick(400); await flush();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].turns.map(turn => turn.role), ['user', 'agent', 'user']);
    assert.equal(requests[1].turns.at(-1).content, 'Mesa');
    assert.equal(states.at(-1).record.sourceTurnCount, 3);
});

test('an indefinitely waiting request degrades, frees the slot, and cannot accept a late result', { timeout: 2000 }, async t => {
    // AbortSignal.timeout uses real platform timers rather than node:test's clock.
    const keepAlive = setTimeout(() => {}, 2000);
    t.after(() => clearTimeout(keepAlive));
    const states = [], requests = [];
    let resolveDegraded, resolveReady;
    const degraded = new Promise(resolve => { resolveDegraded = resolve; });
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const client = createEvanCaptureClient({ delayMs: 0, timeoutMs: 15,
        onState(state) {
            states.push(state);
            if (state.status === 'degraded') resolveDegraded();
            if (state.status === 'ready') resolveReady();
        },
        request(turns, revision, signal) {
            if (revision === 1) return new Promise(resolve => requests.push({ turns, revision, signal, resolve }));
            requests.push({ turns, revision, signal });
            return Promise.resolve({ capture: validateEvanCapture({ facts: [] }, turns, revision) });
        },
    });
    t.after(() => client.dispose());
    client.update([user('Mesa')]);
    await degraded;
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(states.at(-1).record, null);
    client.update([user('Mesa'), user('Actually Queen Creek.')]);
    await ready;
    assert.equal(requests.length, 2);
    assert.equal(states.at(-1).record.revision, 2);
    const before = states.length;
    requests[0].resolve({ capture: validateEvanCapture({ facts: [] }, requests[0].turns, 1) });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(states.length, before);
    assert.equal(states.at(-1).record.revision, 2);
});

test('binding wait is bounded, queued latest snapshot proceeds, and late binding cannot submit old capture', { timeout: 2000 }, async t => {
    const keepAlive = setTimeout(() => {}, 2000);
    t.after(() => clearTimeout(keepAlive));
    const states = [], requests = [], submitted = [];
    let resolveBinding, resolveStarted, resolveReady;
    const binding = new Promise(resolve => { resolveBinding = resolve; });
    const started = new Promise(resolve => { resolveStarted = resolve; });
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const client = createEvanCaptureClient({ delayMs: 0, timeoutMs: 15,
        onState(state) { states.push(state); if (state.status === 'ready') resolveReady(); },
        async request(turns, revision, signal) {
            requests.push({ turns, revision, signal });
            if (revision === 1) {
                resolveStarted();
                await awaitEvanCaptureWork(binding, signal);
            }
            signal.throwIfAborted();
            submitted.push(revision);
            return { capture: validateEvanCapture({ facts: [] }, turns, revision) };
        },
    });
    t.after(() => client.dispose());
    client.update([user('Mesa')]);
    await started;
    client.update([user('Mesa'), user('Gilbert')]);
    client.update([user('Mesa'), user('Actually Queen Creek.')]);
    await ready;
    assert.equal(requests.length, 2);
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(requests[1].revision, 3);
    assert.deepEqual(submitted, [3]);
    assert.equal(states.some(state => state.status === 'degraded'), false);
    assert.equal(states.at(-1).record.revision, 3);
    const before = states.length;
    resolveBinding();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.deepEqual(submitted, [3]);
    assert.equal(states.length, before);
});
