import assert from 'node:assert/strict';
import test from 'node:test';
import {
    EvanCaptureValidationError, currentEvanCaptureFacts, projectEvanCaptureContact,
    projectEvanCaptureIntake, projectEvanCapturePlan, validateEvanCapture,
} from '../lib/anam/evan-capture.ts';
import { buildEvanEmailBundle } from '../lib/anam/evan-agentmail-templates.ts';
import { buildGoogleMapsDirectionsUrl } from '../lib/anam/evan-move-planner.ts';

// Independent, hand-authored synthetic probes. No fixture corpus, real transcript,
// environment file, network, or model dependency is loaded by this suite.
const user = content => ({ role: 'user', content });
const fact = (category, value, turn, quote, overrides = {}) => ({
    category, value, status: 'asserted', evidence: [{ turn, quote }],
    location: 'unspecified', scope: '', quantity: '', route: null, ...overrides,
});
const capture = (turns, facts) => validateEvanCapture({ facts }, turns, 1);
const permutations = values => values.length === 0 ? [[]]
    : values.flatMap((value, index) => permutations(values.filter((_, at) => at !== index)).map(rest => [value, ...rest]));
const bundleFor = (turns, captureRecord) => buildEvanEmailBundle({
    displayName: 'Synthetic Visitor', verifiedEmail: 'synthetic@example.test', externalSessionId: 'independent-invariant-probe',
    sessionStartedAt: '2026-10-21T12:00:00Z', sessionEndedAt: '2026-10-21T12:05:00Z', turns, captureRecord,
});

test('control: separate-turn quantity correction, removal, and reinstatement are order-invariant', () => {
    const turns = [
        user('There are two azimuth housings.'), user('Correction: three azimuth housings.'),
        user('Remove the azimuth housings.'), user('Put the four azimuth housings back in the move.'),
    ];
    const facts = [
        fact('inventory', 'azimuth housings', 0, turns[0].content, { quantity: 'two' }),
        fact('inventory', 'azimuth housings', 1, turns[1].content, { quantity: 'three' }),
        fact('inventory', 'azimuth housings', 2, turns[2].content, { status: 'removed' }),
        fact('inventory', 'azimuth housings', 3, turns[3].content, { quantity: 'four' }),
    ];
    for (const ordered of permutations(facts)) {
        const record = capture(turns, ordered);
        assert.deepEqual(projectEvanCapturePlan(record).inventoryItems, ['four azimuth housings']);
        assert.deepEqual(projectEvanCaptureIntake(record).inventory, ['four azimuth housings']);
    }
});

test('control: twenty arbitrary inventory descriptions survive every email audience', () => {
    const descriptions = Array.from({ length: 20 }, (_, index) => `experimental housing number ${index + 1}`);
    const turns = descriptions.map(value => user(`Include ${value}.`));
    const record = capture(turns, descriptions.map((value, index) => fact('inventory', value, index, turns[index].content)));
    assert.deepEqual(projectEvanCapturePlan(record).inventoryItems, descriptions);
    const bundle = bundleFor(turns, record);
    for (const audience of ['visitor', 'admin', 'sales']) {
        for (const value of descriptions) assert.ok(bundle[audience].text.includes(value), `${audience}: ${value}`);
    }
});

test('a count embedded in an item adjective does not replace its separate quantity', () => {
    const turns = [user('I have three three-tier carts and two two-drawer cabinets.')];
    const record = capture(turns, [
        fact('inventory', 'three-tier carts', 0, turns[0].content, { quantity: 'three' }),
        fact('inventory', 'two-drawer cabinets', 0, turns[0].content, { quantity: 'two' }),
    ]);
    const expected = ['three-tier carts (quantity: three)', 'two-drawer cabinets (quantity: two)'];
    assert.deepEqual(projectEvanCapturePlan(record).inventoryItems, expected);
    assert.deepEqual(projectEvanCaptureIntake(record).inventory, expected);
});

test('same descriptions and counts at distinct pickup scopes remain distinct inventory facts', () => {
    const turns = [user('There are two ceramic modules at origin and two ceramic modules at the additional stop.')];
    const record = capture(turns, [
        fact('inventory', 'ceramic modules', 0, turns[0].content, { quantity: 'two', location: 'origin' }),
        fact('inventory', 'ceramic modules', 0, turns[0].content, { quantity: 'two', location: 'additional' }),
    ]);
    assert.equal(currentEvanCaptureFacts(record).length, 2);
    const plan = projectEvanCapturePlan(record);
    assert.equal(plan.inventoryItems.length, 2, 'Two distinct groups must not become one group of two');
    assert.deepEqual(projectEvanCaptureIntake(record).inventory, plan.inventoryItems);
    assert.ok(plan.inventoryItems.some(value => /origin/i.test(value)), 'Preserve which count belongs to origin');
    assert.ok(plan.inventoryItems.some(value => /additional/i.test(value)), 'Preserve which count belongs to the additional stop');
});

test('unconfirmed route display and map query retain the supplied street instead of only the identifying city', () => {
    const turns = [user('The additional storage stop is at 47 Nickel Lane in Mesa.')];
    const record = capture(turns, [fact('route', 'Mesa', 0, turns[0].content, {
        location: 'additional', route: { city: 'Mesa', address: '47 Nickel Lane', purpose: 'storage', order: null },
    })]);
    const [stop] = projectEvanCapturePlan(record).stops;
    assert.equal(stop.address, '47 Nickel Lane');
    assert.equal(stop.confirmed, false);
    assert.equal(stop.coordinates, undefined);
    const query = new URL(buildGoogleMapsDirectionsUrl([stop])).searchParams.get('query');
    assert.ok(query.includes('47 Nickel Lane'), `The map query dropped the supplied street: ${query}`);
    assert.ok(stop.displayAddress.includes('47 Nickel Lane'), `The route card dropped the supplied street: ${stop.displayAddress}`);
});

test('capture recap does not silently discard questions after the legacy six-question cap', () => {
    const questions = Array.from({ length: 8 }, (_, index) => `Can the crew review procedure number ${index + 1}?`);
    const turns = questions.map(user);
    const record = capture(turns, questions.map((value, index) => fact('question', value, index, value)));
    assert.deepEqual(projectEvanCaptureIntake(record).quoteRequests, questions);
    const bundle = bundleFor(turns, record);
    for (const audience of ['visitor', 'admin', 'sales']) {
        for (const value of questions) assert.ok(bundle[audience].text.includes(value), `${audience} lost ${value}`);
    }
});

test('capture recap preserves validated item labels beyond the legacy 360-character cleaning limit', () => {
    const value = 'x'.repeat(340) + ' end-marker-unique';
    const turns = [user(`Include seventeen ${value}.`)];
    const record = capture(turns, [fact('inventory', value, 0, turns[0].content, { quantity: 'seventeen' })]);
    const [label] = projectEvanCapturePlan(record).inventoryItems;
    assert.ok(value.length <= 360, 'The source description is within the capture schema bound');
    assert.ok(label.length > 360, 'The quantity creates a valid display label longer than the source field bound');
    const bundle = bundleFor(turns, record);
    for (const audience of ['visitor', 'admin', 'sales']) {
        assert.ok(bundle[audience].text.includes(label), `${audience} truncated the validated item label`);
    }
});

test('same-turn singleton contradiction validation is invariant to an intervening tombstone', () => {
    const turns = [user('My name was Mika, then Rene; remove my name.')];
    const contradictory = [
        fact('name', 'Mika', 0, turns[0].content),
        fact('name', 'Rene', 0, turns[0].content),
        fact('name', 'name', 0, turns[0].content, { status: 'removed' }),
    ];
    const outcomes = permutations(contradictory).map(ordered => {
        try {
            const record = capture(turns, ordered);
            assert.equal(projectEvanCaptureContact(record).displayName, '');
            return 'accepted';
        } catch (error) {
            assert.ok(error instanceof EvanCaptureValidationError);
            return 'rejected';
        }
    });
    assert.equal(new Set(outcomes).size, 1, `Array ordering changed validation outcome: ${outcomes.join(', ')}`);
});

test('scope is required, literal source-backed text, and cannot be an invented identity', () => {
    const turns = [user('There are two ceramic modules at 47 Nickel Lane.')];
    const base = fact('inventory', 'ceramic modules', 0, turns[0].content, { quantity: 'two', location: 'additional', scope: '47 Nickel Lane' });
    assert.equal(capture(turns, [base]).schemaVersion, 'evan_capture_v2');
    for (const scope of [undefined, null, 47, 'invented-group-1', 'Nickel 47 Lane', 'x'.repeat(361), '47 Nickel Lane\u0000']) {
        assert.throws(() => capture(turns, [{ ...base, scope }]), EvanCaptureValidationError);
    }
    const { scope: omitted, ...v1Fact } = base;
    assert.equal(omitted, '47 Nickel Lane');
    assert.throws(() => capture(turns, [v1Fact]), EvanCaptureValidationError);
});

test('distinct additional-stop groups retain their literal scopes and quantities', () => {
    const turns = [user('There are two ceramic modules at 47 Nickel Lane and three ceramic modules at 53 Cobalt Lane.')];
    const record = capture(turns, [
        fact('inventory', 'ceramic modules', 0, turns[0].content, { quantity: 'two', location: 'additional', scope: '47 Nickel Lane' }),
        fact('inventory', 'ceramic modules', 0, turns[0].content, { quantity: 'three', location: 'additional', scope: '53 Cobalt Lane' }),
    ]);
    const expected = ['Additional stop: two ceramic modules [Scope: 47 Nickel Lane]',
        'Additional stop: three ceramic modules [Scope: 53 Cobalt Lane]'];
    assert.equal(currentEvanCaptureFacts(record).length, 2);
    assert.deepEqual(projectEvanCapturePlan(record).inventoryItems, expected);
    assert.deepEqual(projectEvanCaptureIntake(record).inventory, expected);
    const bundle = bundleFor(turns, record);
    for (const audience of ['visitor', 'admin', 'sales']) {
        for (const label of expected) assert.ok(bundle[audience].text.includes(label), `${audience}: ${label}`);
    }
});

test('scoped correction, removal and reinstatement affect only the intended same-role item group', () => {
    const turns = [
        user('There are two ceramic modules at 47 Nickel Lane.'),
        user('There are three ceramic modules at 53 Cobalt Lane.'),
        user('Correction: four ceramic modules at 47 Nickel Lane.'),
        user('Remove ceramic modules at 47 Nickel Lane.'),
        user('Reinstate one ceramic modules at 47 Nickel Lane.'),
    ];
    const facts = [
        fact('inventory', 'ceramic modules', 0, turns[0].content, { quantity: 'two', location: 'additional', scope: '47 Nickel Lane' }),
        fact('inventory', 'ceramic modules', 1, turns[1].content, { quantity: 'three', location: 'additional', scope: '53 Cobalt Lane' }),
        fact('inventory', 'ceramic modules', 2, turns[2].content, { quantity: 'four', location: 'additional', scope: '47 Nickel Lane' }),
        fact('inventory', 'ceramic modules', 3, turns[3].content, { status: 'removed', location: 'additional', scope: '47 Nickel Lane' }),
        fact('inventory', 'ceramic modules', 4, turns[4].content, { quantity: 'one', location: 'additional', scope: '47 Nickel Lane' }),
    ];
    for (const ordered of permutations(facts.slice(0, 4))) {
        assert.deepEqual(projectEvanCapturePlan(capture(turns.slice(0, 4), ordered)).inventoryItems,
            ['Additional stop: three ceramic modules [Scope: 53 Cobalt Lane]']);
    }
    for (const ordered of permutations(facts)) {
        assert.deepEqual(projectEvanCapturePlan(capture(turns, ordered)).inventoryItems.sort(), [
            'Additional stop: one ceramic modules [Scope: 47 Nickel Lane]',
            'Additional stop: three ceramic modules [Scope: 53 Cobalt Lane]',
        ].sort());
    }
});

test('additional-route scope remains stable across address corrections and cannot retain stale pins', () => {
    const turns = [user('The storage stop is at 47 Nickel Lane in Mesa.'),
        user('Correction: the storage stop is now at 53 Cobalt Lane in Tempe.')];
    const original = fact('route', 'Mesa', 0, turns[0].content, { location: 'additional', scope: 'storage',
        route: { city: 'Mesa', address: '47 Nickel Lane', purpose: 'storage', order: 1 } });
    const corrected = { ...original, evidence: [{ turn: 0, quote: turns[0].content }, { turn: 1, quote: turns[1].content }],
        route: { city: 'Tempe', address: '53 Cobalt Lane', purpose: 'storage', order: 1 } };
    for (const ordered of permutations([original, corrected])) {
        const record = capture(turns, ordered);
        const stops = projectEvanCapturePlan(record, [{ kind: 'Additional stop', city: 'Mesa', address: '47 Nickel Lane',
            displayAddress: '47 Nickel Lane, Mesa, AZ', coordinates: { latitude: 33.4, longitude: -111.8 }, confirmed: true, precision: 'address' }]).stops;
        assert.equal(stops.length, 1);
        assert.equal(stops[0].city, 'Tempe');
        assert.equal(stops[0].address, '53 Cobalt Lane');
        assert.equal(stops[0].displayAddress, '53 Cobalt Lane, Tempe');
        assert.equal(stops[0].coordinates, undefined);
        assert.equal(stops[0].confirmed, false);
    }
});

test('scope does not split singleton contact identities or resurrect an earlier contact', () => {
    const turns = [user('At home I go by Mika.'), user('For work call me Rene.'), user('Remove my name at home.')];
    const facts = [fact('name', 'Mika', 0, turns[0].content, { scope: 'home' }),
        fact('name', 'Rene', 1, turns[1].content, { scope: 'work' }),
        fact('name', 'name', 2, turns[2].content, { scope: 'home', status: 'removed' })];
    assert.equal(projectEvanCaptureContact(capture(turns.slice(0, 2), facts.slice(0, 2))).displayName, 'Rene');
    for (const ordered of permutations(facts)) {
        const record = capture(turns, ordered);
        assert.equal(currentEvanCaptureFacts(record).length, 1);
        assert.equal(projectEvanCaptureContact(record, { displayName: 'Earlier check-in name' }).displayName, '');
    }
});

test('packing remains one current state per explicit scope, while distinct subjects remain visible', () => {
    const turns = [user('For paintings use self packing. For glassware use crew packing.'),
        user('Correction: paintings need crew packing.')];
    const facts = [fact('packing', 'self packing', 0, turns[0].content, { location: 'origin', scope: 'paintings' }),
        fact('packing', 'crew packing', 0, turns[0].content, { location: 'origin', scope: 'glassware' }),
        fact('packing', 'crew packing', 1, turns[1].content, { location: 'origin', scope: 'paintings' })];
    for (const ordered of permutations(facts)) {
        const plan = projectEvanCapturePlan(capture(turns, ordered));
        assert.equal(currentEvanCaptureFacts(capture(turns, ordered)).length, 2);
        assert.ok(plan.packingPlan.includes('Origin: crew packing [Scope: paintings]'));
        assert.ok(plan.packingPlan.includes('Origin: crew packing [Scope: glassware]'));
        assert.equal(plan.packingPlan.includes('self packing'), false);
    }
});

test('unresolved same-role inventory does not invent scope or aggregate conflicting counts', () => {
    const turns = [user('There are two or three ceramic modules at the additional stops; I do not know which stop or total.')];
    assert.throws(() => capture(turns, [
        fact('inventory', 'ceramic modules', 0, turns[0].content, { quantity: 'two', location: 'additional' }),
        fact('inventory', 'ceramic modules', 0, turns[0].content, { quantity: 'three', location: 'additional' }),
    ]), EvanCaptureValidationError);
    const unresolved = capture(turns, [fact('inventory', 'ceramic modules', 0, turns[0].content,
        { status: 'unknown', location: 'additional' })]);
    assert.deepEqual(projectEvanCapturePlan(unresolved).inventoryItems, []);
    assert.deepEqual(projectEvanCapturePlan(unresolved).uncertainties, ['To confirm: Additional stop: ceramic modules']);
    assert.equal(currentEvanCaptureFacts(unresolved)[0].scope, '');
    assert.equal(currentEvanCaptureFacts(unresolved)[0].quantity, '');
});
