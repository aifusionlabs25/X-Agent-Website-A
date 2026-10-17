import assert from 'node:assert/strict';
import test from 'node:test';
import { hasEvanCloseIntent, isEvanTerminalFarewell } from '../lib/anam/evan-close-intent.ts';

test('the live phone readback confirmation never authorizes a hangup', () => {
    assert.equal(hasEvanCloseIntent('Yes.', 'Your phone number is six zero two, five five five, zero one two three. Is that correct?'), false);
    assert.equal(isEvanTerminalFarewell('Great, thanks. Is there anything else—special items, access concerns, or packing help you’d like to mention?Thanks for the'), false);
});

test('clear instructions to end the conversation authorize closing', () => {
    for (const phrase of [
        'End the call.', 'Please end this call.', 'Can you end the call now?',
        'Could we finish this conversation?', 'You can close the session now.',
        "I'd like to end the call.", 'I want to stop the conversation.',
        "Let's end this call.", 'Evan, please hang up now.', 'Hang up please.',
        'I have to go.', "I've got to go, thanks.", 'I need to leave now.',
    ]) assert.equal(hasEvanCloseIntent(phrase), true, phrase);
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
