import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicEvanCapture } from '../lib/anam/evan-deterministic-capture.ts';
import { currentEvanCaptureFacts, projectEvanCaptureContact, projectEvanCapturePlan, validateEvanCapture } from '../lib/anam/evan-capture.ts';
import { buildEvanPlannerContact } from '../lib/anam/evan-planner-contact.ts';
import { buildEvanEmailBundle } from '../lib/anam/evan-agentmail-templates.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
const audiences = ['visitor', 'admin', 'sales'];
const nameQuestion = "To have Mullins staff follow up tomorrow, I'll need your name and a phone number. What name and number should I give them?";
const contactAnswer = 'Sure. Um, Jordan Avery, my phone is 2025550146 and my email is jordan.avery@example.com.';
const contactReadback = 'Got it. Let me read that back: Jordan Avery, phone two oh two, five five five, oh one four six, and email jordan dot avery at example dot com. Did I get that right?';
const inventoryQuestion = 'What kind of furniture are you bringing, and roughly how many boxes?';

function localTest(name, run) {
    test(name, t => {
        t.mock.method(globalThis, 'fetch', () => assert.fail('Run-53 regressions must remain local'));
        run();
    });
}

function replay(turns) {
    const before = JSON.stringify(turns);
    const record = buildDeterministicEvanCapture(turns, 53);
    assert.equal(JSON.stringify(turns), before, 'Capture must not rewrite transcript evidence');
    assert.deepEqual(validateEvanCapture({ facts: record.facts }, turns, 53), record);
    const contact = projectEvanCaptureContact(record);
    const liveContact = buildEvanPlannerContact(turns);
    const plan = projectEvanCapturePlan(record);
    const facts = currentEvanCaptureFacts(record);
    const items = facts.filter(f => f.status === 'asserted' && ['inventory', 'specialty'].includes(f.category));
    const emails = buildEvanEmailBundle({ displayName: '', verifiedEmail: 'jordan.avery@example.com',
        externalSessionId: 'run53-local-replay', sessionStartedAt: '2026-10-22T12:00:00Z',
        sessionEndedAt: '2026-10-22T12:03:00Z', turns, captureRecord: record, handoffStatus: 'rehearsal' });
    return { record, contact, liveContact, plan, facts, items, emails };
}

function sharedName(result, expected) {
    assert.equal(result.liveContact.displayName, expected, 'Live contact name');
    assert.equal(result.contact.displayName, expected, 'Final captured name');
    assert.equal(result.facts.filter(f => f.category === 'name' && f.status === 'asserted').length, expected ? 1 : 0);
    assert.ok(result.emails.visitor.text.startsWith(`Hi ${expected ? expected.split(' ')[0] : 'there'},`));
    assert.ok(result.emails.admin.text.includes(`Visitor: ${expected || 'Visitor'}`));
    assert.ok(result.emails.sales.text.includes(`Customer: ${expected || 'Visitor'}`));
}

function sharedContact(result, name = 'Jordan Avery', confirmed = false) {
    sharedName(result, name);
    for (const contact of [result.liveContact, result.contact]) {
        assert.equal(contact.phone, '(202) 555-0146');
        assert.equal(contact.email, 'jordan.avery@example.com');
        assert.equal(contact.phoneConfirmed, confirmed);
    }
    for (const audience of ['admin', 'sales']) {
        assert.ok(result.emails[audience].text.includes('(202) 555-0146'));
        assert.ok(result.emails[audience].text.includes('jordan.avery@example.com'));
    }
}

function sharedInventory(result, expected) {
    const actual = result.items.map(f => [f.value, f.quantity, f.location, f.scope]);
    assert.deepEqual(actual.sort(), [...expected].sort());
    for (const value of [...result.plan.inventoryItems, ...result.plan.specialtyItems]) {
        for (const audience of audiences) assert.ok(result.emails[audience].text.includes(value), `${audience} lost ${value}`);
    }
    if (!expected.length) {
        assert.deepEqual(result.plan.inventoryItems, []);
        assert.deepEqual(result.plan.specialtyItems, []);
    }
}

localTest('run53 exact contact exchange captures the visitor name before and after confirmed readback', () => {
    const initial = [agent(nameQuestion), user(contactAnswer)];
    sharedContact(replay(initial));
    const result = replay([...initial, agent(contactReadback), user("Yes, that's exactly right.")]);
    sharedContact(result, 'Jordan Avery', true);
    const name = result.facts.find(f => f.category === 'name');
    assert.ok(name.evidence.every(source => source.turn === 1 && contactAnswer.includes(source.quote)));
});

for (const question of [
    "To arrange your callback, I'll need your name and a phone number. What name and number should I give the team?",
    'I need your contact details for follow-up. What name and number should I pass along?',
    'What is your name and phone number?',
    'May I get your name and callback number?',
    'Could you share your name, phone number, and email address?',
]) {
    localTest(`own-contact question recognizes a bundled bare-name answer: ${question}`, () => {
        sharedContact(replay([agent(question), user(contactAnswer)]));
    });
}

for (const answer of [
    'Jordan Avery, my phone is 2025550146 and my email is jordan.avery@example.com.',
    'Um, Jordan Avery, my phone is 2025550146 and my email is jordan.avery@example.com.',
    'Sure, Jordan Avery. My phone is 2025550146 and my email is jordan.avery@example.com.',
    'Sure. Uh, Jordan Avery; my phone is 2025550146; my email is jordan.avery@example.com.',
    'Sure! Um, Jordan Avery, my phone is 2025550146 and my email is jordan.avery@example.com.',
]) {
    localTest(`acknowledgment punctuation does not change bundled contact ownership: ${answer}`, () => {
        sharedContact(replay([agent(nameQuestion), user(answer)]));
    });
}

localTest('name, phone and email split into direct answers retain the same contact record', () => {
    const result = replay([agent(nameQuestion), user('Sure. Um, Jordan Avery.'),
        agent('What is your phone number?'), user('My phone is 2025550146.'),
        agent('What email should the recap go to?'), user('My email is jordan.avery@example.com.'),
        agent(contactReadback), user("Yes, that's exactly right.")]);
    sharedContact(result, 'Jordan Avery', true);
});

localTest('explicit self-introduction remains supported without a preceding name question', () => {
    sharedContact(replay([user("Sure. Um, I'm Jordan Avery, my phone is 2025550146 and my email is jordan.avery@example.com.")]));
});

localTest('a later name-only correction leaves phone and email unchanged in all projections', () => {
    const result = replay([agent(nameQuestion), user(contactAnswer), user('Actually, my name is Jordan Taylor.')]);
    sharedContact(result, 'Jordan Taylor');
    for (const audience of audiences) assert.ok(!result.emails[audience].text.includes('Jordan Avery'));
});

for (const question of [
    "What is your neighbor's name and phone number?",
    "I'll need your name and a phone number. What is your neighbor's name and phone number?",
]) {
    localTest(`third-party final question does not inherit earlier caller ownership: ${question}`, () => {
        const result = replay([agent(question), user('Jordan Avery, 2025550146, jordan.avery@example.com.')]);
        sharedName(result, '');
        assert.equal(result.contact.phone, '');
        assert.equal(result.contact.email, '');
    });
}

for (const answer of ['Sure.', 'Um, okay.', "Yes, that's exactly right.", 'I prefer not to share my name.']) {
    localTest(`acknowledgment or refusal cannot become a caller name: ${answer}`, () => {
        sharedName(replay([agent(nameQuestion), user(answer)]), '');
    });
}

localTest('agent readback and caller acknowledgment cannot invent previously uncaptured identity', () => {
    const result = replay([agent(contactReadback), user("Yes, that's exactly right.")]);
    sharedName(result, '');
    assert.equal(result.contact.phone, '');
    assert.equal(result.contact.email, '');
});

localTest('run53 exact dishes declaration and service question preserve inventory without inventing packing request', () => {
    const result = replay([agent(inventoryQuestion),
        user('I do have some fragile dishes. Do you help pack those and would that cost extra?')]);
    sharedInventory(result, [['fragile dishes', 'some', 'unspecified', '']]);
    assert.ok(result.plan.carePriorities.some(value => /fragile/i.test(value)));
    assert.deepEqual(result.plan.services, []);
    assert.equal(result.plan.packingPlan, '');
    assert.ok(result.facts.some(f => f.category === 'question' && /Do you help pack those and would that cost extra/i.test(f.value)));
});

for (const wording of [
    'I do have some fragile dishes.',
    'We do have some fragile dishes.',
    'I have some fragile dishes.',
    'We have some fragile dishes.',
    'Um, I do have some fragile dishes.',
]) {
    localTest(`emphatic and ordinary declarations capture the same dishes: ${wording}`, () => {
        sharedInventory(replay([agent(inventoryQuestion), user(wording)]), [['fragile dishes', 'some', 'unspecified', '']]);
    });
}

localTest('emphatic declaration keeps a literal quantity and sibling genuine item', () => {
    sharedInventory(replay([user('We do have six fragile dishes and a desk.')]), [
        ['fragile dishes', 'six', 'unspecified', ''], ['desk', 'a', 'unspecified', ''],
    ]);
});

for (const wording of [
    'I do not have any fragile dishes.',
    "We don't have fragile dishes.",
    'Do you pack fragile dishes?',
    'If I had some fragile dishes, could you pack them?',
    'My neighbor has some fragile dishes.',
    'My neighbor said, "I do have some fragile dishes."',
]) {
    localTest(`non-owned or unasserted dishes do not enter move inventory: ${wording}`, () => {
        sharedInventory(replay([agent(inventoryQuestion), user(wording)]), []);
    });
}

localTest('dishes removal applies to the stated room without erasing the other group', () => {
    const result = replay([user('I do have four fragile dishes in the kitchen. We do have two fragile dishes in the dining room.'),
        user('Remove the fragile dishes in the kitchen.')]);
    sharedInventory(result, [['fragile dishes', 'two', 'unspecified', 'dining room']]);
    for (const audience of audiences) assert.ok(!result.emails[audience].text.includes('four fragile dishes'));
});

localTest('dishes quantity correction replaces one group without duplicating or changing its sibling', () => {
    const result = replay([user('I do have four fragile dishes in the kitchen. We do have two fragile dishes in the dining room.'),
        user('Update the fragile dishes in the kitchen to six.')]);
    sharedInventory(result, [
        ['fragile dishes', 'six', 'unspecified', 'kitchen'],
        ['fragile dishes', 'two', 'unspecified', 'dining room'],
    ]);
    for (const audience of audiences) assert.ok(!result.emails[audience].text.includes('four fragile dishes'));
});

localTest('run53 name and dishes repairs preserve run52 date, endpoint property and access separation', () => {
    const result = replay([
        user('I am moving from Mesa to Tempe in the 2nd week of November. I am moving out of a 2 bedroom apartment and into a 3 bedroom house.'),
        agent(inventoryQuestion), user('I do have some fragile dishes and a desk.'),
        user('At pickup, there is one flight of stairs and at delivery, there is an elevator.'),
        agent(nameQuestion), user(contactAnswer), agent(contactReadback), user("Yes, that's exactly right."),
    ]);
    sharedContact(result, 'Jordan Avery', true);
    sharedInventory(result, [['fragile dishes', 'some', 'unspecified', ''], ['desk', 'a', 'unspecified', '']]);
    assert.equal(result.plan.timing, '2nd week of November');
    assert.deepEqual(result.plan.propertyScope.split('; ').sort(), ['Origin: 2 bedroom apartment', 'Destination: 3 bedroom house'].sort());
    assert.deepEqual([...result.plan.accessFactors].sort(), ['Origin: one flight of stairs', 'Destination: elevator'].sort());
    for (const audience of audiences) for (const expected of ['2nd week of November', 'Origin: 2 bedroom apartment', 'Destination: 3 bedroom house', 'Origin: one flight of stairs', 'Destination: elevator']) {
        assert.ok(result.emails[audience].text.includes(expected), `${audience} lost ${expected}`);
    }
});

for (const wording of [
    'If I do have some fragile dishes, I will let you know.',
    'He said I do have some fragile dishes.',
]) {
    localTest(`conditional or reported emphatic possession does not assert caller inventory: ${wording}`, () => {
        sharedInventory(replay([agent(inventoryQuestion), user(wording)]), []);
    });
}

localTest('a later emphatic denial removes the existing dishes rather than creating a differently named tombstone', () => {
    const result = replay([user('I do have some fragile dishes.'), user('Actually, I do not have any fragile dishes.')]);
    sharedInventory(result, []);
    assert.ok(result.facts.some(f => f.category === 'inventory' && f.status === 'removed' && f.value === 'fragile dishes'));
});
