import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvanRefusedCloseRecovery, EVAN_REFUSED_CLOSE_RECOVERY_MESSAGE } from '../lib/anam/evan-refused-close-recovery.ts';

const farewell = 'Thank you for speaking with Mullins Moving. Take care.';
test('default and explicit listening pauses never schedule a repeated question', () => {
    for (const options of [undefined, { allowSilenceRecovery: false }]) {
        const h = setup();
        h.recovery.rejectClose(options);
        h.recovery.rejectClose({ allowSilenceRecovery: true });
        assert.equal(h.scheduled.length, 0, 'a retry cannot convert listening into silence recovery');
        assert.equal(h.recovery.observePersona(farewell), true);
        assert.equal(h.interrupts(), 1);
        h.scheduled.at(-1).callback();
        assert.deepEqual(h.spoken, [EVAN_REFUSED_CLOSE_RECOVERY_MESSAGE]);
    }
});
function setup(overrides = {}) {
    const scheduled = [], cancelled = [], spoken = [];
    let interrupts = 0, errors = 0, allowed = true;
    const recovery = createEvanRefusedCloseRecovery({
        onInterrupt: () => { interrupts++; },
        onRecover: speech => { spoken.push(speech); },
        canRecover: () => allowed,
        onError: () => { errors++; },
        schedule: (callback, ms) => { const handle = { callback, ms }; scheduled.push(handle); return handle; },
        cancelTimer: handle => cancelled.push(handle),
        ...overrides,
    });
    return { recovery, scheduled, cancelled, spoken, allow: value => { allowed = value; },
        interrupts: () => interrupts, errors: () => errors };
}

test('only an armed exact prescribed farewell triggers one 300ms recovery', () => {
    const h = setup();
    assert.equal(h.recovery.observePersona(farewell), false);
    h.recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(h.recovery.observePersona('Thank you for speaking with Mullins'), false);
    assert.equal(h.recovery.observePersona('Thank you for speaking with Mullins Moving.'), true);
    assert.equal(h.interrupts(), 1);
    assert.equal(h.scheduled.at(-1).ms, 300);
    assert.deepEqual(h.spoken, []);
    h.scheduled.at(-1).callback();
    assert.deepEqual(h.spoken, [EVAN_REFUSED_CLOSE_RECOVERY_MESSAGE]);
    h.recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(h.recovery.observePersona(farewell), false);
    assert.equal(h.interrupts(), 1);
});

test('unrelated thanks, historical/quoted text, other agents, and nonexact prefixes do not trigger', () => {
    const h = setup(); h.recovery.rejectClose({ allowSilenceRecovery: true });
    for (const text of ['Thanks for confirming. Is there anything else?', 'Thank you for speaking with Amy.',
        'He said: Thank you for speaking with Mullins Moving.', '"Thank you for speaking with Mullins Moving."',
        'Thank you for speaking with Mullins Moving today.', 'Thank you for speaking with Mullins Moving?',
        'Thank you for speaking with Mullins Moving.\n'.replace('Thank you', 'Thanks')]) {
        assert.equal(h.recovery.observePersona(text), false, text);
    }
    assert.equal(h.interrupts(), 0);
    assert.equal(h.recovery.observePersona(farewell), true);
});

test('new user speech or an accepted close cancels before or after detection', () => {
    for (const phase of ['before', 'after']) {
        const h = setup(); h.recovery.rejectClose({ allowSilenceRecovery: true });
        if (phase === 'after') assert.equal(h.recovery.observePersona(farewell), true);
        h.recovery.cancel();
        if (phase === 'after') {
            assert.ok(h.cancelled.includes(h.scheduled.at(-1)));
            h.scheduled.forEach(timer => timer.callback()); // Stale callbacks cannot speak.
        }
        assert.equal(h.recovery.observePersona(farewell), false);
        assert.deepEqual(h.spoken, []);
        if (phase === 'after') {
            h.recovery.rejectClose({ allowSilenceRecovery: true });
            assert.equal(h.recovery.observePersona(farewell), false, 'cancellation does not reset the session budget');
        }
    }
});

test('dispose invalidates pending callbacks and prevents future refusal arming', () => {
    const h = setup(); h.recovery.rejectClose({ allowSilenceRecovery: true }); h.recovery.observePersona(farewell);
    h.recovery.dispose(); h.scheduled.forEach(timer => timer.callback()); h.recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(h.recovery.observePersona(farewell), false);
    assert.deepEqual(h.spoken, []);
});

test('VAD and lifecycle guard are checked both before interrupt and before delayed speech', () => {
    const blocked = setup(); blocked.recovery.rejectClose({ allowSilenceRecovery: true }); blocked.allow(false);
    assert.equal(blocked.recovery.observePersona(farewell), false);
    assert.equal(blocked.interrupts(), 0);
    const later = setup(); later.recovery.rejectClose({ allowSilenceRecovery: true }); later.recovery.observePersona(farewell);
    later.allow(false); later.scheduled.at(-1).callback();
    assert.equal(later.interrupts(), 1);
    assert.deepEqual(later.spoken, []);
});

test('reentrant cancellation during interrupt does not schedule speech', () => {
    let recovery;
    const h = setup({ onInterrupt: () => recovery.cancel() });
    recovery = h.recovery; recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(recovery.observePersona(farewell), true);
    assert.equal(h.scheduled.filter(timer => timer.ms === 300).length, 0);
});

test('interrupt and speech failures are reported once without retry or closure', async () => {
    const failedInterrupt = setup({ onInterrupt: () => { throw new Error('test interruption failure'); } });
    failedInterrupt.recovery.rejectClose({ allowSilenceRecovery: true }); failedInterrupt.recovery.observePersona(farewell);
    assert.equal(failedInterrupt.errors(), 1);
    assert.equal(failedInterrupt.scheduled.filter(timer => timer.ms === 300).length, 0);
    failedInterrupt.recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(failedInterrupt.recovery.observePersona(farewell), false);
    const failedSpeech = setup({ onRecover: async () => { throw new Error('test speech failure'); } });
    failedSpeech.recovery.rejectClose({ allowSilenceRecovery: true }); failedSpeech.recovery.observePersona(farewell); failedSpeech.scheduled.at(-1).callback();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(failedSpeech.errors(), 1);
});

test('a silent refused close recovers after 12 seconds without an interrupt', () => {
    const h = setup(); h.recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(h.scheduled.length, 1);
    assert.equal(h.scheduled[0].ms, 12_000);
    h.scheduled[0].callback();
    assert.deepEqual(h.spoken, [EVAN_REFUSED_CLOSE_RECOVERY_MESSAGE]);
    assert.equal(h.interrupts(), 0);
});

test('repeated refusals never reset the silence deadline or retry after recovery', () => {
    const h = setup(); h.recovery.rejectClose({ allowSilenceRecovery: true }); const first = h.scheduled[0];
    h.recovery.rejectClose({ allowSilenceRecovery: true }); h.recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(h.scheduled.length, 1);
    assert.equal(h.cancelled.length, 0);
    first.callback(); h.recovery.rejectClose({ allowSilenceRecovery: true }); first.callback();
    assert.equal(h.scheduled.length, 1);
    assert.equal(h.spoken.length, 1);
});

test('ordinary nonempty output cancels silence while preserving the exact-farewell guard', () => {
    const h = setup(); h.recovery.rejectClose({ allowSilenceRecovery: true }); const silence = h.scheduled[0];
    h.recovery.observePersona('');
    assert.equal(h.cancelled.length, 0);
    h.recovery.observePersona('Thanks, the number is confirmed.');
    assert.deepEqual(h.cancelled, [silence]);
    silence.callback(); h.recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(h.scheduled.length, 1, 'a repeated refusal must not rearm silence after speech');
    assert.deepEqual(h.spoken, []);
    assert.equal(h.recovery.observePersona(farewell), true);
    h.scheduled.at(-1).callback();
    assert.equal(h.interrupts(), 1);
    assert.equal(h.spoken.length, 1);
});

test('new user/accepted close/disposal and lifecycle guard prevent silence recovery', () => {
    for (const action of ['cancel', 'dispose', 'vad']) {
        const h = setup(); h.recovery.rejectClose({ allowSilenceRecovery: true });
        if (action === 'vad') h.allow(false); else h.recovery[action]();
        h.scheduled[0].callback();
        assert.deepEqual(h.spoken, [], action);
        assert.equal(h.interrupts(), 0, action);
    }
});

test('silence and farewell recovery share one session-wide budget in both directions', () => {
    const silent = setup(); silent.recovery.rejectClose({ allowSilenceRecovery: true }); silent.scheduled[0].callback();
    silent.recovery.cancel(); silent.recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(silent.recovery.observePersona(farewell), false);
    assert.equal(silent.interrupts(), 0);
    assert.equal(silent.spoken.length, 1);
    const spoken = setup(); spoken.recovery.rejectClose({ allowSilenceRecovery: true }); spoken.recovery.observePersona(farewell);
    spoken.scheduled.at(-1).callback(); spoken.recovery.cancel(); spoken.recovery.rejectClose({ allowSilenceRecovery: true });
    spoken.scheduled.forEach(timer => timer.callback());
    assert.equal(spoken.spoken.length, 1);
});

test('silence delay cannot be configured below 12 seconds', () => {
    const h = setup({ silenceDelayMs: 25 }); h.recovery.rejectClose({ allowSilenceRecovery: true });
    assert.equal(h.scheduled[0].ms, 12_000);
});
