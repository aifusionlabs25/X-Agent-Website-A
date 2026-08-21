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
    assert.equal(coordinator.arm(), false, 'audio-drain window must not permit a second farewell');
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
    const longReply = Array.from({ length: 100 }, (_, index) => `word${index + 1}`).join(' ');
    assert.equal(inspectAmyLiveOutput(longReply), null);
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
    assert.equal(hasExplicitAmyCloseIntent("All right, that's a wrap on the role play."), true);
    assert.equal(hasExplicitAmyCloseIntent('The role play is over.'), true);
    for (const hardClose of [
        'I need to leave now.',
        'I have to run.',
        'I should get going.',
        'Gotta go.',
        'We are done here.',
        "Let's end here.",
        'Talk to you later.',
        'See you later.',
        'Can you end the call?',
        "Let's end the call.",
        "I'd like to end the call.",
        'I want to end the call.',
        'We should end the call.',
        'Could we end the call?',
        'Would you mind ending the call?',
        'Can you end the call please?',
        'Please, end the session.',
        'Goodbye?',
        'Okay thank you so much I have to go now.',
        'This was really helpful goodbye.',
        'That was great, take care.',
        'Thanks this was helpful, I have to run.',
        "I'm going to jump off now.",
        "I'm going to hop off now.",
        'Thanks so much, bye Amy.',
    ]) assert.equal(hasExplicitAmyCloseIntent(hardClose), true, hardClose);
    for (const softClose of [
        'Okay Amy that is all thank you.',
        'All right Amy, we are all set.',
        'I think that is it for me.',
    ]) assert.equal(hasAmySoftCloseIntent(softClose), true, softClose);
    assert.equal(hasAmySoftCloseIntent('That gives me a good picture. Thanks for your time.'), true);
    assert.equal(hasAmySoftCloseIntent("I've got what I need. We'll talk next steps."), true);
    assert.equal(hasAmySoftCloseIntent("I've got what I need. Before we wrap, could you show me a visual?"), false);
});

test('Amy keeps business-progress language open unless the visitor actually closes', () => {
    const continuingTurns = [
        'We need Insight to take care of deployment.',
        'I have to go through our security review.',
        'I need to go over the budget.',
        'We are finished with discovery and ready for the next topic.',
        'We are good for 500 users in phase one.',
        'I am good with the proposed security approach; now discuss cost.',
        'That is all of the data for the first site; next is the second.',
        'We are all set for the pilot requirements; now discuss rollout.',
        'Can your team take care?',
        'Would Insight take care?',
        'The question is whether you can take care.',
        'What happens if I say goodbye?',
        'Can you explain why we should end the call?',
        'Are you saying I have to go?',
        'Why would I end the session?',
        'Do you end the call when I say goodbye?',
        'What happens if I say that is all?',
        'Do you close if I say we are all set?',
        'Are you saying that is it?',
        'Why would I say thanks for your time?',
        'What happens if I say I have to run?',
        'Are you saying we are all set?',
        'The note says take care.',
        'Please say bye Amy.',
        'I have to run diagnostics before we decide.',
        "I'm going to jump off this topic and discuss cost.",
    ];

    for (const turn of continuingTurns) {
        assert.equal(hasExplicitAmyCloseIntent(turn), false, turn);
        assert.equal(hasAmySoftCloseIntent(turn), false, turn);
    }
});

test('Amy does not close while a stated final request is still pending', () => {
    const pendingTurns = [
        'Before we wrap, can you show me a summary?',
        'Before I end the session, could you explain the next step?',
        'Before we close the conversation, would you update the Visual Brief?',
    ];

    for (const turn of pendingTurns) {
        assert.equal(hasExplicitAmyCloseIntent(turn), false, turn);
        assert.equal(hasAmySoftCloseIntent(turn), false, turn);
    }
    assert.equal(hasExplicitAmyCloseIntent('Please do not end the session.'), false);
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
    assert.match(player, /'closing_motion_and_farewell_required'/);
    assert.match(player, /pendingAmyHardCloseIntent/);
    assert.match(player, /anamClient\.interruptPersona\(\)/);
    assert.match(player, /hasAmySpokenEmailAttempt\(completedUserTurn\)/);
    assert.match(player, /email_pre_authorized_at_check_in/);
    assert.match(player, /Ask no question, request no contact details/);
    assert.doesNotMatch(player, /ask permission to email/i);
    assert.match(player, /Private contact rule: the visitor spoke an email-like phrase/);
    assert.match(player, /deliverAmyUnsafeOutputRecovery/);
    assert.match(player, /Farewell recovery was not confirmed/);
    assert.doesNotMatch(player, /verbose_reply/);
    assert.match(player, /Your verified check-in address is already secured privately/);
    assert.match(player, /contentLogged: false/);
    assert.match(player, /softCloseRequested[\s\S]{0,180}'closing_motion_and_farewell_required'[\s\S]{0,120}'farewell_required'/);
    assert.match(player, /retryAllowed: false/);
    assert.match(player, /Say exactly: "Thanks for talking this through with me\. Take care\."/);
    assert.match(player, /Do not speak again and do not call this tool again/);
    assert.doesNotMatch(player, /silently call end_amy_session again/i);
});
