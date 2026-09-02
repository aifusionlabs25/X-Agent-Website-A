import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { DANI_PERSONA_ID, EVAN_PERSONA_ID } from './persona-ids.ts';
import { AMY_CARA4_VARIANT } from './session-config.ts';

export const DANI_AI_SOLUTIONS_VARIANT = 'dani-ai-solutions';
export const EVAN_MULLINS_VARIANT = 'evan-mullins';
export type AnamSessionAgentSlug = 'amy' | 'dani' | 'evan';
export type AnamSessionVariant =
    | typeof AMY_CARA4_VARIANT
    | typeof DANI_AI_SOLUTIONS_VARIANT
    | typeof EVAN_MULLINS_VARIANT;

export const AMY_ANAM_BROWSER_COOKIE = 'xagent_amy_anam_session';
export const AMY_ANAM_BROWSER_TTL_SECONDS = 4 * 60 * 60;
export const AMY_ANAM_LAUNCH_TTL_SECONDS = 75 * 60;
export const AMY_ANAM_RECORD_TTL_SECONDS = 7 * 24 * 60 * 60;

const SIGNING_SECRET_MIN_LENGTH = 32;
export const AMY_ANAM_MAX_TRANSCRIPT_TURNS = 400;
export const AMY_ANAM_MAX_TURN_CHARACTERS = 4_000;
export const AMY_ANAM_MAX_TRANSCRIPT_CHARACTERS = 256_000;

export type AmyAnamSpineConfig = {
    enabled: boolean;
    configured: boolean;
    gatesOpen: boolean;
    killSwitchActive: boolean;
    signingSecret: string;
    redisUrl: string;
    redisToken: string;
};

export type AmyAnamBrowserSession = {
    id: string;
    createdAt: number;
    expiresAt: number;
};

export type AmyAnamLaunchRecord = {
    schemaVersion: 'amy_anam_launch_v1';
    browserSessionId: string;
    launchId: string;
    clientLabel: string;
    resolvedPersonaId: string;
    agentSlug: AnamSessionAgentSlug;
    variant: AnamSessionVariant;
    state: 'token_minted' | 'bound';
    createdAt: string;
    boundSessionId?: string;
    boundAt?: string;
};

export type AmyAnamSessionRecord = {
    schemaVersion: 'amy_anam_session_v1';
    browserSessionId: string;
    launchId: string;
    externalSessionId: string;
    clientLabel: string;
    resolvedPersonaId: string;
    provider: 'anam';
    agentSlug: AnamSessionAgentSlug;
    variant: AnamSessionVariant;
    state: 'bound' | 'close_received' | 'awaiting_transcript' | 'finalization_failed' | 'completed';
    createdAt: string;
    boundAt: string;
    closeReceivedAt?: string;
    closeReason?: string;
    displayedArtifact?: {
        view: 'notes' | 'brief' | 'roadmap' | 'visual' | 'catalog';
        revision: number;
    };
    completedAt?: string;
};

export type AmyAnamFinalizationRecord = {
    schemaVersion: 'amy_anam_finalization_v1';
    browserSessionId: string;
    launchId: string;
    externalSessionId: string;
    state: 'verification_pending' | 'queued' | 'awaiting_transcript' | 'completed' | 'transcript_unavailable' | 'failed';
    closeReason: string;
    displayedArtifact?: AmyAnamSessionRecord['displayedArtifact'];
    receivedAt: string;
    updatedAt: string;
    attempts: number;
    nextAttemptAt: string | null;
    failureCode?: 'provider_verification' | 'provider_response' | 'configuration';
};

export type AmyTranscriptTurn = {
    role: 'user' | 'agent';
    content: string;
};

export type AmyAnamSessionReceipt = {
    schemaVersion: 'amy_anam_session_receipt_v1';
    receiptId: string;
    provider: 'anam';
    externalSessionId: string;
    variant: AnamSessionVariant;
    status: 'completed' | 'transcript_unavailable';
    completedAt: string;
    closeReason: string;
    transcript: {
        source: 'anam_api' | 'unavailable';
        messageCount: number;
        contentSha256: string | null;
        rawTranscriptPersisted: false;
    };
    actions: {
        hermes: false;
        memory: false;
        email: false;
        sheets: false;
    };
};

type SignedPayload = Record<string, unknown> & {
    exp: number;
    v: 1;
};

function envValue(source: NodeJS.ProcessEnv, name: string): string {
    return String(source[name] ?? '')
        .trim()
        .replace(/^(?:\uFEFF|\u00EF\u00BB\u00BF|\u00C3\u00AF\u00C2\u00BB\u00C2\u00BF)+/, '')
        .replace(/(?:\\r|\\n)+$/, '')
        .trim();
}

export function readAmyAnamSpineConfig(source: NodeJS.ProcessEnv = process.env): AmyAnamSpineConfig {
    const enabled = envValue(source, 'AMY_ANAM_SESSION_SPINE_ENABLED') === 'true';
    const killSwitchActive = envValue(source, 'AMY_ANAM_SESSION_SPINE_KILL_SWITCH') !== 'false';
    const signingSecret = envValue(source, 'AMY_ANAM_SESSION_SECRET');
    const redisUrl = envValue(source, 'AMY_ANAM_REDIS_REST_URL').replace(/\/$/, '');
    const redisToken = envValue(source, 'AMY_ANAM_REDIS_REST_TOKEN');
    const configured = signingSecret.length >= SIGNING_SECRET_MIN_LENGTH
        && Boolean(redisUrl && redisToken);

    return {
        enabled,
        configured,
        gatesOpen: enabled && !killSwitchActive && configured,
        killSwitchActive,
        signingSecret,
        redisUrl,
        redisToken,
    };
}

function signingKey(secret: string): Buffer {
    if (secret.trim().length < SIGNING_SECRET_MIN_LENGTH) {
        throw new Error('Amy Anam session signing is not configured');
    }

    return createHash('sha256')
        .update(`xagent:amy:anam:browser-session:v1\0${secret.trim()}`)
        .digest();
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length
        && timingSafeEqual(leftBuffer, rightBuffer);
}

function signBrowserSession(session: AmyAnamBrowserSession, secret: string): string {
    const payload: SignedPayload = {
        exp: session.expiresAt,
        iat: session.createdAt,
        sid: session.id,
        v: 1,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', signingKey(secret))
        .update(encoded)
        .digest('base64url');
    return `${encoded}.${signature}`;
}

function cookieValue(request: Request, name: string): string | null {
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) return null;

    for (const pair of cookieHeader.split(';')) {
        const separator = pair.indexOf('=');
        if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;

        try {
            return decodeURIComponent(pair.slice(separator + 1).trim());
        } catch {
            return null;
        }
    }

    return null;
}

export function amyAnamCookieOptions(maxAge = AMY_ANAM_BROWSER_TTL_SECONDS) {
    return {
        httpOnly: true,
        maxAge,
        path: '/',
        priority: 'high' as const,
        sameSite: 'lax' as const,
        secure: process.env.NODE_ENV === 'production',
    };
}

export function createAmyAnamBrowserSessionWithSecret(secret: string, now = Date.now()) {
    const session: AmyAnamBrowserSession = {
        id: randomUUID(),
        createdAt: now,
        expiresAt: now + AMY_ANAM_BROWSER_TTL_SECONDS * 1000,
    };
    return { session, token: signBrowserSession(session, secret) };
}

export function readAmyAnamBrowserSession(
    request: Request,
    secret = readAmyAnamSpineConfig().signingSecret,
    now = Date.now(),
): AmyAnamBrowserSession | null {
    try {
        const token = cookieValue(request, AMY_ANAM_BROWSER_COOKIE);
        if (!token) return null;
        const [encoded, suppliedSignature, ...extra] = token.split('.');
        if (!encoded || !suppliedSignature || extra.length > 0) return null;

        const expectedSignature = createHmac('sha256', signingKey(secret))
            .update(encoded)
            .digest('base64url');
        if (!safeEqual(suppliedSignature, expectedSignature)) return null;

        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedPayload;
        if (
            payload.v !== 1
            || typeof payload.sid !== 'string'
            || typeof payload.iat !== 'number'
            || typeof payload.exp !== 'number'
            || !isUuid(payload.sid)
            || payload.iat > now + 60_000
            || payload.exp > payload.iat + AMY_ANAM_BROWSER_TTL_SECONDS * 1000
            || payload.exp <= now
        ) {
            return null;
        }

        return {
            id: payload.sid,
            createdAt: payload.iat,
            expiresAt: payload.exp,
        };
    } catch {
        return null;
    }
}

export function buildAmyAnamClientLabel(
    launchId: string,
    agentSlug: AnamSessionAgentSlug = 'amy',
): string {
    return `xagent-${agentSlug}:${launchId}`;
}

function variantForAgent(agentSlug: AnamSessionAgentSlug): AnamSessionVariant {
    if (agentSlug === 'dani') return DANI_AI_SOLUTIONS_VARIANT;
    if (agentSlug === 'evan') return EVAN_MULLINS_VARIANT;
    return AMY_CARA4_VARIANT;
}

export function resolveAnamSessionAgentSlug(
    resolvedPersonaId: string,
    storedAgentSlug?: unknown,
): AnamSessionAgentSlug {
    if (resolvedPersonaId === DANI_PERSONA_ID) return 'dani';
    if (resolvedPersonaId === EVAN_PERSONA_ID) return 'evan';
    return storedAgentSlug === 'dani' || storedAgentSlug === 'evan' || storedAgentSlug === 'amy'
        ? storedAgentSlug
        : 'amy';
}

export function resolveAnamSessionVariant(
    resolvedPersonaId: string,
    storedVariant?: unknown,
): AnamSessionVariant {
    const identityVariant = variantForAgent(resolveAnamSessionAgentSlug(resolvedPersonaId));
    if (resolvedPersonaId === DANI_PERSONA_ID || resolvedPersonaId === EVAN_PERSONA_ID) {
        return identityVariant;
    }
    return storedVariant === DANI_AI_SOLUTIONS_VARIANT
        || storedVariant === EVAN_MULLINS_VARIANT
        || storedVariant === AMY_CARA4_VARIANT
        ? storedVariant
        : identityVariant;
}

export function createAmyAnamLaunch(
    browserSessionId: string,
    resolvedPersonaId: string,
    now = Date.now(),
    agentSlug: AnamSessionAgentSlug = 'amy',
): AmyAnamLaunchRecord {
    const launchId = randomUUID();
    return {
        schemaVersion: 'amy_anam_launch_v1',
        browserSessionId,
        launchId,
        clientLabel: buildAmyAnamClientLabel(launchId, agentSlug),
        resolvedPersonaId,
        agentSlug,
        variant: variantForAgent(agentSlug),
        state: 'token_minted',
        createdAt: new Date(now).toISOString(),
    };
}

export function isUuid(value: unknown): value is string {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export function isValidAnamSessionId(value: unknown): value is string {
    return isUuid(value);
}

export function isTrustedBrowserOrigin(request: Request): boolean {
    const origin = request.headers.get('origin');
    if (!origin) return process.env.NODE_ENV !== 'production';

    try {
        const originUrl = new URL(origin);
        const requestUrl = new URL(request.url);
        const allowedProtocol = originUrl.protocol === 'https:'
            || (process.env.NODE_ENV !== 'production' && originUrl.protocol === 'http:');
        return allowedProtocol && originUrl.origin === requestUrl.origin;
    } catch {
        return false;
    }
}

export class AmyAnamRequestError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

export async function readBoundedJsonObject(
    request: Request,
    maxBytes: number,
): Promise<Record<string, unknown>> {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new AmyAnamRequestError('Request body is too large', 413);
    }

    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
        throw new AmyAnamRequestError('Request body is too large', 413);
    }

    try {
        const parsed = JSON.parse(raw || '{}') as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new AmyAnamRequestError('Request body must be an object', 400);
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        if (error instanceof AmyAnamRequestError) throw error;
        throw new AmyAnamRequestError('Request body must be valid JSON', 400);
    }
}

export function boundedString(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function requestFingerprint(request: Request, scope: string): string {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const address = forwarded || request.headers.get('x-real-ip') || 'unknown';
    const addressHash = createHash('sha256').update(address).digest('hex').slice(0, 20);
    return `${scope}:${addressHash}`;
}

function normalizeRole(value: unknown): 'user' | 'agent' | null {
    const role = String(value ?? '').toLowerCase();
    if (role === 'user') return 'user';
    if (role === 'persona' || role === 'agent') return 'agent';
    return null;
}

export function normalizeAmyTranscript(value: unknown): AmyTranscriptTurn[] {
    if (!Array.isArray(value)) return [];

    const turns: AmyTranscriptTurn[] = [];
    let totalCharacters = 0;

    for (const item of value.slice(0, AMY_ANAM_MAX_TRANSCRIPT_TURNS)) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const role = normalizeRole(record.role);
        if (!role) continue;
        const content = boundedString(record.content ?? record.message, AMY_ANAM_MAX_TURN_CHARACTERS)
            .replace(/\s+/g, ' ')
            .trim();
        if (!content) continue;

        const remaining = AMY_ANAM_MAX_TRANSCRIPT_CHARACTERS - totalCharacters;
        if (remaining <= 0) break;
        const boundedContent = content.slice(0, remaining);
        turns.push({ role, content: boundedContent });
        totalCharacters += boundedContent.length;
    }

    return turns;
}

export function transcriptSha256(turns: AmyTranscriptTurn[]): string | null {
    if (turns.length === 0) return null;
    return createHash('sha256')
        .update(turns.map(turn => `${turn.role}:${turn.content}`).join('\n'))
        .digest('hex');
}

export function buildAmyAnamReceipt(input: {
    externalSessionId: string;
    closeReason?: string;
    source: 'anam_api' | 'unavailable';
    turns: AmyTranscriptTurn[];
    variant?: AnamSessionVariant;
    now?: number;
}): AmyAnamSessionReceipt {
    const now = input.now ?? Date.now();
    const contentSha256 = transcriptSha256(input.turns);
    const receiptId = createHash('sha256')
        .update(`anam:${input.externalSessionId}:${contentSha256 ?? 'unavailable'}`)
        .digest('hex')
        .slice(0, 32);

    return {
        schemaVersion: 'amy_anam_session_receipt_v1',
        receiptId,
        provider: 'anam',
        externalSessionId: input.externalSessionId,
        variant: input.variant ?? AMY_CARA4_VARIANT,
        status: input.source === 'anam_api' ? 'completed' : 'transcript_unavailable',
        completedAt: new Date(now).toISOString(),
        closeReason: boundedString(input.closeReason, 100) || 'unknown',
        transcript: {
            source: input.source,
            messageCount: input.turns.length,
            contentSha256,
            rawTranscriptPersisted: false,
        },
        actions: {
            hermes: false,
            memory: false,
            email: false,
            sheets: false,
        },
    };
}

export function publicAmyAnamReceipt(receipt: AmyAnamSessionReceipt) {
    return {
        canary: true,
        receiptId: receipt.receiptId,
        status: receipt.status,
        transcriptSource: receipt.transcript.source,
        messageCount: receipt.transcript.messageCount,
        rawTranscriptPersisted: receipt.transcript.rawTranscriptPersisted,
        outbound: false,
        hermes: false,
        memory: false,
    };
}
