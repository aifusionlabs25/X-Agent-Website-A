import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvanPlannerAutoOpen, isEvanRouteIntakeQuestion } from '../lib/anam/evan-planner-auto-open.ts';

test('recognizes natural route, origin-only, and destination-only intake questions', () => {
    for (const phrase of [
        'Where are you moving from and to?',
        'Where are you moving from?',
        'Where will you be moving to?',
        'What are the pickup and delivery locations?',
        'What is your pickup address?',
        'What is the destination address?',
        'What city are you moving from?',
        'Which city are you moving to?',
        'What is your current address?',
        'What is your new address?',
        'What is your destination?',
        'Where is the pickup location?',
        'Where should we pick up your belongings?',
        'Where should we deliver your furniture?',
        'Could you tell me where you’re moving from and where you’re headed to?',
        'Can you share your pickup and drop-off addresses?',
        'May I have the pickup location?',
        'Could I get your destination address?',
        'What is the address for the pickup?',
        'Great. Where are you moving from and to?',
        'To plan your move, what are the pickup and delivery locations?',
        'And what is your destination address?',
        'Where are you moving from',
    ]) assert.equal(isEvanRouteIntakeQuestion(phrase), true, phrase);
});

test('does not open for general move, time, contact, company, access, or chit-chat questions', () => {
    for (const phrase of [
        'Hello, I am Evan with Mullins Moving. How can I help?',
        'How can I help with your move?',
        'Tell me about your move.',
        'When are you moving?',
        'What date are you moving from your house?',
        'What time should the pickup happen?',
        'Which day is your delivery?',
        'How many rooms are you moving from?',
        'What is your email address?',
        'Can you share your email address for the move?',
        'What is the billing address?',
        'Where did you hear about Mullins Moving?',
        'Where are you located?',
        'Where is your company based?',
        'Moving on, what is your phone number?',
        'Where are you moving on to next?',
        'Do you have stairs at the pickup address?',
        'Is there an elevator at the destination?',
        'What information do you need about the destination address?',
        'Would you like to see the route?',
        'Where is the delivery date listed?',
        'Your pickup address is in Mesa.',
        'I can ask where you are moving from later.',
        'The next question will be about your destination address.',
        'What services does Mullins offer at the pickup location?',
        'Could you tell me what your email address is?',
        '',
    ]) assert.equal(isEvanRouteIntakeQuestion(phrase), false, phrase);
});

test('incomplete streaming prefixes wait until a meaningful location question is present', () => {
    for (const phrase of ['Where', 'Where are you', 'Where are you moving', 'What are your pickup', 'What are the pickup and delivery', 'Could you tell me', 'Can you share your pickup and']) {
        assert.equal(isEvanRouteIntakeQuestion(phrase), false, phrase);
    }
    assert.equal(isEvanRouteIntakeQuestion('What are the pickup and delivery locations'), true);
});

test('recognizes explicit move endpoints and cities-between equivalents', () => {
    for (const phrase of [
        'Which cities are you moving between?',
        'Where will the move start and finish?',
        'Where does the move begin?',
        'Where will the move end?',
        'Where is the move starting and ending?',
        'What are the starting and ending locations?',
        'Where does your move begin?',
        'What towns are you moving between?',
    ]) assert.equal(isEvanRouteIntakeQuestion(phrase), true, phrase);
});

test('endpoint equivalents do not match planning, quote-process, or timing questions', () => {
    for (const phrase of [
        'Where does the quote process start?',
        'Where can I start planning my move?',
        'Where do I start?',
        'When will the move end?',
        'Where will the move planning start?',
        'Where does the move begin in the app?',
        'What cities have the best moving companies?',
        'Which cities are you moving between in the website menu?',
    ]) assert.equal(isEvanRouteIntakeQuestion(phrase), false, phrase);
});

test('accumulated speech and repeated questions cause only one automatic route opening', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    assert.equal(tracker.observeAgentText('Where are you'), false);
    assert.equal(tracker.observeAgentText('Where are you moving from'), true);
    assert.equal(tracker.observeAgentText('Where are you moving from and to?'), false);
    assert.equal(tracker.observeAgentText('What is your destination address?'), false);
    assert.equal(opens, 1);
});

test('manual or tool opening consumes auto-open without hijacking the chosen view', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    tracker.markOpened();
    assert.equal(tracker.observeAgentText('Where are you moving from and to?'), false);
    assert.equal(opens, 0);
});

test('dismissal before or after automatic opening never causes a popup loop', () => {
    for (const before of [true, false]) {
        let opens = 0;
        const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
        if (!before) tracker.observeAgentText('Where are you moving from and to?');
        tracker.dismiss();
        assert.equal(tracker.observeAgentText('What is your destination address?'), false);
        assert.equal(opens, before ? 0 : 1);
    }
});

test('a new session gets one new opportunity while late closed-session events are ignored', () => {
    let opens = 0;
    const oldSession = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    oldSession.dispose();
    oldSession.markOpened();
    oldSession.dismiss();
    assert.equal(oldSession.observeAgentText('Where are you moving from and to?'), false);
    const newSession = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    assert.equal(newSession.observeAgentText('Where are you moving from and to?'), true);
    assert.equal(opens, 1);
});

test('the automatic callback cannot reenter and request another opening', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => {
        opens++;
        assert.equal(tracker.observeAgentText('Where are you moving from and to?'), false);
    } });
    tracker.observeAgentText('Where are you moving from and to?');
    assert.equal(opens, 1);
});

const message = (id, content, endOfSpeech = false, extra = {}) => ({ id, role: 'persona', content, endOfSpeech, ...extra });

test('SDK chunks open only after the complete uninterrupted question', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    assert.equal(tracker.observeMessage(message('p1', 'Where are you ')), false);
    assert.equal(tracker.observeMessage(message('p1', 'moving from and to?')), false);
    assert.equal(opens, 0);
    assert.equal(tracker.observeMessage(message('p1', '', true)), true);
    assert.equal(tracker.observeMessage(message('p1', '', true)), false);
    assert.equal(opens, 1);
});

test('different persona message IDs cannot concatenate into a route question', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    tracker.observeMessage(message('p1', 'Where are you '));
    assert.equal(tracker.observeMessage(message('p2', 'moving from and to?', true)), false);
    assert.equal(tracker.observeMessage(message('p1', 'moving from and to?', true)), false);
    assert.equal(opens, 0);
    assert.equal(tracker.observeMessage(message('p3', 'What is your destination address?', true)), true);
});

test('interrupted flags on any chunk suppress the whole question', () => {
    for (const interruptEarly of [true, false]) {
        let opens = 0;
        const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
        tracker.observeMessage(message('p1', 'Where are you moving ', false, { interrupted: interruptEarly }));
        assert.equal(tracker.observeMessage(message('p1', 'from and to?', true, { interrupted: !interruptEarly })), false);
        assert.equal(tracker.observeMessage(message('p1', 'Where are you moving from and to?', true)), false);
        assert.equal(opens, 0);
    }
});

test('unknown and system roles never trigger; user speech invalidates a partial persona question', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    for (const role of ['user', 'system', 'assistant', 'agent', 'unknown']) {
        assert.equal(tracker.observeMessage(message(`${role}-1`, 'Where are you moving from and to?', true, { role })), false);
    }
    tracker.observeMessage(message('p1', 'Where are you moving '));
    tracker.observeMessage(message('u1', 'Let me finish please.', true, { role: 'user' }));
    assert.equal(tracker.observeMessage(message('p1', 'from and to?', true)), false);
    assert.equal(opens, 0);
});

test('repeated final events do not recreate completed or oversized persona messages', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    tracker.observeMessage(message('p1', 'Hello.', true));
    assert.equal(tracker.observeMessage(message('p1', 'Where are you moving from and to?', true)), false);
    tracker.observeMessage(message('p2', 'A'.repeat(4_097)));
    assert.equal(tracker.observeMessage(message('p2', 'Where are you moving from and to?', true)), false);
    assert.equal(opens, 0);
});

test('disposing while chunks are pending prevents a late final from opening the panel', () => {
    let opens = 0;
    const tracker = createEvanPlannerAutoOpen({ onOpenRoute: () => opens++ });
    tracker.observeMessage(message('p1', 'Where are you moving '));
    tracker.dispose();
    assert.equal(tracker.observeMessage(message('p1', 'from and to?', true)), false);
    assert.equal(opens, 0);
});
