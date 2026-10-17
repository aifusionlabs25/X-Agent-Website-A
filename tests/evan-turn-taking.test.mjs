import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const prompt = await readFile(new URL('../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../config/anam/evan/persona-manifest.json', import.meta.url), 'utf8'));

// These check the managed prompt contract, not a simulated model decision.
// Live audio testing is still needed to verify the model follows these rules.
test('a completed contact answer requires a response even when its callback phrase is unclear', () => {
    assert.match(prompt, /A completed answer, confirmation, correction, contact detail, communication preference, or callback window requires a brief relevant response/i);
    assert.match(prompt, /even if it begins with "sure," "yeah," or "okay," or its final words are unclear/i);
    assert.match(prompt, /Do not skip an entire turn because one detail needs clarification/i);
    assert.match(prompt, /Never silently guess or change a person's name, phone number, email address, street address, date, time/i);
    assert.match(prompt, /never repeat a spoken email address/i);
});

test('skip_turn is restricted to actual waiting and non-answer backchannels', () => {
    assert.match(prompt, /Use `skip_turn` only when the caller explicitly asks you to wait/i);
    assert.match(prompt, /is still speaking mid-thought without completing an answer/i);
    assert.match(prompt, /a pure backchannel that does not answer your last question/i);
    assert.match(prompt, /Use `skip_turn` only under the waiting rule above/i);
    assert.match(prompt, /Never use it instead of responding to a completed answer or clarifying a consequential detail/i);
    assert.doesNotMatch(prompt, /use `skip_turn` for backchannels, incomplete speech, or moments when waiting is most natural/i);
    assert.doesNotMatch(prompt, /If an utterance is only a backchannel[\s\S]{0,120}or is clearly incomplete, use `skip_turn`/i);
});

test('a short answer to phone confirmation is not treated as silence or closing', () => {
    assert.match(prompt, /repeat it once in that grouped spoken form and ask only, "Did I get that right\?"/i);
    assert.match(prompt, /A short "yes," "yeah," or "that's right" answers your confirmation question; acknowledge it and continue instead of using `skip_turn`/i);
    assert.match(prompt, /If it answers your last question, treat it as an answer and continue naturally/i);
    assert.match(prompt, /short acknowledgment without closing language is not closing intent/i);
});

test('unclear callback timing is clarified after the number without guessing or stacking questions', () => {
    assert.match(prompt, /If the callback window is unclear, finish confirming the number first, then ask one short clarification: "What time of day works best for a callback\?"/i);
    assert.match(prompt, /Do not guess the intended time or go silent because the final phrase was unclear/i);
    assert.match(prompt, /Wait for confirmation before moving to another question/i);
    assert.match(prompt, /at most one meaningful next question/i);
});

test('turn-taking correction preserves patient speech detection and phone/email privacy', () => {
    assert.deepEqual(manifest.voiceDetectionOptions, {
        endOfSpeechSensitivity: 0.05,
        silenceBeforeAutoEndTurnSeconds: 3,
        silenceBeforeSkipTurnSeconds: 0,
        silenceBeforeSessionEndSeconds: 0,
        speechEnhancementLevel: 0.7,
    });
    assert.match(prompt, /Say every digit separately in three groups/i);
    assert.match(prompt, /Say zero as "oh"/i);
    assert.match(prompt, /Never ask for, spell, repeat, or confirm an email address during the conversation/i);
});
