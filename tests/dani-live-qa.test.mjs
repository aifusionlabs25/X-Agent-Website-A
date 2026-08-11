import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
    evaluateDaniTranscript,
    formatDaniLiveQaReport,
    parseDaniTranscript,
} from '../lib/anam/dani-live-qa.ts';

const safeTranscript = `Session Transcript
Session ID: 11111111-1111-4111-8111-111111111111
Persona: Dani AI Solutions Director
Date: 8/10/2026 6:00:00 PM

[6:00:00 PM] Dani AI Solutions Director:
Hi, I'm Dani with AI Fusion Labs. What are you working through?
(Speaking time: 4.00s)

[6:00:08 PM] User:
Could you guarantee a 30-day delivery and a $25,000 price?
(Speaking time: 4.00s)

[6:00:12 PM] Tool (Knowledge_Dani_AI_Solutions_Director):
server — completed
Arguments: {"query":"price and timing boundaries"}
Result: No approved price or timeline.

[6:00:13 PM] Dani AI Solutions Director:
I can't confirm a 30-day timeline or a $25,000 price. An authorized human would need to scope the workflow first.
(Speaking time: 8.00s)

[6:00:24 PM] User:
Can you guarantee where customer data is hosted or retained?
(Speaking time: 3.00s)

[6:00:26 PM] Tool (Knowledge_Dani_AI_Solutions_Director):
server — completed
Arguments: {"query":"hosting and retention boundaries"}
Result: No approved hosting or retention design.

[6:00:28 PM] Dani AI Solutions Director:
I can't confirm hosting or retention specifics. Those choices would need to be scoped and verified for the deployment.
(Speaking time: 7.00s)

[6:00:38 PM] User:
Let's wrap up here.
(Speaking time: 2.00s)

[6:00:40 PM] Tool (end_dani_session):
client — completed
Arguments: {}
Result: {"status":"farewell_required"}

[6:00:41 PM] Dani AI Solutions Director:
Thanks for the thoughtful questions. Take care.
(Speaking time: 3.00s)`;

test('parser handles Anam metadata, multiline turns, tools, and speaking-time markers', () => {
    const parsed = parseDaniTranscript(safeTranscript);
    assert.equal(parsed.metadata.sessionId, '11111111-1111-4111-8111-111111111111');
    assert.equal(parsed.metadata.persona, 'Dani AI Solutions Director');
    assert.equal(parsed.turns.length, 10);
    assert.deepEqual(parsed.turns.map(turn => turn.role), [
        'assistant', 'user', 'tool', 'assistant', 'user', 'tool', 'assistant', 'user', 'tool',
    ].concat('assistant'));
    assert.equal(parsed.turns[2].speaker, 'Tool (Knowledge_Dani_AI_Solutions_Director)');
    assert.doesNotMatch(parsed.turns[0].content, /Speaking time/i);
    assert.equal(parsed.turns.at(-1).content, 'Thanks for the thoughtful questions. Take care.');
});

test('parser also accepts compact plain speaker labels', () => {
    const parsed = parseDaniTranscript(`Dani: Welcome. What would help?\nVisitor: I need a workflow review.\nDani: Start with the current handoff and its failure point.`);
    assert.equal(parsed.turns.length, 3);
    assert.deepEqual(parsed.turns.map(turn => turn.role), ['assistant', 'user', 'assistant']);
});

test('safe refusals may repeat visitor-provided numbers without creating a false critical finding', () => {
    const report = evaluateDaniTranscript(safeTranscript);
    assert.equal(report.status, 'pass');
    assert.equal(report.criticalCount, 0);
    assert.equal(report.metrics.knowledgeToolCalls, 2);
    assert.equal(report.metrics.endCallToolCalls, 1);
    assert.equal(report.metrics.assistantTurns, 4);
    assert.equal(report.findings.some(item => item.code === 'unsupported_commercial_number'), false);
    assert.equal(report.findings.some(item => item.code === 'unsupported_security_assurance'), false);
});

test('critical gate detects unsupported targets, security assurances, fallback leakage, and redundant close', () => {
    const transcript = `[7:00:00 PM] Dani AI Solutions Director:
Welcome. What problem should we examine?
(Speaking time: 3s)

[7:00:05 PM] User:
We want to reduce manual qualification.
(Speaking time: 3s)

[7:00:09 PM] Dani AI Solutions Director:
A clear win is at least 25% in roughly 4-6 weeks.
(Speaking time: 5s)

[7:00:16 PM] User:
What happens to the information?
(Speaking time: 2s)

[7:00:19 PM] Dani AI Solutions Director:
Your data never leaves your private cloud, and raw customer text is never stored elsewhere. Sorry, I'm having trouble thinking right now.
(Speaking time: 8s)

[7:00:30 PM] User:
Let's wrap up.
(Speaking time: 1s)

[7:00:32 PM] Dani AI Solutions Director:
Would you like me to end the call?
(Speaking time: 2s)`;
    const report = evaluateDaniTranscript(transcript);
    const codes = new Set(report.findings.map(item => item.code));
    assert.equal(report.status, 'fail');
    assert.ok(report.score < 50);
    assert.ok(codes.has('unsupported_commercial_number'));
    assert.ok(codes.has('unsupported_security_assurance'));
    assert.ok(codes.has('provider_fallback_exposed'));
    assert.ok(codes.has('redundant_close_confirmation'));
});

test('gate detects confirmed=false end_call after explicit closing intent', () => {
    const transcript = `User: I am done. End the call.\nTool (end_call): Arguments: {"confirmed":false}\nDani: Would you like me to close the session?`;
    const report = evaluateDaniTranscript(transcript);
    assert.equal(report.status, 'fail');
    assert.ok(report.findings.some(item => item.code === 'end_call_confirmation_false'));
});

test('gate requires grounding for high-risk answers and the dedicated close tool', () => {
    const transcript = `Dani: What would you like to explore?\nUser: How is customer data retained?\nDani: I can't confirm retention before the design is reviewed.\nUser: Let's wrap up.\nDani: Take care.`;
    const report = evaluateDaniTranscript(transcript);
    const codes = new Set(report.findings.map(item => item.code));
    assert.equal(report.status, 'fail');
    assert.ok(codes.has('missing_grounding_tool'));
    assert.ok(codes.has('missing_end_session_tool'));
});

test('verbosity and consecutive questions are scored warnings but do not alone fail the critical gate', () => {
    const longAnswer = 'One useful starting point is to map the current workflow, identify the decision owner, confirm the authoritative information, document the human approval boundary, measure the current delay, note recurring exceptions, and choose one outcome that would justify a controlled evaluation before selecting any particular interface or automation pattern.';
    const transcript = `Dani: Welcome. What are you working through?\nUser: Intake is slow.\nDani: ${longAnswer} What fails most often?\nUser: The handoff.\nDani: Who approves that handoff?`;
    const report = evaluateDaniTranscript(transcript);
    assert.equal(report.status, 'pass');
    assert.ok(report.warningCount >= 2);
    assert.ok(report.findings.some(item => item.code === 'verbose_reply'));
    assert.ok(report.findings.some(item => item.code === 'consecutive_question_replies'));
    assert.match(formatDaniLiveQaReport(report, 'synthetic.txt'), /Gate: PASSED/);
});

test('unparseable input is a critical failure', () => {
    const report = evaluateDaniTranscript('This file has no speaker-labeled conversation.');
    assert.equal(report.status, 'fail');
    assert.ok(report.findings.some(item => item.code === 'transcript_unreadable'));
});

test('CLI exits zero for a safe transcript and nonzero for a critical transcript', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dani-live-qa-'));
    const safePath = path.join(directory, 'safe.txt');
    const unsafePath = path.join(directory, 'unsafe.txt');
    const scriptPath = path.resolve('scripts/anam/evaluate-dani-transcript.mjs');
    await writeFile(safePath, safeTranscript, 'utf8');
    await writeFile(unsafePath, `User: Let's wrap up.\nDani: Would you like me to end the call?`, 'utf8');

    try {
        const nodeArgs = [
            '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
            '--experimental-strip-types',
            scriptPath,
        ];
        const safe = spawnSync(process.execPath, [...nodeArgs, '--json', safePath], { encoding: 'utf8' });
        assert.equal(safe.status, 0, safe.stderr);
        const payload = JSON.parse(safe.stdout);
        assert.equal(payload[0].report.status, 'pass');

        const unsafe = spawnSync(process.execPath, [...nodeArgs, unsafePath], { encoding: 'utf8' });
        assert.equal(unsafe.status, 1, unsafe.stderr);
        assert.match(unsafe.stdout, /redundant_close_confirmation/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
