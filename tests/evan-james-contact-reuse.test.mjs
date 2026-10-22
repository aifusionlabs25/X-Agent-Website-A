import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { extractEvanContactIdentity, extractEvanContactIntent, normalizeEvanContactPhone, normalizeEvanContactEmail } from '../lib/anam/evan-contact-identity.ts';
import { buildEvanPlannerContact } from '../lib/anam/evan-planner-contact.ts';
import { buildDeterministicEvanCapture } from '../lib/anam/evan-deterministic-capture.ts';
import { projectEvanCaptureContact } from '../lib/anam/evan-capture.ts';
import { buildEvanEmailBundle } from '../lib/anam/evan-agentmail-templates.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
const visible = model => ({ name: model.displayName, phone: model.phone, email: model.email });

test('volunteered full contact is independent of the preceding move question', () => {
    const text = 'My contact info is Avery Stone, 602-555-0138, email is avery@example.test.';
    assert.deepEqual(visible(buildEvanPlannerContact([agent('What happened during the move?'), user(text)])), {
        name: 'Avery Stone', phone: '(602) 555-0138', email: 'avery@example.test',
    });
});

test('a callback or combined question accepts an independent name and sibling spoken email', () => {
    assert.deepEqual(visible(buildEvanPlannerContact([
        agent('Can I get your name and a good callback number?'),
        user('Sure. Avery Stone, 602-555-0138. And email is avery at example.test.'),
    ])), { name: 'Avery Stone', phone: '(602) 555-0138', email: 'avery@example.test' });
    assert.deepEqual(visible(buildEvanPlannerContact([
        agent('What is your callback number?'), user('Avery Stone, 602-555-0138.'),
    ])), { name: 'Avery Stone', phone: '(602) 555-0138', email: '' });
});

test('Unicode, particles, apostrophes and one-word identities retain their exact own spans', () => {
    for (const name of ['Maëlle Dupré', 'Íñigo de la Cruz', "Siobhán O’Neill", 'Cher', 'morgan vale']) {
        const text = `My contact details are ${name}; my phone is 623-555-0164; my email is person@example.test.`;
        const identity = extractEvanContactIdentity(text, 'Which items need packing?');
        assert.deepEqual(identity.name, { value: name, quote: name }, name);
        for (const field of ['name', 'phone', 'email']) assert.ok(text.includes(identity[field].quote), field);
        assert.equal(buildEvanPlannerContact([user(text)]).displayName, name.replace(/[’]/g, "'"));
    }
});

test('source evidence remains literal while phone and spoken email values normalize', () => {
    const text = 'My name is Nia Vale. My phone is six two three, five five five, zero one six four. My email is nia dot vale at sample dot test.';
    assert.deepEqual(extractEvanContactIdentity(text), {
        name: { value: 'Nia Vale', quote: 'Nia Vale' },
        phone: { value: '(623) 555-0164', quote: 'six two three, five five five, zero one six four' },
        email: { value: 'nia.vale@sample.test', quote: 'nia dot vale at sample dot test' },
        rejected: [],
    });
});

test('a direct identity survives an independently punctuated move or transliteration clause', () => {
    for (const [text, question, expected] of [
        ["Sure. I’m Keira Moss. You can reach me at 623-555-0164.", 'What is your callback number?', 'Keira Moss'],
        ['Please put the move under Sofía O’Connell-Ruiz.', '', 'Sofía O’Connell-Ruiz'],
        ['Please record my booking under Amina Mensah.', '', 'Amina Mensah'],
        ['王 芳. You can write it as Wang Fang.', 'What is your name?', '王 芳'],
        ['My name is Priya Rami. Tempe to Flagstaff, five boxes.', '', 'Priya Rami'],
        ['My email is nia@example.test and my name is Nia Vale.', '', 'Nia Vale'],
    ]) assert.equal(extractEvanContactIdentity(text, question).name?.value, expected, text);
});

test('contact clause order cannot make an email domain look like a hypothetical marker', () => {
    const model = buildEvanPlannerContact([user('My email is nia@example.test and my phone is 623-555-0164.')]);
    assert.equal(model.email, 'nia@example.test');
    assert.equal(model.phone, '(623) 555-0164');
});

test('email local parts, addresses and unsupported phone formats do not create identity', () => {
    for (const text of ['morgan.vale@example.test', 'morgan dot vale at example dot test', '623-555-0164']) {
        assert.equal(extractEvanContactIdentity(text, 'What is your email or callback number?').name, null, text);
    }
    assert.equal(extractEvanContactIdentity('The storage address is 6235550164 Cedar Street.', 'What is your phone number?').phone, null);
    assert.equal(normalizeEvanContactPhone('+44 20 7946 0958'), '');
    assert.equal(normalizeEvanContactPhone('623-555-0164 or 480-555-0192'), '');
    assert.equal(normalizeEvanContactEmail('n i a at example dot test'), '');
});

test('ordinary acknowledgments and unavailable answers never replace a known name', () => {
    for (const answer of ['Unknown.', 'Declined.', 'Not sure.', "Yes, that’s right.", 'Sounds good.', 'Okay, perfect.', 'No thanks.']) {
        const model = buildEvanPlannerContact([agent('What is your name?'), user(answer)], { displayName: 'Nia Vale' });
        assert.equal(model.displayName, 'Nia Vale', answer);
    }
    assert.deepEqual(visible(buildEvanPlannerContact([
        agent('What is your name and number?'), user('Unknown. My phone is 623-555-0164.'),
    ])), { name: '', phone: '(623) 555-0164', email: '' });
});

test('agent data, third-party contexts, hypothetical and quoted details are not caller facts', () => {
    const own = 'My contact details are Nia Vale, 623-555-0164, email is nia@example.test.';
    assert.deepEqual(visible(buildEvanPlannerContact([agent(own)])), { name: '', phone: '', email: '' });
    for (const question of ['What is your neighbor’s name and phone?', 'What is your landlord’s email?', 'What is her callback number?']) {
        const identity = extractEvanContactIdentity('Nia Vale, 623-555-0164, nia@example.test.', question);
        assert.deepEqual(identity, { name: null, phone: null, email: null, rejected: [] }, question);
    }
    for (const text of [
        `For example, ${own}`, `Hypothetically, ${own}`, `If ${own}`,
        `He said “${own}”`, `The customer wrote "${own}"`,
        'My sister’s phone is 623-555-0164 and her email is nia@example.test.',
    ]) {
        assert.deepEqual(extractEvanContactIdentity(text), { name: null, phone: null, email: null, rejected: [] }, text);
    }
});

test('volunteered corrections replace prior identity and channels without restoring rejected values', () => {
    const turns = [
        user('My contact info is Felix Marlow, 623-555-0164, email is felix@example.test.'),
        user('Actually, my contact information is Rowan Vale, 480-555-0184, email is rowan@example.test.'),
    ];
    assert.deepEqual(visible(buildEvanPlannerContact(turns)), {
        name: 'Rowan Vale', phone: '(480) 555-0184', email: 'rowan@example.test',
    });
    turns.push(user('My phone is not 480-555-0184. My email is not rowan@example.test.'));
    assert.deepEqual(visible(buildEvanPlannerContact(turns)), { name: 'Rowan Vale', phone: '', email: '' });
    turns.push(user('Yes, that’s right.'));
    assert.deepEqual(visible(buildEvanPlannerContact(turns)), { name: 'Rowan Vale', phone: '', email: '' });
});

test('same-turn channel corrections keep only the explicit replacement', () => {
    const identity = extractEvanContactIdentity('My number is not 623-555-0164; use 480-555-0184 instead. My email is not old@example.test; use current@example.test instead.');
    assert.equal(identity.phone?.value, '(480) 555-0184');
    assert.equal(identity.email?.value, 'current@example.test');
    assert.equal(extractEvanContactIdentity('My phone is 623-555-0164 or 480-555-0184.').phone, null);
    assert.equal(extractEvanContactIdentity('My email is one@example.test or two@example.test.').email, null);
});

test('per-field refusal and restoration preserve sibling fields and hidden check-in boundaries', () => {
    const checkIn = Object.freeze({ displayName: 'Nia Vale', email: 'checkin@example.test' });
    const turns = [user('My phone is 623-555-0164.'), user('I prefer not to share my email.')];
    let model = buildEvanPlannerContact(turns, checkIn);
    assert.equal(model.email, ''); assert.equal(model.phone, '(623) 555-0164');
    assert.ok(model.hiddenFields.includes('email'));
    turns.push(user('My email is spoken@example.test.'));
    model = buildEvanPlannerContact(turns, checkIn);
    assert.equal(model.email, 'spoken@example.test'); assert.equal(model.emailSource, 'spoken');
    assert.equal(model.proposedEmail, ''); assert.equal(checkIn.email, 'checkin@example.test');
    assert.equal(model.spokenEmailConfirmed, false);
});

test('spoken corrections and confirmations never replace authoritative check-in email', () => {
    const checkIn = Object.freeze({ email: 'checkin@example.test' });
    const turns = [user('My email is spoken@example.test.'), agent('Was that spoken@example.test?'), user('Yes, correct.')];
    const model = buildEvanPlannerContact(turns, checkIn);
    assert.equal(model.email, checkIn.email); assert.equal(model.emailSource, 'check-in');
    assert.equal(model.proposedEmail, 'spoken@example.test'); assert.equal(model.spokenEmailConfirmed, true);
});

test('borrowed question and split-offer context expires after its immediately adjacent answer', () => {
    const model = buildEvanPlannerContact([
        agent('What is your name?'), user('Nia Vale.'), user('Morgan Finch.'),
        user('I can share my contact details.'), user('623-555-0164.'), user('480-555-0184.'),
    ]);
    assert.equal(model.displayName, 'Nia Vale'); assert.equal(model.phone, '(623) 555-0164');
});

test('the adapted contact helper remains browser-safe and does not couple James runtime or delivery', () => {
    const source = readFileSync(new URL('../lib/anam/evan-contact-identity.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:from\s+['"]|import\s*\()['"][^'"]*(?:james|server-only|node:)/);
    assert.doesNotMatch(source, /\b(?:fetch|localStorage|sessionStorage|sendEmail|process\.env|document\.|window\.)\b/);
});

test('callback modifiers before or after the time retain a literal source span', () => {
    for (const [text, expected] of [
        ['Afternoons are better for a callback.', 'Afternoons'],
        ['For a callback, weekdays after 5 pm are best.', 'weekdays after 5 pm'],
        ['Evenings would be ideal for a call.', 'Evenings'],
        ['The best time to reach me is Monday between 9 and 11 am.', 'Monday between 9 and 11 am'],
        ['Call me tomorrow after 3 pm.', 'tomorrow after 3 pm'],
        ['Phone only please. Mornings work best.', 'Mornings'],
    ]) {
        const intent = extractEvanContactIntent(text);
        assert.deepEqual(intent.callbackWindow, { value: expected, quote: expected }, text);
        assert.equal(buildEvanPlannerContact([user(text)]).callbackWindow, expected, text);
    }
});

test('callback context does not promote move times, questions, quoted or third-party preferences', () => {
    for (const text of [
        'Afternoons are better.', 'The move should happen in the afternoon.',
        'Phone only please. Moving mornings are best.',
        'For example, call me tomorrow after 4 pm.',
        'If you call me tomorrow after 4 pm, would that help?',
        'My sister wants a callback in the morning.',
        'She said "call me tomorrow at 4 pm".',
        'Is tomorrow afternoon better for a callback?',
    ]) assert.equal(extractEvanContactIntent(text).callbackWindow, null, text);
    assert.deepEqual(extractEvanContactIntent('Weekdays after 4 pm.', 'What is the best time to call?').callbackWindow,
        { value: 'Weekdays after 4 pm', quote: 'Weekdays after 4 pm' });
    assert.equal(extractEvanContactIntent('Weekdays after 4 pm.', 'What is the best time for the move?').callbackWindow, null);
    assert.equal(extractEvanContactIntent('Weekdays after 4 pm.', 'When can I call your sister?').callbackWindow, null);
});

test('a sibling phone clause cannot turn location or status time into callback timing', () => {
    for (const text of [
        'Sure, I’m moving next week. I’m a cabinet maker, and I’m in Mesa today. You can reach me at 480-555-0105.',
        'I am in Tempe tomorrow. You can reach me at 623-555-0164.',
        'Phone only please. Today I am in Chandler.',
        'You can reach me at 623-555-0164, and I am in Flagstaff tomorrow.',
    ]) {
        assert.equal(extractEvanContactIntent(text).callbackWindow, null, text);
        assert.equal(buildEvanPlannerContact([user(text)]).callbackWindow, '', text);
        const record = buildDeterministicEvanCapture([user(text)], 1);
        assert.equal(projectEvanCaptureContact(record).callbackWindow, '', text);
    }
});

test('an actual callback-time clause survives unrelated location statements in the same turn', () => {
    for (const [text, expected] of [
        ['I am in Tempe today. Call me tomorrow after 4 pm.', 'tomorrow after 4 pm'],
        ['Call me tomorrow after 4 pm. I am in Tempe today.', 'tomorrow after 4 pm'],
        ['I am in Tempe today, call me after 4 pm.', 'after 4 pm'],
        ['Phone only please. Today I am in Tempe. Afternoons are best.', 'Afternoons'],
        ['I am in Mesa today. For a callback, weekdays after 5 pm are best.', 'weekdays after 5 pm'],
    ]) {
        assert.deepEqual(extractEvanContactIntent(text).callbackWindow, { value: expected, quote: expected }, text);
        assert.equal(projectEvanCaptureContact(buildDeterministicEvanCapture([user(text)], 1)).callbackWindow, expected, text);
    }
});

test('requested callback timing survives phone values, approximate times and request purpose without scheduling a call', t => {
    t.mock.method(globalThis, 'fetch', () => { assert.fail('Contact capture must remain local'); });
    for (const [text, expected] of [
        ['Call me tomorrow around 4 pm.', 'tomorrow around 4 pm'],
        ['You can reach me at 623-555-0164 tomorrow afternoon.', 'tomorrow afternoon'],
        ['Could someone call tomorrow about an estimate?', 'tomorrow'],
        ['Could someone call me Friday morning regarding the boxes?', 'Friday morning'],
    ]) {
        const turns = [user(text)];
        const intent = extractEvanContactIntent(text);
        assert.deepEqual(intent.callbackWindow, { value: expected, quote: expected }, text);
        const record = buildDeterministicEvanCapture(turns, 1);
        assert.equal(projectEvanCaptureContact(record).callbackWindow, expected, text);
        const bundle = buildEvanEmailBundle({ displayName: 'Synthetic Caller', verifiedEmail: 'caller@example.test',
            externalSessionId: 'callback-local-replay', sessionStartedAt: '2026-10-21T12:00:00Z',
            sessionEndedAt: '2026-10-21T12:03:00Z', turns, captureRecord: record });
        for (const audience of ['visitor', 'admin', 'sales']) {
            assert.ok(bundle[audience].text.includes(expected), `${audience} lost requested callback: ${text}`);
        }
        assert.ok(record.facts.filter(fact => fact.category === 'callbackWindow')
            .every(fact => fact.status === 'asserted' && fact.value === expected));
    }
    for (const text of [
        'I will be in Mesa tomorrow around 4 pm. You can reach me at 623-555-0164.',
        'Could someone move the boxes tomorrow about noon?',
        'My sister could call tomorrow about an estimate.',
        'For example, someone could call tomorrow about an estimate.',
    ]) assert.equal(extractEvanContactIntent(text).callbackWindow, null, text);
});

test('clearing contact fields does not swallow a later independent follow-up opt-out', () => {
    const turns = [user('My name is Nia Vale. My number is 623-555-0164. My email is nia@example.test. Call me tomorrow.')];
    turns.push(user('Clear all my contact details. I don’t want any follow-up.'));
    const model = buildEvanPlannerContact(turns, { email: 'checkin@example.test' });
    assert.deepEqual(visible(model), { name: '', phone: '', email: '' });
    assert.equal(model.callbackWindow, '');
    assert.equal(model.contactPreference, 'No follow-up requested');
    assert.deepEqual(extractEvanContactIntent('I don’t want any follow-up.').contactPreference,
        { value: 'No follow-up requested', quote: 'I don’t want any follow-up' });
    assert.ok(model.hiddenFields.includes('displayName')); assert.ok(model.hiddenFields.includes('phone')); assert.ok(model.hiddenFields.includes('email'));
    assert.ok(!model.hiddenFields.includes('contactPreference'));
});

test('clear-all does not revive a preference stated before that removal', () => {
    const model = buildEvanPlannerContact([user('Phone only please. Clear all my contact details.')]);
    assert.equal(model.contactPreference, ''); assert.ok(model.hiddenFields.includes('contactPreference'));
});

test('recap-email refusal and retained coordinator contact remain separate', () => {
    const checkIn = Object.freeze({ displayName: 'Nia Vale', email: 'checkin@example.test' });
    const text = 'Don’t send me a recap email, but keep my contact details. I still want the coordinator to contact me by email.';
    const model = buildEvanPlannerContact([user(text)], checkIn);
    assert.equal(model.displayName, checkIn.displayName); assert.equal(model.email, checkIn.email);
    assert.deepEqual(model.hiddenFields, []); assert.equal(model.contactPreference, 'Email');
    assert.deepEqual(extractEvanContactIntent(text).contactPreference,
        { value: 'Email', quote: 'contact me by email' });
    assert.equal(extractEvanContactIntent('Don’t send me a recap email.').contactPreference, null);
    assert.equal(extractEvanContactIntent('Send me a recap email.').contactPreference, null);
    assert.equal(extractEvanContactIntent('I don’t want any follow-up emails.').contactPreference, null, 'one channel refusal is not a global opt-out');
});

test('explicit later contact preference wins with exact evidence and clears obsolete callback time', () => {
    assert.deepEqual(extractEvanContactIntent('Please call me, but email only now.').contactPreference,
        { value: 'Email only', quote: 'email only' });
    assert.deepEqual(extractEvanContactIntent('Do not call me; text me instead.').contactPreference,
        { value: 'Text message', quote: 'text me' });
    const model = buildEvanPlannerContact([user('Call me tomorrow after 3 pm.'), user('I prefer email.')]);
    assert.equal(model.contactPreference, 'Email'); assert.equal(model.callbackWindow, '');
});

test('contact preference source spans are not manufactured from negative or reported requests', () => {
    for (const text of [
        'I do not prefer email.', 'Do not text me.',
        'My neighbor prefers a phone call.', 'He wants email only.',
        'For example, email only.', 'If I say email only, what happens?',
        'She said “phone only please”.', 'Is email only an option?',
    ]) assert.equal(extractEvanContactIntent(text).contactPreference, null, text);
});

test('actual deterministic capture retains exact callback and preference evidence across corrections', () => {
    const turns = [
        user('For a callback, weekdays after 5 pm are best.'),
        user('Email only now.'),
        user('Actually, please call me. Afternoons are better for a callback.'),
    ];
    const record = buildDeterministicEvanCapture(turns, turns.length);
    const projected = projectEvanCaptureContact(record);
    assert.equal(projected.callbackWindow, 'Afternoons');
    assert.equal(projected.contactPreference.toLowerCase(), 'please call me');
    for (const fact of record.facts.filter(value => ['contactPreference', 'callbackWindow'].includes(value.category))) {
        assert.ok(fact.evidence.some(evidence => turns[evidence.turn].content.includes(evidence.quote)));
        assert.ok(fact.evidence.some(evidence => evidence.quote.toLowerCase().includes(fact.value.toLowerCase())));
    }
});

test('actual deterministic capture keeps field removals and later opt-out in the same source turn', () => {
    const turns = [
        user('My name is Nia Vale. My number is 623-555-0164. My email is nia@example.test.'),
        user('Clear all my contact details. I don’t want any follow-up.'),
    ];
    const record = buildDeterministicEvanCapture(turns, turns.length);
    const projected = projectEvanCaptureContact(record);
    assert.deepEqual(visible(projected), { name: '', phone: '', email: '' });
    assert.match(projected.contactPreference, /don['’]t want any follow-up/iu);
    assert.ok(record.facts.some(fact => fact.category === 'contactPreference' && fact.status === 'asserted'));
    assert.ok(record.facts.filter(fact => ['name', 'phone', 'email'].includes(fact.category)).every(fact => fact.status === 'removed'));
});
