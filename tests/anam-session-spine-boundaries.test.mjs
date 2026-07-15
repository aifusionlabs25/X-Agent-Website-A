import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceFiles = [
    '../app/api/anam/amy/readiness/route.ts',
    '../app/api/anam/hermes/worker/route.ts',
    '../app/api/anam/session/bind/route.ts',
    '../app/api/anam/session/complete/route.ts',
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
const clientSpine = sources.get('../lib/anam/session-spine-client.ts');
const finalizer = sources.get('../lib/anam/session-finalizer.ts');
const sessionStore = sources.get('../lib/anam/session-spine-store.ts');
const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
const qaHook = await readFile(new URL('../hooks/useAnamQaSession.ts', import.meta.url), 'utf8');

test('session-spine and Hermes shadow files do not import or invoke outbound automation services', () => {
    const forbiddenImport = /(?:from|import\()\s*['"][^'"]*(?:openai-service|google-sheets|resend|agentmail|memory)[^'"]*['"]/i;
    const forbiddenInvocation = /\b(?:new\s+Resend|emails\.send|appendLead|analyzeTranscript|runAmyPostSessionAnalysis)\b/i;

    for (const [relativePath, source] of sources) {
        assert.doesNotMatch(source, forbiddenImport, `${relativePath} imported an outbound service`);
        assert.doesNotMatch(source, forbiddenInvocation, `${relativePath} invoked an outbound service`);
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
});

test('the client completion transport is keepalive-safe and never includes a transcript', () => {
    assert.match(clientSpine, /fetchImpl\('\/api\/anam\/session\/complete'/);
    assert.match(clientSpine, /body:\s*JSON\.stringify\(\{\s*launchId,\s*sessionId,\s*closeReason\s*\}\)/s);
    assert.match(clientSpine, /keepalive:\s*true/);
    assert.doesNotMatch(clientSpine, /JSON\.stringify\([^)]*transcript/s);
});

test('completion is durably verification-pending before provider verification begins', () => {
    const recordCall = completionRoute.indexOf('recordAmyAnamCompletion({');
    const finalizerCall = completionRoute.indexOf('finalizeAmyAnamSession(sessionId)');
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
