import assert from 'node:assert/strict';
import test from 'node:test';
import { parityFor, scoreCapture, scoreProjectionParity } from '../scripts/anam/evaluate-evan-capture.mjs';
import { validateEvanCapture } from '../lib/anam/evan-capture.ts';

// Independent adversarial scorer inputs, not extractor predictions. These do
// not load the development or holdout corpus, invoke main(), or use a provider.
function detailScore({ expected, actual, category = 'packing', field = 'packing.responsibility', location = 'unspecified' }) {
    const turns = [{ role: 'user', content: `${actual}? No. ${expected}.` }];
    const record = validateEvanCapture({ facts: [{ category, value: actual, quantity: '', location, scope: '',
        status: 'asserted', route: null, evidence: [{ turn: 0, quote: turns[0].content }] }] }, turns, 1);
    return scoreCapture({ details: [{ field, value: expected, sourceTurns: [0] }] }, record, turns);
}

test('swapping responsibility between the same two roles cannot receive full semantic credit', () => {
    const result = detailScore({ expected: 'We pack books and you pack dishes', actual: 'You pack books and we pack dishes' });
    assert.equal(result.quoteGrounding.lowerBound, 1, 'Literal quotes do not establish relational meaning');
    assert.notEqual(result.recall.lowerBound, 1);
    assert.notEqual(result.semanticGrounding.lowerBound, 1);
    assert.ok(result.needsReviewCount > 0);
});

test('moving negation between two access facts cannot receive full semantic credit', () => {
    const result = detailScore({ expected: 'No stairs and elevator available', actual: 'Stairs available and no elevator',
        category: 'access', field: 'access.origin', location: 'origin' });
    assert.notEqual(result.recall.lowerBound, 1);
    assert.notEqual(result.semanticGrounding.lowerBound, 1);
    assert.ok(result.needsReviewCount > 0);
});

test('conjunction, modality, contracted negation and reflexive ownership mutations are not certified', () => {
    for (const [expected, actual] of [
        ['Pack books and dishes', 'Pack books or dishes'],
        ['We will pack books', 'We could pack books'],
        ["We don't pack books", 'We pack books'],
        ['Packing by myself', 'Packing by yourself'],
        ['Pack books before dishes', 'Pack dishes before books'],
    ]) {
        const result = detailScore({ expected, actual });
        assert.notEqual(result.recall.lowerBound, 1, `${expected} versus ${actual}`);
        assert.notEqual(result.semanticGrounding.lowerBound, 1, `${expected} versus ${actual}`);
    }
});

test('exact unambiguous details and harmless ordered alias/inflection changes retain full credit', () => {
    for (const [expected, actual] of [
        ['We pack books and you pack dishes', 'We pack books and you pack dishes'],
        ['We pack the cartons', 'We pack boxes'],
        ['Self-packing', 'We pack'],
    ]) {
        const result = detailScore({ expected, actual });
        assert.equal(result.recall.lowerBound, 1, `${expected} versus ${actual}`);
        assert.equal(result.precision.lowerBound, 1, `${expected} versus ${actual}`);
        assert.equal(result.failureCount, 0);
        assert.equal(result.needsReviewCount, 0);
    }
});

test('valid reordered paraphrases are deliberately reviewable rather than presumed equivalent', () => {
    const result = detailScore({ expected: 'We pack books', actual: 'Books we pack' });
    assert.equal(result.recall.passed, 0);
    assert.equal(result.recall.needsReview, 1);
    assert.equal(result.failureCount, 0);
});

function uncertainQuantityScore(quantity, facts = null) {
    const turns = [{ role: 'user', content: 'We might move two cabinets, not three cabinets.' }];
    const record = validateEvanCapture({ facts: facts ?? [{ category: 'inventory', value: 'cabinets', quantity,
        location: 'unspecified', status: 'tentative', route: null, scope: '', evidence: [{ turn: 0, quote: turns[0].content }] }] }, turns, 1);
    return scoreCapture({ uncertain: [{ field: 'inventory', value: 'cabinets', reason: 'not decided',
        quantity: { kind: 'exact', value: 2 }, sourceTurns: [0] }] }, record, turns);
}

test('uncertain quantities retain entity and quantity denominators for valid, wrong and absent output', () => {
    const valid = uncertainQuantityScore('two'), wrong = uncertainQuantityScore('three'), absent = uncertainQuantityScore('', []);
    for (const result of [valid, wrong, absent]) {
        assert.equal(result.recall.total, 2);
        assert.equal(result.quantity.total, 1);
    }
    assert.equal(valid.recall.lowerBound, 1);
    assert.equal(valid.quantity.lowerBound, 1);
    assert.equal(valid.precision.lowerBound, 1);
    assert.equal(wrong.recall.lowerBound, 0.5);
    assert.equal(wrong.quantity.lowerBound, 0);
    assert.equal(wrong.precision.lowerBound, 0);
    assert.equal(absent.recall.lowerBound, 0);
    assert.equal(absent.quantity.lowerBound, 0);
});

function projectionFixture(specs) {
    const turns = specs.map(spec => ({ role: 'user', content: spec.source ?? `${spec.quantity ?? ''} ${spec.value} ${spec.scope ?? ''}`.trim() }));
    const facts = specs.map((spec, turn) => ({ category: spec.category ?? 'inventory', value: spec.value, quantity: spec.quantity ?? '',
        status: spec.status ?? 'asserted', location: spec.location ?? 'unspecified', scope: spec.scope ?? '', route: spec.route ?? null,
        evidence: [{ turn, quote: turns[turn].content }] }));
    const record = validateEvanCapture({ facts }, turns, 1);
    return { record, ...parityFor(record, turns) };
}

test('projection parity binds every count to its own item in planner, intake and all email audiences', () => {
    const f = projectionFixture([{ value: 'chairs', quantity: 'two' }, { value: 'tables', quantity: 'three' }]);
    assert.equal(f.metric.lowerBound, 1);
    const mutated = structuredClone(f.projections);
    const swap = text => text.replaceAll('two chairs', 'three chairs').replaceAll('three tables', 'two tables');
    mutated.plan.inventoryItems = mutated.plan.inventoryItems.map(swap);
    mutated.intake.inventory = mutated.intake.inventory.map(swap);
    for (const field of ['visitorText', 'salesText', 'adminText']) mutated[field] = swap(mutated[field]);
    const result = scoreProjectionParity(f.record, mutated);
    for (const consumer of ['planner', 'intake', 'visitor.text', 'sales.text', 'admin.text']) {
        const checks = result.checks.filter(check => check.consumer === consumer);
        assert.equal(checks.length, 2);
        assert.ok(checks.every(check => check.outcome !== 'pass'), `${consumer} falsely certified swapped counts`);
    }
});

test('projection parity cannot use a substring of another count to certify a quantity', () => {
    const f = projectionFixture([{ value: 'chairs', quantity: '2' }]);
    const mutated = structuredClone(f.projections);
    mutated.plan.inventoryItems = ['12 chairs'];
    assert.notEqual(scoreProjectionParity(f.record, mutated).checks.find(check => check.consumer === 'planner').outcome, 'pass');
});

test('projection parity preserves endpoint and literal scope on the same inventory entity', () => {
    const f = projectionFixture([
        { value: 'chairs', quantity: 'two', location: 'origin', scope: '14 Copper Lane' },
        { value: 'tables', quantity: 'three', location: 'additional', scope: '28 Cedar Lane' },
    ]);
    assert.equal(f.metric.lowerBound, 1);
    const mutated = structuredClone(f.projections);
    mutated.plan.inventoryItems = ['Origin: two chairs [Scope: 28 Cedar Lane]', 'Additional stop: three tables [Scope: 14 Copper Lane]'];
    const scoped = scoreProjectionParity(f.record, mutated).checks.filter(check => check.consumer === 'planner');
    assert.ok(scoped.every(check => check.outcome !== 'pass'));
    mutated.plan.inventoryItems = ['Destination: two chairs [Scope: 14 Copper Lane]', 'Additional stop: three tables [Scope: 28 Cedar Lane]'];
    assert.notEqual(scoreProjectionParity(f.record, mutated).checks.find(check => check.consumer === 'planner' && check.value === 'chairs').outcome, 'pass');
});

test('quantity-bearing adjectives retain a separate count and scope through every applicable projection', () => {
    const f = projectionFixture([{ value: 'three-tier carts', quantity: 'three', location: 'origin', scope: '14 Copper Lane' }]);
    assert.equal(f.metric.lowerBound, 1);
    const mutated = structuredClone(f.projections);
    mutated.plan.inventoryItems = ['Origin: three-tier carts [Scope: 14 Copper Lane]'];
    assert.notEqual(scoreProjectionParity(f.record, mutated).checks.find(check => check.consumer === 'planner').outcome, 'pass');
});

test('uncertainty parity requires its state label and quantity in email as well as planner/intake', () => {
    const f = projectionFixture([{ value: 'cabinets', quantity: 'two', status: 'tentative' }]);
    assert.equal(f.metric.lowerBound, 1);
    const mutated = structuredClone(f.projections);
    mutated.visitorText = mutated.visitorText.replaceAll('Possible: two cabinets', 'two cabinets');
    assert.notEqual(scoreProjectionParity(f.record, mutated).checks.find(check => check.consumer === 'visitor.text').outcome, 'pass');
});

test('question and contact projection policy reports omitted dimensions rather than implying complete parity', () => {
    const f = projectionFixture([{ category: 'question', value: 'Can the crew pack the framed sketches?' },
        { category: 'phone', value: '602-555-0198' }]);
    assert.equal(f.metric.lowerBound, 1);
    assert.equal(f.coverage.complete, false);
    assert.ok(f.coverage.omissions.some(entry => entry.category === 'question' && entry.consumer === 'planner'));
    assert.ok(f.coverage.omissions.some(entry => entry.category === 'phone' && entry.consumer === 'visitor.text'));
    const mutated = structuredClone(f.projections);
    mutated.adminText = mutated.adminText.replaceAll('Can the crew pack the framed sketches?', 'Question omitted');
    assert.notEqual(scoreProjectionParity(f.record, mutated).checks.find(check => check.category === 'question' && check.consumer === 'admin.text').outcome, 'pass');
});

test('route parity requires address and purpose on one matching endpoint, not somewhere across two stops', () => {
    const f = projectionFixture([
        { category: 'route', value: 'Mesa', location: 'origin', source: 'Mesa 14 Copper Lane storage',
            route: { city: 'Mesa', address: '14 Copper Lane', purpose: 'storage', order: 0 } },
        { category: 'route', value: 'Mesa', location: 'destination', source: 'Mesa 28 Cedar Lane donation',
            route: { city: 'Mesa', address: '28 Cedar Lane', purpose: 'donation', order: 1 } },
    ]);
    assert.equal(f.metric.lowerBound, 1);
    const mutated = structuredClone(f.projections);
    [mutated.plan.stops[0].address, mutated.plan.stops[1].address] = [mutated.plan.stops[1].address, mutated.plan.stops[0].address];
    const checks = scoreProjectionParity(f.record, mutated).checks.filter(check => check.consumer === 'planner.route');
    assert.ok(checks.every(check => check.outcome === 'fail'));
});
