import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvanExplicitCloseFallback } from '../lib/anam/evan-explicit-close-fallback.ts';

function fixture() {
    let nextId = 1;
    let allowed = true;
    const timers = new Map();
    const calls = [];
    const fallback = createEvanExplicitCloseFallback({
        canClose: () => allowed,
        onFallback: () => calls.push('close'),
        schedule(callback, delay) { const id = nextId++; timers.set(id, { callback, delay }); return id; },
        cancelTimer(id) { timers.delete(id); },
    });
    return { fallback, calls, timers, setAllowed(value) { allowed = value; }, fire() {
        const [id, entry] = timers.entries().next().value;
        timers.delete(id);
        entry.callback();
        return entry.delay;
    } };
}

test('one verified explicit close receives a bounded fallback if no tool arrives', () => {
    const f = fixture();
    f.fallback.observeExplicitClose();
    assert.equal(f.fire(), 8_000);
    assert.deepEqual(f.calls, ['close']);
    f.fallback.observeExplicitClose();
    assert.equal(f.timers.size, 0);
});

test('a tool call, visitor continuation, or stale authorization cancels the fallback', () => {
    const tool = fixture();
    tool.fallback.observeExplicitClose();
    tool.fallback.cancel();
    assert.equal(tool.timers.size, 0);
    const resumed = fixture();
    resumed.fallback.observeExplicitClose();
    resumed.setAllowed(false);
    resumed.fire();
    assert.deepEqual(resumed.calls, []);
    const disposed = fixture();
    disposed.fallback.observeExplicitClose();
    disposed.fallback.dispose();
    assert.equal(disposed.timers.size, 0);
});
