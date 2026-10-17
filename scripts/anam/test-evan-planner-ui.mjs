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
    const capture = async name => {
        // Framer spring and Leaflet tile fades are not completed by DOM visibility.
        await page.waitForFunction(() => {
            const panel = document.querySelector('[data-testid="evan-move-planner"]');
            if (!panel || Number(getComputedStyle(panel).opacity) < 0.999) return false;
            const expectedLeft = innerWidth >= 1024 ? innerWidth - Math.min(innerWidth * 0.58, 860) : 0;
            return Math.abs(panel.getBoundingClientRect().left - expectedLeft) < 0.5;
        });
        try {
            await page.waitForFunction(() => {
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

    await ready('amy');
    await message('persona', 'Where are you moving from, and where are you moving to?', 'amy-question');
    await message('user', 'I am moving from Gilbert to Queen Creek.', 'amy-user');
    assert.equal(await open.count(), 0);
    assert.equal(await planner.count(), 0);
    assert.equal(await map.count(), 0);
    pass('Actual shared AnamPlayer keeps Evan auto-open and map isolated from Amy');

    assert.equal(report.apiRequests.length, 2);
    assert.ok(report.apiRequests.every(request => request.path === '/api/anam-token'));
    assert.deepEqual(report.blockedRequests, []);
    assert.deepEqual(report.consoleErrors, []);
    pass('Only two fake token requests; no provider, email, geocoder, or unexpected network requests');
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
