import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
    buildGoogleMapsDirectionsUrl,
    buildEvanMovePlan,
    EVAN_MOVE_PLANNER_BOUNDARY,
    getMovePlanStopCoordinates,
} from '../lib/anam/evan-move-planner.ts';
import { parseEvanRouteToolStops, parseResolvedEvanRouteStops } from '../lib/anam/evan-address-route.ts';
import { geocodeEvanRouteStop } from '../lib/anam/evan-geocoding.ts';

test('Evan Move Planner starts empty without inventing move details', () => {
    const model = buildEvanMovePlan([]);
    assert.equal(model.status, 'listening');
    assert.equal(model.readiness, 0);
    assert.deepEqual(model.stops, []);
    assert.deepEqual(model.highlights, []);
});

test('Evan Move Planner builds a multi-stop senior move brief from current-session facts', () => {
    const model = buildEvanMovePlan([
        {
            role: 'user',
            content: 'We need to move my elderly dad out of his house in Mesa, pick up items from a storage unit in Chandler, and move everything into a home in Surprise in less than 10 days.',
        },
        {
            role: 'user',
            content: 'We need full packing for antique furniture, artwork, and a grandfather clock. The Mesa house has a narrow driveway and stairs, and my dad uses a walker, so we need to minimize a chaotic day.',
        },
    ]);

    assert.equal(model.status, 'building');
    assert.deepEqual(model.stops, [
        { city: 'Mesa', kind: 'Origin' },
        { city: 'Chandler', kind: 'Additional stop' },
        { city: 'Surprise', kind: 'Destination' },
    ]);
    assert.match(model.timing, /less than 10 days/i);
    assert.ok(model.services.includes('Full packing'));
    assert.ok(model.services.includes('Storage stop'));
    assert.ok(model.specialtyItems.includes('Antiques'));
    assert.ok(model.specialtyItems.includes('Grandfather clock'));
    assert.ok(model.accessFactors.includes('Narrow driveway'));
    assert.ok(model.accessFactors.includes('Stairs'));
    assert.ok(model.carePriorities.includes('Mobility considerations'));
    assert.ok(model.readiness > 50);
});

test('Evan Move Planner keeps uncertainty visible and excludes spoken email from the brief', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'I am moving from Mesa to Phoenix next month.' },
        { role: 'user', content: 'I think there may be stairs, but I have to check. My email is rvicks@gmail.com.' },
    ]);
    const renderedSignals = JSON.stringify(model);

    assert.equal(model.stops[0]?.kind, 'Origin');
    assert.equal(model.stops[1]?.kind, 'Destination');
    assert.ok(model.uncertainties.some((item) => /stairs/i.test(item)));
    assert.doesNotMatch(renderedSignals, /rvicks|gmail|@/i);
});

test('Evan Move Planner honors the attached-session route correction and later inventory details', () => {
    const model = buildEvanMovePlan([
        {
            role: 'user',
            content: 'I originally said we were moving from Chandler to Glendale.',
        },
        {
            role: 'user',
            content: 'Correction: the origin is Gilbert, we need an additional stop in Mesa, and the final destination is Queen Creek.',
        },
        {
            role: 'user',
            content: 'The target date is the 15th. Please add a sectional sofa, treadmill, tool chest, two large mirrors, and a grandfather clock to the move list.',
        },
    ]);

    assert.deepEqual(model.stops, [
        { city: 'Gilbert', kind: 'Origin' },
        { city: 'Mesa', kind: 'Additional stop' },
        { city: 'Queen Creek', kind: 'Destination' },
    ]);
    assert.equal(
        model.highlights.find((signal) => signal.label === 'Route')?.value,
        'Gilbert \u2192 Mesa \u2192 Queen Creek',
    );
    assert.match(model.timing, /the 15th/i);
    assert.deepEqual(model.specialtyItems, [
        'Sectional',
        'Treadmill',
        'Tool chest',
        'Large mirrors',
        'Grandfather clock',
    ]);
    assert.doesNotMatch(JSON.stringify(model), /Chandler|Glendale/);
});

test('Evan Move Planner incorporates details appended after the initial working view', () => {
    const initialTurns = [
        { role: 'user', content: 'We are moving from Gilbert to Queen Creek.' },
    ];
    const initial = buildEvanMovePlan(initialTurns);
    const refreshed = buildEvanMovePlan([
        ...initialTurns,
        {
            role: 'user',
            content: 'Add a pickup stop in Mesa plus a treadmill and large mirrors.',
        },
    ]);

    assert.deepEqual(initial.stops.map((stop) => stop.city), ['Gilbert', 'Queen Creek']);
    assert.deepEqual(refreshed.stops.map((stop) => stop.city), ['Gilbert', 'Mesa', 'Queen Creek']);
    assert.ok(refreshed.specialtyItems.includes('Treadmill'));
    assert.ok(refreshed.specialtyItems.includes('Large mirrors'));
});

test('Evan Move Planner provides map coordinates and an ordered Google Maps handoff', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'We are moving from Gilbert to Queen Creek with a storage stop in Mesa.' },
    ]);

    assert.deepEqual(model.stops.map((stop) => stop.city), ['Gilbert', 'Mesa', 'Queen Creek']);
    assert.deepEqual(getMovePlanStopCoordinates(model.stops[0]), {
        latitude: 33.3528,
        longitude: -111.789,
    });

    const googleMapsUrl = new URL(buildGoogleMapsDirectionsUrl(model.stops));
    assert.equal(googleMapsUrl.hostname, 'www.google.com');
    assert.equal(googleMapsUrl.pathname, '/maps/dir/');
    assert.equal(googleMapsUrl.searchParams.get('origin'), 'Gilbert, Arizona');
    assert.equal(googleMapsUrl.searchParams.get('destination'), 'Queen Creek, Arizona');
    assert.equal(googleMapsUrl.searchParams.get('waypoints'), 'Mesa, Arizona');
});

test('confirmed street-address stops override city centers and drive the Google Maps handoff', () => {
    const confirmedStops = parseResolvedEvanRouteStops([
        {
            kind: 'Origin', city: 'Phoenix', address: '4050 E Greenway Rd, Phoenix, AZ 85032',
            displayAddress: '4050 E GREENWAY RD, PHOENIX, AZ, 85032', confirmed: true,
            coordinates: { latitude: 33.6264, longitude: -111.9945 }, precision: 'address-range',
        },
        {
            kind: 'Destination', city: 'Phoenix', address: '200 W Washington St, Phoenix, AZ 85003',
            displayAddress: '200 W WASHINGTON ST, PHOENIX, AZ, 85003', confirmed: true,
            coordinates: { latitude: 33.4483, longitude: -112.0764 }, precision: 'address-range',
        },
    ]);
    const model = buildEvanMovePlan([{ role: 'user', content: 'We are moving within Phoenix.' }], confirmedStops);

    assert.equal(model.stops.length, 2);
    assert.deepEqual(getMovePlanStopCoordinates(model.stops[0]), { latitude: 33.6264, longitude: -111.9945 });
    const mapsUrl = new URL(buildGoogleMapsDirectionsUrl(model.stops));
    assert.equal(mapsUrl.searchParams.get('origin'), '4050 E GREENWAY RD, PHOENIX, AZ, 85032');
    assert.equal(mapsUrl.searchParams.get('destination'), '200 W WASHINGTON ST, PHOENIX, AZ, 85003');
});

test('route tool accepts only complete visitor-confirmed addresses', () => {
    const stops = parseEvanRouteToolStops([
        { kind: 'origin', address: '4050 E Greenway Rd, Phoenix, AZ 85032', city: 'Phoenix', order: 1, confirmed: true },
        { kind: 'destination', address: '200 W Washington St, Phoenix, AZ 85003', city: 'Phoenix', order: 2, confirmed: false },
        { kind: 'additional_stop', address: 'short', city: 'Mesa', order: 3, confirmed: true },
    ]);
    assert.equal(stops.length, 1);
    assert.equal(stops[0].kind, 'Origin');
});

test('Census fallback converts a confirmed U.S. street address to a session pin', async () => {
    const stop = parseEvanRouteToolStops([
        { kind: 'origin', address: '4050 E Greenway Rd, Phoenix, AZ 85032', city: 'Phoenix', order: 1, confirmed: true },
    ])[0];
    const geocoded = await geocodeEvanRouteStop(stop, {
        fetchImpl: async () => new Response(JSON.stringify({
            result: { addressMatches: [{
                matchedAddress: '4050 E GREENWAY RD, PHOENIX, AZ, 85032',
                coordinates: { x: -111.9945, y: 33.6264 },
                addressComponents: { city: 'PHOENIX' },
            }] },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    assert.equal(geocoded.precision, 'address-range');
    assert.equal(geocoded.coordinates?.latitude, 33.6264);
    assert.equal(geocoded.coordinates?.longitude, -111.9945);
});
test('Move Planner boundary explicitly prevents quote and booking assumptions', () => {
    assert.match(EVAN_MOVE_PLANNER_BOUNDARY, /working view only/i);
    assert.match(EVAN_MOVE_PLANNER_BOUNDARY, /pricing/i);
    assert.match(EVAN_MOVE_PLANNER_BOUNDARY, /appointment/i);
});

test('Anam player exposes the Move Planner only for Evan sessions', async () => {
    const player = await fs.readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const planner = await fs.readFile(new URL('../components/evan/EvanMovePlanner.tsx', import.meta.url), 'utf8');
    const routeMap = await fs.readFile(new URL('../components/evan/EvanRouteMap.tsx', import.meta.url), 'utf8');
    const geocodeRoute = await fs.readFile(new URL('../app/api/anam/evan/route-geocode/route.ts', import.meta.url), 'utf8');
    const prompt = await fs.readFile(new URL('../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8');
    const updater = await fs.readFile(new URL('../scripts/anam/update-evan-persona.mjs', import.meta.url), 'utf8');
    const tool = JSON.parse(await fs.readFile(new URL('../config/anam/evan-move-planner-client-tool.json', import.meta.url), 'utf8'));

    assert.match(player, /personaId === EVAN_PERSONA_ID/);
    assert.match(player, /NEXT_PUBLIC_EVAN_MOVE_PLANNER_ENABLED/);
    assert.match(player, /Live Move Planner/);
    assert.match(player, /<EvanMovePlanner/);
    assert.match(planner, /No quote or booking created/);
    assert.match(planner, /data-testid="evan-move-planner"/);
    assert.match(planner, /<EvanRouteMap stops=\{model\.stops\}/);
    assert.match(routeMap, /data-testid="evan-route-map"/);
    assert.match(routeMap, /Open in Google Maps/);
    assert.match(routeMap, /OpenStreetMap contributors/);
    assert.match(routeMap, /street-level/i);
    assert.match(routeMap, /data-testid="evan-route-map-fullscreen"/);
    assert.match(routeMap, /createPortal\(mapPanel, document\.body\)/);
    assert.match(routeMap, /Exit full-screen map/);
    assert.match(routeMap, /event\.stopImmediatePropagation\(\)/);
    assert.match(geocodeRoute, /isTrustedBrowserOrigin/);
    assert.match(geocodeRoute, /readAmyAnamBrowserSession/);
    assert.doesNotMatch(geocodeRoute, /readAmyAnamContactFromRequest/);
    assert.match(geocodeRoute, /GEOAPIFY_API_KEY/);
    assert.match(player, /registerToolCallHandler\('show_move_planner'/);
    assert.match(player, /const snapshotEvanPlannerTurns/);
    assert.match(player, /const refreshedTurns = snapshotEvanPlannerTurns\(\)/);
    assert.match(player, /setWorkbenchTurns\(\(\) => snapshotEvanPlannerTurns\(\)\)/);
    assert.match(player, /window\.setInterval\(refreshPlanner, 400\)/);
    assert.match(player, /pendingRole === 'user'/);
    assert.doesNotMatch(player, /[\u00c3\u00e2]/);
    assert.doesNotMatch(planner, /[\u00c3\u00e2]/);
    assert.match(prompt, /call `show_move_planner` silently/i);
    assert.match(prompt, /not a quote, estimate, booking, confirmed route/i);
    assert.equal(tool.name, 'show_move_planner');
    assert.deepEqual(tool.config.parameters.properties.view.enum, ['brief', 'route', 'inventory', 'readiness']);
    assert.equal(tool.config.parameters.properties.stops.maxItems, 8);
    assert.deepEqual(tool.config.parameters.properties.stops.items.properties.confirmed.enum, [true]);
    assert.match(prompt, /repeat the full address back briefly/i);
    assert.match(prompt, /complete current ordered route/i);
    assert.match(updater, /movePlannerToolDefinition/);
});

test('Evan pages use the simplified, contained presentation', async () => {
    const [landing, demo, player, header, footer] = await Promise.all([
        fs.readFile(new URL('../components/evan/EvanLandingPage.tsx', import.meta.url), 'utf8'),
        fs.readFile(new URL('../app/demo/[slug]/page.tsx', import.meta.url), 'utf8'),
        fs.readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8'),
        fs.readFile(new URL('../components/layout/SiteHeader.tsx', import.meta.url), 'utf8'),
        fs.readFile(new URL('../components/layout/SiteFooter.tsx', import.meta.url), 'utf8'),
    ]);

    assert.doesNotMatch(landing, /Private pilot preview|Prepared for Mullins Moving|Mullins trained|Voice \+ video|AI Fusion Labs|pilot discussion|What to test/);
    assert.match(landing, /Planning a move\?/);
    assert.match(landing, /Start planning with Evan/);
    assert.match(landing, /Your Mullins Moving concierge/);
    assert.match(landing, /lg:h-\[100svh\]/);
    assert.match(landing, /lg:h-\[min\(58vh,520px\)\]/);
    assert.match(landing, /aspect-\[16\/11\] h-full min-h-0/);
    assert.doesNotMatch(landing, /CUSTOMER_STEPS|Ask your moving questions|Build your move plan live/);
    assert.match(landing, /Evan is ready/);
    assert.match(landing, /className="object-contain"/);
    assert.match(landing, /\sStart\s/);
    assert.match(header, /pathname === '\/agents\/evan'/);
    assert.match(header, /pathname === '\/demo\/evan'/);
    assert.match(footer, /pathname === '\/agents\/evan'/);
    assert.match(footer, /pathname === '\/demo\/evan'/);
    assert.match(demo, /px-4 pb-24 pt-20/);
    assert.match(player, /max-w-\[1080px\]/);
});
