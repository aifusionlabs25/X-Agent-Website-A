import type { AmyWorkbenchModel, AmyWorkbenchTurn } from './workbench-v2.ts';
import { hasAmyCapabilityOverviewIntent } from './amy-capability-intent.ts';

export const AMY_EVALUATION_BOUNDARY = 'Independent AI Fusion Labs demo. No customer opportunity, Insight CRM submission, or specialist assignment is established by this evaluation.';
export const AMY_SAMPLE_BOUNDARY = 'FICTIONAL EXAMPLE — not your organization, a real customer, a completed assessment, or an approved plan.';

const normalize = (value: string) => value.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const CUSTOMER_CONTEXT = /\b(?:we|our|my (?:company|organization|agency|team)|the client)\b.{0,55}\b(?:use|run|have|need|plan|migrat|upgrad|renew|audit|funded|deadline|workloads?|infrastructure|systems?|data center|compliance)\b/i;
const CUSTOMER_TRANSITION = /\b(?:real|actual|specific) (?:customer|client|opportunity|project|situation)\b|\b(?:role[- ]?play|pretend|imagine|switch to|let's discuss)\b.{0,55}\b(?:customer|client|county|agency|project|scenario)\b/i;
const EVALUATION_TRANSITION = /\b(?:evaluat\w*|interview\w*|review\w*|test\w*) (?:you|amy|this demo|an x agent)\b|\bback to (?:the demo|your capabilities)\b/i;

/** Visitor-only, session-local classification shared by the screen and finalized emails.
 * A capability question during established discovery does not erase the opportunity.
 * Titles, assistant prose and tool arguments never authenticate or establish facts.
 */
export function amyConversationMode(turns: AmyWorkbenchTurn[]): 'evaluation' | 'discovery' {
    let mode: 'evaluation' | 'discovery' = 'discovery';
    let customerEstablished = false;
    for (const turn of turns) {
        if (turn.role !== 'user') continue;
        const text = normalize(turn.content);
        if (CUSTOMER_TRANSITION.test(text) || CUSTOMER_CONTEXT.test(text)) {
            mode = 'discovery';
            customerEstablished = true;
        } else if (EVALUATION_TRANSITION.test(text) || (!customerEstablished && hasAmyCapabilityOverviewIntent(text))) {
            mode = 'evaluation';
        }
    }
    return mode;
}

export function buildAmyEvaluationModel(turns: AmyWorkbenchTurn[]): AmyWorkbenchModel {
    const source = turns.filter(turn => turn.role === 'user').map(turn => normalize(turn.content)).join(' ');
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
    return {
        conversationKind: 'evaluation', status: 'live', lane: 'Amy capability evaluation', signalCount: topics.length,
        quality: { level: 'grounded', label: 'Evaluation topics · not customer facts', missing: [] },
        facts, corrections: [], uncertainItems: [],
        brief: { objective, environment: [], priorities: topics, discussionPoints: [AMY_EVALUATION_BOUNDARY], nextStep, openQuestions: [] },
        roadmap: { title: 'Evaluation path', outcome: objective, facts: [], phases: [
            { number: '01', title: 'Review capabilities', detail: 'Explore Amy’s role, working views, and boundaries.' },
            { number: '02', title: 'Try a representative scenario', detail: 'Use approved, non-sensitive example information; distinguish assumptions from facts.' },
            { number: '03', title: 'Validate adoption requirements', detail: 'Any real integration, security approval, or operating commitment requires separate review.' },
        ] },
        // Presentation-only sample. NEVER merge these fictional values into facts or recaps.
        visualBrief: { title: 'Illustrative sample brief', slides: [
            { id: 'sample-context', eyebrow: 'FICTIONAL EXAMPLE · 01 / 03', title: 'From a first conversation to a useful brief', summary: 'Example scenario: an organization is exploring a workstation refresh.', bullets: ['Example outcome: reduce disruption from aging workstations.', 'Example context: 250 devices across two offices.', 'Example constraint: keep service-desk coverage available during any change.'], boundary: AMY_SAMPLE_BOUNDARY },
            { id: 'sample-questions', eyebrow: 'FICTIONAL EXAMPLE · 02 / 03', title: 'Separate known context from open questions', summary: 'A useful handoff preserves uncertainty instead of inventing answers.', bullets: ['Open: budget, decision timing, and accountable owner.', 'Open: application compatibility and actual device requirements.', 'No selected product, quoted price, or approved deployment schedule.'], boundary: AMY_SAMPLE_BOUNDARY },
            { id: 'sample-handoff', eyebrow: 'FICTIONAL EXAMPLE · 03 / 03', title: 'Prepare the next human conversation', summary: 'This illustrates a proposed specialist-preparation brief, not a completed handoff.', bullets: ['Proposed objective: validate scope and decision criteria with the appropriate specialist.', 'Amy organizes the initial context; specialists validate technical and commercial details.', 'This demo sends configured recap emails—not an Insight CRM assignment.'], boundary: AMY_SAMPLE_BOUNDARY },
        ] },
        catalog: { title: 'Demo catalog boundary', summary: 'No live Insight product-data connection is available in this demo.', query: '', categories: [], boundary: AMY_EVALUATION_BOUNDARY },
    };
}
