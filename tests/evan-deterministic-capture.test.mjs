import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicEvanCapture, EVAN_DETERMINISTIC_CAPTURE_COVERAGE } from '../lib/anam/evan-deterministic-capture.ts';
import { EvanCaptureValidationError, currentEvanCaptureFacts, projectEvanCaptureContact,
    projectEvanCaptureIntake, projectEvanCapturePlan, validateEvanCapture } from '../lib/anam/evan-capture.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
const run = turns => {
    const snapshot = structuredClone(turns);
    const record = buildDeterministicEvanCapture(turns, 4);
    assert.deepEqual(turns, snapshot);
    assert.deepEqual(validateEvanCapture({ facts: record.facts }, turns, 4), record);
    return { record, plan: projectEvanCapturePlan(record), intake: projectEvanCaptureIntake(record), contact: projectEvanCaptureContact(record) };
};

test('local builder has no provider path and explains its bounded language coverage', t => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('No network is authorized or needed'));
    assert.deepEqual(run([]).record.facts, []);
    assert.deepEqual(run([agent('You own a piano and have booked packing.')]).record.facts, []);
    assert.match(EVAN_DETERMINISTIC_CAPTURE_COVERAGE, /unsupported or ambiguous/);
});

test('arbitrary explicitly owned inventory preserves literal counts, descriptors, and Oxford-comma items', () => {
    const { plan, record, intake } = run([user('I have two amber housings, four modular screens, and one woven pod.')]);
    assert.deepEqual(plan.inventoryItems, ['two amber housings', 'four modular screens', 'one woven pod']);
    assert.deepEqual(intake.inventory, plan.inventoryItems);
    assert.deepEqual(record.facts.filter(fact => fact.category === 'inventory').map(fact => fact.quantity), ['two', 'four', 'one']);
});

test('contracted ownership retains bounded ranges and uncertainty modifiers without arithmetic', () => {
    const { record } = run([user('We’ll have between twelve and sixteen reed cases, at least six painted panels, and no more than three folding carts.')]);
    assert.deepEqual(record.facts.filter(fact => fact.category === 'inventory').map(({ value, quantity, status }) => ({ value, quantity, status })), [
        { value: 'reed cases', quantity: 'between twelve and sixteen', status: 'asserted' },
        { value: 'painted panels', quantity: 'at least six', status: 'asserted' },
        { value: 'folding carts', quantity: 'no more than three', status: 'asserted' },
    ]);
});

test('quoted sample text with a curly contraction cannot leak inventory or cities; a genuine sibling remains', () => {
    const { plan } = run([user('The sample form says ‘I’m moving a sofa from Phoenix to Mesa.’ That is only an example. I have two reed cases.')]);
    assert.deepEqual(plan.stops, []);
    assert.deepEqual(plan.inventoryItems, ['two reed cases']);
});

test('a dimension in an arbitrary inventory descriptor is not an item count', () => {
    const { record, plan } = run([user('I have three-tier mobile racks.')]);
    const [item] = record.facts.filter(fact => fact.category === 'inventory');
    assert.equal(item.value, 'three-tier mobile racks');
    assert.equal(item.quantity, '');
    assert.deepEqual(plan.inventoryItems, ['three-tier mobile racks']);
});

test('count corrections, removal and reinstatement preserve arbitrary original identity and evidence', () => {
    const turns = [user('I have two amber housings.'), user('Actually, I have four amber housings.'),
        user('Remove the amber housings.'), user('Add back the amber housings.')];
    assert.deepEqual(run(turns.slice(0, 3)).plan.inventoryItems, []);
    const { plan, record } = run(turns);
    assert.deepEqual(plan.inventoryItems, ['four amber housings']);
    const [item] = currentEvanCaptureFacts(record).filter(fact => fact.category === 'inventory');
    assert.ok(item.evidence.some(evidence => evidence.turn === 1));
    assert.ok(item.evidence.some(evidence => evidence.turn === 3));
});

test('separate pickup scopes retain separate counts; ambiguous removal becomes a review note', () => {
    const turns = [user('At origin, I have two amber housings.'), user('At the additional stop, I have three amber housings.')];
    const initial = run(turns);
    assert.deepEqual(initial.plan.inventoryItems, ['Origin: two amber housings', 'Additional stop: three amber housings']);
    const ambiguous = run([...turns, user('Remove the amber housings.')]);
    assert.deepEqual(ambiguous.plan.inventoryItems, initial.plan.inventoryItems);
    assert.ok(ambiguous.plan.uncertainties.some(value => value.includes('Remove the amber housings')));
});

test('service question, tentative request, definite request and removal remain different states', () => {
    assert.deepEqual(run([user('Do you offer packing help?')]).plan.services, []);
    const tentative = run([user('Maybe I need packing help.')]);
    assert.deepEqual(tentative.plan.services, []);
    assert.ok(tentative.plan.uncertainties.some(value => /packing help/.test(value)));
    assert.deepEqual(run([user('I need packing help.')]).plan.services, ['packing help']);
    assert.deepEqual(run([user('I need packing help.'), user('No packing help.')]).plan.services, []);
});

test('self packing does not become a request for crew packing and supersedes that request explicitly', () => {
    const { plan } = run([user('I need packing help.'), user('I will do the packing myself.')]);
    assert.deepEqual(plan.services, []);
    assert.match(plan.packingPlan, /I will do the packing myself/);
    const contracted = run([user('I need packing help.'), user('We’ll take care of all packing.')]);
    assert.deepEqual(contracted.plan.services, []);
    assert.match(contracted.plan.packingPlan, /take care of all packing/);
});

test('city route corrections reuse Evan rules without accepting an agent-only city as evidence', () => {
    const { plan } = run([user('I am moving from Phoenix to Mesa.'), user('Add a storage stop in Gilbert.'),
        user('Actually, the destination is Chandler.'), agent('Your other stop is Tucson.')]);
    assert.deepEqual(plan.stops.map(stop => stop.city), ['Phoenix', 'Gilbert', 'Chandler']);
    assert.equal(plan.stops[1].label, 'storage');
    assert.ok(plan.stops.every(stop => !stop.coordinates && stop.confirmed !== true));
});

test('same-city additional street stops retain their own addresses and cancellation targets only one', () => {
    const original = user('Start in Phoenix, then storage at 10 Copper Lane in Mesa, then donation at 20 Cedar Drive in Mesa, and finish in Chandler.');
    const initial = run([original]);
    assert.deepEqual(initial.plan.stops.map(stop => stop.city), ['Phoenix', 'Mesa', 'Mesa', 'Chandler']);
    assert.deepEqual(initial.plan.stops.filter(stop => stop.kind === 'Additional stop').map(stop => stop.address), ['10 Copper Lane', '20 Cedar Drive']);
    const canceled = run([original, user('Cancel only the donation stop.')]);
    assert.deepEqual(canceled.plan.stops.filter(stop => stop.kind === 'Additional stop').map(stop => stop.address), ['10 Copper Lane']);
});

test('unknown moving statements remain visible as review notes, never invented inventory', () => {
    const { record, plan } = run([user('The move requires a special arrangement I cannot describe yet.')]);
    assert.deepEqual(plan.inventoryItems, []);
    assert.ok(record.facts.some(fact => fact.status === 'unknown' && fact.value.includes('special arrangement')));
    assert.ok(plan.uncertainties.some(value => value.includes('special arrangement')));
});

test('repeated identical unresolved statements retain only the latest evidence without exhausting the fact limit', () => {
    const turns = Array.from({ length: 150 }, () => user('The move requires a special arrangement I cannot describe yet.'));
    const { record } = run(turns);
    assert.equal(record.facts.length, 1);
    assert.deepEqual(record.facts[0].evidence, [{ turn: 149, quote: turns[149].content }]);
});

test('contact removal creates a grounded tombstone that also hides stale check-in display', () => {
    const { record } = run([user('Please clear all my contact details.')]);
    const contact = projectEvanCaptureContact(record, { displayName: 'Previous Name', email: 'previous@example.test' });
    assert.equal(contact.displayName, '');
    assert.equal(contact.email, '');
});

test('clearing normalized contact values preserves a later literal follow-up opt-out without a grounding failure', () => {
    const turns = [user('My name is Ada Vale. My number is 623-555-0137. My email is ada at example dot test.'),
        user('Clear all my contact details. I don’t want any follow-up.')];
    const { record, contact } = run(turns);
    assert.equal(contact.displayName, '');
    assert.equal(contact.phone, '');
    assert.equal(contact.email, '');
    assert.match(contact.contactPreference, /don['’]t want any follow-up/);
    for (const category of ['name', 'phone', 'email']) assert.equal(record.facts.find(fact => fact.category === category).status, 'removed');
});

test('input and output bounds fail explicitly instead of silently truncating complete capture', () => {
    for (const turns of [Array.from({ length: 401 }, () => user('Move discussion.')), [user('x'.repeat(2001))],
        Array.from({ length: 41 }, () => user('x'.repeat(2000)))]) {
        assert.throws(() => buildDeterministicEvanCapture(turns, 1), EvanCaptureValidationError);
    }
    const manyItems = Array.from({ length: 101 }, (_, index) => user(`My items include custom housing ${index + 1}.`));
    assert.throws(() => buildDeterministicEvanCapture(manyItems, 1), EvanCaptureValidationError);
});

test('an item-local negative does not remove an independently positive list sibling', () => {
    const { record, plan } = run([user('I have no sofas and two chairs.')]);
    assert.deepEqual(plan.inventoryItems, ['two chairs']);
    assert.equal(record.facts.find(fact => fact.value === 'sofas').status, 'removed');
});

test('a corrected singular count stays grounded through removal and reinstatement of a plural descriptor', () => {
    const turns = [user('I have two sofas.'), user('Actually, I have one sofa.'), user('Remove the sofa.')];
    assert.deepEqual(run(turns).plan.inventoryItems, []);
    const { record, plan } = run([...turns, user('Keep the sofa.')]);
    assert.deepEqual(plan.inventoryItems, ['one sofas']);
    const item = record.facts.find(fact => fact.category === 'inventory');
    assert.ok(item.evidence.some(source => source.turn === 0));
    assert.ok(item.evidence.some(source => source.turn === 1));
    assert.ok(item.evidence.some(source => source.turn === 3));
});

test('an abbreviated correction changes a unique prior item without adding a duplicate', () => {
    const { plan } = run([user('I have eight dining chairs and one trestle table.'), user('Make that six chairs, not eight.')]);
    assert.deepEqual(plan.inventoryItems, ['six dining chairs', 'one trestle table']);
});

test('uncounted inventory remains captured while the count uncertainty is not mistaken for an item', () => {
    const { record, plan } = run([agent('What is on your move list so far?'),
        user('Bookshelves, dining chairs, and plastic totes. I haven’t counted those yet.')]);
    assert.deepEqual(plan.inventoryItems, ['Bookshelves', 'dining chairs', 'plastic totes']);
    assert.equal(record.facts.filter(fact => fact.category === 'inventory').every(fact => fact.quantity === ''), true);
    assert.ok(plan.uncertainties.some(value => /haven['’]t counted/.test(value)));
});

test('dates and occupations cannot become inventory under a moving or inventory question', () => {
    for (const question of ['When are you moving?', 'What items are you moving?']) {
        const { plan } = run([agent(question), user('I’m moving next week. I’m a cabinet maker. I’m in Mesa today.')]);
        assert.deepEqual(plan.inventoryItems, []);
        assert.equal(plan.timing, 'next week');
    }
});

test('unpunctuated explicit lists retain each item and its approximate quantity', () => {
    const { record } = run([user('My inventory is a sideboard two ottomans around twenty cartons.')]);
    assert.deepEqual(record.facts.filter(fact => fact.category === 'inventory').map(({ value, quantity }) => ({ value, quantity })), [
        { value: 'sideboard', quantity: 'a' }, { value: 'ottomans', quantity: 'two' }, { value: 'cartons', quantity: 'around twenty' },
    ]);
});

test('tentative items stay tentative while a definite sibling and later removal retain their own state', () => {
    const { record, plan } = run([user('We might take a treadmill and perhaps the workbench. We are definitely taking two tool cabinets.'),
        user('The treadmill is staying. I’m still deciding about the workbench.')]);
    assert.deepEqual(plan.inventoryItems, ['two tool cabinets']);
    assert.equal(record.facts.find(fact => fact.value === 'treadmill').status, 'removed');
    assert.equal(record.facts.find(fact => fact.value === 'workbench').status, 'tentative');
});

test('a declared short item reference preserves an existing dimension-bearing item instead of duplicating it', () => {
    const { plan } = run([user('I have a 90 inch sofa.'), user('The sofa is on our move list.')]);
    assert.deepEqual(plan.inventoryItems, ['a 90 inch sofa']);
});

test('negative access details are positive facts about an absence, not omitted inventory or removed access', () => {
    const { plan } = run([user('Pickup is in Tempe, on the third floor with no elevator. Delivery is in Mesa, ground floor, no stairs. The loading bay at delivery must be reserved.')]);
    assert.ok(plan.accessFactors.some(value => /Origin: no elevator/.test(value)));
    assert.ok(plan.accessFactors.some(value => /Destination: no stairs/.test(value)));
    assert.ok(plan.accessFactors.some(value => /must be reserved/.test(value)));
    assert.deepEqual(plan.inventoryItems, []);
});

test('take-off-list and put-back commands preserve arbitrary item identity and literal original count', () => {
    const original = user('Three reed cases and one painted panel are coming.');
    const removal = user('Take the painted panel off the list. It’s staying here.');
    assert.deepEqual(run([original, removal]).plan.inventoryItems, ['Three reed cases']);
    assert.deepEqual(run([original, removal, user('Actually, put the painted panel back on the move list after all.')]).plan.inventoryItems,
        ['Three reed cases', 'one painted panel']);
});

test('compound remove-and-change actions cannot become item nouns or retain an old quantity', () => {
    const original = user('One couch and two bedside tables are on the move list.');
    const corrected = run([original, user('Remove the sofa, and change the nightstands to one.')]);
    assert.deepEqual(corrected.plan.inventoryItems, ['one bedside tables']);
    assert.equal(corrected.record.facts.some(fact => /change the/.test(fact.value)), false);
    assert.equal(corrected.record.facts.find(fact => fact.value === 'couch').status, 'removed');
    const arbitrary = run([user('I have two amber housings and four woven pods.'), user('Remove the amber housings and update the woven pods to three.')]);
    assert.deepEqual(arbitrary.plan.inventoryItems, ['three woven pods']);
});

test('unresolved action pronouns and count targets remain review notes rather than invented inventory', () => {
    for (const text of ['Put it back.', 'Change the count to one.', 'Take those off the list.']) {
        const { plan } = run([user(text)]);
        assert.deepEqual(plan.inventoryItems, []);
        assert.ok(plan.uncertainties.length, text);
    }
});

test('a committed possible stop removes its own uncertainty without deleting unrelated uncertainty', () => {
    const initial = user('The move is from Scottsdale to Tempe. We may need a storage stop in Mesa, but I’m not sure yet.');
    const before = run([initial]);
    assert.equal(before.plan.possibleStops[0]?.city, 'Mesa');
    const after = run([initial, user('I checked. Definitely include that Mesa storage stop between pickup and delivery.'),
        user('The move requires a special arrangement I cannot describe yet.')]);
    assert.deepEqual(after.plan.stops.map(stop => stop.city), ['Scottsdale', 'Mesa', 'Tempe']);
    assert.equal(after.plan.uncertainties.some(value => /may need a storage|not sure yet/i.test(value)), false);
    assert.ok(after.plan.uncertainties.some(value => /special arrangement/.test(value)));
});

test('a question object enters inventory only after an immediate explicit move-list declaration', () => {
    const question = 'What is the safest way to move my 90-inch framed panel?';
    assert.deepEqual(run([user(question)]).plan.inventoryItems, []);
    const declared = run([user(`${question} It’s on our move list.`)]);
    assert.deepEqual(declared.plan.inventoryItems, ['90-inch framed panel']);
    assert.equal(declared.record.facts.find(fact => fact.category === 'inventory').evidence.length, 2);
    assert.deepEqual(run([user(`${question} I have another question. It’s on our move list.`)]).plan.inventoryItems, []);
    assert.deepEqual(run([user('What is the safest way to move my sofa and piano? It’s on our move list.')]).plan.inventoryItems, []);
});
