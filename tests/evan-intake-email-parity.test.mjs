import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvanEmailBundle, buildEvanMovingIntake } from '../lib/anam/evan-agentmail-templates.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
const route = user('I am moving from Phoenix to Mesa.');
const bundleFor = turns => buildEvanEmailBundle({
    displayName: 'Avery Example', verifiedEmail: 'avery@example.test', externalSessionId: 'synthetic-parity-session',
    sessionStartedAt: '2026-10-17T22:00:00Z', sessionEndedAt: '2026-10-17T22:02:00Z', turns,
});

test('emails preserve the same grounded city readback and explicit visitor confirmation as the planner', () => {
    const turns = [user('One bedroom, probably Mesa.'), user('Right, yes, Phoenix to Mason.'),
        agent('Just to confirm, you are moving from Phoenix, Arizona to Mesa, Arizona, correct?'), user('That is right.')];
    assert.deepEqual(buildEvanMovingIntake(turns).originDestination, ['Phoenix → Mesa']);
    assert.deepEqual(buildEvanMovingIntake(turns.slice(0, -1)).originDestination, []);
});

test('agent-only suggested destinations and loose acknowledgments cannot become email route facts', () => {
    for (const turns of [
        [user('From Phoenix to Mason.'), agent('From Phoenix to Mesa, correct?'), user('That is right.')],
        [user('One bedroom, probably Mesa.'), user('From Phoenix to Mason.'), agent('From Phoenix to Mesa, correct?'), user('Yes.')],
        [agent('You are moving from Phoenix to Mesa.'), user('Thanks.')],
    ]) assert.ok(!buildEvanMovingIntake(turns).originDestination.some(value => /Mesa/.test(value)));
});

test('customer-handled packing is described as their plan, never requested packing assistance', () => {
    for (const phrase of ['I will handle packing.', "I'll do the packing myself.", 'We are handling the packing.', 'We will pack our own things.']) {
        const intake = buildEvanMovingIntake([route, user(phrase)]);
        assert.deepEqual(intake.packingPlan, ['Packing yourself'], phrase);
        assert.ok(!intake.services.some(value => /packing/i.test(value)), phrase);
    }
    const bundle = bundleFor([route, user('I will handle packing myself.')]);
    assert.match(bundle.visitor.text, /Packing plan: Packing yourself/);
    assert.match(bundle.sales.text, /Packing plan\n- Packing yourself/);
    assert.doesNotMatch(bundle.visitor.text, /Packing support|Full packing/);
    assert.doesNotMatch(bundle.sales.text, /Packing support|Full packing/);
});

test('an explicit self-packing correction removes an earlier requested packing service from email intake', () => {
    const intake = buildEvanMovingIntake([user('We need full packing.'), user('Actually I will handle packing.')]);
    assert.deepEqual(intake.services, []);
    assert.deepEqual(intake.packingPlan, ['Packing yourself']);
});

test('requested kitchen packing and mixed customer packing remain distinct from fully self-packed moves', () => {
    const kitchen = buildEvanMovingIntake([user('We need full packing for the kitchen.')]);
    assert.deepEqual(kitchen.services, ['Full kitchen packing']);
    const mixed = buildEvanMovingIntake([user('I will do most packing, but we need packing help for the kitchen.')]);
    assert.deepEqual(mixed.services, ['Packing support']);
    assert.deepEqual(mixed.packingPlan, ['Packing some items yourself; assistance requested']);
});

test('mid-month and a bare bedroom count survive into the email without inventing a specific date', () => {
    const intake = buildEvanMovingIntake([user('One bedroom.'), user('Mid-month but flexible.')]);
    assert.deepEqual(intake.propertyScope, ['One bedroom']);
    assert.match(intake.timing.join(' '), /mid-month.*flexible/i);
    assert.doesNotMatch(intake.timing.join(' '), /2026|October|October 15/i);
});

test('a possible Gilbert storage stop is visible in email notes but not in the settled route or scope', () => {
    const turns = [route, user('There may be a storage unit stop in Gilbert, but it is only a possibility.')];
    const intake = buildEvanMovingIntake(turns);
    assert.deepEqual(intake.originDestination, ['Phoenix → Mesa']);
    assert.match(intake.unknowns.join(' '), /Possible storage stop in Gilbert \(not confirmed\)/);
    assert.ok(!intake.moveType.includes('Multi-stop move'));
    assert.ok(!intake.propertyScope.includes('Storage unit stop'));
    assert.ok(!intake.missing.includes('storage-unit access details'));
    const bundle = bundleFor(turns);
    assert.match(bundle.visitor.text, /Possible storage stop in Gilbert \(not confirmed\)/);
    assert.match(bundle.sales.text, /Details still to confirm\n- Possible storage stop in Gilbert \(not confirmed\)/);
    assert.doesNotMatch(bundle.sales.text, /Route: Phoenix → Gilbert → Mesa/);
});

test('email parity changes retain authoritative delivery identity and sanitized transcript attachment', () => {
    const bundle = bundleFor([route, user('I will handle packing. My email is alternate@example.test.')]);
    assert.match(bundle.sales.text, /avery@example\.test \(authoritative secure check-in address\)/);
    assert.doesNotMatch(bundle.visitor.text + bundle.sales.text + bundle.admin.text, /alternate@example\.test/);
    assert.equal(bundle.admin.attachments.length, 1);
    const attachment = bundle.admin.attachments[0];
    assert.match(attachment.content, /\[private contact\]/);
    assert.doesNotMatch(attachment.content, /alternate@example\.test/);
    assert.ok(bundle.visitor.html.includes('<!doctype html>'));
    assert.ok(bundle.sales.html.includes('<!doctype html>'));
});
