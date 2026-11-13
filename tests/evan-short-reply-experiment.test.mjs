import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { diagnosticLedgerName, prepareDiagnosticPrompt, removeDiagnosticInstruction, RECOVERY_INSTRUCTION } from '../scripts/anam/evan-short-reply-experiment.mjs';

const checkpoint = JSON.parse(fs.readFileSync(new URL('../config/anam/evan/demo-checkpoint.json', import.meta.url), 'utf8'));
const source = checkpoint.persona.brain.systemPrompt;

test('unchanged diagnostic returns the exact stable prompt', () => {
    assert.equal(prepareDiagnosticPrompt(source), source);
    assert.equal(createHash('sha256').update(source.trim() + '\n').digest('hex'), checkpoint.managedPromptSha256);
});
test('recovery experiment adds exactly one paragraph without modifying original instructions', () => {
    const candidate = prepareDiagnosticPrompt(source, 'recovery-v1');
    assert.equal(removeDiagnosticInstruction(candidate), source);
    assert.equal(candidate.split(RECOVERY_INSTRUCTION).length, 2);
    // Entire remainder, including all closing, tool and email sections, is untouched.
    assert.equal(candidate.slice(candidate.indexOf('## Source hierarchy')), source.slice(source.indexOf('## Source hierarchy')));
    assert.equal(candidate.slice(0, candidate.indexOf('## Recovering a restarted request')), source.slice(0, source.indexOf('## Source hierarchy')));
});
test('experiment refuses drifted anchors, duplicate insertion and unknown variants', () => {
    assert.throws(() => prepareDiagnosticPrompt('different prompt', 'recovery-v1'));
    assert.throws(() => prepareDiagnosticPrompt(source + '\n## Source hierarchy', 'recovery-v1'));
    assert.throws(() => prepareDiagnosticPrompt(prepareDiagnosticPrompt(source, 'recovery-v1'), 'recovery-v1'));
    assert.throws(() => prepareDiagnosticPrompt(source, 'arbitrary'));
});
test('new approval has a fixed separate ledger; exhausted original is not reset', () => {
    assert.equal(diagnosticLedgerName(), 'evan-short-reply-diagnostics.json');
    assert.equal(diagnosticLedgerName('recovery-v1'), 'evan-short-reply-recovery-v1-approval-2026-11-13.json');
    assert.throws(() => diagnosticLedgerName('../../arbitrary'));
});
