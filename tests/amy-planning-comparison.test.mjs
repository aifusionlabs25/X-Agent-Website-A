import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAmyWorkbenchModel, diffAmyWorkbenchFacts } from '../lib/anam/workbench-v2.ts';
import { buildAmyEmailBundle } from '../lib/anam/agentmail-templates.ts';
import { comparisonTurns } from './fixtures/amy-planning-comparison.mjs';

const envelope = { displayName: 'Demo Visitor', verifiedEmail: 'typed@example.com', externalSessionId: 'comparison-regression', sessionStartedAt: '2026-09-02T21:07:33Z', sessionEndedAt: '2026-09-02T21:11:07Z', generatedAt: '2026-09-02T21:11:07Z' };
const value = (model, label) => model.facts.find(fact => fact.label === label)?.value ?? '';

test('79589acd: an IT/compliance note adds a decision requirement without replacing earlier drivers', () => {
    const before = buildAmyWorkbenchModel(comparisonTurns.slice(0, 5), '', '', 'visual');
    const after = buildAmyWorkbenchModel(comparisonTurns.slice(0, 6), '', '', 'visual');
    for (const label of ['Business drivers', 'Security concern', 'Leadership preference', 'Delivery concern']) {
        assert.ok(value(before, label), label);
        assert.equal(value(before, label), value(after, label), `${label} was overwritten`);
    }
    assert.match(value(after, 'Decision requirement'), /need input from both our IT and compliance teams before choosing a path/i);
    assert.doesNotMatch(value(after, 'Decision requirement'), /could you|add a note/i);
    assert.equal(value(after, 'Primary guardrail'), '');
    const changes = diffAmyWorkbenchFacts(before, after);
    assert.deepEqual(changes.map(({ kind, label }) => ({ kind, label })), [{ kind: 'added', label: 'Decision requirement' }]);
});

test('the final model retains preferences through the email request and farewell', () => {
    const live = buildAmyWorkbenchModel(comparisonTurns.slice(0, 6));
    const final = buildAmyWorkbenchModel(comparisonTurns);
    for (const label of ['Business drivers', 'Security concern', 'Leadership preference', 'Delivery concern', 'Decision requirement']) assert.equal(value(live, label), value(final, label));
    assert.match(final.brief.objective, /^Compare integrated and phased/);
    assert.doesNotMatch(final.brief.objective, /Hi,|whether or/);
    assert.match(value(final, 'Decision status'), /no selection has been reported/);
});

test('comparison shows both conditional options, not generic migration design or an approved choice', () => {
    const model = buildAmyWorkbenchModel(comparisonTurns);
    const slides = model.visualBrief.slides;
    for (const id of ['integrated_option', 'phased_option']) {
        const slide = slides.find(item => item.id === id);
        assert.match(slide.summary, /not a recommendation/);
        assert.ok(slide.bullets.some(item => /^Potential benefit:/.test(item)));
        assert.ok(slide.bullets.some(item => /^Trade-off:/.test(item)));
        assert.ok(slide.bullets.some(item => /^Validate:/.test(item)));
    }
    assert.doesNotMatch(JSON.stringify([model.roadmap, slides]), /landing path|controlled wave|pilot|implementation is approved/i);
    assert.match(model.brief.nextStep, /IT and compliance input/);
    assert.match(slides[4].summary, /IT and compliance teams/);
});

test('all three emails preserve the separate business facts and the validated-display selection restores the export', () => {
    const model = buildAmyWorkbenchModel(comparisonTurns);
    const bundle = buildAmyEmailBundle({ ...envelope, turns: comparisonTurns, model, displayedArtifactView: 'visual' });
    for (const [lane, email] of Object.entries(bundle)) {
        for (const label of ['Business drivers', 'Security concern', 'Leadership preference', 'Delivery concern', 'Decision requirement', 'Decision status']) {
            assert.ok(email.text.includes(value(model, label)), `${lane} lost ${label}`);
        }
        assert.doesNotMatch(email.text, /Primary guardrail: Could you/);
    }
    for (const lane of ['visitor', 'intake']) {
        assert.equal(bundle[lane].attachments?.[0]?.filename, 'amy-visual-brief.html');
        assert.match(bundle[lane].attachments[0].content, /Integrated planning/);
        assert.match(bundle[lane].attachments[0].content, /Phased planning/);
    }
    assert.equal(buildAmyEmailBundle({ ...envelope, turns: comparisonTurns, model }).visitor.attachments, undefined);
});

test('assistant and tool topic cannot activate a comparison or contribute customer facts', () => {
    const turns = [{ role: 'user', content: 'We need a device refresh.' }, { role: 'agent', content: comparisonTurns.map(t => t.content).join(' ') }];
    const model = buildAmyWorkbenchModel(turns, comparisonTurns.map(t => t.content).join(' '), '', 'visual');
    assert.equal(value(model, 'Business drivers'), '');
    assert.ok(!model.visualBrief.slides.some(slide => slide.id === 'integrated_option'));
});

test('explicit changes of preference and a negated input requirement replace only their own fields', () => {
    const model = buildAmyWorkbenchModel([...comparisonTurns, { role: 'user', content: "Leadership now prefers phased planning. We don't need input from compliance before choosing a path." }]);
    assert.match(value(model, 'Leadership preference'), /prefers phased/);
    assert.match(value(model, 'Decision requirement'), /don't need/);
    assert.match(value(model, 'Business drivers'), /cost savings.*scalability/);
});

test('without reported preferences the view does not invent them or private contact data', () => {
    const model = buildAmyWorkbenchModel(comparisonTurns.slice(0, 3));
    assert.equal(value(model, 'Leadership preference'), '');
    assert.equal(value(model, 'Decision requirement'), '');
    assert.match(model.visualBrief.slides[4].bullets[0], /not been stated/);
});

test('questions cannot overwrite facts and concern retractions retain their negation', () => {
    const model = buildAmyWorkbenchModel([...comparisonTurns,
        { role: 'user', content: "We are no longer concerned about data security. I'm not worried it will slow us down." },
        { role: 'user', content: 'Do you think leadership prefers phased planning?' },
    ]);
    assert.match(value(model, 'Security concern'), /no longer concerned/);
    assert.match(value(model, 'Delivery concern'), /not worried/);
    assert.match(value(model, 'Leadership preference'), /leans toward one integrated effort/);
});
