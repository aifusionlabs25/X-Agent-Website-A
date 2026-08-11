import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    AMY_CONVERSATION_END_MARKER,
    AMY_CONVERSATION_START_MARKER,
    installAmyConversationBlock,
} from '../scripts/anam/amy-conversation-prompt.mjs';

const prompt = await readFile(
    new URL('../config/anam/amy-conversation-naturalness-upgrade.md', import.meta.url),
    'utf8',
);
const baseBehavior = await readFile(
    new URL('../config/anam/amy-cara4-behavior-upgrade.md', import.meta.url),
    'utf8',
);
const updater = await readFile(
    new URL('../scripts/anam/update-amy-conversation.mjs', import.meta.url),
    'utf8',
);
const readiness = await readFile(
    new URL('../lib/anam/persona-readiness.ts', import.meta.url),
    'utf8',
);
const websocketSmoke = await readFile(
    new URL('../scripts/anam/smoke-amy-websocket.mjs', import.meta.url),
    'utf8',
);

test('Amy uses human conversational rhythm without exposing qualification mechanics', () => {
    assert.match(prompt, /connect, listen, acknowledge/i);
    assert.match(prompt, /small useful observation/i);
    assert.match(prompt, /Answer a direct question meaningfully before asking/i);
    assert.match(prompt, /Do not end every response with a question/i);
    assert.match(prompt, /end two consecutive substantive responses with questions/i);
    assert.match(prompt, /situational rapport/i);
    assert.match(prompt, /Never say that a certain number of facts is required/i);
    assert.doesNotMatch(baseBehavior, /at least three confirmed facts/i);
});

test('Amy recognizes executive altitude and preserves her SDR mental model', () => {
    assert.match(prompt, /CIO, CTO, COO, CEO, CFO, VP, SVP/i);
    assert.match(prompt, /Start one altitude higher/i);
    assert.match(prompt, /AI-powered Inside Sales Development Representative/i);
    assert.match(prompt, /don't replace an architect or account executive/i);
    assert.match(prompt, /don't start from zero/i);
    assert.match(prompt, /First establish the outcome/i);
    assert.match(prompt, /Then learn the relevant context/i);
    assert.match(prompt, /Then clarify the constraint/i);
});

test('Amy keeps claim, handoff, and artifact guardrails intact', () => {
    assert.match(prompt, /Do not repeat "specialist" as a reflex/i);
    assert.match(prompt, /handoff is earned/i);
    assert.match(prompt, /call the matching tool instead of merely describing/i);
    assert.match(prompt, /working view based on the conversation/i);
    assert.match(prompt, /Never invent or imply confirmed products.*certifications.*contract eligibility/s);
    assert.match(prompt, /Keep technology fit, compliance, procurement, contract vehicles, funding.*distinct/s);
    assert.match(prompt, /approved attached knowledge source/i);
});

test('Amy treats student-risk AI and compressed board timelines as high-impact discovery', () => {
    assert.match(prompt, /student-retention or at-risk-student scenarios/i);
    assert.match(prompt, /privacy and institutional policy/i);
    assert.match(prompt, /fairness and explainability expectations/i);
    assert.match(prompt, /required human review/i);
    assert.match(prompt, /counseling, financial-aid, disability, health/i);
    assert.match(prompt, /de-identified or synthetic data/i);
    assert.match(prompt, /three-day deadline may support a board-ready concept, mockup, or tightly bounded feasibility demonstration/i);
    assert.match(prompt, /never call a student-risk model validated, production-ready, or feasible/i);
    assert.match(prompt, /Do not name products, prescribe data pipelines, or promise a pilot timeline/i);
});

test('Amy live updater is dry-run first, identity-pinned, backed up, and drift-checked', () => {
    assert.match(updater, /mode: 'dry-run'/);
    assert.match(updater, /CONFIRM_AMY_CONVERSATION_SYNC/);
    assert.match(updater, /expected-current-sha256/);
    assert.match(updater, /backup-dir/);
    assert.match(updater, /flag: 'wx'/);
    assert.match(updater, /protected provider configuration changed/i);
    assert.match(updater, /0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08/);
    assert.match(readiness, /AMY_CONVERSATION_NATURALNESS_START/);
    assert.match(readiness, /AMY_CONVERSATION_NATURALNESS_END/);
});

test('Amy conversation block installation is front-loaded, replaceable, and idempotent', () => {
    const first = installAmyConversationBlock('BASE\r\nPROMPT', prompt);
    assert.ok(first.startsWith(AMY_CONVERSATION_START_MARKER));
    assert.match(first, /AMY_CONVERSATION_NATURALNESS_END -->\n\nBASE\nPROMPT\n$/);
    assert.equal(installAmyConversationBlock(first, prompt), first);

    const revised = prompt.replace('brief synthesis beats a full recap.', 'synthesize before continuing.');
    const replaced = installAmyConversationBlock(first, revised);
    assert.match(replaced, /synthesize before continuing/);
    assert.doesNotMatch(replaced, /brief synthesis beats a full recap/);
    assert.equal(replaced.split(AMY_CONVERSATION_START_MARKER).length - 1, 1);
    assert.equal(replaced.split(AMY_CONVERSATION_END_MARKER).length - 1, 1);
    assert.match(replaced, /BASE\nPROMPT\n$/);
});

test('Amy conversation block installer refuses malformed managed markers', () => {
    assert.throws(
        () => installAmyConversationBlock(`${AMY_CONVERSATION_START_MARKER}\nbroken`, prompt),
        /markers are malformed/i,
    );
});

test('Amy WebSocket smoke test is identity-pinned and exposes no credentials', () => {
    assert.match(websocketSmoke, /0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08/);
    assert.match(websocketSmoke, /\/auth\/session-token/);
    assert.match(websocketSmoke, /\/engine\/session/);
    assert.match(websocketSmoke, /new WebSocket\(socketUrl\)/);
    assert.match(websocketSmoke, /socket\.close\(1000, 'smoke-test-complete'\)/);
    assert.match(websocketSmoke, /websocketCloseRequested: true/);
    assert.doesNotMatch(websocketSmoke, /console\.log\([^)]*(apiKey|sessionToken|engine\.sessionId)/s);
});
