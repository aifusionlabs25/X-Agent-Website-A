import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicEvanCapture } from '../lib/anam/evan-deterministic-capture.ts';
import { projectEvanCapturePlan, projectEvanCaptureContact, projectEvanCaptureIntake } from '../lib/anam/evan-capture.ts';
import { buildEvanEmailBundle } from '../lib/anam/evan-agentmail-templates.ts';

const user = content => ({ role: 'user', content });
function replay(t, turns) {
    t.mock.method(globalThis, 'fetch', () => assert.fail('Local transcript replay must not use a provider'));
    const record = buildDeterministicEvanCapture(turns, 1);
    const plan = projectEvanCapturePlan(record);
    const emails = buildEvanEmailBundle({ displayName: 'Local Test', verifiedEmail: 'local@example.test',
        externalSessionId: 'local-qualified-details', sessionStartedAt: '2026-10-21T12:00:00Z',
        sessionEndedAt: '2026-10-21T12:03:00Z', turns, captureRecord: record });
    return { record, plan, emails };
}

test('scoped additions preserve two literal groups instead of replacing or inventing a total', t => {
    for (const [item, room] of [['armchair', 'den'], ['woven pod', 'study'], ['folding cart', 'workshop']]) {
        const { plan, emails } = replay(t, [user(`We have two ${item}s.`), user(`There's one more ${item} in the ${room} to add.`)]);
        assert.deepEqual(plan.inventoryItems, [`two ${item}s`, `one more ${item} [Scope: ${room}]`]);
        for (const audience of ['visitor', 'sales', 'admin']) {
            assert.ok(emails[audience].text.includes(`two ${item}s`));
            assert.ok(emails[audience].text.includes(`one more ${item} [Scope: ${room}]`));
        }
    }
});

test('unscoped additional amounts cannot overwrite a known total', t => {
    const { plan } = replay(t, [user('We have two woven pods.'), user('Add one more woven pod.')]);
    assert.deepEqual(plan.inventoryItems, ['two woven pods']);
    assert.ok(plan.uncertainties.some(value => value.includes('Add one more woven pod')));
});

test('scoped additions retain tentative intent and do not capture examples or third-party belongings', t => {
    const base = user('We have two woven pods.');
    const tentative = replay(t, [base, user('Maybe add one more woven pod in the den.')]);
    assert.deepEqual(tentative.plan.inventoryItems, ['two woven pods']);
    assert.ok(tentative.plan.uncertainties.some(value => value.startsWith('Possible:')));
    for (const text of [
        'For example, there is one more woven pod in the den to add.',
        'My neighbor said there is one more woven pod in the den to add.',
        'Is there one more woven pod in the den?',
    ]) assert.deepEqual(replay(t, [base, user(text)]).plan.inventoryItems, ['two woven pods']);
});

test('removing a scoped extra group leaves the original group intact', t => {
    const { plan } = replay(t, [user('We have two armchairs.'), user('There is one more armchair in the den to add.'),
        user('Remove the armchair in the den.')]);
    assert.deepEqual(plan.inventoryItems, ['two armchairs']);
});

test('date flexibility remains visible in planner and every email without inference', t => {
    for (const text of [
        'Early November would work, but the date is flexible.',
        'We are moving in late December, and our move date is not flexible.',
        'The move is next month but flexible on the date.',
    ]) {
        const { plan, emails } = replay(t, [user(text)]);
        assert.match(plan.timing, /flexible/);
        assert.ok(text.includes(plan.timing));
        for (const audience of ['visitor', 'sales', 'admin']) assert.ok(emails[audience].text.includes(plan.timing));
    }
});

test('a later new move date replaces the old date and its flexibility together', t => {
    const { plan } = replay(t, [user('Early November would work, but the date is flexible.'), user('Actually, November 23.')]);
    assert.equal(plan.timing, 'November 23');
});

test('flexible packing or callback talk cannot become move-date flexibility', t => {
    const { plan } = replay(t, [user('Moving in early November, and packing is flexible.'),
        user('Call me next month, but the date is flexible.')]);
    assert.equal(plan.timing, 'early November');
});

test('property unit identifiers are preserved without creating inventory quantities', t => {
    for (const unit of ['unit 12', 'suite B4', 'apt. 7']) {
        const { plan, emails } = replay(t, [user(`It is a two-bedroom apartment, ${unit}. We have one twin bed.`)]);
        assert.equal(plan.propertyScope, `two-bedroom apartment, ${unit}`);
        assert.deepEqual(plan.inventoryItems, ['one twin bed']);
        for (const audience of ['visitor', 'sales', 'admin']) assert.ok(emails[audience].text.includes(unit));
    }
});

test('a property correction replaces the previous unit rather than retaining both', t => {
    const { plan } = replay(t, [user('A two-bedroom apartment, unit 12.'), user('Correction: a two-bedroom apartment, unit 14.')]);
    assert.equal(plan.propertyScope, 'two-bedroom apartment, unit 14');
});

test('a uniquely identified item keeps its explicit handling note through planner and email drafts', t => {
    const { plan, emails } = replay(t, [user('We have a cedar hope chest and two reed cases. The chest has a cracked lid, so please be careful with it.')]);
    assert.deepEqual(plan.inventoryItems, ['a cedar hope chest', 'two reed cases']);
    assert.ok(plan.carePriorities.some(value => value.includes('cracked lid') && value.includes('cedar hope chest')));
    for (const audience of ['visitor', 'sales', 'admin']) assert.ok(emails[audience].text.includes('cracked lid'));
});

test('an included item can carry a fixed-part note without authorizing a service or counting its dimensions', t => {
    const { plan } = replay(t, [user("What's the safest way to move my 90-inch sofa? It's on our move list, and the legs do not come off.")]);
    assert.deepEqual(plan.inventoryItems, ['90-inch sofa']);
    assert.ok(plan.carePriorities.some(value => value.includes('legs do not come off')));
    assert.deepEqual(plan.services, []);
});

test('an explicit repair replaces the old item-part warning, while removal hides its handling note', t => {
    const base = [user('We have a cedar hope chest. It has a cracked lid.'), user('The chest lid is repaired.')];
    const repaired = replay(t, base);
    assert.ok(repaired.plan.carePriorities.some(value => value.includes('repaired')));
    assert.ok(!repaired.plan.carePriorities.some(value => value.includes('cracked')));
    const removed = replay(t, [...base, user('Remove the cedar hope chest.')]);
    assert.deepEqual(removed.plan.inventoryItems, []);
    assert.deepEqual(removed.plan.carePriorities, []);
    const restored = replay(t, [...base, user('Remove the cedar hope chest.'), user('Put the cedar hope chest back.')]);
    assert.ok(restored.plan.carePriorities.some(value => value.includes('repaired')));
});

test('ambiguous item references and agent-only or third-party handling facts cannot become confirmed care', t => {
    for (const tail of [
        user('It has a cracked lid.'),
        { role: 'agent', content: 'The chest has a cracked lid.' },
        user('My neighbor says the chest has a cracked lid.'),
        user('For example, the chest has a cracked lid.'),
    ]) {
        const { plan } = replay(t, [user('We have a cedar chest and a woven chest.'), tail]);
        assert.deepEqual(plan.carePriorities, []);
    }
});

test('item descriptions preserve drawers, material and dimensions without changing item count', t => {
    const { plan, emails } = replay(t, [user('We are taking one dresser. It has six drawers.'),
        { role: 'agent', content: 'Anything special about the dresser?' },
        user('That dresser is solid oak. The same one I mentioned is about five feet wide.')]);
    assert.deepEqual(plan.inventoryItems, ['one dresser']);
    for (const detail of ['six drawers', 'solid oak', 'about five feet wide']) {
        assert.ok(plan.carePriorities.some(value => value.includes(detail)), detail);
        for (const audience of ['visitor', 'sales', 'admin']) assert.ok(emails[audience].text.includes(detail));
    }
});

test('explicit material corrections replace prior material, not the inventory itself', t => {
    const { plan } = replay(t, [user('We have one dresser. It is solid oak.'), user('Actually, the dresser is made of pine.')]);
    assert.deepEqual(plan.inventoryItems, ['one dresser']);
    assert.ok(plan.carePriorities.some(value => value.includes('made of pine')));
    assert.ok(!plan.carePriorities.some(value => value.includes('solid oak')));
});

test('recap refusal stays separate from retained contact and requested coordinator follow-up', t => {
    const turns = [user('My email is jae.kim@example.test, and my name is Jae Kim.'),
        user("Don't send me a recap email, but keep my contact details on the move notes. I still want the coordinator to contact me by email.")];
    const { record, emails } = replay(t, turns);
    const contact = projectEvanCaptureContact(record);
    assert.equal(contact.email, 'jae.kim@example.test');
    assert.equal(contact.displayName, 'Jae Kim');
    assert.deepEqual(contact.hiddenFields, []);
    assert.match(contact.contactPreference, /contact me by email/);
    assert.match(contact.contactPreference, /Don't send me a recap email/);
    assert.equal(record.facts.filter(f => f.category === 'recapPreference').length, 1);
    assert.ok(projectEvanCaptureIntake(record).contactPreferences.some(value => value.includes("Don't send me a recap email")));
    for (const audience of ['sales', 'admin']) assert.ok(emails[audience].text.includes("Don't send me a recap email"));
    // Building drafts is not sending them; capture does not grant recipient authority.
    assert.equal(contact.spokenEmailConfirmed, false);
    const changed = replay(t, [...turns, user('Actually, send me a recap email.')]);
    assert.equal(changed.record.facts.find(f => f.category === 'recapPreference').value, 'Actually, send me a recap email');
    assert.doesNotMatch(projectEvanCaptureContact(changed.record).contactPreference, /Don't send/);
});

test('questions, hypothetical examples and third-party recap choices do not set caller preferences', t => {
    for (const turn of [user('Can you send me a recap email?'), user('For example, do not send me a recap email.'),
        user('My neighbor said do not send me a recap email.'), { role: 'agent', content: 'Do not send me a recap email.' }]) {
        assert.ok(!replay(t, [turn]).record.facts.some(f => f.category === 'recapPreference'));
    }
});

test('uncounted items keep individual uncertainty and a later count clears only its own note', t => {
    const base = [user("Our inventory is bookshelves, dining chairs, and plastic totes. I haven't counted those yet.")];
    const first = replay(t, base);
    for (const item of ['bookshelves', 'dining chairs', 'plastic totes']) {
        assert.ok(first.plan.uncertainties.some(value => value.includes(`Scope: ${item}`)));
    }
    const later = replay(t, [...base, user('Change the dining chairs to six.')]);
    assert.ok(later.plan.inventoryItems.includes('six dining chairs'));
    assert.ok(!later.plan.uncertainties.some(value => value.includes('Scope: dining chairs')));
    assert.ok(later.plan.uncertainties.some(value => value.includes('Scope: plastic totes')));
    const removed = replay(t, [...base, user('Remove the plastic totes.')]);
    assert.ok(!removed.plan.uncertainties.some(value => value.includes('Scope: plastic totes')));
});
