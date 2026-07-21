import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvanFarewellCloseCoordinator } from '../lib/anam/evan-session-close.ts';

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
    assert.equal(coordinator.completeFarewell(), true);
    assert.equal(coordinator.completeFarewell(), false);
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
    assert.equal(coordinator.completeFarewell(), false);
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
