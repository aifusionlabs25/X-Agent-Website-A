import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
const handler = player.slice(player.indexOf("'end_mullins_session',"), player.indexOf("'send_mullins_follow_up_email',"));

test('Evan close tool validates a fresh completed visitor intent before arming or mutating session closure', () => {
    assert.match(handler, /isEvanAuthorizedCloseCandidate\(/);
    assert.match(handler, /evanLatestCompletedUserId/);
    assert.match(handler, /evanUserTurnGeneration, pendingUserText, closeCheckAt, toolCorrelation/);
    assert.match(handler, /if \(!authorizedClose\)/);
    assert.doesNotMatch(handler, /stableExplicitClose/);
    assert.ok(handler.indexOf("status: 'continue_conversation'") < handler.indexOf("requestedCloseReason = 'user_requested_end'"));
    assert.doesNotMatch(handler, /evanSessionAbort.abort\(|evanResponseRecovery\?\.close\(|evanPlannerAutoOpen\?\.dispose\(/);
    assert.match(handler, /userActionCorrelationId/);
    assert.match(handler, /intentRecognized:/);
    assert.match(handler, /candidateCurrent:/);
    assert.match(handler, /candidateWithinWindow:/);
    assert.match(handler, /correlationMatched:/);
    assert.match(handler, /contentLogged: false/);
});

test('a refused close stops after an existing reply instead of driving another question or wrap-up', () => {
    assert.match(handler, /const alreadyResponded = transcriptRef\.current\.at\(-1\)\?\.role === 'agent'/);
    assert.match(handler, /allowSilenceRecovery: !alreadyResponded/);
    assert.match(handler, /: alreadyResponded\s*\? 'This close request is not authorized\. You have already spoken/);
    assert.match(handler, /Stop speaking now and listen for the visitor/);
    assert.match(handler, /Do not use a generic wrap-up question during discovery/);
    assert.doesNotMatch(handler, /ask whether they have anything else to add/);
});

test('only actual user transcript cancels an armed farewell; VAD echo does not', () => {
    const speech = player.slice(player.indexOf('const handleEvanSpeechStarted'), player.indexOf('const handleEvanToolStarted'));
    assert.match(speech, /if \(!evanCloseCoordinator\?\.isArmed\(\)\) cancelEvanPendingClose\(\)/);
    const stream = player.slice(player.indexOf('const handleMessageStream'), player.indexOf('const deliverAmyUnsafeOutputRecovery'));
    assert.match(stream, /if \(isEvan\)/);
    assert.match(stream, /messageEvent.role === 'user'/);
    assert.match(stream, /cancelEvanPendingClose\(\)/);
    assert.match(player, /if \(requestedCloseReason === 'user_requested_end'\) requestedCloseReason = null/);
});

test('an accepted farewell has a bounded UI exit if provider disconnect never arrives', () => {
    const close = player.slice(player.indexOf('evanCloseCoordinator = createEvanFarewellCloseCoordinator'), player.indexOf('if (isDani)', player.indexOf('evanCloseCoordinator = createEvanFarewellCloseCoordinator')));
    assert.match(close, /requestedCloseFallbackTimer = window\.setTimeout/);
    assert.match(close, /completeOnce\('user_requested_end'\)/);
    assert.match(close, /onCloseRef\.current\?\.\(\)/);
    assert.match(close, /return anamClient\.stopStreaming\(\)/);
    const connectionClosed = player.slice(player.indexOf('const handleConnectionClosed'), player.indexOf('// Push any trailing un-ended speech chunks', player.indexOf('const handleConnectionClosed')));
    assert.match(connectionClosed, /waitForAmyAnamCompletionUiWindow\(completion\)/);
});

test('run-nineteen explicit visitor close has a tool-free fallback without changing Amy or Dani', () => {
    assert.match(player, /evanExplicitCloseFallback = createEvanExplicitCloseFallback\(/);
    assert.match(player, /isEvanAuthorizedCloseCandidate\(evanCloseCandidate, evanLatestCompletedUserId/);
    assert.match(handler, /evanExplicitCloseFallback\?\.cancel\(\);\s*requestedCloseReason = 'user_requested_end'/);
    const toolStarted = player.slice(player.indexOf('const handleEvanToolStarted'), player.indexOf('const handleEvanToolFinished'));
    assert.doesNotMatch(toolStarted, /evanExplicitCloseFallback\?\.cancel\(\)/);
    assert.match(player, /if \(hasEvanCloseIntent\(turn\.content, previousAgentText\) \|\| trailingFragmentOfClose\)/);
    assert.match(player, /evanResponseRecovery\?\.agentResponseObserved\(currentPersonaTurn\)/);
    const evanOnly = player.slice(player.indexOf('if (isEvan) {\n                    evanRefusedCloseRecovery'), player.indexOf('if (isDani)', player.indexOf('if (isEvan) {\n                    evanRefusedCloseRecovery')));
    assert.match(evanOnly, /createEvanExplicitCloseFallback/);
});

test('only post-arm uninterrupted Evan farewell text can complete closure, including same-message continuation', () => {
    assert.match(player, /evanCloseBaselineMessage\?\.id === messageEvent.id/);
    assert.match(player, /evanPersonaMessage.text.slice\(evanCloseBaselineMessage.length\)/);
    assert.match(player, /completeFarewell\(farewellText, evanPersonaMessage.interrupted\)/);
    assert.doesNotMatch(player, /evanCloseCoordinator\?\.completeFarewell\(\)/);
    assert.match(player, /daniCloseCoordinator\?\.completeFarewell\(\)/);
    assert.match(player, /if \(!amyFarewellRecovery\) amyCloseCoordinator\?\.completeFarewell\(\)/);
});
