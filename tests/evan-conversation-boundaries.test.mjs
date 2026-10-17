import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const prompt = readFileSync(new URL('../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const section = (heading) => {
    const text = prompt.split(`## ${heading}\n`)[1];
    assert.ok(text, `Missing ${heading} section`);
    return text.split('\n## ')[0];
};

// These are source-contract regressions, not evidence that a live model obeys
// the instructions. Replay the observed conversation and inspect provider audio
// and transcript roles before considering the spoken behavior verified.
test('a question creates an explicit stop-and-wait boundary, not another question or self-answer', () => {
    const style = section('Spoken conversation style');
    assert.match(style, /Ask a question only once, then end your turn and wait for the caller's actual reply/);
    assert.match(style, /Do not rephrase or repeat the question within the same turn/);
    assert.match(style, /or answer it yourself/);
});

test('only the caller can supply or explicitly confirm their facts', () => {
    const style = section('Spoken conversation style');
    assert.match(style, /Speak only as Evan/);
    assert.match(style, /Never simulate the caller's reply, continue both sides of a conversation, or invent caller details/);
    assert.match(style, /A question you asked is not evidence of its answer/);
    assert.match(style, /use only details the caller supplied or explicitly confirmed/);
});

test('intake questions do not combine unrelated topics into one turn', () => {
    const style = section('Spoken conversation style');
    assert.match(style, /Ask about one intake topic at a time/);
    assert.match(style, /Do not combine unrelated fields into one question/);
    assert.match(style, /pickup city and the move date/);
});

test('unknown or unanswered intake fields do not cause repeated questioning pressure', () => {
    const style = section('Spoken conversation style');
    assert.match(style, /acknowledge those details and follow their lead/);
    assert.match(style, /Do not immediately repeat the unanswered question or keep returning to it on successive turns/);
    assert.match(style, /accept that field as unknown and continue/);
    assert.match(style, /do not ask for it again unless they bring it back up/);
    assert.match(style, /Missing information does not prevent a helpful conversation/);
});

test('multi-fact answers do not force a full recap or a mandatory next question', () => {
    const style = section('Spoken conversation style');
    assert.match(style, /retain all of them without reciting every fact/);
    assert.match(style, /Ask at most one useful question about a genuinely missing detail, or stop when no question is needed/);
    assert.doesNotMatch(prompt, /Ask exactly one useful next question|explicitly restate each key supplied fact/);
});

test('answered details are not reconfirmed without a specific new reason', () => {
    const style = section('Spoken conversation style');
    assert.match(style, /Once the caller has supplied or confirmed a detail, use it without asking again/);
    assert.match(style, /Clarify only a new conflict, a correction, or missing precision/);
    assert.match(style, /ask about that detail alone rather than restarting a completed intake slot/);
});

test('tentative plans remain possible and missing route endpoints are not invented', () => {
    const style = section('Spoken conversation style');
    assert.match(style, /Label a possible city, date, or extra stop as tentative/);
    assert.match(style, /Do not turn it into a confirmed route or service request/);
    assert.match(style, /or invent the other endpoint of a move/);
});

test('city recognition ambiguity requires a narrow clarification, not geographic guessing', () => {
    const accuracy = section('Accuracy and speech-recognition safety');
    assert.match(accuracy, /Never silently guess or change[^\n]+email address, city, street address/);
    assert.match(accuracy, /ask one short clarification about that city before using it/);
    assert.match(accuracy, /Do not silently substitute a familiar nearby city/);
    assert.match(accuracy, /clarify its role without supplying an unspoken second city/);
});

test('turn-boundary hardening preserves contact privacy, address confirmation, and the existing farewell handshake', () => {
    assert.match(section('Accuracy and speech-recognition safety'), /Never ask for, spell, repeat, or confirm an email address/);
    assert.match(section('Tools and action honesty'), /Do not submit a street address to the planner until the visitor clearly confirms it/);
    const closing = section('Non-negotiable call-ending protocol');
    assert.match(closing, /Call `end_mullins_session` immediately/);
    assert.match(closing, /`farewell_required`[^\n]+Thank you for speaking with Mullins Moving\. Take care\./);
    assert.match(closing, /Never ask permission to end/);
});
