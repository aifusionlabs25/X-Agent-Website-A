import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { evaluationTurns } from './fixtures/amy-evaluation-rehearsal.mjs';
import { stateCioEvaluationTurns } from './fixtures/amy-state-cio-evaluation.mjs';
import { amyConversationMode, diffAmyEvaluationSample } from '../lib/anam/amy-evaluation.ts';
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
    assert.equal(amyConversationMode([...customer, { role: 'user', content: "What's your role?" }]), 'discovery');
    assert.equal(amyConversationMode([...customer, { role: 'user', content: 'How does this help our sales team?' }]), 'discovery');
    assert.equal(amyConversationMode([...evaluationTurns, { role: 'user', content: 'This is our real customer opportunity.' }, ...customer]), 'discovery');
    assert.equal(amyConversationMode([...customer, { role: 'user', content: 'Back to your capabilities. I am evaluating Amy.' }]), 'evaluation');
    assert.equal(amyConversationMode([...evaluationTurns, { role: 'user', content: "Let's role-play a county customer scenario." }, ...customer]), 'evaluation');
    assert.equal(amyConversationMode([{ role: 'user', content: 'I am the CEO of Insight.' }]), 'discovery');
    assert.equal(amyConversationMode(evaluationTurns.map(turn => ({ ...turn, role: 'agent' }))), 'discovery');
});

test('a hypothetical opening is evaluation and a later return to evaluation cannot reuse earlier customer facts', () => {
    assert.equal(amyConversationMode([{ role: 'user', content: "Let's say I'm a state CIO with a modernization deadline." }]), 'evaluation');
    const turns = [
        { role: 'user', content: 'This is a real customer opportunity.' },
        { role: 'user', content: 'Our state CIO has a modernization deadline of February 2, 2027.' },
        { role: 'user', content: 'Back to your capabilities. I am evaluating Amy.' },
        { role: 'user', content: 'Show me a fictional example.' },
    ];
    const model = buildAmyWorkbenchModel(turns, '', '', 'visual');
    assert.equal(model.conversationKind, 'evaluation');
    assert.doesNotMatch(JSON.stringify(model.evaluationSample), /state CIO|modernization|February 2/i);
});

test('76ae1051: capability wording and every hypothetical state-CIO turn remain evaluation', () => {
    for (let end = 1; end <= stateCioEvaluationTurns.length; end++) {
        const model = buildAmyWorkbenchModel(stateCioEvaluationTurns.slice(0, end), 'untrusted tool topic', '', 'visual');
        assert.equal(model.conversationKind, 'evaluation', `turn ${end}`);
        assert.doesNotMatch(JSON.stringify(model.facts), /Public-sector modernization|By 30 days|state CIO|February|clarify a detail/i);
    }
    assert.ok(hasAmyCapabilityOverviewIntent(stateCioEvaluationTurns[0].content));
});

test('76ae1051: the fictional sample accepts an exact replacement date without leaking it to customer facts', () => {
    const before = buildAmyWorkbenchModel(stateCioEvaluationTurns.slice(0, 10), '', '', 'visual');
    const exact = buildAmyWorkbenchModel(stateCioEvaluationTurns.slice(0, 12), '', '', 'visual');
    assert.equal(exact.evaluationSample.facts.find(fact => fact.label === 'Illustrative revised deadline').value, 'February 2, 2027');
    assert.match(JSON.stringify(exact.visualBrief), /February 2, 2027/);
    assert.doesNotMatch(JSON.stringify(exact.facts), /February|five months|six months|30 days/);
    const changes = diffAmyEvaluationSample(before, exact);
    assert.deepEqual(changes.find(change => change.label === 'Illustrative revised deadline'), {
        kind: 'updated', section: 'Timing', label: 'Illustrative revised deadline', value: 'February 2, 2027', previousValue: 'five months out from today',
    });
    assert.match(buildAmyWorkbenchReceiptDetails(exact, 'visual', changes).spokenConfirmation, /now shows February 2, 2027.*not customer data/i);
});

test('76ae1051: edit commands rebuild an open view while a relative shift alone is not stored as a deadline', () => {
    assert.equal(requestedAmyArtifact(stateCioEvaluationTurns[4].content, 'I would capture that in a working brief.'), 'visual');
    assert.equal(requestedAmyArtifact(stateCioEvaluationTurns[8].content, '', 'visual'), 'visual');
    assert.equal(requestedAmyArtifact(stateCioEvaluationTurns[11].content, '', 'visual'), 'visual');
    const relativeOnly = buildAmyWorkbenchModel(stateCioEvaluationTurns.slice(0, 9));
    assert.equal(relativeOnly.evaluationSample.facts.some(fact => /deadline/i.test(fact.label)), false);
});

test('76ae1051: every email is an evaluation recap and excludes fictional scenario state', () => {
    const model = buildAmyWorkbenchModel(stateCioEvaluationTurns, '', '', 'visual');
    const bundle = buildAmyEmailBundle({ model, turns: stateCioEvaluationTurns, displayName: 'Rob Vicks', verifiedEmail: 'rvicks@gmail.com', externalSessionId: '76ae1051-e0ef-4e67-8b28-ed3e836eb374', sessionStartedAt: '2026-09-03T01:07:28Z', sessionEndedAt: '2026-09-03T01:12:28Z', displayedArtifactView: 'visual' });
    for (const email of Object.values(bundle)) {
        assert.match(email.text, /evaluat/i);
        assert.doesNotMatch(email.text, /Public-sector modernization|By 30 days|February 2|five months|six months|Assign an Insight opportunity owner/);
        assert.equal(email.attachments, undefined);
    }
});

test('420d78ed: an explicit fictional zero-trust replacement updates the visual on the first attempt', () => {
    const opening = [
        { role: 'user', content: "Let's say I gave you a messy state agency scenario. What would your output look like?" },
        { role: 'user', content: 'Show me a sample working brief.' },
    ];
    const before = buildAmyWorkbenchModel(opening, '', '', 'visual');
    assert.equal(before.evaluationSample.title, 'State agency scenario');
    assert.doesNotMatch(JSON.stringify(before.evaluationSample), /Workstation refresh/i);

    const switched = buildAmyWorkbenchModel([
        ...opening,
        { role: 'user', content: 'If they switch from ERP to cybersecurity, can you update that brief on the fly?' },
        { role: 'user', content: 'The client now prioritizes zero trust architecture as their top requirement. Update the brief to reflect that shift.' },
    ], '', '', 'visual');
    const changes = diffAmyEvaluationSample(before, switched);
    assert.deepEqual(switched.evaluationSample.facts.find(fact => fact.label === 'Illustrative primary priority'), {
        label: 'Illustrative primary priority', value: 'Zero trust architecture',
    });
    assert.ok(changes.some(change => change.label === 'Illustrative primary priority' && change.value === 'Zero trust architecture'));
    assert.match(JSON.stringify(switched.visualBrief), /Primary priority: Zero trust architecture/);
    assert.match(buildAmyWorkbenchReceiptDetails(switched, 'visual', changes).spokenConfirmation, /Zero trust architecture as its primary priority/i);
});

test('420d78ed: a clarified primary and secondary priority remain fictional and produce receipt-supported changes', () => {
    const before = buildAmyWorkbenchModel([
        { role: 'user', content: "Let's say I gave you a messy state agency scenario." },
        { role: 'user', content: 'Show me a sample working brief.' },
    ], '', '', 'visual');
    const after = buildAmyWorkbenchModel([
        { role: 'user', content: "Let's say I gave you a messy state agency scenario." },
        { role: 'user', content: 'Show me a sample working brief.' },
        { role: 'user', content: 'They switch from ERP to cybersecurity.' },
        { role: 'user', content: "Just note that the client's new priority is implementing zero trust security and that the ELP modernization is now secondary." },
    ], '', '', 'visual');
    assert.deepEqual(after.evaluationSample.facts.filter(fact => /priority/i.test(fact.label)), [
        { label: 'Illustrative primary priority', value: 'Implementing zero trust security' },
        { label: 'Illustrative secondary priority', value: 'ERP modernization' },
    ]);
    assert.doesNotMatch(JSON.stringify(after.facts), /zero trust|ERP modernization/i);
    const changes = diffAmyEvaluationSample(before, after);
    const receipt = buildAmyWorkbenchReceiptDetails(after, 'visual', changes);
    assert.match(receipt.spokenConfirmation, /Implementing zero trust security as its primary priority/i);
    assert.match(receipt.spokenConfirmation, /ERP modernization as its secondary priority/i);
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
