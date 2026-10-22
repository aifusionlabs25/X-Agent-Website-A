import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicEvanCapture } from '../lib/anam/evan-deterministic-capture.ts';
import { projectEvanCapturePlan, currentEvanCaptureFacts, validateEvanCapture } from '../lib/anam/evan-capture.ts';
import { buildEvanEmailBundle } from '../lib/anam/evan-agentmail-templates.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
const audiences = ['visitor', 'admin', 'sales'];
const inventoryQuestion = agent("Is there anything else you'd like to add to the inventory?");

function localTest(name, run) {
    test(name, t => {
        t.mock.method(globalThis, 'fetch', () => assert.fail('Run-52 regressions must remain local'));
        run();
    });
}

function replay(turns) {
    const before = JSON.stringify(turns);
    const record = buildDeterministicEvanCapture(turns, 52);
    assert.equal(JSON.stringify(turns), before);
    assert.deepEqual(validateEvanCapture({ facts: record.facts }, turns, 52), record);
    const plan = projectEvanCapturePlan(record);
    const emails = buildEvanEmailBundle({ displayName: 'Run52 Test', verifiedEmail: 'run52@example.com',
        externalSessionId: 'run52-local-replay', sessionStartedAt: '2026-10-22T12:00:00Z',
        sessionEndedAt: '2026-10-22T12:03:00Z', turns, captureRecord: record });
    const items = currentEvanCaptureFacts(record).filter(f => f.status === 'asserted' && ['inventory', 'specialty'].includes(f.category));
    return { plan, emails, items };
}

function sharedProperties(result, expected) {
    assert.deepEqual(result.plan.propertyScope.split('; ').filter(Boolean).sort(), [...expected].sort());
    for (const audience of audiences) for (const value of expected) {
        assert.ok(result.emails[audience].text.includes(value), `${audience} lost property ${value}`);
    }
}

function sharedAccess(result, expected) {
    assert.deepEqual([...result.plan.accessFactors].sort(), [...expected].sort());
    for (const audience of audiences) for (const value of expected) {
        assert.ok(result.emails[audience].text.includes(value), `${audience} lost access ${value}`);
    }
}

function noInventory(result) {
    assert.deepEqual(result.items, [], 'Property/access wording must not create items');
    assert.deepEqual(result.plan.inventoryItems, []);
    assert.deepEqual(result.plan.specialtyItems, []);
}

function onlyInventory(result, expected) {
    assert.equal(result.items.length, expected.length, `Unexpected inventory: ${result.items.map(f => f.value).join('; ')}`);
    for (const pattern of expected) assert.ok(result.items.some(f => pattern.test(f.value)), `Missing ${pattern}`);
    for (const value of [...result.plan.inventoryItems, ...result.plan.specialtyItems]) {
        for (const audience of audiences) assert.ok(result.emails[audience].text.includes(value), `${audience} lost item ${value}`);
    }
}

localTest('run52 exact mixed dialogue keeps two properties and scoped access without connector inventory', () => {
    const result = replay([
        user("Hi, I'm planning a move and could use some help. I'm moving from Mesa to Tempe in the 2nd week of November. I'm moving out of a 2 bedroom apartment and into a 3 bedroom house."),
        agent('That sounds like a clean route, and the 2nd week of November works. What kind of furniture are you bringing, and roughly how many boxes?'),
        user('About 20 to 25 boxes, a queen bed, um, a love seat and a desk. I also have some fragile dishes. Do you help pack those? and would that cost extra?'),
        agent("Yes, Mullins offers packing help, including wrapping dishes. The team can confirm materials and any extra charge for your move. Is there anything else you'd like to add to the inventory?"),
        user("At pickup, there's one flight of stairs and at delivery, there's an elevator. So, what happens next? Could someone maybe call tomorrow about an estimate?"),
    ]);
    assert.equal(result.plan.timing, '2nd week of November');
    sharedProperties(result, ['Origin: 2 bedroom apartment', 'Destination: 3 bedroom house']);
    sharedAccess(result, ['Origin: one flight of stairs', 'Destination: elevator']);
    onlyInventory(result, [/^boxes$/i, /^queen bed$/i, /^love seat$/i, /^desk$/i, /^fragile dishes$/i]);
    for (const audience of audiences) assert.ok(result.emails[audience].text.includes('2nd week of November'));
});

for (const wording of [
    "I'm moving out of a 2 bedroom apartment and into a 3 bedroom house.",
    "We're moving from a 2 bedroom apartment to a 3 bedroom house.",
    'Pickup is a 2 bedroom apartment and delivery is a 3 bedroom house.',
    'At pickup, it is a 2 bedroom apartment; at delivery, it is a 3 bedroom house.',
    'Delivery is a 3 bedroom house and pickup is a 2 bedroom apartment.',
    'I am moving from a 2 bedroom apartment and moving into a 3 bedroom house.',
]) {
    localTest(`property wording retains both roles and no inventory: ${wording}`, () => {
        const result = replay([user(wording)]);
        sharedProperties(result, ['Origin: 2 bedroom apartment', 'Destination: 3 bedroom house']);
        noInventory(result);
    });
}

localTest('short property answers keep the role from their own preceding question', () => {
    const result = replay([agent('What type of home are you moving out of?'), user('A 2 bedroom apartment.'),
        agent('What type of home are you moving into?'), user('A 3 bedroom house.')]);
    sharedProperties(result, ['Origin: 2 bedroom apartment', 'Destination: 3 bedroom house']);
    noInventory(result);
});

localTest('a destination property correction leaves the origin property untouched', () => {
    const result = replay([user("I'm moving out of a 2 bedroom apartment and into a 3 bedroom house."),
        user('Actually the destination is a 4 bedroom house.')]);
    sharedProperties(result, ['Origin: 2 bedroom apartment', 'Destination: 4 bedroom house']);
    noInventory(result);
    for (const audience of audiences) assert.ok(!result.emails[audience].text.includes('3 bedroom house'));
});

localTest('an origin property correction leaves the destination property untouched', () => {
    const result = replay([user('Delivery is a 3 bedroom house and pickup is a 2 bedroom apartment.'),
        user('Actually the pickup is a studio apartment.')]);
    sharedProperties(result, ['Origin: studio apartment', 'Destination: 3 bedroom house']);
    noInventory(result);
    for (const audience of audiences) assert.ok(!result.emails[audience].text.includes('2 bedroom apartment'));
});

for (const wording of [
    "At pickup, there's one flight of stairs and at delivery, there's an elevator.",
    "At pickup there's one flight of stairs and at delivery there's an elevator.",
    'Pickup has one flight of stairs; delivery has an elevator.',
    "At delivery, there's an elevator and at pickup, there's one flight of stairs.",
    'There is one flight of stairs at pickup and an elevator at delivery.',
]) {
    localTest(`access answer after inventory question stays scoped and creates no items: ${wording}`, () => {
        const result = replay([inventoryQuestion, user(wording)]);
        sharedAccess(result, ['Origin: one flight of stairs', 'Destination: elevator']);
        noInventory(result);
    });
}

localTest('identical access kinds with distinct flight counts stay bound to each building', () => {
    const result = replay([inventoryQuestion, user('At pickup, there are two flights of stairs and at delivery, there are three flights of stairs.')]);
    sharedAccess(result, ['Origin: two flights of stairs', 'Destination: three flights of stairs']);
    noInventory(result);
});

localTest('pickup-only access correction does not overwrite delivery access', () => {
    const result = replay([user('At pickup, there is one flight of stairs and at delivery, there is an elevator.'),
        user('Actually at pickup, there are two flights of stairs.')]);
    sharedAccess(result, ['Origin: two flights of stairs', 'Destination: elevator']);
    noInventory(result);
    for (const audience of audiences) assert.ok(!result.emails[audience].text.includes('one flight of stairs'));
});

localTest('negative access statements preserve their own location and do not negate the other building', () => {
    const result = replay([inventoryQuestion, user('At pickup, there is no elevator and at delivery, there are no stairs.')]);
    sharedAccess(result, ['Origin: no elevator', 'Destination: no stairs']);
    noInventory(result);
});

localTest('real inventory before separate property and access clauses survives', () => {
    const result = replay([inventoryQuestion,
        user("I have a queen bed and a desk. I'm moving out of a 2 bedroom apartment and into a 3 bedroom house. At pickup, there's one flight of stairs and at delivery, there's an elevator.")]);
    sharedProperties(result, ['Origin: 2 bedroom apartment', 'Destination: 3 bedroom house']);
    sharedAccess(result, ['Origin: one flight of stairs', 'Destination: elevator']);
    onlyInventory(result, [/^queen bed$/i, /^desk$/i]);
});

localTest('unfamiliar explicitly declared items still survive alongside access answers', () => {
    const result = replay([inventoryQuestion, user('I have two lacquered cabinets and three folding screens. At pickup, there is one flight of stairs; at delivery, there is an elevator.')]);
    onlyInventory(result, [/^lacquered cabinets$/i, /^folding screens$/i]);
    sharedAccess(result, ['Origin: one flight of stairs', 'Destination: elevator']);
});

localTest('a mixed inventory and access sentence preserves the actual item without inventing connector items', () => {
    const result = replay([inventoryQuestion, user('I have a desk and at pickup, there is one flight of stairs.')]);
    onlyInventory(result, [/^desk$/i]);
    sharedAccess(result, ['Origin: one flight of stairs']);
});

localTest('agent-only property and access suggestions are not caller facts', () => {
    const result = replay([agent('Are you moving out of a 2 bedroom apartment into a 3 bedroom house with stairs at pickup and an elevator at delivery?'), user('I do not know yet.')]);
    assert.equal(result.plan.propertyScope, '');
    assert.deepEqual(result.plan.accessFactors, []);
    noInventory(result);
});

for (const { wording, item, quantity, access } of [
    { wording: 'I have two office partitions and at pickup, there is one flight of stairs.',
        item: /^office partitions$/i, quantity: 'two', access: 'Origin: one flight of stairs' },
    { wording: 'I have a doll house and at pickup, there is an elevator.',
        item: /^doll house$/i, quantity: 'a', access: 'Origin: elevator' },
]) {
    localTest(`property words inside genuine unfamiliar inventory do not become buildings: ${wording}`, () => {
        const result = replay([inventoryQuestion, user(wording)]);
        onlyInventory(result, [item]);
        assert.equal(result.items[0].quantity, quantity);
        sharedProperties(result, []);
        sharedAccess(result, [access]);
    });
}

localTest('a shared pickup heading survives the inventory-to-access clause boundary', () => {
    const result = replay([inventoryQuestion, user('At pickup, I have a desk and there is one flight of stairs.')]);
    onlyInventory(result, [/^desk$/i]);
    assert.equal(result.items[0].location, 'origin');
    sharedProperties(result, []);
    sharedAccess(result, ['Origin: one flight of stairs']);
});

localTest('an inventory between-range does not contaminate the adjacent access description', () => {
    const result = replay([inventoryQuestion,
        user('I have between two and four folding screens and at pickup, there is one flight of stairs.')]);
    onlyInventory(result, [/^folding screens$/i]);
    assert.equal(result.items[0].quantity, 'between two and four');
    sharedProperties(result, []);
    sharedAccess(result, ['Origin: one flight of stairs']);
});

localTest('a genuine between-floors access qualifier survives without becoming inventory', () => {
    const result = replay([inventoryQuestion,
        user('At pickup, there is one flight of stairs between floors two and three.')]);
    noInventory(result);
    sharedProperties(result, []);
    assert.equal(result.plan.accessFactors.length, 1);
    assert.match(result.plan.accessFactors[0], /^Origin: /);
    assert.match(result.plan.accessFactors[0], /one flight of stairs between floors two and three/i);
    sharedAccess(result, result.plan.accessFactors);
});

for (const { wording, item, quantity } of [
    { wording: 'I have two office partitions at pickup and at delivery, there is an elevator.',
        item: /^office partitions$/i, quantity: 'two' },
    { wording: 'I have a doll house at pickup and at delivery, there is an elevator.',
        item: /^doll house$/i, quantity: 'a' },
]) {
    localTest(`a trailing pickup label does not turn a genuine item into a building: ${wording}`, () => {
        const result = replay([inventoryQuestion, user(wording)]);
        onlyInventory(result, [item]);
        assert.equal(result.items[0].quantity, quantity);
        assert.equal(result.items[0].location, 'origin');
        sharedProperties(result, []);
        sharedAccess(result, ['Destination: elevator']);
    });
}

localTest('suppressing office within an item preserves a genuine office property elsewhere in the same clause', () => {
    const result = replay([inventoryQuestion, user('I have two office partitions and pickup is an office.')]);
    onlyInventory(result, [/^office partitions$/i]);
    assert.equal(result.items[0].quantity, 'two');
    sharedProperties(result, ['Origin: office']);
    sharedAccess(result, []);
});
