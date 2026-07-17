import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AMY_WORKBENCH_BOUNDARY,
    buildAmyWorkbenchModel,
} from '../lib/anam/workbench-v2.ts';

test('Amy workbench v2 starts without inventing session facts', () => {
    const model = buildAmyWorkbenchModel([]);
    assert.equal(model.status, 'listening');
    assert.equal(model.signalCount, 0);
    assert.equal(model.facts.length, 0);
    assert.match(AMY_WORKBENCH_BOUNDARY, /working view only/i);
});

test('Amy workbench v2 preserves hybrid Azure, ERP, continuity, and timing signals', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'We run a hybrid Azure environment with aging servers, and our ERP is critical.' },
        { role: 'agent', content: 'What constraint should guide the approach?' },
        { role: 'user', content: 'Business continuity matters, our maintenance window is tight, and we are targeting early next year.' },
    ]);
    assert.equal(model.status, 'live');
    assert.equal(model.lane, 'Hybrid infrastructure modernization');
    assert.deepEqual(model.brief.environment, ['Azure', 'ERP']);
    assert.match(model.facts.find((fact) => fact.label === 'Primary guardrail')?.value ?? '', /continuity|maintenance window/i);
    assert.match(model.facts.find((fact) => fact.label === 'Timing')?.value ?? '', /early next year/i);
    assert.match(model.roadmap.title, /Hybrid infrastructure/i);
});

test('Amy workbench v2 prioritizes public-sector context and removes contact details', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'Our county needs a 60-day cyber roadmap under StateRAMP requirements.' },
        { role: 'user', content: 'My email is tester@example.com and phone is 602-555-0199.' },
    ]);
    assert.equal(model.lane, 'Public-sector modernization');
    assert.doesNotMatch(JSON.stringify(model), /tester@example\.com|602-555-0199/);
});

test('Corrections replace rejected terms and uncertain speech remains separate', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'We use SCCM for 850 endpoints.' },
        { role: 'user', content: "It's Intune, not SCCM. It's peak season, not PC season." },
        { role: 'user', content: 'I think our MDM might be FleetPilot.' },
    ]);
    assert.ok(model.corrections.some((item) => /SCCM/i.test(item.from) && /Intune/i.test(item.to)));
    assert.ok(model.brief.environment.includes('Intune'));
    assert.equal(model.brief.environment.includes('SCCM'), false);
    assert.ok(model.uncertainItems.some((item) => /FleetPilot/i.test(item)));
    assert.doesNotMatch(JSON.stringify(model.facts), /FleetPilot/i);
});

test('Roadmap topic is session-specific without becoming an approval claim', () => {
    const topic = 'Modernize 1,200 Windows 11 endpoints with Intune in controlled waves before peak season.';
    const model = buildAmyWorkbenchModel([{ role: 'user', content: 'Please show me a phased endpoint roadmap.' }], topic);
    assert.equal(model.lane, 'Endpoint modernization');
    assert.equal(model.roadmap.outcome, topic.replace(/\.$/, ''));
    assert.equal(model.roadmap.phases.length, 4);
    assert.match(model.roadmap.phases[0].detail, /1,200/i);
    assert.doesNotMatch(model.roadmap.outcome, /approved|guaranteed|completed assessment/i);
});

test('Visual brief is a six-slide deterministic microdeck', () => {
    const turns = [{ role: 'user', content: 'We need a phased Azure ERP migration roadmap with minimal downtime next quarter.' }];
    const model = buildAmyWorkbenchModel(turns);
    const repeated = buildAmyWorkbenchModel(turns);
    assert.equal(model.visualBrief.slides.length, 6);
    assert.deepEqual(model.visualBrief, repeated.visualBrief);
    assert.deepEqual(model.visualBrief.slides.map((slide) => slide.id), ['executive_snapshot', 'what_we_heard', 'environment_and_constraints', 'recommended_path', 'phased_roadmap', 'decisions_and_next_steps']);
    assert.ok(model.visualBrief.slides.every((slide) => /conversation so far/i.test(slide.boundary)));
});

test('Anam client tools use the current API shape and route five named views', async () => {
    const tools = (await import('../config/anam/amy-workbench-client-tools.json', { with: { type: 'json' } })).default;
    assert.deepEqual(tools.map((tool) => tool.name), [
        'show_live_notes',
        'show_session_brief',
        'show_solution_roadmap',
        'show_visual_brief',
        'show_solution_catalog',
    ]);
    assert.ok(tools.every((tool) => tool.type === 'CLIENT'));
    assert.ok(tools.every((tool) => tool.config?.awaitResult === true));
    assert.ok(tools.every((tool) => tool.config?.parameters?.type === 'object'));
    assert.match(tools[4].description, /does not return live inventory, pricing, availability/i);
    assert.doesNotMatch(JSON.stringify(tools), /Tavus|end_call|response_to_user|search_assist/i);
});

test('Amy player registers all five visual handlers and keeps workbench local to Cara 4', async () => {
    const player = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8'));
    for (const name of ['show_live_notes', 'show_session_brief', 'show_solution_roadmap', 'show_visual_brief', 'show_solution_catalog']) {
        assert.match(player, new RegExp(name));
    }
    assert.match(player, /isAmyCara4Variant\(sessionVariant\)/);
    assert.match(player, /current\.slice\(-59\)/);
});

test('Catalog is directional and never claims live commerce data', () => {
    const model = buildAmyWorkbenchModel([{ role: 'user', content: 'Show endpoint and Windows 11 solution categories for 1,200 devices.' }], '', 'endpoint categories');
    assert.equal(model.catalog.categories.length, 4);
    assert.match(model.catalog.boundary, /not verified/i);
    assert.match(model.catalog.boundary, /inventory, pricing, availability, lead time, and contract eligibility/i);
    assert.doesNotMatch(JSON.stringify(model.catalog.categories), /in stock|available now|price is/i);
});
