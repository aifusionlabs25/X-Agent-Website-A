import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hasAmySpokenEmailAttempt, inspectAmyLiveOutput } from '../lib/anam/amy-live-output-guard.ts';
import {
    hasAmyEmailOffer,
    hasAmyEmailPermission,
    hasAmySoftCloseIntent,
    hasExplicitAmyCloseIntent,
} from '../lib/anam/amy-session-close.ts';
import { createAmyFarewellCloseCoordinator } from '../lib/anam/amy-session-close.ts';

function scheduler() {
    let nextId = 1;
    const pending = new Map();
    return {
        schedule(callback, delay) {
            const id = nextId++;
            pending.set(id, { callback, delay });
            return id;
        },
        cancel(id) {
            pending.delete(id);
        },
        runDelay(delay) {
            const match = [...pending].find(([, task]) => task.delay === delay);
            assert.ok(match, `missing timer for ${delay}ms`);
            pending.delete(match[0]);
            match[1].callback();
        },
        count() {
            return pending.size;
        },
    };
}

test('Amy closes once after one exact farewell without confirmation', async () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createAmyFarewellCloseCoordinator({
        stopStreaming: async () => { stops += 1; },
        schedule: timers.schedule,
        cancel: timers.cancel,
        fallbackMs: 12_000,
        audioDrainMs: 2_500,
    });

    assert.equal(coordinator.arm(), true);
    assert.equal(coordinator.arm(), false);
    assert.equal(coordinator.completeFarewell(), true);
    assert.equal(coordinator.completeFarewell(), false);
    timers.runDelay(2_500);
    await Promise.resolve();
    assert.equal(stops, 1);
    assert.equal(timers.count(), 0);
});

test('Amy uses one bounded fallback close when no farewell completes', async () => {
    const timers = scheduler();
    let stops = 0;
    const coordinator = createAmyFarewellCloseCoordinator({
        stopStreaming: () => { stops += 1; },
        schedule: timers.schedule,
        cancel: timers.cancel,
        fallbackMs: 12_000,
    });
    assert.equal(coordinator.arm(), true);
    timers.runDelay(12_000);
    await Promise.resolve();
    assert.equal(stops, 1);
});

test('Amy output guard suppresses provider fallbacks and exposed close markup', () => {
    assert.deepEqual(
        inspectAmyLiveOutput("The visual brief is updated. Sorry, I'm having trouble thinking right now."),
        { reason: 'provider_fallback', safePrefix: 'The visual brief is updated.' },
    );
    assert.deepEqual(
        inspectAmyLiveOutput('<end_call{ "confirmed": true }>'),
        { reason: 'tool_markup', safePrefix: '' },
    );
    assert.deepEqual(inspectAmyLiveOutput('<'), { reason: 'tool_markup', safePrefix: '' });
    assert.deepEqual(
        inspectAmyLiveOutput('Sorry, I am having trouble'),
        { reason: 'provider_fallback', safePrefix: '' },
    );
    assert.equal(inspectAmyLiveOutput("I'm sorry that procurement is complicated."), null);
    assert.deepEqual(
        inspectAmyLiveOutput('I heard R-V-I-C-K-S @ gmail dot com. Is that right?'),
        { reason: 'contact_privacy', safePrefix: '' },
    );
    assert.deepEqual(
        inspectAmyLiveOutput('Could you please state your email address again?'),
        { reason: 'contact_privacy', safePrefix: '' },
    );
    assert.equal(hasAmySpokenEmailAttempt('My email is R V I C K S at gmail.com.'), true);
    const longReply = Array.from({ length: 41 }, (_, index) => `word${index + 1}`).join(' ');
    assert.deepEqual(inspectAmyLiveOutput(longReply), {
        reason: 'verbose_reply',
        safePrefix: Array.from({ length: 40 }, (_, index) => `word${index + 1}`).join(' '),
    });
});

test('Amy separates a useful soft closing motion from an immediate hard close', () => {
    assert.equal(hasExplicitAmyCloseIntent("That's what I needed. I'll take this forward."), false);
    assert.equal(hasExplicitAmyCloseIntent('Before we wrap, can you show me a summary?'), false);
    assert.equal(hasAmySoftCloseIntent("Thanks, Amy. Let's call it a day."), true);
    assert.equal(hasAmySoftCloseIntent("This was helpful. Let's wrap it here."), true);
    assert.equal(hasAmySoftCloseIntent("We're all set for now."), true);
    assert.equal(hasAmySoftCloseIntent("That's it."), true);
    assert.equal(hasExplicitAmyCloseIntent("This was helpful. Let's wrap it here."), false);
    assert.equal(hasExplicitAmyCloseIntent("I'm done. End the session."), true);
    assert.equal(hasExplicitAmyCloseIntent('Goodbye. Take care.'), true);
});

test('legacy email permission recognition remains bounded but is not used by the live player', async () => {
    const offer = 'Would you like me to email the final recap and Visual Brief to your private check-in address?';
    assert.equal(hasAmyEmailOffer(offer), true);
    assert.equal(hasAmyEmailPermission('Yes, please do.', offer), true);
    assert.equal(hasAmyEmailPermission('Go ahead.', offer), true);
    assert.equal(hasAmyEmailPermission('Yes, no problem.', offer), true);
    assert.equal(hasAmyEmailPermission('Email me the summary, please.'), true);
    assert.equal(hasAmyEmailPermission('Can you send the Visual Brief?'), true);
    assert.equal(hasAmyEmailPermission('No, please do not send it.', offer), false);
    assert.equal(hasAmyEmailPermission('Yes, that is the right priority.', 'Should access control be the priority?'), false);
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(player, /hasAmyEmailPermission/);
    assert.doesNotMatch(player, /queueAmyEmailFromConversation/);
});

test('Amy player registers deterministic close and interrupts unsafe provider output before streaming', async () => {
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const registration = player.indexOf("registerToolCallHandler(\n                        'end_amy_session'");
    const streaming = player.indexOf("anamClient.streamToVideoElement('persona-video')");
    assert.ok(registration > 0 && registration < streaming);
    assert.match(player, /amyCloseCoordinator = createAmyFarewellCloseCoordinator\(\{[\s\S]{0,180}stopStreaming: handleAmyRequestedEnd/);
    assert.match(player, /inspectAmyLiveOutput\(accumulated\)/);
    assert.match(player, /const latestUserTurn = await latestSynchronizedUserTurn\(\)/);
    assert.match(player, /await waitForWorkbenchTranscriptToSettle\(\)/);
    assert.match(player, /status: 'close_not_requested'/);
    assert.match(player, /status: 'closing_motion_required'/);
    assert.match(player, /pendingAmyHardCloseIntent/);
    assert.match(player, /anamClient\.interruptPersona\(\)/);
    assert.match(player, /hasAmySpokenEmailAttempt\(completedUserTurn\)/);
    assert.match(player, /email_pre_authorized_at_check_in/);
    assert.match(player, /Ask no question, request no contact details/);
    assert.doesNotMatch(player, /ask permission to email/i);
    assert.match(player, /Private contact rule: the visitor spoke an email-like phrase/);
    assert.match(player, /Your verified check-in address is already secured privately/);
    assert.match(player, /contentLogged: false/);
    assert.match(player, /status: armed \? 'farewell_required' : 'farewell_already_armed'/);
    assert.match(player, /Say exactly: "Thanks for talking this through with me\. Take care\."/);
    assert.match(player, /Do not speak again\. The farewell close is already armed/);
});
