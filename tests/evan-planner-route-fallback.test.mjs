import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvanPlannerAutoOpen } from '../lib/anam/evan-planner-auto-open.ts';
import { buildEvanMovePlan } from '../lib/anam/evan-move-planner.ts';

const user = content => ({ role: 'user', content });
const agent = content => ({ role: 'agent', content });
const route = turns => buildEvanMovePlan(turns).stops;
const endpoints = [{ kind: 'Origin', city: 'Gilbert' }, { kind: 'Destination', city: 'Mesa' }];

test('a customer can volunteer a complete route before Evan asks a question', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    assert.equal(tracker.observeRouteStops(route([user('I am moving from Gilbert to Mesa.')])), true);
    assert.equal(tracker.observeRouteStops(endpoints), false);
    assert.equal(tracker.observeAgentText('Where are you moving from and to?'), false);
    assert.equal(opens, 1);
});

test('actual live-test customer answer is enough even if the question trigger is missed', () => {
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => {} });
    const stops = route([user("Fine, from Gilbert to Mesa, but why should I trust you won't just shrug again?")]);
    assert.deepEqual(stops.map(({ kind, city }) => ({ kind, city })), endpoints);
    assert.equal(tracker.observeRouteStops(stops), true);
});

test('a first useful location opens without claiming a complete route', () => {
    for (const stops of [endpoints.slice(0, 1), endpoints.slice(1),
        [{ kind: 'Additional stop', city: 'Gilbert' }],
        [{ kind: 'Origin', city: 'Gilbert' }, { kind: 'Additional stop', city: 'Mesa' }],
        [{ kind: 'Origin', city: ' ' }, endpoints[1]],
    ]) {
        let opens = 0;
        const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
        const before = structuredClone(stops);
        assert.equal(tracker.observeRouteStops(stops), true);
        assert.equal(opens, 1);
        assert.deepEqual(stops, before, 'display must not fill in missing endpoints');
    }
});

test('empty and blank locations never auto-open', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    for (const stops of [[], [{ kind: 'Origin', city: ' ' }], [{ kind: 'Destination', city: '' }],
    ]) assert.equal(tracker.observeRouteStops(stops), false);
    assert.equal(opens, 0);
});

test('separate user answers open after the origin and do not reopen after the destination', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    const turns = [user('The pickup is in Gilbert.')];
    assert.equal(tracker.observeRouteStops(route(turns)), true);
    turns.push(agent('And the destination?'), user('The destination is Mesa.'));
    assert.equal(tracker.observeRouteStops(route(turns)), false);
    assert.equal(opens, 1);
});

test('hypotheticals, unsupported locations, and agent-provided example routes do not open the fallback', () => {
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => assert.fail('unexpected opening') });
    for (const turns of [
        [user('What if I move from Gilbert to Mesa?')],
        [user('Maybe Gilbert to Mesa.')],
        [agent('For example, from Gilbert to Mesa.'), user('Tell me more about packing.')],
        [user('My friends live in Gilbert and Mesa.')],
        [user('I am moving from Somewhere to Somewhere Else.')],
    ]) assert.equal(tracker.observeRouteStops(route(turns)), false);
});

test('route fallback recovers a user answer arriving before the final persona marker', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    tracker.observeMessage({ id: 'persona::p1', role: 'persona', content: 'Where are you moving from and to?', endOfSpeech: false });
    tracker.observeMessage({ id: 'user::u1', role: 'user', content: 'From Gilbert to Mesa.', endOfSpeech: true });
    assert.equal(tracker.observeRouteStops(route([user('From Gilbert to Mesa.')])), true);
    assert.equal(tracker.observeMessage({ id: 'persona::p1', role: 'persona', content: '', endOfSpeech: true }), false);
    assert.equal(opens, 1);
});

test('manual opening, dismissal, and disposal disable the route fallback as well as question opening', () => {
    for (const action of ['markOpened', 'dismiss', 'dispose']) {
        const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => assert.fail('unexpected reopening') });
        tracker[action]();
        assert.equal(tracker.observeRouteStops(endpoints), false);
        assert.equal(tracker.observeAgentText('Where are you moving from and to?'), false);
    }
});

test('closing after automatic opening prevents new routes from reopening in the same session', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    tracker.observeRouteStops(endpoints);
    tracker.dismiss();
    assert.equal(tracker.observeRouteStops(route([user('Actually from Phoenix to Chandler.')])), false);
    assert.equal(opens, 1);
    assert.equal(createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ }).observeRouteStops(endpoints), true);
    assert.equal(opens, 2);
});
