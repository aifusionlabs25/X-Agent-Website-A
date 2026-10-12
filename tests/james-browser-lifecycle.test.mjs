import test from 'node:test';
import assert from 'node:assert/strict';
import { JamesBrowserAttemptGate, browserStartAllowed, echoAdvisory } from '../lib/james-canary/browser-lifecycle.ts';

test('restored notes have no browser attempt and never start a provider by themselves', () => {
    const gate = new JamesBrowserAttemptGate();
    const saved = { state: 'ACTIVE', notes: ['Previous visitor detail'] };
    const before = structuredClone(saved);
    assert.equal(gate.current, null);
    assert.equal(browserStartAllowed({ restoring: true, busy: false, hasBrowserAttempt: false }), false);
    assert.equal(browserStartAllowed({ restoring: false, busy: false, hasBrowserAttempt: false }), true);
    assert.deepEqual(saved, before);
});

test('double-click start gets one attempt, and settled connected attempts keep the slot', async () => {
    const gate = new JamesBrowserAttemptGate();
    const attempt = gate.begin();
    assert.ok(attempt);
    assert.equal(gate.begin(), null);
    assert.equal(gate.current, attempt);
    assert.equal(gate.isCurrent(attempt), true);
    gate.settle(attempt);
    await attempt.settled;
    assert.equal(attempt.finished, true);
    assert.equal(gate.isCurrent(attempt), true);
    assert.equal(gate.begin(), null, 'a connected SDK start finishing does not disconnect it');
    gate.cancel();
    assert.equal(gate.current, null);
    assert.equal(gate.isCurrent(attempt), false);
    assert.ok(gate.begin());
});

test('cancel invalidates callbacks immediately but blocks a replacement until cleanup settles', async () => {
    const gate = new JamesBrowserAttemptGate();
    const attempt = gate.begin();
    let waitingFinished = false;
    const waiting = attempt.settled.then(() => { waitingFinished = true; });
    gate.cancel(attempt);
    assert.equal(gate.isCurrent(attempt), false);
    assert.equal(gate.current, attempt);
    assert.equal(gate.begin(), null);
    await Promise.resolve();
    assert.equal(waitingFinished, false);
    gate.settle(attempt);
    await waiting;
    assert.equal(waitingFinished, true);
    assert.equal(gate.current, null);
    assert.ok(gate.begin());
});

test('a failed attempt releases its slot only after cancellation and SDK cleanup', async () => {
    const gate = new JamesBrowserAttemptGate();
    const attempt = gate.begin();
    const operations = [];
    try {
        throw new Error('Synthetic SDK connection failure');
    } catch {
        gate.cancel(attempt);
        operations.push('cancelled');
        assert.equal(gate.begin(), null);
        operations.push('sdk-stopped');
    } finally {
        gate.settle(attempt);
    }
    await attempt.settled;
    assert.deepEqual(operations, ['cancelled', 'sdk-stopped']);
    assert.ok(gate.begin());
});

test('late SDK readiness after an early stop is stopped again before another start is allowed', async () => {
    const gate = new JamesBrowserAttemptGate();
    const attempt = gate.begin();
    let releaseReady;
    const readiness = new Promise(resolve => { releaseReady = resolve; });
    const sdk = {
        connected: false,
        starts: 0,
        stops: 0,
        async stopStreaming() {
            this.stops++;
            this.connected = false; // Before readiness this is deliberately a no-op.
        },
        async streamToVideoElement() {
            this.starts++;
            await readiness;
            this.connected = true;
            if (!gate.isCurrent(attempt)) await this.stopStreaming();
        },
    };
    const running = (async () => {
        try {
            await sdk.streamToVideoElement();
        } finally {
            if (!gate.isCurrent(attempt) && sdk.connected) await sdk.stopStreaming();
            gate.settle(attempt);
        }
    })();
    gate.cancel(attempt);
    await sdk.stopStreaming();
    assert.equal(sdk.stops, 1);
    assert.equal(gate.begin(), null, 'early stop cannot release an unresolved provider start');
    releaseReady();
    await running;
    await attempt.settled;
    assert.equal(sdk.starts, 1);
    assert.equal(sdk.stops, 2, 'the late-created connection must be stopped too');
    assert.equal(sdk.connected, false);
    assert.ok(gate.begin());
});

test('stale readiness, cancellation, and repeated settlement cannot replace or clear a new attempt', async () => {
    const gate = new JamesBrowserAttemptGate();
    const old = gate.begin();
    gate.cancel(old);
    gate.settle(old);
    await old.settled;
    const next = gate.begin();
    assert.ok(next);
    assert.equal(next.serial, old.serial + 1);
    assert.equal(gate.isCurrent(old), false);
    gate.settle(old);
    gate.cancel(old);
    assert.equal(gate.current, next);
    assert.equal(gate.isCurrent(next), true);
    assert.equal(gate.begin(), null);
    gate.settle(next);
    gate.settle(next);
    await next.settled;
    assert.equal(gate.current, next);
    gate.cancel(next);
    assert.equal(gate.current, null);
});

test('restoration, busy work, and a live or pending attempt independently block Start', () => {
    for (const patch of [{ restoring: true }, { busy: true }, { hasBrowserAttempt: true }]) {
        assert.equal(browserStartAllowed({ restoring: false, busy: false, hasBrowserAttempt: false, ...patch }), false);
    }
    assert.equal(browserStartAllowed({ restoring: false, busy: false, hasBrowserAttempt: false }), true);
});

test('only recognizable echo warnings become a public advisory without exposing warning details', () => {
    const expected = 'Possible audio feedback. Try headphones or lower speaker volume.';
    for (const warning of ['Echo detected', 'Possible MICROPHONE\n feedback detected', 'Audio feedback', 'Acoustic feedback', 'Feedback detected in input']) {
        assert.equal(echoAdvisory(warning), expected);
    }
    for (const warning of [null, undefined, false, 1, {}, '', 'Reduced video quality due to network congestion', 'Please send feedback', 'Echolocation unavailable']) {
        assert.equal(echoAdvisory(warning), null);
    }
});
