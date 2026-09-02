import type { AmyWorkbenchFact, AmyWorkbenchModel } from './workbench-v2.ts';

// A decision aid, not a migration design. Input is already contact-redacted visitor
// speech; tool arguments and Amy's proposed solution are never evidence.
export function applyAmyPlanningComparison(model: AmyWorkbenchModel, visitorTurns: string[]): AmyWorkbenchModel {
    if (!visitorTurns.some(turn => /\bcloud migration\b/i.test(turn)
        && /\b(?:cybersecurity|security|compliance)\b/i.test(turn)
        && /\b(?:together or separately|integrated versus phased|integrated (?:or|vs\.?) phased|planned together|handled together)\b/i.test(turn))) return model;

    const sentences = visitorTurns.flatMap(turn => turn.split(/(?<=[.!?])\s+/))
        .filter(value => !/^(?:if|suppose|imagine|what if|do you|could we|should we|would you|are we)\b/i.test(value));
    const latest = (pattern: RegExp) => sentences.filter(value => pattern.test(value)).at(-1) ?? '';
    const drivers = latest(/\b(?:driven by|drivers? (?:are|include)|goals? (?:are|include))\b/i)
        .split(/,?\s+but\s+/i)[0].replace(/[.!?]+$/, '');
    const security = latest(/\b(?:concerned|worried)\b.{0,45}\bdata security\b/i)
        .split(/,?\s+but\s+/i).find(clause => /\bdata security\b/i.test(clause))?.replace(/[.!?]+$/, '') ?? '';
    const preference = latest(/\bleadership\b.{0,40}\b(?:leans? toward|prefers?|has no preference|no longer prefers?|has not decided)\b/i)
        .split(/,?\s+but\s+/i)[0].replace(/[.!?]+$/, '');
    const concern = latest(/\b(?:worried|concerned)\b.{0,70}\b(?:slow|delay)\b/i)
        .split(/,?\s+but\s+/i).find(clause => /\b(?:slow|delay)\b/i.test(clause))?.replace(/[.!?]+$/, '') ?? '';
    const requirement = latest(/\b(?:need|require|no longer need|don't need)\b.{0,60}\binput\b.{0,80}\b(?:IT|compliance)\b/i)
        .replace(/^.*?\bthat\s+(we(?:'ll| will)?\s+(?:need|require|no longer need|don't need))\b/i, '$1')
        .replace(/[.!?]+$/, '');
    const decision = latest(/\b(?:we decided|we selected|the decision is|no decision (?:yet|has been made))\b/i);
    const objective = 'Compare integrated and phased planning for cloud migration and cybersecurity compliance before choosing a path.';
    const nextStep = requirement
        ? 'Gather the requested IT and compliance input, then compare dependencies and timing before recommending a path to leadership.'
        : 'Ask IT and compliance specialists to validate dependencies and timing before recommending an integrated or phased path.';
    const fact = (section: AmyWorkbenchFact['section'], label: string, value: string): AmyWorkbenchFact => ({ section, label, value, status: 'mentioned' });
    const additions = [
        fact('Priorities', 'Current objective', objective),
        fact('Priorities', 'Business drivers', drivers),
        fact('Constraints', 'Security concern', security),
        fact('Decisions', 'Leadership preference', preference ? `${preference}; preference is not approval.` : ''),
        fact('Constraints', 'Delivery concern', concern ? `${concern}. This is a reported concern status, not a validated delay.` : ''),
        fact('Decisions', 'Decision requirement', requirement),
        fact('Decisions', 'Decision status', decision || 'Integrated versus phased approach remains under review; no selection has been reported.'),
    ].filter(item => item.value);
    // The latest instruction must not become the guardrail or replace leadership's
    // preference. These fields have separate lifetimes and survive the closing.
    const facts = model.facts.filter(item => !['Current objective', 'Primary guardrail', 'Stakeholder context', 'Decision'].includes(item.label)).concat(additions);
    const openQuestions = [
        'Which dependencies do IT and compliance identify between the two efforts?',
        'What timing or operating window matters?',
    ].filter(question => !/timing/.test(question) || !facts.some(item => item.section === 'Timing'));
    const boundary = 'Options for discussion only; no path, compliance outcome, design, timing, or booking is approved.';
    const integrated = [
        'Potential benefit: shared planning may reduce duplicated work and expose dependencies earlier.',
        'Trade-off: shared decision gates could slow work that might otherwise progress independently.',
        'Validate: which requirements genuinely overlap, and whether joint ownership is practical.',
    ];
    const phased = [
        'Potential benefit: work with validated independent prerequisites may progress in stages.',
        'Trade-off: later coordination may create rework if shared requirements are missed.',
        'Validate: what can be separated safely and what must be resolved before either effort proceeds.',
    ];
    const phases = [
        { number: '01', title: 'Gather decision input', detail: requirement || 'Identify IT and compliance reviewers; do not assume their approval.' },
        { number: '02', title: 'Compare integrated planning', detail: integrated[0] + ' ' + integrated[1] },
        { number: '03', title: 'Compare phased planning', detail: phased[0] + ' ' + phased[1] },
        { number: '04', title: 'Review and choose', detail: 'Leadership reviews specialist-validated dependencies, trade-offs, and timing before selecting a path.' },
    ];
    const evidence = facts.filter(item => ['Technology context', 'Governance drivers', 'Security concern', 'Delivery concern'].includes(item.label));
    const priorities = additions.filter(item => ['Business drivers', 'Leadership preference', 'Decision requirement', 'Delivery concern'].includes(item.label)).map(item => `${item.label}: ${item.value}`);
    const slide = (id: string, eyebrow: string, title: string, summary: string, bullets: string[]) => ({ id, eyebrow, title, summary, bullets, boundary });
    return {
        ...model,
        signalCount: facts.length,
        facts,
        quality: { ...model.quality, missing: openQuestions },
        brief: { ...model.brief, objective, priorities, discussionPoints: [...integrated, ...phased], nextStep, openQuestions },
        roadmap: { title: 'Integrated versus phased — decision path', outcome: nextStep, facts: facts.filter(item => item.section !== 'Identity').map(({ label, value }) => ({ label, value })), phases },
        visualBrief: {
            title: 'Integrated versus phased — working comparison',
            slides: [
                slide('executive_snapshot', '01 / Decision to make', 'Together or separately?', objective, priorities.length ? priorities.slice(0, 3) : ['The approach has not been selected.']),
                slide('decision_context', '02 / Reported context', 'What the visitor has told us', 'Reported context is separate from specialist validation.', evidence.map(item => `${item.label}: ${item.value}`)),
                slide('integrated_option', '03 / Option A', 'Integrated planning', 'A conditional option, not a recommendation.', integrated),
                slide('phased_option', '04 / Option B', 'Phased planning', 'A conditional option, not a recommendation.', phased),
                slide('validation_path', '05 / Decision requirements', 'What must be validated', requirement || 'IT and compliance input is a proposed next step, not a completed review.', [preference ? `Reported preference: ${preference}` : 'Leadership preference has not been stated.', ...openQuestions]),
                slide('decisions_and_next_steps', '06 / Next step', 'Prepare a supported recommendation', nextStep, [decision || 'No path has been selected.', 'This is not an implementation plan or scheduling confirmation.']),
            ],
        },
    };
}
