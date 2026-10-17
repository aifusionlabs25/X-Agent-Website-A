import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
const handler = player.slice(player.indexOf("'end_mullins_session',"), player.indexOf("'send_mullins_follow_up_email',"));

test('Evan close tool validates a fresh completed visitor intent before arming or mutating session closure', () => {
    assert.match(handler, /evanUserSpeaking \|\| !evanCloseCandidate \|\| staleTool/);
    assert.match(handler, /hasEvanCloseIntent\(evanCloseCandidate.text, evanCloseCandidate.previousAgentText\)/);
    assert.ok(handler.indexOf("status: 'continue_conversation'") < handler.indexOf("requestedCloseReason = 'user_requested_end'"));
    assert.doesNotMatch(handler, /evanSessionAbort.abort\(|evanResponseRecovery\?\.close\(|evanPlannerAutoOpen\?\.dispose\(/);
    assert.match(handler, /userActionCorrelationId/);
});

test('new speech and user transcript chunks cancel a pending farewell without permanently disabling features', () => {
    const speech = player.slice(player.indexOf('const handleEvanSpeechStarted'), player.indexOf('const handleEvanToolStarted'));
    assert.match(speech, /cancelEvanPendingClose\(\)/);
    const stream = player.slice(player.indexOf('const handleMessageStream'), player.indexOf('const deliverAmyUnsafeOutputRecovery'));
    assert.match(stream, /if \(isEvan\)/);
    assert.match(stream, /messageEvent.role === 'user'/);
    assert.match(stream, /cancelEvanPendingClose\(\)/);
    assert.match(player, /if \(requestedCloseReason === 'user_requested_end'\) requestedCloseReason = null/);
});

test('only a new, uninterrupted actual Evan farewell can complete closure; other agents retain their own path', () => {
    assert.match(player, /messageEvent.id !== evanCloseBaselineMessageId/);
    assert.match(player, /completeFarewell\(evanPersonaMessage.text, evanPersonaMessage.interrupted\)/);
    assert.doesNotMatch(player, /evanCloseCoordinator\?\.completeFarewell\(\)/);
    assert.match(player, /daniCloseCoordinator\?\.completeFarewell\(\)/);
    assert.match(player, /if \(!amyFarewellRecovery\) amyCloseCoordinator\?\.completeFarewell\(\)/);
});
