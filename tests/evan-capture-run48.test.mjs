import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicEvanCapture } from '../lib/anam/evan-deterministic-capture.ts';
import { projectEvanCapturePlan, projectEvanCaptureContact, validateEvanCapture } from '../lib/anam/evan-capture.ts';
import { buildEvanEmailBundle, buildEvanGuestLeadBrief } from '../lib/anam/evan-agentmail-templates.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
function replay(turns) {
    const record = buildDeterministicEvanCapture(turns, 1);
    const emails = buildEvanEmailBundle({ displayName: 'Jordan Avery', verifiedEmail: 'jordan.avery@example.com',
        externalSessionId: 'local-run48-regression', sessionStartedAt: '2026-10-21T12:00:00Z',
        sessionEndedAt: '2026-10-21T12:03:00Z', turns, captureRecord: record });
    return { record, plan: projectEvanCapturePlan(record), contact: projectEvanCaptureContact(record), emails };
}

for (const [utterance, expected] of [
    ['There is one flight of stairs at pickup and delivery has an elevator.', ['Origin: one flight of stairs', 'Destination: elevator']],
    ['Pickup has two flights of stairs and delivery has an elevator.', ['Origin: two flights of stairs', 'Destination: elevator']],
    ['An elevator at pickup and three flights of stairs at delivery.', ['Origin: elevator', 'Destination: three flights of stairs']],
    ['At delivery there is an elevator, at pickup there are 2 flights of stairs.', ['Destination: elevator', 'Origin: 2 flights of stairs']],
]) test(`access qualifiers survive planner and all recaps: ${utterance}`, () => {
    const { plan, emails } = replay([user(utterance)]);
    assert.deepEqual(plan.accessFactors, expected);
    for (const audience of ['visitor', 'admin', 'sales']) for (const value of expected) assert.ok(emails[audience].text.includes(value));
});

test('access correction replaces only the matching location', () => {
    const { plan } = replay([user('Pickup has one flight of stairs and delivery has two flights of stairs.'),
        user('Actually pickup has three flights of stairs.')]);
    assert.deepEqual(plan.accessFactors, ['Origin: three flights of stairs', 'Destination: two flights of stairs']);
});

for (const filler of ['um', 'uh', 'erm', 'hmm']) test(`filler ${filler} is not inventory`, () => {
    const { plan, emails } = replay([agent('What furniture and how many boxes?'),
        user(`About 20 to 25 boxes, a queen bed, ${filler}, love seat and a desk.`)]);
    assert.deepEqual(plan.inventoryItems, ['About 20 to 25 boxes', 'a queen bed', 'love seat', 'a desk']);
    for (const audience of ['visitor', 'admin', 'sales']) assert.doesNotMatch(emails[audience].text, new RegExp(`(?:; |^- )${filler}(?:;|$)`, 'm'));
});

test('filler filtering does not remove item names containing similar letters', () => {
    assert.deepEqual(replay([user('My inventory is an umbrella stand, a drum and a hummingbird sculpture.')]).plan.inventoryItems,
        ['an umbrella stand', 'a drum', 'a hummingbird sculpture']);
});

const contactTurns = [user("I'm Jordan Avery. My phone is 2025550146 and my email is jordan.avery@example.com."),
    agent('Jordan Avery, two zero two … five five five … oh one four six, and jordan.avery at example dot com. Did I get that right?'),
    user("Yes, that's exactly right.")];
test('explicit bundled readback survives capture validation, planner and internal emails', () => {
    const { record, contact, emails } = replay(contactTurns);
    assert.equal(contact.phoneConfirmed, true);
    assert.equal(projectEvanCaptureContact(validateEvanCapture({ facts: record.facts }, contactTurns, 2)).phoneConfirmed, true);
    for (const audience of ['admin', 'sales']) {
        assert.match(emails[audience].text, /Phone confirmed during call: \(202\) 555-0146/);
        assert.doesNotMatch(emails[audience].text, /Phone shared \(verify before follow-up\)/);
    }
    const guest = buildEvanGuestLeadBrief({ externalSessionId: 'local-confirmed-phone', lead: {}, turns: contactTurns, captureRecord: record });
    assert.match(guest.text, /Phone confirmed during call: \(202\) 555-0146/);
});

test('confirmation cannot be invented, reused for a new number, or retained after removal', () => {
    for (const turns of [contactTurns.slice(0, 2),
        [contactTurns[0], agent('Is the move next month?'), user('Yes.')],
        [contactTurns[0], agent('Is your number 2025550199?'), user('Yes.')],
        [...contactTurns, user('Actually my phone is 2025550199.')],
        [...contactTurns, user('Remove my phone number.')]]) {
        assert.equal(replay(turns).contact.phoneConfirmed, false);
    }
});
