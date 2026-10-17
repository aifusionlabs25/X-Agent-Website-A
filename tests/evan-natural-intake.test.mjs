import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvanMovePlan, buildGoogleMapsDirectionsUrl } from '../lib/anam/evan-move-planner.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
const route = user('We are moving from Phoenix to Mesa.');
const possible = user('We might need a storage stop in Gilbert.');

test('bare bedroom counts and studio answers are captured without requiring a property suffix', () => {
    for (const phrase of ['One-bedroom.', 'Two bedroom.', 'Three bedrooms.', 'A 2-bedroom.', 'One bedroom, probably Mesa.', 'Studio.']) {
        const model = buildEvanMovePlan([user(phrase)]);
        assert.ok(model.propertyScope, phrase);
    }
    assert.equal(buildEvanMovePlan([user('One-bedroom.'), user('Actually, two bedrooms.')]).propertyScope, 'two bedrooms');
    assert.equal(buildEvanMovePlan([user('What if I had a two bedroom?')]).propertyScope, '');
});

test('mid-month and explicit date flexibility retain the visitor wording without inventing a month', () => {
    for (const phrase of ['Mid-month but flexible.', 'The middle of the month; the date is flexible.', 'Around mid month, but flexible on the exact date.']) {
        const model = buildEvanMovePlan([user(phrase)]);
        assert.match(model.timing, /mid[- ]month|middle of the month/i, phrase);
        assert.match(model.timing, /flexible/i, phrase);
        assert.doesNotMatch(model.timing, /January|February|March|April|May|June|July|August|September|October|November|December|202\d/i);
    }
    assert.equal(buildEvanMovePlan([user('My move date is flexible.')]).timing, 'Date flexible');
    const fixed = buildEvanMovePlan([user('Mid-month but flexible.'), user('The date is not flexible now.')]);
    assert.doesNotMatch(fixed.timing, /flexible/);
    assert.equal(buildEvanMovePlan([user('My callback time is flexible.')]).timing, '');
    const natural = buildEvanMovePlan([route, user("mid-month but flexible uh i might need a storage stop in gilbert first but i'm not sure yet")]);
    assert.match(natural.timing, /mid-month; date flexible/i);
    assert.deepEqual(natural.possibleStops.map(stop => stop.city), ['Gilbert']);
    assert.ok(!natural.services.includes('Storage stop'));
});

test('self packing is a plan, never a request for paid packing support', () => {
    for (const phrase of ['I will handle packing.', "I'll do the packing myself.", 'We are handling the packing.', "We're packing ourselves.", 'We will pack our own things.']) {
        const model = buildEvanMovePlan([user(phrase)]);
        assert.equal(model.packingPlan, 'Packing yourself', phrase);
        assert.ok(!model.services.includes('Packing support'), phrase);
        assert.ok(!model.services.includes('Full packing'), phrase);
        assert.equal(model.highlights.find(item => item.label === 'Packing plan')?.value, 'Packing yourself', phrase);
    }
});

test('packing corrections and mixed scope preserve the requested assistance only', () => {
    const self = buildEvanMovePlan([user('We need full packing.'), user('Actually I will handle packing.')]);
    assert.equal(self.packingPlan, 'Packing yourself');
    assert.ok(!self.services.includes('Full packing'));
    const assistance = buildEvanMovePlan([user('I will handle packing.'), user('Actually, we need full packing.')]);
    assert.equal(assistance.packingPlan, 'Packing assistance requested');
    assert.ok(assistance.services.includes('Full packing'));
    const mixed = buildEvanMovePlan([user('I will do most packing, but we need packing help for the kitchen.')]);
    assert.equal(mixed.packingPlan, 'Packing some items yourself; assistance requested');
    assert.ok(mixed.services.includes('Packing support'));
    const hypothetical = buildEvanMovePlan([user('What if we did our own packing?')]);
    assert.equal(hypothetical.packingPlan, '');
    assert.deepEqual(hypothetical.services, []);
    const declined = buildEvanMovePlan([user('I will do the packing myself.'), user("I won't do the packing after all.")]);
    assert.equal(declined.packingPlan, '');
    assert.ok(!declined.services.includes('Packing support'));
    const question = buildEvanMovePlan([user('We need full packing.'), user('Should we do the packing ourselves?')]);
    assert.ok(question.services.includes('Full packing'));
    assert.equal(question.packingPlan, 'Packing assistance requested');
});

test('actual Arizona-qualified readback resolves the missing city only after explicit visitor confirmation', () => {
    const turns = [
        user('One bedroom, probably Mesa.'),
        user('Right, yes, Phoenix to Mason.'),
        agent('Just to confirm, you’re moving from Phoenix, Arizona to Mesa, Arizona, correct?'),
    ];
    assert.ok(!buildEvanMovePlan(turns).stops.some(stop => stop.kind === 'Destination'));
    const model = buildEvanMovePlan([...turns, user('That’s right.')]);
    assert.deepEqual(model.stops, [{ city: 'Phoenix', kind: 'Origin' }, { city: 'Mesa', kind: 'Destination' }]);
});

test('readback supports bounded wording variations without a spelling alias', () => {
    for (const readback of ['So Phoenix to Mesa. Is that right?', 'From Phoenix to Mesa, correct?', "I've got Phoenix to Mesa. Does that sound correct?"]) {
        const model = buildEvanMovePlan([user('Our new home is in Mesa.'), user('I am moving from Phoenix to Mason.'), agent(readback), user("That's correct.")]);
        assert.deepEqual(model.stops.map(stop => stop.city), ['Phoenix', 'Mesa'], readback);
    }
    const alone = buildEvanMovePlan([user('We are moving from Phoenix to Mason.')]);
    assert.ok(!alone.stops.some(stop => stop.city === 'Mesa'));
});

test('agent-only destinations, general acknowledgments and compound questions never establish readback facts', () => {
    const cases = [
        [user('From Phoenix to Mason.'), agent('From Phoenix to Mesa, correct?'), user("That's right.")],
        [user('One bedroom, probably Mesa.'), user('From Phoenix to Mason.'), agent('From Phoenix to Mesa, correct?'), user('Yes.')],
        [user('One bedroom, probably Mesa.'), user('From Phoenix to Mason.'), agent('From Phoenix to Mesa, correct? Also, do you need packing?'), user("That's right.")],
        [user('One bedroom, probably Mesa.'), user('From Phoenix to Mason.'), agent('From Phoenix to Mesa, correct?'), user('I need full packing.'), user("That's right.")],
        [user('Does Mullins serve Mesa?'), user('From Phoenix to Mason.'), agent('From Phoenix to Mesa, correct?'), user("That's right.")],
        [user('One bedroom, probably Mesa.'), user('From Phoenix to Mason.'), agent('From Chandler to Mesa, correct?'), user("That's right.")],
        [user('One bedroom, probably Mesa.'), user('Phoenix to discuss dates.'), agent('From Phoenix to Mesa, correct?'), user("That's right.")],
        [user('One bedroom, probably Mesa.'), user('Phoenix to talk with my brother.'), agent('From Phoenix to Mesa, correct?'), user("That's right.")],
    ];
    for (const turns of cases) assert.ok(!buildEvanMovePlan(turns).stops.some(stop => stop.kind === 'Destination'));
    const direct = buildEvanMovePlan([user('From Phoenix to Mason.'), agent('What is the destination city?'), user('Mesa.')]);
    assert.equal(direct.stops.find(stop => stop.kind === 'Destination')?.city, 'Mesa');
    const conflicting = buildEvanMovePlan([user('Our property is in Mesa.'), user('From Phoenix to Chandler.'), user('From Phoenix to Mason.'), agent('From Phoenix to Mesa, correct?'), user("That's right.")]);
    assert.equal(conflicting.stops.find(stop => stop.kind === 'Destination')?.city, 'Chandler');
});

test('possible stops remain visible separately from route pins and directions', () => {
    for (const phrase of ['We might need a storage stop in Gilbert.', 'Maybe a storage stop in Gilbert.', 'A possible storage stop in Gilbert.', 'Keep the Gilbert stop only as a possibility.', 'There may be a storage stop in Gilbert, but it is only a possibility.']) {
        const model = buildEvanMovePlan([route, user(phrase)]);
        assert.deepEqual(model.stops.map(stop => stop.city), ['Phoenix', 'Mesa'], phrase);
        assert.deepEqual(model.possibleStops.map(stop => stop.city), ['Gilbert'], phrase);
        assert.equal(model.possibleStops[0].confirmed, false);
        assert.equal(model.possibleStops[0].coordinates, undefined);
        assert.ok(!model.services.includes('Storage stop'), phrase);
        assert.doesNotMatch(buildGoogleMapsDirectionsUrl(model.stops), /Gilbert/i);
    }
});

test('mixed committed route and tentative additional stop keep the endpoint facts', () => {
    for (const phrase of ['Moving from Phoenix to Mesa, maybe a storage stop in Gilbert.', 'We are moving from Phoenix to Mesa and might need a storage stop in Gilbert.']) {
        const model = buildEvanMovePlan([user(phrase)]);
        assert.deepEqual(model.stops.map(stop => stop.city), ['Phoenix', 'Mesa'], phrase);
        assert.deepEqual(model.possibleStops.map(stop => stop.city), ['Gilbert'], phrase);
    }
});

test('possible stops can be corrected without promoting them', () => {
    for (const correction of ['Change the possible Gilbert stop to Chandler.', 'Maybe Chandler instead of Gilbert for storage.', 'The possible storage stop is Chandler, not Gilbert.']) {
        const model = buildEvanMovePlan([route, possible, user(correction)]);
        assert.deepEqual(model.possibleStops.map(stop => stop.city), ['Chandler'], correction);
        assert.deepEqual(model.stops.map(stop => stop.city), ['Phoenix', 'Mesa'], correction);
    }
});

test('explicitly committing a possible stop promotes it once; acknowledgments do not', () => {
    for (const commitment of ['Definitely add that storage stop.', 'Confirm the Gilbert stop.', 'Go ahead and include that stop.']) {
        const model = buildEvanMovePlan([route, possible, user(commitment)]);
        assert.deepEqual(model.possibleStops, [], commitment);
        assert.deepEqual(model.stops.map(stop => stop.city), ['Phoenix', 'Gilbert', 'Mesa'], commitment);
    }
    for (const acknowledgment of ['Yes.', "That's right.", 'Yes, note it as possible.', 'Keep the Gilbert stop only as a possibility.']) {
        const model = buildEvanMovePlan([route, possible, agent('Should I note Gilbert as possible?'), user(acknowledgment)]);
        assert.deepEqual(model.possibleStops.map(stop => stop.city), ['Gilbert'], acknowledgment);
        assert.deepEqual(model.stops.map(stop => stop.city), ['Phoenix', 'Mesa'], acknowledgment);
    }
});

test('possible stop cancellations and route reset do not leave stale proposals', () => {
    for (const cancellation of ['No Gilbert stop.', 'Cancel the Gilbert storage stop.', "We don't need that stop.", 'Remove all possible stops.', 'Clear the route.']) {
        const model = buildEvanMovePlan([route, possible, user(cancellation)]);
        assert.deepEqual(model.possibleStops, [], cancellation);
    }
    const two = [route, possible, user('Maybe a donation stop in Chandler.')];
    for (const cancellation of ['Skip the storage stop.', 'Remove all possible storage stops.']) {
        assert.deepEqual(buildEvanMovePlan([...two, user(cancellation)]).possibleStops.map(stop => stop.city), ['Chandler'], cancellation);
    }
});

test('hypothetical questions and agent suggestions never invent possible stops', () => {
    for (const phrase of ['What if we added a storage stop in Gilbert?', 'Could we possibly stop in Gilbert?', 'Does Mullins offer storage in Gilbert?']) {
        assert.deepEqual(buildEvanMovePlan([route, user(phrase)]).possibleStops, [], phrase);
    }
    assert.deepEqual(buildEvanMovePlan([route, agent('Maybe a storage stop in Gilbert?'), user('Okay.')]).possibleStops, []);
});
