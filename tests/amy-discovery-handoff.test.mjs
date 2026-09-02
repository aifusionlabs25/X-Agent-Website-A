import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAmyWorkbenchModel, diffAmyWorkbenchFacts } from '../lib/anam/workbench-v2.ts';
import { buildAmyEmailBundle } from '../lib/anam/agentmail-templates.ts';
import { hasExplicitAmyCloseIntent, hasAmySoftCloseIntent } from '../lib/anam/amy-session-close.ts';
import { workshopTurns } from './fixtures/amy-workshop-discovery.mjs';
import { amyDiscoveryTurnGuidance } from '../lib/anam/amy-discovery-guidance.ts';

const model = turns => buildAmyWorkbenchModel(turns);
const value = (m, label) => m.facts.find(f => f.label === label)?.value ?? '';

test('workshop replay retains objective, owners, use case and data sources through email and farewell', () => {
    const before = model(workshopTurns.slice(0, 7));
    const final = model(workshopTurns);
    assert.equal(final.brief.objective, before.brief.objective);
    assert.match(final.brief.objective, /cloud migration.*AI.*together or separately/i);
    assert.match(value(final, 'Decision owner'), /infrastructure team.*business side/i);
    assert.match(value(final, 'Critical workloads'), /case management/i);
    assert.match(value(final, 'Available data'), /SharePoint.*On-premises SQL/i);
    assert.match(value(final, 'Requirements status'), /no finalised requirements/i);
    assert.doesNotMatch(JSON.stringify(final), /selected legacy applications|core workloads|email me the summary/i);
});

test('two-week workshop and fiscal-year project target coexist and produce a real update receipt', () => {
    const before = buildAmyWorkbenchModel(workshopTurns.slice(0, 6), '', '', 'roadmap');
    const after = buildAmyWorkbenchModel(workshopTurns.slice(0, 7), '', '', 'roadmap');
    assert.match(value(after, 'Timing'), /Project target: This fiscal year.*Workshop target: Within the next two weeks/);
    assert.ok(diffAmyWorkbenchFacts(before, after).some(c => c.label === 'Timing' && /two weeks/.test(c.value)));
    assert.ok(after.roadmap.facts.some(f => f.label === 'Timing' && /two weeks/.test(f.value)));
    assert.doesNotMatch(after.brief.openQuestions.join(' '), /What timing or operating window/);
});

test('requirements to discover are not confirmed constraints or a booked workshop', () => {
    const final = model(workshopTurns);
    assert.equal(value(final, 'Primary guardrail'), '');
    assert.match(value(final, 'Workshop agenda to clarify'), /data inputs.*outcomes.*compliance constraints/);
    assert.match(final.brief.nextStep, /proposed workshop.*two weeks.*not a booking/i);
    assert.doesNotMatch(final.brief.openQuestions.join(' '), /What data would each AI use case access/);
});

test('tool topic and assistant statements cannot add unsupported customer facts', () => {
    const before = model(workshopTurns);
    const after = buildAmyWorkbenchModel([...workshopTurns, { role: 'agent', content: 'The legacy SAP estate has been approved.' }], 'Legacy SAP applications are approved and the workshop is booked.');
    assert.deepEqual(after, before);
});

test('all email lanes preserve the workshop evidence without exporting a new attachment', () => {
    const bundle = buildAmyEmailBundle({
        model: model(workshopTurns), turns: workshopTurns,
        displayName: 'Demo Visitor', verifiedEmail: 'visitor@example.com', externalSessionId: 'workshop-regression',
        sessionStartedAt: '2026-09-02T18:37:51Z', sessionEndedAt: '2026-09-02T18:42:09Z',
    });
    for (const message of [bundle.visitor, bundle.intake, bundle.admin]) {
        assert.match(message.text, /fiscal year/i);
        assert.match(message.text, /two weeks/i);
        assert.match(message.text, /SharePoint/i);
        assert.match(message.text, /SQL/i);
        assert.match(message.text, /case management/i);
        assert.match(message.text, /infrastructure team/i);
        assert.doesNotMatch(message.text, /Clarify data would|non-negotiable guardrail|What timing or operating window/);
    }
    assert.equal(bundle.visitor.attachments, undefined);
    assert.match(bundle.visitor.html, /Decision ownership/);
    assert.match(bundle.visitor.html, /Requirements status/);
});

test('natural deadline variants and replacements are captured without inventing availability', () => {
    for (const timing of ['within the next 2 weeks', 'within two weeks', 'in the next three weeks']) {
        const turns = [...workshopTurns.slice(0, 6), { role: 'user', content: `We want a workshop ${timing}.` }];
        assert.match(value(model(turns), 'Timing'), /Workshop target:/);
    }
    const updated = model([...workshopTurns, { role: 'user', content: 'We want the workshop within four weeks instead.' }]);
    assert.match(value(updated, 'Timing'), /four weeks/);
    assert.doesNotMatch(value(updated, 'Timing'), /two weeks/);
});

test('requirements-discovery roadmap cannot turn the workshop target into a pilot deadline', () => {
    for (const turns of [workshopTurns.slice(0, 6), workshopTurns]) {
        const m = buildAmyWorkbenchModel(turns, '', '', 'roadmap');
        assert.doesNotMatch(JSON.stringify(m.roadmap.phases), /Pilot a controlled wave|Design the landing path|representative workload within/);
        assert.match(JSON.stringify(m.roadmap.phases), /dependencies.*validation|validate.*dependencies/);
    }
    const cancelled = model([...workshopTurns, { role: 'user', content: 'Cancel the workshop for now.' }]);
    assert.equal(value(cancelled, 'Proposed workshop'), '');
    assert.doesNotMatch(value(cancelled, 'Timing'), /two weeks/);
    assert.doesNotMatch(cancelled.brief.nextStep, /Prepare the proposed workshop/);
});

test('email requests never imply closing; the subsequent explicit goodbye does', () => {
    for (const request of [workshopTurns[7].content, 'Please email me the summary.', 'The roadmap looks good, thanks.']) {
        assert.equal(hasExplicitAmyCloseIntent(request), false);
        assert.equal(hasAmySoftCloseIntent(request), false);
    }
    assert.equal(hasExplicitAmyCloseIntent(workshopTurns[8].content), true);
});

test('runtime guidance requires a receipt for new view facts and keeps delivery separate from goodbye', () => {
    const input = { turns: workshopTurns.slice(0, 7), userTurn: workshopTurns[6].content, view: 'roadmap', isOpen: true,
        lastReceipt: buildAmyWorkbenchModel(workshopTurns.slice(0, 6), '', '', 'roadmap') };
    assert.match(amyDiscoveryTurnGuidance(input), /call show_solution_roadmap once.*appliedChanges and visibleFacts/);
    assert.equal(amyDiscoveryTurnGuidance({ ...input, lastReceipt: buildAmyWorkbenchModel(input.turns, '', '', 'roadmap') }), null);
    assert.equal(amyDiscoveryTurnGuidance({ ...input, isOpen: false }), null);
    assert.match(amyDiscoveryTurnGuidance({ ...input, userTurn: workshopTurns[7].content }), /delivery, not the end/);
    assert.equal(amyDiscoveryTurnGuidance({ ...input, userTurn: workshopTurns[8].content }), null);
});
