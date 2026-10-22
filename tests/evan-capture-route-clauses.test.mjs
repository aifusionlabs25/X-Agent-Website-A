import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicEvanCapture } from '../lib/anam/evan-deterministic-capture.ts';
import { projectEvanCapturePlan } from '../lib/anam/evan-capture.ts';
import { buildEvanEmailBundle } from '../lib/anam/evan-agentmail-templates.ts';

const user = content => ({ role: 'user', content });
function replay(t, turns) {
    t.mock.method(globalThis, 'fetch', () => assert.fail('Route capture replay is local only'));
    const record = buildDeterministicEvanCapture(turns, 1);
    const plan = projectEvanCapturePlan(record);
    const emails = buildEvanEmailBundle({ displayName: 'Local Test', verifiedEmail: 'local@example.test',
        externalSessionId: 'local-route-clauses', sessionStartedAt: '2026-10-21T12:00:00Z',
        sessionEndedAt: '2026-10-21T12:03:00Z', turns, captureRecord: record });
    return { record, plan, emails };
}

test('one utterance retains two different street stops in the same city through targeted removal', t => {
    const turns = [user('Pickup is Phoenix and delivery is Tempe. Between them, stop at my storage unit at 14 Copper Road in Mesa, then at the donation center at 28 Cedar Avenue in Mesa.')];
    const first = replay(t, turns);
    assert.deepEqual(first.plan.stops.map(stop => [stop.kind, stop.city, stop.address ?? '']), [
        ['Origin', 'Phoenix', ''], ['Additional stop', 'Mesa', '14 Copper Road'],
        ['Additional stop', 'Mesa', '28 Cedar Avenue'], ['Destination', 'Tempe', ''],
    ]);
    const final = replay(t, [...turns, user('Cancel only the donation center stop. Keep the Mesa storage unit.')]);
    assert.deepEqual(final.plan.stops.map(stop => stop.address).filter(Boolean), ['14 Copper Road']);
    for (const audience of ['visitor', 'sales', 'admin']) {
        assert.ok(final.emails[audience].text.includes('14 Copper Road'));
        assert.ok(!final.emails[audience].text.includes('28 Cedar Avenue'), `${audience} retained the cancelled stop`);
    }
});

test('sequential address clauses bind each address to its own stated city and purpose', t => {
    const result = replay(t, [user('Pickup is Scottsdale and delivery is Chandler. Stop at storage at 37 Willow Lane in Mesa, then at donation at 64 Birch Way in Tempe.')]);
    assert.deepEqual(result.plan.stops.filter(stop => stop.kind === 'Additional stop').map(stop => [stop.city, stop.address, stop.label]), [
        ['Mesa', '37 Willow Lane', 'storage'], ['Tempe', '64 Birch Way', 'donation'],
    ]);
    assert.deepEqual(result.plan.inventoryItems, []);
});

test('an explicit paired-city prefix does not lose its route or counted inventory suffix', t => {
    for (const [route, expected] of [['Phoenix to Mesa', ['Phoenix', 'Mesa']], ['Gilbert to Chandler', ['Gilbert', 'Chandler']]]) {
        const result = replay(t, [user(`${route}, two woven pods and three modular screens.`)]);
        assert.deepEqual(result.plan.stops.map(stop => stop.city), expected);
        assert.deepEqual(result.plan.inventoryItems, ['two woven pods', 'three modular screens']);
        for (const audience of ['visitor', 'sales', 'admin']) {
            assert.ok(result.emails[audience].text.includes('two woven pods'));
            assert.ok(result.emails[audience].text.includes('three modular screens'));
        }
    }
});

test('route-like examples and questions cannot authorize a paired route or its inventory suffix', t => {
    for (const text of [
        'For example, Phoenix to Mesa, two woven pods and three modular screens.',
        'What if we move from Phoenix to Mesa, two woven pods and three modular screens?',
        'My neighbor said "Phoenix to Mesa, two woven pods and three modular screens."',
    ]) {
        const { plan } = replay(t, [user(text)]);
        assert.deepEqual(plan.stops, []);
        assert.deepEqual(plan.inventoryItems, []);
    }
});

test('a duration after a paired route is timing, not inventory', t => {
    const { plan } = replay(t, [user('Phoenix to Mesa, two weeks.')]);
    assert.deepEqual(plan.stops.map(stop => stop.city), ['Phoenix', 'Mesa']);
    assert.deepEqual(plan.inventoryItems, []);
    assert.equal(plan.timing, 'two weeks');
});

test('splitting a multi-address sentence cannot promote shared tentative or negative intent', t => {
    for (const prefix of ['We might stop', 'We do not want to stop']) {
        const { plan } = replay(t, [user(`${prefix} at storage at 14 Copper Road in Mesa, then at donation at 28 Cedar Avenue in Tempe.`)]);
        assert.deepEqual(plan.stops, []);
    }
});
