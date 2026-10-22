import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const prompt = readFileSync(new URL('../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const section = (heading) => {
    const text = prompt.split(`## ${heading}\n`)[1];
    assert.ok(text, `Missing ${heading} section`);
    return text.split('\n## ')[0];
};

test('Qwen candidate puts the visitor-facing decision order before detailed intake rules', () => {
    const priority = section('Conversation priority');
    assert.ok(prompt.indexOf('## Conversation priority') < prompt.indexOf('## Spoken conversation style'));
    assert.match(priority, /answer their direct question, accept their correction, or handle their explicit planner request before starting a new intake topic/);
    assert.match(priority, /Before asking about a new intake topic, check whether a stated pickup or destination city is unclear/);
    assert.match(priority, /ask one short question only about a useful detail the visitor has not already supplied, then stop/);
    assert.match(priority, /Do not fill silence by asking again/);
    assert.match(priority, /Never speak internal planning, reasoning, tool names, transcript labels, or process statements/);
    assert.match(section('Spoken conversation style'), /Do not reconfirm a clearly stated city merely because it is consequential/);
    assert.match(section('Accuracy and speech-recognition safety'), /Do not ask to reconfirm a city already clear from the caller's completed answer/);
    assert.ok(prompt.trim().split(/\s+/).length < 3500, 'The managed prompt must stay below the Qwen consolidation budget');
});

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
    assert.match(style, /Label possible stops, dates, and services as tentative/);
    assert.match(style, /not a committed service/);
    assert.match(style, /Do not invent a route endpoint/);
    assert.match(style, /possible help for staff to review/);
});

test('run-thirty-two does not infer a smaller home or commit tentative packing help', () => {
    const style = section('Spoken conversation style');
    assert.match(style, /A box count and furniture list do not establish a studio, bedroom count, or home size/);
    assert.match(style, /ask about the property size instead of guessing it/);
    assert.match(style, /"Could someone help" or "might want" packing is possible help/);
    assert.match(style, /never promise it for this move/);
    assert.match(style, /the caller asked about possible help, not that packing help is included/);
});

test('voice email is optional, without repeat asks or claims of delivery during the call', () => {
    const followUp = section('Tools and action honesty');
    assert.match(followUp, /voluntarily during the call; either permits one post-call recap/);
    assert.match(followUp, /do not sell it repeatedly or make email a condition for help/);
    assert.match(followUp, /Do not claim Mullins delivery or a booked callback/);
    assert.match(followUp, /If the visitor asks whether a recap is scheduled, call `send_mullins_follow_up_email`/);
});

test('city recognition ambiguity requires a narrow clarification, not geographic guessing', () => {
    const accuracy = section('Accuracy and speech-recognition safety');
    assert.match(accuracy, /Never silently guess or change[^\n]+email address, city, street address/);
    assert.match(accuracy, /ask one short clarification about that city before using it/);
    assert.match(accuracy, /Do not silently substitute a familiar nearby city/);
    assert.match(accuracy, /clarify its role without supplying an unspoken second city/);
});

test('run-thirty-three unfamiliar destination and guest retention wording remain accurate', () => {
    const accuracy = section('Accuracy and speech-recognition safety');
    assert.match(accuracy, /If a city sounds unfamiliar or inconsistent with the stated state, ask for the spelling or ZIP/);
    assert.match(accuracy, /wait before moving to home size or the next topic/);
    assert.match(accuracy, /Do not say "got it" or repeat that uncertain city as a confirmed route/);
    const followUp = section('Estimates, pricing, dates, and scheduling');
    assert.match(followUp, /Do not claim "no details are on file" or that nothing was saved/);
    assert.match(followUp, /No email recap or callback is arranged from this conversation/);
});

test('turn-boundary hardening preserves contact privacy, address confirmation, and the existing farewell handshake', () => {
    assert.match(section('Accuracy and speech-recognition safety'), /voluntarily shared email permits one post-call recap/);
    assert.match(section('Tools and action honesty'), /Do not submit a street address to the planner until the visitor clearly confirms it/);
    const closing = section('Non-negotiable call-ending protocol');
    assert.match(closing, /Call `end_mullins_session` immediately/);
    assert.match(closing, /`farewell_required`[^\n]+Thank you for speaking with Mullins Moving\. Take care\./);
    assert.match(closing, /Never ask permission to end/);
});

test('run-forty-four bundled contact has one complete readback and a consistent guest next step', () => {
    const accuracy = section('Accuracy and speech-recognition safety');
    const nextStep = section('Estimates, pricing, dates, and scheduling');
    assert.match(accuracy, /If they volunteer several contact details in one answer, keep all of them/);
    assert.match(accuracy, /Read back the full name, phone, and email they supplied once/);
    assert.match(accuracy, /If a name or email came with it, include those in the same readback/);
    assert.match(nextStep, /If a guest who shared contact details asks what happens next/);
    assert.match(nextStep, /They will follow up within 24 to 48 hours/);
    assert.match(nextStep, /Never describe direct contact as the only next step/);
});

test('a rejected premature close is not treated as a failed tool or a reason to repeat a phone question', () => {
    const closing = section('Non-negotiable call-ending protocol');
    assert.match(closing, /`continue_conversation` is a deliberate refusal, not a tool failure/);
    assert.match(closing, /do not say goodbye, retry the tool, restart a readback, or repeat a question/);
    assert.match(closing, /If you have already spoken since the caller's latest completed answer, stop and listen/);
    assert.match(closing, /Only `farewell_required` authorizes/);
    assert.doesNotMatch(closing, /If the tool is unavailable or fails, say the same brief farewell/);
    const accuracy = section('Accuracy and speech-recognition safety');
    assert.match(accuracy, /Stop immediately after that question/);
    assert.match(accuracy, /do not read the number a second time in another format/);
    assert.match(accuracy, /or call any tool while awaiting their answer/);
});

test('run-eleven prompt addresses premature ending, nonresponsive inventory, transcription labels and response time', () => {
    assert.match(section('Non-negotiable call-ending protocol'), /A normal answer to a pickup, destination, date, or home-size question is never a request to end/);
    assert.match(section('Non-negotiable call-ending protocol'), /clarify only the specific city name once/);
    assert.match(section('Opening and intake'), /answers an inventory question with another useful detail/);
    assert.match(section('Accuracy and speech-recognition safety'), /Never speak transcript or turn-taking labels/);
    assert.match(section('Estimates, pricing, dates, and scheduling'), /If routing is unavailable, say you cannot confirm a response time/);
});

test('run-fourteen discovery waits through partial answers and does not force another size question or a wrap-up', () => {
    const style = section('Spoken conversation style');
    const intake = section('Opening and intake');
    const closing = section('Non-negotiable call-ending protocol');
    assert.match(style, /A pause, a partial phrase, or a useful side detail is not the end of the caller's answer/);
    assert.match(style, /do not announce that you missed their answer, repeat your question, move to the next intake topic/i);
    assert.match(intake, /After the caller finishes, if major furniture and the approximate box count are both still unknown and relevant/);
    assert.match(intake, /Stop speaking after the question/);
    assert.match(intake, /Do not repeat it because the caller pauses or answers with another useful detail/);
    assert.match(closing, /A close requires a completed, explicit closing statement from the caller/);
    assert.match(closing, /do not turn the refusal into another question or a wrap-up/);
    assert.match(section('Estimates, pricing, dates, and scheduling'), /Do not follow a response-time answer with a generic/);
});
