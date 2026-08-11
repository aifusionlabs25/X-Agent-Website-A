import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AMY_WORKBENCH_BOUNDARY,
    buildAmyWorkbenchModel,
} from '../lib/anam/workbench.ts';

test('Amy workbench starts in a listening state without inventing session facts', () => {
    const model = buildAmyWorkbenchModel([]);
    assert.equal(model.status, 'listening');
    assert.equal(model.signalCount, 0);
    assert.equal(model.notes.length, 0);
    assert.match(AMY_WORKBENCH_BOUNDARY, /working view only/i);
    assert.match(AMY_WORKBENCH_BOUNDARY, /require confirmation/i);
});

test('Amy workbench preserves hybrid Azure, ERP, continuity, and timing signals', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'We run a hybrid Azure environment with aging servers, and our ERP is critical.' },
        { role: 'agent', content: 'What constraint should guide the approach?' },
        { role: 'user', content: 'Business continuity matters, our maintenance window is tight, and we are targeting early next year.' },
    ]);
    assert.equal(model.status, 'live');
    assert.equal(model.lane, 'Hybrid infrastructure modernization');
    assert.deepEqual(model.brief.environment, ['Azure', 'ERP']);
    assert.match(model.notes.find((note) => note.label === 'Constraint or risk')?.value ?? '', /continuity|maintenance window/i);
    assert.match(model.notes.find((note) => note.label === 'Timing')?.value ?? '', /early next year/i);
    assert.match(model.roadmap.title, /Hybrid infrastructure/i);
});

test('Amy workbench prioritizes public-sector context and removes contact details', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'Our county needs a 60-day cyber roadmap under StateRAMP requirements.' },
        { role: 'user', content: 'My email is tester@example.com and phone is 602-555-0199.' },
    ]);
    assert.equal(model.lane, 'Public-sector modernization');
    assert.doesNotMatch(JSON.stringify(model), /tester@example\.com|602-555-0199/);
});

test('Roadmap topic is displayed as planning context without becoming an approval claim', () => {
    const topic = 'Modernize 1,200 Windows 11 endpoints with Intune in controlled waves before peak season.';
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'Please show me a phased endpoint roadmap.' },
    ], topic);
    assert.equal(model.lane, 'Endpoint modernization');
    assert.equal(model.roadmap.outcome, topic.replace(/\.$/, ''));
    assert.equal(model.roadmap.phases.length, 4);
    assert.doesNotMatch(model.roadmap.outcome, /approved|guaranteed|completed assessment/i);
});

test('Visual brief keeps unknowns visibly open', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'We want to improve our security posture.' },
    ]);
    assert.equal(model.lane, 'Security readiness');
    assert.ok(model.visual.some((node) => node.state === 'open'));
    assert.ok(model.brief.openQuestions.length > 0);
});

test('Anam client tool definitions use the current API shape and route named views separately', async () => {
    const tools = (await import('../config/anam/amy-workbench-client-tools.json', {
        with: { type: 'json' },
    })).default;
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
    assert.match(tools[1].description, /Live Brief request always uses this tool, never show_live_notes/i);
    assert.doesNotMatch(JSON.stringify(tools), /Tavus|end_call|response_to_user|search_assist/i);
});

test('Amy player registers each visual handler and keeps workbench local to Cara 4', async () => {
    const player = await import('node:fs/promises').then((fs) => fs.readFile(
        new URL('../components/AnamPlayer.tsx', import.meta.url),
        'utf8',
    ));
    for (const name of ['show_live_notes', 'show_session_brief', 'show_solution_roadmap', 'show_visual_brief']) {
        assert.match(player, new RegExp(name));
    }
    assert.match(player, /isAmyCara4Variant\(sessionVariant\)/);
    assert.match(player, /current\.slice\(-59\)/);
});
