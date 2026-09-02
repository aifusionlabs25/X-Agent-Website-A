import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AMY_WORKBENCH_BOUNDARY,
    buildAmyWorkbenchModel,
    diffAmyWorkbenchFacts,
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
    assert.deepEqual(model.brief.environment, ['Azure', 'Servers', 'ERP']);
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

test('public-sector proof requests do not become stakeholder or constraint facts', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: "I'm the IT Operations Manager for a city government in Arizona. We're in the early stages of secure, standardized endpoint modernization." },
        { role: 'user', content: 'What key information should I gather first? Are we talking hardware inventories, user needs, security baselines, or something else?' },
        { role: 'user', content: 'Could you show a quick example of what Insight has done for a similar public sector environment?' },
    ], '', '', 'visual');
    const stakeholder = model.facts.find((fact) => fact.label === 'Stakeholder context')?.value ?? '';
    const constraint = model.facts.find((fact) => fact.label === 'Primary guardrail')?.value ?? '';
    assert.match(stakeholder, /IT Operations Manager/i);
    assert.doesNotMatch(stakeholder, /similar public sector|quick example/i);
    assert.doesNotMatch(constraint, /hardware inventories|something else/i);
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

test('infrastructure-refresh visual grounds the board decision before and after the smaller-office assumption', () => {
    const userTurns = [
        "Amy, our IT team is asking for a major infrastructure refresh. And I don't really understand why it's so expensive or what happens if I delay it.",
        'Where do I even start?',
        "They're talking about servers and some network equipment, but I'm not sure which parts. Timeline-wise, we have a budget review next quarter. Honestly, if I can push this into next year, I'd prefer that. But IT says there's risk.",
        "They've mentioned cyber security risk, but I haven't gotten specifics. They just say aging infrastructure. I need to know if this is real or if they're just trying to get a new toy.",
        "We had an audit six months ago that flagged some outdated firmware, but no major breaches. It's more that they're saying if we don't upgrade, we'll fall behind.",
        'So what would you recommend?',
        "Before I decide on a specialist, I'd need something clear to take to the board. Could you show me a brief outline of what we've discussed so far?",
        "something they'd understand.",
        "This is helpful. I'll review it before the meeting. Actually, wait, I just remembered. We might be merging a smaller office next quarter. How would that change the spager?",
        "Right, it would likely change scope and budget. We'd need to include their systems. Let's assume that's happening. Can we update the brief to reflect that potential expansion?",
    ];
    const buildRevision = (count) => buildAmyWorkbenchModel(
        userTurns.slice(0, count).map((content) => ({ role: 'user', content })),
        '',
        '',
        'visual',
    );
    const revisionOne = buildRevision(7);
    const revisionTwo = buildRevision(10);

    assert.equal(revisionOne.lane, 'Security readiness');
    assert.match(revisionOne.brief.objective, /board.*server and network components.*cost/i);
    assert.match(revisionOne.brief.objective, /security and lifecycle evidence/i);
    assert.match(revisionOne.brief.objective, /budget review.*deferring.*next year/i);
    assert.doesNotMatch(revisionOne.brief.objective, /Before I decide on a specialist|show me a brief outline/i);
    assert.deepEqual(revisionOne.brief.environment, ['Servers', 'Network equipment']);
    assert.equal(revisionOne.facts.find((fact) => fact.label === 'Technology context')?.value, 'Servers / Network equipment');
    assert.match(revisionOne.facts.find((fact) => fact.label === 'Audit evidence')?.value ?? '', /audit six months ago.*outdated firmware.*no major breaches/i);
    assert.match(revisionOne.facts.find((fact) => fact.label === 'Stakeholder context')?.value ?? '', /board decision audience.*IT team/i);
    assert.equal(revisionOne.facts.find((fact) => fact.label === 'Timing')?.value, 'Budget review next quarter');
    assert.match(revisionOne.facts.find((fact) => fact.label === 'Deferral preference')?.value ?? '', /defer.*next year/i);
    assert.equal(revisionOne.quality.level, 'developing');
    assert.deepEqual(revisionOne.quality.missing, [
        'specific server and network scope',
        'validated security severity',
        'option-level cost evidence',
    ]);
    assert.deepEqual(revisionOne.roadmap.phases.map((phase) => phase.title), [
        'Confirm the component boundary',
        'Validate security severity',
        'Compare bounded options',
        'Set the board decision gate',
    ]);
    assert.match(revisionOne.visualBrief.slides[0].bullets.join(' '), /budget review next quarter.*next year/i);
    assert.match(revisionOne.visualBrief.slides[0].bullets.join(' '), /servers and network equipment.*exact components remain unconfirmed/i);
    assert.match(revisionOne.visualBrief.slides[0].bullets.join(' '), /outdated firmware.*no major breaches/i);
    assert.doesNotMatch(revisionOne.facts.find((fact) => fact.label === 'Stakeholder context')?.value ?? '', /Before I decide|something clear/i);

    const planningAssumption = revisionTwo.facts.find((fact) => fact.label === 'Planning assumption')?.value ?? '';
    const expansionImpact = revisionTwo.facts.find((fact) => fact.label === 'Scope and budget impact')?.value ?? '';
    const visibleFacts = revisionTwo.facts.map((fact) => `${fact.label}: ${fact.value}`);
    assert.match(planningAssumption, /smaller-office merger.*next quarter.*include that office's systems.*inventory remains unvalidated/i);
    assert.match(expansionImpact, /scope and budget expand.*smaller-office systems.*inventory validation/i);
    assert.match(revisionTwo.facts.find((fact) => fact.label === 'Technology context')?.value ?? '', /Servers.*Network equipment.*Smaller-office systems \(inventory pending\)/i);
    assert.equal(revisionTwo.uncertainItems.some((item) => /merging a smaller office/i.test(item)), false);
    assert.ok(visibleFacts.some((fact) => /Planning assumption:.*smaller-office merger.*next quarter.*office's systems/i.test(fact)));
    assert.ok(visibleFacts.some((fact) => /Scope and budget impact:.*scope and budget expand/i.test(fact)));
    assert.match(revisionTwo.visualBrief.slides[0].bullets[0], /Planning assumption:.*smaller-office merger.*next quarter.*office's systems.*scope and budget expand/i);
    assert.equal(revisionTwo.facts.find((fact) => fact.label === 'Timing')?.value, 'Budget review next quarter');
    assert.match(revisionTwo.facts.find((fact) => fact.label === 'Deferral preference')?.value ?? '', /next year/i);
    assert.equal(revisionTwo.quality.level, 'developing');
    assert.deepEqual(revisionTwo.quality.missing, revisionOne.quality.missing);
    assert.doesNotMatch(JSON.stringify(revisionTwo.uncertainItems), /smaller office/i);

    const delta = diffAmyWorkbenchFacts(revisionOne, revisionTwo);
    assert.ok(delta.some((change) => change.kind === 'added' && change.label === 'Planning assumption' && /smaller-office merger/i.test(change.value)));
    assert.ok(delta.some((change) => change.kind === 'added' && change.label === 'Scope and budget impact' && /scope and budget expand/i.test(change.value)));
    assert.ok(delta.some((change) => change.kind === 'updated' && change.label === 'Technology context' && change.previousValue === 'Servers / Network equipment' && /Smaller-office systems/i.test(change.value)));
    assert.equal(delta.some((change) => change.kind === 'removed'), false);
});

test('fact delta reports deterministic added, updated, and removed receipt facts', () => {
    const previous = buildAmyWorkbenchModel([
        { role: 'user', content: 'We run Azure and must protect business continuity before next quarter. Show me the brief.' },
    ], '', '', 'brief');
    const next = {
        ...previous,
        facts: [
            ...previous.facts
                .filter((fact) => fact.label !== 'Primary guardrail')
                .map((fact) => fact.label === 'Technology context' ? { ...fact, value: 'Azure / VMware' } : fact),
            { section: 'Constraints', label: 'Planning assumption', value: 'Include a second site.', status: 'mentioned' },
        ],
    };
    const delta = diffAmyWorkbenchFacts(previous, next);

    assert.ok(delta.some((change) => change.kind === 'added' && change.label === 'Planning assumption' && change.value === 'Include a second site.'));
    assert.ok(delta.some((change) => change.kind === 'updated' && change.label === 'Technology context' && change.previousValue === 'Azure' && change.value === 'Azure / VMware'));
    assert.ok(delta.some((change) => change.kind === 'removed' && change.label === 'Primary guardrail' && /continuity/i.test(change.value)));
    assert.ok(diffAmyWorkbenchFacts(null, next).every((change) => change.kind === 'added'));
});

test('infrastructure refresh does not invent board, budget-review, or deferral timing', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: 'We are considering an infrastructure refresh for servers and network equipment.' },
        { role: 'user', content: 'Show me a visual brief of what still needs validation.' },
    ], '', '', 'visual');
    const serialized = JSON.stringify(model);

    assert.match(model.brief.objective, /leadership.*server and network components.*next decision gate/i);
    assert.doesNotMatch(serialized, /next quarter|next year|\bboard\b|\bcost evidence\b|\bcost drivers\b/i);
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
        'Outcome and boundary',
        'Authorized data and governance',
        'Bounded feasibility decision',
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

test('CJIS device-refresh replay separates the funded rollout from unapproved AI interest', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: "We've got a device refresh funded. Leadership is asking about AI and security is pushing compliance." },
        { role: 'user', content: "We don't have the AI pilot scheduled yet. Just interest. The device rollout starts next quarter." },
        { role: 'user', content: 'We are under CJIS because of law enforcement data and state security standards.' },
        { role: 'user', content: 'The ideas are administrative paperwork, shift scheduling, and staffing reports. Nothing like case files; we would call it non-sensitive.' },
        { role: 'user', content: "I'm the owner, but I need buy-in from our operations director. Show me a visual brief." },
    ], '', '', 'visual');

    const serialized = JSON.stringify(model);
    assert.equal(model.lane, 'Public-sector modernization');
    assert.equal(model.quality.level, 'developing');
    assert.ok(model.quality.missing.some((item) => /CJIS.*data boundary/i.test(item)));
    assert.match(model.facts.find((fact) => fact.label === 'Device refresh status')?.value ?? '', /Funded.*next quarter/i);
    assert.match(model.facts.find((fact) => fact.label === 'AI status')?.value ?? '', /interest only.*no pilot.*approved.*funded.*scheduled/i);
    assert.match(model.facts.find((fact) => fact.label === 'Available data')?.value ?? '', /non-sensitive.*CJIS boundary not validated/i);
    assert.match(model.visualBrief.slides[0].title, /Two tracks.*one committed.*one still to validate/i);
    assert.match(serialized, /administrative paperwork.*shift scheduling.*staffing reports/i);
    assert.match(serialized, /agency security-owner.*Insight.*validation/i);
    assert.doesNotMatch(serialized, /10\s*%|host the model|private cloud|same quarter as the first batch|certify the AI tool/i);
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
test('Roadmap tool prose cannot invent scope; visitor-provided scope still works', () => {
    const topic = 'Modernize 1,200 Windows 11 endpoints with Intune in controlled waves before peak season.';
    const model = buildAmyWorkbenchModel([{ role: 'user', content: 'Please show me a phased endpoint roadmap.' }], topic);
    assert.doesNotMatch(JSON.stringify(model.facts), /1,200|Intune|Windows 11/);
    const grounded = buildAmyWorkbenchModel([{ role: 'user', content: topic }]);
    assert.equal(grounded.lane, 'Endpoint modernization');
    assert.equal(grounded.roadmap.phases.length, 4);
    assert.match(grounded.roadmap.phases[0].detail, /1,200/i);
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

test('Anam client tools route bounded views, capability overview, and distinct deterministic closes', async () => {
    const tools = (await import('../config/anam/amy-workbench-client-tools.json', { with: { type: 'json' } })).default;
    assert.deepEqual(tools.map((tool) => tool.name), [
        'show_live_notes',
        'show_session_brief',
        'show_solution_roadmap',
        'show_amy_intelligence',
        'show_visual_brief',
        'show_solution_catalog',
        'close_amy_intelligence',
        'end_amy_session',
    ]);
    assert.ok(tools.every((tool) => tool.type === 'CLIENT'));
    assert.ok(tools.every((tool) => tool.config?.awaitResult === true));
    assert.ok(tools.every((tool) => tool.config?.parameters?.type === 'object'));
    assert.ok(tools.every((tool) => tool.description.length >= 1 && tool.description.length <= 1_024));
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    assert.match(byName.show_solution_catalog.description, /Never call this tool if the same request asks for a live SKU, part number, inventory, price, availability/i);
    assert.match(byName.show_solution_roadmap.description, /asks to see what a plan would look like/i);
    assert.match(byName.show_solution_roadmap.description, /before speaking a step-by-step plan/i);
    assert.match(byName.show_visual_brief.description, /meaningful business objective plus at least two/i);
    assert.match(byName.show_visual_brief.description, /not an approved design.*production plan/i);
    assert.match(byName.show_visual_brief.description, /healthcare or EHR conversations.*never infer a root cause.*internal workflow stage.*chart design/is);
    assert.match(byName.show_amy_intelligence.description, /not a customer Visual Brief/i);
    assert.match(byName.close_amy_intelligence.description, /never ends the conversation/i);
    assert.match(byName.end_amy_session.description, /unmistakable session-ending intent/i);
    assert.match(byName.end_amy_session.description, /at most once per visitor turn/i);
    assert.doesNotMatch(JSON.stringify(tools), /Tavus|end_call|response_to_user|search_assist|search_insight_catalog/i);
});

test('Amy public-sector visual replay preserves stakeholders and updates funding without inventing a contract', () => {
    const baseUserTurns = [
        "Hey, Amy. Nice to meet you. I'm Tom.",
        "Well, I'm still figuring out what to ask. You ever have one of those projects where everybody says modernization, but they mean something different?",
        "So far, I've got field teams asking for rugged laptops, another group talking about AI inspections, and now leadership wants better connectivity at remote sites. It's all being called modernization.",
        "Honestly, that's part of the confusion. I think they're lumping it all together. But these might be separate. The budget is one big pool though. And I'm running out of time in this fiscal year.",
        "That would help. I think rugged devices might be a straightforward procurement. But AI inspections are more experimental. Remote connectivity is tied to state funding. So yes, splitting makes sense. But I'm not sure how to explain that to our procurement team.",
        "It's our procurement officer and finance lead. They need to know which budget line each piece hits and whether anything requires competitive bidding or can fit under an existing contract vehicle. That's where I get stuck.",
        "I believe we have a state contract that might cover hardware, but I'll need to confirm. The AI side probably doesn't have a contract path yet. So yes, if you can help me map this, that would be golden.",
        'Yes, show me that brief. I need something to make sense of these parts before I get cornered by finance.',
    ];
    const asTurns = (items) => items.map((content) => ({ role: 'user', content }));
    const revision1 = buildAmyWorkbenchModel(asTurns(baseUserTurns), '', '', 'visual');
    const revision2 = buildAmyWorkbenchModel(asTurns([
        ...baseUserTurns,
        'This helps. Actually, I just remembered the connectivity project might involve federal funding, so that could change the procurement path. Can we update that?',
    ]), '', '', 'visual');
    const value = (model, label) => model.facts.find((fact) => fact.label === label)?.value ?? '';
    const serialized = JSON.stringify(revision2);

    assert.equal(value(revision1, 'Stakeholder context'), 'Procurement officer and finance lead');
    assert.equal(value(revision2, 'Stakeholder context'), 'Procurement officer and finance lead');
    assert.match(value(revision2, 'Modernization workstreams'), /Rugged devices.*straightforward procurement.*AI inspections.*experimental.*Remote-site connectivity.*funding-dependent/i);
    assert.match(value(revision1, 'Funding context'), /State funding was reported/i);
    assert.doesNotMatch(value(revision1, 'Funding context'), /federal/i);
    assert.match(value(revision2, 'Funding context'), /State funding was reported.*federal funding may also apply.*unconfirmed planning assumption/is);
    assert.match(value(revision2, 'Contract-path status'), /hardware may fit an existing state contract.*unconfirmed.*No contract path has been identified for AI inspections/is);
    assert.match(value(revision2, 'Timing'), /current fiscal-year deadline/i);
    assert.doesNotMatch(serialized, /Arizona|SVAR|GSA/i);
    assert.match(revision2.quality.label, /Needs clarification/i);
    assert.ok(revision2.quality.missing.includes('purchasing jurisdiction'));
    assert.ok(revision2.quality.missing.includes('purchasing entity'));
    assert.ok(revision2.quality.missing.includes('confirmed connectivity funding source'));
    assert.match(revision2.visualBrief.slides[0].bullets.join(' '), /federal funding may also apply.*unconfirmed/i);

    const delta = diffAmyWorkbenchFacts(revision1, revision2);
    assert.deepEqual(delta.map((change) => `${change.kind}:${change.label}`), ['updated:Funding context']);
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

test('Amy visual brief preserves the planned cloud track and latest staffing refinement without inventing public-safety facts', () => {
    const userTurns = [
        "We're planning a cloud migration, but leadership has been asking about AI too. I'm trying to figure out if we can do both at the same time.",
        "The cloud migration is planned. The AI part is early. We're looking at improving customer service, maybe call center automation, but nothing is committed.",
        'The COO is sponsoring the AI side. She wants a separate track outlined so we can evaluate it without slowing down the cloud work.',
        'Yes, show me the visual brief.',
        'We want to use AI to optimize staffing schedules. We have shift calendars and payroll logs. I want to exclude CJIS data. There is no AI pilot approved yet. It is just exploration.',
        'Please update the visual brief with that.',
    ].map((content) => ({ role: 'user', content }));
    const model = buildAmyWorkbenchModel(userTurns, '', '', 'visual');
    const value = (label) => model.facts.find((fact) => fact.label === label)?.value ?? '';

    assert.equal(model.lane, 'Cloud migration and AI staffing discovery');
    assert.match(value('Cloud migration status'), /planned workstream/i);
    assert.match(value('AI staffing status'), /exploration only.*no pilot is approved.*COO/i);
    assert.match(value('Critical workloads'), /staffing schedule operations/i);
    assert.match(value('Available data'), /shift calendars.*payroll logs/is);
    assert.match(value('Data boundary'), /CJIS data remain out of scope.*must validate/i);
    assert.match(value('Stakeholder context'), /COO sponsor/i);
    assert.match(model.brief.objective, /planned cloud migration.*separate, unapproved AI staffing/i);
    assert.match(model.visualBrief.slides[0].title, /two tracks.*one planned.*exploratory/i);
    assert.match(model.visualBrief.slides[0].bullets.join(' '), /Cloud migration.*AI staffing optimization.*no approved pilot/is);
    assert.match(model.quality.label, /Needs clarification/i);
    assert.equal(value('Device refresh status'), '');
    assert.doesNotMatch(value('Critical workloads'), /customer service|contact center/i);
    assert.doesNotMatch(value('Available data'), /call recordings|ticket logs/i);
    assert.doesNotMatch(value('Primary guardrail'), /agency security owner|Insight Public Sector|on-premises/i);
});

test('Amy feature tabs and content use readable production typography', async () => {
    const fs = await import('node:fs/promises');
    const [workbench, player] = await Promise.all([
        fs.readFile(new URL('../components/amy/AmyAnamWorkbenchV2.tsx', import.meta.url), 'utf8'),
        fs.readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8'),
    ]);
    assert.match(workbench, /Open full screen/);
    assert.match(workbench, /Exit full screen/);
    assert.match(workbench, /data-expanded=\{isExpanded\}/);
    assert.match(player, /key=\{workbenchOpen \? 'amy-workbench-open' : 'amy-workbench-closed'\}/);
    assert.match(workbench, /lg:w-\[min\(62vw,980px\)\]/);
    assert.match(workbench, /event\.key === 'Escape'/);
    assert.match(workbench, /event\.key === 'ArrowLeft'/);
    assert.match(workbench, /event\.key === 'ArrowRight'/);
    assert.match(workbench, /Conversation-grounded decision brief/);
    assert.match(workbench, /Developing conversation working brief/);
    assert.match(workbench, /VISUAL_SLIDE_LABELS/);
    assert.match(workbench, /bg-\[#fffaf7\]/);
    assert.match(workbench, /model\.quality\.label/);
    assert.match(workbench, /Revision \{revision\}/);
    assert.match(workbench, /role="status"/);
    assert.match(workbench, /aria-live="polite"/);
    assert.match(workbench, /displayedAppliedChanges/);
    assert.match(workbench, /visualSlideIndex/);
    assert.match(workbench, /onVisualSlideIndexChange/);
    assert.doesNotMatch(workbench, /setSlideIndex/);
    assert.match(workbench, /isVisualView \? 'flex flex-col overflow-y-auto py-3 md:overflow-hidden'/);
    assert.match(workbench, /grid h-full min-h-\[300px\] grid-rows-\[auto_auto_minmax\(0,1fr\)_auto\]/);
    assert.match(workbench, /md:grid-cols-3/);
    assert.match(workbench, /Visual Brief controls/);
    assert.doesNotMatch(workbench, /min-h-\[440px\]/);
    assert.match(workbench, /document\.body\.style\.overflow = 'hidden'/);
    assert.match(workbench, /document\.documentElement\.style\.overflow = 'hidden'/);

    assert.match(workbench, /text-\[11px\][^`]+sm:text-sm/);
    assert.match(workbench, /text-sm leading-6 text-zinc-400/);
});

test('Amy visual brief preserves StateRAMP, privacy, cloud scope, and year-end timing', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: "I'm David, IT Director for a state agency. Leadership wants modernization, procurement is warning about budgets, and security is on edge." },
        { role: 'user', content: "They're pushing for cloud migration and moving legacy apps off-prem, but AI is a wild card." },
        { role: 'user', content: 'They want the core workloads in the cloud by year-end.' },
        { role: 'user', content: "We're under StateRAMP due to state-level data, and we have internal privacy boundaries." },
        { role: 'user', content: 'Show me the Visual Brief.' },
    ], '', '', 'visual');
    const value = (label) => model.facts.find((fact) => fact.label === label)?.value ?? '';
    assert.equal(model.lane, 'StateRAMP cloud modernization');
    assert.match(value('Technology context'), /Cloud migration.*Legacy applications/i);
    assert.match(value('Cloud migration status'), /core workloads.*legacy applications/i);
    assert.equal(value('Governance drivers'), 'StateRAMP');
    assert.match(value('Privacy boundary'), /internal privacy.*data-classification/i);
    assert.equal(value('Timing'), 'Core cloud workloads by year-end');
    assert.match(value('Current objective'), /core workloads.*cloud by year-end.*AI.*separate/i);
});

test('Amy public-sector audit brief preserves access-control evidence and Azure AD without ASR fragments', () => {
    const model = buildAmyWorkbenchModel([
        { role: 'user', content: "Amy, I'm Chris, Deputy CIO for a state agency. We've got a compliance audit coming, leadership asking about AI potential, and a legacy system on its last legs. I need help prioritizing next steps." },
        { role: 'user', content: "The compliance audit is on a fixed date, so that's the most urgent. But I'm trying to figure out if that refresh delays us or if AI is even realistic this year." },
        { role: 'user', content: "The audit is in 90 days. They want proof we've addressed access control gaps." },
        { role: 'user', content: 'it so I can share it with leadership.' },
        { role: 'user', content: 'My email is R-V-I-C-K-S at gmail dot com.' },
        { role: 'user', content: 'We use Azure AD for access management.' },
        { role: 'user', content: 'Before we wrap, show me the visual brief.' },
    ], '', '', 'visual');
    const facts = model.facts.map(fact => `${fact.label}: ${fact.value}`).join('\n');

    assert.match(facts, /Azure AD access management/);
    assert.match(facts, /proof that identified access-control gaps were addressed/i);
    assert.match(facts, /90 days/i);
    assert.match(facts, /Deputy CIO \/ agency leadership/i);
    assert.doesNotMatch(facts, /it so I can share it with leadership/i);
    assert.doesNotMatch(facts, /gmail|R-V-I-C-K-S/i);
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
    assert.match(player, /await waitForWorkbenchTranscriptToSettle\(\)/);
    assert.match(player, /WORKBENCH_TRANSCRIPT_SETTLE_MAX_PASSES = 10/);
    assert.match(player, /diffAmyWorkbenchFacts\(lastWorkbenchModelRef\.current, receiptModel\)/);
    assert.match(player, /contentChanged/);
    assert.match(player, /appliedChanges/);
    assert.match(player, /Never claim that a requested addition or update was applied unless the named detail appears in both appliedChanges and visibleFacts/i);
    assert.match(player, /setWorkbenchVisualSlideIndex\(0\)/);
    assert.match(player, /revision=\{workbenchRevision\}/);
});

test('Catalog is directional and never claims live commerce data', () => {
    const model = buildAmyWorkbenchModel([{ role: 'user', content: 'Show endpoint and Windows 11 solution categories for 1,200 devices.' }], '', 'endpoint categories');
    assert.equal(model.catalog.categories.length, 4);
    assert.match(model.catalog.boundary, /not verified/i);
    assert.match(model.catalog.boundary, /inventory, pricing, availability, lead time, and contract eligibility/i);
    assert.doesNotMatch(JSON.stringify(model.catalog.categories), /in stock|available now|price is/i);
});
