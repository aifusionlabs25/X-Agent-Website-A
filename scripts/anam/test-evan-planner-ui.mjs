/**
 * Isolated React/Leaflet browser smoke. Run: node scripts/anam/test-evan-planner-ui.mjs
 * Uses installed Playwright (or PLAYWRIGHT_MODULE_PATH). No real SDK, tokens, emails,
 * geocoder, or production test routes. Only localhost and public OSM tiles are allowed.
 * Generated bundles, screenshots, and report stay under the ignored work directory.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(path.join(root, 'package.json'));
const output = path.join(root, 'work/evan-6097-promotion/planner-ui');
const fixture = suffix => path.join(here, `test-evan-planner-ui.${suffix}`);
const report = { checks: [], consoleErrors: [], blockedRequests: [], apiRequests: [] };
// Synthetic, localhost-only geocoding. The queue can hold an earlier result so
// response ordering is exercised without disclosing addresses to a real service.
const geocodeResponses = [];
const pass = name => { report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); };
await fs.mkdir(output, { recursive: true });

const { webpack } = require('next/dist/compiled/webpack/webpack');
await new Promise((resolve, reject) => {
    const compiler = webpack({
        mode: 'development', devtool: false,
        entry: fixture('entry.jsx'),
        output: { path: output, filename: 'bundle.js', publicPath: '/' },
        resolve: {
            extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs'],
            alias: {
                '@anam-ai/js-sdk$': fixture('sdk.js'),
                'next/image$': fixture('image.jsx'),
                '@/components/amy/AmyAnamWorkbenchV2$': fixture('amy.jsx'),
                '@': root,
            },
        },
        module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: fixture('loader.cjs') }] },
        plugins: [new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('development'),
            'process.env.NEXT_PUBLIC_EVAN_MOVE_PLANNER_ENABLED': JSON.stringify('true'),
            'process.env.NEXT_PUBLIC_AMY_ANAM_WORKBENCH_ENABLED': JSON.stringify('true'),
            'process.env.NEXT_PUBLIC_EVAN_LOCAL_TEST_MODE': JSON.stringify('false'),
        })],
        optimization: { minimize: false }, performance: { hints: false },
    });
    compiler.run((error, stats) => compiler.close(() => {
        if (error) return reject(error);
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        resolve();
    }));
});
const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root })])
    .process(await fs.readFile(path.join(root, 'app/globals.css'), 'utf8'), {
        from: path.join(root, 'app/globals.css'), to: path.join(output, 'styles.css'),
    });
await fs.writeFile(path.join(output, 'styles.css'), css.css);

const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>html,body,#root{width:100%;height:100%;margin:0}body{font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
        report.apiRequests.push({ method: req.method, path: url.pathname });
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/api/anam-token') {
            res.end(JSON.stringify({ sessionToken: 'fixture-only', sessionSpineEnabled: false, agentMailAvailable: false }));
        } else if (url.pathname === '/api/anam/evan/access') {
            // Fake check-in boundary only. Do not retain or log the input body.
            for await (const chunk of req) { void chunk; }
            res.end(JSON.stringify({ authenticated: req.method === 'POST', rawEmailReturned: false }));
        } else if (url.pathname === '/api/anam/evan/route-geocode') {
            let body = '';
            for await (const chunk of req) body += chunk;
            const { stops = [] } = JSON.parse(body);
            const fixtureResponse = geocodeResponses.shift() || {};
            if (fixtureResponse.delay) await new Promise(resolve => setTimeout(resolve, fixtureResponse.delay));
            res.end(JSON.stringify({ stops: stops.map((stop, index) => ({
                ...stop,
                displayAddress: stop.address,
                precision: 'address',
                // Deliberately synthetic coordinates, never a claim that these
                // fake test addresses resolve to real homes.
                coordinates: {
                    latitude: 33.3 + index * 0.1 + (Number.parseInt(stop.address, 10) || 0) * 0.00001,
                    longitude: -111.8 + index * 0.1 - (Number.parseInt(stop.address, 10) || 0) * 0.00001,
                },
            })) }));
        } else {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: 'No live APIs exist in the isolated UI fixture' }));
        }
        return;
    }
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const base = url.pathname.startsWith('/agents/') ? path.join(root, 'public') : output;
    const resolved = path.resolve(base, `.${decodeURIComponent(url.pathname)}`);
    if (!resolved.startsWith(`${base}${path.sep}`)) { res.statusCode = 403; res.end(); return; }
    try {
        const body = await fs.readFile(resolved);
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(resolved)] || 'application/octet-stream');
        res.end(body);
    } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH
    || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(playwrightPath);
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let browser;
let page;
try {
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    context.setDefaultTimeout(10_000);
    context.setDefaultNavigationTimeout(15_000);
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin || /^https:\/\/[abc]\.tile\.openstreetmap\.org$/.test(url.origin)) return route.continue();
        report.blockedRequests.push(`${url.origin}${url.pathname}`);
        return route.abort();
    });
    page = await context.newPage();
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    const message = async (role, content, id, endOfSpeech = true) => page.evaluate(
        payload => window.__evanHarness.message(payload), { role, content, id, endOfSpeech },
    );
    const open = page.getByTestId('open-evan-move-planner');
    const planner = page.getByTestId('evan-move-planner');
    const map = page.getByTestId('evan-route-map');
    const waitForRoute = async expected => {
        await page.waitForFunction(locations => {
            const icons = [...document.querySelectorAll('[data-testid="evan-route-map"] .leaflet-marker-icon')];
            return icons.length === locations.length && icons.every((icon, index) =>
                icon.getAttribute('title')?.includes(locations[index]));
        }, expected);
        const href = await map.getByRole('link', { name: 'Open in Google Maps' }).getAttribute('href');
        const params = new URL(href).searchParams;
        const route = [params.get('origin') || params.get('query'), ...(params.get('waypoints')?.split('|') || []), params.get('destination')].filter(Boolean);
        assert.equal(route.length, expected.length);
        expected.forEach((location, index) => assert.ok(route[index].includes(location), `${location} must be in link position ${index + 1}: ${route[index]}`));
    };
    const callRoute = async stops => JSON.parse(await page.evaluate(
        args => window.__evanHarness.callTool('show_move_planner', { view: 'route', stops: args }), stops,
    ));
    const fakeStops = (destination = '200 Sample Road, Queen Creek', city = 'Queen Creek') => [
        { kind: 'origin', address: '100 Test Lane, Gilbert', city: 'Gilbert', order: 1, confirmed: true },
        { kind: 'destination', address: destination, city, order: 2, confirmed: true },
    ];
    const capture = async name => {
        // Framer spring and Leaflet tile fades are not completed by DOM visibility.
        await page.waitForFunction(() => {
            const panel = document.querySelector('[data-testid="evan-move-planner"]');
            if (!panel || Number(getComputedStyle(panel).opacity) < 0.999) return false;
            const expectedLeft = innerWidth >= 1024 ? innerWidth - Math.min(innerWidth * 0.58, 860) : 0;
            return Math.abs(panel.getBoundingClientRect().left - expectedLeft) < 0.5;
        });
        try {
            if (await page.locator('.leaflet-container').count()) await page.waitForFunction(() => {
                const tiles = [...document.querySelectorAll('.leaflet-tile')];
                return tiles.length > 0 && tiles.every(tile => tile.complete && tile.naturalWidth > 0
                    && Number(getComputedStyle(tile).opacity) > 0.99);
            }, null, { timeout: 8_000 });
        } catch {
            report.tileLoadingWarning = 'Public OSM tiles did not all finish loading within 8 seconds; no replacement map imagery was used.';
        }
        await page.screenshot({ path: path.join(output, `${name}.png`) });
    };
    const ready = async agent => {
        await page.goto(`${origin}/?agent=${agent}`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__evanHarness?.ready === true);
        // Reconnaissance before interaction; saved DOM supports reproducible diagnosis.
        await fs.writeFile(path.join(output, `${agent}-initial.html`), await page.content());
    };
    await ready('evan');
    await open.waitFor({ state: 'visible' });
    assert.equal(await planner.count(), 0);
    await message('persona', 'Hi, I am Evan. How can I help with your move today?', 'greeting');
    assert.equal(await planner.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__evanHarness.talks), []);
    pass('Greeting does not open planner or synthesize browser speech');

    await message('persona', 'Where are you mov', 'route-question', false);
    assert.equal(await planner.count(), 0);
    await message('persona', 'ing from, and where are you moving to?', 'route-question');
    await planner.waitFor({ state: 'visible' });
    await map.locator('.leaflet-container').waitFor({ state: 'visible' });
    assert.match(await map.innerText(), /Waiting for pickup and destination/);
    assert.equal(await map.locator('.leaflet-marker-icon').count(), 0);
    assert.equal(await map.getByRole('link', { name: 'Open in Google Maps' }).count(), 0);
    pass('Completed chunked route question opens Route with real unmarked Leaflet map');
    await capture('evan-empty-route');

    await message('user', 'I am moving from Gilbert to Queen Creek.', 'user-route');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="evan-route-map"] .leaflet-marker-icon').length === 2);
    assert.match(await map.innerText(), /2 mapped locations/);
    const directions = await map.getByRole('link', { name: 'Open in Google Maps' }).getAttribute('href');
    assert.match(directions, /Gilbert/);
    assert.match(directions, /Queen/);
    pass('Live user route adds two genuine city pins and directions link');
    await message('persona', 'Thanks, I have noted those locations.', 'acknowledge');
    await capture('evan-live-city-route');

    for (const viewport of [{ width: 1872, height: 830 }, { width: 1366, height: 768 }, { width: 1100, height: 620 }]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(350);
        const geometry = await page.evaluate(() => {
            const bounds = id => { const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
            return { canvas: bounds('evan-route-map-canvas'), controls: bounds('evan-route-map-controls'), footer: bounds('evan-planner-footer'),
                scrollTop: document.querySelector('[data-testid="evan-planner-content"]').scrollTop };
        });
        assert.equal(geometry.scrollTop, 0);
        assert.ok(geometry.canvas.height >= 220, JSON.stringify({ viewport, geometry }));
        assert.ok(geometry.controls.bottom <= geometry.footer.top + 1, JSON.stringify({ viewport, geometry }));
        const exitGeometry = await page.evaluate(() => {
            const exit = document.querySelector('[data-testid="evan-pip-exit"]');
            const button = exit.getBoundingClientRect();
            const video = document.getElementById('persona-video').getBoundingClientRect();
            const panel = document.querySelector('[data-testid="evan-move-planner"]').getBoundingClientRect();
            return { visible: getComputedStyle(exit).display !== 'none', below: button.top >= video.bottom,
                onScreen: button.bottom <= innerHeight, leftOfPlanner: button.right <= panel.left };
        });
        assert.deepEqual(exitGeometry, { visible: true, below: true, onScreen: true, leftOfPlanner: true });
        await capture(`evan-layout-${viewport.width}x${viewport.height}`);
    }
    pass('Map and directions controls fit above the footer without scrolling at desktop, laptop, and short-window sizes');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole('button', { name: 'Close Move Planner' }).click();
    await planner.waitFor({ state: 'detached' });
    await message('persona', 'What is your pickup address?', 'later-question');
    await message('user', 'The pickup is still in Gilbert.', 'later-user');
    assert.equal(await planner.count(), 0);
    pass('Dismissal is respected on later questions and transcript updates');
    await open.click();
    await planner.waitFor({ state: 'visible' });
    pass('Manual button reopens the planner');
    await page.getByRole('button', { name: 'Close Move Planner' }).click();
    await planner.waitFor({ state: 'detached' });
    const receipt = JSON.parse(await page.evaluate(() => window.__evanHarness.callTool('show_move_planner', { view: 'route' })));
    assert.equal(receipt.status, 'move_planner_opened');
    await map.locator('.leaflet-container').waitFor({ state: 'visible' });
    pass('Explicit SDK planner tool reopens after dismissal with successful receipt');

    await page.getByRole('button', { name: 'Open full-screen map' }).click();
    await page.getByRole('dialog', { name: 'Full-screen working map of move locations' }).waitFor({ state: 'visible' });
    await map.locator('.leaflet-container').waitFor({ state: 'visible' });
    await capture('evan-fullscreen-route');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open full-screen map' }).waitFor({ state: 'visible' });
    assert.equal(await planner.count(), 1);
    pass('Full-screen map works; Escape restores map without closing planner');

    await message('user', 'Actually, the destination is Scottsdale instead.', 'change-destination');
    await waitForRoute(['Gilbert', 'Scottsdale']);
    pass('Spoken destination correction replaces the old pin and Google Maps destination during the call');
    await message('user', 'Add a storage stop in Mesa.', 'add-storage');
    await waitForRoute(['Gilbert', 'Mesa', 'Scottsdale']);
    await message('user', 'Add a donation stop in Chandler.', 'add-donation');
    await waitForRoute(['Gilbert', 'Mesa', 'Chandler', 'Scottsdale']);
    await message('user', 'Put Chandler before Mesa.', 'reorder-stops');
    await waitForRoute(['Gilbert', 'Chandler', 'Mesa', 'Scottsdale']);
    await message('user', 'Remove the Mesa storage stop.', 'remove-storage');
    await waitForRoute(['Gilbert', 'Chandler', 'Scottsdale']);
    pass('Live additional stops can be added, reordered, and removed in pins and directions');
    const leafletId = await map.locator('.leaflet-container').evaluate(element => element._leaflet_id);
    await message('persona', 'I have noted the updated stop order.', 'unrelated-response');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await map.locator('.leaflet-container').evaluate(element => element._leaflet_id), leafletId);
    pass('Unrelated conversation updates preserve the existing Leaflet map instead of resetting zoom and tiles');

    await message('user', 'We are moving in two weeks from a four-bedroom house. We need full packing and a piano moved.', 'move-details');
    await page.getByRole('button', { name: 'Move brief', exact: true }).click();
    await planner.getByText('two weeks', { exact: true }).waitFor();
    await planner.getByText('four-bedroom house', { exact: true }).waitFor();
    await message('user', 'Change the timing to next month and the property to a two-bedroom apartment. We do not need full packing, and remove the piano.', 'change-details');
    await planner.getByText('next month', { exact: true }).waitFor();
    await planner.getByText('two-bedroom apartment', { exact: true }).waitFor();
    assert.equal(await planner.getByText('two weeks', { exact: true }).count(), 0);
    assert.equal(await planner.getByText('four-bedroom house', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Move list', exact: true }).click();
    await planner.getByRole('heading', { name: 'Special handling', exact: true }).waitFor();
    assert.equal(await planner.getByText('Piano', { exact: true }).count(), 0);
    assert.equal(await planner.getByText('Full packing', { exact: true }).count(), 0);
    await message('user', 'Actually, add the piano back and we do need full packing.', 'restore-details');
    await planner.getByText('Piano', { exact: true }).waitFor();
    await planner.getByText('Full packing', { exact: true }).waitFor();
    pass('Timing and property corrections replace earlier facts; cancelled inventory/services disappear and can be re-added');
    await page.getByRole('button', { name: 'Move brief', exact: true }).click();
    await message('user', 'Change the timing to this ', 'chunked-correction', false);
    // Intentionally cross the player's 400 ms pending-transcript refresh interval.
    // This exercises pending + completed state, not an arbitrary rendering delay.
    await page.waitForTimeout(450);
    await message('user', 'week.', 'chunked-correction');
    await planner.getByText('this week', { exact: true }).waitFor();
    await page.waitForTimeout(450);
    assert.equal(await planner.getByText('this week', { exact: true }).count(), 1);
    assert.equal(await planner.getByText('next month', { exact: true }).count(), 0);
    pass('Chunked visitor corrections remain current after pending and completed transcript refreshes');

    await page.getByRole('button', { name: 'Route', exact: true }).click();
    await page.getByRole('button', { name: 'Open full-screen map' }).click();
    await message('user', 'Change the destination to Tempe.', 'fullscreen-correction');
    await waitForRoute(['Gilbert', 'Chandler', 'Tempe']);
    assert.equal(await page.getByRole('dialog', { name: 'Full-screen working map of move locations' }).count(), 1);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open full-screen map' }).waitFor();
    await page.getByRole('button', { name: 'Close Move Planner' }).click();
    await planner.waitFor({ state: 'detached' });
    await message('user', 'Change the destination to Phoenix.', 'closed-correction');
    assert.equal(await planner.count(), 0);
    await open.click();
    await waitForRoute(['Gilbert', 'Chandler', 'Phoenix']);
    pass('Corrections update the fullscreen map and survive a closed planner without reopening it');
    await capture('evan-corrected-city-route');

    await ready('evan');
    await message('persona', 'If you’d like to discuss a new move, ', 'natural-route-question', false);
    assert.equal(await planner.count(), 0);
    await message('persona', 'could you share the city you’re moving from and the city you’re moving to?', 'natural-route-question');
    await planner.waitFor({ state: 'visible' });
    await map.locator('.leaflet-container').waitFor({ state: 'visible' });
    assert.match(await map.innerText(), /Waiting for pickup and destination/);
    assert.equal(await map.locator('.leaflet-marker-icon').count(), 0);
    await message('user', 'Fine, from Gilbert to Mesa, but why should I trust you won’t just shrug again?', 'natural-route-answer');
    await waitForRoute(['Gilbert', 'Mesa']);
    pass('The exact conditional live-test question opens Route and its natural answer populates Gilbert to Mesa');

    await ready('evan');
    await message('user', "Hi Evan, I'm just looking. One bedroom, probably Mesa. I'm still figuring it out.", 'natural-intake-start');
    await message('persona', 'May I have your name?', 'natural-intake-name-question');
    await message('user', 'Anna Example.', 'natural-intake-name');
    await message('persona', "Thanks, Anna. Which city are you moving from, and which city are you moving to?Anna, could you share the city you're moving from and the city you're moving to?Sure thing. I'm moving from Phoenix AZ and to Mesa AZ.", 'natural-intake-faulty-output');
    if (await planner.count() === 0) await open.click();
    await page.getByRole('button', { name: 'Route', exact: true }).click();
    assert.equal(await map.locator('.leaflet-marker-icon').count(), 0);
    pass('The recorded agent self-answer cannot create visitor route pins');
    await message('user', 'Right, yes, Phoenix to Mason.', 'natural-intake-unclear-city');
    await message('persona', "Just to confirm, you're moving from Phoenix, Arizona to Mesa, Arizona, correct?", 'natural-intake-clarification');
    await message('user', "That's right.", 'natural-intake-confirmed');
    await waitForRoute(['Phoenix', 'Mesa']);
    await message('user', "mid-month but flexible uh i might need a storage stop in gilbert first but i'm not sure yet", 'natural-intake-timing');
    await message('persona', 'Should I note a storage stop in Gilbert as a possible additional stop for now?', 'natural-intake-possible');
    await message('user', 'Yeah.', 'natural-intake-yes');
    await message('user', 'please, as possible.', 'natural-intake-still-possible');
    await waitForRoute(['Phoenix', 'Mesa']);
    await planner.getByTestId('evan-possible-stops').waitFor();
    assert.match(await planner.getByTestId('evan-possible-stops').innerText(), /Gilbert/);
    await message('user', "I'll handle packing.", 'natural-intake-self-packing');
    await page.getByRole('button', { name: 'Move brief', exact: true }).click();
    await planner.getByRole('heading', { name: 'Working move brief' }).waitFor();
    assert.match(await planner.innerText(), /One bedroom/i);
    assert.match(await planner.innerText(), /mid-month.*flexible/i);
    assert.match(await planner.innerText(), /Packing yourself/i);
    await capture('evan-natural-intake-brief');
    await page.getByRole('button', { name: 'Move list', exact: true }).click();
    await planner.getByTestId('evan-packing-plan').waitFor();
    assert.match(await planner.getByTestId('evan-packing-plan').innerText(), /Packing yourself/);
    await capture('evan-natural-intake-services');
    await page.getByRole('button', { name: 'Route', exact: true }).click();
    await waitForRoute(['Phoenix', 'Mesa']);
    await capture('evan-natural-intake-route');
    pass('The recorded clarification, flexible timing, possible storage, and self-packing remain accurate across all planner views');

    await ready('evan');
    await message('persona', 'Hi, I am Evan. How can I help with your move today?', 'fallback-greeting');
    await message('user', 'I am moving from Gilbert', 'unsolicited-route', false);
    // Cross the pending transcript refresh to prove incomplete answers do not
    // open the planner before the visitor has finished giving both endpoints.
    await page.waitForTimeout(450);
    assert.equal(await planner.count(), 0);
    await message('user', ' to Mesa.', 'unsolicited-route');
    await planner.waitFor({ state: 'visible' });
    await waitForRoute(['Gilbert', 'Mesa']);
    assert.deepEqual(await page.evaluate(() => window.__evanHarness.talks), []);
    pass('Completed chunked visitor origin and destination open Route without an agent location question or tool call');
    await capture('evan-visitor-route-fallback');
    await page.getByRole('button', { name: 'Close Move Planner' }).click();
    await planner.waitFor({ state: 'detached' });
    await message('user', 'Actually, I am moving from Tempe to Phoenix instead.', 'dismissed-new-route');
    await message('persona', 'If you’d like to discuss a new move, could you share the city you’re moving from and the city you’re moving to?', 'dismissed-new-question');
    await page.waitForTimeout(450);
    assert.equal(await planner.count(), 0);
    await open.click();
    await waitForRoute(['Tempe', 'Phoenix']);
    pass('Dismissal blocks both new visitor routes and new natural questions while keeping the latest route available manually');

    await ready('evan');
    await message('persona', 'If you’d like to discuss a new move, could you share the city ', 'unfinished-question', false);
    await message('user', 'I am moving from Gilbert', 'answer-before-question-final', false);
    assert.equal(await planner.count(), 0);
    await message('user', ' to Mesa.', 'answer-before-question-final');
    // Assert the fallback has already opened before the delayed persona final;
    // that final cannot be the cause of this successful route presentation.
    await planner.waitFor({ state: 'visible' });
    await waitForRoute(['Gilbert', 'Mesa']);
    await page.getByRole('button', { name: 'Close Move Planner' }).click();
    await planner.waitFor({ state: 'detached' });
    await message('persona', 'you’re moving from and the city you’re moving to?', 'unfinished-question');
    await page.waitForTimeout(450);
    assert.equal(await planner.count(), 0);
    pass('A visitor answer before the persona final opens Route, and the late question final respects dismissal');

    await ready('evan');
    await message('user', 'The pickup address is 100 Test Lane, Gilbert. The destination address is 200 Sample Road, Queen Creek.', 'confirmed-addresses');
    const addressReceipt = await callRoute(fakeStops());
    assert.equal(addressReceipt.streetPins, 2);
    await waitForRoute(['100 Test Lane', '200 Sample Road']);
    await message('user', 'Actually, the destination is Scottsdale instead.', 'confirmed-city-correction');
    await waitForRoute(['100 Test Lane', 'Scottsdale']);
    assert.equal(await map.locator('.leaflet-marker-icon[title*="200 Sample Road"]').count(), 0);
    pass('A city correction supersedes a previously geocoded destination while retaining the unchanged origin');

    await message('user', 'The destination address is 300 Sample Road, Scottsdale.', 'new-street-address');
    await callRoute(fakeStops('300 Sample Road, Scottsdale', 'Scottsdale'));
    await waitForRoute(['100 Test Lane', '300 Sample Road']);
    await message('user', 'Change the destination address to 400 Replacement Road, Scottsdale.', 'replace-street-address');
    await page.waitForFunction(() => !document.querySelector('[data-testid="evan-route-map"] .leaflet-marker-icon[title*="300 Sample Road"]'));
    const pendingCorrectionLink = await map.getByRole('link', { name: 'Open in Google Maps' }).getAttribute('href');
    assert.ok(!pendingCorrectionLink.includes('300'), 'The old confirmed address must not remain in directions while its replacement is being confirmed');
    await callRoute(fakeStops('400 Replacement Road, Scottsdale', 'Scottsdale'));
    await waitForRoute(['100 Test Lane', '400 Replacement Road']);
    assert.equal(await map.locator('.leaflet-marker-icon[title*="300 Sample Road"]').count(), 0);
    pass('Sequential confirmed street-address updates replace the pin and directions within the same city');

    geocodeResponses.push({ delay: 600 }, {});
    const geocodeCount = report.apiRequests.filter(request => request.path.endsWith('/route-geocode')).length;
    await page.evaluate(stops => { window.__oldRoute = window.__evanHarness.callTool('show_move_planner', { view: 'route', stops }); }, fakeStops('500 Older Road, Scottsdale', 'Scottsdale'));
    await page.waitForFunction(() => document.querySelector('[data-testid="evan-route-map"] a[href*="500"]'));
    assert.equal(report.apiRequests.filter(request => request.path.endsWith('/route-geocode')).length, geocodeCount + 1);
    await callRoute(fakeStops('600 Latest Road, Scottsdale', 'Scottsdale'));
    await page.evaluate(() => window.__oldRoute);
    await waitForRoute(['100 Test Lane', '600 Latest Road']);
    pass('A delayed older geocode response cannot replace a newer street-address tool update');

    geocodeResponses.push({ delay: 600 });
    await page.evaluate(stops => { window.__staleRoute = window.__evanHarness.callTool('show_move_planner', { view: 'route', stops }); }, fakeStops('700 Pending Road, Scottsdale', 'Scottsdale'));
    await page.waitForFunction(() => document.querySelector('[data-testid="evan-route-map"] a[href*="700"]'));
    await message('user', 'Actually, change the destination to Chandler.', 'correction-during-geocode');
    await page.evaluate(() => window.__staleRoute);
    await waitForRoute(['100 Test Lane', 'Chandler']);
    assert.equal(await map.locator('.leaflet-marker-icon[title*="700 Pending Road"]').count(), 0);
    assert.match(await map.innerText(), /1 street-level pin/i);
    pass('A spoken correction arriving during geocoding stays authoritative after the delayed response');
    await capture('evan-corrected-address-route');

    geocodeResponses.push({ delay: 600 });
    await page.evaluate(stops => { window.__abandonedRoute = window.__evanHarness.callTool('show_move_planner', { view: 'route', stops }); }, fakeStops('800 Abandoned Road, Scottsdale', 'Scottsdale'));
    await page.waitForFunction(() => document.querySelector('[data-testid="evan-route-map"] a[href*="800"]'));
    const inventoryReceipt = JSON.parse(await page.evaluate(() => window.__evanHarness.callTool('show_move_planner', { view: 'inventory' })));
    assert.equal(inventoryReceipt.status, 'move_planner_opened');
    assert.equal(inventoryReceipt.view, 'inventory');
    assert.equal(inventoryReceipt.streetPins, 1);
    assert.equal(inventoryReceipt.unresolvedAddresses, 1);
    assert.ok(inventoryReceipt.visibleStops.some(stop => stop.includes('800 Abandoned Road') && stop.includes('(unresolved)')));
    assert.ok(inventoryReceipt.visibleStops.every(stop => !stop.includes('(pending)')));
    const abandonedReceipt = JSON.parse(await page.evaluate(() => window.__abandonedRoute));
    assert.equal(abandonedReceipt.status, 'update_superseded');
    await planner.getByRole('heading', { name: 'Your move, at a glance', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Route', exact: true }).click();
    await waitForRoute(['100 Test Lane', '800 Abandoned Road']);
    await planner.getByText('Address needs confirmation', { exact: true }).waitFor();
    assert.match(await map.innerText(), /1 street-level pin/i);
    pass('A view-only request supersedes a pending lookup with an explicit unresolved receipt and preserves the verified origin pin');

    await ready('evan');
    await message('user', 'I am moving from Mesa to Gilbert.', 'desktop-exit-route');
    await planner.waitFor({ state: 'visible' });
    await page.getByTestId('evan-pip-exit').click();
    await page.getByTestId('session-exited').waitFor();
    assert.equal(await page.evaluate(() => window.__evanHarness.stopCount), 1);
    pass('Desktop Exit under Evan ends the session through normal unmount cleanup without dismissing the planner first');

    await page.setViewportSize({ width: 390, height: 844 });
    await ready('evan');
    await message('user', 'I am moving from Mesa to Gilbert.', 'mobile-exit-route');
    await planner.waitFor({ state: 'visible' });
    const mobileExit = page.getByTestId('evan-planner-mobile-exit');
    await mobileExit.waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('evan-pip-exit').isVisible(), false);
    const mobileBounds = await mobileExit.boundingBox();
    assert.ok(mobileBounds && mobileBounds.y >= 0 && mobileBounds.y + mobileBounds.height <= 844);
    await capture('evan-mobile-exit');
    await mobileExit.click();
    await page.getByTestId('session-exited').waitFor();
    assert.equal(await page.evaluate(() => window.__evanHarness.stopCount), 1);
    pass('Mobile planner keeps a visible working Exit button without requiring planner dismissal');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`${origin}/?gate=1`, { waitUntil: 'networkidle' });
    await page.getByLabel('Name', { exact: true }).fill('Avery Example');
    await page.getByLabel('Email', { exact: true }).fill('avery@example.test');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Email my recap and continue' }).click();
    await page.waitForFunction(() => window.__evanHarness?.ready === true);
    await message('user', 'I am moving from Mesa to Gilbert next month. It is a two bedroom house. We need full packing and have a treadmill. There are stairs.', 'contact-route');
    await planner.waitFor({ state: 'visible' });
    await planner.getByRole('button', { name: 'Move brief', exact: true }).click();
    await planner.getByText('avery@example.test', { exact: true }).waitFor();
    await planner.getByText('Avery Example', { exact: true }).waitFor();
    await message('user', 'My phone number is 480-555-0142. Call me in the morning.', 'contact-phone');
    await page.waitForFunction(() => document.querySelector('[data-testid="evan-move-planner"]').textContent.includes('0142'));
    await message('user', 'Actually, my phone number is 602-555-', 'contact-correction', false);
    await page.waitForTimeout(700);
    assert.match(await planner.getByTestId('evan-contact-phone').innerText(), /0142/);
    await message('user', '0198.', 'contact-correction');
    await page.waitForFunction(() => {
        const text = document.querySelector('[data-testid="evan-move-planner"]').textContent;
        return text.includes('0198') && !text.includes('0142');
    });
    await message('user', "I'm good.", 'contact-acknowledgement');
    assert.equal(await planner.getByText('Avery Example', { exact: true }).isVisible(), true);
    assert.doesNotMatch(await planner.innerText(), /\d+%|of 6 planning|Brief completeness/i);
    assert.doesNotMatch(await page.evaluate(() => JSON.stringify(window.__evanHarness.contexts)), /avery@example|Avery Example|555/);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    pass('Completed contact corrections update live without partial-number or acknowledgement corruption, and no contact is sent to avatar context or browser storage');
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1100, height: 620 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        for (const tab of ['Move brief', 'Move list', 'Next steps']) {
            await planner.getByRole('button', { name: tab, exact: true }).click();
            await page.waitForTimeout(500);
            const fits = await page.evaluate(() => {
                const panel = document.querySelector('[data-testid="evan-move-planner"]');
                const content = document.querySelector('[data-testid="evan-planner-content"]');
                const footer = document.querySelector('[data-testid="evan-planner-footer"]');
                return { noHorizontalOverflow: content.scrollWidth <= content.clientWidth + 1,
                    footerOnScreen: footer.getBoundingClientRect().bottom <= innerHeight + 1,
                    separateFooter: content.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top + 1,
                    noScore: !/\d+%|of 6 planning|Brief completeness/.test(panel.textContent) };
            });
            assert.deepEqual(fits, { noHorizontalOverflow: true, footerOnScreen: true, separateFooter: true, noScore: true });
            await capture(`evan-${tab.toLowerCase().replaceAll(' ', '-')}-${viewport.width}x${viewport.height}`);
        }
    }
    pass('Brief, move list, and next steps fit their scroll regions with no score or footer overlap on laptop, short-window, and mobile views');
    await planner.getByRole('button', { name: 'Move list', exact: true }).click();
    await planner.getByText('Ask Mullins about', { exact: true }).waitFor();
    await planner.getByRole('button', { name: 'Move brief', exact: true }).click();
    await planner.getByTestId('evan-planner-contact').waitFor({ state: 'visible' });
    await message('user', 'Remove my email.', 'contact-hide-email');
    await page.waitForFunction(() => !document.querySelector('[data-testid="evan-planner-contact"]').textContent.includes('avery@example.test'));
    await page.evaluate(() => {
        for (let index = 0; index < 405; index++) window.__evanHarness.message({
            role: 'persona', content: 'We can review the move details.', id: `long-call-${index}`, endOfSpeech: true,
        });
    });
    await message('user', 'My email is alternate@example.test.', 'contact-after-hide');
    await planner.getByText('alternate@example.test', { exact: true }).waitFor();
    assert.doesNotMatch(await planner.getByTestId('evan-planner-contact').innerText(), /avery@example\.test/);
    pass('A hidden check-in email stays hidden through a long call and a newly supplied spoken address');
    await page.goto(`${origin}/?gate=1`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue without email' }).click();
    await page.waitForFunction(() => window.__evanHarness?.ready === true);
    await open.click();
    assert.doesNotMatch(await planner.innerText(), /avery@example|Avery Example|0198/);
    pass('A fresh guest session does not inherit previous visitor contact information');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.clock.install();
    await ready('evan');
    const endCall = async metadata => JSON.parse(await page.evaluate(meta => window.__evanHarness.callTool('end_mullins_session', {}, meta), metadata || {}));
    const assertStillLive = async () => assert.equal(await page.evaluate(() => window.__evanHarness.ready && window.__evanHarness.stopCount === 0), true);
    await message('persona', 'Your callback number is confirmed. Did I get that right?', 'close-confirm');
    await message('user', 'Yes.', 'close-yes');
    assert.equal((await endCall()).status, 'continue_conversation');
    await message('persona', 'Is there anything else—special items, access concerns, or packing help you would like to mention?', 'close-question');
    await page.clock.fastForward(13_000);
    await assertStillLive();
    pass('Exact premature-close scenario refuses the end tool after contact confirmation and stays connected');

    await message('user', 'Goodbye.', 'close-bye-1');
    assert.equal((await endCall()).status, 'farewell_required');
    await message('persona', 'Is there anything else you would like to add?', 'close-not-farewell');
    await page.clock.fastForward(3_000);
    await assertStillLive();
    await page.evaluate(() => window.__evanHarness.emit('USER_SPEECH_STARTED', 'continued-1'));
    await message('user', 'Wait, I need to add a treadmill.', 'continued-user-1');
    await page.evaluate(() => window.__evanHarness.emit('USER_SPEECH_ENDED', 'continued-1'));
    await page.clock.fastForward(13_000);
    await assertStillLive();
    assert.equal((await endCall()).status, 'continue_conversation');
    assert.equal(JSON.parse(await page.evaluate(() => window.__evanHarness.callTool('show_move_planner', { view: 'inventory' }))).status, 'move_planner_opened');
    pass('An ordinary question never counts as farewell; resumed visitor speech cancels fallback and leaves planner tools usable');

    await message('user', 'That is all, goodbye.', 'close-bye-2');
    assert.equal((await endCall()).status, 'farewell_required');
    await message('persona', 'Thank you for speaking with Mullins Moving. Take care.', 'close-farewell-2');
    await page.clock.fastForward(300);
    await page.evaluate(() => window.__evanHarness.emit('USER_SPEECH_STARTED', 'continued-2'));
    await message('user', 'Actually, one more question about packing.', 'continued-user-2');
    await page.evaluate(() => window.__evanHarness.emit('USER_SPEECH_ENDED', 'continued-2'));
    await page.clock.fastForward(13_000);
    await assertStillLive();
    pass('Visitor speech during the goodbye audio-drain grace cancels the hang-up');

    await message('user', 'Goodbye.', 'close-bye-3');
    assert.equal((await endCall()).status, 'farewell_required');
    await message('user', 'Wait, please', 'continued-partial', false);
    await page.clock.fastForward(13_000);
    await assertStillLive();
    await message('user', ', I have another question.', 'continued-partial');
    assert.equal((await endCall()).status, 'continue_conversation');
    pass('User transcript chunks cancel pending closure even without a VAD speech-start event');

    await page.evaluate(() => window.__evanHarness.emit('USER_SPEECH_STARTED', 'final-goodbye'));
    await message('user', 'Thank you, goodbye.', 'close-final-user');
    await page.evaluate(() => window.__evanHarness.emit('USER_SPEECH_ENDED', 'final-goodbye'));
    assert.equal((await endCall({ userActionCorrelationId: 'older-turn' })).status, 'continue_conversation');
    assert.equal((await endCall({ userActionCorrelationId: 'final-goodbye' })).status, 'farewell_required');
    assert.equal((await endCall({ userActionCorrelationId: 'final-goodbye' })).status, 'farewell_already_armed');
    await message('persona', 'Thank you for speaking with Mullins Moving. Take care.', 'close-final-farewell');
    await page.clock.fastForward(1_100);
    assert.equal(await page.evaluate(() => window.__evanHarness.stopCount), 1);
    await page.clock.fastForward(13_000);
    assert.equal(await page.evaluate(() => window.__evanHarness.stopCount), 1);
    pass('A fresh explicit goodbye closes once after the actual farewell; stale and duplicate end tools cannot accelerate it');

    await ready('evan');
    await message('persona', 'Let me know if there is anything else you would like to add.', 'same-id-farewell');
    await message('user', "That's everything. Thanks, Evan. Goodbye.", 'latest-live-goodbye');
    assert.equal((await endCall()).status, 'farewell_required');
    await message('persona', '', 'same-id-farewell');
    await page.clock.fastForward(1_100);
    await assertStillLive();
    await message('persona', 'Thank you for speaking with Mullins Moving. ', 'same-id-farewell', false);
    await page.clock.fastForward(1_100);
    await assertStillLive();
    await message('persona', 'Take care.', 'same-id-farewell');
    await page.clock.fastForward(1_100);
    assert.equal(await page.evaluate(() => window.__evanHarness.stopCount), 1);
    pass('Exact latest goodbye closes within the brief drain even when Anam reuses its message ID; old markers and partial farewell cannot close');

    for (const ending of ["No, that's enough for now. Just have someone call in the morning. Thank you.", "That's everything. We're good to end."]) {
        await ready('evan');
        await message('persona', 'Is there anything else you would like to add?', 'natural-close-question');
        await message('user', ending, 'natural-close-user');
        assert.equal((await endCall()).status, 'farewell_required');
        await message('persona', 'Thank you for speaking with Mullins Moving. Take care.', 'natural-close-farewell');
        await page.clock.fastForward(1_100);
        assert.equal(await page.evaluate(() => window.__evanHarness.stopCount), 1);
    }
    pass('Both observed natural closing phrases authorize a single farewell and automatic close without a second goodbye');

    await ready('amy');
    await message('persona', 'If you’d like to discuss a new move, could you share the city you’re moving from and the city you’re moving to?', 'amy-natural-question');
    await message('user', 'I am moving from Gilbert', 'amy-user', false);
    await message('user', ' to Mesa.', 'amy-user');
    await message('persona', 'Where are you moving from, and where are you moving to?', 'amy-question');
    await page.waitForTimeout(450);
    assert.equal(await open.count(), 0);
    assert.equal(await planner.count(), 0);
    assert.equal(await map.count(), 0);
    pass('Actual shared AnamPlayer keeps natural-question and visitor-route auto-open isolated from Amy');

    assert.equal(report.apiRequests.filter(request => request.path === '/api/anam-token').length, 15);
    assert.ok(report.apiRequests.every(request => ['/api/anam-token', '/api/anam/evan/route-geocode', '/api/anam/evan/access'].includes(request.path)));
    assert.deepEqual(report.blockedRequests, []);
    assert.deepEqual(report.consoleErrors, []);
    pass('Only local fake tokens/geocodes; no live provider, email, external geocoder, or unexpected network requests');
    report.passed = true;
} catch (error) {
    report.passed = false;
    report.failure = error.stack || String(error);
    if (page) {
        await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
        await fs.writeFile(path.join(output, 'failure.html'), await page.content()).catch(() => {});
    }
    process.exitCode = 1;
    console.error(report.failure);
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Report: ${path.join(output, 'report.json')}`);
}
