import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEvanRouteTurn, buildEvanMovePlan } from '../lib/anam/evan-move-planner.ts';

const turns = (...content) => content.map(content => ({ role: 'user', content }));
const plan = (...content) => buildEvanMovePlan(turns(...content));
const cities = model => model.stops.map(stop => stop.city);
const initial = 'I am moving from Gilbert to Queen Creek.';

test('later destination and origin corrections replace rather than append locations', () => {
    const model = plan(initial, 'Actually, the destination is Scottsdale instead.', 'The origin is Mesa, not Gilbert.');
    assert.deepEqual(model.stops, [{ city: 'Mesa', kind: 'Origin' }, { city: 'Scottsdale', kind: 'Destination' }]);
});

test('replacement statements preserve the old stop role and discard obsolete cities', () => {
    assert.deepEqual(cities(plan(initial, 'It is not Queen Creek, it is Chandler.')), ['Gilbert', 'Chandler']);
    assert.deepEqual(cities(plan(initial, 'The origin is not Gilbert, it is Phoenix.')), ['Phoenix', 'Queen Creek']);
    assert.deepEqual(cities(plan(initial, 'Add a storage stop in Mesa.', 'Replace the Mesa stop with Scottsdale.')), ['Gilbert', 'Scottsdale', 'Queen Creek']);
    assert.deepEqual(cities(plan(initial, 'The destination is Chandler rather than Queen Creek.')), ['Gilbert', 'Chandler']);
});

test('stop removals, reinsertion, and before/after order follow the latest user request', () => {
    const base = [initial, 'Add a storage stop in Mesa.', 'Add a donation stop in Chandler.'];
    assert.deepEqual(cities(plan(...base, 'Put Chandler before Mesa.')), ['Gilbert', 'Chandler', 'Mesa', 'Queen Creek']);
    assert.deepEqual(cities(plan(...base, 'Move Mesa after Chandler.')), ['Gilbert', 'Chandler', 'Mesa', 'Queen Creek']);
    assert.deepEqual(cities(plan(...base, 'Put Chandler before Mesa.', 'Remove the Mesa storage stop.')), ['Gilbert', 'Chandler', 'Queen Creek']);
    assert.deepEqual(cities(plan(...base, 'Remove the Mesa storage stop.', 'Add the Mesa storage stop back.')), ['Gilbert', 'Chandler', 'Mesa', 'Queen Creek']);
});

test('ordinal stop corrections do not displace origin or destination', () => {
    const base = [initial, 'Add a storage stop in Mesa.', 'Add a donation stop in Chandler.'];
    assert.deepEqual(cities(plan(...base, 'Chandler should be the second stop.')), ['Gilbert', 'Chandler', 'Mesa', 'Queen Creek']);
    assert.deepEqual(cities(plan(...base, 'Mesa should be the third stop.')), ['Gilbert', 'Chandler', 'Mesa', 'Queen Creek']);
});

test('named generic stop removals use captured stop purposes and leave unrelated stops', () => {
    assert.deepEqual(cities(plan(initial, 'Add a storage stop in Mesa.', 'Add a donation stop in Chandler.', 'We no longer need the storage stop.')), ['Gilbert', 'Chandler', 'Queen Creek']);
    assert.deepEqual(cities(plan(initial, 'Add a storage stop in Mesa.', 'Remove all additional stops.')), ['Gilbert', 'Queen Creek']);
});

test('latest timing and property facts win across turns and inside the same turn', () => {
    const model = plan('We are moving next week from a four-bedroom house.', 'Change the timing to next month and the property to a two-bedroom apartment.');
    assert.equal(model.timing, 'next month');
    assert.equal(model.propertyScope, 'two-bedroom apartment');
    const sameTurn = plan('The target date is the 15th. Actually, make it on the 28th. It is a four-bedroom house, actually a two-bedroom apartment.');
    assert.equal(sameTurn.timing, 'on the 28th');
    assert.equal(sameTurn.propertyScope, 'two-bedroom apartment');
});

test('negated old timing does not replace the new timing', () => {
    assert.equal(plan('We are moving next week.', 'Actually next month, not next week.').timing, 'next month');
});

test('services, inventory and access removals disappear and may be added back', () => {
    const base = 'We need full packing, a piano and artwork, and there are stairs.';
    const removed = 'We do not need full packing, and remove the piano. There are no stairs.';
    const model = plan(base, removed);
    assert.deepEqual(model.services, []);
    assert.deepEqual(model.specialtyItems, ['Artwork']);
    assert.deepEqual(model.accessFactors, []);
    const restored = plan(base, removed, 'Actually, add the piano back and we do need full packing. There are stairs after all.');
    assert.deepEqual(restored.services, ['Full packing']);
    assert.deepEqual(restored.specialtyItems, ['Artwork', 'Piano']);
    assert.deepEqual(restored.accessFactors, ['Stairs']);
});

test('negation scope does not erase unrelated positive requests', () => {
    const model = plan('We need packing, unpacking, a piano and artwork. There are stairs and an elevator.', 'We do not need packing or unpacking, but keep the artwork. Remove the piano and add a grandfather clock. No stairs, but there is an elevator.');
    assert.deepEqual(model.services, []);
    assert.deepEqual(model.specialtyItems, ['Artwork', 'Grandfather clock']);
    assert.deepEqual(model.accessFactors, ['Elevator requirements']);
});

test('changing full packing to partial packing removes obsolete full-service label', () => {
    assert.deepEqual(plan('We need full packing.', 'Actually, only kitchen packing is needed.').services, ['Packing support']);
});

test('noncommittal city and service questions do not create confirmed-looking planner facts', () => {
    const model = plan(initial, 'Do you serve Tucson?', 'What if we moved to Flagstaff?', 'Maybe we will move to Sedona.', 'Do you offer packing?', 'Can you move a piano?');
    assert.deepEqual(cities(model), ['Gilbert', 'Queen Creek']);
    assert.deepEqual(model.services, []);
    assert.deepEqual(model.specialtyItems, []);
});

test('polite explicit edit requests still update the planner', () => {
    const model = plan(initial, 'Could you change the destination to Phoenix?', 'Can you add a piano and packing?', 'Could you add a storage stop in Mesa?');
    assert.deepEqual(cities(model), ['Gilbert', 'Mesa', 'Phoenix']);
    assert.deepEqual(model.specialtyItems, ['Piano']);
    assert.ok(model.services.includes('Packing support'));
});

test('precise unchanged/reordered stops preserve metadata and no-op identity', () => {
    const origin = { city: 'Gilbert', kind: 'Origin', address: '1 Main St, Gilbert, AZ', confirmed: true, coordinates: { latitude: 33.35, longitude: -111.79 }, precision: 'address' };
    const storage = { city: 'Mesa', kind: 'Additional stop', label: 'Storage', address: '2 Main St, Mesa, AZ', confirmed: true };
    const donation = { city: 'Chandler', kind: 'Additional stop', label: 'Donation', address: '3 Main St, Chandler, AZ', confirmed: true };
    const destination = { city: 'Queen Creek', kind: 'Destination', address: '4 Main St, Queen Creek, AZ', confirmed: true };
    const route = [origin, storage, donation, destination];
    assert.equal(applyEvanRouteTurn(route, 'We need a piano moved.'), route);
    const reordered = applyEvanRouteTurn(route, 'Put Chandler before Mesa.');
    assert.deepEqual(reordered, [origin, donation, storage, destination]);
    assert.equal(reordered[0], origin);
    assert.equal(reordered[1], donation);
    assert.deepEqual(applyEvanRouteTurn(route, 'Remove the storage stop.'), [origin, donation, destination]);
    const changed = applyEvanRouteTurn(route, 'Change the destination to Phoenix.');
    assert.equal(changed[0], origin);
    assert.deepEqual(changed.at(-1), { city: 'Phoenix', kind: 'Destination' });
});

test('empty explicit route override does not resurrect historical locations', () => {
    const history = turns(initial);
    assert.deepEqual(cities(buildEvanMovePlan(history)), ['Gilbert', 'Queen Creek']);
    assert.deepEqual(cities(buildEvanMovePlan(history, null)), ['Gilbert', 'Queen Creek']);
    assert.deepEqual(cities(buildEvanMovePlan(history, [])), []);
});

test('later access discussion does not downgrade a specific property or alter the route', () => {
    const model = plan('We are moving from Mesa to Phoenix next month from a four-bedroom house.', 'The house has stairs. I am not sure about Mesa access.');
    assert.equal(model.propertyScope, 'four-bedroom house');
    assert.deepEqual(cities(model), ['Mesa', 'Phoenix']);
});

test('hypothetical scalar values and questions do not replace captured details', () => {
    const model = plan('We are moving next week from a four-bedroom house.', 'What if we moved next month from a two-bedroom apartment?', 'Maybe we could use a condo instead.', 'Can we move in three weeks?');
    assert.equal(model.timing, 'next week');
    assert.equal(model.propertyScope, 'four-bedroom house');
});

test('discourse No introduces a positive route correction rather than negating every city', () => {
    assert.deepEqual(cities(plan(initial, 'No, we are moving from Gilbert to Scottsdale.')), ['Gilbert', 'Scottsdale']);
    assert.deepEqual(cities(plan(initial, 'No we are moving from Mesa to Chandler.')), ['Mesa', 'Chandler']);
});

test('city-only answers take their route role from the immediately preceding question', () => {
    const model = buildEvanMovePlan([
        { role: 'agent', content: 'Where are you moving from?' },
        { role: 'user', content: 'Mesa.' },
        { role: 'agent', content: 'And where are you moving to?' },
        { role: 'user', content: 'Phoenix.' },
        { role: 'agent', content: 'Any other stops?' },
        { role: 'user', content: 'Chandler.' },
    ]);
    assert.deepEqual(model.stops, [{ city: 'Mesa', kind: 'Origin' }, { city: 'Chandler', kind: 'Additional stop' }, { city: 'Phoenix', kind: 'Destination' }]);
    assert.deepEqual(applyEvanRouteTurn(model.stops, 'Gilbert.', 'What is the new destination?').at(-1), { city: 'Gilbert', kind: 'Destination' });
});

test('explicit route reset clears all pins and later intake can start again', () => {
    assert.deepEqual(plan(initial, 'Please clear the route.').stops, []);
    assert.deepEqual(cities(plan(initial, 'Please clear the route.', 'We are moving from Mesa to Phoenix.')), ['Mesa', 'Phoenix']);
    assert.deepEqual(cities(plan(initial, 'Do not clear the route.')), ['Gilbert', 'Queen Creek']);
});

test('positive only/just requests after a negative packing scope remain visible', () => {
    assert.deepEqual(plan('We need full packing.', 'No full packing, just kitchen packing.').services, ['Packing support']);
});

test('a new from-to route statement is not misread as replacing the origin alone', () => {
    assert.deepEqual(cities(plan(initial, 'Change the route from Gilbert to Phoenix.')), ['Gilbert', 'Phoenix']);
    assert.deepEqual(cities(plan(initial, 'The pickup is in Mesa and delivery is in Chandler.')), ['Mesa', 'Chandler']);
});

test('explicit role cancellation clears only the requested route role', () => {
    assert.deepEqual(plan(initial, 'Please remove the destination.').stops, [{ city: 'Gilbert', kind: 'Origin' }]);
    assert.deepEqual(plan(initial, 'We are no longer moving to Queen Creek.').stops, [{ city: 'Gilbert', kind: 'Origin' }]);
});

test('concise route pairs work without turning unrelated city lists into routes', () => {
    assert.deepEqual(plan('Gilbert to Queen Creek.').stops, [{ city: 'Gilbert', kind: 'Origin' }, { city: 'Queen Creek', kind: 'Destination' }]);
    const question = { role: 'agent', content: 'Where are you moving from and to?' };
    for (const content of ['Gilbert to Queen Creek.', 'Gilbert and Queen Creek.']) {
        assert.deepEqual(buildEvanMovePlan([question, { role: 'user', content }]).stops, [{ city: 'Gilbert', kind: 'Origin' }, { city: 'Queen Creek', kind: 'Destination' }]);
    }
    assert.deepEqual(plan('Gilbert and Queen Creek.').stops, []);
    assert.deepEqual(plan('I like Gilbert and Queen Creek.').stops, []);
});

test('brief negative acknowledgment followed by a corrected city uses the last question role', () => {
    const route = plan(initial).stops;
    assert.deepEqual(applyEvanRouteTurn(route, 'No, Scottsdale instead.', 'What is the final destination?'), [{ city: 'Gilbert', kind: 'Origin' }, { city: 'Scottsdale', kind: 'Destination' }]);
});

test('same-city street route edits affect only the named role or purpose', () => {
    const origin = { city: 'Phoenix', kind: 'Origin', address: '1 Main St, Phoenix, AZ', confirmed: true, coordinates: { latitude: 33.45, longitude: -112.07 }, precision: 'address' };
    const storage = { city: 'Phoenix', kind: 'Additional stop', label: 'Storage', address: '2 Main St, Phoenix, AZ', confirmed: true, coordinates: { latitude: 33.46, longitude: -112.08 }, precision: 'address' };
    const destination = { city: 'Phoenix', kind: 'Destination', address: '3 Main St, Phoenix, AZ', confirmed: true, coordinates: { latitude: 33.47, longitude: -112.09 }, precision: 'address' };
    const route = [origin, storage, destination];
    const removed = applyEvanRouteTurn(route, 'Remove the storage stop in Phoenix.');
    assert.deepEqual(removed, [origin, destination]);
    assert.equal(removed[0], origin);
    assert.equal(removed[1], destination);
    const changed = applyEvanRouteTurn(route, 'Change the destination from Phoenix to Mesa.');
    assert.equal(changed[0], origin);
    assert.equal(changed[1], storage);
    assert.deepEqual(changed[2], { city: 'Mesa', kind: 'Destination' });
    assert.equal(applyEvanRouteTurn(route, 'Remove Phoenix.'), route);
    assert.equal(applyEvanRouteTurn(route, 'Change Phoenix to Mesa.'), route);
});

test('changing a destination to the storage city does not delete that confirmed storage address', () => {
    const origin = { city: 'Gilbert', kind: 'Origin', address: '1 Main St, Gilbert, AZ', confirmed: true };
    const storage = { city: 'Mesa', kind: 'Additional stop', label: 'Storage', address: '2 Main St, Mesa, AZ', confirmed: true };
    const destination = { city: 'Phoenix', kind: 'Destination', address: '3 Main St, Phoenix, AZ', confirmed: true };
    const updated = applyEvanRouteTurn([origin, storage, destination], 'Change the destination to Mesa.');
    assert.equal(updated[0], origin);
    assert.equal(updated[1], storage);
    assert.deepEqual(updated[2], { city: 'Mesa', kind: 'Destination' });
});

test('hypothetical edit requests are not committed as actual route or inventory changes', () => {
    const model = plan(initial, 'What if we change the destination to Tucson?', 'Suppose we add a piano?', 'Hypothetically, remove the origin.');
    assert.deepEqual(cities(model), ['Gilbert', 'Queen Creek']);
    assert.deepEqual(model.specialtyItems, []);
});
