import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runEvanToolWithDeadline } from '../lib/anam/evan-tool-execution.ts';
import { sendAmyAnamFollowUpEmail } from '../lib/anam/agentmail-client.ts';

const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');

test('Amy-only context injections cannot alter Evan contact or closing behavior', () => {
    for (const classifier of ['hasExplicitAmyCloseIntent', 'hasAmySoftCloseIntent', 'hasAmySpokenEmailAttempt']) {
        assert.ok(player.includes(`if (isAmyCara4 && ${classifier}(completedUserTurn))`));
        assert.ok(!player.includes(`if (${classifier}(completedUserTurn))`));
    }
});

test('Evan response recovery is wired to actual speech/tool events with symmetric cleanup', () => {
    for (const name of ['USER_SPEECH_STARTED', 'USER_SPEECH_ENDED', 'TOOL_CALL_STARTED', 'TOOL_CALL_COMPLETED', 'TOOL_CALL_FAILED']) {
        assert.ok(player.includes(`addListener(AnamEvent.${name}, handleEvan`));
        assert.ok(player.includes(`removeListener(AnamEvent.${name}, handleEvan`));
    }
    assert.match(player, /if \(fresh\) evanResponseRecovery\?\.userTurnCompleted\(turn.content, previousAgentText, turn.id\)/);
    assert.match(player, /normalizedRole === 'agent' && messageEvent.content.trim\(\)/);
    assert.ok((player.match(/evanResponseRecovery\?\.dispose\(\)/g) ?? []).length >= 2);
});

test('Evan tools have deadline, cancellation, stale-result guards, and SDK completion callbacks', () => {
    const planner = player.slice(player.indexOf("registerToolCallHandler('show_move_planner'"), player.indexOf('const memoryPolicyContext'));
    const email = player.slice(player.indexOf("'send_mullins_follow_up_email',"), player.indexOf('const handleServerWarning'));
    for (const handler of [planner, email]) {
        assert.match(handler, /runEvanToolWithDeadline/);
        assert.match(handler, /signal: evanSessionAbort.signal/);
        assert.match(handler, /signal.throwIfAborted\(\)/);
        assert.match(handler, /onComplete: async/);
        assert.match(handler, /onFail: async/);
        assert.match(handler, /retryAllowed: false/);
    }
    assert.match(planner, /routeGeneration !== evanRouteGeneration/);
    assert.match(email, /Do not claim that email was sent, scheduled, cancelled, or failed to send/);
    assert.match(player, /Microphone access is blocked[^\n]+restart the Evan session/);
    assert.match(planner, /status: 'update_superseded'/);
    assert.match(planner, /status: 'session_closing'/);
    assert.match(email, /status: 'session_closing'/);
});

test('a timed-out binding cannot start a late email side effect', async () => {
    let release;
    let sends = 0;
    const binding = new Promise(resolve => { release = resolve; });
    const result = runEvanToolWithDeadline(async signal => {
        await binding;
        signal.throwIfAborted();
        sends++;
    }, { timeoutMs: 5 });
    await assert.rejects(result, error => error.code === 'timeout');
    release();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(sends, 0);
});

test('stalled email request aborts once without retrying or confirming delivery', async () => {
    let calls = 0;
    let capturedSignal;
    const result = runEvanToolWithDeadline(signal => sendAmyAnamFollowUpEmail({
        launchId: 'synthetic-launch', sessionId: 'synthetic-session', userConfirmed: true,
        fetchImpl: (_input, init) => {
            calls++;
            capturedSignal = signal;
            assert.equal(init.method, 'POST');
            return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        },
    }), { timeoutMs: 5 });
    await assert.rejects(result, error => error.code === 'timeout');
    assert.equal(capturedSignal.aborted, true);
    assert.equal(calls, 1);
});
