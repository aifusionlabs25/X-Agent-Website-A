import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTypeScriptModule(relativePath, replacements = new Map()) {
    const fileUrl = new URL(`../${relativePath}`, import.meta.url);
    const source = await readFile(fileUrl, 'utf8');
    let output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: fileUrl.pathname,
    }).outputText;

    for (const [specifier, replacement] of replacements) {
        output = output
            .replaceAll(`'${specifier}'`, `'${replacement}'`)
            .replaceAll(`"${specifier}"`, `"${replacement}"`);
    }

    const moduleUrl = `data:text/javascript;base64,${Buffer.from(output, 'utf8').toString('base64')}`;
    return { moduleUrl, exports: await import(moduleUrl) };
}

const sessionConfigModule = await loadTypeScriptModule('lib/anam/session-config.ts');
const sessionSpineModule = await loadTypeScriptModule(
    'lib/anam/session-spine.ts',
    new Map([
        ['@/lib/anam/session-config', sessionConfigModule.moduleUrl],
        ['./session-config.ts', sessionConfigModule.moduleUrl],
    ]),
);
const sessionApiModule = await loadTypeScriptModule(
    'lib/anam/session-api.ts',
    new Map([
        ['@/lib/anam/session-spine', sessionSpineModule.moduleUrl],
        ['./session-spine.ts', sessionSpineModule.moduleUrl],
    ]),
);
const sessionClientModule = await loadTypeScriptModule('lib/anam/session-spine-client.ts');

const {
    AMY_ANAM_BROWSER_COOKIE,
    AMY_ANAM_BROWSER_TTL_SECONDS,
    amyAnamCookieOptions,
    buildAmyAnamReceipt,
    createAmyAnamBrowserSessionWithSecret,
    createAmyAnamLaunch,
    normalizeAmyTranscript,
    publicAmyAnamReceipt,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
} = sessionSpineModule.exports;
const { fetchAnamSessionMetadata, fetchCompletedAnamTranscript } = sessionApiModule.exports;
const { completeAmyAnamClientSession } = sessionClientModule.exports;

const SECRET = 'phase-1-test-signing-secret-with-more-than-32-characters';
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const PERSONA_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LAUNCH_ID = '99999999-8888-4777-8666-555555555555';

function requestWithBrowserCookie(token) {
    return new Request('https://xagent.example.test/api/anam/session/complete', {
        headers: {
            cookie: `${AMY_ANAM_BROWSER_COOKIE}=${encodeURIComponent(token)}`,
        },
    });
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

test('Amy Anam browser ownership cookie verifies, rejects tampering, and expires exactly on time', () => {
    const now = 1_900_000_000_000;
    const { session, token } = createAmyAnamBrowserSessionWithSecret(SECRET, now);

    assert.equal(session.expiresAt - session.createdAt, AMY_ANAM_BROWSER_TTL_SECONDS * 1000);
    assert.deepEqual(
        readAmyAnamBrowserSession(requestWithBrowserCookie(token), SECRET, now + 1),
        session,
    );

    const [encoded, signature] = token.split('.');
    const changedLastCharacter = signature.endsWith('a') ? 'b' : 'a';
    const tampered = `${encoded}.${signature.slice(0, -1)}${changedLastCharacter}`;
    assert.equal(readAmyAnamBrowserSession(requestWithBrowserCookie(tampered), SECRET, now + 1), null);
    assert.equal(readAmyAnamBrowserSession(requestWithBrowserCookie(`${token}.extra`), SECRET, now + 1), null);
    assert.equal(readAmyAnamBrowserSession(requestWithBrowserCookie(token), `${SECRET}-wrong`, now + 1), null);
    assert.equal(readAmyAnamBrowserSession(requestWithBrowserCookie(token), SECRET, session.expiresAt), null);
    assert.throws(
        () => createAmyAnamBrowserSessionWithSecret('too-short', now),
        /signing is not configured/i,
    );

    const cookieOptions = amyAnamCookieOptions();
    assert.equal(cookieOptions.httpOnly, true);
    assert.equal(cookieOptions.sameSite, 'lax');
    assert.equal(cookieOptions.path, '/');
    assert.equal(cookieOptions.priority, 'high');
});

test('Amy Redis configuration strips byte-order artifacts and escaped line endings', () => {
    const common = {
        AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
        AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_SESSION_SECRET: 's'.repeat(32),
        AMY_ANAM_REDIS_REST_TOKEN: 'preview-token\\r\\n',
    };

    for (const prefix of [
        '\uFEFF',
        '\u00EF\u00BB\u00BF',
        '\u00C3\u00AF\u00C2\u00BB\u00C2\u00BF',
    ]) {
        const config = readAmyAnamSpineConfig({
            ...common,
            AMY_ANAM_REDIS_REST_URL: `${prefix}https://example.upstash.io/\\r\\n`,
        });
        assert.equal(config.gatesOpen, true);
        assert.equal(config.redisUrl, 'https://example.upstash.io');
        assert.equal(config.redisToken, 'preview-token');
    }
});

test('Anam transcript messages normalize to the shared Amy turn contract and receipts remain inert', () => {
    const turns = normalizeAmyTranscript([
        { role: 'persona', message: '  Hello   Rob.\nHow can I help?  ' },
        { role: 'user', message: '  I need   a roadmap. ' },
        { role: 'user', content: 'Content fallback works.' },
        { role: 'user', message: '   ' },
        null,
    ]);

    assert.deepEqual(turns, [
        { role: 'agent', content: 'Hello Rob. How can I help?' },
        { role: 'user', content: 'I need a roadmap.' },
        { role: 'user', content: 'Content fallback works.' },
    ]);

    const receipt = buildAmyAnamReceipt({
        externalSessionId: SESSION_ID,
        closeReason: 'CONNECTION_CLOSED_CODE_NORMAL',
        source: 'anam_api',
        turns,
        now: 1_900_000_000_000,
    });
    assert.deepEqual(receipt.actions, {
        hermes: false,
        memory: false,
        email: false,
        sheets: false,
    });
    assert.equal(receipt.transcript.rawTranscriptPersisted, false);
    assert.match(receipt.transcript.contentSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(publicAmyAnamReceipt(receipt), {
        canary: true,
        receiptId: receipt.receiptId,
        status: 'completed',
        transcriptSource: 'anam_api',
        messageCount: 3,
        rawTranscriptPersisted: false,
        outbound: false,
        hermes: false,
        memory: false,
    });
});

test('authoritative transcript polling waits for session completion and normalizes the Anam API payload', async () => {
    const launch = createAmyAnamLaunch('browser-session-test', PERSONA_ID, 1_900_000_000_000);
    const completedAt = '2030-03-17T17:47:10.000Z';
    const responses = [
        jsonResponse({
            id: SESSION_ID,
            personaId: PERSONA_ID,
            clientLabel: launch.clientLabel,
            startTime: launch.createdAt,
            endTime: null,
            exitStatus: null,
            personaConfig: { zeroDataRetention: false },
        }),
        jsonResponse({
            id: SESSION_ID,
            personaId: PERSONA_ID,
            clientLabel: launch.clientLabel,
            startTime: launch.createdAt,
            endTime: completedAt,
            exitStatus: 'completed',
            personaConfig: { zeroDataRetention: false },
        }),
        jsonResponse({
            sessionId: SESSION_ID,
            endTime: completedAt,
            transcriptsEnabled: true,
            totalMessages: 2,
            messages: [
                { role: 'persona', message: 'Welcome to Amy.' },
                { role: 'user', message: 'Please prepare a roadmap.' },
            ],
        }),
    ];
    const calls = [];
    const sleeps = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), init });
        const response = responses.shift();
        assert.ok(response, `Unexpected fetch: ${url}`);
        return response;
    };

    const result = await fetchCompletedAnamTranscript(SESSION_ID, launch, {
        env: { ANAM_API_KEY: 'server-only-test-key' },
        fetchImpl,
        pollDelaysMs: [0, 25],
        sleep: async milliseconds => { sleeps.push(milliseconds); },
    });

    assert.equal(result.status, 'ready');
    assert.deepEqual(result.turns, [
        { role: 'agent', content: 'Welcome to Amy.' },
        { role: 'user', content: 'Please prepare a roadmap.' },
    ]);
    assert.deepEqual(sleeps, [0, 25]);
    assert.equal(calls.length, 3);
    assert.match(calls[0].url, new RegExp(`/sessions/${SESSION_ID}$`));
    assert.match(calls[2].url, new RegExp(`/sessions/${SESSION_ID}/transcript$`));
    assert.ok(calls.every(call => call.init.method === 'GET'));
    assert.ok(calls.every(call => call.init.headers.Authorization === 'Bearer server-only-test-key'));
    assert.ok(calls.every(call => call.init.body === undefined));
});

test('Cara 4 session metadata accepts the nested persona ID when the top-level field is empty', async () => {
    const metadata = await fetchAnamSessionMetadata(SESSION_ID, {
        env: { ANAM_API_KEY: 'server-only-test-key' },
        fetchImpl: async () => jsonResponse({
            id: SESSION_ID,
            personaId: null,
            clientLabel: 'xagent-amy:test-launch',
            startTime: '2030-03-17T17:46:40.000Z',
            endTime: null,
            exitStatus: null,
            personaConfig: {
                personaId: PERSONA_ID,
                zeroDataRetention: false,
            },
        }),
    });

    assert.equal(metadata.personaId, PERSONA_ID);
    assert.equal(metadata.personaConfig.personaId, PERSONA_ID);
});

test('session metadata rejects conflicting top-level and nested persona IDs', async () => {
    await assert.rejects(
        fetchAnamSessionMetadata(SESSION_ID, {
            env: { ANAM_API_KEY: 'server-only-test-key' },
            fetchImpl: async () => jsonResponse({
                id: SESSION_ID,
                personaId: PERSONA_ID,
                clientLabel: 'xagent-amy:test-launch',
                personaConfig: {
                    personaId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
                    zeroDataRetention: false,
                },
            }),
        }),
        /persona identities conflicted/,
    );
});

test('closed session metadata remains pending while the transcript end time is null', async () => {
    const launch = createAmyAnamLaunch('browser-session-transcript-pending', PERSONA_ID, 1_900_000_000_000);
    const responses = [
        jsonResponse({
            id: SESSION_ID,
            personaId: PERSONA_ID,
            clientLabel: launch.clientLabel,
            startTime: launch.createdAt,
            endTime: '2030-03-17T17:47:10.000Z',
            exitStatus: 'completed',
            personaConfig: { zeroDataRetention: false },
        }),
        jsonResponse({
            sessionId: SESSION_ID,
            endTime: null,
            transcriptsEnabled: true,
            totalMessages: 1,
            messages: [
                { role: 'persona', message: 'This transcript is still being finalized.' },
            ],
        }),
    ];
    let fetchCount = 0;

    const result = await fetchCompletedAnamTranscript(SESSION_ID, launch, {
        env: { ANAM_API_KEY: 'server-only-test-key' },
        pollDelaysMs: [0],
        sleep: async () => undefined,
        fetchImpl: async url => {
            fetchCount += 1;
            const response = responses.shift();
            assert.ok(response, `Unexpected fetch: ${url}`);
            return response;
        },
    });

    assert.deepEqual(result, { status: 'pending' });
    assert.equal(fetchCount, 2);
});

test('zero-data-retention sessions terminate polling without requesting a transcript', async () => {
    const launch = createAmyAnamLaunch('browser-session-zdr', PERSONA_ID, 1_900_000_000_000);
    let fetchCount = 0;
    const result = await fetchCompletedAnamTranscript(SESSION_ID, launch, {
        env: { ANAM_API_KEY: 'server-only-test-key' },
        pollDelaysMs: [0],
        sleep: async () => undefined,
        fetchImpl: async () => {
            fetchCount += 1;
            return jsonResponse({
                id: SESSION_ID,
                personaId: PERSONA_ID,
                clientLabel: launch.clientLabel,
                startTime: launch.createdAt,
                endTime: '2030-03-17T17:47:10.000Z',
                exitStatus: 'completed',
                personaConfig: { zeroDataRetention: true },
            });
        },
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'zero_data_retention');
    assert.equal(fetchCount, 1);
});

test('an active zero-data-retention session remains pending until provider closure', async () => {
    const launch = createAmyAnamLaunch('browser-session-active-zdr', PERSONA_ID, 1_900_000_000_000);
    let fetchCount = 0;
    const result = await fetchCompletedAnamTranscript(SESSION_ID, launch, {
        env: { ANAM_API_KEY: 'server-only-test-key' },
        pollDelaysMs: [0],
        sleep: async () => undefined,
        fetchImpl: async () => {
            fetchCount += 1;
            return jsonResponse({
                id: SESSION_ID,
                personaId: PERSONA_ID,
                clientLabel: launch.clientLabel,
                startTime: launch.createdAt,
                endTime: null,
                exitStatus: null,
                personaConfig: { zeroDataRetention: true },
            });
        },
    });

    assert.deepEqual(result, { status: 'pending' });
    assert.equal(fetchCount, 1);
});

test('a partial transcript count mismatch remains pending after polling is exhausted', async () => {
    const launch = createAmyAnamLaunch('browser-session-partial-transcript', PERSONA_ID, 1_900_000_000_000);
    const completedAt = '2030-03-17T17:47:10.000Z';
    const responses = [
        jsonResponse({
            id: SESSION_ID,
            personaId: PERSONA_ID,
            clientLabel: launch.clientLabel,
            startTime: launch.createdAt,
            endTime: completedAt,
            exitStatus: 'completed',
            personaConfig: { zeroDataRetention: false },
        }),
        jsonResponse({
            sessionId: SESSION_ID,
            endTime: completedAt,
            transcriptsEnabled: true,
            totalMessages: 2,
            messages: [
                { role: 'persona', message: 'Only one of two expected messages is present.' },
            ],
        }),
    ];
    let fetchCount = 0;

    const result = await fetchCompletedAnamTranscript(SESSION_ID, launch, {
        env: { ANAM_API_KEY: 'server-only-test-key' },
        pollDelaysMs: [0],
        sleep: async () => undefined,
        fetchImpl: async url => {
            fetchCount += 1;
            const response = responses.shift();
            assert.ok(response, `Unexpected fetch: ${url}`);
            return response;
        },
    });

    assert.deepEqual(result, { status: 'pending' });
    assert.equal(fetchCount, 2);
});

test('transcript polling recovers when a partial response is followed by the complete transcript', async () => {
    const launch = createAmyAnamLaunch('browser-session-transcript-recovery', PERSONA_ID, 1_900_000_000_000);
    const completedAt = '2030-03-17T17:47:10.000Z';
    const closedMetadata = {
        id: SESSION_ID,
        personaId: PERSONA_ID,
        clientLabel: launch.clientLabel,
        startTime: launch.createdAt,
        endTime: completedAt,
        exitStatus: 'completed',
        personaConfig: { zeroDataRetention: false },
    };
    const responses = [
        jsonResponse(closedMetadata),
        jsonResponse({
            sessionId: SESSION_ID,
            endTime: completedAt,
            transcriptsEnabled: true,
            totalMessages: 2,
            messages: [
                { role: 'persona', message: 'The second turn is not available yet.' },
            ],
        }),
        jsonResponse(closedMetadata),
        jsonResponse({
            sessionId: SESSION_ID,
            endTime: completedAt,
            transcriptsEnabled: true,
            totalMessages: 2,
            messages: [
                { role: 'persona', message: 'The transcript is now complete.' },
                { role: 'user', message: 'Both turns are available.' },
            ],
        }),
    ];
    const sleeps = [];
    let fetchCount = 0;

    const result = await fetchCompletedAnamTranscript(SESSION_ID, launch, {
        env: { ANAM_API_KEY: 'server-only-test-key' },
        pollDelaysMs: [0, 50],
        sleep: async milliseconds => { sleeps.push(milliseconds); },
        fetchImpl: async url => {
            fetchCount += 1;
            const response = responses.shift();
            assert.ok(response, `Unexpected fetch: ${url}`);
            return response;
        },
    });

    assert.equal(result.status, 'ready');
    assert.deepEqual(result.turns, [
        { role: 'agent', content: 'The transcript is now complete.' },
        { role: 'user', content: 'Both turns are available.' },
    ]);
    assert.deepEqual(sleeps, [0, 50]);
    assert.equal(fetchCount, 4);
});

test('client completion sends only session identifiers and reason with keepalive enabled', async () => {
    const calls = [];
    const result = await completeAmyAnamClientSession({
        launchId: LAUNCH_ID,
        sessionId: SESSION_ID,
        closeReason: 'pagehide',
        maxAttempts: 1,
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return jsonResponse({
                accepted: true,
                status: 'completed',
                receiptId: 'receipt-test-123',
            });
        },
    });

    assert.deepEqual(result, {
        accepted: true,
        status: 'completed',
        receiptId: 'receipt-test-123',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/anam/session/complete');
    assert.equal(calls[0].init.keepalive, true);
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(calls[0].init.cache, 'no-store');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
        launchId: LAUNCH_ID,
        sessionId: SESSION_ID,
        closeReason: 'pagehide',
    });
    assert.equal(Object.hasOwn(body, 'transcript'), false);
    assert.equal(JSON.stringify(body).includes('server-only-test-key'), false);
});

test('client completion retries an awaiting transcript without expanding its request body', async () => {
    const bodies = [];
    const sleeps = [];
    let attempt = 0;
    const result = await completeAmyAnamClientSession({
        launchId: LAUNCH_ID,
        sessionId: SESSION_ID,
        closeReason: 'CONNECTION_CLOSED_CODE_NORMAL',
        maxAttempts: 2,
        sleep: async milliseconds => { sleeps.push(milliseconds); },
        fetchImpl: async (_url, init) => {
            bodies.push(JSON.parse(init.body));
            attempt += 1;
            return attempt === 1
                ? jsonResponse({ accepted: true, status: 'awaiting_transcript', retryAfterMs: 10 }, 202)
                : jsonResponse({ accepted: true, status: 'completed', receiptId: 'receipt-final' });
        },
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.receiptId, 'receipt-final');
    assert.deepEqual(sleeps, [250]);
    assert.equal(bodies.length, 2);
    assert.ok(bodies.every(body => Object.hasOwn(body, 'transcript') === false));
    assert.ok(bodies.every(body => Object.keys(body).sort().join(',') === 'closeReason,launchId,sessionId'));
});
