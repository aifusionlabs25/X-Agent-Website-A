import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseJamesBrowserSession } from '../lib/james-canary/browser-recovery.ts';

const id = '11111111-2222-4333-8444-555555555555';
const providerId = '4056f1c6-bd11-4682-bcc8-fddcbc8fa22e';
const otherProviderId = '4056f1c6-bd11-4682-bcc8-fddcbc8fa22f';
const personaId = '016e2c66-166b-43bd-8ebf-70b56c46575c';
const createdAt = '2026-10-12T17:00:00.000Z';
const nowMs = Date.parse('2026-10-12T17:05:00.000Z');
const base = () => ({ id, clientLabel: 'xagent-james-notepad:' + id, createdAt, personaId,
    providerId, state: 'ACTIVE', turns: [{ id: 'saved', role: 'user', content: 'My saved intake detail.' }],
    intake: { facts: ['preserved'] }, receipts: [{ revision: 2 }] });
const active = (session = base()) => ({ id: providerId, clientLabel: session.clientLabel,
    personaId: null, startTime: createdAt, endTime: null, exitStatus: null });
const ended = (session = base()) => ({ ...active(session), endTime: '2026-10-12T17:04:00.000Z', exitStatus: 'CLOSED_BY_ENGINE' });
const completeList = data => ({ data, meta: { total: data.length, currentPage: 1, lastPage: 1,
    perPage: 100, prev: null, next: null } });
const unbound = () => ({ ...base(), providerId: undefined, state: 'LAUNCHING' });

test('bound active session stops once and waits for authoritative asynchronous end', async () => {
    const session = base(), before = structuredClone(session), requests = [], sleeps = [];
    let reads = 0;
    const release = await releaseJamesBrowserSession(session, {
        nowMs,
        request: async (...args) => { requests.push(args); return {}; },
        metadata: async () => ++reads < 3 ? active(session) : ended(session),
        sleep: async ms => { sleeps.push(ms); },
    });
    assert.deepEqual(requests, [['/sessions/' + providerId + '/stop', {}]]);
    assert.deepEqual(sleeps, [250]);
    assert.deepEqual(release, { source: 'PROVIDER_END', providerId,
        endTime: ended().endTime, verifiedAt: new Date(nowMs).toISOString() });
    assert.deepEqual(session, before, 'call release never changes notes, receipts, or session state');
    assert.equal(release.providerRelease, undefined, 'call release is not final transcript evidence');
});

test('an already ended provider needs no stop request', async () => {
    const release = await releaseJamesBrowserSession(base(), { nowMs,
        request: async () => { throw new Error('Unexpected request'); }, metadata: async () => ended() });
    assert.equal(release.source, 'PROVIDER_END');
});

test('accepted stop and 404 errors never certify a provider that stays active', async () => {
    for (const stopError of [null, Object.assign(new Error('Not found'), { status: 404 })]) {
        let stops = 0, reads = 0;
        await assert.rejects(releaseJamesBrowserSession(base(), { nowMs,
            request: async () => { stops++; if (stopError) throw stopError; return {}; },
            metadata: async () => { reads++; return active(); }, sleep: async () => {},
        }), /release is not yet verified/);
        assert.equal(stops, 1); assert.equal(reads, 5);
    }
});

test('404 stop can be followed by separately verified concurrent provider end', async () => {
    let reads = 0;
    const release = await releaseJamesBrowserSession(base(), { nowMs,
        request: async () => { throw Object.assign(new Error('Not found'), { status: 404 }); },
        metadata: async () => ++reads === 1 ? active() : ended(), sleep: async () => {} });
    assert.equal(release.endTime, ended().endTime);
});

test('exit status alone and unavailable polling metadata are not release evidence', async () => {
    let reads = 0;
    await assert.rejects(releaseJamesBrowserSession(base(), { nowMs, request: async () => ({}),
        metadata: async () => { if (++reads > 1) throw new Error('Pending metadata'); return { ...active(), exitStatus: 'CLOSED_BY_ENGINE' }; },
        sleep: async () => {},
    }), /release is not yet verified/);
});

test('conflicting, malformed, foreign, and raced provider hints cannot authorize a stop', async () => {
    for (const [session, hint, metadata] of [
        [base(), otherProviderId, ended()],
        [unbound(), 'not-a-uuid', ended()],
        [unbound(), providerId, { ...ended(), clientLabel: 'foreign' }],
        [unbound(), providerId, { ...ended(), id: otherProviderId }],
        [unbound(), providerId, { ...ended(), personaId: otherProviderId }],
        [unbound(), providerId, { ...ended(), startTime: '2026-10-12T16:58:59.000Z' }],
        [unbound(), providerId, { ...ended(), startTime: '2026-10-12T18:02:00.000Z' }],
        [unbound(), providerId, { ...ended(), startTime: 'invalid' }],
    ]) {
        let requests = 0;
        await assert.rejects(releaseJamesBrowserSession(session, { providerIdHint: hint, nowMs,
            request: async () => { requests++; throw new Error('Unexpected request'); }, metadata: async () => metadata,
        }), /invalid|conflicts|does not match/);
        assert.equal(requests, 0);
    }
});

test('polling rechecks provider identity before accepting a later end', async () => {
    let reads = 0;
    await assert.rejects(releaseJamesBrowserSession(base(), { nowMs, request: async () => ({}),
        metadata: async () => ++reads === 1 ? active() : { ...ended(), clientLabel: 'different launch' },
        sleep: async () => {},
    }), /does not match/);
});

test('missing provider ID resolves only the unique exact client label in a complete list', async () => {
    const session = unbound(), requests = [];
    const release = await releaseJamesBrowserSession(session, { nowMs,
        request: async path => { requests.push(path); return completeList([
            { id: otherProviderId, clientLabel: session.clientLabel + '-other' },
            { id: providerId, clientLabel: session.clientLabel },
        ]); }, metadata: async id => { assert.equal(id, providerId); return ended(session); },
    });
    assert.deepEqual(requests, ['/sessions?search=' + encodeURIComponent(session.clientLabel) + '&page=1&perPage=100']);
    assert.equal(release.providerId, providerId);
});

test('ambiguous, truncated, malformed, and missing list metadata fail closed', async () => {
    const session = unbound(), exact = { id: providerId, clientLabel: session.clientLabel };
    const full = completeList([exact]);
    for (const payload of [
        completeList([exact, { ...exact, id: otherProviderId }]),
        { data: [] },
        { ...full, meta: { ...full.meta, total: 101, lastPage: 2, next: 2 } },
        { ...full, meta: { ...full.meta, total: 2 } },
        { ...full, meta: { ...full.meta, prev: undefined } },
        { ...full, meta: { ...full.meta, perPage: 10 } },
        completeList([{ ...exact, id: 'malformed' }]),
        completeList([null]),
    ]) {
        await assert.rejects(releaseJamesBrowserSession(session, { nowMs,
            request: async () => payload, metadata: async () => { throw new Error('Unexpected metadata request'); },
        }), /More than one|lookup is incomplete|lookup is invalid/);
    }
});

test('only an expired unstarted LAUNCHING record may restart without provider release', async () => {
    const session = unbound(), before = structuredClone(session);
    const oldNow = Date.parse(createdAt) + 61 * 60 * 1000;
    const dependencies = { request: async () => completeList([]),
        metadata: async () => { throw new Error('Unexpected metadata request'); } };
    assert.deepEqual(await releaseJamesBrowserSession(session, { ...dependencies, nowMs: oldNow }), {
        source: 'EXPIRED_UNSTARTED_LAUNCH', verifiedAt: new Date(oldNow).toISOString(),
    });
    assert.deepEqual(session, before);
    await assert.rejects(releaseJamesBrowserSession(session, { ...dependencies, nowMs: oldNow - 1 }), /still pending/);
    await assert.rejects(releaseJamesBrowserSession({ ...session, state: 'ACTIVE' }, { ...dependencies, nowMs: oldNow }), /still pending/);
});

test('invalid or impossible provider end times never authorize another call', async () => {
    for (const endTime of ['', 'invalid', '2026-10-12T16:59:59.000Z', '2026-10-12T17:06:01.000Z']) {
        await assert.rejects(releaseJamesBrowserSession(base(), { nowMs,
            request: async () => { throw new Error('Unexpected stop'); }, metadata: async () => ({ ...ended(), endTime }),
        }), /end time is not valid/);
    }
});

test('own-browser cancellation before SDK creation records a separate release after a complete empty lookup', async () => {
    const session = unbound(), before = structuredClone(session), paths = [];
    const release = await releaseJamesBrowserSession(session, { nowMs, sdkNeverStarted: true,
        request: async path => { paths.push(path); return completeList([]); },
        metadata: async () => { throw new Error('Unexpected metadata request'); },
    });
    assert.deepEqual(release, { source: 'BROWSER_CANCELLED_BEFORE_SDK', verifiedAt: new Date(nowMs).toISOString() });
    assert.equal(paths.length, 1); assert.ok(paths[0].startsWith('/sessions?search='));
    assert.deepEqual(session, before); assert.equal(release.endTime, undefined);
    assert.equal(release.providerId, undefined); assert.equal(release.providerRelease, undefined);
});

test('never-started browser attestation cannot bypass identified calls or incomplete provider lookup', async () => {
    for (const [session, hint] of [[base(), undefined], [{ ...unbound(), state: 'ACTIVE' }, undefined], [unbound(), providerId]]) {
        let requests = 0;
        await assert.rejects(releaseJamesBrowserSession(session, { nowMs, sdkNeverStarted: true, providerIdHint: hint,
            request: async () => { requests++; return completeList([]); }, metadata: async () => ended(),
        }), /not valid for an identified or connected/);
        assert.equal(requests, 0);
    }
    await assert.rejects(releaseJamesBrowserSession(unbound(), { nowMs, sdkNeverStarted: true,
        request: async () => ({ data: [] }), metadata: async () => ended(),
    }), /lookup is incomplete/);
});

test('a provider found despite browser cancellation attestation still requires authoritative stop and end', async () => {
    const session = unbound(), paths = []; let reads = 0;
    const release = await releaseJamesBrowserSession(session, { nowMs, sdkNeverStarted: true,
        request: async path => { paths.push(path); return path.includes('?')
            ? completeList([{ id: providerId, clientLabel: session.clientLabel }]) : {}; },
        metadata: async () => ++reads === 1 ? active(session) : ended(session), sleep: async () => {},
    });
    assert.equal(release.source, 'PROVIDER_END'); assert.equal(release.endTime, ended().endTime);
    assert.equal(paths.filter(path => path.endsWith('/stop')).length, 1);
});
