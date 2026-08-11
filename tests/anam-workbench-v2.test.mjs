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

test('Northside patient-intake visual stays healthcare-grounded and preserves unknowns', () => {
    const turns = [
        { role: 'agent', content: "Hi, I'm Amy with Insight. What would be most useful for us to work through today?" },
        { role: 'user', content: "Amy, I'm juggling a mess." },
        { role: 'agent', content: "Sounds hectic. What's the biggest challenge you're dealing with right now?" },
        { role: 'user', content: "We've got patient intake times going through the roof at two clinics and now my CEO wants a dashboard of all our bottlenecks. I don't even know if data is our problem." },
        { role: 'agent', content: 'Do you know if your EHR or scheduling system logs timestamps at each intake step?' },
        { role: 'user', content: "We do have an EHR, but wait, I'm remembering something. One clinic switched workflows last month. This might not even be the same issue." },
        { role: 'agent', content: "Which clinic changed its workflow? Sorry, I'm having trouble thinking right now." },
        { role: 'user', content: "It was the Northside clinic. They added a new pre-screening step. Honestly, I'm not sure what changed. But the CEO doesn't care. He just wants answers. So how do we figure out what's real here?" },
        { role: 'agent', content: 'Pull timestamp data for check-in, pre-screening, registration, and clinician hand-off, then compare average and variance.' },
        { role: 'user', content: "I'll need to check with IT on the EHR export." },
        { role: 'user', content: 'sport. But before we do anything, what exactly would you hand me to show the CEO quickly?' },
        { role: 'agent', content: 'I would provide a stacked bar, heat map, and sparkline.' },
        { role: 'user', content: 'Yes, show me that brief. I need to visualize this before I get pulled into my Lexfire.' },
    ];
    const model = buildAmyWorkbenchModel(turns, '', '', 'visual');
    const serialized = JSON.stringify(model);

    assert.equal(model.lane, 'Healthcare operations discovery');
    assert.equal(model.facts.find((fact) => fact.label === 'Requested output')?.value, 'Visual brief');
    assert.equal(model.facts.find((fact) => fact.label === 'Stakeholder context')?.value, 'CEO / executive leadership');
    assert.match(model.brief.objective, /patient-intake times across two clinics/i);
    assert.match(model.facts.find((fact) => fact.label === 'Technology context')?.value ?? '', /EHR/);
    assert.match(model.facts.find((fact) => fact.label === 'Reported workflow change')?.value ?? '', /Northside.*pre-screening.*last month/i);
    assert.match(model.facts.find((fact) => fact.label === 'Evidence status')?.value ?? '', /IT confirmation.*EHR export/i);
    assert.ok(model.uncertainItems.some((item) => /whether data is part of the underlying problem/i.test(item)));
    assert.ok(model.uncertainItems.some((item) => /two clinics may not share the same root cause/i.test(item)));
    assert.ok(model.uncertainItems.some((item) => /effect of Northside's workflow change is not yet known/i.test(item)));
    assert.equal(model.quality.level, 'developing');
    assert.ok(model.quality.missing.includes('decision timing'));
    assert.ok(model.quality.missing.includes('authorized operational evidence'));
    assert.deepEqual(model.roadmap.phases.map((phase) => phase.title), [
        'Frame the leadership question',
        'Separate facts from hypotheses',
        'Validate permissible evidence',
        'Set the next decision gate',
    ]);
    assert.match(model.visualBrief.slides[0].title, /known.*validation/i);
    assert.match(model.visualBrief.slides[2].bullets.join(' '), /Confirmed: An EHR exists/i);
    assert.match(model.visualBrief.slides[2].bullets.join(' '), /Unconfirmed hypothesis.*pre-screening/i);
    assert.match(model.visualBrief.slides[2].boundary, /authorized data-owner.*Insight specialist validation/i);
    assert.doesNotMatch(serialized, /Endpoint modernization|migration wave|Copilot readiness/i);
    assert.doesNotMatch(serialized, /prime-contractor|compliance framework/i);
    assert.doesNotMatch(serialized, /check-in|registration|clinician hand-off|stacked bar|heat map|sparkline|average and variance/i);
    assert.doesNotMatch(serialized, /\bsport\b|Lexfire|having trouble thinking/i);
});

test('Clinic language does not override explicit endpoint evidence', () => {
    const endpoint = buildAmyWorkbenchModel([
        { role: 'user', content: 'Two clinics need Windows 11 laptops managed through Intune.' },
    ]);
    const healthcare = buildAmyWorkbenchModel([
        { role: 'user', content: 'Two clinics have patient-intake delays in an EHR workflow.' },
    ]);

    assert.equal(endpoint.lane, 'Endpoint modernization');
    assert.equal(healthcare.lane, 'Healthcare operations discovery');
    assert.doesNotMatch(JSON.stringify(healthcare.uncertainItems), /prime-contractor|compliance framework/i);
});

test('Invoked Workbench view controls ambiguous requested-output wording', () => {
    const turns = [{ role: 'user', content: 'Yes, show me that brief.' }];
    assert.equal(buildAmyWorkbenchModel(turns, '', '', 'visual').facts.find((fact) => fact.label === 'Requested output')?.value, 'Visual brief');
    assert.equal(buildAmyWorkbenchModel(turns, '', '', 'brief').facts.find((fact) => fact.label === 'Requested output')?.value, 'Live brief');
});

test('student-retention pressure test stays grounded and produces a safe board-ready working path', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'Amy, I need answers fast. We have a board deadline in three days, an AI proposal that is still vague, and our budget just got slashed. Where do we even begin?' },
        { role: 'user', content: 'Exactly. I need a clear plan on what is realistic in this timeframe or this is going to fall apart.' },
        { role: 'user', content: 'They want a tangible pilot, something that shows AI improving student engagement or operations, but I have nothing scoped.' },
        { role: 'user', content: 'We have a student information system and some operations data, but nothing deeply integrated yet. I need to know if we can do anything with that quickly.' },
        { role: 'user', content: 'Let us say improving student retention. If we can show AI helping identify students at risk of dropping out, that would resonate. But how do I know if that is feasible in three days?' },
        { role: 'user', content: 'We have basic extracts, attendance and grades, but no counseling data yet. Show me what that plan would look like.' },
        { role: 'user', content: 'That gives me a starting point. I will run with that plan. Thanks, Amy. This is exactly what I needed.' },
        { role: 'user', content: 'Can you show me a visual of that? I need something I can put in front of the board.' },
        { role: 'user', content: 'I have got what I need now. Thanks, Amy. I will take it from here.' },
    ], 'Board-ready student-retention AI feasibility demonstration in three days using available SIS attendance and grade extracts.');

    const serialized = JSON.stringify(model);
    const objective = model.facts.find((fact) => fact.label === 'Current objective')?.value ?? '';
    const aiUseCase = model.facts.find((fact) => fact.label === 'AI discovery')?.value ?? '';
    const guardrail = model.facts.find((fact) => fact.label === 'Primary guardrail')?.value ?? '';
    const timing = model.facts.find((fact) => fact.label === 'Timing')?.value ?? '';

    assert.equal(model.lane, 'Education AI discovery');
    assert.match(objective, /board|student retention|tangible pilot/i);
    assert.match(aiUseCase, /student retention|students at risk|dropping out/i);
    assert.match(guardrail, /budget.*slashed/i);
    assert.match(timing, /three days/i);
    assert.ok(model.brief.environment.includes('Student information system (SIS)'));
    assert.ok(model.brief.priorities.some((item) => /board-ready feasibility demonstration.*not a validated student-risk model/i.test(item)));
    assert.ok(model.brief.priorities.some((item) => /de-identified or synthetic data/i.test(item)));
    assert.ok(model.brief.openQuestions.some((item) => /authorized data owner.*de-identified or synthetic/i.test(item)));
    assert.ok(model.brief.openQuestions.some((item) => /privacy.*fairness.*explainability.*human-review/i.test(item)));
    assert.match(model.brief.nextStep, /institutional and Insight specialists/i);
    assert.deepEqual(model.roadmap.phases.map((phase) => phase.title), [
        'Board outcome and boundary',
        'Authorized data and governance',
        'Bounded human-reviewed demonstration',
        'Validation decision gate',
    ]);
    assert.doesNotMatch(serialized, /runbooks|technical-document search|telemetry analysis|internal IT assistant/i);
    assert.doesNotMatch(serialized, /This is exactly what I needed|I will run with that plan|I will take it from here/i);
    assert.doesNotMatch(guardrail, /students at risk|dropping out/i);
});

test('contact-center outage transcript produces a grounded AI-CX leadership brief', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: "Amy, we're under pressure. I'm juggling a sudden network outage, a delayed cloud migration, and now the CEO wants a roadmap for AI and customer experience by next week. I don't even know where to start. What can you do with that?" },
        { role: 'user', content: 'He wants to see AI cutting call wait times and improving customer satisfaction. But honestly, with the network down, AI feels secondary.' },
        { role: 'user', content: "We don't have a firm date yet. It could be a day or more." },
        { role: 'user', content: "But the board meeting is next week. So I need something AI related that doesn't depend on the network being fully stable. Any ideas there?" },
        { role: 'user', content: 'We have cool recordings and ticket logs on-prem, so that could work. But I need something tangible to present. Can you outline what this might look like?' },
        { role: 'user', content: 'Yes, that would help. Show me the brief so I can get a quick picture to bring to leadership.' },
        { role: 'user', content: "This gives me something concrete to work with. I'll take this forward internally. Thanks, Amy." },
        { role: 'user', content: "Let's wrap up here." },
    ]);

    const serialized = JSON.stringify(model);
    assert.equal(model.lane, 'AI-enabled customer experience');
    assert.equal(model.quality.level, 'grounded');
    assert.match(model.brief.objective, /leadership.*AI-enabled customer-experience brief/i);
    assert.match(model.brief.objective, /reducing call wait times.*improving customer satisfaction/i);
    assert.ok(model.brief.environment.includes('On-premises call recordings'));
    assert.ok(model.brief.environment.includes('On-premises ticket logs'));
    assert.ok(model.brief.environment.includes('Customer service and contact-center operations'));
    assert.match(model.facts.find((fact) => fact.label === 'Primary guardrail')?.value ?? '', /active network outage.*cloud migration is delayed/i);
    assert.equal(model.facts.find((fact) => fact.label === 'Timing')?.value, 'Board meeting next week');
    assert.equal(model.facts.find((fact) => fact.label === 'Stakeholder context')?.value, 'CEO and board leadership');
    assert.equal(model.facts.find((fact) => fact.label === 'Requested output')?.value, 'Visual brief');
    assert.ok(model.brief.priorities.some((item) => /outage stabilization separate/i.test(item)));
    assert.ok(model.brief.priorities.some((item) => /bounded offline leadership concept.*not a live AI deployment/i.test(item)));
    assert.ok(model.brief.openQuestions.some((item) => /authorized for AI analysis.*PII.*payment-data/i.test(item)));
    assert.match(model.brief.nextStep, /bounded offline AI-CX concept/i);
    assert.deepEqual(model.roadmap.phases.map((phase) => phase.title), [
        'Stabilize and separate',
        'Authorize the evidence',
        'Build a bounded offline concept',
        'Set the validation gate',
    ]);
    assert.deepEqual(model.visualBrief.slides.map((slide) => slide.id), [
        'executive_snapshot',
        'decision_context',
        'evidence_and_constraints',
        'recommended_path',
        'validation_path',
        'decisions_and_next_steps',
    ]);
    assert.doesNotMatch(serialized, /Discover and baseline|Design the landing path|representative workload|Hybrid infrastructure modernization/i);
    assert.doesNotMatch(serialized, /Current objective: But I need something tangible|Timing: So I need something AI related/i);
    assert.equal(model.facts.some((fact) => fact.label === 'Context' && /firm date/i.test(fact.value)), false);
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

test('Supplied ERP and municipal session produces accurate working views', () => {
    const turns = [
        { role: 'user', content: "Hi, Amy. I'm a returning user. We spoke before about an Azure migration. Can you pull up what you remember from that?" },
        { role: 'user', content: "Partially. Yes, the ERP cutover with a tight overnight outage window is still key, but there's also a municipal subcontract where compliance is unclear, and we can't assume any framework yet." },
        { role: 'user', content: "Not sure. The prime hasn't flowed anything down yet, so we're treating it as prescoping only and not making assumptions." },
        { role: 'user', content: 'Probably in a few weeks, but it depends on when the prime clarifies compliance. For now, just pre-scoping.' },
        { role: 'user', content: 'Maybe later. For now, just capture that status and please show me the live notes.' },
        { role: 'user', content: 'Now, please show me the live brief.' },
        { role: 'user', content: 'Yes, please build and show me a simple roadmap that separates the ERP cutover work stream from the municipal compliance pre-scoping stream.' },
        { role: 'user', content: 'Do you have a visual?' },
    ];
    const topic = 'ERP cutover with overnight outage window and separate municipal subcontract compliance pre-scoping; both to begin pre-scoping in a few weeks.';
    const model = buildAmyWorkbenchModel(turns, topic);

    assert.equal(model.lane, 'Azure ERP and municipal compliance planning');
    assert.match(model.brief.objective, /two separate workstreams/i);
    assert.match(model.brief.objective, /tight overnight outage window/i);
    assert.doesNotMatch(model.brief.objective, /please (?:build|show)/i);

    const guardrail = model.facts.find((fact) => fact.label === 'Primary guardrail')?.value ?? '';
    const timing = model.facts.find((fact) => fact.label === 'Timing')?.value ?? '';
    const outputs = model.facts.find((fact) => fact.label === 'Requested output')?.value ?? '';
    assert.match(guardrail, /tight overnight ERP cutover window/i);
    assert.match(guardrail, /do not assume a compliance framework/i);
    assert.match(timing, /few weeks/i);
    assert.match(timing, /prime contractor/i);
    assert.equal(outputs, 'Visual brief');
    assert.ok(model.uncertainItems.some((item) => /framework.*not yet known/i.test(item)));
    assert.doesNotMatch(JSON.stringify(model.brief), /Maybe later|please show me|please build and show/i);

    assert.equal(model.roadmap.title, 'ERP cutover + municipal pre-scoping');
    assert.deepEqual(model.roadmap.phases.map((phase) => phase.title), [
        'Shared facts and dependencies',
        'ERP cutover workstream',
        'Municipal compliance pre-scoping',
        'Separate decision gates',
    ]);
    assert.doesNotMatch(model.roadmap.outcome, /Yes, please build/i);
    assert.equal(model.visualBrief.slides[0].summary, model.brief.objective);
});

test('Arizona SVAR and AI additions rebuild the brief and roadmap as three distinct tracks', () => {
    const turns = [
        { role: 'user', content: 'The ERP cutover with its tight overnight outage window is still central, plus municipal subcontract pre-scoping while prime flow-down is unknown.' },
        { role: 'user', content: 'This is for a State of Arizona agency and they mentioned SVAR, S-V-A-R.' },
        { role: 'user', content: 'Leadership also wants a separate AI discovery track for migration runbooks, technical documentation search, telemetry analysis, and an internal IT assistant.' },
        { role: 'user', content: 'Please regenerate the live brief with all three tracks.' },
    ];
    const topic = 'ERP cutover, Arizona SFAR prescoping, and AI discovery';
    const model = buildAmyWorkbenchModel(turns, topic);

    assert.equal(model.lane, 'Azure ERP, Arizona SVAR, and AI discovery');
    assert.match(model.brief.objective, /three distinct tracks/i);
    assert.match(model.brief.objective, /Arizona SVAR software purchasing path/i);
    assert.match(model.brief.objective, /AI opportunities/i);
    assert.ok(model.brief.priorities.some((item) => /not a compliance approval process/i.test(item)));
    assert.ok(model.facts.some((fact) => fact.section === 'Procurement' && /Software Value-Added Reseller/i.test(fact.value)));
    assert.doesNotMatch(JSON.stringify(model), /S-V-A-R|Arizona SFAR|Statewide Vendor Authorization/i);
    assert.match(model.roadmap.title, /ERP cutover.*Arizona SVAR.*AI discovery/i);
    assert.ok(model.roadmap.phases.some((phase) => phase.title === 'Arizona SVAR purchasing path'));
    assert.ok(model.roadmap.phases.some((phase) => phase.title === 'AI discovery workstream'));
    assert.ok(model.brief.openQuestions.some((question) => /agency or contract-controlled information/i.test(question)));
    assert.ok(model.brief.openQuestions.some((question) => /agency AI policy/i.test(question)));
});

test('Workbench control language never becomes organization, timing, or stakeholder data', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'The ERP cutover targets Azure with a tight overnight window. The municipal subcontract is strictly pre-scoping because prime-contractor flow-down is unknown.' },
        { role: 'user', content: 'This is for a State of Arizona agency. SVAR is a likely procurement track, not a compliance framework.' },
        { role: 'user', content: 'Leadership is also asking whether AI can help with migration runbooks, technical documentation search, telemetry analysis, and an internal IT assistant.' },
        { role: 'user', content: 'Before you put that together, please show the live notes.' },
        { role: 'user', content: 'One fix. That organization context line before you put that together is not part of the project. Please remove that entirely, then rebuild the live brief.' },
        { role: 'user', content: "It looks like my instruction got pasted into the timing and stakeholder sections. Please remove the sentence that starts with please remove that entirely from every section. For timing, just say open pending prime contractor compliance flow-down and SVAR clarification. For stakeholder context, leave it blank or note that it's not confirmed yet. Then show me the refreshed live notes." },
    ]);
    const serialized = JSON.stringify(model);
    const timing = model.facts.find((fact) => fact.label === 'Timing')?.value ?? '';

    assert.equal(model.lane, 'Azure ERP, Arizona SVAR, and AI discovery');
    assert.equal(timing, 'open pending prime contractor compliance flow-down and SVAR clarification');
    assert.equal(model.facts.some((fact) => fact.label === 'Stakeholder context'), false);
    assert.match(model.facts.find((fact) => fact.label === 'Context')?.value ?? '', /State of Arizona agency/i);
    assert.doesNotMatch(serialized, /before you put that together|please remove that entirely|pasted into|show me the refreshed/i);
    assert.match(model.brief.objective, /three distinct tracks/i);
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
    assert.deepEqual(model.visualBrief.slides.map((slide) => slide.id), ['executive_snapshot', 'decision_context', 'evidence_and_constraints', 'recommended_path', 'validation_path', 'decisions_and_next_steps']);
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
    assert.match(tools[2].description, /asks to see what a plan would look like/i);
    assert.match(tools[2].description, /before speaking a step-by-step plan/i);
    assert.match(tools[3].description, /meaningful business objective plus at least two/i);
    assert.match(tools[3].description, /not an approved design.*production plan/i);
    assert.match(tools[3].description, /healthcare or EHR conversations.*never infer a root cause.*internal workflow stage.*chart design/is);
    assert.doesNotMatch(JSON.stringify(tools), /Tavus|end_call|response_to_user|search_assist/i);
});

test('Workbench prompt protects visitor review time from filler and premature closing', async () => {
    const prompt = await import('node:fs/promises').then((fs) => fs.readFile(
        new URL('../config/anam/amy-workbench-prompt-upgrade.md', import.meta.url),
        'utf8',
    ));
    assert.match(prompt, /hang on.*one moment.*let me review.*let me look/is);
    assert.match(prompt, /call skip_turn and remain silent/i);
    assert.match(prompt, /Never follow a display with "Is there anything else\?"/i);
    assert.match(prompt, /before we wrap up/i);
    assert.match(prompt, /navigation, review, and editing language as control instructions/i);
    assert.match(prompt, /visibleFacts/i);
    assert.match(prompt, /show me what that plan would look like/i);
    assert.match(prompt, /calls show_solution_roadmap before Amy speaks a step-by-step plan/i);
    assert.match(prompt, /newest explicit artifact request controls/i);
    assert.match(prompt, /active outage or incident/i);
    assert.match(prompt, /quality and missingGrounding/i);
    assert.match(prompt, /never call it leadership-ready/i);
    assert.match(prompt, /healthcare operations, patient intake, clinical workflow, EHR, or EMR/i);
    assert.match(prompt, /Never infer a root cause, internal workflow stage, EHR field or event, export capability/i);
});

test('Amy feature tabs and content use readable production typography', async () => {
    const workbench = await import('node:fs/promises').then((fs) => fs.readFile(
        new URL('../components/amy/AmyAnamWorkbenchV2.tsx', import.meta.url),
        'utf8',
    ));
    assert.match(workbench, /Open full screen/);
    assert.match(workbench, /Exit full screen/);
    assert.match(workbench, /data-expanded=\{isExpanded\}/);
    assert.match(workbench, /lg:w-\[min\(56vw,820px\)\]/);
    assert.match(workbench, /event\.key === 'Escape'/);
    assert.match(workbench, /event\.key === 'ArrowLeft'/);
    assert.match(workbench, /event\.key === 'ArrowRight'/);
    assert.match(workbench, /Conversation-grounded decision brief/);
    assert.match(workbench, /Developing conversation working brief/);
    assert.match(workbench, /VISUAL_SLIDE_LABELS/);
    assert.match(workbench, /bg-\[#fffaf7\]/);
    assert.match(workbench, /model\.quality\.label/);

    assert.match(workbench, /text-\[11px\][^`]+sm:text-sm/);
    assert.match(workbench, /text-sm leading-6 text-zinc-400/);
    assert.match(workbench, /text-xs leading-5 text-zinc-400/);
    assert.doesNotMatch(workbench, /text-\[(?:9|10)px\]/);
});

test('Amy player registers all five visual handlers and keeps workbench local to Cara 4', async () => {
    const player = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8'));
    for (const name of ['show_live_notes', 'show_session_brief', 'show_solution_roadmap', 'show_visual_brief', 'show_solution_catalog']) {
        assert.match(player, new RegExp(name));
    }
    assert.match(player, /isAmyCara4Variant\(sessionVariant\)/);
    assert.match(player, /current\.slice\(-59\)/);
    assert.match(player, /transcriptRef\.current\.slice\(-120\)/);
    assert.match(player, /status: 'view_rebuilt'/);
    assert.match(player, /currentSessionUserTurns/);
    assert.match(player, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
    assert.match(player, /visibleFacts: receiptModel\.facts/);
    assert.match(player, /missingGrounding: receiptModel\.quality\.missing/);
    assert.match(player, /buildAmyWorkbenchModel\(synchronizedTurns, topic, query, view\)/);
    assert.match(player, /setWorkbenchRequestedView\(view\)/);
});

test('Catalog is directional and never claims live commerce data', () => {
    const model = buildAmyWorkbenchModel([{ role: 'user', content: 'Show endpoint and Windows 11 solution categories for 1,200 devices.' }], '', 'endpoint categories');
    assert.equal(model.catalog.categories.length, 4);
    assert.match(model.catalog.boundary, /not verified/i);
    assert.match(model.catalog.boundary, /inventory, pricing, availability, lead time, and contract eligibility/i);
    assert.doesNotMatch(JSON.stringify(model.catalog.categories), /in stock|available now|price is/i);
});
