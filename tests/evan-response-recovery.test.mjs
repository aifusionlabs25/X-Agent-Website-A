import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createEvanResponseRecovery,
    EVAN_RESPONSE_RECOVERY_MESSAGE,
    isEvanRecoverableAnswer,
} from '../lib/anam/evan-response-recovery.ts';

function fixture(options = {}) {
    let nextId = 1;
    const timers = new Map();
    const spoken = [];
    const coordinator = createEvanResponseRecovery({
        onRecover: speech => spoken.push(speech), canRecover: () => true,
        schedule(callback, delay) { const id = nextId++; timers.set(id, { callback, delay }); return id; },
        cancel(id) { timers.delete(id); },
        ...options,
    });
    return {
        coordinator, spoken, timers,
        fire() {
            const next = timers.entries().next().value;
            assert.ok(next, 'Expected one recovery timer');
            assert.equal(next[1].delay, 12_000);
            timers.delete(next[0]);
            next[1].callback();
        },
    };
}
const skip = id => ({ toolCallId: id, toolName: 'skip_turn' });
function skippedAnswer(f, id = 'turn-1') {
    f.coordinator.userSpeechStarted();
    f.coordinator.userSpeechEnded();
    f.coordinator.userTurnCompleted('After two in the afternoon works best.', '', id);
    f.coordinator.toolStarted(skip(`skip-${id}`));
}

test('completed facts and explicit confirmations qualify, waiting and backchannels do not', () => {
    for (const text of ['Mesa', 'My number is six oh two, five five five, one two one two.', 'After two in the afternoon.', 'Yes, Tuesday works.']) assert.equal(isEvanRecoverableAnswer(text), true, text);
    for (const text of ['Sure.', 'Okay', 'Thanks', 'Okay, thanks.', 'Yeah yeah', 'um', 'Wait a moment', 'Let me finish', 'Hold on please', 'Give me a few seconds.', 'I need a minute.', 'I will be right back.', 'That is all, goodbye.', 'Nothing else', '']) assert.equal(isEvanRecoverableAnswer(text), false, text);
    assert.equal(isEvanRecoverableAnswer('Yeah.', 'Did I get that right?'), true);
    assert.equal(isEvanRecoverableAnswer('No.', 'Is that correct?'), true);
    assert.equal(isEvanRecoverableAnswer('Okay.', 'What city are you moving to?'), false);
});

test('only an unexpected skip starts the 12-second watchdog', () => {
    const f = fixture();
    f.coordinator.userTurnCompleted('Moving from Mesa to Phoenix.', '', 'turn-1');
    assert.equal(f.timers.size, 0);
    f.coordinator.toolStarted(skip('skip-1'));
    assert.equal(f.timers.size, 1);
    f.fire();
    assert.deepEqual(f.spoken, [EVAN_RESPONSE_RECOVERY_MESSAGE]);
});

test('invalid or undersized delay overrides cannot produce an immediate interruption', () => {
    for (const delayMs of [0, -1, NaN, Infinity, -Infinity]) {
        const f = fixture({ delayMs });
        skippedAnswer(f);
        assert.equal([...f.timers.values()][0].delay, 12_000);
    }
    const overflow = fixture({ delayMs: Number.MAX_VALUE });
    skippedAnswer(overflow);
    assert.equal([...overflow.timers.values()][0].delay, 60_000);
});

test('at most one recovery per session even across duplicate skips and new turns', () => {
    const f = fixture();
    skippedAnswer(f);
    f.coordinator.toolStarted(skip('skip-turn-1'));
    f.coordinator.toolStarted(skip('second-skip'));
    assert.equal(f.timers.size, 1);
    f.fire();
    skippedAnswer(f, 'turn-2');
    assert.equal(f.timers.size, 0);
    assert.equal(f.spoken.length, 1);
});

test('new user speech cancels recovery and cannot revive the old turn', () => {
    const f = fixture();
    skippedAnswer(f);
    f.coordinator.userSpeechStarted();
    f.coordinator.userSpeechEnded();
    f.coordinator.toolStarted(skip('late-skip'));
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.spoken, []);
});

test('final transcription does not override active VAD speech', () => {
    const f = fixture();
    f.coordinator.userSpeechStarted();
    f.coordinator.userTurnCompleted('Mesa', '', 'turn-1');
    f.coordinator.toolStarted(skip('skip-1'));
    assert.equal(f.timers.size, 0);
    f.coordinator.userSpeechEnded();
    assert.equal(f.timers.size, 1);
});

test('stale VAD end and old correlated skip do not act on a new user turn', () => {
    const f = fixture();
    f.coordinator.userSpeechStarted('new-user-turn');
    f.coordinator.userTurnCompleted('Mesa', '', 'turn-2');
    f.coordinator.userSpeechEnded('old-user-turn');
    f.coordinator.toolStarted({ ...skip('old-skip'), userActionCorrelationId: 'old-user-turn' });
    assert.equal(f.timers.size, 0);
    f.coordinator.userSpeechEnded('new-user-turn');
    assert.equal(f.timers.size, 0);
    f.coordinator.toolStarted({ ...skip('new-skip'), userActionCorrelationId: 'new-user-turn' });
    assert.equal(f.timers.size, 1);
});

test('agent response and useful tool work cancel the old watchdog permanently', () => {
    for (const action of ['agent', 'tool']) {
        const f = fixture();
        skippedAnswer(f);
        if (action === 'agent') f.coordinator.agentResponseStarted();
        else {
            f.coordinator.toolStarted({ toolCallId: 'map', toolName: 'show_move_planner' });
            f.coordinator.toolFinished({ toolCallId: 'map', toolName: 'show_move_planner' });
        }
        f.coordinator.toolStarted(skip('late-skip'));
        assert.equal(f.timers.size, 0, action);
    }
});

test('active tools suppress recovery on a later turn and completion does not suddenly speak', () => {
    const f = fixture();
    const tool = { toolCallId: 'map', toolName: 'show_move_planner' };
    f.coordinator.toolStarted(tool);
    skippedAnswer(f);
    assert.equal(f.timers.size, 0);
    f.coordinator.toolFinished(tool);
    assert.equal(f.timers.size, 0);
});

test('explicit wait, backchannels, closing, and duplicate final turns never rearm', () => {
    for (const text of ['Wait please', 'Okay', 'Goodbye']) {
        const f = fixture();
        f.coordinator.userTurnCompleted(text, '', 'turn-1');
        f.coordinator.toolStarted(skip('skip-1'));
        assert.equal(f.timers.size, 0, text);
    }
    const f = fixture();
    skippedAnswer(f);
    f.coordinator.agentResponseStarted();
    f.coordinator.userTurnCompleted('After two in the afternoon works best.', '', 'turn-1');
    f.coordinator.toolStarted(skip('skip-2'));
    assert.equal(f.timers.size, 0);
});

test('only committed close and dispose irreversibly cancel all recovery', () => {
    for (const action of ['close', 'dispose']) {
        const f = fixture();
        skippedAnswer(f);
        f.coordinator[action]();
        skippedAnswer(f, 'turn-2');
        assert.equal(f.timers.size, 0, action);
        assert.deepEqual(f.spoken, []);
    }
});

test('a rejected or cancelled end tool does not permanently disable later answer recovery', () => {
    const f = fixture();
    skippedAnswer(f);
    const endTool = { toolCallId: 'close-1', toolName: 'end_mullins_session' };
    f.coordinator.toolStarted(endTool);
    assert.equal(f.timers.size, 0);
    f.coordinator.toolFinished(endTool);
    assert.equal(f.timers.size, 0);
    skippedAnswer(f, 'turn-2');
    assert.equal(f.timers.size, 1);
    f.fire();
    assert.deepEqual(f.spoken, [EVAN_RESPONSE_RECOVERY_MESSAGE]);
});

test('an active end-tool request suppresses old recovery but not a later completed answer', () => {
    const f = fixture();
    const endTool = { toolCallId: 'close-1', toolName: 'end_mullins_session' };
    f.coordinator.toolStarted(endTool);
    skippedAnswer(f, 'during-tool');
    assert.equal(f.timers.size, 0);
    f.coordinator.toolFinished(endTool);
    assert.equal(f.timers.size, 0);
    skippedAnswer(f, 'continued-turn');
    f.fire();
    assert.deepEqual(f.spoken, [EVAN_RESPONSE_RECOVERY_MESSAGE]);
});

test('hidden, disconnected, or callback-failed recovery never retries', async () => {
    const hidden = fixture({ canRecover: () => false });
    skippedAnswer(hidden);
    hidden.fire();
    skippedAnswer(hidden, 'turn-2');
    assert.equal(hidden.timers.size, 0);
    assert.equal(hidden.spoken.length, 0);
    let errors = 0;
    const failed = fixture({ onRecover: async () => { throw new Error('unavailable'); }, onError: () => errors++ });
    skippedAnswer(failed);
    failed.fire();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(errors, 1);
    skippedAnswer(failed, 'turn-2');
    assert.equal(failed.timers.size, 0);
});
