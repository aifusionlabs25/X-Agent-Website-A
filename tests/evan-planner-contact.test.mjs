import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildEvanPlannerContact } from '../lib/anam/evan-planner-contact.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });

test('natural phone-only intake captures a separate plural morning preference without email routing changes', () => {
    const checkIn = { displayName: 'Avery Sample', email: 'avery@example.test' };
    const turns = [
        agent('Do you anticipate needing any packing help or labor-only assistance for the Mesa apartment?'),
        user('No packing help, phone only please, no email. My number is 480-555-0198. Mornings are best.'),
    ];
    const model = buildEvanPlannerContact(turns, checkIn);
    assert.equal(model.phone, '(480) 555-0198');
    assert.equal(model.contactPreference, 'Phone call');
    assert.equal(model.callbackWindow, 'Mornings');
    assert.equal(model.email, checkIn.email, 'spoken preference must not change check-in routing');
    assert.equal(model.emailSource, 'check-in');
    turns.push(user("Yes, that's right. Please have someone call in the morning. Thank you."));
    assert.equal(buildEvanPlannerContact(turns, checkIn).callbackWindow, 'in the morning');
    turns.push(user('Actually, call me afternoons.'));
    assert.equal(buildEvanPlannerContact(turns, checkIn).callbackWindow, 'afternoons');
});

test('plural preferred periods need visitor call context, not an unrelated moving schedule', () => {
    for (const period of ['Mornings', 'Afternoons', 'Evenings']) {
        assert.equal(buildEvanPlannerContact([user(`Phone only please. ${period} are best.`)]).callbackWindow, period);
        assert.equal(buildEvanPlannerContact([
            agent('What is the best time to call?'), user(`${period} are best.`),
        ]).callbackWindow, period);
        assert.equal(buildEvanPlannerContact([user(`${period} are best.`)]).callbackWindow, '');
        assert.equal(buildEvanPlannerContact([agent(`Call in the ${period.toLowerCase()}.`)]).callbackWindow, '');
    }
    assert.equal(buildEvanPlannerContact([user('Phone only please. Moving mornings are best.')]).callbackWindow, '');
    assert.equal(buildEvanPlannerContact([
        user('Phone only. Mornings are best.'), user('Email only now.'),
    ]).callbackWindow, '');
});

test('empty guest model does not invent contact details', () => {
    const model = buildEvanPlannerContact([]);
    assert.deepEqual(model, { displayName: '', phone: '', email: '', emailSource: null, proposedEmail: '', contactPreference: '', callbackWindow: '', hiddenFields: [] });
});

test('check-in seeds browser display without being changed by an agent reply', () => {
    const model = buildEvanPlannerContact([agent('Your name is Morgan. Your email is other@example.test. Call 602-555-0100.')], { displayName: 'Avery Sample', email: 'avery@example.test' });
    assert.equal(model.displayName, 'Avery Sample');
    assert.equal(model.email, 'avery@example.test');
    assert.equal(model.emailSource, 'check-in');
    assert.equal(model.phone, '');
});

test('explicit visitor name and phone update as working notes', () => {
    const model = buildEvanPlannerContact([
        user("My name is Avery Sample, and I'm moving from Mesa."),
        user('My phone number is 602-555-0101.'),
        user('Actually, my phone number is 480-555-0123.'),
        user('Please call me tomorrow after 3 pm.'),
    ]);
    assert.equal(model.displayName, 'Avery Sample');
    assert.equal(model.phone, '(480) 555-0123');
    assert.equal(model.contactPreference, 'Phone call');
    assert.equal(model.callbackWindow, 'tomorrow after 3 pm');
});

test('immediate questions can supply context but not data', () => {
    const model = buildEvanPlannerContact([
        agent('What is your name?'), user('Avery Sample'),
        agent('What is your best callback number?'), user('Six zero two, five five five, zero one two three.'),
        agent('What is the best time for a call?'), user('Weekdays after 4 pm.'),
    ]);
    assert.equal(model.displayName, 'Avery Sample');
    assert.equal(model.phone, '(602) 555-0123');
    assert.equal(model.callbackWindow, 'Weekdays after 4 pm');
});

test('a spoken email correction is separate from authoritative check-in', () => {
    const model = buildEvanPlannerContact([
        user('My email is alternate@example.test.'),
    ], { email: 'checkin@example.test' });
    assert.equal(model.email, 'checkin@example.test');
    assert.equal(model.emailSource, 'check-in');
    assert.equal(model.proposedEmail, 'alternate@example.test');
});

test('guest spoken email is explicitly unverified and is never delivery authority', () => {
    const model = buildEvanPlannerContact([user('My email is avery at example dot test.')]);
    assert.equal(model.email, 'avery@example.test');
    assert.equal(model.emailSource, 'spoken');
    assert.equal(model.proposedEmail, '');
});

test('addresses, agent contact details, questions and unrelated numbers are not captured', () => {
    const model = buildEvanPlannerContact([
        user("I'm moving next Tuesday."),
        user("I'm worried."),
        user('This is complicated.'),
        user('My storage address is 6025550101 East Main Street.'),
        user('Mullins phone number is 480-555-0133.'),
        user('Is your email sales@example.test?'),
        user('Is my phone number 480-555-0133 in your notes?'),
        agent('You can email us at sales@example.test, or call 602-555-0100.'),
        user('Thank you.'),
    ]);
    assert.equal(model.displayName, '');
    assert.equal(model.phone, '');
    assert.equal(model.email, '');
});

test('a contact question does not turn a storage address answer into a phone number', () => {
    const model = buildEvanPlannerContact([
        agent('What is your best callback number?'),
        user('First, the storage code is 6025550123.'),
    ]);
    assert.equal(model.phone, '');
});

test('ambiguous or partial dictated email and phone remain blank', () => {
    const model = buildEvanPlannerContact([
        user('My phone number is six zero two five five.'),
        user('My email is a v e r y at example dot test.'),
    ]);
    assert.equal(model.phone, '');
    assert.equal(model.email, '');
});

test('single-field removal clears the working view and later explicit detail can restore it', () => {
    const cleared = buildEvanPlannerContact([user('My phone number is 602-555-0123.'), user('Remove my phone number.')]);
    assert.equal(cleared.phone, '');
    assert.ok(cleared.hiddenFields.includes('phone'));
    const restored = buildEvanPlannerContact([user('Remove my phone number.'), user('My phone number is 480-555-0123.')]);
    assert.equal(restored.phone, '(480) 555-0123');
    assert.ok(!restored.hiddenFields.includes('phone'));
});

test('clear all contact details removes check-in display without mutating input', () => {
    const input = Object.freeze({ displayName: 'Avery Sample', email: 'avery@example.test' });
    const model = buildEvanPlannerContact([user('Clear my contact information.')], input);
    assert.equal(model.displayName, '');
    assert.equal(model.email, '');
    assert.equal(model.emailSource, null);
    assert.equal(model.hiddenFields.length, 5);
    assert.equal(input.email, 'avery@example.test');
});

test('a new spoken email never resurrects a hidden check-in email', () => {
    const checkIn = Object.freeze({ displayName: 'Avery Sample', email: 'hidden@example.test' });
    for (const removal of ['Remove my email.', 'Clear my contact information.']) {
        const turns = [user(removal), user('My email is new@example.test.')];
        const model = buildEvanPlannerContact(turns, checkIn);
        assert.equal(model.email, 'new@example.test', removal);
        assert.equal(model.emailSource, 'spoken', removal);
        assert.equal(model.proposedEmail, '', removal);
        assert.ok(!model.hiddenFields.includes('email'), removal);
        assert.doesNotMatch(JSON.stringify(model), /hidden@example\.test/, removal);
        const later = buildEvanPlannerContact([...turns, user('My email is later@example.test.')], checkIn);
        assert.equal(later.email, 'later@example.test', removal);
        assert.equal(later.emailSource, 'spoken', removal);
        assert.doesNotMatch(JSON.stringify(later), /hidden@example\.test/, removal);
    }
    assert.equal(checkIn.email, 'hidden@example.test');
});

test('contact opt-out updates preference and removes obsolete callback window', () => {
    const model = buildEvanPlannerContact([user('Please call me tomorrow after 3 pm.'), user('Do not contact me.')]);
    assert.equal(model.contactPreference, 'No follow-up requested');
    assert.equal(model.callbackWindow, '');
    const emailOnly = buildEvanPlannerContact([user('Call me tomorrow morning.'), user('Actually, email only please.')]);
    assert.equal(emailOnly.contactPreference, 'Email only');
    assert.equal(emailOnly.callbackWindow, '');
});

test('unrelated move timing is not a callback window', () => {
    const model = buildEvanPlannerContact([user('We move next Tuesday morning.'), user('The crew should arrive after 3 pm.')]);
    assert.equal(model.callbackWindow, '');
});

test('model remains an isolated pure browser display helper with no persistence or networking', () => {
    const source = readFileSync(new URL('../lib/anam/evan-planner-contact.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|console|process\.env)\b/);
    assert.doesNotMatch(source, /(?:addContext|sendToolResult|document\.cookie)/);
});

test('conversational acknowledgements never replace the check-in name', () => {
    for (const text of ["I'm good.", "I'm fine.", 'I am okay.', "I'm all set.", "I'm set for now.", "I'm comfortable with that.", "I'm happy.", "I'm retired."]) {
        assert.equal(buildEvanPlannerContact([user(text)], { displayName: 'Avery Sample' }).displayName, 'Avery Sample', text);
    }
});

test('informal descriptions never establish or replace a name without a name question', () => {
    for (const text of ['I am disabled.', 'I am downsizing.', 'I am packing.', 'This is stressful.', 'I am helping my mom.', "I'm Avery Sample."]) {
        assert.equal(buildEvanPlannerContact([user(text)], { displayName: 'Jordan Example' }).displayName, 'Jordan Example', text);
        assert.equal(buildEvanPlannerContact([user(text)]).displayName, '', text);
    }
});

test('explicit name corrections and immediate name-question answers remain supported', () => {
    const checkIn = { displayName: 'Jordan Example' };
    assert.equal(buildEvanPlannerContact([user('Actually, my name is Avery Sample.')], checkIn).displayName, 'Avery Sample');
    for (const text of ['Avery Sample.', "I'm Avery Sample.", 'I am Avery Sample.', 'This is Avery Sample.']) {
        assert.equal(buildEvanPlannerContact([agent('What is your full name?'), user(text)], checkIn).displayName, 'Avery Sample', text);
    }
});

test('common phone wording and explicit negative corrections replace old working numbers', () => {
    assert.equal(buildEvanPlannerContact([user('My phone is 602-555-0123.')]).phone, '(602) 555-0123');
    for (const text of [
        'No, my phone number is not 602-555-0123; it is 480-555-0100.',
        "My phone number isn't 602-555-0123. Use 480-555-0100.",
        'My phone number is wrong. The correct number is 480-555-0100.',
    ]) {
        const model = buildEvanPlannerContact([user('My phone number is 602-555-0123.'), user(text)]);
        assert.equal(model.phone, '(480) 555-0100', text);
    }
    assert.equal(buildEvanPlannerContact([user('My phone is 602-555-0123.'), user('My phone number is not 602-555-0123.')]).phone, '');
});

test('negative email correction never reuses the rejected spoken address', () => {
    const turns = [user('My email is old@example.test.'), user('My email is not old@example.test; it is new@example.test.')];
    const guest = buildEvanPlannerContact(turns);
    assert.equal(guest.email, 'new@example.test');
    assert.equal(guest.emailSource, 'spoken');
    const checkedIn = buildEvanPlannerContact(turns, { email: 'checkin@example.test' });
    assert.equal(checkedIn.email, 'checkin@example.test');
    assert.equal(checkedIn.emailSource, 'check-in');
    assert.equal(checkedIn.proposedEmail, 'new@example.test');
    const rejectedOnly = buildEvanPlannerContact([user('My email is old@example.test.'), user('My email is not old@example.test.')]);
    assert.equal(rejectedOnly.email, '');
});

test('later unrelated negation does not discard a supplied contact value', () => {
    const model = buildEvanPlannerContact([
        user('My phone is 602-555-0123, but not after five.'),
        user("My email is sample@example.test. I'm not moving tomorrow."),
    ]);
    assert.equal(model.phone, '(602) 555-0123');
    assert.equal(model.email, 'sample@example.test');
});
