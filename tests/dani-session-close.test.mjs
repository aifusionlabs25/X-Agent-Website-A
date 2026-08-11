import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDaniFarewellCloseCoordinator } from '../lib/anam/dani-session-close.ts';

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

test('Dani closes once after the completed farewell and audio-drain grace', async () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createDaniFarewellCloseCoordinator({
        stopStreaming: async () => { stops += 1; },
        schedule: timers.schedule,
        cancel: timers.cancel,
        fallbackMs: 12_000,
        audioDrainMs: 2_500,
    });

    assert.equal(coordinator.arm(), true);
    assert.equal(coordinator.arm(), false);
    assert.equal(coordinator.completeFarewell(), true);
    assert.equal(coordinator.completeFarewell(), false);
    assert.equal(stops, 0);
    timers.runDelay(2_500);
    await Promise.resolve();
    assert.equal(stops, 1);
    assert.equal(timers.count(), 0);
});

test('Dani uses one bounded fallback close when no farewell completes', async () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createDaniFarewellCloseCoordinator({
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

test('disposing Dani close cancels every pending timer', () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createDaniFarewellCloseCoordinator({
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

test('Dani player registers the dedicated close tool and preserves robust finalization', async () => {
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const registration = player.indexOf("registerToolCallHandler(\n                        'end_dani_session'");
    const streaming = player.indexOf("anamClient.streamToVideoElement('persona-video')");
    assert.ok(registration > 0 && registration < streaming);
    assert.match(player, /daniCloseCoordinator = createDaniFarewellCloseCoordinator\(\{[\s\S]{0,180}stopStreaming: handleDaniRequestedEnd/);
    assert.match(player, /status: armed \? 'farewell_required' : 'farewell_already_armed'/);
    assert.match(player, /Do not speak again\. The farewell close is already armed/);
    assert.match(player, /requestedCloseReason = 'user_requested_end'/);
    assert.match(player, /completeOnce\('user_requested_end'\)/);
});
