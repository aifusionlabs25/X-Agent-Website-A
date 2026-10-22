import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicEvanCapture } from '../lib/anam/evan-deterministic-capture.ts';
import { projectEvanCapturePlan } from '../lib/anam/evan-capture.ts';
import { buildEvanEmailBundle } from '../lib/anam/evan-agentmail-templates.ts';
const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
function replay(turns) {
    const record = buildDeterministicEvanCapture(turns, 1);
    return { plan: projectEvanCapturePlan(record), emails: buildEvanEmailBundle({ displayName: 'Local Test',
        verifiedEmail: 'local@example.com', externalSessionId: 'run50-local-replay',
        sessionStartedAt: '2026-10-21T12:00:00Z', sessionEndedAt: '2026-10-21T12:03:00Z', turns, captureRecord: record }) };
}
for (const value of ['second week in November', 'second week of November', 'first week in December', 'third week of January', 'fourth week in May', 'last week in June']) {
    test(`preserve literal date qualifier: ${value}`, () => {
        const { plan, emails } = replay([user(`From Mesa to Tempe. ${value}.`)]);
        assert.equal(plan.timing, value);
        for (const audience of ['visitor', 'admin', 'sales']) assert.ok(emails[audience].text.includes(value));
    });
}
const properties = [agent('What kind of home are you moving from, like a studio, one bedroom, or larger?'),
    user("It's a 2 bedroom apartment."), agent('Are you moving to another apartment in Tempe, or a house?'),
    user("It's another apartment. There's one flight of stairs at the pickup and the delivery place has an elevator.")];
test('run50 origin size survives destination answer in planner and every recap', () => {
    const { plan, emails } = replay(properties);
    assert.equal(plan.propertyScope, 'Origin: 2 bedroom apartment; Destination: apartment');
    for (const audience of ['visitor', 'admin', 'sales']) assert.ok(emails[audience].text.includes(plan.propertyScope));
    assert.deepEqual(plan.accessFactors, ['Origin: one flight of stairs', 'Destination: elevator']);
});
test('destination-first questions and explicit property corrections remain separate', () => {
    const turns = [agent('What kind of home are you moving to?'), user('A condo.'),
        agent('What size home are you moving from?'), user('A three-bedroom house.'),
        user('Actually the destination is a two-bedroom apartment.')];
    const { plan } = replay(turns);
    assert.equal(plan.propertyScope, 'Destination: two-bedroom apartment; Origin: three-bedroom house');
});
test('both property locations in one sentence retain separate sizes', () => {
    assert.equal(replay([user('Pickup is a two-bedroom apartment and delivery is a three-bedroom house.')]).plan.propertyScope,
        'Origin: two-bedroom apartment; Destination: three-bedroom house');
});
test('no supplied property or ambiguous location question invents no property or location', () => {
    assert.equal(replay([agent('Are you moving from a two-bedroom apartment?'), user('Not sure yet.')]).plan.propertyScope, '');
    assert.equal(replay([agent('What kind of properties are at pickup and delivery?'), user('An apartment.')]).plan.propertyScope, 'apartment');
});
test('a new date replaces its old week qualifier without borrowing agent facts', () => {
    assert.equal(replay([user('Second week in November.'), user('Actually December 4.')]).plan.timing, 'December 4');
    assert.equal(replay([agent('Second week in November?'), user('I do not know yet.')]).plan.timing, '');
});
test('additional-stop property classification remains unchanged', () => {
    assert.equal(replay([user('The additional stop is a studio apartment.')]).plan.propertyScope, 'Additional stop: studio apartment');
});
