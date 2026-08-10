import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { readAmyAgentMailProviderConfig, sendAmyEmailWithAgentMail } from '../email/amy-email-provider.ts';
import {
    AMY_ANAM_CONTACT_TTL_SECONDS,
    createDaniAnamContactToken,
    readDaniAnamContactToken,
} from './contact-token.ts';
import { readDaniAnamSessionSecrets } from './dani-session.ts';
import { buildDaniEmailBundle } from './dani-agentmail-templates.ts';
import { normalizeAmyTranscript, readAmyAnamSpineConfig } from './session-spine.ts';
import type { AmyAnamSessionReceipt, AmyAnamSessionRecord, AmyTranscriptTurn } from './session-spine.ts';
import {
    removeDaniAnamEmailRetryDueEntry,
    scheduleDaniAnamEmailRetryDueEntry,
} from './session-spine-store.ts';

const TTL_SECONDS = 30 * 24 * 60 * 60;
const FOLLOW_UP_OTP_TTL_SECONDS = 10 * 60;
const FOLLOW_UP_OTP_MAX_ATTEMPTS = 5;
const DELIVERY_MAX_ROUNDS = 3;
const DELIVERY_RETRY_DELAYS_MS = [150, 450] as const;
const DELIVERY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1_000;
const DELIVERY_DURABLE_RETRY_DELAY_MS = 5 * 60 * 1_000;
const DEFAULT_INBOX = 'hermes-hal@agentmail.to';
const DEFAULT_INTERNAL_EMAIL = 'aifusionlabs@gmail.com';

type Options = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: number };
type PipelineItem = { result?: unknown; error?: string };

type Intent = {
    schemaVersion: 'dani_anam_agentmail_intent_v1';
    externalSessionId: string;
    browserSessionId: string;
    status: 'queued';
    receiptId: string;
    displayName: string;
    contactToken: string;
    requestedAt: string;
    rawEmailStored: false;
    transcriptStored: false;
    messageContentStored: false;
};

type DeliveryStatus = { visitor: boolean; admin: boolean; summary: boolean };
type DeliveryLane = keyof DeliveryStatus;

type Attempt = {
    schemaVersion: 'dani_anam_agentmail_attempt_v1';
    externalSessionId: string;
    status: 'pending' | 'sent' | 'partial' | 'failed';
    receiptId: string;
    attemptedAt: string;
    completedAt: string | null;
    visitorMessageId: string | null;
    adminMessageId?: string | null;
    summaryMessageId?: string | null;
    failureCode: 'delivery_partial' | 'delivery_rejected_or_unknown' | null;
    deliveryStatus: DeliveryStatus;
    rawEmailStored: false;
    messageContentStored: false;
};

type FollowUpOtpChallenge = {
    schemaVersion: 'dani_anam_agentmail_otp_v1';
    challengeId: string;
    browserSessionId: string;
    contactToken: string;
    otpHash: string;
    attemptCount: number;
    requestedAt: string;
    expiresAt: string;
};

export type DaniAnamPostSessionDispatchResult = {
    status: 'conversation_ineligible' | 'email_already_attempted' | 'email_cancelled' | 'email_failed' | 'email_not_requested' | 'email_partial' | 'email_retry_expired' | 'email_sent' | 'email_unavailable' | 'transcript_unavailable';
    sent: boolean;
    duplicate?: boolean;
    receiptId?: string;
    provider?: 'agentmail';
    deliveryCount?: number;
    visitorSent?: boolean;
    internalNotificationsSent?: boolean;
};

const envValue = (source: NodeJS.ProcessEnv, name: string) => String(source[name] ?? '').trim();
const inheritedFlag = (source: NodeJS.ProcessEnv, daniName: string, amyName: string) => (
    envValue(source, daniName) || envValue(source, amyName)
);
const validEmail = (value: string) => value.length <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function readDaniAnamAgentMailConfig(source: NodeJS.ProcessEnv = process.env) {
    const spine = readAmyAnamSpineConfig(source);
    const daniSession = readDaniAnamSessionSecrets(source);
    const provider = (envValue(source, 'DANI_EMAIL_PROVIDER') || envValue(source, 'AMY_EMAIL_PROVIDER') || 'agentmail').toLowerCase();
    const inboxAddress = (
        envValue(source, 'DANI_AGENTMAIL_ADDRESS')
        || envValue(source, 'AMY_AGENTMAIL_ADDRESS')
        || DEFAULT_INBOX
    ).toLowerCase();
    const providerEnv = { ...source, AMY_AGENTMAIL_ADDRESS: inboxAddress };
    const providerConfig = readAmyAgentMailProviderConfig(providerEnv);
    const adminEmail = (envValue(source, 'DANI_ADMIN_EMAIL') || DEFAULT_INTERNAL_EMAIL).toLowerCase();
    const summaryEmail = (envValue(source, 'DANI_CALL_SUMMARY_EMAIL') || DEFAULT_INTERNAL_EMAIL).toLowerCase();
    const requestedGateOpen =
        inheritedFlag(source, 'DANI_ANAM_AGENTMAIL_ENABLED', 'AMY_ANAM_AGENTMAIL_ENABLED') === 'true'
        && inheritedFlag(source, 'DANI_ANAM_AGENTMAIL_KILL_SWITCH', 'AMY_ANAM_AGENTMAIL_KILL_SWITCH') === 'false'
        && inheritedFlag(source, 'DANI_ANAM_TOOLS_ENABLED', 'AMY_ANAM_TOOLS_ENABLED') === 'true'
        && inheritedFlag(source, 'DANI_ANAM_TOOLS_KILL_SWITCH', 'AMY_ANAM_TOOLS_KILL_SWITCH') === 'false'
        && inheritedFlag(source, 'DANI_ANAM_OUTBOUND_ACTIONS_ENABLED', 'AMY_ANAM_OUTBOUND_ACTIONS_ENABLED') === 'true'
        && inheritedFlag(source, 'DANI_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH', 'AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH') === 'false';
    const configured = provider === 'agentmail'
        && providerConfig.configured
        && spine.configured
        && daniSession.configured
        && validEmail(adminEmail)
        && validEmail(summaryEmail);
    return {
        provider,
        inboxAddress,
        adminEmail,
        summaryEmail,
        configured,
        requestedGateOpen,
        effectiveGateOpen: configured && requestedGateOpen && spine.gatesOpen,
        redisUrl: spine.redisUrl,
        redisToken: spine.redisToken,
        contactSecret: daniSession.contactSecret,
        providerEnv,
    };
}

const intentKey = (id: string) => `xagent:dani:anam:agentmail:intent:v1:${id}`;
const attemptKey = (id: string) => `xagent:dani:anam:agentmail:attempt:v1:${id}`;
const deliveryLaneKey = (id: string, lane: DeliveryLane) => `xagent:dani:anam:agentmail:delivery:v1:${id}:${lane}`;
const cancellationKey = (id: string) => `xagent:dani:anam:agentmail:cancelled:v1:${id}`;
const authorizationKey = (browserSessionId: string) => `xagent:dani:anam:agentmail:authorization:v1:${browserSessionId}`;
const followUpOtpKey = (challengeId: string) => `xagent:dani:anam:agentmail:otp:v1:${challengeId}`;

async function redisCommand(
    command: Array<string | number>,
    options: Options = {},
    requireEmailGate = true,
): Promise<unknown> {
    const config = readDaniAnamAgentMailConfig(options.env ?? process.env);
    if (requireEmailGate ? !config.effectiveGateOpen : !readAmyAnamSpineConfig(options.env ?? process.env).gatesOpen) {
        throw new Error('Dani AgentMail is unavailable');
    }
    let response: Response;
    try {
        response = await (options.fetchImpl ?? fetch)(`${config.redisUrl}/pipeline`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.redisToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify([command]),
            cache: 'no-store',
            signal: AbortSignal.timeout(3_000),
        });
    } catch {
        throw new Error('Dani AgentMail receipt store request failed');
    }
    if (!response.ok) throw new Error('Dani AgentMail receipt store returned an error');
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) throw new Error('Dani AgentMail receipt response was too large');
    const payload = JSON.parse(raw) as PipelineItem[];
    if (!Array.isArray(payload) || payload.length !== 1 || payload[0]?.error) {
        throw new Error('Dani AgentMail receipt response was invalid');
    }
    return payload[0]?.result ?? null;
}

function parse<T>(raw: unknown, schemaVersion: string): T | null {
    if (raw === null || raw === undefined) return null;
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
        || (value as { schemaVersion?: unknown }).schemaVersion !== schemaVersion
    ) throw new Error('Dani AgentMail receipt was invalid');
    return value as T;
}

function redisResultShape(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `array:${value.length}`;
    if (typeof value === 'string') return `string:${value.length}`;
    if (typeof value === 'object') {
        return `object:${Object.keys(value as Record<string, unknown>).sort().join(',').slice(0, 80)}`;
    }
    return typeof value;
}

function countDelivered(status: DeliveryStatus): number {
    return Object.values(status).filter(Boolean).length;
}

function followUpOtpHash(challengeId: string, code: string, secret: string): string {
    return createHmac('sha256', secret)
        .update(`xagent:dani:anam:agentmail:otp:v1\0${challengeId}\0${code}`)
        .digest('hex');
}

export function isDaniAnamFollowUpOtpChallengeId(value: unknown): value is string {
    return typeof value === 'string'
        && /^followup_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseFollowUpOtpChallenge(raw: unknown): FollowUpOtpChallenge | null {
    if (raw === null || raw === undefined) return null;
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Dani follow-up verification challenge was invalid');
    }
    const challenge = value as Partial<FollowUpOtpChallenge>;
    if (
        challenge.schemaVersion !== 'dani_anam_agentmail_otp_v1'
        || !isDaniAnamFollowUpOtpChallengeId(challenge.challengeId)
        || typeof challenge.browserSessionId !== 'string'
        || typeof challenge.contactToken !== 'string'
        || challenge.contactToken.length < 16
        || !/^[a-f0-9]{64}$/.test(String(challenge.otpHash ?? ''))
        || !Number.isInteger(challenge.attemptCount)
        || Number(challenge.attemptCount) < 0
        || Number(challenge.attemptCount) > FOLLOW_UP_OTP_MAX_ATTEMPTS
        || !Number.isFinite(Date.parse(String(challenge.requestedAt ?? '')))
        || !Number.isFinite(Date.parse(String(challenge.expiresAt ?? '')))
    ) throw new Error('Dani follow-up verification challenge was invalid');
    return challenge as FollowUpOtpChallenge;
}

export async function createDaniAnamFollowUpOtpChallenge(input: {
    browserSessionId: string;
    contactToken: string;
    contactSecret: string;
    now?: number;
}, options: Options = {}) {
    const config = readDaniAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen || input.contactSecret !== config.contactSecret) {
        throw new Error('Dani follow-up verification is unavailable');
    }
    const contact = readDaniAnamContactToken({
        token: input.contactToken,
        browserSessionId: input.browserSessionId,
        secret: input.contactSecret,
    });
    if (!contact || contact.purpose !== 'dani_follow_up' || !contact.displayName) {
        throw new Error('Dani follow-up verification contact was invalid');
    }
    const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
    const challengeId = `followup_${randomUUID()}`;
    const verificationCode = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challenge: FollowUpOtpChallenge = {
        schemaVersion: 'dani_anam_agentmail_otp_v1',
        challengeId,
        browserSessionId: input.browserSessionId,
        contactToken: input.contactToken,
        otpHash: followUpOtpHash(challengeId, verificationCode, input.contactSecret),
        attemptCount: 0,
        requestedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + FOLLOW_UP_OTP_TTL_SECONDS * 1_000).toISOString(),
    };
    const stored = await redisCommand([
        'SET', followUpOtpKey(challengeId), JSON.stringify(challenge), 'NX', 'EX', FOLLOW_UP_OTP_TTL_SECONDS,
    ], options);
    if (stored !== 'OK') throw new Error('Dani follow-up verification challenge could not be created');
    return {
        challengeId,
        verificationCode,
        expiresAt: challenge.expiresAt,
        rawEmailStored: false as const,
        verificationCodeStored: false as const,
    };
}

export async function consumeDaniAnamFollowUpOtpChallenge(input: {
    challengeId: string;
    browserSessionId: string;
    verificationCode: string;
    contactSecret: string;
    now?: number;
}, options: Options = {}): Promise<
    | { status: 'verified'; contactToken: string }
    | { status: 'invalid' | 'expired' | 'locked' }
> {
    const config = readDaniAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen || input.contactSecret !== config.contactSecret) {
        throw new Error('Dani follow-up verification is unavailable');
    }
    if (!isDaniAnamFollowUpOtpChallengeId(input.challengeId)) return { status: 'invalid' };
    const code = String(input.verificationCode ?? '').trim();
    if (!/^\d{6}$/.test(code)) return { status: 'invalid' };
    const challenge = parseFollowUpOtpChallenge(await redisCommand([
        'GET', followUpOtpKey(input.challengeId),
    ], options));
    if (!challenge || challenge.browserSessionId !== input.browserSessionId) return { status: 'invalid' };
    const now = new Date(Number.isFinite(input.now) ? Number(input.now) : Date.now()).toISOString();
    const result = await redisCommand([
        'EVAL',
        [
            '-- DANI_AGENTMAIL_OTP_CONSUME_V1',
            "local raw = redis.call('GET', KEYS[1])",
            "if not raw then return {'invalid'} end",
            'local challenge = cjson.decode(raw)',
            "if challenge.schemaVersion ~= 'dani_anam_agentmail_otp_v1' or challenge.challengeId ~= ARGV[1] or challenge.browserSessionId ~= ARGV[2] then return {'invalid'} end",
            "if ARGV[3] >= challenge.expiresAt then redis.call('DEL', KEYS[1]); return {'expired'} end",
            'if challenge.otpHash ~= ARGV[4] then',
            '  challenge.attemptCount = (challenge.attemptCount or 0) + 1',
            '  if challenge.attemptCount >= tonumber(ARGV[5]) then redis.call(\'DEL\', KEYS[1]); return {\'locked\'} end',
            "  local ttl = redis.call('TTL', KEYS[1])",
            "  if ttl > 0 then redis.call('SET', KEYS[1], cjson.encode(challenge), 'EX', ttl) end",
            "  return {'invalid'}",
            'end',
            "redis.call('DEL', KEYS[1])",
            "return {'verified', challenge.contactToken}",
        ].join(' '),
        1,
        followUpOtpKey(input.challengeId),
        input.challengeId,
        input.browserSessionId,
        now,
        followUpOtpHash(input.challengeId, code, input.contactSecret),
        FOLLOW_UP_OTP_MAX_ATTEMPTS,
    ], options);
    if (!Array.isArray(result) || result.length < 1) {
        throw new Error(`Dani follow-up verification returned an invalid result (${redisResultShape(result)})`);
    }
    const status = String(result[0]);
    if (status === 'verified') {
        const contactToken = String(result[1] ?? '');
        const contact = readDaniAnamContactToken({
            token: contactToken,
            browserSessionId: input.browserSessionId,
            secret: input.contactSecret,
        });
        if (!contact || contact.purpose !== 'dani_follow_up') {
            throw new Error('Dani follow-up verification returned an invalid contact');
        }
        return { status, contactToken };
    }
    if (status === 'invalid' || status === 'expired' || status === 'locked') return { status };
    throw new Error('Dani follow-up verification returned an invalid status');
}

export async function cancelDaniAnamFollowUpOtpChallenge(
    challengeId: string,
    options: Options = {},
) {
    if (!isDaniAnamFollowUpOtpChallengeId(challengeId)) return false;
    return Number(await redisCommand(['DEL', followUpOtpKey(challengeId)], options) ?? 0) > 0;
}

export async function storeDaniAnamFollowUpAuthorization(input: {
    browserSessionId: string;
    contactToken: string;
    contactSecret: string;
}, options: Options = {}) {
    const contact = readDaniAnamContactToken({
        token: input.contactToken,
        browserSessionId: input.browserSessionId,
        secret: input.contactSecret,
    });
    if (
        !contact
        || contact.purpose !== 'dani_follow_up'
        || contact.emailOwnershipVerified !== true
        || !contact.displayName
    ) {
        throw new Error('Dani AgentMail authorization was invalid');
    }
    const stored = await redisCommand([
        'SET',
        authorizationKey(input.browserSessionId),
        input.contactToken,
        'EX',
        AMY_ANAM_CONTACT_TTL_SECONDS,
    ], options);
    if (stored !== 'OK') throw new Error('Dani AgentMail authorization could not be stored');
    return { stored: true as const, rawEmailStored: false as const };
}

export async function finalizeDaniAnamVerifiedFollowUpAuthorization(input: {
    browserSessionId: string;
    contactToken: string;
    contactSecret: string;
}, options: Options = {}) {
    const contact = readDaniAnamContactToken({
        token: input.contactToken,
        browserSessionId: input.browserSessionId,
        secret: input.contactSecret,
    });
    if (!contact || contact.purpose !== 'dani_follow_up' || !contact.displayName) {
        throw new Error('Dani verified follow-up authorization was invalid');
    }
    const verifiedContactToken = contact.emailOwnershipVerified === true
        ? input.contactToken
        : createDaniAnamContactToken({
            browserSessionId: input.browserSessionId,
            displayName: contact.displayName,
            email: contact.email,
            purpose: 'dani_follow_up',
            emailOwnershipVerified: true,
            secret: input.contactSecret,
        });
    try {
        await storeDaniAnamFollowUpAuthorization({
            ...input,
            contactToken: verifiedContactToken,
        }, options);
        return { contact, contactToken: verifiedContactToken, authorizationStored: true as const };
    } catch {
        // The encrypted, HttpOnly cookie remains the authoritative browser handoff.
        // Returning the already-verified token lets the route finish after a transient
        // Redis write failure without asking the visitor to replay a consumed code.
        return { contact, contactToken: verifiedContactToken, authorizationStored: false as const };
    }
}

export async function readDaniAnamFollowUpAuthorization(input: {
    browserSessionId: string;
    contactSecret: string;
}, options: Options = {}) {
    const token = await redisCommand(['GET', authorizationKey(input.browserSessionId)], options);
    if (typeof token !== 'string' || !token) return null;
    const contact = readDaniAnamContactToken({
        token,
        browserSessionId: input.browserSessionId,
        secret: input.contactSecret,
    });
    return contact?.purpose === 'dani_follow_up'
        && contact.emailOwnershipVerified === true
        && contact.displayName
        ? contact
        : null;
}

export async function clearDaniAnamFollowUpAuthorization(
    browserSessionId: string,
    options: Options = {},
) {
    await redisCommand(['DEL', authorizationKey(browserSessionId)], options, false);
    return { cleared: true as const };
}

export async function queueDaniAnamConversationFollowUp(input: {
    externalSessionId: string;
    browserSessionId: string;
    displayName: string;
    email: string;
    contactSecret: string;
}, options: Options = {}) {
    if (!readDaniAnamAgentMailConfig(options.env ?? process.env).effectiveGateOpen) {
        throw new Error('Dani AgentMail is unavailable');
    }
    if (Number(await redisCommand(['EXISTS', cancellationKey(input.externalSessionId)], options)) === 1) {
        return {
            status: 'email_cancelled' as const,
            queued: false as const,
            sent: false as const,
            duplicate: true,
            receiptId: null,
            provider: 'agentmail' as const,
        };
    }
    const receiptId = createHash('sha256')
        .update(`dani:anam:agentmail:intent:v1:${input.externalSessionId}`)
        .digest('hex')
        .slice(0, 32);
    const intent: Intent = {
        schemaVersion: 'dani_anam_agentmail_intent_v1',
        externalSessionId: input.externalSessionId,
        browserSessionId: input.browserSessionId,
        status: 'queued',
        receiptId,
        displayName: input.displayName.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120),
        contactToken: createDaniAnamContactToken({
            browserSessionId: input.browserSessionId,
            email: input.email,
            displayName: input.displayName,
            purpose: 'dani_follow_up',
            emailOwnershipVerified: true,
            secret: input.contactSecret,
            ttlSeconds: TTL_SECONDS,
        }),
        requestedAt: new Date().toISOString(),
        rawEmailStored: false,
        transcriptStored: false,
        messageContentStored: false,
    };
    const reserved = await redisCommand([
        'SET', intentKey(input.externalSessionId), JSON.stringify(intent), 'NX', 'EX', TTL_SECONDS,
    ], options);
    if (reserved !== 'OK') {
        const existing = parse<Intent>(
            await redisCommand(['GET', intentKey(input.externalSessionId)], options),
            'dani_anam_agentmail_intent_v1',
        );
        if (!existing) throw new Error('Dani AgentMail intent reservation conflicted');
        return {
            status: 'email_already_queued' as const,
            queued: true as const,
            sent: false as const,
            duplicate: true,
            receiptId: existing.receiptId,
            provider: 'agentmail' as const,
        };
    }
    return {
        status: 'email_queued' as const,
        queued: true as const,
        sent: false as const,
        duplicate: false,
        receiptId,
        provider: 'agentmail' as const,
    };
}

export async function cancelDaniAnamConversationFollowUp(input: {
    externalSessionId: string;
    browserSessionId: string;
}, options: Options = {}) {
    const cancellation = {
        schemaVersion: 'dani_anam_agentmail_cancellation_v1',
        externalSessionId: input.externalSessionId,
        browserSessionId: input.browserSessionId,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        contentStored: false,
    };
    const existing = Number(await redisCommand([
        'EXISTS', cancellationKey(input.externalSessionId),
    ], options, false)) === 1;
    await redisCommand([
        'SET', cancellationKey(input.externalSessionId), JSON.stringify(cancellation), 'EX', TTL_SECONDS,
    ], options, false);
    await redisCommand(['DEL', intentKey(input.externalSessionId)], options, false).catch(() => undefined);
    await removeDaniAnamEmailRetryDueEntry(input.externalSessionId, options).catch(() => undefined);
    return {
        status: 'email_cancelled' as const,
        queued: false as const,
        sent: false as const,
        duplicate: existing,
        receiptId: null,
        provider: 'agentmail' as const,
    };
}

export async function scheduleDaniAnamEmailRetryAfterDispatchFailure(input: {
    externalSessionId: string;
    retryStartedAt: string;
}, options: Options = {}): Promise<'expired' | 'scheduled'> {
    const retryStartedAt = Date.parse(input.retryStartedAt);
    if (!Number.isFinite(retryStartedAt)) {
        throw new Error('Dani AgentMail retry start was invalid');
    }
    const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
    const retryDeadline = retryStartedAt + DELIVERY_RETRY_WINDOW_MS;
    if (now >= retryDeadline) {
        await removeDaniAnamEmailRetryDueEntry(input.externalSessionId, options);
        return 'expired';
    }
    await scheduleDaniAnamEmailRetryDueEntry({
        externalSessionId: input.externalSessionId,
        dueAt: Math.min(now + DELIVERY_DURABLE_RETRY_DELAY_MS, retryDeadline),
    }, options);
    return 'scheduled';
}

export async function sendDaniAnamConversationFollowUp(input: {
    externalSessionId: string;
    displayName: string;
    email: string;
    sessionStartedAt: string;
    sessionEndedAt: string;
    turns: AmyTranscriptTurn[] | unknown;
}, options: Options = {}): Promise<DaniAnamPostSessionDispatchResult> {
    const config = readDaniAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen) throw new Error('Dani AgentMail is unavailable');
    const turns = normalizeAmyTranscript(input.turns);
    if (!turns.length) return { status: 'transcript_unavailable', sent: false };
    if (!turns.some(turn => turn.role === 'user' && turn.content.trim().length >= 2)) {
        return { status: 'conversation_ineligible', sent: false };
    }

    const receiptId = createHash('sha256')
        .update(`dani:anam:agentmail:v1:${input.externalSessionId}`)
        .digest('hex')
        .slice(0, 32);
    const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
    const pending: Attempt = {
        schemaVersion: 'dani_anam_agentmail_attempt_v1',
        externalSessionId: input.externalSessionId,
        status: 'pending',
        receiptId,
        attemptedAt: new Date(now).toISOString(),
        completedAt: null,
        visitorMessageId: null,
        failureCode: null,
        deliveryStatus: { visitor: false, admin: false, summary: false },
        rawEmailStored: false,
        messageContentStored: false,
    };
    const reserved = await redisCommand([
        'SET', attemptKey(input.externalSessionId), JSON.stringify(pending), 'NX', 'EX', TTL_SECONDS,
    ], options);
    let previous: Attempt | null = null;
    if (reserved !== 'OK') {
        previous = parse<Attempt>(
            await redisCommand(['GET', attemptKey(input.externalSessionId)], options),
            'dani_anam_agentmail_attempt_v1',
        );
        if (
            !previous
            || previous.externalSessionId !== input.externalSessionId
            || previous.receiptId !== receiptId
        ) throw new Error('Dani AgentMail attempt reservation conflicted');
        if (countDelivered(previous.deliveryStatus) === 3) {
            return {
                status: 'email_already_attempted',
                sent: true,
                duplicate: true,
                receiptId: previous.receiptId,
                provider: 'agentmail',
                deliveryCount: 3,
                visitorSent: true,
                internalNotificationsSent: true,
            };
        }
        const firstAttemptAt = Date.parse(previous.attemptedAt);
        if (
            !Number.isFinite(firstAttemptAt)
            || now - firstAttemptAt >= DELIVERY_RETRY_WINDOW_MS
        ) {
            await removeDaniAnamEmailRetryDueEntry(input.externalSessionId, options).catch(() => undefined);
            const deliveryCount = countDelivered(previous.deliveryStatus);
            return {
                status: 'email_retry_expired',
                sent: false,
                duplicate: true,
                receiptId: previous.receiptId,
                provider: 'agentmail',
                deliveryCount,
                visitorSent: previous.deliveryStatus.visitor,
                internalNotificationsSent: previous.deliveryStatus.admin && previous.deliveryStatus.summary,
            };
        }
    }

    const baseline = previous ?? pending;
    const bundle = buildDaniEmailBundle({
        displayName: input.displayName,
        verifiedEmail: input.email,
        externalSessionId: input.externalSessionId,
        sessionStartedAt: input.sessionStartedAt,
        sessionEndedAt: input.sessionEndedAt,
        generatedAt: input.sessionEndedAt,
        turns,
    });
    const laneMessages = {
        visitor: { to: input.email, ...bundle.visitor },
        admin: { to: config.adminEmail, ...bundle.admin },
        summary: { to: config.summaryEmail, ...bundle.summary },
    } as const;
    const lanes = Object.keys(laneMessages) as DeliveryLane[];
    const persistedLaneIds = Object.fromEntries(await Promise.all(lanes.map(async lane => [
        lane,
        await redisCommand(['GET', deliveryLaneKey(input.externalSessionId, lane)], options),
    ]))) as Record<DeliveryLane, unknown>;
    const deliveryStatus: DeliveryStatus = {
        visitor: baseline.deliveryStatus.visitor || typeof persistedLaneIds.visitor === 'string',
        admin: baseline.deliveryStatus.admin || typeof persistedLaneIds.admin === 'string',
        summary: baseline.deliveryStatus.summary || typeof persistedLaneIds.summary === 'string',
    };

    let refreshedLaneIds = persistedLaneIds;
    for (let round = 0; round < DELIVERY_MAX_ROUNDS && countDelivered(deliveryStatus) < 3; round += 1) {
        await Promise.allSettled(lanes
            .filter(lane => !deliveryStatus[lane])
            .map(async lane => {
                const result = await sendAmyEmailWithAgentMail(laneMessages[lane], {
                    ...options,
                    env: config.providerEnv,
                    idempotencyKey: `dani.${receiptId}.${lane}.v1`,
                });
                const stored = await redisCommand([
                    'SET', deliveryLaneKey(input.externalSessionId, lane), result.messageId, 'EX', TTL_SECONDS,
                ], options);
                if (stored !== 'OK') throw new Error('Dani AgentMail lane receipt could not be stored');
            }));

        refreshedLaneIds = Object.fromEntries(await Promise.all(lanes.map(async lane => [
            lane,
            await redisCommand(['GET', deliveryLaneKey(input.externalSessionId, lane)], options),
        ]))) as Record<DeliveryLane, unknown>;
        for (const lane of lanes) {
            deliveryStatus[lane] = deliveryStatus[lane] || typeof refreshedLaneIds[lane] === 'string';
        }
        if (countDelivered(deliveryStatus) < 3 && round < DELIVERY_MAX_ROUNDS - 1) {
            await new Promise(resolve => setTimeout(resolve, DELIVERY_RETRY_DELAYS_MS[round]));
        }
    }
    const deliveredCount = countDelivered(deliveryStatus);
    const allDelivered = deliveredCount === 3;
    const noneDelivered = deliveredCount === 0;
    const completed: Attempt = {
        ...baseline,
        status: allDelivered ? 'sent' : noneDelivered ? 'failed' : 'partial',
        completedAt: new Date().toISOString(),
        visitorMessageId: typeof refreshedLaneIds.visitor === 'string'
            ? refreshedLaneIds.visitor
            : baseline.visitorMessageId,
        adminMessageId: typeof refreshedLaneIds.admin === 'string'
            ? refreshedLaneIds.admin
            : baseline.adminMessageId ?? null,
        summaryMessageId: typeof refreshedLaneIds.summary === 'string'
            ? refreshedLaneIds.summary
            : baseline.summaryMessageId ?? null,
        failureCode: allDelivered ? null : noneDelivered ? 'delivery_rejected_or_unknown' : 'delivery_partial',
        deliveryStatus,
    };
    const receiptStored = await redisCommand([
        'SET', attemptKey(input.externalSessionId), JSON.stringify(completed), 'XX', 'EX', TTL_SECONDS,
    ], options);
    if (receiptStored !== 'OK') throw new Error('Dani AgentMail attempt receipt could not be updated');
    if (allDelivered) {
        await removeDaniAnamEmailRetryDueEntry(input.externalSessionId, options).catch(() => undefined);
    } else {
        await scheduleDaniAnamEmailRetryAfterDispatchFailure({
            externalSessionId: input.externalSessionId,
            retryStartedAt: completed.attemptedAt,
        }, options);
    }
    return {
        status: allDelivered ? 'email_sent' : noneDelivered ? 'email_failed' : 'email_partial',
        sent: allDelivered,
        duplicate: previous !== null,
        receiptId,
        provider: 'agentmail',
        deliveryCount: deliveredCount,
        visitorSent: deliveryStatus.visitor,
        internalNotificationsSent: deliveryStatus.admin && deliveryStatus.summary,
    };
}

export async function dispatchDaniAnamPostSessionFollowUp(input: {
    session: AmyAnamSessionRecord;
    receipt: AmyAnamSessionReceipt;
    turns: AmyTranscriptTurn[] | unknown;
}, options: Options = {}): Promise<DaniAnamPostSessionDispatchResult> {
    if (!readDaniAnamAgentMailConfig(options.env ?? process.env).effectiveGateOpen) {
        return { status: 'email_unavailable', sent: false };
    }
    if (input.receipt.status !== 'completed') {
        return { status: 'transcript_unavailable', sent: false };
    }
    if (Number(await redisCommand(['EXISTS', cancellationKey(input.session.externalSessionId)], options)) === 1) {
        return { status: 'email_cancelled', sent: false };
    }
    const intent = parse<Intent>(
        await redisCommand(['GET', intentKey(input.session.externalSessionId)], options),
        'dani_anam_agentmail_intent_v1',
    );
    if (!intent) return { status: 'email_not_requested', sent: false };
    if (
        intent.externalSessionId !== input.session.externalSessionId
        || intent.browserSessionId !== input.session.browserSessionId
        || input.receipt.externalSessionId !== input.session.externalSessionId
        || input.session.agentSlug !== 'dani'
    ) throw new Error('Dani AgentMail post-session ownership did not match');

    const config = readDaniAnamAgentMailConfig(options.env ?? process.env);
    const contact = readDaniAnamContactToken({
        token: intent.contactToken,
        browserSessionId: input.session.browserSessionId,
        secret: config.contactSecret,
    });
    if (
        !contact
        || contact.purpose !== 'dani_follow_up'
        || contact.emailOwnershipVerified !== true
    ) {
        throw new Error('Dani AgentMail contact token expired or was invalid');
    }
    const result = await sendDaniAnamConversationFollowUp({
        externalSessionId: input.session.externalSessionId,
        displayName: intent.displayName,
        email: contact.email,
        sessionStartedAt: input.session.boundAt,
        sessionEndedAt: input.session.closeReceivedAt || input.receipt.completedAt,
        turns: input.turns,
    }, options);
    if (result.sent) {
        await redisCommand(['DEL', intentKey(input.session.externalSessionId)], options).catch(() => undefined);
    }
    return result;
}
