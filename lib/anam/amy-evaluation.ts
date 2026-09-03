import type { AmyWorkbenchFactChange, AmyWorkbenchModel, AmyWorkbenchTurn } from './workbench-v2.ts';
import { hasAmyCapabilityOverviewIntent } from './amy-capability-intent.ts';

export const AMY_EVALUATION_BOUNDARY = 'Independent AI Fusion Labs demo. No customer opportunity, Insight CRM submission, or specialist assignment is established by this evaluation.';
export const AMY_SAMPLE_BOUNDARY = 'FICTIONAL EXAMPLE — not your organization, a real customer, a completed assessment, or an approved plan.';

const normalize = (value: string) => value.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const CUSTOMER_CONTEXT = /\b(?:we|our|my (?:company|organization|agency|team)|the client)\b.{0,160}\b(?:use|run|have|need|plan|migrat\w*|upgrad\w*|renew\w*|audit|funded|deadline|workloads?|infrastructure|systems?|data center|compliance)\b/i;
const CUSTOMER_TRANSITION = /\b(?:real|actual|specific) (?:customer|client|opportunity|project|situation)\b|\bswitch (?:to|into)\b.{0,30}\b(?:real|actual) (?:customer|client|opportunity|project)\b/i;
const EXPLICIT_EVALUATION_TRANSITION = /\b(?:evaluat\w*|interview\w*|review\w*|test\w*) (?:you|amy|this demo|an x agent)\b|\bback to (?:the demo|your capabilities)\b/i;
const EVALUATION_CONTEXT = /\bwhat(?:'s| is) your role\b|\bhow (?:exactly )?(?:would|does|can) (?:you|that|this) (?:help|improve|support) (?:my|our|the) (?:team|sellers?|sales team)\b/i;
const SCENARIO_TRANSITION = /\b(?:let(?:'s| us) say|assume|imagine|hypothetical(?:ly)?|role[- ]?play|pretend|example scenario)\b/i;

export interface AmyEvaluationSample {
    title: string;
    facts: Array<{ label: string; value: string }>;
}

function classifyAmyConversation(turns: AmyWorkbenchTurn[]) {
    let mode: 'evaluation' | 'discovery' = 'discovery';
    let customerEstablished = false;
    let evaluationStart = 0;
    const userTurns = turns.filter(turn => turn.role === 'user');
    for (const [index, turn] of userTurns.entries()) {
        const text = normalize(turn.content);
        if (CUSTOMER_TRANSITION.test(text)) {
            mode = 'discovery';
            customerEstablished = true;
        } else if (EXPLICIT_EVALUATION_TRANSITION.test(text)) {
            mode = 'evaluation';
            customerEstablished = false;
            evaluationStart = index;
        } else if (mode === 'evaluation') {
            continue;
        } else if (CUSTOMER_CONTEXT.test(text)) {
            mode = 'discovery';
            customerEstablished = true;
        } else if (!customerEstablished && (EVALUATION_CONTEXT.test(text) || SCENARIO_TRANSITION.test(text) || hasAmyCapabilityOverviewIntent(text))) {
            mode = 'evaluation';
            evaluationStart = index;
        }
    }
    return { mode, evaluationTurns: mode === 'evaluation' ? userTurns.slice(evaluationStart) : [] };
}

/** Visitor-only, session-local classification shared by the screen and finalized emails.
 * A capability question during established discovery does not erase the opportunity.
 * Titles, assistant prose and tool arguments never authenticate or establish facts.
 */
export function amyConversationMode(turns: AmyWorkbenchTurn[]): 'evaluation' | 'discovery' {
    return classifyAmyConversation(turns).mode;
}

const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const EXACT_DATE = new RegExp(`\\b(${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+20\\d{2})\\b`, 'i');

export function readAmyEvaluationSample(turns: AmyWorkbenchTurn[]): AmyEvaluationSample {
    const classified = classifyAmyConversation(turns);
    const relevantTurns = classified.mode === 'evaluation' ? classified.evaluationTurns : turns.filter(turn => turn.role === 'user');
    const userTurns = relevantTurns.map(turn => normalize(turn.content));
    const source = userTurns.join(' ');
    const stateCio = /\bstate CIO\b/i.test(source);
    const modernization = /\bmodernization\b/i.test(source);
    let originalTimeline = '';
    let revisedTimeline = '';
    for (const text of userTurns) {
        if (!SCENARIO_TRANSITION.test(text) && !/\b(?:deadline|timeline)\b/i.test(text)) continue;
        const exact = text.match(EXACT_DATE)?.[1]?.replace(/(\d)(?:st|nd|rd|th)\b/i, '$1');
        const original = text.match(/\boriginal deadline (?:was|is)\s+((?:about |roughly )?\w+ months? out(?: from today)?)/i)?.[1];
        const relative = text.match(/\b(?:new|revised) deadline\b.{0,45}\b((?:about |roughly )?\w+ months? (?:out )?from today)\b/i)?.[1]
            ?? text.match(/\bnow\s+((?:about |roughly )?\w+ months? out from today)\b/i)?.[1];
        if (original) originalTimeline = original;
        if (relative) revisedTimeline = relative;
        if (exact) revisedTimeline = exact;
    }
    const facts = [
        stateCio ? { label: 'Illustrative stakeholder', value: 'State CIO' } : null,
        modernization ? { label: 'Illustrative initiative', value: 'Complex modernization request' } : null,
        originalTimeline ? { label: 'Illustrative original timeline', value: originalTimeline } : null,
        revisedTimeline ? { label: 'Illustrative revised deadline', value: revisedTimeline } : null,
    ].filter((fact): fact is { label: string; value: string } => Boolean(fact));
    if (!facts.length) facts.push({ label: 'Illustrative initiative', value: 'Workstation refresh example' });
    return { title: stateCio && modernization ? 'State CIO modernization example' : 'Workstation refresh example', facts };
}

export function diffAmyEvaluationSample(previous: AmyWorkbenchModel | null, next: AmyWorkbenchModel): AmyWorkbenchFactChange[] {
    if (next.conversationKind !== 'evaluation') return [];
    const prior = new Map((previous?.evaluationSample?.facts ?? []).map(fact => [fact.label, fact.value]));
    const current = new Map((next.evaluationSample?.facts ?? []).map(fact => [fact.label, fact.value]));
    const changes: AmyWorkbenchFactChange[] = [];
    for (const [label, value] of current) {
        const previousValue = prior.get(label);
        if (previousValue === undefined) changes.push({ kind: 'added', section: label.includes('timeline') || label.includes('deadline') ? 'Timing' : 'Priorities', label, value });
        else if (previousValue !== value) changes.push({ kind: 'updated', section: 'Timing', label, value, previousValue });
    }
    for (const [label, value] of prior) if (!current.has(label)) changes.push({ kind: 'removed', section: 'Priorities', label, value });
    return changes;
}

export function amyEvaluationVisibleFacts(model: AmyWorkbenchModel): string[] {
    return model.evaluationSample?.facts.map(fact => `${fact.label}: ${fact.value}`) ?? [];
}

export function buildAmyEvaluationModel(turns: AmyWorkbenchTurn[]): AmyWorkbenchModel {
    const source = classifyAmyConversation(turns).evaluationTurns.map(turn => normalize(turn.content)).join(' ');
    // Labels represent questions asked, not claims that an answer or action succeeded.
    const topics = [
        { pattern: /what (?:you are|are you|you can do|can you do|we can do)|about yourself|check this out|capabilit|evaluat/i, label: 'Amy’s role and demo capabilities' },
        { pattern: /help (?:my|our|the) team|front end|specialists?|before they meet|handoff/i, label: 'Discovery support and specialist preparation' },
        { pattern: /briefs?|show me|example/i, label: 'What a working brief can look like' },
        { pattern: /can't|cannot|shouldn't|boundar|should not|pricing|compliance/i, label: 'Role limits and specialist validation' },
        { pattern: /CRM|Salesforce|integrat|API/i, label: 'Integration possibilities and current demo limits' },
    ].filter(topic => topic.pattern.test(source)).map(topic => topic.label);
    if (!topics.length) topics.push('Amy demonstration and evaluation');
    const objective = 'Evaluate Amy’s AI SDR demonstration and how it could support an Insight team—not qualify a customer project.';
    const nextStep = 'Review the demo with the person who shared it and choose a representative scenario for further evaluation. No meeting or specialist handoff has been booked.';
    const facts: AmyWorkbenchModel['facts'] = topics.map((value, index) => ({ section: 'Priorities', label: `Evaluation topic ${index + 1}`, value, status: 'mentioned' }));
    const evaluationSample = readAmyEvaluationSample(turns);
    const sampleFact = (label: string) => evaluationSample.facts.find(fact => fact.label === label)?.value;
    const sampleContext = sampleFact('Illustrative stakeholder') || sampleFact('Illustrative initiative')
        ? [sampleFact('Illustrative stakeholder'), sampleFact('Illustrative initiative')].filter(Boolean).join(' · ')
        : 'Illustrative organization · workstation refresh';
    const sampleTiming = sampleFact('Illustrative revised deadline') || sampleFact('Illustrative original timeline') || 'Timeline remains open in this example';
    return {
        conversationKind: 'evaluation', status: 'live', lane: 'Amy capability evaluation', signalCount: topics.length,
        evaluationSample,
        quality: { level: 'grounded', label: 'Evaluation topics · not customer facts', missing: [] },
        facts, corrections: [], uncertainItems: [],
        brief: { objective, environment: [], priorities: topics, discussionPoints: [AMY_EVALUATION_BOUNDARY], nextStep, openQuestions: [] },
        roadmap: { title: 'Evaluation path', outcome: objective, facts: [], phases: [
            { number: '01', title: 'Review capabilities', detail: 'Explore Amy’s role, working views, and boundaries.' },
            { number: '02', title: 'Try a representative scenario', detail: 'Use approved, non-sensitive example information; distinguish assumptions from facts.' },
            { number: '03', title: 'Validate adoption requirements', detail: 'Any real integration, security approval, or operating commitment requires separate review.' },
        ] },
        // Presentation-only sample. NEVER merge these fictional values into facts or recaps.
        visualBrief: { title: `Illustrative sample brief · ${evaluationSample.title}`, slides: [
            { id: 'sample-context', eyebrow: 'FICTIONAL EXAMPLE · 01 / 03', title: 'From a first conversation to a useful brief', summary: `Example scenario: ${evaluationSample.title}.`, bullets: [`Example context: ${sampleContext}.`, `Example timing: ${sampleTiming}.`, 'Example objective, environment, and constraints still require validation.'], boundary: AMY_SAMPLE_BOUNDARY },
            { id: 'sample-questions', eyebrow: 'FICTIONAL EXAMPLE · 02 / 03', title: 'Separate known context from open questions', summary: 'A useful handoff preserves uncertainty instead of inventing answers.', bullets: ['Open: budget, decision timing, and accountable owner.', 'Open: application compatibility and actual device requirements.', 'No selected product, quoted price, or approved deployment schedule.'], boundary: AMY_SAMPLE_BOUNDARY },
            { id: 'sample-handoff', eyebrow: 'FICTIONAL EXAMPLE · 03 / 03', title: 'Prepare the next human conversation', summary: 'This illustrates a proposed specialist-preparation brief, not a completed handoff.', bullets: ['Proposed objective: validate scope and decision criteria with the appropriate specialist.', 'Amy organizes the initial context; specialists validate technical and commercial details.', 'This demo sends configured recap emails—not an Insight CRM assignment.'], boundary: AMY_SAMPLE_BOUNDARY },
        ] },
        catalog: { title: 'Demo catalog boundary', summary: 'No live Insight product-data connection is available in this demo.', query: '', categories: [], boundary: AMY_EVALUATION_BOUNDARY },
    };
}
