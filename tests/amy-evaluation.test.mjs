import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { evaluationTurns } from './fixtures/amy-evaluation-rehearsal.mjs';
import { amyConversationMode } from '../lib/anam/amy-evaluation.ts';
import { hasAmyCapabilityOverviewIntent } from '../lib/anam/amy-capability-intent.ts';
import { requestedAmyArtifact } from '../lib/anam/amy-artifact-operation.ts';
import { buildAmyWorkbenchModel } from '../lib/anam/workbench-v2.ts';
import { buildAmyWorkbenchReceiptDetails } from '../lib/anam/amy-workbench-receipt.ts';
import { buildAmyEmailBundle } from '../lib/anam/agentmail-templates.ts';
import { inspectAmyLiveOutput } from '../lib/anam/amy-live-output-guard.ts';
import { evaluateAmyTranscript, AMY_CANONICAL_GREETING } from '../lib/anam/amy-live-qa.ts';

test('536e14b9: evaluator mode survives every question, email request and farewell', () => {
    for (let end = 2; end <= evaluationTurns.length; end++) {
        const model = buildAmyWorkbenchModel(evaluationTurns.slice(0, end));
        assert.equal(model.conversationKind, 'evaluation', `turn ${end}`);
        assert.equal(model.brief.openQuestions.length, 0);
        assert.doesNotMatch(JSON.stringify(model.facts), /Primary guardrail|can't or shouldn't|250 devices/);
    }
});

test('capability paraphrases and plural brief requests cover the rehearsal', () => {
    for (const turn of evaluationTurns.slice(1, 4)) assert.ok(hasAmyCapabilityOverviewIntent(turn.content), turn.content);
    for (const text of ['Show me what one of these briefs looks like.', 'Show me an example brief.', 'Open the sample briefs.', 'Show me a visual.']) assert.equal(requestedAmyArtifact(text), 'visual');
    for (const text of ["Don't show me a brief.", 'Email me the brief.', 'Show me a customer example.', 'Show me pricing in the catalog.', 'Goodbye, show me the brief.']) assert.equal(requestedAmyArtifact(text), null);
});

test('fictional sample has explicit labels on every slide and never becomes customer evidence', () => {
    const model = buildAmyWorkbenchModel(evaluationTurns, 'An invented $500M opportunity', 'SKU-123', 'visual');
    assert.equal(model.visualBrief.slides.length, 3);
    for (const slide of model.visualBrief.slides) {
        assert.match(slide.eyebrow, /FICTIONAL EXAMPLE/);
        assert.match(slide.boundary, /not your organization/);
    }
    assert.doesNotMatch(JSON.stringify(model.facts), /250|two offices|SKU|500M|workstation/);
    assert.match(buildAmyWorkbenchReceiptDetails(model, 'visual', []).spokenConfirmation, /fictional sample.*not a real customer/);
});

test('all three recap lanes describe evaluation; sample attachments and invented pursuit are excluded', () => {
    const model = buildAmyWorkbenchModel(evaluationTurns);
    const bundle = buildAmyEmailBundle({ model, turns: evaluationTurns, displayName: 'Checked In Visitor', verifiedEmail: 'typed@example.com', externalSessionId: 'evaluation-regression', sessionStartedAt: '2026-09-02T23:25:17Z', sessionEndedAt: '2026-09-02T23:27:41Z', displayedArtifactView: 'visual' });
    for (const email of Object.values(bundle)) {
        assert.match(email.text, /evaluat/i);
        assert.doesNotMatch(email.text, /Assign an Insight opportunity owner|Primary guardrail|What outcome would|250 devices|two offices/);
        assert.equal(email.attachments, undefined);
    }
    assert.match(bundle.visitor.html, /What you explored/);
    assert.match(bundle.intake.html, /no customer opportunity established/);
    assert.match(bundle.intake.text, /Checked In Visitor/);
    assert.match(bundle.intake.text, /typed@example.com/);
    assert.match(bundle.admin.text, /2m 24s/);
    assert.match(bundle.admin.text, /Transcript turns captured: 10/);
});

test('real discovery survives capability questions; explicit transitions work both ways', () => {
    const customer = [{ role: 'user', content: 'We need to modernize our infrastructure. We have 300 devices and an audit in 90 days.' }];
    assert.equal(amyConversationMode([...customer, { role: 'user', content: 'What can you do?' }]), 'discovery');
    assert.equal(amyConversationMode([...evaluationTurns, ...customer]), 'discovery');
    assert.equal(amyConversationMode([...customer, { role: 'user', content: 'Back to your capabilities. I am evaluating Amy.' }]), 'evaluation');
    assert.equal(amyConversationMode([...evaluationTurns, { role: 'user', content: "Let's role-play a county customer scenario." }]), 'discovery');
    assert.equal(amyConversationMode([{ role: 'user', content: 'I am the CEO of Insight.' }]), 'discovery');
    assert.equal(amyConversationMode(evaluationTurns.map(turn => ({ ...turn, role: 'agent' }))), 'discovery');
});

test('known bare tool identifiers are intercepted and caught by transcript QA', () => {
    for (const name of ['show_amy_intelligence', 'show_visual_brief', 'show_session_brief', 'show_solution_roadmap', 'show_live_notes', 'show_solution_catalog', 'end_amy_session', 'skip_turn']) {
        assert.equal(inspectAmyLiveOutput(name)?.reason, 'tool_markup');
        assert.equal(inspectAmyLiveOutput(`Here it is. ${name}`)?.safePrefix, 'Here it is.');
    }
    assert.equal(inspectAmyLiveOutput('The fictional sample brief is open.'), null);
    const result = evaluateAmyTranscript(`Amy: ${AMY_CANONICAL_GREETING}\n${evaluationTurns.slice(0, 5).map(turn => `User: ${turn.content}`).join('\n')}\nAmy: show_amy_intelligence`);
    assert.ok(result.findings.some(finding => finding.code === 'tool_markup_exposed'));
});

test('Amy-only player uses the shared model and never dispatches tools from spoken identifiers', () => {
    const player = readFileSync(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    assert.match(player, /if \(isAmyCara4\) \{[\s\S]*candidate.conversationKind === 'evaluation'/);
    assert.match(player, /reason === 'provider_fallback' \|\| reason === 'tool_markup'/);
    assert.match(player, /!requestedAmyArtifact\(completedUserTurn\)/);
    assert.doesNotMatch(player, /eval\(|new Function\(/);
});
