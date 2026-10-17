/**
 * One real, bounded Evan conversation through SDK 4.20; synthetic typed input.
 * No microphone, website binding, email delivery, persona mutation, or mock model.
 * Default is help. --check only builds locally. --run explicitly starts ONE
 * potentially billable candidate session (maximum 120 seconds plus cleanup).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';

const EVAN_ID = '6097c73e-b6ef-48c5-94c7-9a95d4863b99';
const MAX_SESSION_MS = 120_000;
const args = process.argv.slice(2);
let scenario = 'intake';
const modes = [];
let scenarioSeen = false;
for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scenario' && !scenarioSeen && ['intake', 'phone-confirmation'].includes(args[index + 1])) {
        scenario = args[++index]; scenarioSeen = true;
    } else if (['--run', '--check', '--help'].includes(arg) && !modes.includes(arg)) modes.push(arg);
    else throw new Error('Use --run or --check, optionally --scenario intake|phone-confirmation.');
}
if (modes.includes('--run') && modes.includes('--check')) throw new Error('Choose --run or --check, not both.');
if (!modes.includes('--run') && !modes.includes('--check') || modes.includes('--help')) {
    console.log('Usage: node scripts/anam/smoke-evan-conversation.mjs --check | --run [--scenario intake|phone-confirmation]');
    console.log('--check: local bundle validation only; no token or session.');
    console.log('--run: one real candidate 6097 session, synthetic typed visitor, no microphone/email, 120-second limit.');
    process.exit(0);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const output = path.join(root, 'work/evan-6097-promotion/conversation-smoke');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'config/anam/evan/persona-manifest.json'), 'utf8'));
assert.equal(manifest.personaId, EVAN_ID, 'Refusing a persona other than the pinned Evan candidate.');
await fs.mkdir(output, { recursive: true });
const { webpack } = require('next/dist/compiled/webpack/webpack');
await new Promise((resolve, reject) => {
    const compiler = webpack({
        mode: 'development', devtool: false,
        entry: fileURLToPath(new URL('./smoke-evan-conversation.entry.mjs', import.meta.url)),
        output: { path: output, filename: 'bundle.js' },
        resolve: { extensions: ['.ts', '.js', '.mjs'] },
        module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: fileURLToPath(new URL('./test-evan-planner-ui.loader.cjs', import.meta.url)) }] },
        optimization: { minimize: false }, performance: { hints: false },
    });
    compiler.run((error, stats) => compiler.close(() => {
        if (error) return reject(new Error('Conversation smoke bundle failed.'));
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        resolve();
    }));
});
if (args.includes('--check')) {
    console.log(`PASS: ${scenario} conversation smoke bundle compiled; no token or session created.`);
    process.exit(0);
}

const report = {
    personaId: EVAN_ID, scenario, startedAt: new Date().toISOString(), mode: 'real-sdk-synthetic-typed-visitor',
    limitations: ['No microphone or speech-recognition validation; video is muted, so audio pronunciation is not verified.', 'No website planner, email, session-binding, or VAD/coordinator integration validation.', 'Uses the shared close-intent guard with synthetic typed visitor turns.', 'Heuristic flags require human transcript review; one passing call is not a reliability guarantee.'],
    sentTurns: [], checkpoints: [], blockedOrigins: [], browserErrors: 0, result: 'incomplete',
};
const stamp = report.startedAt.replace(/[:.]/g, '-');
const reportPath = path.join(output, `conversation-${scenario}-${stamp}.json`);
let browser;
let page;
let server;
let apiKey;
let sessionToken;
let started = false;
let hardLimit;
let cleanupPromise;
const cleanup = () => cleanupPromise ||= (async () => {
    clearTimeout(hardLimit);
    if (page && !page.isClosed()) {
        try {
            await Promise.race([page.evaluate(() => window.__evanConversationSmoke.stop()), new Promise(resolve => setTimeout(resolve, 4_000))]);
            report.session = await page.evaluate(() => window.__evanConversationSmoke.snapshot());
        } catch { report.cleanupWarning = 'Browser stop confirmation unavailable; browser teardown follows.'; }
    }
    await browser?.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    apiKey = undefined;
    sessionToken = undefined;
})();
process.once('SIGINT', () => { report.result = 'interrupted'; void cleanup(); });
process.once('SIGTERM', () => { report.result = 'interrupted'; void cleanup(); });

try {
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><video id="evan-video" autoplay playsinline muted style="width:640px"></video><script src="/bundle.js"></script></body></html>';
    server = http.createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
        if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(output, 'bundle.js'))); return; }
        res.writeHead(404); res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
    const { chromium } = require(playwrightPath);
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
    const context = await browser.newContext({ permissions: [] });
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin || url.protocol === 'https:' && (url.hostname === 'anam.ai' || url.hostname.endsWith('.anam.ai'))) return route.continue();
        if (!report.blockedOrigins.includes(url.origin)) report.blockedOrigins.push(url.origin);
        return route.abort();
    });
    page = await context.newPage();
    // Never forward SDK console output, network headers, or error bodies: those
    // may contain session tokens. Keep only a count of browser exceptions.
    page.on('pageerror', () => { report.browserErrors += 1; });
    await page.goto(origin, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__evanConversationSmoke), null, { timeout: 5_000 });

    const envText = await fs.readFile(path.join(root, '.env.local'), 'utf8').catch(() => '');
    const keyLine = envText.split(/\r?\n/).find(line => /^\s*ANAM_API_KEY\s*=/.test(line));
    apiKey = process.env.ANAM_API_KEY?.trim() || keyLine?.slice(keyLine.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!apiKey) throw new Error('ANAM_API_KEY is missing; no session started.');
    const tokenResponse = await fetch('https://api.anam.ai/v1/auth/session-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ personaConfig: { personaId: EVAN_ID }, clientLabel: `evan-conversation-smoke-${stamp}` }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error(`Anam token request failed (HTTP ${tokenResponse.status}).`);
    const tokenPayload = await tokenResponse.json();
    sessionToken = tokenPayload.sessionToken;
    if (typeof sessionToken !== 'string' || !sessionToken) throw new Error('Anam did not return a session token.');
    const sessionDeadline = Date.now() + MAX_SESSION_MS;
    const remaining = () => Math.max(1, sessionDeadline - Date.now());
    const timeout = new Promise((_, reject) => {
        hardLimit = setTimeout(() => reject(new Error('120-second test limit reached.')), MAX_SESSION_MS);
    });
    const conversation = async () => {
        started = true;
        await page.evaluate(token => window.__evanConversationSmoke.start(token), sessionToken);
        sessionToken = undefined;
        const snapshot = () => page.evaluate(() => window.__evanConversationSmoke.snapshot());
        const waitForReply = async (afterCount, name) => {
            await page.waitForFunction(count => {
                const state = window.__evanConversationSmoke.snapshot();
                return state.messages.filter(message => message.role === 'persona' && !message.interrupted).length > count || state.stopped;
            }, afterCount, { timeout: Math.min(25_000, remaining()) });
            const state = await snapshot();
            const replies = state.messages.filter(message => message.role === 'persona' && !message.interrupted);
            if (replies.length <= afterCount) throw new Error('Session stopped before a completed persona reply.');
            report.checkpoints.push({ name, completedMs: replies.at(-1).completedMs });
            return replies.at(-1).content;
        };
        const send = async (text, name, observeQuiet = false) => {
            const before = await snapshot();
            const count = before.messages.filter(message => message.role === 'persona' && !message.interrupted).length;
            report.sentTurns.push({ name, text, elapsedMs: before.elapsedMs });
            await page.evaluate(text => window.__evanConversationSmoke.send(text), text);
            const reply = await waitForReply(count, name);
            if (!observeQuiet) return reply;
            // Observe a quiet window so a post-tool continuation (even under a
            // reused message ID) is not hidden by the next synthetic answer.
            await page.waitForFunction(() => {
                const state = window.__evanConversationSmoke.snapshot();
                return state.stopped || state.elapsedMs - state.lastPersonaEventMs >= 2_500
                    && !state.partialMessages.some(turn => turn.role === 'persona');
            }, null, { timeout: Math.min(12_000, remaining()) });
            const observed = await snapshot();
            if (observed.stopped) throw new Error('Session stopped before the synthetic visitor closed.');
            report.checkpoints.push({ name: `${name}_quiet_observation`, completedMs: observed.elapsedMs });
            return observed.messages.filter(message => message.role === 'persona' && !message.interrupted).slice(count).map(turn => turn.content).join(' ');
        };
        await waitForReply(0, 'completed_greeting');
        const reply = await send(scenario === 'phone-confirmation'
            ? 'Hi Evan, I am planning a one-bedroom move from Phoenix to Mesa in the middle of next month. I am still figuring out the details.'
            : "Hi Evan, I'm just looking. One bedroom, probably Mesa. I'm still figuring it out.", scenario === 'phone-confirmation' ? 'opening' : 'tentative_opening');
        if (/\b(?:your name|who am i (?:speaking|talking)|what (?:can|should) i call you|who (?:is|am i) speaking)\b/i.test(reply)) {
            await send('My name is Avery Example.', 'fictional_name');
        }
        if (scenario === 'phone-confirmation') {
            await send('No packing help, phone only please, no email. My number is 480-555-0198. Mornings are best.', 'phone_supplied', true);
            await send("Yes, that's right. Please have someone call in the morning. Thank you.", 'phone_confirmed', true);
            await send('Closing now.', 'farewell');
        } else {
            await send('I am moving from Phoenix, Arizona, to Mesa, Arizona. I do not have a moving date yet.', 'explicit_route_and_unknown_date');
            await send('There may be a storage stop in Gilbert, but it is only a possibility.', 'tentative_stop');
            await send('I will handle the packing myself.', 'customer_handles_packing');
            await send("That's all for now. Goodbye.", 'farewell');
        }
        await page.waitForFunction(() => window.__evanConversationSmoke.snapshot().stopped, null, { timeout: Math.min(14_000, remaining()) });
        report.session = await snapshot();
        report.result = 'completed';
    };
    await Promise.race([conversation(), timeout]);
} catch {
    // Do not echo third-party exception strings or stacks, which can contain
    // network URLs/session tokens. The safe event snapshot remains available.
    report.result = report.result === 'interrupted' ? 'interrupted' : 'incomplete';
    report.failure = started ? 'Conversation did not complete within the bounded harness flow; inspect safe transcript/checkpoints.' : 'Setup failed before streaming; inspect local setup and credentials without printing them.';
} finally {
    await cleanup();
}

const personaTurns = (report.session?.messages || []).filter(turn => turn.role === 'persona');
const flags = [];
const unknownDateTurn = report.sentTurns.find(turn => /\bI do not have a moving date yet\b/i.test(turn.text));
for (const turn of personaTurns) {
    const text = turn.content.normalize('NFKC').replace(/[\u2018\u2019]/g, "'");
    const questions = (text.match(/[^?]*\?/g) || []).map(question => question.toLowerCase().replace(/[^a-z\s]/g, '').trim());
    const routeQuestions = questions.filter(text => /\b(?:where|which|what|share|tell)\b/.test(text) && /\b(?:city|cities|moving|move)\b/.test(text) && /\bfrom\b/.test(text) && /\bto\b/.test(text));
    if (routeQuestions.length > 1 || questions.some((text, index) => text && questions.indexOf(text) !== index)) flags.push({ type: 'repeated_question_within_turn', messageId: turn.id });
    if (/\bi(?:'m| am) moving from\b/i.test(text)) flags.push({ type: 'possible_caller_role_simulation', messageId: turn.id });
    // This fixed scenario explicitly leaves the move date unknown. A new
    // move-timing question afterward is a review flag, not an ASR diagnosis or
    // a universal classifier for every use of timing language. Callback timing
    // is a different question and is excluded. Human transcript review remains
    // required even when these deliberately narrow heuristics find no issues.
    if (unknownDateTurn && turn.startedMs >= unknownDateTurn.elapsedMs && questions.some(question =>
        /\b(?:date|dates|timeframe|time frame|when|which week|what week|which day|what day|which month|what month)\b/.test(question)
        && !/\b(?:callback|call back|phone|contact|reach you)\b/.test(question))) {
        flags.push({ type: 'reasked_timing_after_explicit_unknown', messageId: turn.id });
    }
}
if (scenario === 'phone-confirmation') {
    const supplied = report.sentTurns.find(turn => turn.name === 'phone_supplied');
    const confirmed = report.sentTurns.find(turn => turn.name === 'phone_confirmed');
    const closing = report.sentTurns.find(turn => turn.name === 'farewell');
    const beforeClosing = closing?.elapsedMs ?? Infinity;
    const responseTo = (start, end) => personaTurns.filter(turn => start && turn.startedMs >= start.elapsedMs && turn.startedMs < end).map(turn => turn.content).join(' ');
    const readback = responseTo(supplied, confirmed?.elapsedMs ?? beforeClosing);
    const confirmation = responseTo(confirmed, beforeClosing);
    if (supplied) {
        const questions = readback.match(/Did I get that right\s*\?/gi) || [];
        if (questions.length !== 1) flags.push({ type: 'phone_confirmation_question_count', observed: questions.length, expected: 1 });
        const digits = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
        const spokenDigits = (readback.toLowerCase().match(/\d+|\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g) || []).map(token => digits[token] ?? token).join('');
        const numberCount = (spokenDigits.match(/4805550198/g) || []).length;
        if (numberCount !== 1) flags.push({ type: 'synthetic_phone_readback_count', observed: numberCount, expected: 1 });
        if (/just to confirm/i.test(readback) || (readback.match(/\?/g) || []).length > 1) flags.push({ type: 'possible_phone_readback_restart' });
    }
    if (confirmed && /did i get that right|just to confirm|(?:480[\s.-]*555[\s.-]*0198)/i.test(confirmation)) flags.push({ type: 'phone_reconfirmed_after_yes' });
    if (confirmed && /\b(?:someone|the team|mullins(?: moving)?(?: team)?)\s+(?:will|is going to)\s+(?:call|contact|reach)|\bi(?:'ll| will)\s+(?:have|ask)\s+(?:someone|the team)\s+(?:to\s+)?call/i.test(confirmation)) flags.push({ type: 'possible_unsupported_callback_promise' });
    const closeReceipts = (report.session?.receipts || []).filter(receipt => receipt.name === 'end_mullins_session');
    if (closeReceipts.some(receipt => receipt.elapsedMs < beforeClosing)) flags.push({ type: 'premature_close_tool_attempt' });
    if (personaTurns.some(turn => turn.startedMs < beforeClosing && /Thank you for speaking with Mullins Moving\. Take care\./i.test(turn.content))) flags.push({ type: 'premature_farewell' });
    if (closing && closeReceipts.filter(receipt => receipt.status === 'farewell_required' && receipt.elapsedMs >= closing.elapsedMs).length !== 1) flags.push({ type: 'accepted_close_receipt_count' });
    if (closing && report.session?.stopReason !== 'farewell_complete') flags.push({ type: 'farewell_close_not_confirmed' });
}
report.heuristicFlags = flags;
report.reviewStatus = report.result === 'completed' && !flags.length ? 'No targeted heuristic flags; manual review still required.' : 'Review required; not a passing live-behavior claim.';
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ result: report.result, checkpoints: report.checkpoints.length, sessionId: report.session?.sessionId || null, heuristicFlags: flags, reportPath, reviewStatus: report.reviewStatus }, null, 2));
if (report.result !== 'completed' || flags.length) process.exitCode = 1;
