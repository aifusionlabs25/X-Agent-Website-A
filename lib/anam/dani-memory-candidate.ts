import { createHash } from 'node:crypto';
import { DANI_PERSONA_ID } from './persona-ids.ts';
import {
    DANI_AI_SOLUTIONS_VARIANT,
    normalizeAmyTranscript,
    transcriptSha256,
    type AmyAnamSessionReceipt,
    type AmyAnamSessionRecord,
    type AmyTranscriptTurn,
} from './session-spine.ts';
import {
    deriveDaniAnamMemoryCandidateDigest,
    sanitizeDaniAnamApprovedMemoryText,
    type DaniAnamMemoryCandidate,
} from './dani-user-memory.ts';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_ID_PATTERN = /^[a-f0-9]{32}$/;
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

type ClassificationRule = {
    id: string;
    label: string;
    pattern: RegExp;
    nextStep: string;
};

const TOPIC_RULES: ClassificationRule[] = [
    {
        id: 'workflow_automation',
        label: 'workflow automation',
        pattern: /\b(?:automat\w*|workflow|manual process|repetitive|handoff|back[ -]?office|process improvement)\b/i,
        nextStep: 'Map the current workflow, decision points, owners, and measurable bottlenecks.',
    },
    {
        id: 'virtual_agent',
        label: 'virtual-agent support',
        pattern: /\b(?:x[ -]?agent|virtual agent|digital human|voice agent|ai agent|chatbot|avatar|persona|anam)\b/i,
        nextStep: 'Define the agent audience, approved knowledge, escalation rules, and success measures.',
    },
    {
        id: 'sales_growth',
        label: 'sales and growth enablement',
        pattern: /\b(?:sales|lead|pipeline|prospect|crm|follow[ -]?up|marketing|conversion)\b/i,
        nextStep: 'Identify the highest-value funnel stage and the handoff that should remain human-owned.',
    },
    {
        id: 'customer_experience',
        label: 'customer experience',
        pattern: /\b(?:customer|support|service|inquir\w*|appointment|onboarding|faq)\b/i,
        nextStep: 'Prioritize the customer intents, service standard, and escalation path for a pilot.',
    },
    {
        id: 'data_reporting',
        label: 'data and reporting',
        pattern: /\b(?:data|report\w*|dashboard|analytics|spreadsheet|knowledge base|document workflow)\b/i,
        nextStep: 'Confirm the authoritative data sources, update frequency, and decisions the output must support.',
    },
    {
        id: 'meeting_collaboration',
        label: 'meeting and collaboration support',
        pattern: /\b(?:meeting|zoom|teams|google meet|agenda|minutes|meeting recap)\b/i,
        nextStep: 'Define participant consent, meeting boundaries, outputs, and the owner of each follow-up.',
    },
    {
        id: 'ai_strategy',
        label: 'AI solution discovery',
        pattern: /\b(?:strategy|roadmap|use case|ai readiness|pilot|proof of concept|poc|business problem)\b/i,
        nextStep: 'Rank the use cases by business value, feasibility, risk, and evidence needed for a pilot.',
    },
];

const CONSTRAINT_RULES: ClassificationRule[] = [
    {
        id: 'privacy_security',
        label: 'privacy, security, and consent',
        pattern: /\b(?:privacy|security|sensitive|compliance|permission|consent|confidential)\b/i,
        nextStep: 'Define data-handling, consent, access, retention, and human-review boundaries.',
    },
    {
        id: 'integration',
        label: 'integration with existing systems',
        pattern: /\b(?:integrat\w*|connect\w*|api|existing system|crm|erp|database)\b/i,
        nextStep: 'Inventory the systems, owners, permissions, and supported integration methods.',
    },
    {
        id: 'human_oversight',
        label: 'human review and handoff',
        pattern: /\b(?:human|approval|review|handoff|escalat\w*|supervision)\b/i,
        nextStep: 'Specify the decisions and exceptions that require a named human owner.',
    },
    {
        id: 'time',
        label: 'delivery timing',
        pattern: /\b(?:deadline|timeline|urgent|quickly|soon|launch date)\b/i,
        nextStep: 'Set a realistic pilot boundary, owner, decision date, and dependency list.',
    },
    {
        id: 'cost_value',
        label: 'cost and measurable value',
        pattern: /\b(?:budget|cost|price|roi|return on investment|payback)\b/i,
        nextStep: 'Establish the baseline cost and measurable value threshold before selecting technology.',
    },
    {
        id: 'quality',
        label: 'quality and reliability',
        pattern: /\b(?:accur\w*|quality|reliab\w*|hallucinat\w*|error rate)\b/i,
        nextStep: 'Define an evaluation set, acceptance threshold, and exception-review process.',
    },
];

const ARTIFACT_KEYS = new Set([
    'schemaVersion',
    'agent',
    'personaId',
    'externalSessionId',
    'jobId',
    'candidateDigest',
    'sourceReceiptId',
    'sourceTranscriptSha256',
    'sourceMessageCount',
    'summary',
    'inquiryType',
    'recommendedNextSteps',
    'rawTranscriptIncluded',
    'rawEmailIncluded',
    'promptTextIncluded',
    'automaticApproval',
]);

export type DaniAnamMemoryReviewArtifact = {
    schemaVersion: 'dani_anam_memory_review_candidate_v1';
    agent: 'dani';
    personaId: typeof DANI_PERSONA_ID;
    externalSessionId: string;
    jobId: string;
    candidateDigest: string;
    sourceReceiptId: string;
    sourceTranscriptSha256: string;
    sourceMessageCount: number;
    summary: string;
    inquiryType: string;
    recommendedNextSteps: string[];
    rawTranscriptIncluded: false;
    rawEmailIncluded: false;
    promptTextIncluded: false;
    automaticApproval: false;
};

function deriveJobId(input: {
    externalSessionId: string;
    receiptId: string;
    transcriptSha256: string;
    messageCount: number;
}): string {
    return createHash('sha256')
        .update([
            'xagent:dani:anam:memory:review-job:v1',
            input.externalSessionId,
            input.receiptId,
            input.transcriptSha256,
            String(input.messageCount),
        ].join('\0'), 'utf8')
        .digest('hex');
}

function userCorpus(turns: AmyTranscriptTurn[]): string {
    return turns
        .filter(turn => turn.role === 'user')
        .map(turn => turn.content.normalize('NFKC').toLowerCase())
        .join('\n');
}

function detectRules(corpus: string, rules: ClassificationRule[], limit: number): ClassificationRule[] {
    return rules.filter(rule => rule.pattern.test(corpus)).slice(0, limit);
}

function stageFor(corpus: string): { id: string; phrase: string } {
    if (/\b(?:deploy\w*|implement\w*|production|launch\w*|rollout)\b/i.test(corpus)) {
        return { id: 'implementation', phrase: 'planning implementation of' };
    }
    if (/\b(?:pilot|prototype|proof of concept|poc|test\w*|trial)\b/i.test(corpus)) {
        return { id: 'pilot', phrase: 'planning a pilot for' };
    }
    return { id: 'evaluation', phrase: 'evaluating' };
}

function joinLabels(labels: string[]): string {
    if (labels.length <= 1) return labels[0] ?? 'AI solution options';
    return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

function reviewCandidateFromArtifact(
    artifact: Pick<DaniAnamMemoryReviewArtifact,
        'externalSessionId' | 'jobId' | 'summary' | 'inquiryType' | 'recommendedNextSteps'>,
): DaniAnamMemoryCandidate {
    return {
        externalSessionId: artifact.externalSessionId,
        jobId: artifact.jobId,
        summary: artifact.summary,
        inquiryType: artifact.inquiryType,
        recommendedNextSteps: artifact.recommendedNextSteps,
    };
}

export function buildDaniAnamMemoryReviewCandidate(input: {
    session: AmyAnamSessionRecord;
    receipt: AmyAnamSessionReceipt;
    turns: AmyTranscriptTurn[] | unknown;
}): DaniAnamMemoryReviewArtifact {
    const { session, receipt } = input;
    const turns = normalizeAmyTranscript(input.turns);
    const sourceTranscriptSha256 = transcriptSha256(turns);

    if (
        session.schemaVersion !== 'amy_anam_session_v1'
        || session.provider !== 'anam'
        || session.agentSlug !== 'dani'
        || session.resolvedPersonaId !== DANI_PERSONA_ID
        || session.variant !== DANI_AI_SOLUTIONS_VARIANT
        || !['close_received', 'awaiting_transcript', 'completed'].includes(session.state)
        || !SAFE_SESSION_ID_PATTERN.test(session.externalSessionId)
    ) {
        throw new Error('Dani memory candidate session identity was invalid');
    }
    if (
        receipt.schemaVersion !== 'amy_anam_session_receipt_v1'
        || receipt.provider !== 'anam'
        || receipt.externalSessionId !== session.externalSessionId
        || receipt.variant !== DANI_AI_SOLUTIONS_VARIANT
        || receipt.status !== 'completed'
        || receipt.transcript.source !== 'anam_api'
        || receipt.transcript.rawTranscriptPersisted !== false
        || Object.values(receipt.actions).some(Boolean)
        || !RECEIPT_ID_PATTERN.test(receipt.receiptId)
    ) {
        throw new Error('Dani memory candidate receipt was not an exact final provider receipt');
    }
    if (
        !sourceTranscriptSha256
        || !SHA256_PATTERN.test(sourceTranscriptSha256)
        || sourceTranscriptSha256 !== receipt.transcript.contentSha256
        || turns.length !== receipt.transcript.messageCount
    ) {
        throw new Error('Dani memory candidate transcript did not match the final provider receipt');
    }

    const corpus = userCorpus(turns);
    if (corpus.replace(/\s+/g, '').length < 8) {
        throw new Error('Dani memory candidate had no durable user inquiry');
    }

    const topics = detectRules(corpus, TOPIC_RULES, 2);
    if (topics.length === 0) topics.push(TOPIC_RULES.at(-1) as ClassificationRule);
    const constraints = detectRules(corpus, CONSTRAINT_RULES, 2);
    const stage = stageFor(corpus);
    const topicLabels = topics.map(topic => topic.label);
    const constraintLabels = constraints.map(constraint => constraint.label);
    const prioritySentence = constraintLabels.length > 0
        ? ` Priorities detected were ${joinLabels(constraintLabels)}.`
        : '';
    const summary = sanitizeDaniAnamApprovedMemoryText(
        `The visitor is ${stage.phrase} ${joinLabels(topicLabels)}.${prioritySentence}`,
        600,
    );
    const inquiryType = sanitizeDaniAnamApprovedMemoryText(
        `${stage.id}: ${topicLabels.join(' + ')}`,
        160,
    );
    const recommendedNextSteps = [
        'Confirm the business outcome, accountable owner, and measurable success criteria.',
        topics[0].nextStep,
        constraints[0]?.nextStep,
    ]
        .filter((step): step is string => Boolean(step))
        .map(step => sanitizeDaniAnamApprovedMemoryText(step, 320))
        .filter((step, index, all) => Boolean(step) && all.indexOf(step) === index)
        .slice(0, 3);
    const jobId = deriveJobId({
        externalSessionId: session.externalSessionId,
        receiptId: receipt.receiptId,
        transcriptSha256: sourceTranscriptSha256,
        messageCount: turns.length,
    });
    const candidate: DaniAnamMemoryCandidate = {
        externalSessionId: session.externalSessionId,
        jobId,
        summary,
        inquiryType,
        recommendedNextSteps,
    };

    return {
        schemaVersion: 'dani_anam_memory_review_candidate_v1',
        agent: 'dani',
        personaId: DANI_PERSONA_ID,
        externalSessionId: session.externalSessionId,
        jobId,
        candidateDigest: deriveDaniAnamMemoryCandidateDigest(candidate),
        sourceReceiptId: receipt.receiptId,
        sourceTranscriptSha256,
        sourceMessageCount: turns.length,
        summary,
        inquiryType,
        recommendedNextSteps,
        rawTranscriptIncluded: false,
        rawEmailIncluded: false,
        promptTextIncluded: false,
        automaticApproval: false,
    };
}

export function assertDaniAnamMemoryReviewArtifact(value: unknown): DaniAnamMemoryReviewArtifact {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Dani memory review candidate was invalid');
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(key => !ARTIFACT_KEYS.has(key))) {
        throw new Error('Dani memory review candidate contained unsupported fields');
    }
    if (
        record.schemaVersion !== 'dani_anam_memory_review_candidate_v1'
        || record.agent !== 'dani'
        || record.personaId !== DANI_PERSONA_ID
        || typeof record.externalSessionId !== 'string'
        || !SAFE_SESSION_ID_PATTERN.test(record.externalSessionId)
        || typeof record.jobId !== 'string'
        || !SHA256_PATTERN.test(record.jobId)
        || typeof record.candidateDigest !== 'string'
        || !SHA256_PATTERN.test(record.candidateDigest)
        || typeof record.sourceReceiptId !== 'string'
        || !RECEIPT_ID_PATTERN.test(record.sourceReceiptId)
        || typeof record.sourceTranscriptSha256 !== 'string'
        || !SHA256_PATTERN.test(record.sourceTranscriptSha256)
        || !Number.isSafeInteger(record.sourceMessageCount)
        || Number(record.sourceMessageCount) < 1
        || typeof record.summary !== 'string'
        || !record.summary
        || record.summary !== sanitizeDaniAnamApprovedMemoryText(record.summary, 600)
        || typeof record.inquiryType !== 'string'
        || record.inquiryType !== sanitizeDaniAnamApprovedMemoryText(record.inquiryType, 160)
        || !Array.isArray(record.recommendedNextSteps)
        || record.recommendedNextSteps.length < 1
        || record.recommendedNextSteps.length > 3
        || record.recommendedNextSteps.some(step => (
            typeof step !== 'string'
            || !step
            || step !== sanitizeDaniAnamApprovedMemoryText(step, 320)
        ))
        || record.rawTranscriptIncluded !== false
        || record.rawEmailIncluded !== false
        || record.promptTextIncluded !== false
        || record.automaticApproval !== false
    ) {
        throw new Error('Dani memory review candidate was invalid');
    }

    const artifact = record as DaniAnamMemoryReviewArtifact;
    const expectedJobId = deriveJobId({
        externalSessionId: artifact.externalSessionId,
        receiptId: artifact.sourceReceiptId,
        transcriptSha256: artifact.sourceTranscriptSha256,
        messageCount: artifact.sourceMessageCount,
    });
    const expectedDigest = deriveDaniAnamMemoryCandidateDigest(
        reviewCandidateFromArtifact(artifact),
    );
    if (artifact.jobId !== expectedJobId || artifact.candidateDigest !== expectedDigest) {
        throw new Error('Dani memory review candidate digest or job identity did not match');
    }
    return artifact;
}
