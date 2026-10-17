import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvanFarewellCloseCoordinator } from '../lib/anam/evan-session-close.ts';

const FAREWELL = 'Thank you for speaking with Mullins Moving. Take care.';

test('content-free diagnostics distinguish completed farewell from fallback without blocking closure', () => {
    for (const mode of ['farewell_complete', 'fallback_timeout']) {
        const timers = scheduler();
        let stops = 0;
        const reasons = [];
        const coordinator = createEvanFarewellCloseCoordinator({
            stopStreaming: () => { stops++; }, schedule: timers.schedule, cancel: timers.cancel,
            onStopReason: reason => { reasons.push(reason); throw new Error('Diagnostic failed'); },
        });
        coordinator.arm();
        if (mode === 'farewell_complete') coordinator.completeFarewell(FAREWELL);
        timers.runDelay(mode === 'farewell_complete' ? 1_000 : 12_000);
        assert.deepEqual(reasons, [mode]);
        assert.equal(stops, 1);
    }
});

function scheduler() {
    let nextId = 1;
    const pending = new Map();
    return {
        schedule(callback, delay) {
            const id = nextId++;
            pending.set(id, { callback, delay });
            return id;
        },
        cancel(id) {
            pending.delete(id);
        },
        runDelay(delay) {
            const match = [...pending].find(([, task]) => task.delay === delay);
            assert.ok(match, `missing timer for ${delay}ms`);
            pending.delete(match[0]);
            match[1].callback();
        },
        count() {
            return pending.size;
        },
        callbackFor(delay) {
            const match = [...pending.values()].find(task => task.delay === delay);
            assert.ok(match, `missing timer for ${delay}ms`);
            return match.callback;
        },
    };
}

test('Evan closes once only after the completed farewell and audio-drain grace', async () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createEvanFarewellCloseCoordinator({
        stopStreaming: async () => { stops += 1; },
        schedule: timers.schedule,
        cancel: timers.cancel,
        fallbackMs: 12_000,
        audioDrainMs: 2_500,
    });

    assert.equal(coordinator.arm(), true);
    assert.equal(coordinator.arm(), false);
    assert.equal(stops, 0);
    assert.equal(coordinator.completeFarewell(FAREWELL), true);
    assert.equal(coordinator.completeFarewell(FAREWELL), false);
    assert.equal(coordinator.isArmed(), true, 'audio drain remains a pending close');
    assert.equal(coordinator.arm(), false, 'a duplicate tool must not rearm during audio drain');
    assert.equal(stops, 0);
    timers.runDelay(2_500);
    await Promise.resolve();
    assert.equal(stops, 1);
    assert.equal(timers.count(), 0);
});

test('Evan uses one bounded fallback close when no farewell completion arrives', async () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createEvanFarewellCloseCoordinator({
        stopStreaming: () => { stops += 1; },
        schedule: timers.schedule,
        cancel: timers.cancel,
        fallbackMs: 12_000,
    });
    assert.equal(coordinator.arm(), true);
    timers.runDelay(12_000);
    await Promise.resolve();
    assert.equal(stops, 1);
    assert.equal(coordinator.completeFarewell(FAREWELL), false);
    assert.equal(coordinator.cancelPending(), false);
    assert.equal(coordinator.arm(), false);
});

test('disposing the coordinator cancels every pending close', () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createEvanFarewellCloseCoordinator({
        stopStreaming: () => { stops += 1; },
        schedule: timers.schedule,
        cancel: timers.cancel,
    });
    coordinator.arm();
    coordinator.dispose();
    assert.equal(coordinator.isArmed(), false);
    assert.equal(timers.count(), 0);
    assert.equal(stops, 0);
});

test('normal questions and interrupted farewells cannot start the audio-drain shutdown', () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createEvanFarewellCloseCoordinator({
        stopStreaming: () => { stops += 1; }, schedule: timers.schedule, cancel: timers.cancel,
    });
    coordinator.arm();
    for (const text of ['Anything else to add?', 'What else would you like to share?', 'Thanks, I have added the piano.', '']) {
        assert.equal(coordinator.completeFarewell(text), false, text);
    }
    assert.equal(coordinator.completeFarewell(FAREWELL, true), false);
    assert.equal(timers.count(), 1);
    assert.ok(timers.callbackFor(12_000));
    assert.equal(stops, 0);
    coordinator.cancelPending();
    assert.equal(timers.count(), 0);
});

test('new user speech can cancel either close timer and permit a later fresh farewell', () => {
    for (const phase of ['awaiting-farewell', 'audio-drain']) {
        const timers = scheduler();
        let stops = 0;
        const coordinator = createEvanFarewellCloseCoordinator({
            stopStreaming: () => { stops += 1; }, schedule: timers.schedule, cancel: timers.cancel,
        });
        assert.equal(coordinator.arm(), true);
        if (phase === 'audio-drain') assert.equal(coordinator.completeFarewell(FAREWELL), true);
        const oldQueuedCallback = timers.callbackFor(phase === 'audio-drain' ? 1_000 : 12_000);
        assert.equal(coordinator.cancelPending(), true, phase);
        assert.equal(coordinator.cancelPending(), false, phase);
        assert.equal(coordinator.isArmed(), false);
        assert.equal(timers.count(), 0);
        assert.equal(coordinator.completeFarewell(FAREWELL), false, 'a cancelled farewell cannot restart its timer');
        oldQueuedCallback();
        assert.equal(stops, 0, 'even an already queued cancelled callback cannot stop the session');
        assert.equal(coordinator.arm(), true);
        oldQueuedCallback();
        assert.equal(stops, 0, 'an old timer cannot stop a newly armed close generation');
        assert.equal(coordinator.completeFarewell(FAREWELL), true);
        oldQueuedCallback();
        assert.equal(stops, 0);
        timers.runDelay(1_000);
        assert.equal(stops, 1);
        assert.equal(timers.count(), 0);
    }
});

test('a queued fallback cannot cut short the verified farewell audio-drain window', () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createEvanFarewellCloseCoordinator({
        stopStreaming: () => { stops += 1; }, schedule: timers.schedule, cancel: timers.cancel,
    });
    coordinator.arm();
    const oldFallback = timers.callbackFor(12_000);
    coordinator.completeFarewell(FAREWELL);
    oldFallback();
    assert.equal(stops, 0);
    assert.equal(timers.count(), 1);
    timers.runDelay(1_000);
    oldFallback();
    assert.equal(stops, 1);
});

test('disposing during either pending phase invalidates already queued close callbacks', () => {
    for (const drain of [false, true]) {
        const timers = scheduler();
        let stops = 0;
        const coordinator = createEvanFarewellCloseCoordinator({
            stopStreaming: () => { stops += 1; }, schedule: timers.schedule, cancel: timers.cancel,
        });
        coordinator.arm();
        if (drain) coordinator.completeFarewell(FAREWELL);
        const queued = timers.callbackFor(drain ? 1_000 : 12_000);
        coordinator.dispose();
        queued();
        assert.equal(stops, 0);
        assert.equal(timers.count(), 0);
        assert.equal(coordinator.arm(), false);
        assert.equal(coordinator.cancelPending(), false);
    }
});

test('synchronous and asynchronous stop failures are reported once without orphan timers', async () => {
    for (const asynchronous of [false, true]) {
        const timers = scheduler();
        let attempts = 0;
        let errors = 0;
        const coordinator = createEvanFarewellCloseCoordinator({
            stopStreaming: () => {
                attempts += 1;
                if (asynchronous) return Promise.reject(new Error('stop failed'));
                throw new Error('stop failed');
            },
            onStopError: () => { errors += 1; }, schedule: timers.schedule, cancel: timers.cancel,
        });
        coordinator.arm();
        const queued = timers.callbackFor(12_000);
        timers.runDelay(12_000);
        await Promise.resolve();
        queued();
        assert.equal(attempts, 1);
        assert.equal(errors, 1);
        assert.equal(timers.count(), 0);
        assert.equal(coordinator.arm(), false);
    }
});
