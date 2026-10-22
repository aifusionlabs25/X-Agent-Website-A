import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
    applyEvanRouteTurn,
    buildGoogleMapsDirectionsUrl,
    buildEvanMovePlan,
    EVAN_MOVE_PLANNER_BOUNDARY,
    formatEvanRouteSummary,
    getMovePlanStopCoordinates,
} from '../lib/anam/evan-move-planner.ts';
import { parseEvanRouteToolStops, parseResolvedEvanRouteStops, resolveEvanRouteToolStops } from '../lib/anam/evan-address-route.ts';
import { geocodeEvanRouteStop } from '../lib/anam/evan-geocoding.ts';

test('run47 inventory retains love seat and desk alongside bed and box range', () => {
    const plan = buildEvanMovePlan([
        { role: 'agent', content: "Do you know roughly how many boxes, or the main furniture pieces you'll be moving?" },
        { role: 'user', content: "About 20 to 25 boxes and a queen bed. There's also a love seat and a desk." },
    ]);
    assert.deepEqual(new Set(plan.inventoryItems), new Set(['Queen bed', 'Loveseat', 'Desk', 'About 20 to 25 boxes']));
    for (const spelling of ['loveseat', 'love seat', 'love-seat']) {
        assert.deepEqual(new Set(buildEvanMovePlan([{ role: 'user', content: `A ${spelling} and a desk.` }]).inventoryItems), new Set(['Loveseat', 'Desk']));
    }
});

test('new furniture labels keep existing negation, hypothetical, and speaker boundaries', () => {
    for (const content of ['No loveseat or desk.', 'Maybe a loveseat and a desk.', 'What if we move a loveseat and a desk?']) {
        assert.deepEqual(buildEvanMovePlan([{ role: 'user', content }]).inventoryItems, [], content);
    }
    assert.deepEqual(buildEvanMovePlan([{ role: 'agent', content: 'A loveseat and desk.' }]).inventoryItems, []);
    assert.deepEqual(buildEvanMovePlan([
        { role: 'user', content: 'A loveseat and a desk.' },
        { role: 'user', content: 'No loveseat or desk after all.' },
    ]).inventoryItems, []);
});

test('Evan Move Planner starts empty without inventing move details', () => {
    const model = buildEvanMovePlan([]);
    assert.equal(model.status, 'listening');
    assert.equal(model.readiness, 0);
    assert.deepEqual(model.stops, []);
    assert.equal(model.routeNeedsClarification, false);
    assert.deepEqual(model.highlights, []);
});

test('run-fifteen split city answers retain the route despite state suffixes and a pickup readback', () => {
    const turns = [
        { role: 'agent', content: "What’s the city you’ll be picking up your belongings from?" },
        { role: 'user', content: 'Gilbert, Arizona.' },
        { role: 'agent', content: 'Got it—Gilbert, AZ for pickup. Where’s the destination city?' },
        { role: 'user', content: 'Chandler, also in Arizona.' },
    ];
    assert.deepEqual(buildEvanMovePlan(turns).stops, [
        { city: 'Gilbert', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.deepEqual(buildEvanMovePlan([
        { role: 'agent', content: 'What city do you enjoy visiting?' },
        { role: 'user', content: 'Chandler, also in Arizona.' },
    ]).stops, []);
});

test('run-sixteen conversational Arizona route retains both cities after a moving question', () => {
    const turns = [
        { role: 'agent', content: "What's the general move you're thinking about?" },
        { role: 'user', content: "Right, yeah, well it's Gilbert in Arizona to Chandler, Arizona." },
    ];
    assert.deepEqual(buildEvanMovePlan(turns).stops, [
        { city: 'Gilbert', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.deepEqual(buildEvanMovePlan([
        { role: 'agent', content: 'Which two cities do you prefer for sightseeing?' },
        { role: 'user', content: "Right, yeah, well it's Gilbert in Arizona to Chandler, Arizona." },
    ]).stops, []);
});

test('run-twenty comma-state route appears in both the brief and mapped endpoints', () => {
    const turns = [
        { role: 'agent', content: 'What are you moving from and to?' },
        { role: 'user', content: "It's Gilbert, Arizona to Chandler, Arizona." },
        { role: 'agent', content: 'Great, Gilbert to Chandler is an East Valley move. What are the main furniture pieces, and roughly how many boxes?' },
        { role: 'user', content: "There's one flight of stairs at pick up, ground floor delivery. A queen bed, sofa, dining table, and about 20 boxes." },
        { role: 'user', content: 'The first two weeks of December work for me.' },
        { role: 'user', content: 'I might want help packing fragile kitchen items, but I can pack most of the rest myself.' },
    ];
    const model = buildEvanMovePlan(turns);
    assert.deepEqual(model.stops, [
        { city: 'Gilbert', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.equal(model.routeNeedsClarification, false);
    assert.equal(model.highlights.find(signal => signal.label === 'Route')?.value, 'Gilbert → Chandler');
    assert.ok(model.stops.every(stop => getMovePlanStopCoordinates(stop)));
    assert.equal(buildGoogleMapsDirectionsUrl(model.stops).includes('search'), false);
    assert.deepEqual(buildEvanMovePlan([
        { role: 'agent', content: 'Which cities do you enjoy visiting?' },
        { role: 'user', content: "It's Gilbert, Arizona to Chandler, Arizona." },
    ]).stops, []);
});

test('run-twenty-one ASR misspelling keeps the grounded origin and asks to confirm the destination', () => {
    const turns = [
        { role: 'agent', content: 'Where are you moving from, and where are you headed?' },
        { role: 'user', content: "It's Gilbert, Arizona to Chanda, Arizona." },
        { role: 'agent', content: 'Got it, a Gilbert to Chandler move. What size is your home?' },
        { role: 'user', content: 'A two-bedroom townhouse.' },
    ];
    const partial = buildEvanMovePlan(turns);
    assert.deepEqual(partial.stops, [{ city: 'Gilbert', kind: 'Origin' }]);
    assert.equal(partial.routeNeedsClarification, true);
    assert.equal(formatEvanRouteSummary(partial.stops, partial.routeNeedsClarification), 'Gilbert \u2192 Destination to confirm');
    assert.equal(partial.highlights.find(signal => signal.label === 'Route')?.value, 'Gilbert \u2192 Destination to confirm');
    assert.deepEqual(getMovePlanStopCoordinates(partial.stops[0]), { latitude: 33.3528, longitude: -111.789 });
    assert.equal(new URL(buildGoogleMapsDirectionsUrl(partial.stops)).pathname, '/maps/search/');
    assert.doesNotMatch(JSON.stringify(partial.stops), /Chandler|Chanda/);

    const corrected = buildEvanMovePlan([...turns, { role: 'user', content: 'Yes, the destination is Chandler, Arizona.' }]);
    assert.deepEqual(corrected.stops, [
        { city: 'Gilbert', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.equal(corrected.routeNeedsClarification, false);
    assert.equal(formatEvanRouteSummary(corrected.stops, corrected.routeNeedsClarification), 'Gilbert \u2192 Chandler');
    assert.equal(new URL(buildGoogleMapsDirectionsUrl(corrected.stops)).pathname, '/maps/dir/');

    const unrelated = buildEvanMovePlan([
        { role: 'agent', content: 'Which cities do you like to visit?' },
        { role: 'user', content: "It's Gilbert, Arizona to Chanda, Arizona." },
    ]);
    assert.deepEqual(unrelated.stops, []);
    assert.equal(unrelated.routeNeedsClarification, false);
});

test('run-thirty-three route clarification retains Gilbert but never guesses Chamba as Chandler', () => {
    const turns = [
        { role: 'agent', content: "Hi, I'm Evan. Tell me a little about the move you're planning." },
        { role: 'user', content: "Thanks, Seven. It's from Dilbert to Chanda. I'm just trying to get a sense of what's involved, really." },
        { role: 'agent', content: 'Could you confirm the full names or zip codes for the pickup and destination cities?' },
        { role: 'user', content: 'Sorry, Evan.' },
        { role: 'user', content: 'Gilbert, Arizona to Chamba, Arizona.' },
        { role: 'agent', content: 'Got it, Gilbert to Chamba, Arizona. What’s the home size, and roughly what are you moving?' },
    ];
    const initial = buildEvanMovePlan(turns.slice(0, 2));
    assert.deepEqual(initial.stops, []);
    assert.equal(initial.routeNeedsClarification, true);
    const partial = buildEvanMovePlan(turns);
    assert.deepEqual(partial.stops, [{ city: 'Gilbert', kind: 'Origin' }]);
    assert.equal(partial.routeNeedsClarification, true);
    assert.equal(formatEvanRouteSummary(partial.stops, partial.routeNeedsClarification), 'Gilbert → Destination to confirm');
    assert.equal(new URL(buildGoogleMapsDirectionsUrl(partial.stops)).pathname, '/maps/search/');
    assert.doesNotMatch(JSON.stringify(partial.stops), /Chamba|Chanda|Chandler/);
    const corrected = buildEvanMovePlan([
        ...turns,
        { role: 'agent', content: 'Could you spell the destination city for me?' },
        { role: 'user', content: 'The destination is Chandler, Arizona.' },
    ]);
    assert.deepEqual(corrected.stops, [
        { city: 'Gilbert', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.equal(corrected.routeNeedsClarification, false);
    assert.deepEqual(buildEvanMovePlan([
        { role: 'agent', content: 'Which Arizona cities are in the travel guide?' },
        { role: 'user', content: 'Gilbert, Arizona to Chamba, Arizona.' },
    ]).stops, []);
});

test('run-thirty-seven standalone city correction fills only the unresolved destination', () => {
    const turns = [
        { role: 'agent', content: "Hi, I'm Evan. Tell me a little about the move you're planning." },
        { role: 'user', content: "I'm moving from Gilbert, Arizona to Chanda, Arizona." },
        { role: 'agent', content: 'Thanks, I have Gilbert to Chanda, Arizona. Do you have a moving date in mind?' },
    ];
    const partial = buildEvanMovePlan(turns);
    assert.deepEqual(partial.stops, [{ city: 'Gilbert', kind: 'Origin' }]);
    assert.equal(partial.routeNeedsClarification, true);

    const corrected = buildEvanMovePlan([...turns,
        { role: 'user', content: "Sorry, I mean Chandler, Arizona. That's C-H-A-N-D-L-E-R." },
    ]);
    assert.deepEqual(corrected.stops, [
        { city: 'Gilbert', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.equal(corrected.routeNeedsClarification, false);

    const unrelated = buildEvanMovePlan([...turns,
        { role: 'user', content: 'I used to live in Chandler, Arizona.' },
    ]);
    assert.deepEqual(unrelated.stops, [{ city: 'Gilbert', kind: 'Origin' }]);
    assert.equal(unrelated.routeNeedsClarification, true);
});

test('run-thirty-eight greeting-prefixed route accepts the spoken destination correction', () => {
    const turns = [
        { role: 'agent', content: "Hi, I'm Evan with Mullins Moving. Tell me a little about the move you're planning, and I'll help you work through the details." },
        { role: 'user', content: "Hi Evan, I'm moving from Gilbert, Arizona to Chanda, Arizona." },
        { role: 'agent', content: "Chanda, Arizona doesn't sound like a real city to me. Could you spell that out for me?" },
    ];
    const initial = buildEvanMovePlan(turns);
    assert.deepEqual(initial.stops, [{ city: 'Gilbert', kind: 'Origin' }]);
    assert.equal(initial.routeNeedsClarification, true);
    const corrected = buildEvanMovePlan([...turns,
        { role: 'user', content: "Sorry, I mean Chandler, Arizona. That's C-H-A-N-D-L-E-R." },
    ]);
    assert.deepEqual(corrected.stops, [
        { city: 'Gilbert', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.equal(corrected.routeNeedsClarification, false);
});

test('run-twenty-two destination-first correction restores both cities in one user turn', () => {
    const turns = [
        { role: 'agent', content: 'Where are you moving from, and where are you headed?' },
        { role: 'user', content: "It's Kilba Arizona to Chanda Arizona." },
        { role: 'agent', content: "I didn't recognize either city name. Could you say each one again?" },
        { role: 'user', content: "Sorry, my destination is Chandler, Arizona. It's Gilbert, Arizona to Chandler, Arizona." },
        { role: 'agent', content: 'Got it, Gilbert to Chandler, Arizona.' },
    ];
    const model = buildEvanMovePlan(turns);
    assert.deepEqual(model.stops, [
        { city: 'Gilbert', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.equal(model.routeNeedsClarification, false);
    assert.equal(formatEvanRouteSummary(model.stops, model.routeNeedsClarification), 'Gilbert \u2192 Chandler');
    assert.equal(new URL(buildGoogleMapsDirectionsUrl(model.stops)).pathname, '/maps/dir/');
    assert.ok(model.stops.every(stop => getMovePlanStopCoordinates(stop)));
    assert.deepEqual(applyEvanRouteTurn([], turns[3].content), model.stops);
});

test('run-twenty-four unpunctuated ASR route fills both cities after an origin-only moving question', () => {
    const turns = [
        { role: 'agent', content: "What's the one you're moving from?" },
        { role: 'user', content: 'is gilbert arizona to chandler arizona' },
        { role: 'agent', content: 'Got it, Gilbert to Chandler.' },
    ];
    const model = buildEvanMovePlan(turns);
    assert.deepEqual(model.stops, [
        { city: 'Gilbert', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.equal(model.routeNeedsClarification, false);
    assert.equal(formatEvanRouteSummary(model.stops, model.routeNeedsClarification), 'Gilbert \u2192 Chandler');
    assert.equal(new URL(buildGoogleMapsDirectionsUrl(model.stops)).pathname, '/maps/dir/');
    assert.deepEqual(buildEvanMovePlan([
        { role: 'agent', content: 'Which cities did you visit?' },
        { role: 'user', content: 'is gilbert arizona to chandler arizona' },
    ]).stops, []);
});

test('run-fifteen fragile-kitchen packing interest remains visible as possible help, not a confirmed service', () => {
    const phrase = 'I might want help packing fragile kitchen stuff.';
    const model = buildEvanMovePlan([{ role: 'user', content: phrase }]);
    assert.match(model.packingPlan, /Possible packing help:.*fragile kitchen stuff/i);
    assert.deepEqual(model.services, []);
    assert.equal(buildEvanMovePlan([{ role: 'user', content: phrase },
        { role: 'user', content: 'Actually, no packing help.' }]).packingPlan, 'No packing help requested');
    assert.equal(buildEvanMovePlan([{ role: 'user', content: 'What if I might want help packing fragile items?' }]).packingPlan, '');
});

test('run-eighteen pickup stairs and ground-floor delivery remain attached to separate endpoints', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'From Gilbert to Chandler in the first two weeks of November.' },
        { role: 'user', content: "There's one flight of stairs at pick up, ground floor delivery. It's a two bed townhouse with a queen bed, a sofa, dining table and about 20 boxes." },
    ]);
    assert.ok(model.accessFactors.includes('Origin: stairs'));
    assert.ok(model.accessFactors.includes('Destination: ground floor'));
    assert.ok(!model.accessFactors.some(item => /Origin: ground floor/i.test(item)));
    const visibleAccess = model.highlights.find(signal => signal.label === 'Access')?.value ?? '';
    assert.match(visibleAccess, /Origin: stairs/);
    assert.match(visibleAccess, /Destination: ground floor/);
});

test('run-twenty-three unpunctuated pickup stairs and ground-floor delivery keep their own endpoints', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'From Gilbert to Chandler.' },
        { role: 'user', content: "There's one flight of stairs at pick up ground floor delivery." },
    ]);
    assert.deepEqual(model.accessFactors.filter(item => /^(?:Origin|Destination):/i.test(item)), [
        'Origin: stairs', 'Destination: ground floor',
    ]);
    assert.equal(model.highlights.find(signal => signal.label === 'Access')?.value,
        'Origin: stairs, Destination: ground floor');
    assert.deepEqual(model.stops.map(stop => stop.city), ['Gilbert', 'Chandler']);
});

test('run-twenty-five pickup stairs survive an ASR comma and a contextual confirmation', () => {
    const turns = [
        { role: 'user', content: "Right, it's Gilbert, Arizona to Chandler, Arizona." },
        { role: 'agent', content: 'To get a feel for how the process works, how big is the move?' },
        { role: 'user', content: "There's one flight of stairs, a pickup, ground floor delivery. It's a two-bed townhouse with a queen bed, a sofa, a dining table and about 20 boxes." },
        { role: 'agent', content: "Do you know if there's an elevator or stairs at the pickup?" },
        { role: 'user', content: 'Stairs, just the one flight.' },
        { role: 'agent', content: 'Anything else I should know about the townhouse or the delivery?' },
        { role: 'user', content: 'Ground floor delivery, no specialty items.' },
    ];
    const firstAnswer = buildEvanMovePlan(turns.slice(0, 3));
    const complete = buildEvanMovePlan(turns);
    for (const model of [firstAnswer, complete]) {
        assert.ok(model.accessFactors.includes('Origin: stairs'));
        assert.ok(model.accessFactors.includes('Destination: ground floor'));
        assert.ok(!model.accessFactors.some(item => /Origin: ground floor|Destination: stairs/i.test(item)));
    }
    const contextual = buildEvanMovePlan([
        turns[0], turns[3], turns[4],
    ]);
    assert.ok(contextual.accessFactors.includes('Origin: stairs'));
    assert.ok(!buildEvanMovePlan([
        turns[0], { role: 'agent', content: 'What furniture do you have?' }, turns[4],
    ]).accessFactors.some(item => item.startsWith('Origin:')));
});

test('run-twenty-six access labels avoid duplicate stairs and spoken town house keeps the home size', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'I am moving from Gilbert to Chandler.' },
        { role: 'user', content: "It's a two bed town house." },
        { role: 'user', content: "There's one flight of stairs at pick up and ground floor delivery." },
    ]);
    assert.equal(model.propertyScope.toLowerCase(), 'two-bedroom townhouse');
    assert.deepEqual(model.accessFactors, ['Origin: stairs', 'Destination: ground floor']);
    assert.equal(model.highlights.find(signal => signal.label === 'Access')?.value,
        'Origin: stairs, Destination: ground floor');
});

test('run-eighteen tentative kitchen packing is not erased by self-packing most other items', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'Maybe I might want help packing fragile kitchen items, but otherwise I think I can manage most of it myself.' },
    ]);
    assert.match(model.packingPlan, /Possible packing help:.*fragile kitchen items/i);
    assert.deepEqual(model.services, []);
    assert.match(model.highlights.find(signal => signal.label === 'Packing plan')?.value ?? '', /Possible packing help/);
});

test('run-eleven date window and townhouse remain specific while misheard cities do not become pins', () => {
    const turns = [
        { role: 'user', content: "I'm moving from Hilbert to Shonda in the first two weeks of November." },
        { role: 'user', content: 'It is a two-bedroom townhouse with some fragile kitchen items.' },
    ];
    const uncertain = buildEvanMovePlan(turns);
    assert.equal(uncertain.timing.toLowerCase(), 'first two weeks of november');
    assert.equal(uncertain.propertyScope.toLowerCase(), 'two-bedroom townhouse');
    assert.deepEqual(uncertain.stops, []);
    assert.equal(uncertain.routeNeedsClarification, true);

    const clarified = buildEvanMovePlan([...turns, { role: 'user', content: 'To clarify, pickup is Gilbert and destination is Chandler.' }]);
    assert.deepEqual(clarified.stops.map(stop => stop.city), ['Gilbert', 'Chandler']);
    assert.equal(clarified.routeNeedsClarification, false);
});

test('October live retest details and a corrected origin floor update the working brief', () => {
    const initial = buildEvanMovePlan([{ role: 'user', content: 'One bedroom, local move on November 7th. Queen bed, sofa, small dining table and about 18 boxes. Origin second floor, no elevator. Destination is ground floor.' }]);
    assert.equal(initial.timing, 'November 7th');
    assert.deepEqual(initial.inventoryItems, ['Queen bed', 'Sofa', 'Dining table', 'About 18 boxes']);
    assert.ok(initial.accessFactors.includes('Origin: second floor, no elevator'));
    assert.ok(initial.accessFactors.includes('Destination: ground floor'));
    const corrected = buildEvanMovePlan([
        { role: 'user', content: 'One bedroom, local move on November 7th. Queen bed, sofa, small dining table and about 18 boxes. Origin second floor, no elevator. Destination is ground floor.' },
        { role: 'user', content: "Thanks. One update, actually. It's the third floor at Origin. No elevator, not a second." },
    ]);
    assert.ok(corrected.accessFactors.includes('Origin: third floor, no elevator'));
    assert.ok(!corrected.accessFactors.some(item => item.includes('second floor')));
    assert.deepEqual(corrected.stops, []);
});

test('spoken box counts and a later destination access correction stay in the brief', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'From Gilbert to Chandler in early December. Two-bedroom townhouse with a queen bed, sofa, dining table, and about twenty boxes.' },
        { role: 'user', content: 'Correction: destination is second floor, stairs only, no elevator.' },
    ]);
    assert.ok(model.inventoryItems.includes('About twenty boxes'));
    assert.ok(model.accessFactors.includes('Destination: second floor, no elevator'));
});

test('run-twenty-seven approximate box count keeps the furniture in the Move List', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'Maybe around 20 boxes and the main stuff is a queen bed, sofa and a dining table.' },
    ]);
    assert.deepEqual(model.inventoryItems, ['Queen bed', 'Sofa', 'Dining table', 'Around 20 boxes']);
    assert.deepEqual(buildEvanMovePlan([
        { role: 'user', content: 'Maybe a piano if we decide to move it.' },
    ]).inventoryItems, []);
});

test('run-thirty-two spoken box range and exploratory packing stay visible without confirming a service', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'Maybe 15 to 20 boxes.' },
        { role: 'user', content: 'and a queen bed, a sofa and a dining table.' },
        { role: 'user', content: 'I can handle most of the packing, but could someone help with fragile kitchen stuff?' },
    ]);
    assert.deepEqual(model.inventoryItems, ['Queen bed', 'Sofa', 'Dining table', '15 to 20 boxes']);
    assert.deepEqual(model.services, []);
    assert.match(model.packingPlan, /packing some items yourself; possible packing help:.*fragile kitchen stuff/i);

    const hyphenated = buildEvanMovePlan([{ role: 'user', content: 'Roughly 15-20 boxes and a sofa.' }]);
    assert.ok(hyphenated.inventoryItems.includes('Roughly 15-20 boxes'));
    assert.ok(hyphenated.inventoryItems.includes('Sofa'));
    assert.deepEqual(buildEvanMovePlan([{ role: 'user', content: 'Maybe a piano if we decide to move it.' }]).inventoryItems, []);
});

test('run-ten tentative help inquiry still gives a city-level working route and assigns Chandler access', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: "Hi, I may need help moving from Gilbert to Chandler early December, and I'm just trying to understand how this works." },
        { role: 'user', content: 'I need to correct that: Chandler is second floor, stairs only, no elevator.' },
    ]);
    assert.deepEqual(model.stops, [
        { city: 'Gilbert', kind: 'Origin' },
        { city: 'Chandler', kind: 'Destination' },
    ]);
    assert.ok(model.accessFactors.includes('Destination: second floor, no elevator'));
    assert.ok(!model.accessFactors.some(item => item.startsWith('Location to confirm:')));
});

test('city-only tool stops are ignored without rejecting the visible conversation planner', () => {
    const cityStops = [
        { kind: 'origin', city: 'Gilbert', order: 1, confirmed: true },
        { kind: 'destination', city: 'Chandler', label: 'second floor, stairs only', order: 2, confirmed: true },
    ];
    assert.deepEqual(resolveEvanRouteToolStops(cityStops), { stops: [], ignoredUnconfirmedStops: true });
    assert.deepEqual(resolveEvanRouteToolStops(undefined), { stops: [], ignoredUnconfirmedStops: false });
    const conversationModel = buildEvanMovePlan([
        { role: 'user', content: 'From Gilbert to Chandler.' },
        { role: 'user', content: 'Destination is second floor, stairs only, no elevator.' },
    ], null);
    assert.deepEqual(conversationModel.stops.map(stop => stop.city), ['Gilbert', 'Chandler']);
    assert.ok(conversationModel.accessFactors.includes('Destination: second floor, no elevator'));
});

test('run-four ambiguous floor and elevator details stay visible without assigning the wrong location', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: "Hi Evan, I'm Taylor Reid. I'm moving a one bedroom apartment from Phoenix to Mesa on November 14th. Third floor, stairs only, absolutely no elevator." },
        { role: 'user', content: "Destinations ground for. I've got a queen bed, sofa, small dining table and about 12 boxes. I'll pat myself." },
        { role: 'user', content: 'No extra stops, no specialty items. I want to make sure you caught the third floor stairs only and not unpacking myself.' },
    ]);
    assert.ok(model.accessFactors.includes('Location to confirm: third floor, no elevator'));
    assert.ok(!model.accessFactors.some(item => /^Origin:|^Destination:/.test(item)));
    assert.equal(model.packingPlan, '', 'ambiguous recognition must not invent packing or unpacking intent');
});

test('run-eight month window and corrected pickup access replace the old floor without an unassigned duplicate', () => {
    const model = buildEvanMovePlan([
        { role: 'agent', content: 'What city are you moving from?' },
        { role: 'user', content: 'Scottsdale.' },
        { role: 'agent', content: 'What is the destination city?' },
        { role: 'user', content: 'Same thing.' },
        { role: 'user', content: "Early December. I'm flexible within that week." },
        { role: 'user', content: 'Pick up is a second floor apartment, stairs only.' },
        { role: 'user', content: "It's actually third floor at Pickup, sorry, and the Tempe place is a ground floor townhouse." },
    ]);
    assert.equal(model.timing, 'Early December; flexible within that week');
    assert.ok(model.accessFactors.includes('Origin: third floor, no elevator'));
    assert.ok(model.accessFactors.includes('Destination: ground floor'));
    assert.ok(!model.accessFactors.some(item => /second floor|Location to confirm/.test(item)));
});

test('a same-city place cannot assign an ambiguous floor to the pickup or delivery', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'Pickup is second floor, and the Scottsdale place is ground floor.' },
    ], [
        { city: 'Scottsdale', kind: 'Origin' },
        { city: 'Scottsdale', kind: 'Destination' },
    ]);
    assert.ok(model.accessFactors.includes('Origin: second floor'));
    assert.ok(model.accessFactors.includes('Location to confirm: ground floor'));
    assert.ok(!model.accessFactors.includes('Destination: ground floor'));
});

test('a storage-first route preserves the eventual home destination and flags uncertainty', () => {
    const model = buildEvanMovePlan([{ role: 'user', content: 'from Mesa probably to storage in Gilbert first then eventually a house in Queen Creek but that is all tentative' }]);
    assert.deepEqual(model.stops, [
        { city: 'Mesa', kind: 'Origin' },
        { city: 'Gilbert', kind: 'Additional stop' },
        { city: 'Queen Creek', kind: 'Destination' },
    ]);
    assert.ok(model.uncertainties.some(item => /probably|tentative/.test(item)));
    assert.ok(!model.openItems.some(item => /final destination/.test(item)));
    assert.ok(model.stops.every(stop => !stop.confirmed && !stop.coordinates));
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
    assert.ok(model.accessFactors.includes('Origin: stairs'));
    assert.ok(!model.accessFactors.includes('Stairs'));
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
    assert.match(landing, /Talk with Evan now/);
    assert.match(landing, /Your Mullins Moving concierge/);
    assert.match(landing, /lg:h-\[100svh\]/);
    assert.match(landing, /lg:h-\[min\(58vh,520px\)\]/);
    assert.match(landing, /aspect-\[16\/11\] h-full min-h-0/);
    assert.doesNotMatch(landing, /CUSTOMER_STEPS|Ask your moving questions|Build your move plan live/);
    assert.match(landing, /Evan is ready/);
    assert.match(landing, /className="object-contain"/);
    assert.match(landing, /Start with Evan\./);
    assert.match(header, /pathname === '\/agents\/evan'/);
    assert.match(header, /pathname === '\/demo\/evan'/);
    assert.match(footer, /pathname === '\/agents\/evan'/);
    assert.match(footer, /pathname === '\/demo\/evan'/);
    assert.match(demo, /px-4 pb-24 pt-20/);
    assert.match(player, /max-w-\[1080px\]/);
});
