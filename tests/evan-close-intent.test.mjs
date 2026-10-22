import assert from 'node:assert/strict';
import test from 'node:test';
import { hasEvanCloseIntent, hasEvanCloseIntentAfterFragment, isEvanAuthorizedCloseCandidate, isEvanTerminalFarewell } from '../lib/anam/evan-close-intent.ts';

test('only an immediate recognition tail or bare acknowledgement preserves a completed explicit goodbye', () => {
    const goodbye = "I'm going to go now. Goodbye.";
    assert.equal(hasEvanCloseIntent(goodbye), true);
    assert.equal(hasEvanCloseIntentAfterFragment('I.', goodbye, 'Is there anything else?', 700), true);
    assert.equal(hasEvanCloseIntentAfterFragment('Okay.', "That's it, I'm finished now. Goodbye.", 'Anything else?', 6_000), true);
    assert.equal(hasEvanCloseIntentAfterFragment('Thank you.', goodbye, '', 6_000), true);
    assert.equal(hasEvanCloseIntentAfterFragment('Okay, one more thing.', goodbye, '', 6_000), false);
    assert.equal(hasEvanCloseIntentAfterFragment('Okay.', goodbye, '', 8_001), false);
    assert.equal(hasEvanCloseIntentAfterFragment('Okay.', 'No packing help.', '', 6_000), false);
    assert.equal(hasEvanCloseIntentAfterFragment('I', goodbye, '', 8_001), false);
    assert.equal(hasEvanCloseIntentAfterFragment('No.', goodbye, '', 700), false);
    assert.equal(hasEvanCloseIntentAfterFragment('I need another quote.', goodbye, '', 700), false);
    assert.equal(hasEvanCloseIntentAfterFragment('I', 'Thanks for the estimate.', '', 700), false);
    assert.equal(hasEvanCloseIntentAfterFragment('I', 'No, wait. Goodbye.', '', 700), false);
});

test('the live phone readback confirmation never authorizes a hangup', () => {
    assert.equal(hasEvanCloseIntent('Yes.', 'Your phone number is six zero two, five five five, zero one two three. Is that correct?'), false);
    assert.equal(isEvanTerminalFarewell('Great, thanks. Is there anything else—special items, access concerns, or packing help you’d like to mention?Thanks for the'), false);
});

test('run47 Got it acknowledgement does not block the first explicit end request', () => {
    const text = "Got it. No, that's everything. I'd like to end the call now, please.";
    assert.equal(hasEvanCloseIntent(text), true);
    const candidate = { text, previousAgentText: 'After our call ends, I will send the recap.',
        trailingFragmentOfClose: false, userMessageId: 'run47-user', turnGeneration: 8,
        completedAt: 1_000, correlationId: 'run47-correlation' };
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'run47-user', 8, '', 2_000, 'run47-correlation'), true);
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'run47-user', 8, 'Wait, one more thing.', 2_000, 'run47-correlation'), false);
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'older-user', 8, '', 2_000, 'run47-correlation'), false);
    for (const value of ['Got it, please end the call.', 'Okay. Got it! Please end the call now.']) {
        assert.equal(hasEvanCloseIntent(value), true, value);
    }
    for (const value of [
        'Got it.', 'Got it, thanks.',
        "Got it? I'd like to end the call now.",
        "Got it. No, that's everything. I'd like to end the call after one more question.",
        "Got it. Please don't end the call.",
        "Got it. I have a stop in Mesa. I'd like to end the call now.",
        "For example, got it. No, that's everything. I'd like to end the call now.",
    ]) assert.equal(hasEvanCloseIntent(value), false, value);
});

test('clear instructions to end the conversation authorize closing', () => {
    for (const phrase of [
        'End the call.', 'Please end this call.', 'Can you end the call now?',
        'Could we finish this conversation?', 'You can close the session now.',
        "I'd like to end the call.", "Thanks. I'd like to end the call now. Thanks.", 'I want to stop the conversation.',
        "Let's end this call.", 'Evan, please hang up now.', 'Hang up please.',
        'I have to go.', "I've got to go, thanks.", 'I need to leave now.',
    ]) assert.equal(hasEvanCloseIntent(phrase), true, phrase);
});

test('live courtesy-prefaced closing requests do not wait for a third goodbye', () => {
    for (const phrase of [
        "Thanks, that was helpful. I'd like to end the call now, please.",
        "No, that's all. I'd really like to hang up now, please.",
        "No, that's everything. I'd like to end the call now, please.",
    ]) assert.equal(hasEvanCloseIntent(phrase), true, phrase);
    for (const phrase of [
        "Thanks, that was helpful? I'd like to end the call now, please.",
        "No, that's all. I have another stop in Mesa. I'd really like to hang up now, please.",
        "No, that's all. I'd really like to hang up after one more question, please.",
        "No, that's all. I'd really like to hang up now, but wait.",
    ]) assert.equal(hasEvanCloseIntent(phrase), false, phrase);
});

test('run-eight completed-answer courtesy does not obscure an explicit final end request', () => {
    assert.equal(hasEvanCloseIntent("Okay, that answers what I needed for now. Thank you and I'd like to end the call please."), true);
    assert.equal(hasEvanCloseIntent("That answers my question. I'd like to end the conversation."), true);
    for (const phrase of [
        "That answers what I needed for now. Thank you and I'd like to ask about packing.",
        "That answers what I needed for now. Thank you and I'd like to end the call after one more question.",
        "That answers what I needed for now? Thank you and I'd like to end the call please.",
        "There's a new stop in Mesa. Thank you and I'd like to end the call please.",
    ]) assert.equal(hasEvanCloseIntent(phrase), false, phrase);
});

test('run-ten direct visitor end request survives a polite answer and trailing thanks', () => {
    const closing = "No, that answers it. I'd like to end the call now. Thanks.";
    assert.equal(hasEvanCloseIntent(closing), true);
    const candidate = { text: closing, previousAgentText: 'Is there anything else?',
        trailingFragmentOfClose: false, userMessageId: 'latest-user', turnGeneration: 5,
        completedAt: 1_000, correlationId: 'latest-correlation' };
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'latest-user', 5, '', 2_000), true);
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'latest-user', 5, '', 2_000, 'latest-correlation'), true);
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'latest-user', 5, '', 2_000, 'older-correlation'), false);
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'older-user', 5, '', 2_000), false);
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'latest-user', 6, '', 2_000), false);
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'latest-user', 5, 'Wait, one more thing.', 2_000), false);
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'latest-user', 5, '', 31_001), false);
    for (const phrase of [
        "No, that answers it. I'd like to end the call after one more question. Thanks.",
        "No, that answers it. I'd like to end the call now? Thanks.",
        "No, that answers it. I'd like to add a stop in Mesa. Thanks.",
    ]) assert.equal(hasEvanCloseIntent(phrase), false, phrase);
});

test('run-fifteen completed acknowledgments do not hide the first explicit end request', () => {
    for (const text of [
        "That's clear, thanks. That answers it. I'd like to end the call now.",
        "That is clear. Thank you. Please end the call now.",
        "That answers my question. That's helpful. Can you end the call please?",
    ]) assert.equal(hasEvanCloseIntent(text), true, text);
    for (const text of [
        "That's clear, thanks. That answers it. I'd like to end the call after one more question.",
        "That's clear? I'd like to end the call now.",
        "That's clear. I need a stop in Mesa. I'd like to end the call now.",
        "That's clear. Please don't end the call now.",
    ]) assert.equal(hasEvanCloseIntent(text), false, text);
});

test('run-sixteen completed wrap-up and trailing thanks do not block explicit end requests', () => {
    for (const text of [
        "Okay, that answers it. Thank you. I'd like to end the call now. Thanks.",
        "No, I'm all set. Please end the call now.",
    ]) {
        assert.equal(hasEvanCloseIntent(text), true, text);
        assert.equal(isEvanAuthorizedCloseCandidate({ text, previousAgentText: '',
            trailingFragmentOfClose: false, userMessageId: 'completed-user', turnGeneration: 4,
            completedAt: 1_000, correlationId: 'matching-turn' },
        'completed-user', 4, '', 2_000, 'matching-turn'), true, text);
    }
    for (const text of [
        "Okay, that answers it. Thank you. I'd like to end the call after one more question. Thanks.",
        "No, I'm all set. I need a stop in Mesa. Please end the call now.",
        "No, I'm all set? Please end the call now.",
        "No, I'm all set. Please don't end the call now.",
    ]) assert.equal(hasEvanCloseIntent(text), false, text);
});

test('run-twenty-five repeated courtesy does not hide a final direct end request', () => {
    const text = "Great, so that answers it. Brilliant, okay. That answers it. Thank you. I'd like to end the call.";
    assert.equal(hasEvanCloseIntent(text, "I'm listening, go ahead."), true);
    const candidate = { text, previousAgentText: "I'm listening, go ahead.",
        trailingFragmentOfClose: false, userMessageId: 'completed-user', turnGeneration: 4,
        completedAt: 1_000, correlationId: 'matching-turn' };
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'completed-user', 4, '', 2_000, 'matching-turn'), true);
    for (const unsafe of [
        "Great, so that answers it. Brilliant, okay. That answers it? Thank you. I'd like to end the call.",
        "Great, so that answers it. I need to add a stop in Mesa. I'd like to end the call.",
        "Great, so that answers it. Brilliant, okay. That answers it. Thank you. I'd like to end the call after one more question.",
    ]) assert.equal(hasEvanCloseIntent(unsafe), false, unsafe);
});

test('run-twenty-six final please after a comma authorizes the first direct end request', () => {
    const text = "Right, that answers it. Thank you. I'd like to end the call now, please.";
    assert.equal(hasEvanCloseIntent(text, 'No email recap or callback is arranged from this conversation.'), true);
    const candidate = { text, previousAgentText: 'No email recap or callback is arranged from this conversation.',
        trailingFragmentOfClose: false, userMessageId: 'completed-user', turnGeneration: 7,
        completedAt: 1_000, correlationId: 'matching-turn' };
    assert.equal(isEvanAuthorizedCloseCandidate(candidate, 'completed-user', 7, '', 2_000, 'matching-turn'), true);
    assert.equal(hasEvanCloseIntent("I'd like to end the call now, please."), true);
    for (const unsafe of [
        "Right, that answers it? Thank you. I'd like to end the call now, please.",
        "Right, that answers it. I need to add a stop in Mesa. I'd like to end the call now, please.",
        "Right, that answers it. Thank you. I'd like to end the call after one more question, please.",
        "Right, that answers it. Thank you. Please don't end the call now, please.",
    ]) assert.equal(hasEvanCloseIntent(unsafe), false, unsafe);
});

test('clear complete wrap-up and goodbye statements authorize closing', () => {
    for (const phrase of [
        "That's all.", 'That is all for now.', "That's it, thank you.",
        "I'm all set.", 'We are done for today.', 'All set, thanks.',
        'Nothing else.', 'No more questions.', 'No further questions, Evan.',
        'Goodbye.', 'Bye, Evan.', 'Thank you, take care.',
        'Thanks for your help. Goodbye.', 'I will wait for the team to call. Goodbye.',
        'Have a good day.', 'Thanks, have a great evening!', 'Have a nice weekend, Evan.',
    ]) assert.equal(hasEvanCloseIntent(phrase), true, phrase);
});

test('ordinary confirmations and gratitude do not authorize closing', () => {
    for (const phrase of ['Yes.', 'Yeah.', 'Yep.', 'Sure.', 'Okay.', 'Correct.', 'That is correct.', 'Thanks.', 'Thank you.', 'Perfect.']) {
        for (const prior of ['', 'Is that the right phone number?', 'Is your email address correct?', 'Do you need full packing?', 'Is there anything else I can help you with?']) {
            assert.equal(hasEvanCloseIntent(phrase, prior), false, `${phrase} / ${prior}`);
        }
    }
});

test('prompt-approved natural wrap-ups and bounded courtesy endings authorize closing', () => {
    for (const phrase of [
        "I'm set for now.", 'I am set for today, thank you.', "We're set for now.",
        "That's everything.", 'That is everything for today, Evan.',
        "That's all, thanks for your help.", "That's all. Thanks again for your help, Evan.",
        "No that's it thank you Evan.", "No, that's it. Thank you, Evan.",
        "That's everything. Thanks, Evan. Goodbye.",
    ]) assert.equal(hasEvanCloseIntent(phrase), true, phrase);
});

test('natural wrap-up additions retain scope, question, quote, and continuation safeguards', () => {
    for (const phrase of [
        "I'm set for now with packing.", "That's everything about the inventory.",
        "That's all, thanks for your help with the map. Now change the destination.",
        "That's everything, but I still need the phone number.",
        "I'm set for now, except I have one more question.",
        "I'm not set for now.", "That isn't everything.",
        "That's everything?", "I'm set for now?", 'Thanks for your help.',
        '"I\'m set for now."', 'He said that is everything.',
        'For example, that is everything.', 'If I say I am set for now, will you close?',
    ]) assert.equal(hasEvanCloseIntent(phrase, 'Is there anything else?'), false, phrase);
});

test('observed natural endings allow a bounded callback handoff without a second goodbye', () => {
    for (const phrase of [
        "No, that's enough for now. Just have someone call in the morning. Thank you.",
        "That's enough for today, thank you.",
        "That's all for now. Please have the team call me tomorrow morning. Thanks, Evan.",
        "I'm set for now. Just call me later.",
        "Nothing else. Ask the Mullins team to call us on Monday. Thank you.",
        "Range is better, mid-month flexible. You've got the route, treadmill, stairs and phone-only callback. That's everything. We're good to end.",
        "We're good to end.", "I'm ready to end the call now.",
    ]) assert.equal(hasEvanCloseIntent(phrase), true, phrase);
});

test('callback handoffs and final clauses retain all continuation and scope boundaries', () => {
    for (const phrase of [
        'Please have someone call me in the morning.',
        'Just call me tomorrow. Thank you.',
        "That's enough for now with the packing.",
        "That's all for packing. Have someone call tomorrow.",
        "No, that's enough for today. There are stairs at the destination.",
        "That's enough for now. Just have someone call tomorrow. What about boxes?",
        "That's enough for today, but I have another question.",
        "That's enough for now. Ask the team to confirm the inventory.",
        "That's all. Call me when you're good to end.",
        "We're good to end the packing.",
        "We're good to end?", "If we're good to end.",
        "We're good to end, but one more thing.",
        "We're not ready to end.", 'She said we are good to end.',
        '"We are good to end."',
    ]) assert.equal(hasEvanCloseIntent(phrase, 'Is there anything else?'), false, phrase);
});

test('observed good-there wrap-up requires a final help-check question', () => {
    for (const phrase of ["Nope, we're good there.", 'No, we are good there.', "We're good there, thank you.", "I'm good for now."]) {
        for (const prior of [
            'Glad to hear it was clear. Is there anything else you would like to discuss about the move?',
            'Do you need anything more?', 'Are there any further questions?',
            'Can I help you with anything else?',
        ]) assert.equal(hasEvanCloseIntent(phrase, prior), true, `${phrase} / ${prior}`);
        for (const prior of ['', 'Got.', 'Did I get that right?', 'Is that your phone number?',
            'Would you like an email recap?', 'Do you need packing assistance?',
            'Is there anything else about your email that needs correcting?',
            'Can I help with anything else about your phone number?',
        ]) assert.equal(hasEvanCloseIntent(phrase, prior), false, `${phrase} / ${prior}`);
    }
    for (const phrase of ["We're good there?", "We're good with packing.",
        "Nope, we're good there, but I have one more question.", "We're not good there.",
        'He said we are good there.', '"We are good there."',
    ]) assert.equal(hasEvanCloseIntent(phrase, 'Is there anything else?'), false, phrase);
});

test('closing-now declarations are explicit but scoped or continued statements are not', () => {
    for (const phrase of ['Closing now.', "I'm closing now.", 'We are closing this call now.', 'Okay, closing the session now.']) {
        assert.equal(hasEvanCloseIntent(phrase), true, phrase);
    }
    for (const phrase of ['Closing now?', 'Closing the box now.', 'The office is closing now.',
        'Closing now, but one more question.', 'I am not closing now.',
        'She said closing now.', 'For example, closing now.', '"Closing now."',
        'Closing the planner now.', 'I am closing now and need to add another stop.',
    ]) assert.equal(hasEvanCloseIntent(phrase), false, phrase);
});

test('standalone by is a farewell only in a strong closing exchange', () => {
    for (const phrase of ['by', 'By.', 'By, Evan.']) {
        for (const prior of ['Thank you for speaking with Mullins Moving. Take care.',
            'Is there anything else I can help you with?',
        ]) assert.equal(hasEvanCloseIntent(phrase, prior), true, `${phrase} / ${prior}`);
        for (const prior of ['', 'Got.', 'Perfect.', 'Did I get that right?',
            'What date are you moving by?', 'Which city are you moving to?',
            'What should I write beside the delivery date?',
            'I will say goodbye after your next question.',
        ]) assert.equal(hasEvanCloseIntent(phrase, prior), false, `${phrase} / ${prior}`);
    }
    for (const phrase of ['By Friday.', 'By the storage unit.', 'By?', 'By, wait, one more thing.',
        'He said by.', '"By."', 'What does by mean?',
    ]) assert.equal(hasEvanCloseIntent(phrase, 'Thank you. Take care.'), false, phrase);
});

test('short negatives authorize closing only in a final anything-else context', () => {
    for (const phrase of ['No.', 'No thanks.', 'No, thank you.', 'Nope.', 'No thanks, Evan.']) {
        for (const prior of [
            'Is there anything else I can help you with?',
            'Do you have any other questions?',
            'Anything else?',
            'Anything else you would like to add?',
            'So, is there anything else I can help with?',
            'Great, thanks. Is there anything else—special items, access concerns, or packing help you’d like to mention?',
        ]) assert.equal(hasEvanCloseIntent(phrase, prior), true, `${phrase} / ${prior}`);
        for (const prior of ['', 'Is that the correct phone number?', 'Would you like an email recap?', 'Do you need packing?', 'Have we covered everything?', 'Are you all set?', 'Is there anything else about your email that needs correcting?', 'I do not think there is anything else.', 'Anything else will be discussed with the team.', 'You asked if there is anything else.']) {
            assert.equal(hasEvanCloseIntent(phrase, prior), false, `${phrase} / ${prior}`);
        }
    }
});

test('declining follow-up or contact alone is not a close request', () => {
    for (const phrase of [
        'No email please.', 'I do not want an email recap.', 'Skip the email.',
        'Do not email me.', 'No thanks, I do not want to give my phone number.',
        "That's all for the packing.", "I'm all set with the addresses.",
        'Nothing else about the inventory.', 'No more questions about valuation.',
    ]) assert.equal(hasEvanCloseIntent(phrase, 'Is there anything else?'), false, phrase);
});

test('explicit close-question confirmation is contextual and does not use unrelated questions', () => {
    assert.equal(hasEvanCloseIntent('Yes please.', 'Would you like me to end this call?'), true);
    assert.equal(hasEvanCloseIntent('Okay.', 'Shall we end the call now?'), true);
    assert.equal(hasEvanCloseIntent('Yes.', 'Would you like me to end this call? Is your phone number correct?'), false);
    assert.equal(hasEvanCloseIntent('No.', 'Is there anything else? Would you like an email recap?'), false);
});

test('continuation, correction, or withdrawn goodbye overrides an earlier wrap-up', () => {
    for (const phrase of [
        "That's all, but I have one more question.", 'Bye, wait, can you explain valuation?',
        "No, wait. Don't hang up.", 'Nothing else, except I need to change the destination.',
        "I'm all set, however I have another question.", 'Before you go, what about packing?',
        'Please do not end the call.', "Don't say goodbye yet.",
        'I am not ready to finish the session.', "That's not all.",
        'I am not done.', "I haven't finished.", 'Not yet, keep talking.',
        'End the call after I ask one last question.', 'No thanks, I still need help.',
        'Goodbye? What about the piano?',
        'Have a good day, but before you go, I have a question.',
    ]) assert.equal(hasEvanCloseIntent(phrase, 'Is there anything else?'), false, phrase);
});

test('quoted, hypothetical, reported, and explanatory goodbyes do not authorize closing', () => {
    for (const phrase of [
        'He said goodbye.', 'The other agent said goodbye.', 'You just said goodbye.',
        'Why did you say goodbye?', 'What does goodbye mean?',
        'If I say goodbye, will you hang up?', 'Hypothetically, end the call.',
        'For example, please end the call.', 'The phrase is "end the call".',
        '"Goodbye."', '“Please end the call.”', "The customer said 'bye'.",
        'Here is the script: "Hello. Please end this call."',
        'You said have a good day.', 'Why did you tell me to have a good day?',
        '"Have a good day."', 'For example, have a nice weekend.',
    ]) assert.equal(hasEvanCloseIntent(phrase), false, phrase);
});

test('genuine brief agent farewells include the exact managed closing', () => {
    for (const phrase of [
        'Thank you for speaking with Mullins Moving. Take care.',
        'Thanks for speaking with me. Goodbye.', 'Goodbye.', 'Bye, Rob.',
        'Thank you. Have a great day!', 'Thanks again, and take care.',
        'The Mullins team will follow up with you. Have a good evening.',
    ]) assert.equal(isEvanTerminalFarewell(phrase), true, phrase);
});

test('ordinary completed speech, invitations, and unfinished goodbyes are not terminal', () => {
    for (const phrase of [
        'Great, thanks.', 'Thank you for speaking with Mullins Moving.',
        'Thanks for the', 'I can take care of that.', 'We will take care of the packing.',
        'Is there anything else?', 'Anything else you would like to add',
        'What is your pickup address? Take care.',
        'Do you need packing help? Goodbye.',
        'I am going to end the call now.', 'The customer said goodbye.',
        'The closing phrase is "Take care."', 'For example: Goodbye.',
        'Take care. Before you go, what is your address?',
        'Let me know your destination address, and goodbye.',
        'No, wait. Goodbye.',
    ]) assert.equal(isEvanTerminalFarewell(phrase), false, phrase);
});
