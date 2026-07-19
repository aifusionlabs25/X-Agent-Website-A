import {
    AMY_ANAM_MAX_TRANSCRIPT_CHARACTERS,
    AMY_ANAM_MAX_TRANSCRIPT_TURNS,
    AMY_ANAM_MAX_TURN_CHARACTERS,
    normalizeAmyTranscript,
} from './session-spine.ts';
import type { AmyAnamLaunchRecord, AmyTranscriptTurn } from './session-spine.ts';

const ANAM_API_BASE = 'https://api.anam.ai/v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_DELAYS_MS = [0, 250, 750, 1_500, 2_500];
const MAX_METADATA_RESPONSE_BYTES = 64 * 1024;
const MAX_TRANSCRIPT_RESPONSE_BYTES = 2 * 1024 * 1024;

export const AMY_ANAM_EMPTY_TRANSCRIPT_GRACE_MS = 30 * 60 * 1000;

type SessionApiOptions = {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    requestTimeoutMs?: number;
    pollDelaysMs?: number[];
    now?: () => number;
    emptyTranscriptGraceStartedAt?: number;
};

export type AnamSessionMetadata = {
    id: string;
    personaId: string | null;
    clientLabel: string | null;
    startTime: string | null;
    endTime: string | null;
    exitStatus: string | null;
    personaConfig?: {
        personaId?: string;
        type?: string;
        zeroDataRetention?: boolean;
        enableAudioPassthrough?: boolean;
        metadata?: {
            client?: string;
        } | null;
    } | null;
};

export type CompletedAnamTranscript =
    | {
        status: 'ready';
        metadata: AnamSessionMetadata;
        turns: AmyTranscriptTurn[];
    }
    | {
        status: 'pending';
    }
    | {
        status: 'unavailable';
        reason: 'empty_transcript' | 'zero_data_retention' | 'transcripts_disabled';
        metadata: AnamSessionMetadata;
    };

export class AnamSessionApiError extends Error {
    readonly status: number;
    readonly retryable: boolean;

    constructor(message: string, status: number, retryable = false) {
        super(message);
        this.status = status;
        this.retryable = retryable;
    }
}

function readApiKey(source: NodeJS.ProcessEnv): string {
    const value = String(source.ANAM_API_KEY ?? '').trim();
    if (!value) throw new AnamSessionApiError('Anam API is not configured', 500);
    return value;
}

function isRetryableStatus(status: number): boolean {
    return status === 404
        || status === 409
        || status === 425
        || status === 429
        || status >= 500;
}

async function readBoundedJsonResponse(response: Response, maxBytes: number): Promise<unknown> {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new AnamSessionApiError('Anam API response was too large', 502);
    }

    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
        throw new AnamSessionApiError('Anam API response was too large', 502);
    }

    try {
        return JSON.parse(raw);
    } catch {
        throw new AnamSessionApiError('Anam API response was invalid', 502);
    }
}

async function defaultSleep(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return;
    await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function anamGet(
    pathname: string,
    options: SessionApiOptions,
    maxBytes: number,
): Promise<{ response: Response; payload: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );

    try {
        const response = await (options.fetchImpl ?? fetch)(`${ANAM_API_BASE}${pathname}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${readApiKey(options.env ?? process.env)}`,
                Accept: 'application/json',
            },
            cache: 'no-store',
            signal: controller.signal,
        });
        const payload = response.ok
            ? await readBoundedJsonResponse(response, maxBytes)
            : null;
        return { response, payload };
    } catch (error) {
        if (error instanceof AnamSessionApiError) throw error;
        const message = error instanceof Error && error.name === 'AbortError'
            ? 'Anam API request timed out'
            : 'Anam API request failed';
        throw new AnamSessionApiError(message, 503, true);
    } finally {
        clearTimeout(timeout);
    }
}

function parseSessionMetadata(value: unknown, expectedSessionId: string): AnamSessionMetadata {
    if (!value || typeof value !== 'object') {
        throw new AnamSessionApiError('Anam session response was invalid', 502);
    }

    const record = value as Record<string, unknown>;
    if (record.id !== expectedSessionId) {
        throw new AnamSessionApiError('Anam session identity did not match', 502);
    }

    const personaConfig = record.personaConfig && typeof record.personaConfig === 'object'
        ? record.personaConfig as AnamSessionMetadata['personaConfig']
        : null;
    const topLevelPersonaId = typeof record.personaId === 'string' && record.personaId.trim()
        ? record.personaId.trim()
        : null;
    const configuredPersonaId = typeof personaConfig?.personaId === 'string'
        && personaConfig.personaId.trim()
        ? personaConfig.personaId.trim()
        : null;
    if (
        topLevelPersonaId
        && configuredPersonaId
        && topLevelPersonaId !== configuredPersonaId
    ) {
        throw new AnamSessionApiError('Anam session persona identities conflicted', 502);
    }

    return {
        id: expectedSessionId,
        personaId: topLevelPersonaId ?? configuredPersonaId,
        clientLabel: typeof record.clientLabel === 'string' ? record.clientLabel : null,
        startTime: typeof record.startTime === 'string' ? record.startTime : null,
        endTime: typeof record.endTime === 'string' ? record.endTime : null,
        exitStatus: typeof record.exitStatus === 'string' ? record.exitStatus : null,
        personaConfig,
    };
}

export async function fetchAnamSessionMetadata(
    sessionId: string,
    options: SessionApiOptions = {},
): Promise<AnamSessionMetadata> {
    const { response, payload } = await anamGet(
        `/sessions/${encodeURIComponent(sessionId)}`,
        options,
        MAX_METADATA_RESPONSE_BYTES,
    );
    if (!response.ok) {
        throw new AnamSessionApiError(
            'Anam session record is not available',
            response.status,
            isRetryableStatus(response.status),
        );
    }
    return parseSessionMetadata(payload, sessionId);
}

export function verifyAnamSessionMetadata(
    metadata: AnamSessionMetadata,
    launch: AmyAnamLaunchRecord,
): void {
    if (metadata.clientLabel !== launch.clientLabel) {
        throw new AnamSessionApiError('Anam session launch identity did not match', 403);
    }
    if (metadata.personaId !== launch.resolvedPersonaId) {
        throw new AnamSessionApiError('Anam session persona did not match', 403);
    }
    if (metadata.personaConfig?.enableAudioPassthrough === true) {
        throw new AnamSessionApiError('Anam audio passthrough is not allowed for Amy', 403);
    }
    if (metadata.personaConfig?.type && metadata.personaConfig.type !== 'stateful') {
        throw new AnamSessionApiError('Anam session type was not stateful', 403);
    }
    if (
        metadata.personaConfig?.metadata?.client
        && metadata.personaConfig.metadata.client !== 'js-sdk'
    ) {
        throw new AnamSessionApiError('Anam session client was not the JavaScript SDK', 403);
    }

    if (metadata.startTime) {
        const providerStart = Date.parse(metadata.startTime);
        const launchCreated = Date.parse(launch.createdAt);
        if (
            Number.isFinite(providerStart)
            && Number.isFinite(launchCreated)
            && providerStart < launchCreated - 60_000
        ) {
            throw new AnamSessionApiError('Anam session started before this launch', 403);
        }
    }
}

export async function verifyAnamSessionForLaunch(
    sessionId: string,
    launch: AmyAnamLaunchRecord,
    options: SessionApiOptions = {},
): Promise<AnamSessionMetadata> {
    const delays = options.pollDelaysMs ?? [0, 200, 500];
    const sleep = options.sleep ?? defaultSleep;
    let lastError: AnamSessionApiError | null = null;

    for (const delay of delays) {
        await sleep(delay);
        try {
            const metadata = await fetchAnamSessionMetadata(sessionId, options);
            verifyAnamSessionMetadata(metadata, launch);
            return metadata;
        } catch (error) {
            if (!(error instanceof AnamSessionApiError) || !error.retryable) throw error;
            lastError = error;
        }
    }

    throw lastError ?? new AnamSessionApiError('Anam session record is not ready', 503, true);
}

function parseTranscriptPayload(value: unknown, expectedSessionId: string): {
    transcriptsEnabled: boolean;
    endTime: string | null;
    turns: AmyTranscriptTurn[];
    totalMessages: number;
} {
    if (!value || typeof value !== 'object') {
        throw new AnamSessionApiError('Anam transcript response was invalid', 502);
    }
    const record = value as Record<string, unknown>;
    if (record.sessionId !== expectedSessionId) {
        throw new AnamSessionApiError('Anam transcript identity did not match', 502);
    }
    if (typeof record.transcriptsEnabled !== 'boolean' || !Array.isArray(record.messages)) {
        throw new AnamSessionApiError('Anam transcript response was incomplete', 502, true);
    }

    if (
        typeof record.totalMessages !== 'number'
        || !Number.isInteger(record.totalMessages)
        || record.totalMessages < 0
    ) {
        throw new AnamSessionApiError('Anam transcript message count was invalid', 502);
    }
    if (record.totalMessages !== record.messages.length) {
        throw new AnamSessionApiError('Anam transcript is not complete', 502, true);
    }
    if (record.messages.length > AMY_ANAM_MAX_TRANSCRIPT_TURNS) {
        throw new AnamSessionApiError('Anam transcript exceeded safety limits', 502);
    }
    const totalMessages = record.totalMessages;
    let totalCharacters = 0;
    let conversationalMessages = 0;
    for (const item of record.messages) {
        if (!item || typeof item !== 'object') {
            throw new AnamSessionApiError('Anam transcript message was invalid', 502);
        }
        const message = item as Record<string, unknown>;
        if (
            (message.role !== 'persona' && message.role !== 'user')
            || typeof message.message !== 'string'
            || message.message.length > AMY_ANAM_MAX_TURN_CHARACTERS
        ) {
            throw new AnamSessionApiError('Anam transcript message was invalid', 502);
        }
        totalCharacters += message.message.length;
        if (message.message.trim()) conversationalMessages += 1;
    }
    if (totalCharacters > AMY_ANAM_MAX_TRANSCRIPT_CHARACTERS) {
        throw new AnamSessionApiError('Anam transcript exceeded safety limits', 502);
    }
    const endTime = typeof record.endTime === 'string' ? record.endTime : null;
    const turns = normalizeAmyTranscript(record.messages);
    if (record.transcriptsEnabled && turns.length !== conversationalMessages) {
        throw new AnamSessionApiError('Anam transcript messages were invalid', 502);
    }
    return { transcriptsEnabled: record.transcriptsEnabled, endTime, turns, totalMessages };
}

async function fetchTranscriptOnce(
    sessionId: string,
    options: SessionApiOptions,
): Promise<{ transcriptsEnabled: boolean; endTime: string | null; turns: AmyTranscriptTurn[] }> {
    const { response, payload } = await anamGet(
        `/sessions/${encodeURIComponent(sessionId)}/transcript`,
        options,
        MAX_TRANSCRIPT_RESPONSE_BYTES,
    );
    if (!response.ok) {
        throw new AnamSessionApiError(
            'Anam transcript is not available',
            response.status,
            isRetryableStatus(response.status),
        );
    }
    return parseTranscriptPayload(payload, sessionId);
}

export async function fetchCompletedAnamTranscript(
    sessionId: string,
    launch: AmyAnamLaunchRecord,
    options: SessionApiOptions = {},
): Promise<CompletedAnamTranscript> {
    const delays = options.pollDelaysMs ?? DEFAULT_POLL_DELAYS_MS;
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;
    let finalEmptyObservation: {
        metadata: AnamSessionMetadata;
        graceStartedAt: number | null;
    } | null = null;
    let consecutiveEmptyObservations = 0;

    for (const delay of delays) {
        await sleep(delay);
        try {
            const metadata = await fetchAnamSessionMetadata(sessionId, options);
            verifyAnamSessionMetadata(metadata, launch);

            if (!metadata.endTime && !metadata.exitStatus) {
                finalEmptyObservation = null;
                consecutiveEmptyObservations = 0;
                continue;
            }
            if (metadata.personaConfig?.zeroDataRetention === true) {
                return { status: 'unavailable', reason: 'zero_data_retention', metadata };
            }

            const transcript = await fetchTranscriptOnce(sessionId, options);
            if (!transcript.transcriptsEnabled) {
                return { status: 'unavailable', reason: 'transcripts_disabled', metadata };
            }
            const transcriptEndedAt = Date.parse(transcript.endTime ?? '');
            if (!Number.isFinite(transcriptEndedAt)) {
                finalEmptyObservation = null;
                consecutiveEmptyObservations = 0;
                continue;
            }
            if (transcript.turns.length === 0) {
                const metadataEndedAt = Date.parse(metadata.endTime ?? '');
                const providerEndedAt = Number.isFinite(metadataEndedAt)
                    ? Math.max(metadataEndedAt, transcriptEndedAt)
                    : transcriptEndedAt;
                const locallyReceivedAt = options.emptyTranscriptGraceStartedAt;
                finalEmptyObservation = {
                    metadata,
                    graceStartedAt: Number.isFinite(locallyReceivedAt)
                        ? Math.max(providerEndedAt, locallyReceivedAt as number)
                        : null,
                };
                consecutiveEmptyObservations += 1;
                continue;
            }
            return { status: 'ready', metadata, turns: transcript.turns };
        } catch (error) {
            if (!(error instanceof AnamSessionApiError) || !error.retryable) throw error;
            finalEmptyObservation = null;
            consecutiveEmptyObservations = 0;
        }
    }

    if (
        finalEmptyObservation
        && consecutiveEmptyObservations >= 2
        && finalEmptyObservation.graceStartedAt !== null
        && now() - finalEmptyObservation.graceStartedAt >= AMY_ANAM_EMPTY_TRANSCRIPT_GRACE_MS
    ) {
        return {
            status: 'unavailable',
            reason: 'empty_transcript',
            metadata: finalEmptyObservation.metadata,
        };
    }

    return { status: 'pending' };
}

