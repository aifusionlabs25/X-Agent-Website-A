import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceFiles = [
    '../app/api/anam/amy/readiness/route.ts',
    '../app/api/anam/hermes/worker/route.ts',
    '../app/api/anam/session/bind/route.ts',
    '../app/api/anam/session/complete/route.ts',
    '../app/api/anam/session/email/route.ts',
    '../app/api/anam/session/recover/route.ts',
    '../app/api/anam/session/status/route.ts',
    '../lib/anam/capability-readiness.ts',
    '../lib/anam/hermes-shadow-store.ts',
    '../lib/anam/hermes-shadow.ts',
    '../lib/anam/hermes-worker-bridge.ts',
    '../lib/anam/session-api.ts',
    '../lib/anam/session-finalizer.ts',
    '../lib/anam/session-recovery.ts',
    '../lib/anam/session-spine-client.ts',
    '../lib/anam/session-spine-store.ts',
    '../lib/anam/session-spine.ts',
    '../scripts/hermes/amy-anam-shadow-runtime.py',
    '../scripts/hermes/amy-anam-shadow-worker.mjs',
];

const sources = new Map(await Promise.all(sourceFiles.map(async relativePath => [
    relativePath,
    await readFile(new URL(relativePath, import.meta.url), 'utf8'),
])));
const completionRoute = sources.get('../app/api/anam/session/complete/route.ts');
const bindRoute = sources.get('../app/api/anam/session/bind/route.ts');
const emailRoute = sources.get('../app/api/anam/session/email/route.ts');
const statusRoute = sources.get('../app/api/anam/session/status/route.ts');
const clientSpine = sources.get('../lib/anam/session-spine-client.ts');
const finalizer = sources.get('../lib/anam/session-finalizer.ts');
const sessionStore = sources.get('../lib/anam/session-spine-store.ts');
const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
const qaHook = await readFile(new URL('../hooks/useAnamQaSession.ts', import.meta.url), 'utf8');

test('session-spine and Hermes shadow files keep outbound automation isolated to finalization', () => {
    const forbiddenImport = /(?:from|import\()\s*['"][^'"]*(?:openai-service|google-sheets|resend|agentmail)[^'"]*['"]/i;
    const forbiddenInvocation = /\b(?:new\s+Resend|emails\.send|appendLead|analyzeTranscript|runAmyPostSessionAnalysis)\b/i;

    for (const [relativePath, source] of sources) {
        if (
            relativePath !== '../lib/anam/session-finalizer.ts'
            && relativePath !== '../app/api/anam/session/bind/route.ts'
            && relativePath !== '../app/api/anam/session/email/route.ts'
        ) {
            assert.doesNotMatch(source, forbiddenImport, `${relativePath} imported an outbound service`);
        }
        assert.doesNotMatch(source, forbiddenInvocation, `${relativePath} invoked an outbound service`);
    }
    assert.match(bindRoute, /queueEvanAnamConversationFollowUp/);
    assert.doesNotMatch(bindRoute, /sendEvanAnamConversationFollowUp|dispatchEvanAnamPostSessionFollowUp|sendAmyEmailWithAgentMail|messages\/send/);
});

test('shared session routes rate-limit an opaque request fingerprint before untrusted Redis lookups', () => {
    const boundaries = [
        [bindRoute, "requestFingerprint(request, 'bind-preauth')", 'const launch = await readAmyAnamLaunch'],
        [completionRoute, "requestFingerprint(request, 'complete-preauth')", 'const launch = await readAmyAnamLaunch'],
        [emailRoute, "requestFingerprint(request, 'agentmail-preauth')", 'const [launch, session] = await Promise.all'],
        [statusRoute, "requestFingerprint(request, 'status-preauth')", 'const [session, finalization] = await Promise.all'],
    ];

    for (const [source, limiterMarker, firstUntrustedLookup] of boundaries) {
        const limiterIndex = source.indexOf(limiterMarker);
        const lookupIndex = source.indexOf(firstUntrustedLookup);
        assert.ok(limiterIndex >= 0, `${limiterMarker} was missing`);
        assert.ok(lookupIndex > limiterIndex, `${firstUntrustedLookup} occurred before pre-auth limiting`);
    }
});

test('the completion route rejects client transcript fields and returns explicit canary no-outbound receipts', () => {
    assert.match(
        completionRoute,
        /new Set\(\[\s*'launchId',\s*'sessionId',\s*'closeReason'\s*\]\)/s,
    );
    assert.match(completionRoute, /Completion request contains unsupported fields/);
    assert.match(completionRoute, /finalizeAmyAnamSession\(sessionId\)/);
    assert.match(completionRoute, /canary:\s*true/);
    assert.match(completionRoute, /outbound:\s*false/);
    assert.doesNotMatch(completionRoute, /body\.transcript|transcript:\s*body\./);
    assert.match(completionRoute, /export const maxDuration = 240/);
    assert.match(completionRoute, /POST_CLOSE_RETRY_DELAYS_MS = \[0, 5_000, 15_000, 30_000, 60_000\]/);
    assert.match(completionRoute, /await finalizeAfterClose\(sessionId\)/);
    assert.match(completionRoute, /sessionRef:\s*sessionId\.slice\(-8\)/);
});

test('the client completion transport is keepalive-safe and never includes a transcript', () => {
    assert.match(clientSpine, /fetchImpl\('\/api\/anam\/session\/complete'/);
    assert.match(clientSpine, /body:\s*JSON\.stringify\(\{\s*launchId,\s*sessionId,\s*closeReason\s*\}\)/s);
    assert.match(clientSpine, /keepalive:\s*true/);
    assert.doesNotMatch(clientSpine, /JSON\.stringify\([^)]*transcript/s);
});

test('completion is durably verification-pending before provider verification begins', () => {
    const recordCall = completionRoute.indexOf('recordAmyAnamCompletion({');
    const finalizerCall = completionRoute.indexOf('await finalizeAfterClose(sessionId)');
    assert.ok(recordCall >= 0, 'completion was not durably recorded');
    assert.ok(finalizerCall > recordCall, 'provider finalization started before durable completion recording');
    assert.doesNotMatch(completionRoute, /verifyAnamSessionForLaunch|fetchCompletedAnamTranscript/);

    const recordFunctionStart = sessionStore.indexOf('export async function recordAmyAnamCompletion');
    const recordFunctionEnd = sessionStore.indexOf('export async function markAmyAnamVerificationPending');
    const recordFunction = sessionStore.slice(recordFunctionStart, recordFunctionEnd);
    assert.match(recordFunction, /state:\s*'verification_pending'/);
    assert.match(recordFunction, /redis\.call\('SET', KEYS\[3\], ARGV\[6\]/);

    const readPendingState = finalizer.indexOf('readAmyAnamFinalization(externalSessionId)');
    const providerVerification = finalizer.indexOf('verifyAnamSessionForLaunch(externalSessionId, launch');
    assert.ok(readPendingState >= 0, 'finalizer did not read durable finalization state');
    assert.ok(providerVerification > readPendingState, 'provider verification preceded durable state recovery');
});

test('AnamPlayer binds SESSION_READY before streaming and keeps legacy transcript upload outside the spine', () => {
    const readyListener = player.indexOf('AnamEvent.SESSION_READY, handleSessionReady');
    const streamStart = player.indexOf("streamToVideoElement('persona-video')");
    assert.ok(readyListener >= 0, 'SESSION_READY listener was not registered');
    assert.ok(streamStart > readyListener, 'SESSION_READY listener must be registered before streaming');
    assert.match(player, /removeListener\(AnamEvent\.SESSION_READY, handleSessionReady\)/);
    assert.match(player, /completeAmyAnamClientSession\(\{\s*launchId:[\s\S]*sessionId:[\s\S]*closeReason/s);
    assert.match(
        player,
        /if \(!sessionSpineActive && transcriptRef\.current\.length > 0\) \{\s*fetch\('\/api\/save-transcript'/s,
    );
});

test('both live and QA clients bind SESSION_READY and deduplicate completion', () => {
    const liveReadyListener = player.indexOf('AnamEvent.SESSION_READY, handleSessionReady');
    const liveStreamStart = player.indexOf("streamToVideoElement('persona-video')");
    assert.ok(liveReadyListener >= 0 && liveStreamStart > liveReadyListener);
    assert.match(player, /bindAmyAnamClientSession\(\{/);
    assert.match(player, /completeAmyAnamClientSession\(\{/);
    assert.match(player, /if \(completionPromise\) return completionPromise/);

    const qaReadyListener = qaHook.indexOf('AnamEvent.SESSION_READY, handleSessionReady');
    const qaStreamStart = qaHook.indexOf('streamToVideoElement(videoElementId)');
    assert.ok(qaReadyListener >= 0, 'QA SESSION_READY listener was not registered');
    assert.ok(qaStreamStart > qaReadyListener, 'QA SESSION_READY listener must be registered before streaming');
    assert.match(qaHook, /bindAmyAnamClientSession\(\{/);
    assert.match(qaHook, /completeAmyAnamClientSession\(\{/);
    assert.match(qaHook, /if \(completionPromise\) return completionPromise/);
    assert.match(qaHook, /removeListener\(AnamEvent\.SESSION_READY, handleSessionReady\)/);
});

test('Evan follow-up is optional and only an opted-in contact is queued after verified binding', () => {
    const verified = bindRoute.indexOf('await verifyAnamSessionForLaunch');
    const bound = bindRoute.indexOf('await bindAmyAnamLaunch');
    const queued = bindRoute.indexOf('await queueEvanAnamConversationFollowUp');
    assert.ok(verified >= 0 && bound > verified && queued > bound);
    assert.match(bindRoute, /launch\.resolvedPersonaId === EVAN_PERSONA_ID/);
    assert.match(bindRoute, /contact\?\.displayName && contact\.purpose === 'evan_follow_up'/);
    assert.doesNotMatch(bindRoute, /Evan follow-up consent was not confirmed/);
    assert.match(bindRoute, /evanFollowUpQueued/);
    assert.match(bindRoute, /outbound:\s*false/);
});

test('email delivery occurs only after final transcript retrieval and durable session receipt', () => {
    const transcriptFetch = finalizer.indexOf('const transcript = await fetchCompletedAnamTranscript');
    const receiptWrite = finalizer.indexOf('await writeAmyAnamReceipt(session, finalization, receipt');
    const emailDispatch = finalizer.indexOf('await dispatchFollowUp({');
    assert.ok(transcriptFetch >= 0, 'final transcript was not fetched');
    assert.ok(receiptWrite > transcriptFetch, 'session receipt was written before final transcript retrieval');
    assert.ok(emailDispatch > receiptWrite, 'email was dispatched before post-session finalization');
    assert.match(finalizer, /turns:\s*transcript\.status === 'ready' \? transcript\.turns : \[\]/);
    const emailCalls = [...player.matchAll(/sendAmyAnamFollowUpEmail\(\{([\s\S]*?)\}\)/g)];
    assert.ok(emailCalls.length >= 1, 'email client was not called');
    for (const call of emailCalls) assert.doesNotMatch(call[1], /transcript:/);
});

test('Amy follow-up is authorized at check-in and queued after verified session binding', () => {
    const verified = bindRoute.indexOf('await verifyAnamSessionForLaunch');
    const bound = bindRoute.indexOf('await bindAmyAnamLaunch');
    const queued = bindRoute.indexOf('await queueAmyAnamConversationFollowUp');
    assert.ok(verified >= 0 && bound > verified && queued > bound);
    assert.match(bindRoute, /launchAgentSlug === 'amy'/);
    assert.match(bindRoute, /contact\?\.displayName && contact\.purpose === 'amy_follow_up'/);
    assert.match(bindRoute, /amyFollowUpQueued/);
    assert.match(bindRoute, /amyFollowUpDuplicate/);
    assert.match(bindRoute, /outbound:\s*false/);
});
