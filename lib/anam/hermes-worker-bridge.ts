import { createHash, timingSafeEqual } from 'node:crypto';
import type { AmyAnamHermesShadowFailureCode, AmyAnamHermesShadowReceipt } from './hermes-shadow.ts';
import {
    normalizeAmyAnamHermesShadowLease,
    normalizeAmyAnamHermesShadowReceiptForCloud,
} from './hermes-shadow-store.ts';
import type { AmyAnamHermesShadowLease } from './hermes-shadow-store.ts';
import type { AmyAnamSessionRecord } from './session-spine.ts';

export const AMY_ANAM_HERMES_WORKER_BRIDGE_MAX_BODY_BYTES = 32 * 1024;
const WORKER_SECRET_MIN_LENGTH = 32;
const FAILURE_CODES = new Set<AmyAnamHermesShadowFailureCode>([
    'session_record_invalid',
    'provider_identity_mismatch',
    'transcript_not_ready',
    'transcript_integrity_mismatch',
    'hermes_timeout',
    'hermes_execution_failed',
    'output_contract_invalid',
    'local_output_failed',
]);

export type AmyAnamHermesWorkerSessionIdentity = {
    schemaVersion: 'amy_anam_hermes_worker_session_v1';
    externalSessionId: string;
    clientLabel: string;
    resolvedPersonaId: string;
    provider: 'anam';
    agentSlug: 'amy';
    state: 'completed';
    createdAt: string;
};

export type AmyAnamHermesWorkerBridgeRequest =
    | { operation: 'claim' }
    | {
        operation: 'ack';
        lease: AmyAnamHermesShadowLease;
        receipt: AmyAnamHermesShadowReceipt;
    }
    | {
        operation: 'fail';
        lease: AmyAnamHermesShadowLease;
        failureCode: AmyAnamHermesShadowFailureCode;
        hermesExecutionHappened: boolean;
    };

export type AmyAnamHermesWorkerClaimResponse =
    | {
        ok: true;
        operation: 'claim';
        found: false;
        contentIncluded: false;
    }
    | {
        ok: true;
        operation: 'claim';
        found: true;
        lease: AmyAnamHermesShadowLease;
        session: AmyAnamHermesWorkerSessionIdentity;
        contentIncluded: false;
    };

export type AmyAnamHermesWorkerAckResponse = {
    ok: true;
    operation: 'ack';
    status: 'completed' | 'stale';
    contentIncluded: false;
};

export type AmyAnamHermesWorkerFailResponse = {
    ok: true;
    operation: 'fail';
    status: 'retry_scheduled' | 'dead_letter' | 'stale';
    contentIncluded: false;
};

function value(source: NodeJS.ProcessEnv, key: string): string {
    return String(source[key] ?? '').replace(/^\uFEFF/, '').trim();
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return Boolean(input) && typeof input === 'object' && !Array.isArray(input);
}

function hasExactKeys(record: Record<string, unknown>, expected: string[]): boolean {
    const actual = Object.keys(record).sort();
    const keys = [...expected].sort();
    return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function normalizeBridgeUrl(raw: string): string {
    if (!raw) return '';
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('AMY_ANAM_HERMES_WORKER_BRIDGE_URL is invalid');
    }
    const localHttp = url.protocol === 'http:'
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1');
    if (url.protocol !== 'https:' && !localHttp) {
        throw new Error('Amy Anam Hermes worker bridge must use HTTPS or localhost');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('Amy Anam Hermes worker bridge URL must not contain credentials or parameters');
    }
    return url.toString().replace(/\/$/, '');
}

export function readAmyAnamHermesWorkerBridgeConfig(source: NodeJS.ProcessEnv = process.env) {
    const secret = value(source, 'AMY_ANAM_HERMES_WORKER_SECRET');
    const bridgeUrl = normalizeBridgeUrl(value(source, 'AMY_ANAM_HERMES_WORKER_BRIDGE_URL'));
    const secretConfigured = secret.length >= WORKER_SECRET_MIN_LENGTH;
    return {
        bridgeUrl,
        secret,
        secretConfigured,
        clientConfigured: Boolean(bridgeUrl) && secretConfigured,
    };
}

export function isAmyAnamHermesWorkerAuthorized(
    request: Request,
    source: NodeJS.ProcessEnv = process.env,
): boolean {
    const config = readAmyAnamHermesWorkerBridgeConfig(source);
    if (!config.secretConfigured) return false;
    const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]{32,512})$/);
    const presented = match?.[1] ?? '';
    const expectedHash = createHash('sha256').update(config.secret).digest();
    const presentedHash = createHash('sha256').update(presented).digest();
    return timingSafeEqual(expectedHash, presentedHash);
}

export function normalizeAmyAnamHermesWorkerBridgeRequest(
    input: unknown,
): AmyAnamHermesWorkerBridgeRequest {
    if (!isRecord(input) || typeof input.operation !== 'string') {
        throw new Error('Amy Anam Hermes worker request is invalid');
    }
    if (input.operation === 'claim') {
        if (!hasExactKeys(input, ['operation'])) throw new Error('Claim request has extra fields');
        return { operation: 'claim' };
    }
    if (input.operation === 'ack') {
        if (!hasExactKeys(input, ['operation', 'lease', 'receipt'])) {
            throw new Error('Ack request has an invalid shape');
        }
        const lease = normalizeAmyAnamHermesShadowLease(input.lease);
        const receipt = normalizeAmyAnamHermesShadowReceiptForCloud(input.receipt);
        if (
            receipt.status !== 'completed'
            || receipt.jobId !== lease.job.pointer.jobId
            || receipt.externalSessionId !== lease.job.pointer.externalSessionId
            || receipt.attempts !== lease.job.attempts
            || receipt.hermesExecutionHappened !== true
        ) {
            throw new Error('Ack receipt did not match its lease');
        }
        return { operation: 'ack', lease, receipt };
    }
    if (input.operation === 'fail') {
        if (!hasExactKeys(input, [
            'operation',
            'lease',
            'failureCode',
            'hermesExecutionHappened',
        ])) {
            throw new Error('Fail request has an invalid shape');
        }
        if (!FAILURE_CODES.has(input.failureCode as AmyAnamHermesShadowFailureCode)) {
            throw new Error('Fail request has an invalid failure code');
        }
        if (typeof input.hermesExecutionHappened !== 'boolean') {
            throw new Error('Fail request execution state is invalid');
        }
        return {
            operation: 'fail',
            lease: normalizeAmyAnamHermesShadowLease(input.lease),
            failureCode: input.failureCode as AmyAnamHermesShadowFailureCode,
            hermesExecutionHappened: input.hermesExecutionHappened,
        };
    }
    throw new Error('Amy Anam Hermes worker operation is unsupported');
}

export function buildAmyAnamHermesWorkerSessionIdentity(
    session: AmyAnamSessionRecord,
): AmyAnamHermesWorkerSessionIdentity {
    if (
        session.schemaVersion !== 'amy_anam_session_v1'
        || session.provider !== 'anam'
        || session.agentSlug !== 'amy'
        || session.state !== 'completed'
        || !session.externalSessionId
        || !session.clientLabel
        || !session.resolvedPersonaId
        || !Number.isFinite(Date.parse(session.createdAt))
    ) {
        throw new Error('Amy Anam Hermes worker session identity is invalid');
    }
    return {
        schemaVersion: 'amy_anam_hermes_worker_session_v1',
        externalSessionId: session.externalSessionId,
        clientLabel: session.clientLabel,
        resolvedPersonaId: session.resolvedPersonaId,
        provider: 'anam',
        agentSlug: 'amy',
        state: 'completed',
        createdAt: session.createdAt,
    };
}

export function normalizeAmyAnamHermesWorkerSessionIdentity(
    input: unknown,
): AmyAnamHermesWorkerSessionIdentity {
    if (!isRecord(input) || !hasExactKeys(input, [
        'schemaVersion',
        'externalSessionId',
        'clientLabel',
        'resolvedPersonaId',
        'provider',
        'agentSlug',
        'state',
        'createdAt',
    ])) {
        throw new Error('Worker session identity has an invalid shape');
    }
    if (
        input.schemaVersion !== 'amy_anam_hermes_worker_session_v1'
        || input.provider !== 'anam'
        || input.agentSlug !== 'amy'
        || input.state !== 'completed'
        || typeof input.externalSessionId !== 'string'
        || !input.externalSessionId
        || typeof input.clientLabel !== 'string'
        || !input.clientLabel
        || typeof input.resolvedPersonaId !== 'string'
        || !input.resolvedPersonaId
        || typeof input.createdAt !== 'string'
        || !Number.isFinite(Date.parse(input.createdAt))
    ) {
        throw new Error('Worker session identity failed validation');
    }
    return input as AmyAnamHermesWorkerSessionIdentity;
}

export function normalizeAmyAnamHermesWorkerClaimResponse(
    input: unknown,
): AmyAnamHermesWorkerClaimResponse {
    if (!isRecord(input) || input.ok !== true || input.operation !== 'claim') {
        throw new Error('Worker claim response is invalid');
    }
    if (input.found === false) {
        if (!hasExactKeys(input, ['ok', 'operation', 'found', 'contentIncluded'])
            || input.contentIncluded !== false) {
            throw new Error('Empty worker claim response is invalid');
        }
        return { ok: true, operation: 'claim', found: false, contentIncluded: false };
    }
    if (input.found !== true || !hasExactKeys(input, [
        'ok',
        'operation',
        'found',
        'lease',
        'session',
        'contentIncluded',
    ]) || input.contentIncluded !== false) {
        throw new Error('Worker claim response has an invalid shape');
    }
    const lease = normalizeAmyAnamHermesShadowLease(input.lease);
    const session = normalizeAmyAnamHermesWorkerSessionIdentity(input.session);
    if (session.externalSessionId !== lease.job.pointer.externalSessionId) {
        throw new Error('Worker claim session did not match its pointer');
    }
    return { ok: true, operation: 'claim', found: true, lease, session, contentIncluded: false };
}

export function normalizeAmyAnamHermesWorkerTransitionResponse(
    input: unknown,
): AmyAnamHermesWorkerAckResponse | AmyAnamHermesWorkerFailResponse {
    if (!isRecord(input) || input.ok !== true || input.contentIncluded !== false) {
        throw new Error('Worker transition response is invalid');
    }
    if (input.operation === 'ack') {
        if (!hasExactKeys(input, ['ok', 'operation', 'status', 'contentIncluded'])
            || (input.status !== 'completed' && input.status !== 'stale')) {
            throw new Error('Worker ack response is invalid');
        }
        return { ok: true, operation: 'ack', status: input.status, contentIncluded: false };
    }
    if (input.operation === 'fail') {
        if (!hasExactKeys(input, ['ok', 'operation', 'status', 'contentIncluded'])
            || !['retry_scheduled', 'dead_letter', 'stale'].includes(String(input.status))) {
            throw new Error('Worker fail response is invalid');
        }
        return {
            ok: true,
            operation: 'fail',
            status: input.status as AmyAnamHermesWorkerFailResponse['status'],
            contentIncluded: false,
        };
    }
    throw new Error('Worker transition response operation is invalid');
}
