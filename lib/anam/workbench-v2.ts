export type AmyWorkbenchView = 'notes' | 'brief' | 'roadmap' | 'visual' | 'catalog';

export interface AmyWorkbenchTurn {
    role: 'user' | 'agent';
    content: string;
}

export interface AmyWorkbenchFact {
    section: 'Identity' | 'Organization' | 'Environment' | 'Scale' | 'Priorities' | 'Procurement' | 'Constraints' | 'Timing' | 'Decisions' | 'Requested outputs';
    label: string;
    value: string;
    status: 'mentioned' | 'confirmed';
}

export interface AmyWorkbenchFactChange {
    kind: 'added' | 'updated' | 'removed';
    section: AmyWorkbenchFact['section'];
    label: string;
    value: string;
    previousValue?: string;
}

interface WorkbenchPhase {
    number: string;
    title: string;
    detail: string;
}

interface VisualSlide {
    id: string;
    eyebrow: string;
    title: string;
    summary: string;
    bullets: string[];
    boundary: string;
}

interface CatalogCategory {
    title: string;
    description: string;
    examples: string[];
}

export interface AmyWorkbenchModel {
    status: 'listening' | 'live';
    lane: string;
    signalCount: number;
    quality: {
        level: 'grounded' | 'developing';
        label: string;
        missing: string[];
    };
    facts: AmyWorkbenchFact[];
    corrections: Array<{ from: string; to: string }>;
    uncertainItems: string[];
    brief: {
        objective: string;
        environment: string[];
        priorities: string[];
        discussionPoints: string[];
        nextStep: string;
        openQuestions: string[];
    };
    roadmap: {
        title: string;
        outcome: string;
        facts: Array<{ label: string; value: string }>;
        phases: WorkbenchPhase[];
    };
    visualBrief: {
        title: string;
        slides: VisualSlide[];
    };
    catalog: {
        title: string;
        summary: string;
        query: string;
        categories: CatalogCategory[];
        boundary: string;
    };
}

export function diffAmyWorkbenchFacts(previous: AmyWorkbenchModel | null, next: AmyWorkbenchModel): AmyWorkbenchFactChange[] {
    const keyFor = (fact: AmyWorkbenchFact) => `${fact.section}\u0000${fact.label}`;
    const previousByKey = new Map((previous?.facts ?? []).map((fact) => [keyFor(fact), fact]));
    const nextByKey = new Map(next.facts.map((fact) => [keyFor(fact), fact]));
    const changes: AmyWorkbenchFactChange[] = [];

    for (const fact of next.facts) {
        const prior = previousByKey.get(keyFor(fact));
        if (!prior) {
            changes.push({ kind: 'added', section: fact.section, label: fact.label, value: fact.value });
        } else if (prior.value !== fact.value) {
            changes.push({
                kind: 'updated',
                section: fact.section,
                label: fact.label,
                value: fact.value,
                previousValue: prior.value,
            });
        }
    }

    for (const fact of previous?.facts ?? []) {
        if (!nextByKey.has(keyFor(fact))) {
            changes.push({ kind: 'removed', section: fact.section, label: fact.label, value: fact.value });
        }
    }

    return changes;
}

export const AMY_WORKBENCH_BOUNDARY = 'Conversation working view only. Final scope, pricing, availability, timing, contract eligibility, and commitments require confirmation by the appropriate Insight specialists.';

const CONTACT_OMITTED = '[contact detail omitted]';

function clean(value: unknown): string {
    return String(value ?? '')
        .replace(/[\u2010-\u2015]/g, '-')
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, CONTACT_OMITTED)
        .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, CONTACT_OMITTED)
        .replace(/\s+/g, ' ')
        .trim();
}

function canonical(value: string): string {
    return clean(value)
        .replace(/\bcool recordings?\b/gi, 'call recordings')
        .replace(/\bE\s*[- ]\s*H\s*[- ]\s*R\b/gi, 'EHR')
        .replace(/\bE\s*[- ]\s*M\s*[- ]\s*R\b/gi, 'EMR')
        .replace(/\bS\s*[- ]\s*V\s*[- ]\s*A\s*[- ]\s*R\b/gi, 'SVAR')
        .replace(/\bArizona\s+SFAR\b/gi, 'Arizona SVAR')
        .replace(/\b(?:sccf|s c c m|system center configuration manager)\b/gi, 'SCCM')
        .replace(/\b(?:in tune|intune)\b/gi, 'Intune')
        .replace(/\b(?:m d m|mobile device management)\b/gi, 'MDM')
        .replace(/\b(?:w m s|warehouse management system)\b/gi, 'WMS')
        .replace(/\bmanhattan(?:\s+wms)?\b/gi, 'Manhattan WMS')
        .replace(/\bmicrosoft(?:\s+365)?\s+e5\b/gi, 'Microsoft 365 E5')
        .replace(/\bcrowd\s*strike\b/gi, 'CrowdStrike')
        .replace(/\bhoney\s*well\b/gi, 'Honeywell')
        .replace(/\bpink season\b/gi, 'peak season')
        .replace(/\bcopiloting\b/gi, 'Copilot readiness');
}

function compact(value: string, max = 210): string {
    const normalized = canonical(value).replace(/^[,.;:\s]+|[,.;:\s]+$/g, '');
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function unique(values: string[], limit = Infinity): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of values) {
        const value = compact(raw);
        const key = value.toLowerCase();
        if (!value || value === CONTACT_OMITTED || seen.has(key)) continue;
        seen.add(key);
        result.push(value);
        if (result.length >= limit) break;
    }
    return result;
}

function isUncertain(value: string): boolean {
    return /\b(?:not sure|don't(?: even)? know|do not(?: even)? know|might be|might not|could be|possibly|perhaps|unclear|not confirmed|need to (?:check|confirm)|I think|I may have|did you say|I heard)\b/i.test(value);
}

function statementsFrom(values: string[]): string[] {
    return values.flatMap((value) => value
        .split(/(?<=[.!?])\s+/)
        .map((statement) => compact(statement))
        .filter(Boolean));
}

function isWorkbenchRequest(value: string): boolean {
    return /\b(?:please\s+)?(?:show|open|display|leave|keep|pull up|build and show|capture)\b.*\b(?:notes?|brief|roadmap|visual|catalog|status)\b/i.test(value)
        || /\bdo you have a visual\b/i.test(value)
        || /\bvisuali[sz]e\b/i.test(value);
}

function isConversationControl(value: string): boolean {
    const normalized = value.trim();
    return /^(?:thanks?(?:,?\s+Amy)?|thank you|yes,? please|no|not right(?: now)?|maybe later|sure|partially|for now)\.?$/i.test(normalized)
        || /\b(?:this is exactly what I needed|I(?:'ve| have) got what I need|I(?:'ll| will) (?:run with|take it from here))\b/i.test(normalized);
}

function isWorkbenchEditInstruction(value: string): boolean {
    const normalized = value.trim();
    return /^(?:actually,?\s+)?(?:quick\s+)?(?:correction|cleanup|one\s+(?:fix|cleanup)|hold on|hang on|checking|one moment)\b/i.test(normalized)
        || /^(?:before you|next thing I tell Amy|then (?:show|open|refresh|rebuild)|please (?:show|open|refresh|rebuild|remove|delete)|make sure|let me)\b/i.test(normalized)
        || /\b(?:line|sentence|instruction|conversational (?:bit|instruction)|pasted into|section)\b.*\b(?:remove|delete|blank|not part of|shouldn't|should not|doesn't belong|does not belong)\b/i.test(normalized)
        || /\b(?:remove|delete)\b.*\b(?:line|sentence|instruction|conversational (?:bit|instruction)|section)\b/i.test(normalized)
        || /\b(?:live notes?|live brief|roadmap|visual|catalog)\b.*\b(?:open|show|refresh|rebuild|regenerate|update|stale|clean(?:er|up)?)\b/i.test(normalized)
        || /\b(?:open|show|refresh|rebuild|regenerate|update)\b.*\b(?:live notes?|live brief|roadmap|visual|catalog)\b/i.test(normalized);
}

function explicitTimingFrom(values: string[]): string {
    for (const value of [...values].reverse()) {
        const canonicalValue = canonical(value);
        const match = canonicalValue.match(/\bfor timing[,\s:]+(?:just\s+)?(?:say|note|use|set(?: it)? to|write)\s+["“]?(.+?)(?=["”]?(?:[.!?](?:\s|$)|\bfor stakeholder\b|\bthen\b|$))/i)
            ?? canonicalValue.match(/\btiming(?: entry)?\s+(?:is|reads?|should (?:be|say))\s+["“]?(.+?)(?=["”]?(?:[.!?](?:\s|$)|\bfor stakeholder\b|\bthen\b|$))/i);
        const candidate = compact(match?.[1] ?? '', 180);
        if (candidate && !/\b(?:remove|delete|instruction|line|sentence|section|show|refresh|rebuild)\b/i.test(candidate)) {
            return candidate;
        }
    }
    return '';
}

function stakeholderWasCleared(values: string[]): boolean {
    return [...values].reverse().some((value) => /\bstakeholder(?: context| section)?\b.*\b(?:leave (?:it )?blank|not confirmed|remove|delete|clear)\b/i.test(value));
}

function requestedOutputFrom(values: string[], trackCount: number, requestedView?: AmyWorkbenchView): string {
    if (requestedView) {
        return ({
            notes: 'Live notes',
            brief: 'Live brief',
            roadmap: trackCount === 2 ? 'Two-track roadmap' : trackCount > 2 ? `${trackCount}-track roadmap` : 'Roadmap',
            visual: 'Visual brief',
            catalog: 'Solution catalog',
        } satisfies Record<AmyWorkbenchView, string>)[requestedView];
    }
    for (const value of [...values].reverse()) {
        if (!isWorkbenchRequest(value) && !/\b(?:outline|sketch|picture|presentation|deck)\b/i.test(value) && !/\bshow me\b.*\bplan\b/i.test(value)) continue;
        if (/\b(?:visual(?:i[sz]e|i[sz]ation)?|diagram|workflow|presentation|executive visual|quick picture|picture|deck|slides?)\b/i.test(value)) return 'Visual brief';
        if (/\b(?:catalog|product categories|device categories|solution categories)\b/i.test(value)) return 'Solution catalog';
        if (/\b(?:roadmap|phased plan|implementation path|rollout sequence|plan would look like)\b/i.test(value)) {
            return trackCount === 2 ? 'Two-track roadmap' : trackCount > 2 ? `${trackCount}-track roadmap` : 'Roadmap';
        }
        if (/\b(?:live brief|brief)\b/i.test(value)) return 'Live brief';
        if (/\b(?:live notes?|notes?)\b/i.test(value)) return 'Live notes';
    }
    return '';
}

function isPrivateContactExchange(value: string): boolean {
    return /\b(?:email|e-mail)\b.{0,100}(?:@|\bat\b|\bdot\b|\baddress\b)|\b(?:gmail|outlook|hotmail|yahoo)\b/i.test(value);
}

function isArtifactRequestFragment(value: string): boolean {
    return /^(?:it|that|this)\s+so\s+I\s+can\s+share\s+it\s+with\s+leadership\b/i.test(value.trim());
}

function timingFrom(values: string[]): string {
    for (const value of [...values].reverse()) {
        if (isWorkbenchRequest(value) || isConversationControl(value) || isWorkbenchEditInstruction(value)) continue;
        if (/\bboard meeting\b/i.test(value) && /\bnext week\b/i.test(value)) return 'Board meeting next week';
        const deadline = value.match(/\b(?:by|before|within|in)\s+((?:next|this)\s+(?:week|month|quarter|year)|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[ -]?(?:business )?(?:days?|weeks?|months?))\b/i);
        if (deadline) return compact(`${deadline[0][0].toUpperCase()}${deadline[0].slice(1)}`, 100);
        const directionalPeriod = value.match(/\b(?:early|late)\s+(?:next|this)\s+(?:week|month|quarter|year)\b/i);
        if (directionalPeriod) return compact(`${directionalPeriod[0][0].toUpperCase()}${directionalPeriod[0].slice(1)}`, 100);
        const period = value.match(/\b(?:next|this)\s+(?:week|month|quarter|year)\b/i);
        if (period) return compact(`${period[0][0].toUpperCase()}${period[0].slice(1)}`, 100);
        const operatingWindow = value.match(/\b(?:tight )?(?:overnight|maintenance) (?:outage )?window\b|\bbefore peak season\b/i);
        if (operatingWindow) return compact(operatingWindow[0], 100);
    }
    return '';
}

function bestObjectiveFrom(values: string[]): string {
    const candidates = values
        .map((value, index) => {
            let score = 0;
            if (/\b(?:reduce|improve|increase|protect|moderni[sz]e|replace|migrate|support|prevent|stabili[sz]e|accelerate|cut(?:ting)?|boost(?:ing)?)\b/i.test(value)) score += 5;
            if (/\b(?:goal|objective|outcome|success|CEO|board|leadership)\b/i.test(value)) score += 3;
            if (/\b(?:need|want|trying|looking)\b/i.test(value)) score += 1;
            if (/\b(?:something tangible|do not know where to start|don't know where to start|what can you do|show me|open|outline|sketch)\b/i.test(value)) score -= 5;
            return { value, index, score };
        })
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || b.index - a.index);
    return compact(candidates[0]?.value ?? '');
}

function readCorrections(values: string[]): Array<{ from: string; to: string }> {
    const corrections: Array<{ from: string; to: string }> = [];
    const seen = new Set<string>();
    for (const value of values) {
        const directPattern = /\b(?:it(?:'s| is)|the correct (?:term|name|platform|vendor|system) is)\s+(.{2,60}?),?\s+not\s+(.{2,60}?)(?=(?:,\s*(?:and\s+)?(?:it(?:'s| is)|the correct (?:term|name|platform|vendor|system) is))|[.!?]|$)/gi;
        const reversePattern = /\bnot\s+(.{2,60}?),?\s+(?:it(?:'s| is)|I said)\s+(.{2,60}?)(?=(?:,\s*(?:and\s+)?(?:not\s+))|[.!?]|$)/gi;
        const matches = [
            ...Array.from(value.matchAll(directPattern), (match) => ({ from: match[2], to: match[1] })),
            ...Array.from(value.matchAll(reversePattern), (match) => ({ from: match[1], to: match[2] })),
        ];
        for (const match of matches) {
            const from = compact(match.from ?? '', 70);
            const to = compact(match.to ?? '', 70);
            const key = `${from.toLowerCase()}=>${to.toLowerCase()}`;
            if (!from || !to || from.toLowerCase() === to.toLowerCase() || seen.has(key)) continue;
            seen.add(key);
            corrections.push({ from, to });
        }
    }
    return corrections;
}

const TERM_RULES: Array<[RegExp, string]> = [
    [/\bEHR\b|electronic health records?/i, 'EHR'],
    [/\bEMR\b|electronic medical records?/i, 'EMR'],
    [/\bSIS\b|student information system/i, 'Student information system (SIS)'],
    [/\bMicrosoft 365 E5\b/i, 'Microsoft 365 E5'],
    [/\bWindows 11\b/i, 'Windows 11'],
    [/\bIntune\b/i, 'Intune'],
    [/\bSCCM\b/i, 'SCCM'],
    [/\bMDM\b/i, 'MDM'],
    [/\bAzure\b/i, 'Azure'],
    [/\bcloud migration\b|\bworkloads?\b.{0,35}\bcloud\b/i, 'Cloud migration'],
    [/\blegacy apps?\b|\blegacy applications?\b/i, 'Legacy applications'],
    [/\bAWS\b|Amazon Web Services/i, 'AWS'],
    [/\bVMware\b/i, 'VMware'],
    [/\bSAP\b/i, 'SAP'],
    [/\bERP\b|enterprise resource planning/i, 'ERP'],
    [/\bManhattan WMS\b/i, 'Manhattan WMS'],
    [/\bWMS\b/i, 'WMS'],
    [/\bCisco Wi-?Fi\b/i, 'Cisco Wi-Fi'],
    [/\bZebra\b/i, 'Zebra'],
    [/\bHoneywell\b/i, 'Honeywell'],
    [/\bCrowdStrike\b/i, 'CrowdStrike'],
    [/\bCopilot(?: readiness)?\b/i, 'Copilot readiness'],
    [/\bMFA\b|multi-factor authentication/i, 'MFA'],
];

function termsFrom(values: string[], rejected: Set<string>): string[] {
    const found: string[] = [];
    for (const value of values.filter((item) => !isUncertain(item))) {
        for (const [pattern, label] of TERM_RULES) {
            if (pattern.test(value) && ![...rejected].some((item) => item.includes(label.toLowerCase()) || label.toLowerCase().includes(item))) {
                found.push(label);
            }
        }
    }
    return unique(found, 10);
}

function lastSentence(values: string[], pattern: RegExp): string {
    for (const value of [...values].reverse()) {
        const sentence = value.split(/(?<=[.!?])\s+/).find((candidate) => pattern.test(candidate));
        if (sentence && !isUncertain(sentence)) return compact(sentence);
    }
    return '';
}

type LaneId = 'endpoint' | 'cloud' | 'security' | 'mobility' | 'education' | 'healthcare-operations' | 'customer-experience' | 'public-sector' | 'general';

const LANE_LABELS: Record<LaneId, string> = {
    endpoint: 'Endpoint modernization',
    cloud: 'Hybrid infrastructure modernization',
    security: 'Security readiness',
    mobility: 'Warehouse mobility modernization',
    education: 'Education AI discovery',
    'healthcare-operations': 'Healthcare operations discovery',
    'customer-experience': 'AI-enabled customer experience',
    'public-sector': 'Public-sector modernization',
    general: 'Enterprise discovery',
};

function detectLane(text: string): LaneId {
    if (/patient intake|patient flow|clinical workflow|pre[- ]screening|\bEHR\b|\bEMR\b|electronic (?:health|medical) record/i.test(text)) {
        return 'healthcare-operations';
    }
    const scores: Array<[LaneId, RegExp[]]> = [
        ['customer-experience', [/customer experience|contact cent(?:er|re)|call cent(?:er|re)|call wait|wait times?|customer satisfaction|\bCSAT\b/i, /call recordings?|ticket logs?|speech[- ]to[- ]text|sentiment|predictive routing|service interactions?/i]],
        ['education', [/student|university|college|school district|higher education|K-?12/i, /\bSIS\b|student information system|student retention|attendance|grades?|drop(?:ping)? out/i]],
        ['public-sector', [/county|municipal|city government|state agency|federal agency|public sector|higher education|K-?12|state funding|federal funding/i, /procurement|competitive bidding|contract vehicle|state contract|CJIS|FedRAMP|StateRAMP/i]],
        ['mobility', [/warehouse|distribution center|picking|outbound shipping/i, /WMS|rugged|scanner|forklift|Zebra|Honeywell|MDM/i]],
        ['endpoint', [/endpoint|Windows 11|Intune|SCCM|Copilot|device refresh|laptops?/i, /branch|workplace/i]],
        ['security', [/security|cyber|ransomware|MFA|zero trust|CrowdStrike|privileged access/i, /recovery|backup|audit|insurance/i]],
        ['cloud', [/Azure|AWS|VMware|hybrid[ -]cloud|data cent(?:er|re)|ERP|SAP|cloud migration/i, /customer portal|maintenance window|on-prem/i]],
    ];
    return scores
        .map(([lane, patterns]) => ({ lane, score: patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0) }))
        .sort((a, b) => b.score - a.score)
        .find((item) => item.score > 0)?.lane ?? 'general';
}

function extractScale(text: string): string {
    return compact(text.match(/\b((?:\d+(?:,\d{3})*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:(?:Windows\s+11|rugged|managed|mobile)\s+)?(?:manufacturing\s+)?(?:plants?|endpoints?|devices?|users?|sites?|locations?|warehouses?|distribution centers?|scanners?|tablets?|clinics?))\b/i)?.[1] ?? '');
}

function buildPhases(lane: LaneId, context: { scale: string; terms: string[]; constraint: string; timing: string; workloads: string[]; dataSources: string[]; dualTrack: boolean; activeIncident: boolean }): WorkbenchPhase[] {
    const scope = context.scale || 'the environment in scope';
    const stack = context.terms.slice(0, 5).join(', ') || 'the current technology environment';
    const guardrail = context.constraint || 'the stated operating constraints';
    const timing = context.timing ? ` within ${context.timing}` : '';
    const workloads = context.workloads.join(', ') || 'the priority workloads';

    if (context.dualTrack) return [
        { number: '01', title: 'Shared facts and dependencies', detail: 'Confirm the Azure and ERP estate, decision owners, cutover dependencies, and the prime-contractor flow-down status without assuming a compliance framework.' },
        { number: '02', title: 'ERP cutover workstream', detail: 'Map ERP dependencies, rehearse recovery and rollback, and validate that the cutover can fit the tight overnight outage window.' },
        { number: '03', title: 'Municipal compliance pre-scoping', detail: 'Document the subcontract context, data and workload boundaries, open compliance questions, and evidence needed once the prime provides flow-down requirements.' },
        { number: '04', title: 'Separate decision gates', detail: 'Gate ERP cutover readiness independently from municipal compliance scope, then confirm owners, timing, and specialist review for each stream.' },
    ];

    if (lane === 'mobility') return [
        { number: '01', title: 'Survey and baseline', detail: `Validate wireless coverage, ${stack}, device condition, WMS dependencies, and picking risks across ${scope}.` },
        { number: '02', title: 'Pilot and prove', detail: 'Run a representative workflow pilot with device enrollment, WMS testing, training, rollback, and spare-device procedures.' },
        { number: '03', title: 'First controlled wave', detail: `Deploy one bounded location${timing}, measure picking and outbound-shipping continuity, and correct issues before expansion.` },
        { number: '04', title: 'Plan later waves', detail: `Sequence remaining sites around ${guardrail}, support ownership, device lifecycle, and peak operations.` },
    ];
    if (lane === 'security') return [
        { number: '01', title: 'Validate gaps', detail: `Confirm findings across ${scope}, map evidence and owners, and account for the existing ${stack} investments.` },
        { number: '02', title: 'Prioritize controls', detail: `Separate immediate exposure reduction from foundational work while respecting ${guardrail}.` },
        { number: '03', title: 'Plan remediation', detail: `Define owners, dependencies, pilot steps, rollback, and evidence${timing}.` },
        { number: '04', title: 'Review progress', detail: 'Track completed controls, remaining risk, decisions, and next review points without promising compliance or insurer approval.' },
    ];
    if (lane === 'public-sector') return [
        { number: '01', title: 'Mission and scope', detail: `Frame the public-service outcome for ${scope} and the people affected.` },
        { number: '02', title: 'Current state', detail: `Map ${stack}, governance drivers, incumbent relationships, and ${guardrail}.` },
        { number: '03', title: 'Technical path', detail: `Shape phased options and identify the evidence required for review${timing}.` },
        { number: '04', title: 'Decision path', detail: 'Clarify owners, approvals, purchasing route, specialist support, and the next bounded decision.' },
    ];
    if (lane === 'education') return [
        { number: '01', title: 'Board outcome and boundary', detail: 'Clarify the board decision, success measure, three-day deliverable, and the difference between a feasibility demonstration and a validated student-risk model.' },
        { number: '02', title: 'Authorized data and governance', detail: 'Confirm the data owner, permitted SIS fields, privacy and institutional policy, de-identification or synthetic-data approach, fairness, explainability, and required human review.' },
        { number: '03', title: 'Bounded human-reviewed demonstration', detail: 'Use the smallest approved dataset and keep every student-level interpretation with authorized humans; do not treat a demonstration as production validation.' },
        { number: '04', title: 'Validation decision gate', detail: 'Have the appropriate education, data, privacy, AI, and Insight specialists validate feasibility, safeguards, scope, and any later pilot path.' },
    ];
    if (lane === 'healthcare-operations') return [
        { number: '01', title: 'Frame the leadership question', detail: 'Confirm the operational outcome, executive audience, affected locations, and the decision the working brief needs to support.' },
        { number: '02', title: 'Separate facts from hypotheses', detail: 'Keep the reported intake delays and workflow change distinct from any unverified explanation; do not treat correlation as root cause.' },
        { number: '03', title: 'Validate permissible evidence', detail: 'Have the authorized data owner and appropriate Insight specialists confirm which aggregated or de-identified operational data is available and appropriate to use.' },
        { number: '04', title: 'Set the next decision gate', detail: 'After evidence and privacy boundaries are validated, decide whether a comparison, deeper analysis, or dashboard should be scoped.' },
    ];
    if (lane === 'customer-experience') return [
        {
            number: '01',
            title: context.activeIncident ? 'Stabilize and separate' : 'Frame the leadership decision',
            detail: context.activeIncident
                ? 'Keep active incident response separate from the executive AI deliverable; do not introduce a new live production dependency while service stability is unresolved.'
                : 'Confirm the leadership decision, the customer outcome, the current baseline, and what evidence would justify a later pilot.',
        },
        {
            number: '02',
            title: 'Authorize the evidence',
            detail: `Confirm ownership, permitted use, privacy, PII or payment-data handling, retention, and on-premises boundaries for ${context.dataSources.join(' and ') || 'the historical interaction data'}.`,
        },
        {
            number: '03',
            title: 'Build a bounded offline concept',
            detail: 'Use approved, de-identified historical data or synthetic examples to illustrate call drivers, service themes, and a future workflow without claiming a live deployment or validated predictive-routing result.',
        },
        {
            number: '04',
            title: 'Set the validation gate',
            detail: 'Have customer-experience, data, security, infrastructure, AI, and Insight specialists validate feasibility, measures, integrations, safeguards, and ownership before any production pilot.',
        },
    ];
    if (lane === 'cloud') return [
        { number: '01', title: 'Discover and baseline', detail: `Inventory ${workloads}, dependencies, owners, recovery needs, and performance across ${stack}.` },
        { number: '02', title: 'Design the landing path', detail: `Group workloads by risk and define identity, network, data-protection, governance, and rollback requirements around ${guardrail}.` },
        { number: '03', title: 'Pilot a controlled wave', detail: `Validate one representative workload${timing}, measure downtime and recovery behavior, and resolve gaps before expansion.` },
        { number: '04', title: 'Sequence and operate', detail: 'Set later waves, monitoring, cost controls, ownership, support, and decision gates without implying the full program is complete.' },
    ];
    if (lane === 'endpoint') return [
        { number: '01', title: 'Baseline', detail: `Assess ${scope} for readiness, application dependencies, ${stack}, security standards, and exceptions.` },
        { number: '02', title: 'Pilot design', detail: `Select representative users, validate critical applications, and account for ${guardrail}.` },
        { number: '03', title: 'First wave', detail: `Run an initial controlled migration wave${timing}, then use measured results to shape later deployment.` },
        { number: '04', title: 'Plan forward', detail: 'Document later waves, support ownership, asset lifecycle, adoption measures, and Copilot readiness and governance.' },
    ];
    return [
        { number: '01', title: 'Clarify', detail: `Confirm the desired outcome, ${scope}, current state, impact, and owners.` },
        { number: '02', title: 'Frame', detail: `Map ${stack}, dependencies, risks, and ${guardrail}.` },
        { number: '03', title: 'Validate', detail: `Use a bounded review or pilot${timing} to test the preferred direction.` },
        { number: '04', title: 'Decide', detail: 'Confirm ownership, evidence, timing, next actions, and specialist involvement.' },
    ];
}


function buildCurrentTracks(input: {
    hasErpCutover: boolean;
    hasMunicipalPrescoping: boolean;
    hasArizonaSvar: boolean;
    hasAiDiscovery: boolean;
    hasPlannedCloudMigration?: boolean;
}): string[] {
    return [
        input.hasErpCutover ? 'ERP cutover' : '',
        input.hasPlannedCloudMigration && !input.hasErpCutover ? 'Cloud migration' : '',
        input.hasArizonaSvar
            ? 'Arizona SVAR procurement pre-scoping'
            : input.hasMunicipalPrescoping ? 'Municipal compliance pre-scoping' : '',
        input.hasAiDiscovery ? 'AI discovery' : '',
    ].filter(Boolean);
}

function buildMultiTrackPhases(tracks: string[], aiDiscovery: string): WorkbenchPhase[] {
    const phases: WorkbenchPhase[] = [{
        number: '01',
        title: 'Shared facts and boundaries',
        detail: 'Confirm owners, data and workload boundaries, dependencies, timing, and open decisions without turning procurement into compliance or assuming unconfirmed requirements.',
    }];
    if (tracks.includes('ERP cutover')) phases.push({
        number: String(phases.length + 1).padStart(2, '0'),
        title: 'ERP cutover workstream',
        detail: 'Map ERP dependencies, rehearse recovery and rollback, and validate that the cutover can fit the tight overnight outage window.',
    });
    if (tracks.includes('Arizona SVAR procurement pre-scoping')) phases.push({
        number: String(phases.length + 1).padStart(2, '0'),
        title: 'Arizona SVAR purchasing path',
        detail: 'Confirm the software category, purchaser, agency or prime ordering path, and specialist contract review. SVAR is a Software Value-Added Reseller contract vehicle, not a compliance certification.',
    });
    if (tracks.includes('Municipal compliance pre-scoping')) phases.push({
        number: String(phases.length + 1).padStart(2, '0'),
        title: 'Municipal compliance pre-scoping',
        detail: 'Document the subcontract context, data boundaries, and evidence needed once the prime provides flow-down requirements.',
    });
    if (tracks.includes('AI discovery')) phases.push({
        number: String(phases.length + 1).padStart(2, '0'),
        title: 'AI discovery workstream',
        detail: `Scope ${aiDiscovery || 'the confirmed AI use case'}; validate data access, applicable AI policy, identity controls, human review, hosting, and measurable outcomes.`,
    });
    phases.push({
        number: String(phases.length + 1).padStart(2, '0'),
        title: 'Independent decision gates',
        detail: 'Confirm separate owners, evidence, specialist review, and next decisions for each track without implying approval, eligibility, or a completed design.',
    });
    return phases;
}

const CATALOG: Record<LaneId, CatalogCategory[]> = {
    endpoint: [
        { title: 'Endpoint lifecycle', description: 'Device strategy, refresh, deployment, asset management, and support.', examples: ['Windows 11 readiness', 'Device lifecycle', 'Deployment services'] },
        { title: 'Unified endpoint management', description: 'Provisioning, policy, application delivery, and operating consistency.', examples: ['Intune', 'Configuration management', 'Autopilot readiness'] },
        { title: 'Endpoint security', description: 'Identity, device posture, protection, recovery, and compliance evidence.', examples: ['Zero Trust alignment', 'Endpoint protection', 'Security baselines'] },
        { title: 'Collaboration and AI readiness', description: 'Governance and adoption planning before broad enablement.', examples: ['Microsoft 365', 'Copilot readiness', 'Adoption services'] },
    ],
    cloud: [
        { title: 'Hybrid cloud', description: 'Landing zones, workload placement, connectivity, and governance.', examples: ['Azure', 'AWS', 'Hybrid architecture'] },
        { title: 'Migration and modernization', description: 'Discovery, dependency mapping, pilots, and controlled migration waves.', examples: ['Application migration', 'VMware modernization', 'Data-platform modernization'] },
        { title: 'Resilience and continuity', description: 'Backup, recovery, uptime objectives, testing, and operating ownership.', examples: ['Disaster recovery', 'Backup modernization', 'Recovery validation'] },
        { title: 'Managed operations', description: 'Monitoring, optimization, lifecycle support, and cost governance.', examples: ['Cloud operations', 'FinOps', 'Managed infrastructure'] },
    ],
    security: [
        { title: 'Identity and Zero Trust', description: 'Identity posture, MFA, privileged access, segmentation, and governance.', examples: ['MFA', 'PAM', 'Identity modernization'] },
        { title: 'Endpoint and workload security', description: 'Protection, visibility, hardening, and response across the estate.', examples: ['Endpoint protection', 'Cloud workload security', 'Vulnerability management'] },
        { title: 'Recovery readiness', description: 'Resilient backup, recovery validation, and ransomware response planning.', examples: ['Immutable backup', 'Recovery exercises', 'Incident readiness'] },
        { title: 'Security operations', description: 'Detection, response, evidence, and operating-model improvement.', examples: ['SOC services', 'SIEM modernization', 'Security assessments'] },
    ],
    mobility: [
        { title: 'Rugged mobility', description: 'Purpose-fit handhelds, scanners, tablets, accessories, and lifecycle services.', examples: ['Zebra', 'Honeywell', 'Rugged tablets'] },
        { title: 'Warehouse connectivity', description: 'Coverage, roaming, capacity, segmentation, and operational resilience.', examples: ['Cisco Wi-Fi', 'Wireless surveys', 'Network modernization'] },
        { title: 'Device management', description: 'Enrollment, policy, application delivery, security, and support.', examples: ['MDM', 'Kiosk management', 'Application distribution'] },
        { title: 'Workflow assurance', description: 'Pilot validation across WMS workflows, training, spares, and rollback.', examples: ['Manhattan WMS testing', 'Picking pilots', 'Support design'] },
    ],
    education: [
        { title: 'Student-success discovery', description: 'Outcome framing, stakeholder alignment, and responsible use-case qualification.', examples: ['Retention discovery', 'Student-service workflows', 'Success measures'] },
        { title: 'Data readiness and governance', description: 'Authorized data access, quality, minimization, privacy, fairness, explainability, and human review.', examples: ['SIS data readiness', 'De-identification', 'Governance review'] },
        { title: 'Bounded demonstrations', description: 'Synthetic or de-identified demonstrations that test an idea without making consequential student decisions.', examples: ['Board mockup', 'Feasibility demonstration', 'Human-reviewed workflow'] },
        { title: 'Specialist validation', description: 'Education, data, privacy, AI, and technical review before a real-data pilot or production decision.', examples: ['Risk review', 'Technical validation', 'Pilot scoping'] },
    ],
    'healthcare-operations': [
        { title: 'Healthcare operations discovery', description: 'Executive outcome framing, workflow context, affected locations, and decision support without diagnosing a root cause.', examples: ['Patient-intake discovery', 'Workflow comparison', 'Leadership brief'] },
        { title: 'Operational data readiness', description: 'Authorized access, aggregation, de-identification, quality, lineage, and data-owner validation.', examples: ['EHR data readiness', 'Operational metric definitions', 'Data-governance review'] },
        { title: 'Bounded analysis', description: 'A specialist-defined comparison using only validated operational evidence and explicit hypotheses.', examples: ['Clinic comparison', 'Process-variance review', 'Working executive view'] },
        { title: 'Specialist validation', description: 'Healthcare, data, privacy, security, and analytics review before analysis or dashboard scope is approved.', examples: ['Data-owner review', 'Privacy validation', 'Analytics scoping'] },
    ],
    'customer-experience': [
        { title: 'Customer-experience discovery', description: 'Outcome framing, baseline measures, service journeys, and leadership decision support.', examples: ['Wait-time drivers', 'Customer satisfaction', 'Contact-center workflow'] },
        { title: 'Interaction-data readiness', description: 'Authorized use, minimization, privacy, quality, retention, and on-premises handling for recordings and service records.', examples: ['Call-recording readiness', 'Ticket-log quality', 'De-identification'] },
        { title: 'Bounded AI demonstrations', description: 'Offline concepts that test a narrow question without changing live routing or customer treatment.', examples: ['Conversation themes', 'Service-driver analysis', 'Workflow mockup'] },
        { title: 'Production validation', description: 'Architecture, integration, human review, security, operations, and measurable-outcome review before a pilot.', examples: ['Contact-center integration', 'AI governance', 'Pilot measures'] },
    ],
    'public-sector': [
        { title: 'Mission modernization', description: 'Technology planning around citizen, student, workforce, and agency outcomes.', examples: ['Digital services', 'Modern workplace', 'Infrastructure modernization'] },
        { title: 'Security and governance', description: 'Risk reduction, evidence, resilience, and alignment to applicable requirements.', examples: ['NIST alignment', 'CJIS considerations', 'StateRAMP readiness'] },
        { title: 'Cloud and data', description: 'Governed cloud foundations, data modernization, and responsible AI readiness.', examples: ['Cloud migration', 'Data platforms', 'AI readiness'] },
        { title: 'Purchasing-path alignment', description: 'Specialist review of available contract vehicles and procurement requirements.', examples: ['Contract research', 'Procurement planning', 'Public-sector specialists'] },
    ],
    general: [
        { title: 'Cloud and infrastructure', description: 'Modern platforms, migration, resilience, and managed operations.', examples: ['Hybrid cloud', 'Data center', 'Managed services'] },
        { title: 'Cybersecurity', description: 'Identity, endpoint, network, recovery, and security operations.', examples: ['Zero Trust', 'Security assessments', 'Recovery readiness'] },
        { title: 'Modern workplace', description: 'Devices, collaboration, management, adoption, and support.', examples: ['Endpoint lifecycle', 'Microsoft 365', 'Collaboration'] },
        { title: 'Data and AI', description: 'Data foundations, governance, analytics, and responsible AI adoption.', examples: ['Data platforms', 'Analytics', 'AI readiness'] },
    ],
};

function makeFact(section: AmyWorkbenchFact['section'], label: string, value: string): AmyWorkbenchFact | null {
    return value ? { section, label, value, status: 'mentioned' } : null;
}

export function buildAmyWorkbenchModel(turns: AmyWorkbenchTurn[], roadmapTopic = '', catalogQuery = '', requestedView?: AmyWorkbenchView): AmyWorkbenchModel {
    const userTurns = turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => canonical(turn.content))
        .filter((value) => value && value !== CONTACT_OMITTED);
    const statements = statementsFrom(userTurns);
    const corrections = readCorrections(userTurns);
    const rejected = new Set(corrections.map((item) => canonical(item.from).toLowerCase()));
    const certainStatements = statements.filter((value) => !isUncertain(value));
    const substantiveStatements = certainStatements.filter((value) => !isWorkbenchRequest(value)
        && !isConversationControl(value)
        && !isWorkbenchEditInstruction(value)
        && !isPrivateContactExchange(value)
        && !isArtifactRequestFragment(value));
    const sourceText = canonical(`${substantiveStatements.join(' ')} ${roadmapTopic}`);
    const sessionText = canonical(userTurns.join(' '));
    const hasHealthcareOperations = /patient intake|patient flow|clinical workflow|pre[- ]screening|\bEHR\b|\bEMR\b|electronic (?:health|medical) record/i.test(sessionText)
        && /clinics?|hospital|health system|patient|intake/i.test(sessionText);
    const hasRisingPatientIntake = /patient intake times?.{0,55}(?:through the roof|ris(?:e|ing)|increas|longer|delay)|intake delays?/i.test(sessionText);
    const hasEhr = /\bEHR\b|electronic health record/i.test(sessionText);
    const hasPublicSectorAuditPriorities = /\bstate agency\b/i.test(sessionText)
        && /\bcompliance audit\b/i.test(sessionText)
        && /\blegacy system\b/i.test(sessionText)
        && /\bAI\b/i.test(sessionText);
    const hasAccessControlEvidence = /\b(?:addressed|remediat(?:ed|ion)|closed)\b.{0,40}\baccess[ -]control gaps?\b|\bproof\b.{0,45}\baccess[ -]control gaps?\b/i.test(sessionText);
    const hasAzureAd = /\bAzure\s+(?:AD|Active Directory)\b/i.test(sessionText);
    const hasNorthside = /\bNorthside\b/i.test(sessionText);
    const hasPreScreening = /pre[- ]screening/i.test(sessionText);
    const hasWorkflowChange = /(?:switched|changed?) (?:its |the )?workflows?|workflow change|added a new pre[- ]screening step/i.test(sessionText);
    const needsItValidation = /(?:check|confirm) with IT.{0,55}(?:EHR )?export|IT.{0,55}(?:check|confirm).{0,55}(?:EHR )?export/i.test(sessionText);
    const hasAuthorizedHealthcareEvidence = /(?:authorized|approved|permitted).{0,60}(?:aggregated|de-identified|operational (?:data|metrics)|EHR export)/i.test(sessionText);
    const hasExcludedCjisData = /\b(?:exclude|excluding|excluded|leave|leaving|keep|keeping)\b.{0,35}\bCJIS\b|\bCJIS\b.{0,35}\b(?:exclude|excluding|excluded|out of scope)\b/i.test(sessionText);
    const hasConfirmedPublicSafetyContext = /\b(?:police|sheriff|law enforcement|public safety|corrections|emergency dispatch|911)\b/i.test(sessionText)
        || /\bCJIS\b.{0,80}\b(?:applies|applicable|required|covered|in scope)\b/i.test(sessionText);
    const hasPublicSafetyAi = hasConfirmedPublicSafetyContext
        && /\bCJIS\b/i.test(sessionText)
        && /\bAI\b|artificial intelligence/i.test(sessionText);
    const hasDeviceRefresh = /\bdevice refresh\b|\bnew devices\b/i.test(sessionText);
    const hasFundedDeviceRefresh = hasDeviceRefresh && /\bdevice refresh\b.{0,35}\bfunded\b|\bfunded\b.{0,35}\bdevice refresh\b/i.test(sessionText);
    const hasAiInterestOnly = hasPublicSafetyAi && /\b(?:no|don't have|do not have)\b.{0,35}\bAI pilot\b.{0,35}\b(?:scheduled|approved|funded)\b|\bjust interest\b/i.test(sessionText);
    const hasPublicSafetyAdminUseCases = hasPublicSafetyAi && /administrative paperwork|shift scheduling|staffing reports?/i.test(sessionText);
    const hasVisitorReportedNonSensitiveData = hasPublicSafetyAi && /\bnon[- ]sensitive\b|\bnothing like case files\b/i.test(sessionText);
    const hasValidatedPublicSafetyDataBoundary = hasPublicSafetyAi && /(?:security owner|agency security|CISO|data owner).{0,80}(?:confirmed|validated|approved).{0,80}(?:outside|not subject to|not within).{0,20}\bCJIS\b/i.test(sessionText);
    const hasInfrastructureRefreshDecision = /\binfrastructure refresh\b/i.test(sessionText)
        && /\bservers?\b/i.test(sessionText)
        && /\bnetwork equipment\b/i.test(sessionText);
    const hasOutdatedFirmwareAudit = /\baudit\b.{0,80}\boutdated firmware\b|\boutdated firmware\b.{0,80}\baudit\b/i.test(sessionText);
    const hasSixMonthAuditTiming = /\baudit\b.{0,80}\bsix months? ago\b|\bsix months? ago\b.{0,80}\baudit\b/i.test(sessionText);
    const hasNoMajorBreach = /\bno major breaches?\b/i.test(sessionText);
    const hasBudgetReviewNextQuarter = /\bbudget review\b.{0,35}\bnext quarter\b|\bnext quarter\b.{0,35}\bbudget review\b/i.test(sessionText);
    const prefersDeferralToNextYear = /\b(?:push|defer|delay)\b.{0,45}\bnext year\b|\bprefer\b.{0,45}\bnext year\b/i.test(sessionText);
    const smallerOfficeMergerIndex = userTurns.findIndex((value) => /\bmerg(?:e|er|ing)\b.{0,45}\bsmaller office\b|\bsmaller office\b.{0,45}\bmerg(?:e|er|ing)\b/i.test(value));
    const hasAssumedSmallerOfficeMerger = smallerOfficeMergerIndex >= 0
        && userTurns.slice(smallerOfficeMergerIndex).some((value) => /\b(?:let(?:'s| us)|we(?:'ll| will)) assume\b.{0,40}\b(?:happening|happen|merg(?:e|er|ing))\b|\bassume\b.{0,35}\b(?:office )?merg(?:e|er|ing)\b/i.test(value));
    const includesSmallerOfficeSystems = hasAssumedSmallerOfficeMerger
        && userTurns.slice(smallerOfficeMergerIndex).some((value) => /\binclude\b.{0,35}\b(?:their|the smaller office(?:'s)?) systems\b/i.test(value));
    const expandsScopeAndBudget = hasAssumedSmallerOfficeMerger
        && userTurns.slice(smallerOfficeMergerIndex).some((value) => /\bscope\b.{0,35}\bbudget\b|\bbudget\b.{0,35}\bscope\b/i.test(value));
    const mergerPlanningNextQuarter = hasAssumedSmallerOfficeMerger
        && userTurns.slice(smallerOfficeMergerIndex).some((value) => /\bnext quarter\b/i.test(value));
    const hasSpecificInfrastructureScope = hasInfrastructureRefreshDecision
        && !/\bnot sure which parts\b/i.test(sessionText)
        && /\b(?:inventory|asset list|model numbers?|specific (?:servers?|network (?:devices?|equipment))|\d+\s+(?:servers?|switches?|routers?|firewalls?))\b/i.test(sessionText);
    const hasValidatedSecuritySeverity = hasInfrastructureRefreshDecision
        && /\b(?:critical|high|medium|low)[ -](?:risk|severity)\b|\bCVSS\b|\bactive exploit\b|\bend[- ]of[- ]support\b|\bunsupported\b/i.test(sessionText);
    const hasCostBreakdown = hasInfrastructureRefreshDecision
        && /\b(?:cost breakdown|line[- ]item (?:cost|estimate)|vendor quote|budget estimate|capital estimate|\$\s*\d)\b/i.test(sessionText);
    const hasInfrastructureCostConcern = hasInfrastructureRefreshDecision
        && /\b(?:expensive|costs?|budget|pricing|price)\b/i.test(sessionText);
    const hasInfrastructureSecurityConcern = hasInfrastructureRefreshDecision
        && /\b(?:cyber(?:security)?|security|audit|firmware|vulnerabilit|risk|breach)\b/i.test(sessionText);
    const hasAgingInfrastructureClaim = hasInfrastructureRefreshDecision && /\baging infrastructure\b/i.test(sessionText);
    const hasBoardAudience = hasInfrastructureRefreshDecision && /\bboard\b/i.test(sessionText);
    const infrastructureDecisionAudience = hasBoardAudience ? 'the board' : 'leadership';
    const infrastructureDecisionGate = hasBudgetReviewNextQuarter ? 'the next-quarter budget review' : 'the next decision gate';
    const infrastructureTimingFrame = prefersDeferralToNextYear
        ? 'including whether validated security and lifecycle evidence support deferring implementation to next year'
        : 'with action timing based on validated security and lifecycle evidence';
    const infrastructureCostFrame = hasInfrastructureCostConcern ? ' and what drives the cost' : '';
    const infrastructureEvidenceBasis = hasAgingInfrastructureClaim ? '"aging infrastructure"' : 'the refresh request';
    const infrastructureExposureLabel = hasInfrastructureSecurityConcern ? 'security severity' : 'risk and lifecycle exposure';
    const hasErpCutover = /\bERP\b/i.test(sourceText) && /cutover|overnight outage|maintenance window/i.test(sourceText);
    const hasMunicipalPrescoping = /municipal|government subcontract|prime(?:-contractor)? flow-down|pre-?scoping/i.test(sourceText);
    const hasArizonaSvar = /\bSVAR\b/i.test(sourceText) && /Arizona|state agency|state of Arizona/i.test(sourceText);
    const hasAiDiscovery = /\bAI\b|artificial intelligence|runbook automation|migration runbooks?|technical document(?:ation)? search|analy[sz](?:e|ing) telemetry|internal (?:IT )?assistant|student retention|at[- ]risk students?|students? at risk|drop(?:ping)? out/i.test(sourceText);
    const hasPlannedCloudMigration = /\b(?:planned|planning|prepare|preparing)\b.{0,45}\bcloud migration\b|\bcloud migration\b.{0,45}\b(?:planned|planning|prepare|preparing)\b/i.test(sessionText);
    const hasCommittedCloudMigration = /\b(?:pushing for|moving|migrate|migration|core workloads?)\b.{0,60}\bcloud\b|\bcloud migration\b/i.test(sessionText);
    const hasYearEndCloudDeadline = /\b(?:core )?workloads?\b.{0,45}\bcloud\b.{0,35}\bby year[ -]?end\b|\bby year[ -]?end\b.{0,50}\b(?:cloud|workloads?)\b/i.test(sessionText);
    const hasInternalPrivacyBoundaries = /\binternal privacy boundaries\b|\bprivacy boundaries\b/i.test(sessionText);
    const hasStateRampRequirement = /\b(?:under|requires?|required|must meet)\s+StateRAMP\b|\bStateRAMP\b.{0,35}\b(?:state[- ]level data|required|requirement)\b/i.test(sessionText);
    const hasStaffingOptimization = /\bAI\b.{0,90}\boptimi[sz](?:e|ing|ation)\b.{0,35}\bstaff(?:ing)?(?: schedules?)?\b|\boptimi[sz](?:e|ing|ation)\b.{0,35}\bstaff(?:ing)?(?: schedules?)?\b.{0,90}\bAI\b/i.test(sessionText);
    const hasShiftCalendarData = /\bshift calendars?\b/i.test(sessionText);
    const hasPayrollLogData = /\bpayroll logs?\b/i.test(sessionText);
    const hasNoApprovedAiPilot = /\bno\b.{0,25}\bAI pilot\b.{0,35}\bapproved\b|\bAI pilot\b.{0,35}\bnot approved\b|\bjust (?:an )?explor(?:ation|atory)\b/i.test(sessionText);
    const hasCloudAndStaffingAi = hasPlannedCloudMigration && hasStaffingOptimization;
    const hasRuggedDeviceWorkstream = /\brugged (?:laptops?|devices?|hardware)\b/i.test(sessionText);
    const hasAiInspectionWorkstream = /\bAI[- ]?(?:driven )?inspections?\b/i.test(sessionText);
    const hasRemoteConnectivityWorkstream = /\b(?:remote[- ]site connectivity|connectivity at remote sites?)\b/i.test(sessionText);
    const hasRuggedProcurementFraming = /\brugged (?:laptops?|devices?|hardware)\b.{0,55}\b(?:straightforward|clear) procurement\b|\b(?:straightforward|clear) procurement\b.{0,55}\brugged\b/i.test(sessionText);
    const hasExperimentalAiInspections = /\bAI[- ]?(?:driven )?inspections?\b.{0,45}\bexperimental\b|\bexperimental\b.{0,45}\bAI[- ]?(?:driven )?inspections?\b/i.test(sessionText);
    const modernizationWorkstreams = unique([
        hasRuggedDeviceWorkstream ? 'Rugged devices' : '',
        hasAiInspectionWorkstream ? 'AI inspections' : '',
        hasRemoteConnectivityWorkstream ? 'Remote-site connectivity' : '',
    ], 4);
    const hasModernizationPortfolio = modernizationWorkstreams.length >= 2
        && /\bmoderni[sz]ation\b|\bworkstreams?\b/i.test(sessionText);
    const hasSingleBudgetPool = /\b(?:one|single) (?:big )?(?:budget )?(?:pool|pull)\b|\bbudget is (?:one|a single)\b|\blumping?\b.{0,30}\bbudget\b/i.test(sessionText);
    const hasCurrentFiscalYearPressure = /\brunning out of time\b.{0,35}\b(?:this|current) fiscal year\b|\b(?:this|current) fiscal year\b.{0,50}\b(?:deadline|time|budget|procurement)\b/i.test(sessionText);
    const hasStateConnectivityFunding = /\bremote connectivity\b.{0,55}\bstate funding\b|\bstate funding\b.{0,55}\b(?:remote )?connectivity\b/i.test(sessionText);
    const hasPossibleFederalConnectivityFunding = /\b(?:remote )?connectivity\b.{0,75}\b(?:might|may|could|possibly)\b.{0,20}\bfederal funding\b|\bfederal funding\b.{0,75}\b(?:remote )?connectivity\b/i.test(sessionText);
    const hasPossibleHardwareStateContract = /\bstate contract\b.{0,55}\b(?:cover|covers|covering)\b.{0,25}\b(?:hardware|rugged)\b|\b(?:hardware|rugged)\b.{0,55}\bstate contract\b/i.test(sessionText);
    const hasUnknownAiContractPath = /\bAI\b.{0,50}\b(?:does not|doesn't|probably doesn't|no)\b.{0,25}\bcontract path\b|\bAI side\b.{0,55}\bcontract path\b/i.test(sessionText);
    const hasProcurementOfficerAndFinanceLead = /\bprocurement officer\b.{0,45}\bfinance lead\b|\bfinance lead\b.{0,45}\bprocurement officer\b/i.test(sessionText);
    const hasExplicitPurchasingJurisdiction = /\bstate of [A-Z][A-Za-z ]{2,30}\b|\b(?:purchasing|procuring) (?:state|jurisdiction)\b.{0,30}\b[A-Z][A-Za-z ]{2,30}\b|\b(?:county|city|municipal|federal|tribal) (?:agency|government|organization)\b/i.test(sessionText);
    const hasExplicitPurchasingEntity = /\b(?:agency|department|county|city|district|authority|prime contractor|subcontractor) (?:will|would|is|are) (?:buying|purchasing|procuring|ordering)\b|\bpurchasing entity\b/i.test(sessionText);
    const hasNamedContractVehicle = /\bSVAR\b|\bGSA\b|\bSEWP\b|\bNASPO\b|\bOMNIA\b|\bSourcewell\b|\bcontract\s+(?:number|vehicle)\s+[A-Z0-9-]+/i.test(sessionText);
    const hasStudentRiskUseCase = /student retention|at[- ]risk students?|students? at risk|drop(?:ping)? out/i.test(sourceText);
    const hasAiCustomerExperience = !hasStaffingOptimization
        && /customer experience|contact cent(?:er|re)|call cent(?:er|re)|call wait|wait times?|customer satisfaction|\bCSAT\b/i.test(sourceText)
        && /\bAI\b|artificial intelligence|call recordings?|ticket logs?|speech[- ]to[- ]text|sentiment|predictive routing/i.test(sourceText);
    const hasActiveIncident = /\b(?:network|service|system|production) outage\b|\bactive incident\b|\bransomware incident\b/i.test(sourceText);
    const hasDelayedMigration = /\b(?:cloud )?migration\b.{0,45}\bdelayed\b|\bdelayed\b.{0,45}\b(?:cloud )?migration\b/i.test(sourceText);
    const currentTracks = buildCurrentTracks({ hasErpCutover, hasMunicipalPrescoping, hasArizonaSvar, hasAiDiscovery, hasPlannedCloudMigration });
    const multiTrack = currentTracks.length > 1;
    const dualTrack = hasErpCutover && hasMunicipalPrescoping;
    const uncertainItems = unique(statements.filter((value) => isUncertain(value)
        && !(hasAssumedSmallerOfficeMerger && /\bmerg(?:e|er|ing)\b.{0,45}\bsmaller office\b|\bsmaller office\b.{0,45}\bmerg(?:e|er|ing)\b/i.test(value))).map((value) => {
        if (hasHealthcareOperations && /data.{0,35}(?:problem|issue)|(?:problem|issue).{0,35}data/i.test(value)) return 'Whether data is part of the underlying problem is not yet known.';
        if (hasHealthcareOperations && /might not.{0,45}(?:same|issue|cause)|same (?:issue|cause)/i.test(value)) return 'The two clinics may not share the same root cause.';
        if (hasHealthcareOperations && /not sure.{0,45}(?:changed|workflow)|what changed/i.test(value)) return "The effect of Northside's workflow change is not yet known.";
        if (hasHealthcareOperations && /(?:check|confirm) with IT.{0,55}(?:EHR )?export/i.test(value)) return 'IT still needs to confirm EHR export access and available operational evidence.';
        if (/not sure/i.test(value) && /\b(?:compliance|framework|prime(?:-contractor)?|flow-down)\b/i.test(sourceText)) return 'Applicable compliance framework is not yet known; prime-contractor flow-down is pending.';
        if (/^not sure\.?$/i.test(value)) return '';
        return compact(value, 150);
    }), 4);
    const allText = sourceText;
    const terms = termsFrom(substantiveStatements, rejected);
    const infrastructureComponents = unique([
        hasInfrastructureRefreshDecision && /\bservers?\b/i.test(sessionText) ? 'Servers' : '',
        hasInfrastructureRefreshDecision && /\bnetwork equipment\b/i.test(sessionText) ? 'Network equipment' : '',
        includesSmallerOfficeSystems ? 'Smaller-office systems (inventory pending)' : '',
    ], 5);
    for (const correction of corrections) {
        for (const [, label] of TERM_RULES) {
            if (canonical(correction.to).toLowerCase().includes(label.toLowerCase()) && !terms.includes(label)) terms.push(label);
        }
    }
    const laneId = detectLane(allText);
    const lane = hasCloudAndStaffingAi
        ? 'Cloud migration and AI staffing discovery'
        : hasErpCutover && hasArizonaSvar && hasAiDiscovery
        ? 'Azure ERP, Arizona SVAR, and AI discovery'
        : hasCommittedCloudMigration && hasStateRampRequirement
        ? 'StateRAMP cloud modernization'
        : dualTrack ? 'Azure ERP and municipal compliance planning' : LANE_LABELS[laneId];
    const scale = extractScale(allText);
    const objective = hasCloudAndStaffingAi
        ? 'Keep the planned cloud migration moving while leadership evaluates a separate, unapproved AI staffing-optimization opportunity using only authorized, appropriately scoped operational evidence.'
        : hasPublicSectorAuditPriorities
        ? 'Prepare for the fixed compliance audit by validating remediation evidence for access-control gaps, while sequencing the legacy-system refresh and keeping AI as a separate feasibility question rather than an assumed pilot.'
        : hasErpCutover && hasArizonaSvar && hasAiDiscovery
        ? 'Plan three distinct tracks: protect the ERP cutover within a tight overnight outage window; clarify the Arizona SVAR software purchasing path without treating it as compliance; and scope the confirmed AI opportunities.'
        : dualTrack
        ? 'Plan two separate workstreams: protect the ERP cutover within a tight overnight outage window, and pre-scope municipal compliance while awaiting prime-contractor flow-down.'
        : hasModernizationPortfolio
        ? `Separate ${modernizationWorkstreams.join(', ')} into distinct workstreams so procurement and finance can evaluate budget, funding, sourcing, and timing without treating them as one program.`
        : hasInfrastructureRefreshDecision
        ? `Give ${infrastructureDecisionAudience} a supported decision on which server and network components require refresh${infrastructureCostFrame} at ${infrastructureDecisionGate}, ${infrastructureTimingFrame}.`
        : hasCommittedCloudMigration && hasStateRampRequirement
        ? 'Move the confirmed core workloads and legacy applications toward the cloud by year-end while treating AI as a separate, unapproved discovery track and preserving the agency\'s StateRAMP and internal privacy boundaries.'
        : hasPublicSafetyAi
        ? `Keep the ${hasFundedDeviceRefresh ? 'funded ' : ''}device refresh on its reported track while leadership explores whether AI can reduce administrative burden without assuming an AI pilot or a validated CJIS boundary.`
        : hasHealthcareOperations && hasRisingPatientIntake
        ? 'Give the CEO a credible view of rising patient-intake times across two clinics without assuming the clinics share one cause or that the Northside workflow change is responsible.'
        : hasAiCustomerExperience
        ? `Give leadership a tangible AI-enabled customer-experience brief focused on ${/wait times?|call wait/i.test(sourceText) ? 'reducing call wait times' : 'improving service performance'}${/customer satisfaction|\bCSAT\b/i.test(sourceText) ? ' and improving customer satisfaction' : ''}.`
        : bestObjectiveFrom(substantiveStatements)
        || (certainStatements.length ? 'The desired outcome is still being clarified.' : 'Waiting for the conversation to begin.');
    const explicitTiming = explicitTimingFrom(userTurns);
    const timing = explicitTiming
        || (hasYearEndCloudDeadline ? 'Core cloud workloads by year-end' : '')
        || (hasModernizationPortfolio && hasCurrentFiscalYearPressure
        ? 'Current fiscal-year deadline'
        : dualTrack && /few weeks/i.test(allText)
        ? 'Detailed planning may begin in a few weeks, dependent on compliance clarification from the prime contractor.'
        : hasInfrastructureRefreshDecision && hasBudgetReviewNextQuarter
        ? 'Budget review next quarter'
        : timingFrom(substantiveStatements));
    const constraintStatements = substantiveStatements.filter((statement) => !/\b(?:student|students)\b.{0,30}\bat[- ]risk\b|\bat[- ]risk\b.{0,30}\bstudents?\b/i.test(statement));
    const constraint = hasCloudAndStaffingAi
        ? `${hasNoApprovedAiPilot ? 'No AI pilot is approved; ' : ''}${hasExcludedCjisData ? 'the visitor placed CJIS data outside the requested working scope, but the authorized data owner and security specialists must validate that boundary; ' : ''}do not infer a public-safety environment, approved access, model design, or pilot plan from the discovery conversation.`
        : hasPublicSectorAuditPriorities
        ? `${hasAccessControlEvidence ? 'Leadership requires proof that access-control gaps were addressed within the fixed audit window' : 'The fixed compliance audit is the immediate priority'}; the legacy refresh and AI feasibility must not weaken audit readiness or be treated as approved work.`
        : dualTrack
        ? 'Protect the tight overnight ERP cutover window; do not assume a compliance framework until the prime contractor provides flow-down requirements.'
        : hasModernizationPortfolio
        ? `${hasSingleBudgetPool ? 'One budget pool currently spans distinct workstreams; ' : ''}map each workstream to its reported funding and sourcing status without assuming a jurisdiction, named vehicle, budget line, competitive-bid outcome, or contract eligibility.`
        : hasInfrastructureRefreshDecision
        ? `Do not treat ${infrastructureEvidenceBasis} as sufficient evidence; validate component scope, ${infrastructureExposureLabel}${hasInfrastructureCostConcern ? ', cost drivers' : ''}, and delay exposure before recommending timing${hasAssumedSmallerOfficeMerger ? ', and keep the smaller-office expansion as a planning assumption until its inventory is validated' : ''}.`
        : hasHealthcareOperations
        ? `${needsItValidation ? 'IT must confirm EHR export access and available operational evidence' : 'Available EHR operational evidence is not yet confirmed'}; root cause, permissible data use, and any analysis or dashboard design require specialist validation.`
        : hasCommittedCloudMigration && hasStateRampRequirement
        ? `StateRAMP is a confirmed requirement${hasInternalPrivacyBoundaries ? '; internal privacy and data-classification boundaries must be validated against any proposed cloud services' : ''}. Do not claim a compliant design, approved service, or implementation path without public-sector, cloud, security, and privacy specialist validation.`
        : hasPublicSafetyAi
        ? `${hasVisitorReportedNonSensitiveData ? 'Administrative data was described as non-sensitive, but that label does not establish that the workflow is outside CJIS; ' : ''}the agency security owner and appropriate Insight Public Sector specialists must validate data, users, systems, integrations, policy, and controls before any pilot or technical path is scoped.`
        : hasActiveIncident
        ? `Active network outage with no confirmed restoration time${hasDelayedMigration ? '; cloud migration is delayed' : ''}.`
        : lastSentence(constraintStatements, /constraint|cannot|can't|must|critical|continuity|downtime|maintenance window|budget|security|compliance|risk|aging|disruption|rollback/i);
    const stakeholder = stakeholderWasCleared(userTurns)
        ? ''
        : hasPublicSectorAuditPriorities && /\bDeputy CIO\b/i.test(sessionText)
        ? 'Deputy CIO / agency leadership'
        : hasCloudAndStaffingAi && /\bCOO\b|chief operating officer/i.test(sessionText)
        ? 'COO sponsor; data, security, and AI feasibility owners still to be confirmed'
        : hasProcurementOfficerAndFinanceLead
        ? 'Procurement officer and finance lead'
        : hasInfrastructureRefreshDecision && /\bboard\b/i.test(sessionText) && /\bIT team\b|\bIT says\b/i.test(sessionText)
        ? 'Board decision audience; IT team supplying infrastructure and risk evidence'
        : hasHealthcareOperations && /\bCEO\b/i.test(sessionText)
        ? 'CEO / executive leadership'
        : hasAiCustomerExperience && /\bCEO\b/i.test(allText) && /\bboard\b/i.test(allText)
        ? 'CEO and board leadership'
        : lastSentence(substantiveStatements, /decision[- ]maker|stakeholder|\bCEO\b|\bboard\b|CIO|CFO|CTO|director|vice president|\bVP\b|executive|procurement (?:officer|lead|director|manager|team)|finance (?:officer|lead|director|manager|team)|leadership|owner/i);
    const organization = hasArizonaSvar
        ? 'State of Arizona agency; Arizona SVAR purchasing path raised for specialist validation.'
        : lastSentence(substantiveStatements, /county|city|agency|company|our firm|the firm|hospital|health system|manufactur|distribution|university|school district/i);
    const workloads = unique([
        hasStaffingOptimization ? 'Staffing schedule operations' : '',
        hasHealthcareOperations ? 'Patient intake operations' : '',
        hasPublicSafetyAdminUseCases ? 'Administrative paperwork / Shift scheduling / Staffing reports' : '',
        hasAiCustomerExperience ? 'Customer service and contact-center operations' : '',
        /customer portal/i.test(allText) ? 'Customer portal' : '',
        /\bERP\b/i.test(allText) ? 'ERP' : '',
        /\bSAP\b/i.test(allText) ? 'SAP' : '',
        /Manhattan WMS|\bWMS\b/i.test(allText) ? 'Warehouse management system' : '',
        /manufacturing execution systems?|\bMES\b/i.test(allText) ? 'Manufacturing execution systems' : '',
        /citizen services?|public portal/i.test(allText) ? 'Citizen services' : '',
    ], 5);
    const dataSources = unique([
        hasShiftCalendarData ? 'Shift calendars - authorization and usable fields not yet validated' : '',
        hasPayrollLogData ? 'Payroll logs - authorization, privacy boundary, and usable fields not yet validated' : '',
        hasHealthcareOperations && hasEhr ? `EHR operational data - ${needsItValidation ? 'export and usable event availability pending IT confirmation' : 'availability and permissible use not yet confirmed'}` : '',
        hasVisitorReportedNonSensitiveData ? 'Visitor-described non-sensitive administrative data - CJIS boundary not validated' : '',
        /(?:call|cool) recordings?/i.test(allText) ? `${/on[- ]?prem/i.test(allText) ? 'On-premises ' : ''}call recordings` : '',
        /ticket logs?/i.test(allText) ? `${/on[- ]?prem/i.test(allText) ? 'On-premises ' : ''}ticket logs` : '',
        /\bSIS\b|student information system/i.test(allText) ? 'Student information system data' : '',
    ], 5);
    const compliance = unique([
        /\bNIST\b/i.test(allText) ? 'NIST' : '',
        /\bHIPAA\b/i.test(allText) ? 'HIPAA' : '',
        /\bCJIS\b/i.test(allText) && (!hasExcludedCjisData || hasPublicSafetyAi) ? 'CJIS' : '',
        /FedRAMP/i.test(allText) ? 'FedRAMP' : '',
        /StateRAMP/i.test(allText) ? 'StateRAMP' : '',
    ], 5);
    const requestedOutput = requestedOutputFrom(userTurns, currentTracks.length, requestedView);
    const decision = lastSentence(substantiveStatements, /we decided|we selected|we will proceed|the decision is/i);
    const aiDiscovery = hasStaffingOptimization
        ? `Explore whether AI could support staffing-schedule optimization using ${hasShiftCalendarData || hasPayrollLogData ? 'visitor-identified operational sources' : 'authorized operational evidence'}; no pilot, data access, model, or implementation path is approved.`
        : hasAiCustomerExperience
        ? 'Explore approved historical contact-center data to understand wait-time drivers and customer-experience improvement opportunities.'
        : hasAiInterestOnly
        ? 'AI is an area of leadership interest; no pilot is approved, funded, or scheduled.'
        : lastSentence(substantiveStatements, /\bAI\b|artificial intelligence|student retention|at[- ]risk students?|students? at risk|drop(?:ping)? out|runbooks?|technical document|telemetry|internal (?:IT )?assistant/i);
    const healthcareOperationalChange = hasHealthcareOperations && hasNorthside && hasPreScreening
        ? `Northside clinic added a pre-screening step${/last month/i.test(sessionText) ? ' last month' : ''}.`
        : hasHealthcareOperations && hasWorkflowChange
        ? 'One clinic reported a recent workflow change.'
        : '';
    const healthcareEvidenceStatus = hasHealthcareOperations
        ? needsItValidation
            ? 'IT confirmation is pending for EHR export access and usable operational evidence.'
            : 'EHR operational evidence and permissible use are not yet confirmed.'
        : '';
    const infrastructureAuditEvidence = hasInfrastructureRefreshDecision && hasOutdatedFirmwareAudit
        ? `An audit${hasSixMonthAuditTiming ? ' six months ago' : ''} flagged outdated firmware${hasNoMajorBreach ? '; no major breaches were reported' : ''}.`
        : '';
    const deferralPreference = hasInfrastructureRefreshDecision && prefersDeferralToNextYear
        ? 'Prefer to defer the refresh until next year if validated risk and lifecycle evidence support waiting.'
        : '';
    const smallerOfficePlanningAssumption = hasAssumedSmallerOfficeMerger
        ? `Assume the smaller-office merger occurs${mergerPlanningNextQuarter ? ' next quarter' : ''}${includesSmallerOfficeSystems ? " and include that office's systems in planning" : ''}; exact inventory remains unvalidated.`
        : '';
    const expansionImpact = hasAssumedSmallerOfficeMerger && expandsScopeAndBudget
        ? 'Planning scope and budget expand to account for the smaller-office systems; quantify the impact after inventory validation.'
        : '';
    const modernizationWorkstreamStatus = hasModernizationPortfolio
        ? unique([
            hasRuggedDeviceWorkstream ? `Rugged devices${hasRuggedProcurementFraming ? ' - described as straightforward procurement' : ''}` : '',
            hasAiInspectionWorkstream ? `AI inspections${hasExperimentalAiInspections ? ' - described as experimental' : ''}` : '',
            hasRemoteConnectivityWorkstream ? 'Remote-site connectivity - funding-dependent workstream' : '',
        ], 4).join(' / ')
        : '';
    const modernizationFundingStatus = hasModernizationPortfolio && hasRemoteConnectivityWorkstream
        ? hasPossibleFederalConnectivityFunding
            ? `${hasStateConnectivityFunding ? 'State funding was reported for remote-site connectivity; ' : ''}federal funding may also apply and remains an unconfirmed planning assumption that could change the procurement path.`
            : hasStateConnectivityFunding
            ? 'State funding was reported for remote-site connectivity.'
            : ''
        : '';
    const modernizationContractStatus = hasModernizationPortfolio
        ? unique([
            hasPossibleHardwareStateContract ? 'Rugged hardware may fit an existing state contract; applicability is unconfirmed.' : '',
            hasUnknownAiContractPath ? 'No contract path has been identified for AI inspections.' : '',
        ], 3).join(' / ')
        : '';

    const facts = [
        makeFact('Organization', 'Context', organization),
        makeFact('Scale', 'Environment scale', scale),
        makeFact('Environment', 'Technology context', unique([hasAzureAd ? 'Azure AD access management' : '', ...terms.filter(term => !(hasAzureAd && term === 'Azure')), ...infrastructureComponents], 10).join(' / ')),
        makeFact('Environment', 'Critical workloads', workloads.join(' / ')),
        makeFact('Environment', hasHealthcareOperations ? 'Evidence source' : 'Available data', dataSources.join(' / ')),
        makeFact('Environment', 'Reported workflow change', healthcareOperationalChange),
        makeFact('Environment', 'Audit evidence', infrastructureAuditEvidence),
        makeFact('Environment', 'Modernization workstreams', modernizationWorkstreamStatus),
        makeFact('Priorities', 'Device refresh status', hasFundedDeviceRefresh ? 'Funded; rollout is expected to start next quarter.' : ''),
        makeFact('Priorities', 'Cloud migration status', hasPlannedCloudMigration ? 'Planned workstream; keep its scope and decision gates separate from AI exploration.' : ''),
        makeFact('Priorities', 'Cloud migration status', hasCommittedCloudMigration && !hasPlannedCloudMigration ? 'Confirmed workstream covering core workloads and selected legacy applications.' : ''),
        makeFact('Priorities', 'AI staffing status', hasStaffingOptimization ? `${hasNoApprovedAiPilot ? 'Exploration only; no pilot is approved.' : 'Early discovery; approval status remains unconfirmed.'} COO sponsorship was reported.` : ''),
        makeFact('Priorities', 'AI status', hasAiInterestOnly ? 'Leadership interest only; no pilot is approved, funded, or scheduled.' : ''),
        makeFact('Constraints', 'Data boundary', hasCloudAndStaffingAi && hasExcludedCjisData ? 'Visitor requested that CJIS data remain out of scope; authorized data and security owners must validate the usable boundary.' : ''),
        makeFact('Constraints', 'Evidence status', healthcareEvidenceStatus),
        makeFact('Constraints', 'Planning assumption', smallerOfficePlanningAssumption),
        makeFact('Constraints', 'Scope and budget impact', expansionImpact),
        makeFact('Priorities', 'Current objective', objective.includes('still being clarified') || objective.startsWith('Waiting') ? '' : objective),
        makeFact('Priorities', 'AI discovery', hasAiDiscovery ? aiDiscovery : ''),
        makeFact('Procurement', 'Arizona SVAR', hasArizonaSvar ? 'Software Value-Added Reseller purchasing contract; confirm software category, purchaser, and ordering path with an Insight Public Sector specialist.' : ''),
        makeFact('Procurement', 'Funding context', modernizationFundingStatus),
        makeFact('Procurement', 'Contract-path status', modernizationContractStatus),
        makeFact('Constraints', 'Primary guardrail', constraint),
        makeFact('Constraints', 'Audit evidence requirement', hasAccessControlEvidence ? 'Show proof that identified access-control gaps were addressed.' : ''),
        makeFact('Constraints', 'Governance drivers', compliance.join(' / ')),
        makeFact('Constraints', 'Privacy boundary', hasInternalPrivacyBoundaries ? 'Internal privacy and data-classification boundaries must be validated against any proposed cloud services.' : ''),
        makeFact('Timing', 'Timing', timing),
        makeFact('Timing', 'Deferral preference', deferralPreference),
        makeFact('Identity', 'Stakeholder context', stakeholder),
        makeFact('Requested outputs', 'Requested output', requestedOutput),
        makeFact('Decisions', 'Decision', decision),
    ].filter((fact): fact is AmyWorkbenchFact => Boolean(fact));

    const openQuestions = unique([
        hasCloudAndStaffingAi ? 'Who owns authorization and field validation for the shift-calendar and payroll evidence?' : '',
        hasCloudAndStaffingAi ? 'What staffing decision and measurable outcome would justify a bounded feasibility review?' : '',
        hasCloudAndStaffingAi ? 'What privacy, security, retention, and human-review boundaries apply to the proposed operational evidence?' : '',
        hasModernizationPortfolio && !hasExplicitPurchasingJurisdiction ? 'Which state or jurisdiction will make the purchase?' : '',
        hasModernizationPortfolio && !hasExplicitPurchasingEntity ? 'Which organization or contracting entity will actually make the purchase?' : '',
        hasModernizationPortfolio && hasPossibleFederalConnectivityFunding ? 'Is federal funding confirmed for remote-site connectivity, and what funding requirements must procurement validate?' : '',
        hasModernizationPortfolio && !hasNamedContractVehicle ? 'What existing contract or solicitation path, if any, has the procurement owner identified for each workstream?' : '',
        hasInfrastructureRefreshDecision ? 'Which specific servers and network components are in scope, and what are their support and lifecycle statuses?' : '',
        hasInfrastructureRefreshDecision && hasOutdatedFirmwareAudit ? 'What severity, exploitability, and business exposure are tied to the outdated-firmware findings?' : '',
        hasInfrastructureRefreshDecision && !hasOutdatedFirmwareAudit ? 'What validated lifecycle, support, reliability, or security evidence is driving the refresh request?' : '',
        hasInfrastructureRefreshDecision && hasInfrastructureCostConcern ? 'What costs belong to firmware remediation, targeted replacement, phased refresh, and full refresh?' : '',
        hasInfrastructureRefreshDecision && hasAssumedSmallerOfficeMerger ? "Which of the smaller office's systems, dependencies, and support obligations enter the planning scope?" : '',
        hasHealthcareOperations ? 'Which operational measures, if any, are available through an authorized aggregated or de-identified source?' : '',
        hasHealthcareOperations ? 'What decision does the CEO need to make from this working brief?' : '',
        hasHealthcareOperations ? 'Do the clinics use comparable intake definitions and measurement windows?' : '',
        hasHealthcareOperations && !timing ? 'What timing does leadership actually need for the next decision?' : '',
        hasStudentRiskUseCase ? 'Has the authorized data owner approved de-identified or synthetic data for this demonstration?' : '',
        hasStudentRiskUseCase ? 'What privacy, institutional policy, fairness, explainability, and human-review requirements apply before any student-level use?' : '',
        hasAiCustomerExperience ? 'Are the call recordings and ticket logs authorized for AI analysis, and what PII, payment-data, retention, and on-premises requirements apply?' : '',
        hasAiCustomerExperience ? 'What are the current wait-time and customer-satisfaction baselines, and which contact-center systems produce them?' : '',
        hasAiCustomerExperience ? 'What decision does leadership need to make from the brief?' : '',
        hasAiDiscovery && !hasStudentRiskUseCase && !hasAiCustomerExperience && !hasCloudAndStaffingAi
            ? hasArizonaSvar
                ? 'What data would each AI use case access, and could agency or contract-controlled information enter prompts?'
                : 'What data would each AI use case access, and could organization- or contract-controlled information enter prompts?'
            : '',
        hasAiDiscovery && !hasStudentRiskUseCase && !hasAiCustomerExperience && !hasCloudAndStaffingAi
            ? hasArizonaSvar
                ? 'What agency AI policy, human-review, hosting, identity, and measurable-outcome requirements apply?'
                : 'What AI policy, human-review, hosting, identity, and measurable-outcome requirements apply?'
            : '',
        hasPublicSafetyAi && !hasValidatedPublicSafetyDataBoundary ? 'Has the agency security owner validated whether the proposed administrative data, users, systems, and integrations sit inside or outside the CJIS boundary?' : '',
        hasPublicSafetyAi ? 'Which agency AI policy and human-review requirements apply before feasibility work begins?' : '',
        hasArizonaSvar ? 'Who will purchase through SVAR-the agency, the prime contractor, or another eligible entity?' : '',
        objective.includes('still being clarified') || objective.startsWith('Waiting') ? 'What outcome would make this initiative successful?' : '',
        !terms.length && !workloads.length && !dataSources.length && !infrastructureComponents.length
            ? 'Which environment, workload, or platform is in scope?'
            : '',
        !constraint ? 'What constraint or risk should shape the approach?' : '',
        !timing ? 'What timing or operating window matters?' : '',
        !stakeholder ? 'Who should be involved in the next decision?' : '',
        ...uncertainItems.map((item) => `Please clarify: ${item}`),
    ], 4);
    const priorities = unique([
        hasCloudAndStaffingAi ? 'Keep the planned cloud migration and unapproved AI staffing exploration as separate workstreams.' : '',
        hasCloudAndStaffingAi ? 'Treat shift calendars and payroll logs as visitor-identified sources, not authorized or technically usable evidence.' : '',
        hasCloudAndStaffingAi && hasExcludedCjisData ? 'Record the requested CJIS exclusion without inferring the organization, policy applicability, or a validated security boundary.' : '',
        hasModernizationPortfolio ? `Keep ${modernizationWorkstreams.join(', ')} as separate workstreams rather than one modernization program.` : '',
        hasModernizationPortfolio && modernizationFundingStatus ? modernizationFundingStatus : '',
        hasModernizationPortfolio ? 'Gather jurisdiction, purchasing entity, funding, vehicle or solicitation status, timing, and owners without confirming contract applicability or eligibility.' : '',
        hasInfrastructureRefreshDecision && hasOutdatedFirmwareAudit ? 'Separate the confirmed outdated-firmware audit finding from unvalidated claims about overall security severity.' : '',
        hasInfrastructureRefreshDecision ? `Compare targeted remediation, phased refresh, full refresh, and deferral only after component-level ${hasInfrastructureCostConcern ? 'cost and ' : ''}risk evidence is available.` : '',
        hasInfrastructureRefreshDecision && hasBudgetReviewNextQuarter && prefersDeferralToNextYear ? 'Keep the next-quarter budget decision separate from the preference to defer implementation until next year.' : '',
        hasInfrastructureRefreshDecision && hasAssumedSmallerOfficeMerger ? smallerOfficePlanningAssumption : '',
        hasInfrastructureRefreshDecision && hasAssumedSmallerOfficeMerger ? expansionImpact : '',
        hasHealthcareOperations ? 'Keep confirmed operational facts, hypotheses, and unknowns visibly separate.' : '',
        hasHealthcareOperations ? 'Use only authorized aggregated, de-identified, or synthetic operational data during early discovery.' : '',
        hasHealthcareOperations ? 'Do not treat the Northside workflow change or pre-screening step as a confirmed cause.' : '',
        multiTrack ? `Keep ${currentTracks.join(', ')} as separate workstreams.` : '',
        hasArizonaSvar ? 'Treat Arizona SVAR as a software purchasing path, not a compliance approval process.' : '',
        hasStudentRiskUseCase ? 'Frame the three-day deliverable as a board-ready feasibility demonstration, not a validated student-risk model.' : '',
        hasStudentRiskUseCase ? 'Use only approved de-identified or synthetic data until privacy, fairness, explainability, and human review are validated.' : '',
        hasAiCustomerExperience && hasActiveIncident ? 'Keep outage stabilization separate from the board-facing AI deliverable.' : '',
        hasAiCustomerExperience ? 'Frame the near-term deliverable as a bounded offline leadership concept, not a live AI deployment or validated routing model.' : '',
        hasAiCustomerExperience ? 'Use only approved, de-identified historical data or synthetic examples until privacy, security, and operating safeguards are validated.' : '',
        hasPublicSafetyAi ? 'Keep the funded device rollout and unapproved AI exploration as separate tracks.' : '',
        hasPublicSafetyAi ? 'Treat the administrative-data classification and CJIS boundary as pending agency security-owner validation.' : '',
        constraint,
        timing,
        compliance.length ? `Account for ${compliance.join(', ')}.` : '',
        terms.length ? `Work with the existing ${terms.slice(0, 4).join(', ')} environment.` : '',
    ], 5);
    const nextStep = hasCloudAndStaffingAi
        ? 'Have the authorized data owner and appropriate Insight data, AI, privacy, and security specialists validate the staffing decision, usable operational fields, CJIS exclusion, and feasibility boundary before defining any pilot, model, or implementation plan.'
        : hasModernizationPortfolio
        ? 'Complete the jurisdiction, purchasing-entity, funding, contract-path, timing, and owner facts, then have the procurement owner and an Insight Public Sector specialist validate the appropriate sourcing route without treating Amy\'s working brief as a contract confirmation.'
        : hasHealthcareOperations
        ? 'Have the authorized data owner and the appropriate Insight healthcare and data specialists validate available operational evidence and privacy boundaries before scoping an analysis or dashboard.'
        : hasInfrastructureRefreshDecision
        ? `Have the IT owner and appropriate Insight infrastructure and security specialists validate the component inventory, ${hasOutdatedFirmwareAudit ? 'firmware exposure, ' : ''}lifecycle status${hasInfrastructureCostConcern ? ', and option-level costs' : ''} before ${infrastructureDecisionGate}${hasAssumedSmallerOfficeMerger ? ', including the assumed smaller-office scope as a separately validated input' : ''}.`
        : hasStudentRiskUseCase
        ? 'Validate data authorization, de-identification or synthetic-data use, privacy, fairness, explainability, human review, and three-day feasibility with the appropriate institutional and Insight specialists before using student-level records.'
        : hasAiCustomerExperience
        ? 'Confirm the board decision, data authorization, privacy and on-premises boundaries, then select one bounded offline AI-CX concept for customer-experience, data, security, infrastructure, AI, and Insight specialist validation.'
        : hasPublicSafetyAi
        ? 'Keep the device rollout on its committed track; have the operations and agency security owners define the administrative use, data, users, systems, policy, and success decision for Insight Public Sector security and AI specialist validation before calling it a pilot.'
        : multiTrack
        ? `Confirm separate owners and decision gates for ${currentTracks.join(', ')}, including Insight Public Sector review of the SVAR ordering path.`
        : openQuestions.length
        ? `Clarify ${openQuestions[0].replace(/^What |^Which |^Who |^Please clarify:\s*/i, '').replace(/\?$/, '').toLowerCase()}.`
        : 'Review the confirmed scope with the appropriate Insight specialist and agree on the next decision gate.';
    const roadmapFacts = facts
        .filter((fact) => ['Scale', 'Environment', 'Priorities', 'Procurement', 'Constraints', 'Timing', 'Requested outputs'].includes(fact.section))
        .map((fact) => ({ label: fact.label, value: fact.value }));
    const phases = hasCloudAndStaffingAi
        ? [
            { number: '01', title: 'Protect the planned track', detail: 'Keep cloud-migration scope, ownership, dependencies, and timing separate from AI exploration.' },
            { number: '02', title: 'Frame the staffing decision', detail: 'Confirm the COO-sponsored outcome, baseline, users, decision owner, and evidence needed without prescribing a model or pilot.' },
            { number: '03', title: 'Validate evidence and boundaries', detail: 'Have authorized owners confirm usable shift-calendar and payroll fields, privacy and security requirements, and the requested CJIS exclusion.' },
            { number: '04', title: 'Choose the next gate', detail: 'Only after specialist validation, decide whether a bounded feasibility exercise is warranted; keep approval, architecture, and implementation uncommitted.' },
        ]
        : hasModernizationPortfolio
        ? [
            { number: '01', title: 'Separate the workstreams', detail: `Keep ${modernizationWorkstreams.join(', ')} distinct, including their different maturity, funding, and sourcing questions.` },
            { number: '02', title: 'Complete procurement facts', detail: 'Capture the purchasing jurisdiction and entity, confirmed or possible funding, existing vehicle or solicitation status, timing, and responsible roles without naming an unraised vehicle.' },
            { number: '03', title: 'Validate the sourcing paths', detail: 'Have the procurement owner and an Insight Public Sector specialist validate category coverage, eligibility, bidding requirements, funding restrictions, and the appropriate route for each workstream.' },
            { number: '04', title: 'Set separate decisions', detail: 'Give procurement and finance a bounded choice for each workstream without implying contract confirmation, approval, pricing, or committed funding.' },
        ]
        : hasInfrastructureRefreshDecision
        ? [
            {
                number: '01',
                title: 'Confirm the component boundary',
                detail: `Inventory the specific servers and network equipment in scope, ownership, lifecycle status, dependencies, and support exposure${hasAssumedSmallerOfficeMerger ? ", with the smaller office's systems tracked as an explicit planning assumption" : ''}.`,
            },
            {
                number: '02',
                title: hasOutdatedFirmwareAudit ? 'Validate security severity' : 'Validate risk and lifecycle exposure',
                detail: hasOutdatedFirmwareAudit
                    ? 'Have infrastructure and security specialists verify the outdated-firmware findings, exploitability, business impact, and compensating controls; an audit finding alone does not establish that a full refresh is required.'
                    : 'Have infrastructure and security specialists verify lifecycle, support, reliability, security, and business-impact evidence; a refresh request alone does not establish that a full replacement is required.',
            },
            {
                number: '03',
                title: 'Compare bounded options',
                detail: `Build evidence-backed ${hasInfrastructureCostConcern ? 'cost and ' : ''}risk comparisons for ${hasOutdatedFirmwareAudit ? 'firmware remediation, ' : ''}targeted replacement, phased refresh, full refresh, and deferral without inventing ${hasInfrastructureCostConcern ? 'prices or ' : ''}risk scores.`,
            },
            {
                number: '04',
                title: hasBoardAudience ? 'Set the board decision gate' : 'Set the decision gate',
                detail: `Bring validated scope, ${infrastructureExposureLabel}${hasInfrastructureCostConcern ? ', cost' : ''}, and deferral exposure to ${infrastructureDecisionGate} while keeping any implementation timing or approval uncommitted.`,
            },
        ]
        : hasPublicSafetyAi
        ? [
            { number: '01', title: 'Protect the committed track', detail: 'Keep the funded device refresh and next-quarter rollout distinct from unapproved AI exploration.' },
            { number: '02', title: 'Define the AI decision', detail: 'Confirm the administrative burden, intended users, process owner, and evidence that would justify feasibility work without inventing a target.' },
            { number: '03', title: 'Validate the boundary', detail: 'Have the agency security owner and Insight Public Sector specialists validate data classification, CJIS applicability, systems, identities, integrations, policy, and human review.' },
            { number: '04', title: 'Choose the next gate', detail: 'Only after validation, decide whether a bounded feasibility exercise is appropriate; do not imply approval, architecture, hosting, certification, or timing.' },
        ]
        : currentTracks.length > 2
        ? buildMultiTrackPhases(currentTracks, aiDiscovery)
        : buildPhases(laneId, { scale, terms, constraint, timing, workloads, dataSources, dualTrack, activeIncident: hasActiveIncident });
    const roadmapOutcome = hasCloudAndStaffingAi
        ? 'Give leadership two independently gated paths: a planned cloud migration and a fact-based AI staffing feasibility decision, without turning exploration into an approved pilot.'
        : currentTracks.length > 2
        ? `Develop ${currentTracks.length} coordinated but independently gated tracks: ${currentTracks.join(', ')}.`
        : dualTrack
        ? 'Develop two coordinated but independently gated paths: ERP cutover readiness and municipal compliance pre-scoping.'
        : hasModernizationPortfolio
        ? `Give procurement and finance separate, fact-based decision paths for ${modernizationWorkstreams.join(', ')} without confirming a contract vehicle or funding eligibility.`
        : hasInfrastructureRefreshDecision
        ? `Frame a ${hasBoardAudience ? 'board' : 'leadership'} decision among targeted remediation, phased refresh, full refresh, or deferral using validated component, risk${hasInfrastructureCostConcern ? ', and cost' : ''} evidence${hasAssumedSmallerOfficeMerger ? ', with the smaller-office expansion kept as a separately validated planning assumption' : ''}.`
        : hasPublicSafetyAi
        ? 'Give leadership a two-track decision brief: protect the funded device rollout, and validate whether a separate administrative-AI feasibility track is responsible and permitted.'
        : laneId === 'healthcare-operations'
        ? 'Frame a credible executive comparison while keeping root cause, EHR evidence, privacy boundaries, and any dashboard design explicitly unconfirmed.'
        : compact(roadmapTopic) || ({
        endpoint: 'Create a measured endpoint modernization path with representative pilots and controlled deployment waves.',
        cloud: 'Shape a phased modernization path that protects critical workloads and validates continuity requirements.',
        security: 'Turn the stated risks and control gaps into a validated and sequenced remediation plan.',
        mobility: 'Modernize warehouse mobility while protecting picking, shipping, and peak-season throughput.',
        education: 'Create a board-ready, human-reviewed education AI feasibility path without treating a demonstration as a validated student-risk model.',
        'healthcare-operations': 'Frame a healthcare-operations decision using confirmed facts, explicit unknowns, and specialist-validated evidence.',
        'customer-experience': 'Give leadership a credible AI-CX decision brief now, while keeping incident response and any later production pilot independently gated.',
        'public-sector': 'Connect the mission outcome, technical sequence, governance, and an appropriate purchasing path.',
        general: 'Turn the confirmed objective and constraints into a practical next decision.',
    } satisfies Record<LaneId, string>)[laneId];

    const environmentItems = unique([...modernizationWorkstreams, ...terms, ...infrastructureComponents, ...dataSources, ...workloads], 10);
    const discussionPoints = unique(facts.map((fact) => `${fact.label}: ${fact.value}`), 12);
    const qualityMissing = unique([
        objective.includes('still being clarified') || objective.startsWith('Waiting') ? 'business objective' : '',
        !timing ? 'decision timing' : '',
        !environmentItems.length ? 'environment or evidence source' : '',
        hasInfrastructureRefreshDecision && !hasSpecificInfrastructureScope ? 'specific server and network scope' : '',
        hasInfrastructureRefreshDecision && !hasValidatedSecuritySeverity ? `validated ${infrastructureExposureLabel}` : '',
        hasInfrastructureRefreshDecision && hasInfrastructureCostConcern && !hasCostBreakdown ? 'option-level cost evidence' : '',
        hasHealthcareOperations && !hasAuthorizedHealthcareEvidence ? 'authorized operational evidence' : '',
        hasPublicSafetyAi && !hasValidatedPublicSafetyDataBoundary ? 'agency-validated CJIS and data boundary' : '',
        hasPublicSafetyAi && hasAiInterestOnly ? 'approved AI feasibility decision and owner' : '',
        hasCloudAndStaffingAi ? 'authorized staffing-data owner and usable field validation' : '',
        hasCloudAndStaffingAi ? 'measurable AI staffing outcome and feasibility decision gate' : '',
        hasModernizationPortfolio && !hasExplicitPurchasingJurisdiction ? 'purchasing jurisdiction' : '',
        hasModernizationPortfolio && !hasExplicitPurchasingEntity ? 'purchasing entity' : '',
        hasModernizationPortfolio && hasPossibleFederalConnectivityFunding ? 'confirmed connectivity funding source' : '',
        !requestedOutput ? 'requested artifact' : '',
    ], 4);
    const quality = {
        level: qualityMissing.length === 0 ? 'grounded' as const : 'developing' as const,
        label: qualityMissing.length === 0 ? 'Conversation grounded' : 'Needs clarification',
        missing: qualityMissing,
    };
    const slideBoundary = hasCloudAndStaffingAi
        ? 'Working discovery view only. Cloud migration is planned; AI staffing remains unapproved exploration. Data authorization, usable fields, CJIS exclusion, privacy and security boundaries, feasibility, and any model or pilot require owner and Insight specialist validation.'
        : hasModernizationPortfolio
        ? 'Working procurement-discovery view only. Jurisdiction, purchasing entity, funding requirements, category coverage, bidding obligations, eligibility, and the appropriate sourcing route require procurement-owner and Insight Public Sector specialist validation.'
        : hasHealthcareOperations
        ? 'Working healthcare-operations view only. Root cause, EHR data availability, privacy boundaries, and any analysis or dashboard design require authorized data-owner and Insight specialist validation.'
        : hasInfrastructureRefreshDecision
        ? `Working infrastructure decision view only. Component scope, ${infrastructureExposureLabel}${hasInfrastructureCostConcern ? ', option costs' : ''}, delay exposure${hasAssumedSmallerOfficeMerger ? ', merger inventory' : ''}, and any recommendation require IT-owner and Insight specialist validation.`
        : hasPublicSafetyAi
        ? 'Working public-safety discovery view only. Administrative data labels do not establish the CJIS boundary; agency security-owner and Insight Public Sector specialist validation is required before any pilot, hosting, architecture, control, or compliance claim.'
        : 'Working view based on the conversation so far; specialist validation is still required.';
    const businessOutcome = hasCloudAndStaffingAi
        ? 'Keep the planned cloud migration on its own track while giving the COO a credible, bounded decision path for AI staffing exploration'
        : hasModernizationPortfolio
        ? `Give procurement and finance a clear separation of ${modernizationWorkstreams.join(', ')} without inventing a contract path`
        : hasInfrastructureRefreshDecision
        ? `Give ${infrastructureDecisionAudience} a supported refresh-versus-deferral decision without treating ${infrastructureEvidenceBasis} as proof that a full replacement is required`
        : hasPublicSafetyAi
        ? 'Keep the funded device refresh on track while treating AI as unapproved discovery until its data and CJIS boundaries are validated'
        : hasHealthcareOperations
        ? 'Give leadership a credible view of rising patient-intake times without inventing a root cause'
        : hasAiCustomerExperience
        ? 'Reduce call wait times and improve customer satisfaction'
        : roadmapOutcome;
    const decisionFrame = decision || (hasCloudAndStaffingAi
        ? 'Decide whether the staffing opportunity merits a specialist-validated feasibility step after data ownership, usable evidence, privacy and security boundaries, and success measures are confirmed.'
        : hasModernizationPortfolio
        ? 'Decide which workstreams can advance within the current fiscal year after the purchasing jurisdiction, entity, funding requirements, and sourcing options are validated.'
        : hasInfrastructureRefreshDecision
        ? `Decide at ${infrastructureDecisionGate} whether validated evidence supports targeted remediation, a phased or full refresh${prefersDeferralToNextYear ? ', or deferral to next year' : ', and what timing is justified'}.`
        : hasPublicSafetyAi
        ? 'Decide whether the administrative AI interest merits a separately governed feasibility step after the agency validates the data and CJIS boundary.'
        : hasHealthcareOperations
        ? 'Decide whether the confirmed operational evidence is sufficient to authorize a specialist-defined clinic comparison.'
        : hasAiCustomerExperience
        ? 'Decide whether to authorize a bounded offline AI-CX concept for leadership review before considering a production pilot.'
        : nextStep);
    const visualTitle = hasCloudAndStaffingAi
        ? 'Two tracks—one planned, one still exploratory'
        : hasModernizationPortfolio
        ? 'Three modernization workstreams—three fact-finding paths'
        : hasInfrastructureRefreshDecision
        ? `What ${hasBoardAudience ? 'the board' : 'leadership'} knows—and what IT still must validate`
        : hasPublicSafetyAi
        ? 'Two tracks—one committed, one still to validate'
        : hasHealthcareOperations
        ? 'Separate what is known from what still needs validation'
        : hasAiCustomerExperience
        ? 'A credible AI-CX story—without adding outage risk'
        : lane;
    const evidenceAndConstraints = hasCloudAndStaffingAi
        ? unique([
            'Confirmed: A cloud migration is planned.',
            'Confirmed: The COO is sponsoring exploration of AI for staffing-schedule optimization; no pilot is approved.',
            hasShiftCalendarData || hasPayrollLogData ? `Visitor-identified evidence: ${unique([hasShiftCalendarData ? 'shift calendars' : '', hasPayrollLogData ? 'payroll logs' : ''], 2).join(' and ')}; authorization and usable fields remain unvalidated.` : '',
            hasExcludedCjisData ? 'Visitor-stated boundary: Exclude CJIS data; applicability and the authorized boundary still require validation.' : '',
        ], 6)
        : hasModernizationPortfolio
        ? unique([
            modernizationWorkstreamStatus ? `Confirmed workstreams: ${modernizationWorkstreamStatus}` : '',
            modernizationFundingStatus ? `Funding context: ${modernizationFundingStatus}` : '',
            modernizationContractStatus ? `Contract-path status: ${modernizationContractStatus}` : '',
            constraint,
        ], 6)
        : hasInfrastructureRefreshDecision
        ? unique([
            'Confirmed: The refresh request covers servers and network equipment.',
            infrastructureAuditEvidence ? `Confirmed: ${infrastructureAuditEvidence}` : '',
            `Unvalidated: The exact affected components, ${infrastructureExposureLabel}${hasInfrastructureCostConcern ? ', and cost drivers' : ''}.`,
            smallerOfficePlanningAssumption ? `Planning assumption: ${smallerOfficePlanningAssumption}` : '',
            expansionImpact ? `Pending validation: ${expansionImpact}` : '',
        ], 6)
        : hasHealthcareOperations
        ? unique([
            hasEhr ? 'Confirmed: An EHR exists.' : '',
            healthcareOperationalChange ? `Confirmed: ${healthcareOperationalChange}` : '',
            healthcareEvidenceStatus ? `Pending validation: ${healthcareEvidenceStatus}` : '',
            hasPreScreening ? 'Unconfirmed hypothesis: The pre-screening step has not been established as the bottleneck.' : '',
            'Unknown: The two clinics may not share the same root cause.',
        ], 6)
        : hasPublicSafetyAi
        ? unique([
            hasFundedDeviceRefresh ? 'Confirmed: The device refresh is funded and expected to begin next quarter.' : '',
            hasAiInterestOnly ? 'Confirmed: AI is an area of leadership interest; no pilot is scheduled.' : '',
            hasPublicSafetyAdminUseCases ? 'Reported use cases: Administrative paperwork, shift scheduling, and staffing reports.' : '',
            hasVisitorReportedNonSensitiveData ? 'Unvalidated: The visitor described the data as non-sensitive and outside case files; the CJIS boundary is not confirmed.' : '',
            'Pending: Agency security-owner and Insight specialist validation of data, users, systems, integrations, policy, and controls.',
        ], 6)
        : unique([
            ...dataSources,
            ...terms,
            ...workloads,
            constraint,
            ...compliance,
        ], 6);
    const executiveBullets = hasCloudAndStaffingAi
        ? unique([
            'Planned track: Cloud migration',
            'Exploratory track: AI staffing optimization; no approved pilot',
            timing ? `Timing raised: ${timing}` : '',
            hasExcludedCjisData ? 'Requested boundary: Exclude CJIS data; validation pending' : '',
        ], 4)
        : hasModernizationPortfolio
        ? unique([
            `Workstreams: ${modernizationWorkstreams.join(', ')}`,
            timing ? `Decision pressure: ${timing}` : '',
            modernizationFundingStatus ? `Funding: ${modernizationFundingStatus}` : '',
            'Boundary: No contract applicability or eligibility has been confirmed.',
        ], 4)
        : hasInfrastructureRefreshDecision
        ? unique([
            smallerOfficePlanningAssumption ? `Planning assumption: ${smallerOfficePlanningAssumption}${expansionImpact ? ` ${expansionImpact}` : ''}` : '',
            hasBudgetReviewNextQuarter && prefersDeferralToNextYear
                ? 'Decision timing: Budget review next quarter; implementation preference is next year if validated risk supports deferral.'
                : hasBudgetReviewNextQuarter
                ? 'Decision timing: Budget review next quarter.'
                : prefersDeferralToNextYear
                ? 'Implementation preference: Defer to next year if validated risk supports waiting.'
                : '',
            'Environment: Servers and network equipment; exact components remain unconfirmed.',
            infrastructureAuditEvidence ? `Evidence: ${infrastructureAuditEvidence}` : '',
        ], 4)
        : hasHealthcareOperations
        ? unique([
            hasRisingPatientIntake ? 'Confirmed: Patient-intake times are rising across two clinics.' : '',
            healthcareOperationalChange ? `Confirmed: ${healthcareOperationalChange}` : '',
            'Unknown: The clinics may not share the same root cause.',
        ], 3)
        : hasPublicSafetyAi
        ? unique([businessOutcome, hasFundedDeviceRefresh ? 'Device rollout: Next quarter' : timing, 'AI status: Interest only; no approved or scheduled pilot'], 3)
        : unique([businessOutcome, timing, constraint], 3);
    const decisionBullets = hasCloudAndStaffingAi
        ? unique([
            stakeholder ? `Sponsor and participants: ${stakeholder}` : '',
            requestedOutput ? `Requested artifact: ${requestedOutput}` : '',
            'Open: Authorized evidence owner, usable fields, success measure, and feasibility gate',
        ], 4)
        : hasModernizationPortfolio
        ? unique([
            stakeholder ? `Participants: ${stakeholder}` : '',
            requestedOutput ? `Requested artifact: ${requestedOutput}` : '',
            timing ? `Decision timing: ${timing}` : '',
            'Open: Purchasing jurisdiction, entity, and validated sourcing route',
        ], 4)
        : hasInfrastructureRefreshDecision
        ? unique([
            stakeholder ? `Participants: ${stakeholder}` : '',
            requestedOutput ? `Requested artifact: ${requestedOutput}` : '',
            hasBudgetReviewNextQuarter ? 'Budget decision: Next quarter' : '',
            prefersDeferralToNextYear ? 'Implementation preference: Defer to next year if evidence supports waiting' : '',
        ], 4)
        : hasHealthcareOperations
        ? unique([
            stakeholder ? `Audience: ${stakeholder}` : '',
            requestedOutput ? `Requested artifact: ${requestedOutput}` : '',
            timing ? `Decision timing: ${timing}` : 'Decision timing: Not confirmed',
        ], 4)
        : hasPublicSafetyAi
        ? unique([
            stakeholder ? `Participants: ${stakeholder}; agency security owner still required` : 'Participants: Agency security owner and operations owner still need validation roles',
            requestedOutput ? `Requested artifact: ${requestedOutput}` : '',
            'Open: CJIS/data boundary and agency AI policy',
        ], 4)
        : unique([stakeholder, requestedOutput ? `Requested artifact: ${requestedOutput}` : '', timing], 4);
    const evidenceSummary = hasCloudAndStaffingAi
        ? 'Separate confirmed business intent, visitor-identified evidence, stated exclusions, and specialist-validation requirements without inferring a public-safety environment or solution design.'
        : hasModernizationPortfolio
        ? 'Keep reported workstreams, funding, contract-path status, stakeholders, and timing separate; leave jurisdiction and eligibility unconfirmed until the responsible specialists validate them.'
        : hasInfrastructureRefreshDecision
        ? `Separate the confirmed refresh request${hasOutdatedFirmwareAudit ? ' and audit finding' : ''} from unvalidated ${infrastructureExposureLabel}, replacement scope${hasInfrastructureCostConcern ? ', cost' : ''}, and delay-risk claims.`
        : hasHealthcareOperations
        ? 'Keep confirmed operational facts, pending evidence, and unconfirmed hypotheses visibly separate.'
        : hasPublicSafetyAi
        ? 'Separate the funded device facts, unapproved AI interest, visitor-reported data labels, and specialist-validation requirements.'
        : 'Confirmed current-session evidence and operating boundaries—without filling gaps with assumptions.';
    const visualSlides: VisualSlide[] = [
        { id: 'executive_snapshot', eyebrow: '01 / Executive snapshot', title: visualTitle, summary: objective, bullets: executiveBullets.length ? executiveBullets : ['Discovery is in progress.'], boundary: slideBoundary },
        { id: 'decision_context', eyebrow: '02 / Decision context', title: 'What leadership needs to decide', summary: decisionFrame, bullets: decisionBullets.length ? decisionBullets : ['Decision ownership is still being clarified.'], boundary: slideBoundary },
        { id: 'evidence_and_constraints', eyebrow: '03 / Evidence and constraints', title: 'What the conversation supports', summary: evidenceSummary, bullets: evidenceAndConstraints.length ? evidenceAndConstraints : ['Environment and evidence sources are still being clarified.'], boundary: slideBoundary },
        { id: 'recommended_path', eyebrow: '04 / Recommended path', title: phases[0]?.title ?? 'Frame the next move', summary: roadmapOutcome, bullets: phases.slice(0, 3).map((phase) => `${phase.title}: ${phase.detail}`), boundary: slideBoundary },
        { id: 'validation_path', eyebrow: '05 / Validation path', title: 'A four-gate working path', summary: 'Move from evidence to a bounded decision without implying approval, production readiness, or completed validation.', bullets: phases.map((phase) => `${phase.number} ${phase.title}`), boundary: slideBoundary },
        { id: 'decisions_and_next_steps', eyebrow: '06 / Next decision', title: 'Leave with one credible next move', summary: nextStep, bullets: unique([decision, ...openQuestions.map((item) => `Clarify: ${item}`)], 5).length ? unique([decision, ...openQuestions.map((item) => `Clarify: ${item}`)], 5) : ['Confirm owners and the next decision gate.'], boundary: slideBoundary },
    ];

    return {
        status: userTurns.length ? 'live' : 'listening',
        lane,
        signalCount: facts.length,
        quality,
        facts,
        corrections,
        uncertainItems,
        brief: { objective, environment: environmentItems, priorities, discussionPoints, nextStep, openQuestions },
        roadmap: { title: currentTracks.length > 2 ? currentTracks.join(' + ') : dualTrack ? 'ERP cutover + municipal pre-scoping' : `${lane} path`, outcome: roadmapOutcome, facts: roadmapFacts, phases },
        visualBrief: { title: `${lane} working brief`, slides: visualSlides },
        catalog: {
            title: `${lane} solution categories`,
            summary: catalogQuery ? `Directional category context for: ${compact(catalogQuery, 120)}` : 'Directional categories aligned to the current conversation.',
            query: compact(catalogQuery, 120),
            categories: CATALOG[laneId],
            boundary: 'General solution categories only. Live Insight inventory, pricing, availability, lead time, and contract eligibility are not verified here.',
        },
    };
}
