import assert from 'node:assert/strict';
import test from 'node:test';
import { isEvanRouteIntakeQuestion } from '../lib/anam/evan-planner-auto-open.ts';

test('recognizes the exact failed live-session intake question with its conditional lead-in', () => {
    assert.equal(isEvanRouteIntakeQuestion('If you’d like to discuss a new move, could you share the city you’re moving from and the city you’re moving to?'), true);
});

test('recognizes friendly acknowledgments and intentional move-intake lead-ins', () => {
    for (const phrase of [
        'Perfect, where are you moving from and to?',
        'Great—where are you moving from and to?',
        'Absolutely! Could you share your pickup and delivery addresses?',
        'Of course, what is your destination address?',
        'Sounds good: what city are you moving from?',
        'If you are ready, could you tell me where you are moving from and to?',
        'When you are ready, what is the pickup address?',
        "If you'd like, could you share your destination address?",
        "Let's start with the basics: where are you moving from and where are you moving to?",
        'Let us begin with the locations—what is your pickup address?',
        'Before we go further, where are you moving from?',
        'Just so I understand, what city are you moving to?',
        'To help organize your move, could you share your pickup location?',
        "Okay, perfect—if you'd like to plan your move, could you share your origin and destination?",
    ]) assert.equal(isEvanRouteIntakeQuestion(phrase), true, phrase);
});

test('recognizes direct but polite requests for actual route locations', () => {
    for (const phrase of [
        "Tell me where you're moving from and to.",
        'Please share your pickup and delivery addresses.',
        'Let me know your destination address.',
        'Give me the city you are moving from.',
        'Confirm your pickup address, please.',
        "Can I start with where you're moving from and to?",
        "Let's start with where you're moving from.",
        'Could I ask where you are moving to?',
        'Can you share the starting point and destination?',
        'Could you confirm your origin and destination?',
        'What city is your current home in, and what city is the new home in?',
        'Which town is your new house in?',
    ]) assert.equal(isEvanRouteIntakeQuestion(phrase), true, phrase);
});

test('does not treat quoted, reported, or hypothetical route questions as live intake', () => {
    for (const phrase of [
        'The example is "Where are you moving from and to?"',
        '"Where are you moving from and to?" is a sample question.',
        'Here is a sample script: "Hello. Where are you moving from and to?"',
        'A sample says “Welcome. Could you share your pickup address?”',
        "You asked: where are you moving from and to?",
        "The rep might ask, 'Could you share your pickup address?'",
        'I can ask where you are moving from later.',
        'Earlier I asked where you were moving from.',
        'Great, for example, where are you moving from and to?',
        'If you were moving next year, where would you be moving from?',
        'Hypothetically, could you share your origin and destination?',
        'Suppose a caller asked where you are moving from and to.',
        'Can you tell me where you would be moving from if you were relocating?',
        "If you'd like to imagine a new move, could you share the pickup address?",
        'Can you tell me why you need my pickup address?',
        'Could you tell me whether there are stairs at the destination address?',
        'Can you share an example of where people are moving from and to?',
    ]) assert.equal(isEvanRouteIntakeQuestion(phrase), false, phrase);
});

test('friendly prefixes and imperative requests do not bypass non-location guards', () => {
    for (const phrase of [
        'Perfect, when are you moving?',
        'If you are ready, can you share your email address?',
        'Please tell me your phone number.',
        'Tell me the price for moving from one city to another.',
        'Can you share what time pickup at the origin address begins?',
        'Please share the insurance policy for the destination address.',
        'Could you tell me the delivery time for the destination?',
        'Tell me what services are available at the pickup address.',
        'Let me know what information you need about the pickup address.',
        'Please confirm the date for the pickup address.',
        'What city has the best packing services?',
        "Let's start with the basics: how many rooms are you moving?",
        'Could you share your pickup and',
        "If you'd like to discuss a new move, could you share the city you're moving",
    ]) assert.equal(isEvanRouteIntakeQuestion(phrase), false, phrase);
});
