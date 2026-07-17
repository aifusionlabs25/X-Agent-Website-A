export type AmyWorkbenchView = 'notes' | 'brief' | 'roadmap' | 'visual';

export interface AmyWorkbenchTurn {
    role: 'user' | 'agent';
    content: string;
}

interface WorkbenchNote {
    label: string;
    value: string;
}

interface WorkbenchPhase {
    number: string;
    title: string;
    detail: string;
}

export interface AmyWorkbenchModel {
    status: 'listening' | 'live';
    lane: string;
    signalCount: number;
    notes: WorkbenchNote[];
    brief: {
        objective: string;
        environment: string[];
        priorities: string[];
        nextStep: string;
        openQuestions: string[];
    };
    roadmap: {
        title: string;
        outcome: string;
        phases: WorkbenchPhase[];
    };
    visual: Array<{
        label: string;
        value: string;
        state: 'known' | 'open';
    }>;
}

export const AMY_WORKBENCH_BOUNDARY = 'Conversation working view only. Final scope, pricing, availability, timing, and commitments require confirmation by the appropriate Insight specialists.';

function clean(value: unknown): string {
    return String(value ?? '')
        .replace(/[\u2010-\u2015]/g, '-')
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[contact detail omitted]')
        .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, '[contact detail omitted]')
        .replace(/\s+/g, ' ')
        .trim();
}

function compact(value: string, max = 190): string {
    const normalized = clean(value).replace(/^[,.;:\s]+|[,.;:\s]+$/g, '');
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function unique(values: string[], limit = Infinity): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of values) {
        const value = compact(raw);
        const key = value.toLowerCase();
        if (!value || value === '[contact detail omitted]' || seen.has(key)) continue;
        seen.add(key);
        result.push(value);
        if (result.length >= limit) break;
    }
    return result;
}

function userText(turns: AmyWorkbenchTurn[]): string[] {
    return turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => clean(turn.content))
        .filter((value) => Boolean(value) && value !== '[contact detail omitted]');
}

function sentenceMatching(values: string[], pattern: RegExp): string {
    for (const value of [...values].reverse()) {
        const sentence = value
            .split(/(?<=[.!?])\s+/)
            .find((candidate) => pattern.test(candidate));
        if (sentence) return compact(sentence);
    }
    return '';
}

const TERM_RULES: Array<[RegExp, string]> = [
    [/\bMicrosoft 365 E5\b|\bM365 E5\b/i, 'Microsoft 365 E5'],
    [/\bWindows 11\b/i, 'Windows 11'],
    [/\bIntune\b/i, 'Intune'],
    [/\bSCCM\b|System Center Configuration Manager/i, 'SCCM'],
    [/\bAzure\b/i, 'Azure'],
    [/\bAWS\b|Amazon Web Services/i, 'AWS'],
    [/\bVMware\b/i, 'VMware'],
    [/\bSAP\b/i, 'SAP'],
    [/\bERP\b|enterprise resource planning/i, 'ERP'],
    [/\bWMS\b|warehouse management system/i, 'WMS'],
    [/\bManhattan(?: WMS)?\b/i, 'Manhattan WMS'],
    [/\bCisco Wi-?Fi\b/i, 'Cisco Wi-Fi'],
    [/\bZebra\b/i, 'Zebra'],
    [/\bHoneywell\b/i, 'Honeywell'],
    [/\bCrowdStrike\b/i, 'CrowdStrike'],
    [/\bCopilot\b/i, 'Copilot readiness'],
];

function mentionedTerms(text: string): string[] {
    return TERM_RULES
        .filter(([pattern]) => pattern.test(text))
        .map(([, label]) => label);
}

type LaneId = 'endpoint' | 'cloud' | 'security' | 'mobility' | 'public-sector' | 'general';

function detectLane(text: string): LaneId {
    const lanes: Array<[LaneId, RegExp]> = [
        ['public-sector', /county|municipal|city government|state agency|federal agency|public sector|higher education|K-?12|procurement|CJIS|FedRAMP|StateRAMP/i],
        ['mobility', /warehouse|WMS|rugged|scanner|forklift|Zebra|Honeywell|distribution center/i],
        ['endpoint', /endpoint|Windows 11|Intune|SCCM|Copilot|device refresh|laptops?/i],
        ['security', /security|cyber|ransomware|MFA|zero trust|CrowdStrike|recovery|backup/i],
        ['cloud', /Azure|AWS|VMware|hybrid cloud|data center|ERP|SAP|cloud migration/i],
    ];
    return lanes.find(([, pattern]) => pattern.test(text))?.[0] ?? 'general';
}

const ROADMAPS: Record<LaneId, Omit<AmyWorkbenchModel['roadmap'], 'outcome'> & { outcome: string }> = {
    endpoint: {
        title: 'Endpoint modernization path',
        outcome: 'Modernize endpoints through evidence-based readiness, a representative pilot, and controlled deployment waves.',
        phases: [
            { number: '01', title: 'Baseline', detail: 'Confirm device readiness, management posture, applications, security standards, and exceptions.' },
            { number: '02', title: 'Pilot', detail: 'Select representative users and validate the migration, support, and adoption experience.' },
            { number: '03', title: 'Deploy', detail: 'Use controlled waves aligned to business and operational constraints.' },
            { number: '04', title: 'Operate', detail: 'Track adoption, exceptions, lifecycle health, ownership, and support.' },
        ],
    },
    cloud: {
        title: 'Hybrid infrastructure path',
        outcome: 'Shape a phased modernization path that protects critical workloads and validates continuity requirements.',
        phases: [
            { number: '01', title: 'Discover', detail: 'Map workloads, dependencies, ownership, recovery posture, and business criticality.' },
            { number: '02', title: 'Design', detail: 'Compare viable target patterns and define decision and continuity guardrails.' },
            { number: '03', title: 'Pilot', detail: 'Validate a bounded workload with measurable acceptance and recovery criteria.' },
            { number: '04', title: 'Sequence', detail: 'Plan controlled later waves around dependencies, maintenance windows, and owners.' },
        ],
    },
    security: {
        title: 'Security readiness path',
        outcome: 'Turn the stated risks and control gaps into a validated and sequenced remediation plan.',
        phases: [
            { number: '01', title: 'Validate', detail: 'Confirm the current stack, findings, evidence requirements, and owners.' },
            { number: '02', title: 'Prioritize', detail: 'Separate urgent exposure reduction from foundational control work.' },
            { number: '03', title: 'Remediate', detail: 'Sequence identity, endpoint, recovery, and privileged-access improvements.' },
            { number: '04', title: 'Evidence', detail: 'Prepare review-ready status, dependencies, exceptions, and remaining decisions.' },
        ],
    },
    mobility: {
        title: 'Warehouse mobility path',
        outcome: 'Modernize the device and management experience while protecting warehouse throughput.',
        phases: [
            { number: '01', title: 'Observe', detail: 'Document workflows, devices, connectivity, applications, support, and peak constraints.' },
            { number: '02', title: 'Standardize', detail: 'Define representative device, management, security, and accessory patterns.' },
            { number: '03', title: 'Pilot', detail: 'Validate picking, receiving, roaming, charging, and support in a controlled location.' },
            { number: '04', title: 'Roll out', detail: 'Sequence sites around operating calendars, training, spares, and support ownership.' },
        ],
    },
    'public-sector': {
        title: 'Public-sector modernization path',
        outcome: 'Connect the mission outcome, technical sequence, governance, and an appropriate purchasing path.',
        phases: [
            { number: '01', title: 'Mission', detail: 'Define the public-service outcome, affected users, constraints, and urgency.' },
            { number: '02', title: 'Current state', detail: 'Map standards, partners, compliance drivers, dependencies, and ownership.' },
            { number: '03', title: 'Path', detail: 'Shape a phased technical and procurement-ready direction for review.' },
            { number: '04', title: 'Decision', detail: 'Clarify approvals, evidence, next decisions, and specialist support.' },
        ],
    },
    general: {
        title: 'Decision-ready working path',
        outcome: 'Turn the confirmed objective and constraints into a practical next decision.',
        phases: [
            { number: '01', title: 'Clarify', detail: 'Confirm the objective, current state, impact, owners, and success measures.' },
            { number: '02', title: 'Frame', detail: 'Identify viable paths, dependencies, risks, and evidence still needed.' },
            { number: '03', title: 'Validate', detail: 'Use a bounded review or pilot to test the preferred direction.' },
            { number: '04', title: 'Decide', detail: 'Confirm ownership, timing, next actions, and specialist involvement.' },
        ],
    },
};

const LANE_LABELS: Record<LaneId, string> = {
    endpoint: 'Endpoint modernization',
    cloud: 'Hybrid infrastructure modernization',
    security: 'Security readiness',
    mobility: 'Warehouse mobility modernization',
    'public-sector': 'Public-sector modernization',
    general: 'Enterprise discovery',
};

export function buildAmyWorkbenchModel(turns: AmyWorkbenchTurn[], roadmapTopic = ''): AmyWorkbenchModel {
    const userTurns = userText(turns);
    const allUserText = userTurns.join(' ');
    const planningText = clean(`${allUserText} ${roadmapTopic}`);
    const laneId = detectLane(planningText);
    const terms = unique(mentionedTerms(planningText), 8);

    const objective = sentenceMatching(userTurns, /need|want|trying|looking|goal|objective|moderni[sz]|replace|migrate|improve|protect|reduce|support/i)
        || compact(userTurns.at(-1) ?? 'The desired outcome is still being clarified.');
    const timing = sentenceMatching(userTurns, /timeline|timing|by (?:the )?(?:end|start)|next (?:year|quarter|month)|this (?:year|quarter|month)|within|before|early|late|maintenance window|peak season/i);
    const constraint = sentenceMatching(userTurns, /constraint|cannot|can't|must|critical|continuity|downtime|maintenance window|budget|security|compliance|risk|aging/i);
    const stakeholder = sentenceMatching(userTurns, /decision|stakeholder|CIO|CFO|CTO|director|vice president|VP|executive|procurement|leadership|owner/i);

    const notes: WorkbenchNote[] = [];
    if (userTurns.length && objective) notes.push({ label: 'Current objective', value: objective });
    if (terms.length) notes.push({ label: 'Environment signals', value: terms.join(' / ') });
    if (constraint) notes.push({ label: 'Constraint or risk', value: constraint });
    if (timing) notes.push({ label: 'Timing', value: timing });
    if (stakeholder) notes.push({ label: 'Stakeholder context', value: stakeholder });

    const openQuestions = unique([
        !objective || objective.includes('still being clarified') ? 'What outcome would make this initiative successful?' : '',
        !terms.length ? 'Which environment, workload, or platform is in scope?' : '',
        !constraint ? 'What constraint or risk should shape the approach?' : '',
        !timing ? 'What timing or operating window matters?' : '',
        !stakeholder ? 'Who should be involved in the next decision?' : '',
    ], 3);

    const roadmapTemplate = ROADMAPS[laneId];
    const roadmapOutcome = compact(roadmapTopic) || roadmapTemplate.outcome;
    const priorities = unique([
        constraint,
        timing,
        terms.length ? `Work within the current ${terms.slice(0, 3).join(', ')} environment.` : '',
    ], 4);
    const nextStep = openQuestions.length
        ? `Confirm ${openQuestions[0].replace(/^What |^Which |^Who /, '').replace(/\?$/, '').toLowerCase()}.`
        : 'Review the confirmed scope with the appropriate Insight specialist and agree on the next decision gate.';

    return {
        status: userTurns.length ? 'live' : 'listening',
        lane: LANE_LABELS[laneId],
        signalCount: notes.length,
        notes,
        brief: { objective, environment: terms, priorities, nextStep, openQuestions },
        roadmap: { title: roadmapTemplate.title, outcome: roadmapOutcome, phases: roadmapTemplate.phases },
        visual: [
            { label: 'Desired outcome', value: objective, state: objective.includes('still being clarified') ? 'open' : 'known' },
            { label: 'Current environment', value: terms.length ? terms.join(' / ') : 'Still to clarify', state: terms.length ? 'known' : 'open' },
            { label: 'Primary guardrail', value: constraint || 'Still to clarify', state: constraint ? 'known' : 'open' },
            { label: 'Next decision', value: nextStep, state: openQuestions.length ? 'open' : 'known' },
        ],
    };
}
