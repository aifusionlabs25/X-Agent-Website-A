import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicEvanCapture } from '../lib/anam/evan-deterministic-capture.ts';
import { projectEvanCapturePlan } from '../lib/anam/evan-capture.ts';
import { buildEvanEmailBundle } from '../lib/anam/evan-agentmail-templates.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
function replay(turns) {
    const record = buildDeterministicEvanCapture(turns, 1);
    return { plan: projectEvanCapturePlan(record), emails: buildEvanEmailBundle({
        displayName: 'Ordinal Test', verifiedEmail: 'ordinal@example.com',
        externalSessionId: 'ordinal-local-replay', sessionStartedAt: '2026-10-22T12:00:00Z',
        sessionEndedAt: '2026-10-22T12:03:00Z', turns, captureRecord: record,
    }) };
}
function assertTiming(turns, expected) {
    const { plan, emails } = replay(turns);
    assert.equal(plan.timing, expected);
    for (const audience of ['visitor', 'admin', 'sales']) {
        assert.ok(emails[audience].text.includes(expected), `${audience} must keep ${expected}`);
    }
}

for (const ordinal of ['1st', '2nd', '3rd', '4th', '5th', 'first', 'second', 'third', 'fourth', 'fifth', 'last']) {
    for (const preposition of ['of', 'in']) {
        const value = `${ordinal} week ${preposition} November`;
        test(`planner and all recaps retain ${value}`, () => {
            assertTiming([user(`Moving from Mesa to Tempe in the ${value}.`)], value);
        });
    }
}

test('run51 numeric transcription retains the full date', () => {
    assertTiming([user("Hi, I'm planning a move and could use some help. I'm moving from Mesa to Tempe in the 2nd week of November.")], '2nd week of November');
});

test('numeric ordinals work across months without inventing dates or years', () => {
    for (const month of ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']) {
        assertTiming([user(`The move is the 3rd week in ${month}.`)], `3rd week in ${month}`);
    }
    assertTiming([user('The move is the 2ND WEEK OF NOVEMBER.')], '2ND WEEK OF NOVEMBER');
});

test('later ordinal correction replaces the previous qualifier everywhere', () => {
    const { plan, emails } = replay([user('The 1st week of November.'), user('Actually, the 3rd week in December.')]);
    assert.equal(plan.timing, '3rd week in December');
    for (const audience of ['visitor', 'admin', 'sales']) {
        assert.ok(emails[audience].text.includes('3rd week in December'));
        assert.ok(!emails[audience].text.includes('1st week of November'));
    }
});

test('numeric ordinal preserves existing flexibility qualifiers', () => {
    assertTiming([user('The 2nd week of November, but our move date is flexible.')], '2nd week of November, but our move date is flexible');
});

test('agent suggestions, callback dates and floor ordinals do not become move dates', () => {
    assert.equal(replay([agent('Would the 2nd week of November work?'), user('I do not know yet.')]).plan.timing, '');
    assert.equal(replay([user('Call me in the 2nd week of November.')]).plan.timing, '');
    assert.equal(replay([user('Pickup is on the 2nd floor.')]).plan.timing, '');
    assertTiming([user('The move is November 2nd.')], 'November 2nd');
});

test('next live scenario keeps numeric date and both distinct properties through planner and recaps', () => {
    const { plan, emails } = replay([
        user('Moving from Mesa to Tempe in the 2nd week of November.'),
        agent('What size place are you moving from?'), user('The pickup is a 2 bedroom apartment.'),
        agent('What kind of home are you moving to?'), user('The destination is a 3 bedroom house.'),
        user('There is one flight of stairs at pickup and an elevator at delivery.'),
    ]);
    assert.equal(plan.timing, '2nd week of November');
    assert.equal(plan.propertyScope, 'Origin: 2 bedroom apartment; Destination: 3 bedroom house');
    assert.deepEqual(plan.accessFactors, ['Origin: one flight of stairs', 'Destination: elevator']);
    for (const audience of ['visitor', 'admin', 'sales']) {
        assert.ok(emails[audience].text.includes(plan.timing));
        assert.ok(emails[audience].text.includes(plan.propertyScope));
    }
});
