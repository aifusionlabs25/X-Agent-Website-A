/** Bare-SDK diagnostic. Default help; --check is local only; --run reserves ONE
 * of at most TWO authorized attempts. No retries, microphone, application APIs,
 * real client tools, persona changes, website deployment, or email delivery. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { diagnosticLedgerName, prepareDiagnosticPrompt, RECOVERY_VARIANT } from './evan-short-reply-experiment.mjs';

const PERSONA_ID = '3720fcf6-f9fd-4b7c-b384-af559d0c84b2';
const MAX_ATTEMPTS = 2;
const MAX_SESSION_MS = 60_000;
const args = process.argv.slice(2);
let scenario = 'baseline';
let promptVariant = 'unchanged';
let mode;
for (let index = 0; index < args.length; index++) {
    if (args[index] === '--scenario' && index + 1 < args.length && ['baseline', 'interrupted'].includes(args[index + 1])
        && !args.slice(0, index).includes('--scenario')) scenario = args[++index];
    else if (args[index] === '--prompt-variant' && ['unchanged', RECOVERY_VARIANT].includes(args[index + 1])
        && !args.slice(0, index).includes('--prompt-variant')) promptVariant = args[++index];
    else if (['--help', '--check', '--run'].includes(args[index]) && !mode) mode = args[index];
    else { console.error('Use --help, --check, or --run [--scenario baseline|interrupted] [--prompt-variant unchanged|recovery-v1].'); process.exit(1); }
}
if (!mode || mode === '--help') {
    console.log('Usage: node scripts/anam/diagnose-evan-short-replies.mjs --check | --run [--scenario baseline|interrupted] [--prompt-variant unchanged|recovery-v1]');
    console.log('--check: bundle bare SDK locally; no token, browser, or session.');
    console.log('--run: ONE isolated session; max TWO reservations per explicitly approved experiment. Original exhausted ledger stays intact.');
    console.log('recovery-v1: owner approved two additional temporary sessions on November 13; no saved persona updates.');
    console.log('Requires ANAM_API_KEY and PLAYWRIGHT_MODULE_PATH. Optional PLAYWRIGHT_BROWSER_EXECUTABLE.');
    console.log('Provider duration must be verified <=60s; browser stop53s, outer cleanup55s, process teardown58s.');
    process.exit(0);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const output = path.join(root, '.vercel/evan-short-reply-diagnostics');
const ledgerPath = path.join(root, '.vercel', diagnosticLedgerName(promptVariant));
const lockPath = `${ledgerPath}.lock`;
await fs.mkdir(output, { recursive: true });
const { webpack } = require('next/dist/compiled/webpack/webpack');
await new Promise((resolve, reject) => {
    const compiler = webpack({
        mode: 'development', devtool: false,
        entry: fileURLToPath(new URL('./diagnose-evan-short-replies.entry.mjs', import.meta.url)),
        output: { path: output, filename: 'bundle.js' },
        resolve: { extensions: ['.ts', '.js', '.mjs'] },
        module: { rules: [{ test: /\.ts$/, exclude: /node_modules/,
            use: fileURLToPath(new URL('./test-evan-planner-ui.loader.cjs', import.meta.url)) }] },
        optimization: { minimize: false }, performance: { hints: false },
    });
    compiler.run((error, stats) => compiler.close(() => {
        if (error || stats?.hasErrors()) reject(new Error('Local diagnostic bundle failed; no session requested.'));
        else resolve();
    }));
});
if (mode === '--check') {
    console.log('PASS local bare-SDK diagnostic bundle; no network, token, browser, ledger reservation, or session.');
    process.exit(0);
}
async function ledgerUpdate(update) {
    // Never recover a stale lock automatically: doing so could exceed approval.
    const lock = await fs.open(lockPath, 'wx');
    try {
        let ledger;
        try { ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); }
        catch (error) {
            if (error.code !== 'ENOENT') throw new Error('Diagnostic ledger is unreadable; stop for review.');
            ledger = { schema: 1, personaId: PERSONA_ID, maxAttempts: MAX_ATTEMPTS, attempts: [],
                ...(promptVariant === RECOVERY_VARIANT ? { promptVariant, approvalDate: '2026-11-13' } : {}) };
        }
        if (ledger.schema !== 1 || ledger.personaId !== PERSONA_ID || ledger.maxAttempts !== MAX_ATTEMPTS
            || !Array.isArray(ledger.attempts) || ledger.attempts.length > MAX_ATTEMPTS
            || (promptVariant === RECOVERY_VARIANT && (ledger.promptVariant !== promptVariant || ledger.approvalDate !== '2026-11-13'))) {
            throw new Error('Diagnostic ledger does not match this approval.');
        }
        const value = update(ledger);
        const temporary = `${ledgerPath}.${randomUUID()}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(ledger, null, 2), { flag: 'wx' });
        await fs.rename(temporary, ledgerPath);
        return value;
    } finally { await lock.close(); await fs.unlink(lockPath); }
}
const report = {
    schema: 1, personaId: PERSONA_ID, sdkVersion: require('@anam-ai/js-sdk/package.json').version,
    mode: 'isolated-bare-sdk-typed-input', scenario, promptVariant, createdAt: new Date().toISOString(),
    result: 'setup_incomplete', engineStartAttempted: false, tokenIssued: false, browserErrors: 0,
    stage: 'local_setup', engineStartRequestCount: 0, audioQuietChecks: [],
    blockedRequestCount: 0, microphoneEnabled: false, audioPlaybackMuted: true,
    emailsSent: false, productionChanged: false, checkpoints: [],
    limitations: [
        'Synthetic text only: no microphone, speech recognition, Nova, or audible pronunciation test.',
        'No website planner/capture, closing guard/recovery, session binding, or email pipeline is loaded.',
        'Client tools return unavailable without taking actions; provider-native knowledge tools remain available.',
        'Ephemeral 60s persona is derived from the fixed saved copy; this is not a stateful website launch. Resolved provider defaults require separate review.',
        'Raw SDK stream and completed history are separate evidence; a short response is not automatically scored as a failure.',
        'A single session does not establish repeatability or identify an upstream model/engine cause.',
        ...(scenario === 'interrupted' ? ['One first reply is intentionally interrupted, not scored as a response failure; subsequent replies require separate review.'] : []),
    ],
};
const reportPath = path.join(output, `${report.createdAt.replace(/[:.]/g, '-')}-${randomUUID()}.json`);
let browserServer;
let browser;
let page;
let server;
let reservationId;
let epoch = 0;
let cleanupPromise;
let outerTimer;
let forceTimer;
let providerTimer;
let providerStopPromise;
let sessionId;
let token;
let apiKey;
let aborted = false;
const elapsed = () => epoch ? Date.now() - epoch : 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, ms) => Promise.race([Promise.resolve(promise).catch(() => undefined), sleep(ms)]);
function stopProvider() {
    if (!sessionId || !apiKey) return Promise.resolve();
    return providerStopPromise ||= (async () => {
        report.providerStopRequestedAtMs = elapsed();
        try {
            const response = await fetch(`https://api.anam.ai/v1/sessions/${sessionId}/stop`, {
                method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(3_000),
            });
            report.providerStopAccepted = response.status === 200;
            await response.body?.cancel();
        } catch { report.providerStopAccepted = false; }
    })();
}
function forceBrowserExit() {
    const owned = browserServer?.process();
    if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
    // This PID comes directly from the browser server created by this process.
    // Never match or terminate a user's Chrome/Edge window by name.
    try {
        if (process.platform === 'win32' && Number.isInteger(owned.pid) && owned.pid > 0 && owned.pid !== process.pid) {
            execFileSync('taskkill', ['/PID', String(owned.pid), '/T', '/F'], { windowsHide: true, timeout: 1_000, stdio: 'ignore' });
        } else owned.kill('SIGKILL');
    } catch { report.forcedBrowserExitWarning = true; }
    report.forcedBrowserExitAtMs = elapsed();
}
function cleanup(reason = 'harness_complete') {
    return cleanupPromise ||= (async () => {
        aborted = true;
        void stopProvider();
        if (page && !page.isClosed()) {
            report.audioStats = await bounded(page.evaluate(() => window.__evanShortReplyDiagnostic?.audioStats()), 400);
            report.session = await bounded(page.evaluate(() => window.__evanShortReplyDiagnostic?.snapshot()), 400);
            await bounded(page.evaluate(value => window.__evanShortReplyDiagnostic?.stop(value), reason), 700);
            const final = await bounded(page.evaluate(() => window.__evanShortReplyDiagnostic?.snapshot()), 300);
            if (final) report.session = final;
        }
        await bounded(browserServer?.close(), 700);
        if (browserServer?.process()?.exitCode === null && browserServer?.process()?.signalCode === null) forceBrowserExit();
        await bounded(browserServer?.kill(), 500);
        const owned = browserServer?.process();
        report.browserExitConfirmed = !owned || owned.exitCode !== null || owned.signalCode !== null;
        report.browserClosedAtMs = elapsed();
        clearTimeout(outerTimer);
        clearTimeout(providerTimer);
        if (report.browserExitConfirmed) clearTimeout(forceTimer);
        server?.closeAllConnections();
        if (server) await bounded(new Promise(resolve => server.close(resolve)), 300);
        await bounded(providerStopPromise, 3_000);
        token = undefined; apiKey = undefined;
    })();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    report.result = 'interrupted'; void cleanup('operator_interrupted');
});

try {
    apiKey = process.env.ANAM_API_KEY?.trim();
    if (!apiKey || !process.env.PLAYWRIGHT_MODULE_PATH) throw new Error('Missing approved runtime configuration.');
    // Read ONLY the pinned rehearsal copy. No saved persona is ever written.
    report.stage = 'saved_copy_fetch';
    const savedResponse = await fetch(`https://api.anam.ai/v1/personas/${PERSONA_ID}`, {
        headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8_000), cache: 'no-store',
    });
    if (!savedResponse.ok) throw new Error('Pinned rehearsal copy unavailable.');
    const saved = await savedResponse.json();
    const prompt = saved.brain?.systemPrompt;
    const promptHash = typeof prompt === 'string' ? createHash('sha256').update(prompt.trim() + '\n').digest('hex') : '';
    const expectedTools = ['1dfa728e-cc88-4132-9552-a0ff9884dd11', '69a89bda-9e11-443f-84c0-1cbea75e4fcb',
        'ac5c9f09-fc18-4702-8818-8d8b812164a9', 'bc0b4e00-3a04-4139-a699-b90c5c7b6415', 'fc93e067-9254-4635-a4a6-645970d12548'];
    const toolIds = saved.tools?.map(tool => tool._toolId ?? tool.id);
    if ((saved.id ?? saved._id ?? saved.personaId) !== PERSONA_ID
        || promptHash !== '39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b'
        || saved.llmId !== '2032d289-6faa-46e6-819c-fbe4dd79a37a'
        || !Array.isArray(toolIds) || toolIds.length !== 5 || expectedTools.some(tool => !toolIds.includes(tool))) {
        throw new Error('Pinned rehearsal identity, prompt, model or tools drifted.');
    }
    // Documented ephemeral fields only; omit personaId so the 60s cap is explicit.
    // https://anam.ai/docs/api-reference/sessions/create-session-token.md
    const diagnosticPrompt = prepareDiagnosticPrompt(prompt, promptVariant);
    const personaConfig = { name: saved.name, avatarId: saved.avatar.id, avatarModel: saved.avatarModel,
        voiceId: saved.voice.id, llmId: saved.llmId, systemPrompt: diagnosticPrompt, toolIds,
        maxSessionLengthSeconds: 60, initialMessage: saved.initialMessage, skipGreeting: saved.skipGreeting ?? false,
        uninterruptibleGreeting: saved.uninterruptibleGreeting ?? false, voiceDetectionOptions: saved.voiceDetectionOptions,
        voiceGenerationOptions: saved.voiceGenerationOptions ?? {}, directorNotes: saved.directorNotes,
        languageCode: saved.languageCode };
    report.sourcePromptHash = promptHash;
    report.promptHash = createHash('sha256').update(diagnosticPrompt.trim() + '\n').digest('hex');
    report.sourcePersonaId = PERSONA_ID;
    report.stage = 'config_validated';
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
    const bundle = await fs.readFile(path.join(output, 'bundle.js'));
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><video id="evan-video" autoplay playsinline muted></video><script src="/bundle.js"></script></body></html>';
    server = http.createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
        if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
        if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle); return; }
        response.writeHead(404); response.end();
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    report.stage = 'browser_launch';
    browserServer = await chromium.launchServer({ headless: true,
        ...(process.env.PLAYWRIGHT_BROWSER_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE } : {}),
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'], timeout: 15_000,
    });
    browserServer.process().once('exit', () => { report.browserExitedAtMs = elapsed(); });
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 10_000 });
    const context = await browser.newContext({ permissions: [], serviceWorkers: 'block' });
    await context.addInitScript(() => {
        window.__evanDiagnosticMicRequests = 0;
        if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            configurable: false, value: async () => {
                window.__evanDiagnosticMicRequests++;
                throw new DOMException('Microphone disabled for typed diagnostic.', 'NotAllowedError');
            },
        });
        window.__evanDiagnosticPeers = [];
        const NativePeer = window.RTCPeerConnection;
        window.RTCPeerConnection = new Proxy(NativePeer, { construct(target, args) {
            const peer = Reflect.construct(target, args);
            window.__evanDiagnosticPeers.push(peer);
            return peer;
        } });
    });
    const anamHost = hostname => hostname === 'anam.ai' || hostname.endsWith('.anam.ai');
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'api.anam.ai' && url.pathname === '/v1/engine/session' && route.request().method() === 'POST') {
            report.engineStartRequestCount++;
            if (report.engineStartRequestCount > 1) {
                report.blockedRequestCount++; void cleanup('second_engine_start_blocked'); return route.abort();
            }
        }
        if (url.origin === origin || url.protocol === 'https:' && anamHost(url.hostname)) return route.continue();
        report.blockedRequestCount++; return route.abort();
    });
    await context.routeWebSocket('**/*', socket => {
        const url = new URL(socket.url());
        if (url.protocol === 'wss:' && anamHost(url.hostname)) socket.connectToServer();
        else { report.blockedRequestCount++; socket.close(); }
    });
    page = await context.newPage();
    await page.exposeFunction('__evanDiagnosticSessionReady', id => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) return;
        if (sessionId && sessionId !== id) { report.unexpectedSecondSession = true; void cleanup('unexpected_second_session'); return; }
        sessionId = id; report.sessionId = id;
        if (aborted || elapsed() >= 50_000) void stopProvider();
    });
    page.on('pageerror', () => { report.browserErrors++; });
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 10_000 });
    await page.waitForFunction(() => Boolean(window.__evanShortReplyDiagnostic), null, { timeout: 5_000 });
    report.stage = 'browser_ready';
    if (aborted) throw new Error('Operator stopped setup.');
    reservationId = await ledgerUpdate(ledger => {
        if (ledger.attempts.length >= MAX_ATTEMPTS) throw new Error('Both authorized diagnostic attempts are already reserved.');
        const attempt = { id: randomUUID(), reservedAt: new Date().toISOString(), status: 'reserved', providerMaxSeconds: 60 };
        ledger.attempts.push(attempt); return attempt.id;
    });
    report.reservationId = reservationId;
    epoch = Date.now();
    report.budgetStartedAt = new Date(epoch).toISOString();
    forceTimer = setTimeout(forceBrowserExit, 58_000);
    providerTimer = setTimeout(() => { void stopProvider(); }, 50_000);
    const deadline = new Promise(resolve => {
        outerTimer = setTimeout(() => {
            report.result = '55_second_outer_limit'; void cleanup('55_second_outer_limit'); resolve();
        }, 55_000);
    });
    const flow = async () => {
        report.stage = 'token_request';
        const response = await fetch('https://api.anam.ai/v1/auth/session-token', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ personaConfig, maxSessions: 1, expiresInSeconds: 120,
                clientLabel: `evan-short-reply-diagnostic-${reservationId}` }),
            signal: AbortSignal.timeout(8_000),
        });
        report.tokenRequestHTTPStatus = response.status;
        if (!response.ok) throw new Error('Provider token request rejected.');
        const payload = await response.json(); token = payload.sessionToken;
        if (typeof token !== 'string' || !token.trim()) throw new Error('No diagnostic token.');
        report.tokenIssued = true;
        report.providerDurationSecondsRequested = personaConfig.maxSessionLengthSeconds;
        if (aborted || elapsed() >= 45_000) throw new Error('Not enough diagnostic budget remains.');
        report.engineStartAttempted = true;
        report.stage = 'engine_start';
        await page.evaluate(input => window.__evanShortReplyDiagnostic.start(input), {
            sessionToken: token, startedAtEpochMs: epoch, stopAtEpochMs: epoch + 53_000, scenario,
        });
        token = undefined;
        report.stage = 'conversation';
        const snapshot = () => page.evaluate(() => window.__evanShortReplyDiagnostic.snapshot());
        async function waitForQuiet(afterEos, name) {
            if (aborted) throw new Error('Diagnostic ended.');
            await page.waitForFunction(previous => {
                const state = window.__evanShortReplyDiagnostic.snapshot();
                return state.stopped || state.stopRequested || state.readyForInput && state.personaEos > previous;
            }, afterEos, { timeout: Math.max(1, Math.min(20_000, epoch + 52_000 - Date.now())) });
            // Text completion can precede playout. Require 2.5s of advancing
            // inbound audio samples with no appreciable energy, sampled ~250ms.
            const samples = [];
            let previous;
            let quietSince;
            while (!aborted && elapsed() < 52_000) {
                const state = await snapshot();
                if (state.stopped || state.stopRequested) throw new Error('Session stopped before quiet audio.');
                const stats = await page.evaluate(() => window.__evanShortReplyDiagnostic.audioStats());
                if (!stats.length || stats.some(item => !Number.isFinite(item.totalAudioEnergy)
                    || !Number.isFinite(item.totalSamplesDuration))) throw new Error('Inbound audio energy evidence unavailable.');
                const sample = { elapsedMs: elapsed(), energy: stats.reduce((sum, item) => sum + item.totalAudioEnergy, 0),
                    duration: stats.reduce((sum, item) => sum + item.totalSamplesDuration, 0) };
                const quietAudio = previous && sample.duration > previous.duration
                    && sample.energy >= previous.energy && sample.energy - previous.energy <= 1e-8;
                if (quietAudio && state.readyForInput) quietSince ??= previous.elapsedMs;
                else quietSince = undefined;
                samples.push(sample); if (samples.length > 16) samples.shift();
                if (quietSince !== undefined && sample.elapsedMs - quietSince >= 2_500) {
                    report.audioQuietChecks.push({ name, quietMs: sample.elapsedMs - quietSince, samples });
                    report.checkpoints.push({ name, elapsedMs: state.elapsedMs, personaEos: state.personaEos, quietForMs: state.quietForMs });
                    return state;
                }
                previous = sample; await sleep(250);
            }
            report.audioQuietChecks.push({ name, incomplete: true, samples });
            throw new Error('No bounded quiet audio window.');
        }
        let state = await waitForQuiet(0, 'greeting_completed_and_quiet');
        for (let index = 0; index < 3; index++) {
            if (index === 2 && epoch + 53_000 - Date.now() < 15_000) break;
            if (aborted || state.stopped) break;
            const baseline = state.personaEos;
            await page.evaluate(value => window.__evanShortReplyDiagnostic.send(value), index);
            state = await waitForQuiet(baseline, `fixture_${index + 1}_reply_and_quiet`);
            if (scenario === 'interrupted' && index === 0 && !state.intentionalInterruption.confirmed) {
                report.interruptionProbe = 'inconclusive_no_confirmed_interrupted_end';
                throw new Error('Deliberate interruption was not confirmed.');
            }
            if (scenario === 'interrupted' && index === 0) report.interruptionProbe = 'confirmed_then_quiet';
        }
        report.result = report.checkpoints.length >= 3 ? 'responses_observed_requires_review' : 'incomplete';
    };
    await Promise.race([flow(), deadline]);
} catch {
    // Never print provider bodies, SDK exceptions, URLs, cookies, or credentials.
    if (report.result !== 'interrupted' && report.result !== '55_second_outer_limit') report.result = 'incomplete';
    report.failure = report.engineStartAttempted
        ? 'Bounded flow did not complete; inspect recorded events without assuming a model failure.'
        : 'Setup/token verification failed before engine start; review configuration without printing credentials.';
} finally {
    await cleanup();
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = elapsed();
    report.withinClientBudget = !epoch || report.browserExitConfirmed && report.browserClosedAtMs <= MAX_SESSION_MS;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    if (reservationId) await ledgerUpdate(ledger => {
        const attempt = ledger.attempts.find(item => item.id === reservationId);
        if (!attempt) throw new Error('Reserved diagnostic attempt missing.');
        Object.assign(attempt, { status: 'finished', result: report.result, finishedAt: report.finishedAt,
            engineStartAttempted: report.engineStartAttempted, sessionId: report.session?.sessionId || null,
            report: path.basename(reportPath), withinClientBudget: report.withinClientBudget });
    });
}
console.log(JSON.stringify({ result: report.result, report: reportPath, personaId: PERSONA_ID,
    sessionId: report.session?.sessionId || null, withinClientBudget: report.withinClientBudget,
    engineStartAttempted: report.engineStartAttempted, browserErrors: report.browserErrors }, null, 2));
if (report.result !== 'responses_observed_requires_review' || !report.withinClientBudget) process.exitCode = 1;
