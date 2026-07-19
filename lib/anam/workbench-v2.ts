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
    return /\b(?:not sure|might be|could be|possibly|perhaps|I think|I may have|did you say|I heard)\b/i.test(value);
}

function statementsFrom(values: string[]): string[] {
    return values.flatMap((value) => value
        .split(/(?<=[.!?])\s+/)
        .map((statement) => compact(statement))
        .filter(Boolean));
}

function isWorkbenchRequest(value: string): boolean {
    return /\b(?:please\s+)?(?:show|open|display|leave|keep|pull up|build and show|capture)\b.*\b(?:notes?|brief|roadmap|visual|catalog|status)\b/i.test(value)
        || /\bdo you have a visual\b/i.test(value);
}

function isConversationControl(value: string): boolean {
    return /^(?:thanks?|thank you|yes,? please|no|not right(?: now)?|maybe later|sure|partially|for now)\.?$/i.test(value.trim());
}

function requestedOutputsFrom(values: string[], trackCount: number): string[] {
    const text = values.join(' ');
    return unique([
        /\blive notes?\b/i.test(text) ? 'Live notes' : '',
        /\blive brief\b/i.test(text) ? 'Live brief' : '',
        /\broadmap\b/i.test(text) ? (trackCount > 1 ? `${trackCount}-track roadmap` : 'Roadmap') : '',
        /\bvisual(?: brief)?\b/i.test(text) ? 'Visual brief' : '',
        /\bcatalog\b/i.test(text) ? 'Solution catalog' : '',
    ], 5);
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
    [/\bMicrosoft 365 E5\b/i, 'Microsoft 365 E5'],
    [/\bWindows 11\b/i, 'Windows 11'],
    [/\bIntune\b/i, 'Intune'],
    [/\bSCCM\b/i, 'SCCM'],
    [/\bMDM\b/i, 'MDM'],
    [/\bAzure\b/i, 'Azure'],
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

type LaneId = 'endpoint' | 'cloud' | 'security' | 'mobility' | 'public-sector' | 'general';

const LANE_LABELS: Record<LaneId, string> = {
    endpoint: 'Endpoint modernization',
    cloud: 'Hybrid infrastructure modernization',
    security: 'Security readiness',
    mobility: 'Warehouse mobility modernization',
    'public-sector': 'Public-sector modernization',
    general: 'Enterprise discovery',
};

function detectLane(text: string): LaneId {
    const scores: Array<[LaneId, RegExp[]]> = [
        ['public-sector', [/county|municipal|city government|state agency|federal agency|public sector|higher education|K-?12/i, /procurement|contract vehicle|CJIS|FedRAMP|StateRAMP/i]],
        ['mobility', [/warehouse|distribution center|picking|outbound shipping/i, /WMS|rugged|scanner|forklift|Zebra|Honeywell|MDM/i]],
        ['endpoint', [/endpoint|Windows 11|Intune|SCCM|Copilot|device refresh|laptops?/i, /clinic|branch|workplace/i]],
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

function buildPhases(lane: LaneId, context: { scale: string; terms: string[]; constraint: string; timing: string; workloads: string[]; dualTrack: boolean }): WorkbenchPhase[] {
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
}): string[] {
    return [
        input.hasErpCutover ? 'ERP cutover' : '',
        input.hasArizonaSvar
            ? 'Arizona SVAR procurement pre-scoping'
            : input.hasMunicipalPrescoping ? 'Municipal compliance pre-scoping' : '',
        input.hasAiDiscovery ? 'AI discovery' : '',
    ].filter(Boolean);
}

function buildMultiTrackPhases(tracks: string[]): WorkbenchPhase[] {
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
        detail: 'Prioritize runbooks, technical-document search, telemetry analysis, and an internal IT assistant; validate data access, agency AI policy, identity controls, human review, hosting, and measurable outcomes.',
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

export function buildAmyWorkbenchModel(turns: AmyWorkbenchTurn[], roadmapTopic = '', catalogQuery = ''): AmyWorkbenchModel {
    const userTurns = turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => canonical(turn.content))
        .filter((value) => value && value !== CONTACT_OMITTED);
    const statements = statementsFrom(userTurns);
    const corrections = readCorrections(userTurns);
    const rejected = new Set(corrections.map((item) => canonical(item.from).toLowerCase()));
    const certainStatements = statements.filter((value) => !isUncertain(value));
    const substantiveStatements = certainStatements.filter((value) => !isWorkbenchRequest(value) && !isConversationControl(value));
    const sourceText = canonical(`${certainStatements.join(' ')} ${roadmapTopic}`);
    const hasErpCutover = /\bERP\b/i.test(sourceText) && /cutover|overnight outage|maintenance window/i.test(sourceText);
    const hasMunicipalPrescoping = /municipal|government subcontract|prime(?:-contractor)? flow-down|pre-?scoping/i.test(sourceText);
    const hasArizonaSvar = /\bSVAR\b/i.test(sourceText) && /Arizona|state agency|state of Arizona/i.test(sourceText);
    const hasAiDiscovery = /\bAI\b|artificial intelligence|runbook automation|migration runbooks?|technical document(?:ation)? search|analy[sz](?:e|ing) telemetry|internal (?:IT )?assistant/i.test(sourceText);
    const currentTracks = buildCurrentTracks({ hasErpCutover, hasMunicipalPrescoping, hasArizonaSvar, hasAiDiscovery });
    const multiTrack = currentTracks.length > 1;
    const dualTrack = hasErpCutover && hasMunicipalPrescoping;
    const uncertainItems = unique(statements.filter(isUncertain).map((value) => {
        if (/not sure/i.test(value) && /compliance|framework|prime|flow/i.test(sourceText)) return 'Applicable compliance framework is not yet known; prime-contractor flow-down is pending.';
        if (/^not sure\.?$/i.test(value)) return '';
        return compact(value, 150);
    }), 4);
    const allText = sourceText;
    const terms = termsFrom(certainStatements, rejected);
    for (const correction of corrections) {
        for (const [, label] of TERM_RULES) {
            if (canonical(correction.to).toLowerCase().includes(label.toLowerCase()) && !terms.includes(label)) terms.push(label);
        }
    }
    const laneId = detectLane(allText);
    const lane = hasErpCutover && hasArizonaSvar && hasAiDiscovery
        ? 'Azure ERP, Arizona SVAR, and AI discovery'
        : dualTrack ? 'Azure ERP and municipal compliance planning' : LANE_LABELS[laneId];
    const scale = extractScale(allText);
    const objective = hasErpCutover && hasArizonaSvar && hasAiDiscovery
        ? 'Plan three distinct tracks: protect the ERP cutover within a tight overnight outage window; clarify the Arizona SVAR software purchasing path without treating it as compliance; and scope AI opportunities for runbooks, technical-document search, telemetry analysis, and an internal IT assistant.'
        : dualTrack
        ? 'Plan two separate workstreams: protect the ERP cutover within a tight overnight outage window, and pre-scope municipal compliance while awaiting prime-contractor flow-down.'
        : lastSentence(substantiveStatements, /need|want|trying|looking|goal|objective|moderni[sz]|replace|migrate|improve|protect|reduce|support|roadmap|assessment/i)
        || (certainStatements.length ? 'The desired outcome is still being clarified.' : 'Waiting for the conversation to begin.');
    const timing = dualTrack && /few weeks/i.test(allText)
        ? 'Detailed planning may begin in a few weeks, dependent on compliance clarification from the prime contractor.'
        : lastSentence(substantiveStatements, /timeline|timing|\d+[ -]?(?:day|week|month)|next (?:year|quarter|month)|this (?:year|quarter|month)|within|before|early|late|maintenance window|peak season/i);
    const constraint = dualTrack
        ? 'Protect the tight overnight ERP cutover window; do not assume a compliance framework until the prime contractor provides flow-down requirements.'
        : lastSentence(substantiveStatements, /constraint|cannot|can't|must|critical|continuity|downtime|maintenance window|budget|security|compliance|risk|aging|disruption|rollback/i);
    const stakeholder = lastSentence(substantiveStatements, /decision|stakeholder|CIO|CFO|CTO|director|vice president|VP|executive|procurement|leadership|owner/i);
    const organization = hasArizonaSvar
        ? 'State of Arizona agency; Arizona SVAR purchasing path raised for specialist validation.'
        : lastSentence(substantiveStatements, /county|city|agency|company|firm|hospital|health system|manufactur|distribution|university|school district/i);
    const workloads = unique([
        /customer portal/i.test(allText) ? 'Customer portal' : '',
        /\bERP\b/i.test(allText) ? 'ERP' : '',
        /\bSAP\b/i.test(allText) ? 'SAP' : '',
        /Manhattan WMS|\bWMS\b/i.test(allText) ? 'Warehouse management system' : '',
        /manufacturing execution systems?|\bMES\b/i.test(allText) ? 'Manufacturing execution systems' : '',
        /citizen services?|public portal/i.test(allText) ? 'Citizen services' : '',
    ], 5);
    const compliance = unique([
        /\bNIST\b/i.test(allText) ? 'NIST' : '',
        /\bHIPAA\b/i.test(allText) ? 'HIPAA' : '',
        /\bCJIS\b/i.test(allText) ? 'CJIS' : '',
        /FedRAMP/i.test(allText) ? 'FedRAMP' : '',
        /StateRAMP/i.test(allText) ? 'StateRAMP' : '',
    ], 5);
    const requestedOutputs = requestedOutputsFrom(userTurns, currentTracks.length);
    const requestedOutput = requestedOutputs.join(' / ');
    const decision = lastSentence(substantiveStatements, /we decided|we selected|we will proceed|the decision is/i);

    const facts = [
        makeFact('Organization', 'Context', organization),
        makeFact('Scale', 'Environment scale', scale),
        makeFact('Environment', 'Technology context', terms.join(' / ')),
        makeFact('Environment', 'Critical workloads', workloads.join(' / ')),
        makeFact('Priorities', 'Current objective', objective.includes('still being clarified') || objective.startsWith('Waiting') ? '' : objective),
        makeFact('Priorities', 'AI discovery', hasAiDiscovery ? 'Runbooks, technical-document search, telemetry analysis, and an internal IT assistant remain a separate discovery track.' : ''),
        makeFact('Procurement', 'Arizona SVAR', hasArizonaSvar ? 'Software Value-Added Reseller purchasing contract; confirm software category, purchaser, and ordering path with an Insight Public Sector specialist.' : ''),
        makeFact('Constraints', 'Primary guardrail', constraint),
        makeFact('Constraints', 'Governance drivers', compliance.join(' / ')),
        makeFact('Timing', 'Timing', timing),
        makeFact('Identity', 'Stakeholder context', stakeholder),
        makeFact('Requested outputs', 'Requested output', requestedOutput),
        makeFact('Decisions', 'Decision', decision),
    ].filter((fact): fact is AmyWorkbenchFact => Boolean(fact));

    const openQuestions = unique([
        hasAiDiscovery ? 'What data would each AI use case access, and could agency or contract-controlled information enter prompts?' : '',
        hasAiDiscovery ? 'What agency AI policy, human-review, hosting, identity, and measurable-outcome requirements apply?' : '',
        hasArizonaSvar ? 'Who will purchase through SVAR-the agency, the prime contractor, or another eligible entity?' : '',
        objective.includes('still being clarified') || objective.startsWith('Waiting') ? 'What outcome would make this initiative successful?' : '',
        !terms.length ? 'Which environment, workload, or platform is in scope?' : '',
        !constraint ? 'What constraint or risk should shape the approach?' : '',
        !timing ? 'What timing or operating window matters?' : '',
        !stakeholder ? 'Who should be involved in the next decision?' : '',
        ...uncertainItems.map((item) => `Please clarify: ${item}`),
    ], 4);
    const priorities = unique([
        multiTrack ? `Keep ${currentTracks.join(', ')} as separate workstreams.` : '',
        hasArizonaSvar ? 'Treat Arizona SVAR as a software purchasing path, not a compliance approval process.' : '',
        constraint,
        timing,
        compliance.length ? `Account for ${compliance.join(', ')}.` : '',
        terms.length ? `Work with the existing ${terms.slice(0, 4).join(', ')} environment.` : '',
    ], 5);
    const nextStep = multiTrack
        ? `Confirm separate owners and decision gates for ${currentTracks.join(', ')}, including Insight Public Sector review of the SVAR ordering path.`
        : openQuestions.length
        ? `Clarify ${openQuestions[0].replace(/^What |^Which |^Who |^Please clarify:\s*/i, '').replace(/\?$/, '').toLowerCase()}.`
        : 'Review the confirmed scope with the appropriate Insight specialist and agree on the next decision gate.';
    const roadmapFacts = facts
        .filter((fact) => ['Scale', 'Environment', 'Constraints', 'Timing', 'Requested outputs'].includes(fact.section))
        .map((fact) => ({ label: fact.label, value: fact.value }));
    const phases = currentTracks.length > 2
        ? buildMultiTrackPhases(currentTracks)
        : buildPhases(laneId, { scale, terms, constraint, timing, workloads, dualTrack });
    const roadmapOutcome = currentTracks.length > 2
        ? `Develop ${currentTracks.length} coordinated but independently gated tracks: ${currentTracks.join(', ')}.`
        : dualTrack
        ? 'Develop two coordinated but independently gated paths: ERP cutover readiness and municipal compliance pre-scoping.'
        : compact(roadmapTopic) || ({
        endpoint: 'Create a measured endpoint modernization path with representative pilots and controlled deployment waves.',
        cloud: 'Shape a phased modernization path that protects critical workloads and validates continuity requirements.',
        security: 'Turn the stated risks and control gaps into a validated and sequenced remediation plan.',
        mobility: 'Modernize warehouse mobility while protecting picking, shipping, and peak-season throughput.',
        'public-sector': 'Connect the mission outcome, technical sequence, governance, and an appropriate purchasing path.',
        general: 'Turn the confirmed objective and constraints into a practical next decision.',
    } satisfies Record<LaneId, string>)[laneId];

    const discussionPoints = unique(facts.map((fact) => `${fact.label}: ${fact.value}`), 12);
    const slideBoundary = 'Working view based on the conversation so far; specialist validation is still required.';
    const visualSlides: VisualSlide[] = [
        { id: 'executive_snapshot', eyebrow: '01 / Executive snapshot', title: lane, summary: objective, bullets: unique([scale, constraint, timing], 3).length ? unique([scale, constraint, timing], 3) : ['Discovery is in progress.'], boundary: slideBoundary },
        { id: 'what_we_heard', eyebrow: '02 / What we heard', title: 'Current-session signals', summary: 'A concise view of stated facts, excluding contact details and uncertain language.', bullets: discussionPoints.length ? discussionPoints.slice(0, 6) : ['No substantive session signals yet.'], boundary: slideBoundary },
        { id: 'environment_and_constraints', eyebrow: '03 / Environment', title: 'Platforms and guardrails', summary: 'The current environment and constraints shaping a viable path.', bullets: unique([terms.join(' / '), workloads.join(' / '), compliance.join(' / '), constraint], 6).length ? unique([terms.join(' / '), workloads.join(' / '), compliance.join(' / '), constraint], 6) : ['Environment details are still being clarified.'], boundary: slideBoundary },
        { id: 'recommended_path', eyebrow: '04 / Direction', title: 'Recommended planning approach', summary: roadmapOutcome, bullets: phases.slice(0, 3).map((phase) => `${phase.title}: ${phase.detail}`), boundary: slideBoundary },
        { id: 'phased_roadmap', eyebrow: '05 / Roadmap', title: 'Four-stage working path', summary: 'A phased sequence to validate decisions before broader rollout.', bullets: phases.map((phase) => `${phase.number} ${phase.title}`), boundary: slideBoundary },
        { id: 'decisions_and_next_steps', eyebrow: '06 / Decisions', title: 'Next decision', summary: nextStep, bullets: unique([decision, ...openQuestions.map((item) => `Clarify: ${item}`)], 5).length ? unique([decision, ...openQuestions.map((item) => `Clarify: ${item}`)], 5) : ['Confirm owners and the next decision gate.'], boundary: slideBoundary },
    ];

    return {
        status: userTurns.length ? 'live' : 'listening',
        lane,
        signalCount: facts.length,
        facts,
        corrections,
        uncertainItems,
        brief: { objective, environment: terms, priorities, discussionPoints, nextStep, openQuestions },
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
