import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicEvanCapture } from '../lib/anam/evan-deterministic-capture.ts';
import { currentEvanCaptureFacts, projectEvanCaptureContact, projectEvanCaptureIntake,
    projectEvanCapturePlan, validateEvanCapture } from '../lib/anam/evan-capture.ts';
import { buildEvanEmailBundle } from '../lib/anam/evan-agentmail-templates.ts';

// Independent synthetic conversation tests. Predictions come only from the
// deterministic runtime builder: no mocked facts, fixture oracle or provider.
const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
const active = record => currentEvanCaptureFacts(record).filter(fact => fact.status === 'asserted');
const normalize = value => String(value).replace(/[’]/g, "'").toLowerCase();
const inventory = record => active(record).filter(fact => ['inventory', 'specialty'].includes(fact.category));

function localTest(name, run) {
    test(name, t => {
        t.mock.method(globalThis, 'fetch', () => { assert.fail('Deterministic workflow must never call a network or model'); });
        run();
    });
}

function workflow(turns, revision = 7) {
    const before = JSON.stringify(turns);
    const record = buildDeterministicEvanCapture(turns, revision);
    assert.equal(JSON.stringify(turns), before, 'Capture must not mutate source turns');
    assert.equal(record.schemaVersion, 'evan_capture_v2');
    assert.equal(record.revision, revision);
    assert.equal(record.sourceTurnCount, turns.length);
    assert.deepEqual(validateEvanCapture({ facts: record.facts }, turns, revision), record, 'Actual builder output must satisfy production provenance validation');
    const plan = projectEvanCapturePlan(record), contact = projectEvanCaptureContact(record), intake = projectEvanCaptureIntake(record);
    const bundle = buildEvanEmailBundle({ displayName: 'Synthetic Check-In', verifiedEmail: 'checkin@example.test',
        externalSessionId: 'deterministic-workflow-review', sessionStartedAt: '2026-10-21T12:00:00Z',
        sessionEndedAt: '2026-10-21T12:03:00Z', turns, captureRecord: record });
    assert.deepEqual(bundle.intake, intake);
    return { record, plan, contact, intake, bundle };
}

function assertSharedInventory(result) {
    assert.deepEqual(result.intake.inventory, [...new Set([...result.plan.inventoryItems, ...result.plan.specialtyItems])]);
    for (const item of result.intake.inventory) for (const audience of ['visitor', 'admin', 'sales']) {
        assert.ok(result.bundle[audience].text.includes(item), `${audience} lost current inventory: ${item}`);
    }
}

localTest('deterministic bundled full contact reaches planner and all applicable email identity fields', () => {
    const r = workflow([agent('What else should the moving team know?'),
        user('My contact details are Maëlle Dupré; my phone is 602-555-0176; my email is maelle.dupre@example.test.')]);
    assert.equal(r.contact.displayName, 'Maëlle Dupré');
    assert.equal(r.contact.phone.replace(/\D/g, ''), '6025550176');
    assert.equal(r.contact.email, 'maelle.dupre@example.test');
    assert.equal(r.contact.phoneConfirmed, false);
    assert.equal(r.contact.spokenEmailConfirmed, false);
    assert.match(r.bundle.visitor.text, /^Hi Maëlle,/);
    assert.ok(r.bundle.admin.text.includes('Maëlle Dupré'));
    assert.ok(r.bundle.sales.text.includes('Maëlle Dupré'));
    assert.ok(r.bundle.admin.text.includes(r.contact.phone));
    assert.ok(r.bundle.sales.text.includes(r.contact.phone));
    assert.ok(r.bundle.sales.text.includes('checkin@example.test'), 'Captured spoken email does not change check-in delivery identity');
});

localTest('a later volunteered name correction replaces the earlier identity in every current projection', () => {
    const r = workflow([user('My name is Felix Marlow.'), agent('Any details about the stairs?'),
        user('Actually, my contact information is Rowan Vale, 480-555-0184.')]);
    assert.equal(r.contact.displayName, 'Rowan Vale');
    assert.match(r.bundle.visitor.text, /^Hi Rowan,/);
    for (const audience of ['visitor', 'admin', 'sales']) assert.ok(!r.bundle[audience].text.includes('Felix Marlow'));
    assert.equal(active(r.record).filter(fact => fact.category === 'name').length, 1);
});

localTest('unknown or declined name answers cannot become literal caller identities', () => {
    for (const answer of ["I don't know what name to use.", 'I would rather not give my name.', 'Unknown. My phone is 623-555-0163.']) {
        const r = workflow([agent('What is your full name and a good callback number?'), user(answer)]);
        assert.equal(r.contact.displayName, '', answer);
        assert.equal(active(r.record).some(fact => fact.category === 'name'), false, answer);
    }
});

localTest('agent-only and third-party contact cannot manufacture the visitor identity', () => {
    for (const turns of [
        [agent('Your name is Talia Stone and your email is talia@example.test.'), user('Okay.')],
        [user("My neighbor's name is Talia Stone and her phone is 602-555-0161.")],
        [user('For example, my info is Talia Stone, 602-555-0161.')],
    ]) {
        const r = workflow(turns);
        assert.equal(r.contact.displayName, '');
        assert.equal(r.contact.phone, '');
        assert.equal(r.contact.email, '');
    }
});

localTest('open-ended declared inventory and literal counts reach planner and all email audiences', () => {
    const r = workflow([user('I have two lacquered cabinets, three folding screens, and one bamboo étagère.')]);
    for (const [label, count] of [['lacquered cabinets', 'two'], ['folding screens', 'three'], ['bamboo étagère', 'one']]) {
        const fact = inventory(r.record).find(fact => normalize(fact.value).includes(normalize(label)));
        assert.ok(fact, `Missing declared item: ${label}`);
        assert.equal(fact.quantity, count, `Incorrect declared count: ${label}`);
    }
    assertSharedInventory(r);
});

localTest('quantity replacement and explicit removal do not resurrect old inventory in any projection', () => {
    const turns = [user('I have two lacquered cabinets and three folding screens.'),
        user('Actually, I have four lacquered cabinets. Remove the folding screens from the move.')];
    const r = workflow(turns);
    const cabinets = inventory(r.record).filter(fact => /lacquered cabinets/i.test(fact.value));
    assert.equal(cabinets.length, 1);
    assert.equal(cabinets[0].quantity, 'four');
    assert.equal(inventory(r.record).some(fact => /folding screens/i.test(fact.value)), false);
    assertSharedInventory(r);
    for (const audience of ['visitor', 'admin', 'sales']) {
        assert.doesNotMatch(r.bundle[audience].text, /two lacquered cabinets|three folding screens/i);
    }
});

localTest('same described inventory at different pickup scopes stays distinct', () => {
    const r = workflow([user('At the origin, I have two storage trunks.'),
        user('At the additional stop, I have two storage trunks.')]);
    const trunks = inventory(r.record).filter(fact => /storage trunks/i.test(fact.value));
    assert.equal(trunks.length, 2, 'Separate groups cannot collapse into one group of two');
    assert.equal(new Set(trunks.map(fact => `${fact.location}:${fact.scope}`)).size, 2);
    assert.equal(r.plan.inventoryItems.filter(value => /storage trunks/i.test(value)).length, 2);
    assertSharedInventory(r);
});

localTest('same item at two additional-stop street addresses keeps two independent source scopes', () => {
    const r = workflow([user('At the storage stop at 14 Copper Lane, I have two storage trunks.'),
        user('At the storage stop at 28 Cedar Lane, I have two storage trunks.')]);
    const trunks = inventory(r.record).filter(fact => /storage trunks/i.test(fact.value));
    assert.equal(trunks.length, 2);
    assert.deepEqual(trunks.map(fact => fact.scope).sort(), ['14 Copper Lane', '28 Cedar Lane']);
    assert.ok(trunks.every(fact => fact.location === 'additional' && fact.quantity === 'two'));
    assertSharedInventory(r);
});

localTest('a service question remains a question until the visitor makes an actual request', () => {
    const question = workflow([user('Do you offer packing help?')]);
    assert.equal(active(question.record).some(fact => fact.category === 'service' || fact.category === 'packing'), false);
    assert.ok(active(question.record).some(fact => fact.category === 'question'), 'The unanswered service question should remain available for follow-up');
    const request = workflow([user('Do you offer packing help?'), agent('The team can discuss that.'), user('I need packing help.')]);
    assert.ok(active(request.record).some(fact => ['service', 'packing'].includes(fact.category) && /packing/i.test(fact.value)));
    for (const audience of ['visitor', 'admin', 'sales']) assert.match(request.bundle[audience].text, /packing/i);
});

localTest('questions, hypotheticals and agent suggestions cannot become confirmed move inventory', () => {
    for (const turns of [
        [user('Can you move pianos?')],
        [user('If I had two sofas, could you move them?')],
        [agent('You might want to move a piano and a desk.'), user('I am still deciding what to take.')],
    ]) {
        const r = workflow(turns);
        assert.deepEqual(inventory(r.record), []);
        assert.deepEqual(r.plan.inventoryItems, []);
        assert.deepEqual(r.plan.specialtyItems, []);
    }
});

localTest('tentative packing remains uncertain across planner, intake and all three recaps', () => {
    const r = workflow([user('Maybe I will need packing help, but I have not decided.')]);
    assert.equal(active(r.record).some(fact => ['service', 'packing'].includes(fact.category)), false);
    const uncertain = currentEvanCaptureFacts(r.record).filter(fact => ['tentative', 'unknown'].includes(fact.status) && /packing/i.test(fact.value));
    assert.ok(uncertain.length > 0, 'The stated possibility must not disappear');
    const label = r.plan.uncertainties.find(value => /packing/i.test(value));
    assert.ok(label);
    assert.ok(r.intake.unknowns.includes(label));
    for (const audience of ['visitor', 'admin', 'sales']) assert.ok(r.bundle[audience].text.includes(label), audience);
});

localTest('unknown quantities are not invented from item dimensions or nearby route numbers', () => {
    const r = workflow([user('I have three-tier carts. I am moving from Mesa to Gilbert.')]);
    const carts = inventory(r.record).find(fact => /three-tier carts/i.test(fact.value));
    assert.ok(carts);
    assert.equal(carts.quantity, '', 'A tier count is not an item count');
    assertSharedInventory(r);
});

localTest('fresh full replay is deterministic and the same input never accumulates duplicate quantities', () => {
    const turns = [user('My name is Liora Chen. I have two bamboo benches.'), user('I need loading help.')];
    const first = workflow(turns), second = workflow(structuredClone(turns));
    assert.deepEqual(first.record, second.record);
    assert.deepEqual(first.plan, second.plan);
    assert.deepEqual(first.bundle, second.bundle);
});

for (const [label, statements] of [
    ['contracted ownership negation', ["I don't own two cabinets.", "We don't have three desks."]],
    ['negative ownership quantifier', ['I have no sofas.', 'We own no sideboards.']],
    ['third-party ownership', ['My neighbor has two sofas.', 'Her apartment has three beds.']],
    ['quoted third-party ownership', ['My neighbor said, "I have two sofas".', 'The landlord said, “We own three cabinets.”']],
    ['hypothetical without question punctuation', ['If I had two sofas, I would leave them.', 'If we owned three cabinets, we would sell them.']],
    ['question-preface ownership wording', ['I have a question about moving pianos.', 'We have a question about moving desks.']],
]) {
    localTest(`${label} cannot create confirmed moving inventory`, () => {
        for (const content of statements) {
            const r = workflow([user(content)]);
            assert.deepEqual(inventory(r.record), [], content);
            assert.deepEqual(r.plan.inventoryItems, [], content);
            assert.deepEqual(r.plan.specialtyItems, [], content);
        }
    });
}

localTest('a same-turn explicit exclusion prevents owned items from remaining confirmed moving scope', () => {
    for (const content of ['I have two sofas, but I am not moving them.', 'We own three cabinets, but we are not taking them.']) {
        const r = workflow([user(content)]);
        assert.deepEqual(inventory(r.record), [], content);
        assert.deepEqual(r.plan.inventoryItems, [], content);
    }
});

localTest('accepted ownership and inventory-list forms preserve quantities for unfamiliar item descriptions', () => {
    for (const item of ['reed-fiber screens', 'modular drying racks', 'maple pedestals']) {
        const records = [`I have two ${item}.`, `We own two ${item}.`, `Our inventory includes two ${item}.`, `The items are two ${item}.`]
            .map(content => workflow([user(content)]));
        for (const r of records) {
            assert.deepEqual(inventory(r.record).map(({ value, quantity }) => ({ value, quantity })), [{ value: item, quantity: 'two' }]);
            assertSharedInventory(r);
        }
        for (const r of records.slice(1)) assert.deepEqual(r.plan.inventoryItems, records[0].plan.inventoryItems);
    }
});

localTest('negative and reported clauses do not erase an independent positive ownership clause in the same turn', () => {
    for (const content of [
        'I do not have a piano, but I have three rattan baskets.',
        'My neighbor has two pianos; I have three rattan baskets.',
        'My neighbor said, "I have two pianos"; I have three rattan baskets.',
        'If I owned two pianos, I would sell them; I have three rattan baskets.',
    ]) {
        const r = workflow([user(content)]);
        assert.deepEqual(inventory(r.record).map(({ value, quantity }) => ({ value, quantity })), [{ value: 'rattan baskets', quantity: 'three' }], content);
        assertSharedInventory(r);
    }
});

localTest('the recorded bundled-contact and multi-sentence inventory regression survives the full capture workflow', () => {
    // The relevant turn wording from the previously failed rehearsal is kept
    // intact. This is a local replay, not a new call or an email delivery test.
    const turns = [
        agent("Hi, I'm Evan with Mullins Moving. Tell me a little about the move you're planning, and I'll help you work through the details."),
        user("Thanks Evan. I'm moving from Mesa to Tempe in the second week of November."),
        agent("That's a short local move, and second week of November gives the team some flexibility. What size home are you moving from?"),
        user("It's a 2 bedroom apartment."),
        agent("Good, that helps. Do you know roughly how many boxes, or the main furniture pieces you'll be moving?"),
        user("About 20 to 25 boxes and a queen bed. There's also a love seat and a desk."),
        agent("That's a manageable 2 bedroom load. Do you need help with packing or unpacking, or will you handle that yourself?"),
        user('Hmm, do you help pack fragile dishes? And would that cost extra?'),
        agent('Yes, Mullins offers packing help, including wrapping dishes. The team can confirm materials and any extra charge for your move.'),
        user('Okay. Thanks. What happens next? Could someone call tomorrow about an estimate?'),
        agent("Thanks, I have the move details and the dish-packing question noted. If you'd like, I can email a short recap after the call so the team can follow up on an estimate."),
        user("Sure. I'm Jordan Avery. My phone is 202 555 0146 and my email is jordan.avery@example.com."),
        agent('Thanks Jordan. Did I get that right, two oh two, five five five, oh one four six, and jordan.avery at example dot com?'),
        user("Yes, that's exactly right."),
        agent("Great. After our call ends, I'll send the moving details and the dish-packing question to the Mullins team so they can follow up on an estimate."),
        user("Got it. No, that's everything. I'd like to end the call now, please."),
    ];
    for (const end of [6, turns.length]) {
        const r = workflow(turns.slice(0, end));
        for (const [label, count] of [['boxes', 'About 20 to 25'], ['queen bed', 'a'], ['love seat', 'a'], ['desk', 'a']]) {
            const found = inventory(r.record).find(fact => normalize(fact.value) === normalize(label));
            assert.ok(found, `Missing ${label} at ${end} source turns`);
            assert.equal(normalize(found.quantity), normalize(count), `Wrong literal quantity for ${label}`);
        }
        assertSharedInventory(r);
        if (end === turns.length) {
            assert.equal(r.contact.displayName, 'Jordan Avery');
            assert.equal(r.contact.phone.replace(/\D/g, ''), '2025550146');
            assert.equal(r.contact.email, 'jordan.avery@example.com');
            assert.match(r.contact.callbackWindow, /tomorrow/i);
            assert.match(r.bundle.visitor.text, /^Hi Jordan,/);
            for (const audience of ['visitor', 'admin', 'sales']) {
                assert.match(r.bundle[audience].text, /tomorrow/i);
                assert.match(r.bundle[audience].text, /dishes/i);
            }
            assert.equal(active(r.record).some(fact => ['service', 'packing'].includes(fact.category)), false,
                'Asking about dish-packing help and cost does not order packing');
        }
    }
});

localTest('inventory follow-on sentences accept unfamiliar item nouns without swallowing unrelated details', () => {
    for (const followOn of [
        "There's also one ceramic planter and a metal easel.",
        'There is also one ceramic planter and a metal easel.',
        'We also have one ceramic planter and a metal easel.',
    ]) {
        const r = workflow([agent('What pieces are on your move list?'),
            user(`Two wicker hampers. ${followOn} My phone is 602-555-0168.`)]);
        for (const [label, count] of [['wicker hampers', 'two'], ['ceramic planter', 'one'], ['metal easel', 'a']]) {
            const found = inventory(r.record).find(fact => normalize(fact.value) === label);
            assert.ok(found, `${followOn}: missing ${label}`);
            assert.equal(normalize(found.quantity), count);
        }
        assert.equal(inventory(r.record).length, 3, 'Continuation grammar and contact details must not become extra inventory');
        assert.equal(r.contact.phone.replace(/\D/g, ''), '6025550168');
        assertSharedInventory(r);
    }
});
