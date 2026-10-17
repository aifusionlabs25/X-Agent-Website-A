import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { finishAbandonedEvanRouteLookup, preserveUnchangedEvanRoutePins, reconcileEvanConfirmedRoute } from '../lib/anam/evan-route-reconciliation.ts';
import { buildEvanMovePlan, buildGoogleMapsDirectionsUrl } from '../lib/anam/evan-move-planner.ts';

const origin = { kind: 'Origin', city: 'Phoenix', address: '100 E Main St, Phoenix, AZ', displayAddress: '100 E Main St, Phoenix, AZ', confirmed: true, precision: 'address', coordinates: { latitude: 33.4, longitude: -112.1 } };
const destination = { ...origin, kind: 'Destination', address: '200 W Washington St, Phoenix, AZ', displayAddress: '200 W Washington St, Phoenix, AZ', coordinates: { latitude: 33.5, longitude: -112.2 } };
const stops = [origin, destination];

test('identical street names in different cities never reuse coordinates', () => {
    const changed = preserveUnchangedEvanRoutePins([{ ...origin, address: '100 E Main St', city: 'Mesa', coordinates: undefined, precision: 'pending' }],
        [{ ...origin, address: '100 E Main St' }]);
    assert.equal(changed[0].coordinates, undefined);
    assert.equal(changed[0].precision, 'pending');
});

test('a view change or correction releases abandoned pending state without downgrading resolved pins', () => {
    const updated = finishAbandonedEvanRouteLookup([origin, { ...destination, coordinates: undefined, precision: 'pending' }]);
    assert.equal(updated[0], origin);
    assert.equal(updated[1].precision, 'unresolved');
    assert.equal(finishAbandonedEvanRouteLookup(updated), updated);
});

test('short city answers use the immediately preceding location question', () => {
    const changed = reconcileEvanConfirmedRoute(stops, 'Scottsdale.', 'What is the new destination?');
    assert.equal(changed[0], origin);
    assert.equal(changed.length, 2);
    assert.equal(changed[1].kind, 'Destination');
    assert.equal(changed[1].city, 'Scottsdale');
});

test('unrelated uncertainty does not suppress an explicit street correction', () => {
    const changed = reconcileEvanConfirmedRoute(stops, 'Actually change the destination address to 300 W Adams Street in Phoenix. Maybe we need packing.');
    assert.equal(changed[0], origin);
    assert.equal(changed[1].confirmed, false);
    assert.equal(changed[1].coordinates, undefined);
});

test('unchanged street pins survive pending lookups while changed addresses remain pending', () => {
    const pending = preserveUnchangedEvanRoutePins([
        { kind: 'Origin', city: 'Phoenix', address: '100 East Main Street, Phoenix, AZ', precision: 'pending', confirmed: true },
        { kind: 'Destination', city: 'Phoenix', address: '300 W Adams St, Phoenix, AZ', precision: 'pending', confirmed: true },
    ], stops);
    assert.deepEqual(pending[0].coordinates, origin.coordinates);
    assert.equal(pending[0].precision, 'address');
    assert.equal(pending[1].coordinates, undefined);
    assert.equal(pending[1].precision, 'pending');
    const failed = preserveUnchangedEvanRoutePins(pending.map(({coordinates: _coordinates, ...stop}) => ({ ...stop, precision: 'unresolved' })), stops);
    assert.equal(failed[0].precision, 'address');
    assert.equal(failed[1].precision, 'unresolved');
});

test('confirmed street route adopts spoken city replacement and retains unaffected street pin', () => {
    const changed = reconcileEvanConfirmedRoute(stops, 'Actually change the destination to Scottsdale.');
    assert.equal(changed[0], origin);
    assert.equal(changed[1].city, 'Scottsdale');
    assert.equal(changed[1].address, undefined);
    assert.equal(changed[1].coordinates, undefined);
    assert.doesNotMatch(buildGoogleMapsDirectionsUrl(changed), /Washington/);
});

test('same-city street correction removes old pin and link until reconfirmed, without geocoding', () => {
    const changed = reconcileEvanConfirmedRoute(stops, 'Actually change the destination address to 300 W Adams Street in Phoenix.');
    assert.equal(changed[0], origin);
    assert.equal(changed[1].city, 'Phoenix');
    assert.equal(changed[1].address, undefined);
    assert.equal(changed[1].coordinates, undefined);
    assert.equal(changed[1].confirmed, false);
    assert.equal(changed[1].precision, 'unresolved');
    assert.doesNotMatch(JSON.stringify(changed), /Washington|Adams/);
});

test('correction without new street details still revokes an invalidated address', () => {
    const changed = reconcileEvanConfirmedRoute(stops, 'The pickup address is wrong; I need to check the new one.');
    assert.equal(changed[0].confirmed, false);
    assert.equal(changed[1], destination);
});

test('unrelated conversation and identical address readback preserve metadata and identity', () => {
    assert.equal(reconcileEvanConfirmedRoute(stops, 'We have a piano and need full packing.'), stops);
    assert.equal(reconcileEvanConfirmedRoute(stops, 'Yes, the pickup is 100 East Main Street, Phoenix, AZ.'), stops);
    assert.equal(reconcileEvanConfirmedRoute(stops, 'Yes, 200 W Washington St, Phoenix, AZ is correct.'), stops);
});

test('a hypothetical new address does not erase confirmed pins', () => {
    assert.equal(reconcileEvanConfirmedRoute(stops, 'What if we change the destination address to 300 W Adams Street?'), stops);
});

test('unit corrections are consequential even if the street is repeated', () => {
    const changed = reconcileEvanConfirmedRoute(stops, 'Update the destination to 200 W Washington St, suite 3 instead.');
    assert.equal(changed[0], origin);
    assert.equal(changed[1].confirmed, false);
});

test('route reorder preserves exact address metadata and removal cannot resurrect historic stops', () => {
    const mesa = { ...origin, kind: 'Additional stop', city: 'Mesa', label: 'Storage', address: '300 E Main St, Mesa, AZ' };
    const chandler = { ...origin, kind: 'Additional stop', city: 'Chandler', label: 'Garage', address: '400 E Main St, Chandler, AZ' };
    const reordered = reconcileEvanConfirmedRoute([origin, mesa, chandler, destination], 'Put Chandler before Mesa.');
    assert.deepEqual(reordered, [origin, chandler, mesa, destination]);
    const removed = reconcileEvanConfirmedRoute(reordered, 'Remove the storage stop in Mesa.');
    assert.deepEqual(removed, [origin, chandler, destination]);
    const model = buildEvanMovePlan([{role: 'user', content: 'Moving from Phoenix to Scottsdale with a stop in Mesa.'}], []);
    assert.deepEqual(model.stops, []);
});

test('player fences late lookups on spoken route edits and sends receipts from visible current model', async () => {
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const record = player.slice(player.indexOf('const recordTurn ='), player.indexOf('const snapshotEvanPlannerTurns'));
    assert.match(record, /evanPlannerEnabled && turn.role === 'user'/);
    assert.match(record, /reconcileEvanConfirmedRoute/);
    assert.match(record, /evanRouteGeneration \+= 1/);
    assert.match(record, /evanRouteAbort\?\.abort\(\)/);
    assert.match(record, /else if \(workbenchEnabled\)/);
    assert.match(player, /signal: AbortSignal.any\(\[signal, routeAbort.signal\]\)/);
    assert.match(player, /visibleStops: receiptModel.stops.map/);
});
