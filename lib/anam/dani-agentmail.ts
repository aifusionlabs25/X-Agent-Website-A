import { createHash } from 'node:crypto';
import { readAmyAgentMailProviderConfig, sendAmyEmailWithAgentMail } from '../email/amy-email-provider.ts';
import { createAmyAnamContactToken, readAmyAnamContactToken } from './contact-token.ts';
import { buildDaniEmailBundle } from './dani-agentmail-templates.ts';
import { normalizeAmyTranscript, readAmyAnamSpineConfig } from './session-spine.ts';
import type { AmyAnamSessionReceipt, AmyAnamSessionRecord, AmyTranscriptTurn } from './session-spine.ts';

const TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_INBOX = 'hermes-hal@agentmail.to';
const DEFAULT_INTERNAL_EMAIL = 'aifusionlabs@gmail.com';

type Options = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch };
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

type Attempt = {
    schemaVersion: 'dani_anam_agentmail_attempt_v1';
    externalSessionId: string;
    status: 'pending' | 'sent' | 'partial' | 'failed';
    receiptId: string;
    attemptedAt: string;
    completedAt: string | null;
    visitorMessageId: string | null;
    failureCode: 'delivery_partial' | 'delivery_rejected_or_unknown' | null;
    deliveryStatus: DeliveryStatus;
    rawEmailStored: false;
    messageContentStored: false;
};

export type DaniAnamPostSessionDispatchResult = {
    status: 'conversation_ineligible' | 'email_already_attempted' | 'email_cancelled' | 'email_failed' | 'email_not_requested' | 'email_partial' | 'email_sent' | 'email_unavailable' | 'transcript_unavailable';
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
        providerEnv,
    };
}

const intentKey = (id: string) => `xagent:dani:anam:agentmail:intent:v1:${id}`;
const attemptKey = (id: string) => `xagent:dani:anam:agentmail:attempt:v1:${id}`;
const cancellationKey = (id: string) => `xagent:dani:anam:agentmail:cancelled:v1:${id}`;

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

function countDelivered(status: DeliveryStatus): number {
    return Object.values(status).filter(Boolean).length;
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
        contactToken: createAmyAnamContactToken({
            browserSessionId: input.browserSessionId,
            email: input.email,
            displayName: input.displayName,
            purpose: 'dani_follow_up',
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
    return {
        status: 'email_cancelled' as const,
        queued: false as const,
        sent: false as const,
        duplicate: existing,
        receiptId: null,
        provider: 'agentmail' as const,
    };
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
    const pending: Attempt = {
        schemaVersion: 'dani_anam_agentmail_attempt_v1',
        externalSessionId: input.externalSessionId,
        status: 'pending',
        receiptId,
        attemptedAt: new Date().toISOString(),
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
    if (reserved !== 'OK') {
        const existing = parse<Attempt>(
            await redisCommand(['GET', attemptKey(input.externalSessionId)], options),
            'dani_anam_agentmail_attempt_v1',
        );
        if (!existing) throw new Error('Dani AgentMail attempt reservation conflicted');
        return {
            status: 'email_already_attempted',
            sent: existing.status === 'sent',
            duplicate: true,
            receiptId: existing.receiptId,
            provider: 'agentmail',
            deliveryCount: countDelivered(existing.deliveryStatus),
            visitorSent: existing.deliveryStatus.visitor,
            internalNotificationsSent: existing.deliveryStatus.admin && existing.deliveryStatus.summary,
        };
    }

    try {
        const bundle = buildDaniEmailBundle({
            displayName: input.displayName,
            verifiedEmail: input.email,
            externalSessionId: input.externalSessionId,
            sessionStartedAt: input.sessionStartedAt,
            sessionEndedAt: input.sessionEndedAt,
            turns,
        });
        const providerOptions = { ...options, env: config.providerEnv };
        const [visitor, admin, summary] = await Promise.allSettled([
            sendAmyEmailWithAgentMail({ to: input.email, ...bundle.visitor }, providerOptions),
            sendAmyEmailWithAgentMail({ to: config.adminEmail, ...bundle.admin }, providerOptions),
            sendAmyEmailWithAgentMail({ to: config.summaryEmail, ...bundle.summary }, providerOptions),
        ]);
        const deliveryStatus = {
            visitor: visitor.status === 'fulfilled',
            admin: admin.status === 'fulfilled',
            summary: summary.status === 'fulfilled',
        };
        const allDelivered = countDelivered(deliveryStatus) === 3;
        const noneDelivered = countDelivered(deliveryStatus) === 0;
        const completed: Attempt = {
            ...pending,
            status: allDelivered ? 'sent' : noneDelivered ? 'failed' : 'partial',
            completedAt: new Date().toISOString(),
            visitorMessageId: visitor.status === 'fulfilled' ? visitor.value.messageId : null,
            failureCode: allDelivered ? null : noneDelivered ? 'delivery_rejected_or_unknown' : 'delivery_partial',
            deliveryStatus,
        };
        await redisCommand([
            'SET', attemptKey(input.externalSessionId), JSON.stringify(completed), 'XX', 'EX', TTL_SECONDS,
        ], options);
        return {
            status: allDelivered ? 'email_sent' : noneDelivered ? 'email_failed' : 'email_partial',
            sent: allDelivered,
            duplicate: false,
            receiptId,
            provider: 'agentmail',
            deliveryCount: countDelivered(deliveryStatus),
            visitorSent: deliveryStatus.visitor,
            internalNotificationsSent: deliveryStatus.admin && deliveryStatus.summary,
        };
    } catch {
        const failed: Attempt = {
            ...pending,
            status: 'failed',
            completedAt: new Date().toISOString(),
            failureCode: 'delivery_rejected_or_unknown',
        };
        await redisCommand([
            'SET', attemptKey(input.externalSessionId), JSON.stringify(failed), 'XX', 'EX', TTL_SECONDS,
        ], options).catch(() => undefined);
        throw new Error('Dani could not confirm the three-email bundle');
    }
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

    const spine = readAmyAnamSpineConfig(options.env ?? process.env);
    const contact = readAmyAnamContactToken({
        token: intent.contactToken,
        browserSessionId: input.session.browserSessionId,
        secret: spine.signingSecret,
    });
    if (!contact || contact.purpose !== 'dani_follow_up') {
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
