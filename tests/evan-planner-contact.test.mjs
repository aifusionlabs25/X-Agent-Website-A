import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildEvanPlannerContact } from '../lib/anam/evan-planner-contact.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });

test('run47 bundled self-introduction captures the name without a preceding name question', () => {
    const turns = [
        agent("If you'd like, I can email a short recap after the call so the team can follow up on an estimate."),
        user("Sure. I'm Jordan Avery. My phone is 202 555 0146 and my email is jordan.avery@example.com."),
        agent('Thanks Jordan. Did I get that right, two oh two, five five five, oh one four six, and jordan.avery at example dot com?'),
        user("Yes, that's exactly right."),
    ];
    const model = buildEvanPlannerContact(turns);
    assert.equal(model.displayName, 'Jordan Avery');
    assert.equal(model.phone, '(202) 555-0146');
    assert.equal(model.email, 'jordan.avery@example.com');
    assert.equal(model.phoneConfirmed, true);
    assert.equal(model.spokenEmailConfirmed, true);
    assert.equal(buildEvanPlannerContact([...turns, user('Hide my name.')]).displayName, '');
});

test('bundled introductions require a self-identification and explicit personal contact, not prose or agent speech', () => {
    for (const introduction of ["I'm", 'I am', 'This is']) {
        const text = `Okay, ${introduction} Casey Morgan, and my email is casey@example.com.`;
        assert.equal(buildEvanPlannerContact([user(text)]).displayName, 'Casey Morgan', text);
        assert.equal(buildEvanPlannerContact([agent(text)]).displayName, '', text);
    }
    for (const text of [
        "Sure. I'm moving from Mesa. My phone is 202 555 0146.",
        "Sure. I'm All Set. My phone is 202 555 0146.",
        "Sure. I'm Jordan Avery. The office phone is 202 555 0146.",
        'My friend is Jordan Avery. My email is casey@example.com.',
        'For example, I am Jordan Avery. My email is casey@example.com.',
        '"I am Jordan Avery." My email is casey@example.com.',
        "Sure. I'm Jordan Avery. My phone is not available.",
    ]) assert.equal(buildEvanPlannerContact([user(text)]).displayName, '', text);
});

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
    assert.deepEqual(model, { displayName: '', phone: '', phoneConfirmed: false, email: '', emailSource: null, spokenEmailConfirmed: false, proposedEmail: '', contactPreference: '', callbackWindow: '', hiddenFields: [] });
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

test('a full self-introduction in a guest call updates the name without treating move descriptions as names', () => {
    const model = buildEvanPlannerContact([
        user("Hi Evan, I'm Taylor Reid. I'm moving a one bedroom apartment from Phoenix to Mesa."),
    ]);
    assert.equal(model.displayName, 'Taylor Reid');
    for (const statement of ["I'm moving from Mesa.", "I'm really worried about packing.", "This is complicated.", "I'm Taylor."]) {
        assert.equal(buildEvanPlannerContact([user(statement)]).displayName, '', statement);
    }
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
    assert.equal(model.spokenEmailConfirmed, false);
});

test('visitor confirmation updates live contact labels without changing recap consent', () => {
    const model = buildEvanPlannerContact([
        user('My phone number is 202-555-0146.'),
        agent('Two oh two, five five five, oh one four six. Did I get that right?'),
        user('Yes.'),
        user('My email is jordan.avery@example.com.'),
        agent('Jordan dot Avery at example dot com. Did I get that right?'),
        user("That's right."),
    ]);
    assert.equal(model.phoneConfirmed, true);
    assert.equal(model.spokenEmailConfirmed, true);
    assert.equal(model.emailSource, 'spoken');
});

test('the live compound contact answer fills the guest cards and recognizes a comma-prefaced confirmation', () => {
    const model = buildEvanPlannerContact([
        agent('If you share a name, callback number, and email, I can gather that request for possible follow-up.'),
        user("Sure, Jordan Avery, phone number 202-555-0146, email jordan.avery@example.com. But if that isn't needed here, that's fine."),
        agent('Thanks, Jordan. Let me make sure I got those right. Phone: two oh two, five five five, oh one four six. Email: jordan dot avery at example dot com. Did I get that right?'),
        user("Yes, that's right, for the phone. And yes, that's perfect for the email."),
    ]);
    assert.equal(model.displayName, 'Jordan Avery');
    assert.equal(model.phone, '(202) 555-0146');
    assert.equal(model.phoneConfirmed, true);
    assert.equal(model.email, 'jordan.avery@example.com');
    assert.equal(model.emailSource, 'spoken');
    assert.equal(model.spokenEmailConfirmed, true);
    assert.equal(buildEvanPlannerContact([user('Sure, Jordan Avery, phone number 202-555-0146, email jordan.avery@example.com.')]).email, '',
        'an unprompted contact label is not contact consent');
});

test('run-43 volunteered contact bundle fills all cards after a callback offer', () => {
    const model = buildEvanPlannerContact([
        agent('Would you like to leave a callback number, or would you prefer to reach out to Mullins Moving directly tomorrow?'),
        user("I'm happy to leave my info for a possible follow up. Jordan Avery, phone 2025550146, email jordan.avery@example.com. What happens next?"),
        agent('Thanks, Jordan. Let me make sure I got that right: Jordan Avery, phone 2-0-2, 5-5-5, 0-1-4-6, and email jordan dot avery at example dot com. Did I get that right?'),
        user("Yes, that's right."),
    ]);
    assert.equal(model.displayName, 'Jordan Avery');
    assert.equal(model.phone, '(202) 555-0146');
    assert.equal(model.phoneConfirmed, true);
    assert.equal(model.email, 'jordan.avery@example.com');
    assert.equal(model.spokenEmailConfirmed, true);
    assert.equal(buildEvanPlannerContact([user('Jordan Avery, phone 2025550146, email jordan.avery@example.com.')]).email, '',
        'an unlabeled third-party list alone is not a self-offered email');
});

test('run-44 callback answer preserves volunteered name and email without falsely confirming email', () => {
    const turns = [
        agent("I can't schedule a call, but I can pass along a request for an estimate. What's the best number to reach you at?"),
        user('Sure, uh Jordan Avery, phone number 202-555-0146, email jordan.avery@example.com.'),
        agent('Thanks, Jordan. Let me make sure I have that right: 2-0-2, 5-5-5, 0-1-4-6. Did I get that right?'),
        user("Yes, that's right."),
        agent("To make sure they can reach you, I'll need your email — can you give me that?"),
        user("Yeah, it's jordan.avery@example.com, but if that isn't needed here, that's fine."),
    ];
    const model = buildEvanPlannerContact(turns);
    assert.equal(model.displayName, 'Jordan Avery');
    assert.equal(model.phone, '(202) 555-0146');
    assert.equal(model.phoneConfirmed, true);
    assert.equal(model.email, 'jordan.avery@example.com');
    assert.equal(model.spokenEmailConfirmed, false, 'the agent never read back the email');
    assert.equal(buildEvanPlannerContact([turns[1]]).displayName, '', 'an uninvited bundle is not a named guest');
});

test('a provider-split contact offer still fills the next completed visitor turn, but not a later one', () => {
    const offer = [
        agent('Would you like to leave a callback number?'),
        user("I'm happy to leave my info for a possible follow up."),
        user('Jordan Avery, phone 2025550146, email jordan.avery@example.com.'),
    ];
    const model = buildEvanPlannerContact(offer);
    assert.equal(model.displayName, 'Jordan Avery');
    assert.equal(model.phone, '(202) 555-0146');
    assert.equal(model.email, 'jordan.avery@example.com');
    assert.equal(buildEvanPlannerContact([
        ...offer.slice(0, 2), agent('What size is the home?'),
        user('Jordan Avery, phone 2025550146, email jordan.avery@example.com.'),
    ]).email, '', 'an intervening agent turn ends the offer context');
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

test('a courtesy-prefaced answer to a direct name request appears in the live brief', () => {
    assert.equal(buildEvanPlannerContact([agent('May I have your name?'), user('Sure, Alex Morgan.')]).displayName, 'Alex Morgan');
    assert.equal(buildEvanPlannerContact([user('Sure, Alex Morgan.')]).displayName, '');
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
