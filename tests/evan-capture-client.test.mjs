import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvanCaptureClient } from '../lib/anam/evan-capture-client.ts';
import { validateEvanCapture } from '../lib/anam/evan-capture.ts';

const user = content => ({ role: 'user', content });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const reply = (turns, revision, facts = []) => ({ capture: validateEvanCapture({ facts }, turns, revision) });
function setup(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const states = [], requests = [];
    const client = createEvanCaptureClient({ delayMs: 400, onState: state => states.push(state), request(turns, revision, signal) {
        return new Promise((resolve, reject) => requests.push({ turns, revision, signal, resolve, reject }));
    } });
    t.after(() => client.dispose());
    return { client, states, requests, async advance() { t.mock.timers.tick(400); await flush(); } };
}

test('capture debounces completed snapshots and ignores identical updates', async t => {
    const f = setup(t), turns = [user('I have a desk.')];
    f.client.update(turns);
    f.client.update(structuredClone(turns));
    assert.equal(f.states.length, 1);
    assert.equal(f.states[0].status, 'updating');
    assert.equal(f.requests.length, 0);
    await f.advance();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].revision, 1);
    f.requests[0].resolve(reply(turns, 1));
    await flush();
    assert.equal(f.states.at(-1).status, 'ready');
    f.client.update(structuredClone(turns));
    await f.advance();
    assert.equal(f.requests.length, 1);
});

test('only one request is active; intermediate snapshots coalesce and stale responses never render', async t => {
    const f = setup(t), first = [user('Mesa')], second = [user('Mesa'), user('Gilbert')], third = [...second, user('Actually Queen Creek.')];
    f.client.update(first); await f.advance();
    f.client.update(second); f.client.update(third); await f.advance();
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve(reply(first, 1)); await flush();
    assert.equal(f.states.some(state => state.status === 'ready'), false);
    await f.advance();
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests[1].turns, third);
    assert.equal(f.requests[1].revision, 3);
    f.requests[1].resolve(reply(third, 3)); await flush();
    assert.equal(f.states.at(-1).record.revision, 3);
    assert.equal(f.states.at(-1).record.sourceTurnCount, 3);
});

test('queued input is copied so caller mutation cannot alter the requested evidence', async t => {
    const f = setup(t), turns = [user('I have a credenza.')];
    f.client.update(turns);
    turns[0].content = 'I do not have a credenza.';
    turns.push(user('Injected later'));
    await f.advance();
    assert.deepEqual(f.requests[0].turns, [user('I have a credenza.')]);
});

test('failure preserves the last good capture, marks degraded, and does not automatically retry', async t => {
    const f = setup(t), first = [user('Mesa')], second = [...first, user('Gilbert')];
    f.client.update(first); await f.advance();
    f.requests[0].resolve(reply(first, 1)); await flush();
    const good = f.states.at(-1).record;
    f.client.update(second); await f.advance();
    f.requests[1].reject(new Error('Provider unavailable')); await flush();
    assert.equal(f.states.at(-1).status, 'degraded');
    assert.equal(f.states.at(-1).record, good);
    await f.advance(); await f.advance();
    assert.equal(f.requests.length, 2);
    f.client.update([...second, user('Next month.')]); await f.advance();
    assert.equal(f.requests.length, 3);
});

test('revision mismatch, source mismatch and ungrounded partial output cannot replace a good capture', async t => {
    const f = setup(t), first = [user('I have a desk.')];
    f.client.update(first); await f.advance();
    f.requests[0].resolve(reply(first, 1)); await flush();
    const good = f.states.at(-1).record;
    const invalidReplies = [
        request => reply(request.turns, request.revision - 1),
        request => ({ capture: { ...reply(request.turns, request.revision).capture, sourceTurnCount: 99 } }),
        request => ({ capture: { ...reply(request.turns, request.revision).capture, facts: [{ category: 'inventory', value: 'piano', status: 'asserted',
            evidence: [{ turn: 0, quote: 'I have a desk.' }], location: 'unspecified', scope: '', quantity: '', route: null }] } }),
        () => ({ capture: null }),
    ];
    for (let i = 0; i < invalidReplies.length; i++) {
        f.client.update([...first, user(`Correction ${i}`)]); await f.advance();
        const request = f.requests.at(-1);
        request.resolve(invalidReplies[i](request)); await flush();
        assert.equal(f.states.at(-1).status, 'degraded');
        assert.equal(f.states.at(-1).record, good);
    }
});

test('stale failure does not replace a newer updating state with degraded', async t => {
    const f = setup(t);
    f.client.update([user('Mesa')]); await f.advance();
    f.client.update([user('Mesa'), user('Gilbert')]);
    f.requests[0].reject(new Error('Old request failed')); await flush();
    assert.equal(f.states.at(-1).status, 'updating');
    assert.equal(f.states.some(state => state.status === 'degraded'), false);
    await f.advance();
    assert.equal(f.requests.length, 2);
});

test('dispose aborts the active request and blocks late state and queued work', async t => {
    const f = setup(t), first = [user('Mesa')];
    f.client.update(first); await f.advance();
    f.client.update([...first, user('Gilbert')]);
    const before = f.states.length;
    f.client.dispose();
    assert.equal(f.requests[0].signal.aborted, true);
    f.requests[0].resolve(reply(first, 1)); await flush(); await f.advance();
    f.client.update([user('Should not run')]); await f.advance();
    assert.equal(f.states.length, before);
    assert.equal(f.requests.length, 1);
});

test('dispose before debounce prevents any request', async t => {
    const f = setup(t);
    f.client.update([user('Mesa')]); f.client.dispose(); await f.advance();
    assert.equal(f.requests.length, 0);
});

test('over-budget snapshots fail closed rather than silently dropping early corrections', async t => {
    const f = setup(t), first = [user('Mesa')];
    f.client.update(first); await f.advance();
    f.requests[0].resolve(reply(first, 1)); await flush();
    const good = f.states.at(-1).record;
    for (const oversized of [Array.from({ length: 401 }, () => user('x')), [user('x'.repeat(2001))],
        Array.from({ length: 41 }, () => user('x'.repeat(2000)))]) {
        f.client.update(oversized); await f.advance();
        assert.equal(f.states.at(-1).status, 'degraded');
        assert.equal(f.states.at(-1).record, good);
        assert.equal(f.requests.length, 1);
    }
});

test('over-budget revision aborts in-flight work and rejects its late result', async t => {
    const f = setup(t), first = [user('Mesa')];
    f.client.update(first); await f.advance();
    f.client.update([user('x'.repeat(2001))]);
    assert.equal(f.requests[0].signal.aborted, true);
    assert.equal(f.states.at(-1).status, 'degraded');
    f.requests[0].resolve(reply(first, 1)); await flush(); await f.advance();
    assert.equal(f.states.at(-1).record, null);
    assert.equal(f.states.some(state => state.status === 'ready'), false);
    assert.equal(f.requests.length, 1);
});
