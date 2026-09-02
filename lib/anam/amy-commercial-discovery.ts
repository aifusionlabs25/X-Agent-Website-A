import type { AmyWorkbenchFact, AmyWorkbenchModel } from './workbench-v2.ts';

// These are reported discovery facts, never live licensing or entitlement data.
// Input is exclusively the caller's already-redacted turns, not tool arguments.
export function applyAmyCommercialDiscovery(model: AmyWorkbenchModel, userTurns: string[]): AmyWorkbenchModel {
    const statements = userTurns.flatMap(turn => turn.replace(/[’‘]/g, "'").split(/(?<=[.!?])\s+/))
        .map(value => value.trim())
        .filter(value => value && !/^(?:if|suppose|imagine|what if|do you|could we|should we|would you|can you explain)\b/i.test(value));
    const context = statements.join(' ');
    if (!/\b(?:renewal|renew(?:ing)? (?:our|the) (?:agreement|licen[cs]es?|subscription))\b/i.test(context)
        || !/\b(?:AI|co[- ]?pilot|artificial intelligence)\b/i.test(context)) return model;
    const reports = statements.filter(value => !/\?/.test(value));
    const latest = (pattern: RegExp) => reports.filter(value => pattern.test(value)).at(-1)?.replace(/[.!?]+$/, '') ?? '';
    const microsoft = /\b(?:Microsoft|Office 365|M365)\b/i.test(context);
    const clean = (value: string) => value.replace(/\bco[- ]pilot\b/gi, 'Copilot').slice(0, 300);
    const productStatement = latest(/\b(?:covers?|use|using|run|running|footprint|estate|environment includes)\b.{0,140}\b(?:365|Teams|Power BI|Salesforce|Adobe)\b/i);
    const scaleStatement = latest(/\b(?:\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:hundred\s+|thousand\s+)?(?:seats?|licen[cs]es?|users?)\b|\b(?:seat|user|licen[cs]e) count\b/i);
    const scale = /\b(?:unknown|unconfirmed|not sure|need to confirm)\b/i.test(scaleStatement) ? ''
        : scaleStatement.match(/\b(?:(?:about|around|roughly|approximately)\s+)?(?:\d[\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:hundred\s+|thousand\s+)?(?:seats?|licen[cs]es?|users?)\b/i)?.[0] ?? '';
    // Keep timing anchored to the named workstream, including approximations and retractions.
    const renewalStatement = latest(/\brenewals?\b.{0,55}\b(?:in|within|due|expires?|unknown|unconfirmed|no longer)\b|\b(?:agreement|subscription)\b.{0,25}\bexpires?\b/i);
    const renewalWindow = /\b(?:unknown|unconfirmed|no longer|not confirmed)\b/i.test(renewalStatement)
        ? renewalStatement : renewalStatement.match(/\b(?:in|within|due|expires?)\s+(?:(?:about|around|roughly|approximately|the next)\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:days?|weeks?|months?|quarters?)\b|\b(?:next|this)\s+(?:month|quarter|year)\b/i)?.[0] ?? '';
    const initiative = clean(latest(/\b(?:leadership|we|our team)\b.{0,65}\b(?:talking about|considering|exploring|evaluating|interested in)\b.{0,80}\b(?:co[- ]?pilot|AI|artificial intelligence)\b/i));
    const rolloutTarget = clean(latest(/\b(?:AI|co[- ]?pilot)\b.{0,65}\b(?:after|before|during|following|next|months?|weeks?|cancelled|canceled|no longer)\b|\b(?:hoping|hope|want|target|plan)\b.{0,80}\b(?:AI|co[- ]?pilot)\b/i));
    const licensing = clean(latest(/\b(?:AI|co[- ]?pilot|licen[cs]ing)\b.{0,90}\b(?:options?|agreement|entitlements?|add[- ]ons?|confirm|unknown)\b|\b(?:options?|agreement|entitlements?)\b.{0,90}\b(?:AI|co[- ]?pilot)\b/i));
    const comparison = /\b(?:together|separately|bundl(?:e|ed|ing)|combined|separate|align)\b/i.test(context);
    const objective = comparison
        ? `Compare coordinated versus separate planning for the ${microsoft ? 'Microsoft ' : ''}renewal and proposed AI adoption, without assuming bundled licensing or an approved rollout.`
        : model.brief.objective;
    const nextStep = 'Review renewal and AI licensing options, costs, and timing with the current reseller or an appropriate licensing specialist before deciding whether to coordinate or separate the purchases.';
    const add = (section: AmyWorkbenchFact['section'], label: string, value: string): AmyWorkbenchFact => ({ section, label, value, status: 'mentioned' });
    const additions = [
        add('Priorities', 'Current objective', objective),
        add('Environment', 'Technology context', clean(productStatement)),
        add('Scale', 'Environment scale', scale),
        add('Timing', 'Renewal window', renewalWindow ? `Visitor-reported: ${renewalWindow}` : ''),
        add('Priorities', 'AI initiative', initiative ? `${initiative}; exploratory, not an approval.` : ''),
        add('Timing', 'AI rollout target', rolloutTarget ? `${rolloutTarget}; reported intent, not a validated schedule.` : ''),
        add('Procurement', 'Licensing status', licensing ? `${licensing}; agreement terms require specialist validation.` : ''),
    ].filter(fact => fact.value);
    const replaced = new Set(['Current objective', 'Technology context', 'Environment scale', 'Timing', 'AI discovery']);
    const facts = model.facts.filter(fact => !replaced.has(fact.label)).concat(additions);
    const timingKnown = Boolean(renewalWindow) && !/\b(?:unknown|unconfirmed|no longer|not confirmed)\b/i.test(renewalWindow);
    const missing = [!timingKnown ? 'renewal timing' : '', !productStatement ? 'current product scope' : ''].filter(Boolean);
    const openQuestions = [
        'Which AI licensing options and associated costs does the agreement actually support?',
        'Who will validate the commercial comparison and authorize any AI spend?',
        ...(!timingKnown ? ['When is the renewal due?'] : []),
        ...(!productStatement ? ['Which products are included in the renewal?'] : []),
    ];
    const boundary = 'Visitor-reported working view only. No licensing entitlement, price, discount, bundled agreement, rollout feasibility, or approval is confirmed.';
    const guardrail = facts.find(fact => fact.label === 'Primary guardrail')?.value ?? '';
    const commercialFacts = additions.filter(fact => fact.label !== 'Current objective').map(fact => `${fact.label}: ${fact.value}`);
    const options = [
        { number: '01', title: 'Validate the renewal baseline', detail: 'Have the responsible reseller or licensing specialist confirm current products, seat counts, renewal terms, and cost assumptions.' },
        { number: '02', title: 'Compare coordinated planning', detail: 'Potential benefit: one cost comparison. Trade-off: unresolved AI scope could complicate renewal decisions. Coordinated planning does not establish bundled purchasing.' },
        { number: '03', title: 'Compare separate decisions', detail: 'Potential benefit: preserve a distinct renewal decision. Trade-off: later AI spend needs its own cost review. No price advantage or eligibility is assumed.' },
        { number: '04', title: 'Review before committing', detail: 'Validate commercial options and AI readiness with the appropriate specialists; obtain owner approval before any purchase or rollout.' },
    ];
    const slide = (id: string, eyebrow: string, title: string, summary: string, bullets: string[]) => ({ id, eyebrow, title, summary, bullets, boundary });
    return {
        ...model, lane: microsoft ? 'Microsoft renewal and AI planning' : 'Renewal and AI planning', facts, signalCount: facts.length,
        quality: { level: missing.length ? 'developing' : 'grounded', label: missing.length ? 'Needs clarification' : 'Conversation grounded', missing },
        brief: { objective, environment: [clean(productStatement)].filter(Boolean), priorities: [guardrail, ...commercialFacts].filter(Boolean), discussionPoints: options.map(option => option.detail), nextStep, openQuestions },
        roadmap: { title: 'Renewal and AI — commercial decision path', outcome: nextStep, facts: facts.filter(fact => fact.section !== 'Identity').map(({ label, value }) => ({ label, value })), phases: options },
        visualBrief: { title: 'Renewal and AI — working comparison', slides: [
            slide('executive_snapshot', '01 / Decision to make', 'Coordinate or separate?', objective, [guardrail, scale ? `Current scope: ${scale}` : '', renewalWindow ? `Renewal: ${renewalWindow}` : ''].filter(Boolean)),
            slide('decision_context', '02 / Reported scope', 'What the visitor has told us', 'Current products and exploratory AI interest are separate facts.', [productStatement, initiative, rolloutTarget].filter(Boolean)),
            slide('evidence_and_constraints', '03 / Commercial questions', 'What still needs validation', licensing || 'Licensing options have not been validated.', openQuestions),
            slide('coordinated_option', '04 / Option A', 'Coordinated planning', 'Conditional business trade-offs, not a purchasing recommendation.', [options[1].detail]),
            slide('separate_option', '05 / Option B', 'Separate decisions', 'Conditional business trade-offs, not an implementation plan.', [options[2].detail]),
            slide('decisions_and_next_steps', '06 / Next step', 'Validate costs before choosing', nextStep, [renewalWindow ? `Renewal window: ${renewalWindow}` : '', rolloutTarget, 'No purchase, rollout, or specialist meeting has been confirmed.'].filter(Boolean)),
        ] },
    };
}
