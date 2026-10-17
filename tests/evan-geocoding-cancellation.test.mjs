import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    EvanGeocodingCancelledError,
    geocodeEvanRouteStop,
    geocodeEvanRouteStops,
} from '../lib/anam/evan-geocoding.ts';

const stop = {
    kind: 'Origin', address: '100 Test Street, Phoenix, AZ 85001',
    city: 'Phoenix', label: 'Home', order: 1, confirmed: true,
};
const destination = { ...stop, kind: 'Destination', order: 2 };
const emptyResponse = () => new Response(JSON.stringify({ results: [], result: { addressMatches: [] } }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
});
const isCancelled = error => {
    assert.ok(error instanceof EvanGeocodingCancelledError);
    assert.equal(error.message, 'Street-level route update cancelled');
    assert.equal(error.cause, undefined);
    return true;
};

test('pre-aborted single and multi-stop requests never contact a geocoding provider', async () => {
    const controller = new AbortController();
    controller.abort('private-address-and-provider-token');
    let requests = 0;
    const options = { signal: controller.signal, fetchImpl: async () => { requests++; return emptyResponse(); } };
    await assert.rejects(geocodeEvanRouteStop(stop, options), isCancelled);
    await assert.rejects(geocodeEvanRouteStops([stop, destination], options), isCancelled);
    assert.equal(requests, 0);
});

test('aborting Geoapify cancels its composed signal and never retries Census', async () => {
    const controller = new AbortController();
    let requests = 0;
    let upstreamSignal;
    const pending = geocodeEvanRouteStop(stop, {
        apiKey: 'test-key', signal: controller.signal,
        fetchImpl: async (_url, init) => {
            requests++;
            upstreamSignal = init.signal;
            return new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(new Error('private-provider-url')));
            });
        },
    });
    const checked = assert.rejects(pending, isCancelled);
    controller.abort('private-abort-reason');
    await checked;
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(requests, 1);
});

test('aborting Census cancels its composed signal and does not return a stale pin', async () => {
    const controller = new AbortController();
    let signal;
    const pending = geocodeEvanRouteStop(stop, {
        signal: controller.signal,
        fetchImpl: async (_url, init) => {
            signal = init.signal;
            return new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(new Error('private-address')));
            });
        },
    });
    const checked = assert.rejects(pending, isCancelled);
    controller.abort();
    await checked;
    assert.equal(signal.aborted, true);
});

test('even a fetch implementation ignoring abort cannot trigger fallback or later stops', async () => {
    const controller = new AbortController();
    let requests = 0;
    let resolveFetch;
    const pending = geocodeEvanRouteStops([stop, destination], {
        apiKey: 'test-key', signal: controller.signal,
        fetchImpl: async () => {
            requests++;
            return new Promise(resolve => { resolveFetch = resolve; });
        },
    });
    const checked = assert.rejects(pending, isCancelled);
    controller.abort('private-address');
    resolveFetch(emptyResponse());
    await checked;
    assert.equal(requests, 1);
});

test('cancellation during inter-stop spacing clears the timer and prevents the next provider request', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new AbortController();
    const listening = Promise.withResolvers();
    const originalAdd = controller.signal.addEventListener.bind(controller.signal);
    t.mock.method(controller.signal, 'addEventListener', (...args) => {
        originalAdd(...args);
        listening.resolve();
    });
    let requests = 0;
    const pending = geocodeEvanRouteStops([stop, destination], {
        signal: controller.signal,
        fetchImpl: async () => { requests++; return emptyResponse(); },
    });
    const checked = assert.rejects(pending, isCancelled);
    await listening.promise;
    assert.equal(requests, 1);
    controller.abort();
    await checked;
    t.mock.timers.tick(1_000);
    assert.equal(requests, 1);
});

test('uncancelled no-match responses retain normal sequential fallback behavior', async () => {
    const calls = [];
    const result = await geocodeEvanRouteStop(stop, {
        apiKey: 'test-key', signal: new AbortController().signal,
        fetchImpl: async (url, init) => {
            calls.push({ host: new URL(url).hostname, signal: init.signal });
            return emptyResponse();
        },
    });
    assert.deepEqual(calls.map(call => call.host), ['api.geoapify.com', 'geocoding.geo.census.gov']);
    assert.ok(calls.every(call => call.signal instanceof AbortSignal));
    assert.equal(result.precision, 'unresolved');
});

test('provider failures remain unresolved rather than leaking provider errors', async () => {
    const result = await geocodeEvanRouteStop(stop, {
        fetchImpl: async () => { throw new Error('secret-provider-url'); },
    });
    assert.equal(result.precision, 'unresolved');
    assert.doesNotMatch(JSON.stringify(result), /secret-provider-url/);
});

test('route handler passes browser cancellation into the sequential batch helper', async () => {
    const route = await readFile(new URL('../app/api/anam/evan/route-geocode/route.ts', import.meta.url), 'utf8');
    assert.match(route, /geocodeEvanRouteStops\(stops,\s*\{[\s\S]*?signal: request\.signal/);
    assert.match(route, /request\.signal\.aborted/);
    assert.match(route, /error instanceof EvanGeocodingCancelledError/);
    assert.doesNotMatch(route, /setTimeout/);
});
