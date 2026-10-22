import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvanTranscriptAccumulator } from '../lib/anam/evan-transcript-accumulator.ts';

const user = (id, content, endOfSpeech = false) => ({ id, role: 'user', content, endOfSpeech });
const persona = (id, content, endOfSpeech = false, interrupted = false) => ({ id, role: 'persona', content, endOfSpeech, interrupted });

test('user answer without a final completes once when persona begins', () => {
    const accumulator = createEvanTranscriptAccumulator();
    assert.deepEqual(accumulator.push(user('u1', 'Phoenix to Mesa.')).completed, []);
    const update = accumulator.push(persona('p1', 'Thanks.'));
    assert.deepEqual(update.completed, [{ id: 'u1', role: 'user', content: 'Phoenix to Mesa.', interrupted: false, completion: 'message-boundary' }]);
    assert.equal(update.pending.content, 'Thanks.');
    assert.equal(update.pending.role, 'persona');
});

test('two different user IDs complete separately instead of concatenating', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'Phoenix to Mesa.'));
    const update = accumulator.push(user('u2', 'Actually, Gilbert.', true));
    assert.deepEqual(update.completed.map(turn => [turn.id, turn.content, turn.completion]), [
        ['u1', 'Phoenix to Mesa.', 'message-boundary'],
        ['u2', 'Actually, Gilbert.', 'explicit-final'],
    ]);
    assert.equal(update.pending, null);
});

test('different persona IDs also complete independently', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(persona('p1', 'Where are you moving from?'));
    const update = accumulator.push(persona('p2', 'Which city?', true));
    assert.deepEqual(update.completed.map(turn => turn.content), ['Where are you moving from?', 'Which city?']);
});

test('a role change is a boundary even if the provider reuses the raw ID', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('same', 'Mesa.'));
    const update = accumulator.push(persona('same', 'Thank you.', true));
    assert.deepEqual(update.completed.map(turn => turn.role), ['user', 'persona']);
});

test('user delta chunks and cumulative user snapshots are both supported', () => {
    const deltas = createEvanTranscriptAccumulator();
    deltas.push(user('u1', 'Change timing to this '));
    assert.equal(deltas.push(user('u1', 'week.', true)).completed[0].content, 'Change timing to this week.');
    const snapshots = createEvanTranscriptAccumulator();
    snapshots.push(user('u1', 'Phoenix'));
    snapshots.push(user('u1', 'Phoenix to Mesa'));
    assert.equal(snapshots.push(user('u1', 'Phoenix to Mesa', true)).completed[0].content, 'Phoenix to Mesa');
});

test('persona chunks remain deltas, including identical repeated words', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(persona('p1', 'Very '));
    accumulator.push(persona('p1', 'Very '));
    const update = accumulator.push(persona('p1', 'helpful.', true));
    assert.equal(update.completed[0].content, 'Very Very helpful.');
});

test('empty final preserves the pending message and never creates an empty turn', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'I will handle packing.'));
    assert.equal(accumulator.push(user('u1', '', true)).completed[0].content, 'I will handle packing.');
    assert.equal(accumulator.push(persona('p1', '', true)).completed.length, 0);
});

test('duplicate completed final is ignored for both user and persona', () => {
    for (const event of [user('u1', 'Goodbye.', true), persona('p1', 'Goodbye.', true)]) {
        const accumulator = createEvanTranscriptAccumulator();
        assert.equal(accumulator.push(event).completed.length, 1);
        assert.deepEqual(accumulator.push(event), { completed: [], pending: null, replay: true });
        assert.equal(accumulator.push({ ...event, content: '' }).replay, true);
    }
});

test('replayed final delta or full completed text cannot flush a newer pending turn', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(persona('p1', 'Thanks, '));
    accumulator.push(persona('p1', 'goodbye.', true));
    accumulator.push(user('u1', 'One more detail.'));
    for (const content of ['goodbye.', 'Thanks, goodbye.', '']) {
        const update = accumulator.push(persona('p1', content, true));
        assert.equal(update.replay, true);
        assert.equal(update.completed.length, 0);
        assert.equal(update.pending.id, 'u1');
    }
});

test('late duplicate final of a boundary-completed message is ignored', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'Phoenix to Mesa.'));
    accumulator.push(persona('p1', 'Thank you.'));
    const update = accumulator.push(user('u1', 'Phoenix to Mesa.', true));
    assert.equal(update.replay, true);
    assert.equal(update.pending.id, 'p1');
    assert.equal(update.completed.length, 0);
});

test('fresh post-tool speech can continue under the same persona ID', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(persona('p1', 'I have your details.', true));
    accumulator.push(persona('p1', 'Thanks for calling. '));
    const update = accumulator.push(persona('p1', 'Goodbye.', true));
    assert.equal(update.completed[0].content, 'Thanks for calling. Goodbye.');
    assert.equal(update.replay, false);
});

test('a new single-chunk final can continue under the same persona ID', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(persona('p1', 'I have your details.', true));
    assert.equal(accumulator.push(persona('p1', 'Goodbye.', true)).completed[0].content, 'Goodbye.');
});

test('interruption stays attached to the correct persona turn', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(persona('p1', 'Where are you ', false, true));
    const update = accumulator.push(user('u1', 'I already said Mesa.', true));
    assert.equal(update.completed[0].interrupted, true);
    assert.equal(update.completed[0].completion, 'message-boundary');
    assert.equal(update.completed[1].interrupted, false);
    const next = accumulator.push(persona('p2', 'You are right.', true));
    assert.equal(next.completed[0].interrupted, false);
});

test('final interruption marker preserves earlier content', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(persona('p1', 'Where are you moving?'));
    const update = accumulator.push(persona('p1', '', true, true));
    assert.equal(update.completed[0].content, 'Where are you moving?');
    assert.equal(update.completed[0].interrupted, true);
});

test('invalid events do not mutate or complete a valid pending message', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'Mesa'));
    for (const event of [null, {}, { id: '', role: 'persona', content: 'Ignore' }, { id: 'x', role: 'system', content: 'Ignore' }, { id: 'x', role: 'user', content: null }]) {
        const update = accumulator.push(event);
        assert.equal(update.completed.length, 0);
        assert.equal(update.pending.content, 'Mesa');
    }
});

test('snapshots cannot mutate internal state and reset clears pending and replay state', () => {
    const accumulator = createEvanTranscriptAccumulator();
    const snapshot = accumulator.push(user('u1', 'Mesa')).pending;
    snapshot.content = 'Not Mesa';
    assert.equal(accumulator.getPending().content, 'Mesa');
    accumulator.push(user('u1', '', true));
    accumulator.reset();
    assert.equal(accumulator.getPending(), null);
    assert.equal(accumulator.push(user('u1', 'Mesa', true)).completed.length, 1);
});

test('an authorized observed tool boundary completes only the pending user once', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'That is all, goodbye.'));
    assert.deepEqual(accumulator.finalizeUserAtToolBoundary(), {
        id: 'u1', role: 'user', content: 'That is all, goodbye.', interrupted: false, completion: 'tool-boundary',
    });
    assert.equal(accumulator.getPending(), null);
    assert.equal(accumulator.finalizeUserAtToolBoundary(), null);
    assert.equal(accumulator.push(user('u1', 'That is all, goodbye.', true)).replay, true);
});

test('tool boundaries never flush persona speech or manufacture empty user turns', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(persona('p1', 'Anything else you want to add?'));
    assert.equal(accumulator.finalizeUserAtToolBoundary(), null);
    assert.equal(accumulator.getPending().content, 'Anything else you want to add?');
    accumulator.reset();
    accumulator.push(user('u1', ''));
    assert.equal(accumulator.finalizeUserAtToolBoundary(), null);
});

test('completed user IDs ignore late partials without completing a newer pending turn', () => {
    for (const explicitlyCompleted of [true, false]) {
        const accumulator = createEvanTranscriptAccumulator();
        accumulator.push(user('u1', 'Move the cabinet.', explicitlyCompleted));
        accumulator.push(user('u2', 'Actually, leave the '));
        const pending = accumulator.getPending();
        for (const content of ['Move the cabinet.', 'Move', 'Move the cabinet and the desk.']) {
            assert.deepEqual(accumulator.push(user('u1', content)), { completed: [], pending, replay: true });
        }
        assert.equal(accumulator.push(user('u2', 'cabinet.', true)).completed[0].content, 'Actually, leave the cabinet.');
    }
});

test('expanded late final revises its original user source and preserves pending persona speech', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'Move date Friday'));
    accumulator.push(persona('p1', 'What about '));
    const pending = accumulator.getPending();
    const update = accumulator.push(user('u1', 'Move date Friday morning.', true));
    assert.deepEqual(update, { completed: [], pending, replay: false, revised: [{
        id: 'u1', role: 'user', content: 'Move date Friday morning.', interrupted: false, completion: 'explicit-final',
    }] });
    assert.equal(accumulator.push(persona('p1', 'packing?', true)).completed[0].content, 'What about packing?');
    assert.equal(accumulator.push(user('u1', 'Move date Friday morning.', true)).replay, true);
});

test('late boundary final delta retains the original raw spacing and never becomes a new turn', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'I need two '));
    accumulator.push(persona('p1', 'Thanks.'));
    const update = accumulator.push(user('u1', 'wardrobe boxes.', true));
    assert.deepEqual(update.completed, []);
    assert.equal(update.revised[0].content, 'I need two wardrobe boxes.');
    assert.equal(update.pending.id, 'p1');
    assert.equal(accumulator.push(user('u1', 'wardrobe boxes.', true)).replay, true);
});

test('a late tool-boundary user final uses source revision rather than a second completed turn', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'My pickup is '));
    accumulator.finalizeUserAtToolBoundary();
    accumulator.push(user('u2', 'The destination is '));
    const update = accumulator.push(user('u1', 'Mesa.', true));
    assert.equal(update.completed.length, 0);
    assert.equal(update.revised[0].content, 'My pickup is Mesa.');
    assert.equal(update.pending.id, 'u2');
});

test('shrunken or unrecognizable late finals cannot degrade an explicitly completed source', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'Do not move the cabinet.', true));
    accumulator.push(user('u2', 'I also have '));
    const pending = accumulator.getPending();
    for (const content of ['Do not move', 'Do not move the cabinet.', 'the cabinet.', '']) {
        assert.deepEqual(accumulator.push(user('u1', content, true)), { completed: [], pending, replay: true });
    }
});

test('expanded final can revise an explicit-final source but a replay cannot shrink the revision', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'My date is Friday', true));
    const revision = accumulator.push(user('u1', 'My date is Friday afternoon.', true));
    assert.equal(revision.revised[0].content, 'My date is Friday afternoon.');
    revision.revised[0].content = 'Mutated result';
    assert.equal(accumulator.push(user('u1', 'My date is Friday', true)).replay, true);
    assert.equal(accumulator.push(user('u1', 'My date is Friday afternoon.', true)).replay, true);
});

test('source replay identities survive the entire supported 400-turn session', () => {
    const accumulator = createEvanTranscriptAccumulator();
    accumulator.push(user('u1', 'Keep the cabinet.', true));
    for (let index = 1; index < 400; index++) {
        accumulator.push(index % 2 ? persona(`p${index}`, `Synthetic response ${index}.`, true)
            : user(`u${index + 1}`, `Synthetic detail ${index}.`, true));
    }
    accumulator.push(user('pending', 'Do not move the '));
    const pending = accumulator.getPending();
    assert.deepEqual(accumulator.push(user('u1', 'Keep the cabinet.', true)), { completed: [], pending, replay: true });
    assert.deepEqual(accumulator.push(user('u1', 'Keep')), { completed: [], pending, replay: true });
});
