import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAmyWorkbenchModel } from '../lib/anam/workbench-v2.ts';
import { buildAmyEmailBundle } from '../lib/anam/agentmail-templates.ts';
import { inspectAmyLiveOutput } from '../lib/anam/amy-live-output-guard.ts';
import { evaluateAmyTranscript, AMY_CANONICAL_GREETING } from '../lib/anam/amy-live-qa.ts';
import { requestedAmyArtifact, createAmyArtifactOperation } from '../lib/anam/amy-artifact-operation.ts';
import { renewalTurns } from './fixtures/amy-renewal-discovery.mjs';

test('ad7d8a06: renewal facts survive acceptance, delivery requests, and farewell in all three emails', () => {
    const model = buildAmyWorkbenchModel(renewalTurns, '', '', 'visual');
    const bundle = buildAmyEmailBundle({ model, turns: renewalTurns, displayedArtifactView: 'visual', displayName: 'Demo Visitor', verifiedEmail: 'typed@example.com', externalSessionId: 'renewal-regression', sessionStartedAt: '2026-09-02T21:48:30Z', sessionEndedAt: '2026-09-02T21:53:22Z' });
    for (const content of [JSON.stringify(model), ...Object.values(bundle).map(email => email.text)]) {
        for (const pattern of [/1200 seats/, /Office 365/, /Teams/, /Power BI/, /Copilot.*productivity/, /about four months/, /AI rollout right after renewal/, /haven't seen specific AI options/]) assert.match(content, pattern);
    }
    assert.equal(model.quality.level, 'grounded');
    assert.match(model.lane, /Microsoft renewal/);
    assert.match(model.brief.nextStep, /licensing options, costs, and timing.*reseller/);
    assert.doesNotMatch(JSON.stringify(model.brief.openQuestions), /Which environment|What timing|What data would/);
    for (const lane of ['intake', 'visitor']) assert.match(bundle[lane].attachments[0].content, /Coordinated planning/);
    assert.doesNotMatch(JSON.stringify(model.visualBrief), /\bpilot\b|landing zone|approved rollout schedule/);
});

test('renewal discovery handles variants and keeps tentative plans separate from current products', () => {
    for (const duration of ['about four months', 'roughly 6 weeks', 'the next three months']) {
        const model = buildAmyWorkbenchModel([
            { role: 'user', content: 'We are evaluating an AI rollout alongside our Microsoft renewal.' },
            { role: 'user', content: `The renewal is in ${duration}. We have approximately 2,500 seats. We use Microsoft 365 and Power BI.` },
            { role: 'user', content: 'Leadership is considering Copilot for productivity.' },
        ]);
        assert.ok(model.facts.some(fact => fact.label === 'Renewal window' && fact.value.includes(duration)));
        assert.ok(model.facts.some(fact => fact.label === 'Environment scale' && fact.value.includes('2,500 seats')));
        assert.doesNotMatch(model.facts.find(fact => fact.label === 'Technology context').value, /Copilot/);
        assert.match(model.facts.find(fact => fact.label === 'AI initiative').value, /exploratory, not an approval/);
    }
});

test('explicit corrections and uncertainty replace their own facts without overwriting other context', () => {
    const model = buildAmyWorkbenchModel([...renewalTurns, { role: 'user', content: 'Correction: we have 900 seats. The renewal timing is unconfirmed. Leadership is no longer planning the AI rollout after renewal.' }]);
    assert.equal(model.facts.find(fact => fact.label === 'Environment scale').value, '900 seats');
    assert.match(model.facts.find(fact => fact.label === 'Renewal window').value, /unconfirmed/);
    assert.match(model.facts.find(fact => fact.label === 'AI rollout target').value, /no longer/);
    assert.match(model.facts.find(fact => fact.label === 'Technology context').value, /Office 365/);
});

test('assistant suggestions and tool arguments cannot supply renewal facts or activate commercial mode', () => {
    const model = buildAmyWorkbenchModel([{ role: 'user', content: 'We need to replace a device.' }, ...renewalTurns.map(turn => ({ ...turn, role: 'agent' }))], renewalTurns.map(turn => turn.content).join(' '), '', 'visual');
    assert.doesNotMatch(model.lane, /renewal/);
    assert.doesNotMatch(JSON.stringify(model.facts), /1200|four months|Power BI/);
    const hypothetical = buildAmyWorkbenchModel([{ role: 'user', content: 'What if our Microsoft renewal and AI rollout were combined?' }]);
    assert.doesNotMatch(hypothetical.lane, /renewal/);
});

test('fallback guard catches curly apostrophes, semicolons, and streamed phrase prefixes', () => {
    for (const phrase of ["I'm sorry; I'm having trouble thinking right now.", 'I’m sorry; I’m having trouble thinking right now.', 'I‘m having trouble thinking', 'I am having trouble thinking right now.']) {
        const result = inspectAmyLiveOutput(phrase);
        assert.equal(result?.reason, 'provider_fallback', phrase);
        assert.ok(!result.safePrefix.includes('having trouble'));
    }
    assert.equal(inspectAmyLiveOutput('One moment while I update your brief.'), null);
});

test('the QA gate fails the actual error wording and flags an unfinished response', () => {
    const report = evaluateAmyTranscript(`Amy: ${AMY_CANONICAL_GREETING}\nUser: Please open the brief.\nAmy: I’m sorry; I’m having trouble thinking right now.\nUser: Please try again.\nAmy: I’m sorry; I’m having trouble thinking right now.\nUser: What happened?\nAmy: I can put together a working brief that lays out the confirmed facts, the open questions around licensing, and the timing constraints you have described, so you have a clear reference for that res`);
    assert.equal(report.status, 'fail');
    assert.equal(report.findings.filter(finding => finding.code === 'provider_fallback_exposed').length, 2);
    assert.ok(report.findings.some(finding => finding.code === 'possibly_unfinished_reply'));
});

test('artifact intent needs a direct request or explicit acceptance of an actual offer', () => {
    assert.equal(requestedAmyArtifact('Open the Visual Brief.'), 'visual');
    assert.equal(requestedAmyArtifact('Show my Live Brief.'), 'brief');
    assert.equal(requestedAmyArtifact('Show the roadmap.'), 'roadmap');
    assert.equal(requestedAmyArtifact('That would be perfect. A clear brief will help.', 'I can put together a working brief with the facts.'), 'visual');
    assert.equal(requestedAmyArtifact('Yes.', 'I can put together a roadmap.'), 'roadmap');
    assert.equal(requestedAmyArtifact('Add a note about the funding source.', '', 'visual'), 'visual');
    for (const text of ['Yes.', 'Email the brief.', 'Do not open the brief.', 'Show live pricing in the brief.', 'What if you open a brief?', 'Close the brief.', 'Open a brief and end the call.', 'Tell me about your capabilities.']) assert.equal(requestedAmyArtifact(text), null, text);
});

test('auto-open and provider tool share one in-flight operation and committed result', async () => {
    const pending = [];
    const operation = createAmyArtifactOperation({ onPending: value => pending.push(value) });
    let calls = 0;
    let release;
    const build = async () => { calls++; await new Promise(resolve => { release = resolve; }); return { revision: 1 }; };
    const a = operation.run('visual:5', build);
    const b = operation.run('visual:5', build);
    assert.equal(a, b);
    await Promise.resolve();
    release();
    assert.deepEqual(await a, { status: 'completed', value: { revision: 1 } });
    assert.deepEqual(await operation.run('visual:5', build), await a);
    assert.equal(calls, 1);
    assert.deepEqual(pending, [true, false]);
});

test('timeout is bounded, has no retry, and rejects a late commit', async () => {
    const operation = createAmyArtifactOperation({ timeoutMs: 5 });
    let isCurrent;
    const build = () => new Promise(() => {});
    const result = operation.run('visual:1', async current => { isCurrent = current; return build(); });
    assert.deepEqual(await result, { status: 'failed' });
    assert.equal(isCurrent(), false);
    assert.deepEqual(await operation.run('visual:1', () => { throw new Error('must not retry'); }), { status: 'failed' });
});

test('session disposal and superseding requests cancel pending work and isolate instances', async () => {
    const a = createAmyArtifactOperation();
    const b = createAmyArtifactOperation();
    let isCurrent;
    const first = a.run('visual:1', current => { isCurrent = current; return new Promise(() => {}); });
    await Promise.resolve();
    const second = a.run('brief:2', async () => 'current');
    assert.deepEqual(await first, { status: 'cancelled' });
    assert.equal(isCurrent(), false);
    assert.deepEqual(await second, { status: 'completed', value: 'current' });
    assert.equal(b.snapshot(), null);
    const pending = b.run('visual:1', () => new Promise(() => {}));
    b.cancel();
    assert.deepEqual(await pending, { status: 'cancelled' });
    a.cancel();
    assert.equal(a.snapshot(), null);
});
