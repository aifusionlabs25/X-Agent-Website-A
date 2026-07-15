import { createHash } from 'node:crypto';
import {
    AMY_ANAM_MAX_TRANSCRIPT_CHARACTERS,
    AMY_ANAM_MAX_TRANSCRIPT_TURNS,
    AMY_ANAM_RECORD_TTL_SECONDS,
} from './session-spine.ts';
import type {
    AmyAnamSessionReceipt,
    AmyAnamSessionRecord,
    AmyTranscriptTurn,
} from './session-spine.ts';

export const AMY_ANAM_HERMES_SHADOW_POINTER_VERSION = 'amy_anam_hermes_shadow_pointer_v1';
export const AMY_ANAM_HERMES_SHADOW_OUTPUT_VERSION = 'amy_anam_hermes_shadow_output_v1';
export const AMY_ANAM_HERMES_SHADOW_RECEIPT_VERSION = 'amy_anam_hermes_shadow_receipt_v1';
export const AMY_ANAM_HERMES_SHADOW_MAX_REDACTED_CHARACTERS = 48_000;
export const AMY_ANAM_HERMES_SHADOW_MAX_OUTPUT_BYTES = 64 * 1024;

const DEFAULT_LEASE_SECONDS = 180;
const DEFAULT_MAX_ATTEMPTS = 3;
const MIN_QUEUE_TTL_SECONDS = AMY_ANAM_RECORD_TTL_SECONDS;
const MAX_QUEUE_TTL_SECONDS = 14 * 24 * 60 * 60;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/;

export type AmyAnamHermesShadowMode = 'off' | 'shadow';

export type AmyAnamHermesShadowConfig = {
    enabled: boolean;
    mode: AmyAnamHermesShadowMode;
    killSwitchActive: boolean;
    tripleGateOpen: boolean;
    queueConfigured: boolean;
    gatesOpen: boolean;
    redisUrl: string;
    redisToken: string;
    ttlSeconds: number;
    leaseSeconds: number;
    maxAttempts: number;
};

export type AmyAnamHermesShadowPointer = {
    schemaVersion: typeof AMY_ANAM_HERMES_SHADOW_POINTER_VERSION;
    jobId: string;
    provider: 'anam';
    agentSlug: 'amy';
    externalSessionId: string;
    receiptId: string;
    expectedMessageCount: number;
    expectedTranscriptSha256: string;
    enqueuedAt: string;
    postSessionOnly: true;
};

export type AmyAnamHermesShadowRisks = {
    repeatedQuestion: boolean;
    unsupportedClaim: boolean;
    pricingOrInventoryClaim: boolean;
    technicalTerm: boolean;
    privacy: boolean;
};

export type AmyAnamHermesShadowOutput = {
    schema_version: typeof AMY_ANAM_HERMES_SHADOW_OUTPUT_VERSION;
    summary: string;
    inquiry_type: string;
    recommended_next_steps: string[];
    needs_human_review: boolean;
    quality_review: {
        repeated_question_risk: boolean;
        unsupported_claim_risk: boolean;
        pricing_or_inventory_claim_risk: boolean;
        technical_term_risk: boolean;
        privacy_risk: boolean;
    };
    safety: {
        shadow_only: true;
        tools_called: 0;
        emails_sent: 0;
        memory_writes: 0;
        outbound_actions: 0;
    };
};

export type AmyAnamHermesShadowReceiptStatus =
    | 'queued'
    | 'leased'
    | 'retry_scheduled'
    | 'completed'
    | 'dead_letter';

export type AmyAnamHermesShadowFailureCode =
    | 'session_record_invalid'
    | 'provider_identity_mismatch'
    | 'transcript_not_ready'
    | 'transcript_integrity_mismatch'
    | 'hermes_timeout'
    | 'hermes_execution_failed'
    | 'output_contract_invalid'
    | 'local_output_failed';

export type AmyAnamHermesShadowReceipt = {
    schemaVersion: typeof AMY_ANAM_HERMES_SHADOW_RECEIPT_VERSION;
    jobId: string;
    externalSessionId: string;
    status: AmyAnamHermesShadowReceiptStatus;
    attempts: number;
    updatedAt: string;
    nextAttemptAt: string | null;
    failureCode: AmyAnamHermesShadowFailureCode | null;
    hermesExecutionHappened: boolean;
    outputContractValid: boolean;
    outputSha256: string | null;
    risks: AmyAnamHermesShadowRisks | null;
    toolsetRestricted: true;
    toolsCalled: 0;
    emailsSent: 0;
    memoryWrites: 0;
    outboundActions: 0;
    rawTranscriptPersisted: false;
    redactedTranscriptPersisted: false;
    generatedContentPersistedInCloud: false;
    contentIncluded: false;
};

function envValue(source: NodeJS.ProcessEnv, name: string): string {
    return String(source[name] ?? '')
        .trim()
        .replace(/^(?:\uFEFF|\u00EF\u00BB\u00BF|\u00C3\u00AF\u00C2\u00BB\u00C2\u00BF)+/, '')
        .replace(/(?:\\r|\\n)+$/, '')
        .trim();
}

function boundedInteger(value: string, fallback: number, minimum: number, maximum: number): number {
    const parsed = Number(value || fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedNonEmptyString(value: unknown, maximum: number, field: string): string {
    if (typeof value !== 'string') throw new Error(`${field} must be a string`);
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > maximum) {
        throw new Error(`${field} exceeded its safety bound`);
    }
    return normalized;
}

export function readAmyAnamHermesShadowConfig(
    source: NodeJS.ProcessEnv = process.env,
): AmyAnamHermesShadowConfig {
    const requestedMode = (envValue(source, 'AMY_ANAM_HERMES_SHADOW_MODE') || 'off').toLowerCase();
    if (requestedMode !== 'off' && requestedMode !== 'shadow') {
        throw new Error('AMY_ANAM_HERMES_SHADOW_MODE must be off or shadow');
    }

    const mode = requestedMode as AmyAnamHermesShadowMode;
    const enabled = envValue(source, 'AMY_ANAM_HERMES_SHADOW_ENABLED') === 'true';
    const killSwitchActive = envValue(source, 'AMY_ANAM_HERMES_SHADOW_KILL_SWITCH') !== 'false';
    const redisUrl = envValue(source, 'AMY_ANAM_REDIS_REST_URL').replace(/\/$/, '');
    const redisToken = envValue(source, 'AMY_ANAM_REDIS_REST_TOKEN');
    const ttlSeconds = boundedInteger(
        envValue(source, 'AMY_ANAM_HERMES_SHADOW_TTL_SECONDS'),
        AMY_ANAM_RECORD_TTL_SECONDS,
        MIN_QUEUE_TTL_SECONDS,
        MAX_QUEUE_TTL_SECONDS,
    );
    const leaseSeconds = boundedInteger(
        envValue(source, 'AMY_ANAM_HERMES_SHADOW_LEASE_SECONDS'),
        DEFAULT_LEASE_SECONDS,
        30,
        15 * 60,
    );
    const maxAttempts = boundedInteger(
        envValue(source, 'AMY_ANAM_HERMES_SHADOW_MAX_ATTEMPTS'),
        DEFAULT_MAX_ATTEMPTS,
        1,
        8,
    );
    const tripleGateOpen = enabled && !killSwitchActive && mode === 'shadow';
    const queueConfigured = Boolean(redisUrl && redisToken);

    return {
        enabled,
        mode,
        killSwitchActive,
        tripleGateOpen,
        queueConfigured,
        gatesOpen: tripleGateOpen && queueConfigured,
        redisUrl,
        redisToken,
        ttlSeconds,
        leaseSeconds,
        maxAttempts,
    };
}

export function createAmyAnamHermesShadowPointer(input: {
    session: AmyAnamSessionRecord;
    receipt: AmyAnamSessionReceipt;
    now?: number;
}): AmyAnamHermesShadowPointer {
    const { session, receipt } = input;
    if (
        session.schemaVersion !== 'amy_anam_session_v1'
        || session.provider !== 'anam'
        || session.agentSlug !== 'amy'
        || session.externalSessionId !== receipt.externalSessionId
        || !SESSION_ID_PATTERN.test(session.externalSessionId)
    ) {
        throw new Error('Amy Anam session identity is invalid for Hermes shadow');
    }
    if (
        receipt.schemaVersion !== 'amy_anam_session_receipt_v1'
        || receipt.provider !== 'anam'
        || receipt.status !== 'completed'
        || receipt.transcript.source !== 'anam_api'
        || !Number.isInteger(receipt.transcript.messageCount)
        || receipt.transcript.messageCount < 1
        || receipt.transcript.messageCount > AMY_ANAM_MAX_TRANSCRIPT_TURNS
        || !receipt.transcript.contentSha256
        || !SHA256_PATTERN.test(receipt.transcript.contentSha256)
        || receipt.transcript.rawTranscriptPersisted !== false
        || Object.values(receipt.actions).some(Boolean)
    ) {
        throw new Error('Amy Anam authoritative receipt is not eligible for Hermes shadow');
    }

    const jobId = createHash('sha256')
        .update(`amy:anam:hermes-shadow:v1:${session.externalSessionId}:${receipt.transcript.contentSha256}`)
        .digest('hex');

    return {
        schemaVersion: AMY_ANAM_HERMES_SHADOW_POINTER_VERSION,
        jobId,
        provider: 'anam',
        agentSlug: 'amy',
        externalSessionId: session.externalSessionId,
        receiptId: receipt.receiptId,
        expectedMessageCount: receipt.transcript.messageCount,
        expectedTranscriptSha256: receipt.transcript.contentSha256,
        enqueuedAt: new Date(input.now ?? Date.now()).toISOString(),
        postSessionOnly: true,
    };
}

export function normalizeAmyAnamHermesShadowPointer(
    value: unknown,
): AmyAnamHermesShadowPointer {
    if (!isRecord(value) || !exactKeys(value, [
        'schemaVersion',
        'jobId',
        'provider',
        'agentSlug',
        'externalSessionId',
        'receiptId',
        'expectedMessageCount',
        'expectedTranscriptSha256',
        'enqueuedAt',
        'postSessionOnly',
    ])) {
        throw new Error('Hermes shadow pointer has an invalid shape');
    }
    if (
        value.schemaVersion !== AMY_ANAM_HERMES_SHADOW_POINTER_VERSION
        || !SHA256_PATTERN.test(String(value.jobId ?? ''))
        || value.provider !== 'anam'
        || value.agentSlug !== 'amy'
        || !SESSION_ID_PATTERN.test(String(value.externalSessionId ?? ''))
        || typeof value.receiptId !== 'string'
        || value.receiptId.length < 16
        || value.receiptId.length > 128
        || !Number.isInteger(value.expectedMessageCount)
        || Number(value.expectedMessageCount) < 1
        || Number(value.expectedMessageCount) > AMY_ANAM_MAX_TRANSCRIPT_TURNS
        || !SHA256_PATTERN.test(String(value.expectedTranscriptSha256 ?? ''))
        || typeof value.enqueuedAt !== 'string'
        || !Number.isFinite(Date.parse(value.enqueuedAt))
        || value.postSessionOnly !== true
    ) {
        throw new Error('Hermes shadow pointer failed validation');
    }

    return value as AmyAnamHermesShadowPointer;
}

export function normalizeAmyAnamSessionRecordForHermes(
    value: unknown,
    expectedSessionId: string,
): AmyAnamSessionRecord {
    if (!isRecord(value)) throw new Error('Amy Anam session record is missing');
    if (
        value.schemaVersion !== 'amy_anam_session_v1'
        || value.provider !== 'anam'
        || value.agentSlug !== 'amy'
        || value.externalSessionId !== expectedSessionId
        || value.state !== 'completed'
        || typeof value.clientLabel !== 'string'
        || !value.clientLabel.trim()
        || typeof value.resolvedPersonaId !== 'string'
        || !value.resolvedPersonaId.trim()
        || typeof value.createdAt !== 'string'
        || !Number.isFinite(Date.parse(value.createdAt))
    ) {
        throw new Error('Amy Anam session record is not an authoritative completed record');
    }
    return value as AmyAnamSessionRecord;
}

export function redactAmyAnamTranscriptInMemory(turns: AmyTranscriptTurn[]): string {
    if (!Array.isArray(turns) || turns.length < 1 || turns.length > AMY_ANAM_MAX_TRANSCRIPT_TURNS) {
        throw new Error('Amy Anam transcript is outside the shadow safety bounds');
    }
    let totalCharacters = 0;
    const lines: string[] = [];
    for (const turn of turns) {
        if (
            !turn
            || (turn.role !== 'user' && turn.role !== 'agent')
            || typeof turn.content !== 'string'
            || !turn.content.trim()
        ) {
            throw new Error('Amy Anam transcript turn is invalid');
        }
        totalCharacters += turn.content.length;
        if (totalCharacters > AMY_ANAM_MAX_TRANSCRIPT_CHARACTERS) {
            throw new Error('Amy Anam transcript exceeded the source safety bound');
        }
        lines.push(`${turn.role === 'user' ? 'USER' : 'AMY'}: ${turn.content.trim()}`);
    }

    return lines.join('\n')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
        .replace(/\b[a-z0-9._%+-]+\s+(?:at)\s+[a-z0-9.-]+(?:\s+dot\s+|\.)[a-z]{2,}\b/gi, '[email redacted]')
        .replace(/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone redacted]')
        .replace(/\b(?:sk|pk|am)_[A-Za-z0-9_-]{12,}\b/g, '[token redacted]')
        .slice(0, AMY_ANAM_HERMES_SHADOW_MAX_REDACTED_CHARACTERS);
}

export function buildAmyAnamHermesShadowPrompt(redactedTranscript: string): string {
    const transcript = String(redactedTranscript ?? '').trim();
    if (!transcript || transcript.length > AMY_ANAM_HERMES_SHADOW_MAX_REDACTED_CHARACTERS) {
        throw new Error('Redacted transcript is missing or too large');
    }

    return `You are Amy's post-session shadow analyst. This is analysis only.

Hard safety rules:
- Do not call or request tools, browse, send email, update CRM, schedule anything, or write memory.
- Do not claim any external action happened.
- Treat uncertain technical terms as uncertain. Do not invent pricing, inventory, compliance, delivery, or procurement facts.
- Return JSON only. Do not use markdown fences and do not include the transcript, prompts, secrets, identifiers, or contact details.

Return exactly this shape:
{"schema_version":"${AMY_ANAM_HERMES_SHADOW_OUTPUT_VERSION}","summary":"factual summary","inquiry_type":"short category","recommended_next_steps":["operator-review suggestion"],"needs_human_review":false,"quality_review":{"repeated_question_risk":false,"unsupported_claim_risk":false,"pricing_or_inventory_claim_risk":false,"technical_term_risk":false,"privacy_risk":false},"safety":{"shadow_only":true,"tools_called":0,"emails_sent":0,"memory_writes":0,"outbound_actions":0}}

REDACTED TRANSCRIPT (analyze in memory only):
${transcript}`;
}

export function parseAmyAnamHermesShadowOutput(stdout: unknown): AmyAnamHermesShadowOutput {
    const raw = typeof stdout === 'string' ? stdout.trim() : '';
    if (!raw || Buffer.byteLength(raw, 'utf8') > AMY_ANAM_HERMES_SHADOW_MAX_OUTPUT_BYTES) {
        throw new Error('Hermes shadow output is missing or too large');
    }
    if (raw.startsWith('```') || raw.endsWith('```')) {
        throw new Error('Hermes shadow output must be unwrapped JSON');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('Hermes shadow output was not valid JSON');
    }
    if (!isRecord(parsed) || !exactKeys(parsed, [
        'schema_version',
        'summary',
        'inquiry_type',
        'recommended_next_steps',
        'needs_human_review',
        'quality_review',
        'safety',
    ])) {
        throw new Error('Hermes shadow output has an invalid top-level contract');
    }

    const summary = boundedNonEmptyString(parsed.summary, 4_000, 'summary');
    const inquiryType = boundedNonEmptyString(parsed.inquiry_type, 200, 'inquiry_type');
    if (!Array.isArray(parsed.recommended_next_steps) || parsed.recommended_next_steps.length > 10) {
        throw new Error('recommended_next_steps failed validation');
    }
    const recommendedNextSteps = parsed.recommended_next_steps.map((item, index) => (
        boundedNonEmptyString(item, 500, `recommended_next_steps[${index}]`)
    ));
    if (typeof parsed.needs_human_review !== 'boolean') {
        throw new Error('needs_human_review must be boolean');
    }

    if (!isRecord(parsed.quality_review) || !exactKeys(parsed.quality_review, [
        'repeated_question_risk',
        'unsupported_claim_risk',
        'pricing_or_inventory_claim_risk',
        'technical_term_risk',
        'privacy_risk',
    ]) || Object.values(parsed.quality_review).some(value => typeof value !== 'boolean')) {
        throw new Error('quality_review failed validation');
    }
    if (!isRecord(parsed.safety) || !exactKeys(parsed.safety, [
        'shadow_only',
        'tools_called',
        'emails_sent',
        'memory_writes',
        'outbound_actions',
    ]) || parsed.safety.shadow_only !== true
        || parsed.safety.tools_called !== 0
        || parsed.safety.emails_sent !== 0
        || parsed.safety.memory_writes !== 0
        || parsed.safety.outbound_actions !== 0) {
        throw new Error('Hermes shadow safety contract failed closed');
    }
    if (parsed.schema_version !== AMY_ANAM_HERMES_SHADOW_OUTPUT_VERSION) {
        throw new Error('Hermes shadow output schema version is unsupported');
    }

    return {
        schema_version: AMY_ANAM_HERMES_SHADOW_OUTPUT_VERSION,
        summary,
        inquiry_type: inquiryType,
        recommended_next_steps: recommendedNextSteps,
        needs_human_review: parsed.needs_human_review,
        quality_review: parsed.quality_review as AmyAnamHermesShadowOutput['quality_review'],
        safety: parsed.safety as AmyAnamHermesShadowOutput['safety'],
    };
}

export function hashAmyAnamHermesShadowOutput(output: AmyAnamHermesShadowOutput): string {
    return createHash('sha256').update(JSON.stringify(output)).digest('hex');
}

export function risksFromAmyAnamHermesShadowOutput(
    output: AmyAnamHermesShadowOutput,
): AmyAnamHermesShadowRisks {
    return {
        repeatedQuestion: output.quality_review.repeated_question_risk,
        unsupportedClaim: output.quality_review.unsupported_claim_risk,
        pricingOrInventoryClaim: output.quality_review.pricing_or_inventory_claim_risk,
        technicalTerm: output.quality_review.technical_term_risk,
        privacy: output.quality_review.privacy_risk,
    };
}

export function buildAmyAnamHermesShadowReceipt(input: {
    pointer: AmyAnamHermesShadowPointer;
    status: AmyAnamHermesShadowReceiptStatus;
    attempts?: number;
    now?: number;
    nextAttemptAt?: string | null;
    failureCode?: AmyAnamHermesShadowFailureCode | null;
    output?: AmyAnamHermesShadowOutput;
    hermesExecutionHappened?: boolean;
}): AmyAnamHermesShadowReceipt {
    const pointer = normalizeAmyAnamHermesShadowPointer(input.pointer);
    const output = input.output;
    const completed = input.status === 'completed';
    if (completed && !output) throw new Error('Completed Hermes shadow receipt requires validated output');
    if (!completed && output) throw new Error('Only completed Hermes shadow receipts may reference output');

    return {
        schemaVersion: AMY_ANAM_HERMES_SHADOW_RECEIPT_VERSION,
        jobId: pointer.jobId,
        externalSessionId: pointer.externalSessionId,
        status: input.status,
        attempts: Math.max(0, Math.min(8, Math.trunc(input.attempts ?? 0))),
        updatedAt: new Date(input.now ?? Date.now()).toISOString(),
        nextAttemptAt: input.nextAttemptAt ?? null,
        failureCode: input.failureCode ?? null,
        hermesExecutionHappened: input.hermesExecutionHappened ?? completed,
        outputContractValid: completed,
        outputSha256: output ? hashAmyAnamHermesShadowOutput(output) : null,
        risks: output ? risksFromAmyAnamHermesShadowOutput(output) : null,
        toolsetRestricted: true,
        toolsCalled: 0,
        emailsSent: 0,
        memoryWrites: 0,
        outboundActions: 0,
        rawTranscriptPersisted: false,
        redactedTranscriptPersisted: false,
        generatedContentPersistedInCloud: false,
        contentIncluded: false,
    };
}
