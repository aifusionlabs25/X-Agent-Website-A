import { createHash } from 'node:crypto';
import { readAmyAgentMailProviderConfig, sendAmyEmailWithAgentMail } from '../email/amy-email-provider.ts';
import { createAmyAnamContactToken, readAmyAnamContactToken } from './contact-token.ts';
import { buildEvanEmailBundle } from './evan-agentmail-templates.ts';
import { normalizeAmyTranscript, readAmyAnamSpineConfig } from './session-spine.ts';
import type { AmyAnamSessionReceipt, AmyAnamSessionRecord, AmyTranscriptTurn } from './session-spine.ts';

const TTL = 30 * 24 * 60 * 60;
const DEFAULT_INBOX = 'hermes-hal@agentmail.to';
const DEFAULT_INTERNAL = 'aifusionlabs@gmail.com';
type Options = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch };
type PipelineItem = { result?: unknown; error?: string };

type Intent = {
    schemaVersion: 'evan_anam_agentmail_intent_v1';
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

type Attempt = {
    schemaVersion: 'evan_anam_agentmail_attempt_v1';
    externalSessionId: string;
    status: 'pending' | 'sent' | 'failed';
    receiptId: string;
    attemptedAt: string;
    completedAt: string | null;
    visitorMessageId: string | null;
    failureCode: 'delivery_rejected_or_unknown' | null;
    deliveryStatus: { visitor: boolean; admin: boolean; sales: boolean };
    rawEmailStored: false;
    messageContentStored: false;
};

const envValue = (source: NodeJS.ProcessEnv, name: string) => String(source[name] ?? '').trim();
const flag = (source: NodeJS.ProcessEnv, evan: string, amy: string) => envValue(source, evan) || envValue(source, amy);

export function readEvanAnamAgentMailConfig(source: NodeJS.ProcessEnv = process.env) {
    const spine = readAmyAnamSpineConfig(source);
    const provider = (envValue(source, 'EVAN_EMAIL_PROVIDER') || envValue(source, 'AMY_EMAIL_PROVIDER') || 'agentmail').toLowerCase();
    const inboxAddress = (envValue(source, 'EVAN_AGENTMAIL_ADDRESS') || DEFAULT_INBOX).toLowerCase();
    const providerEnv = { ...source, AMY_AGENTMAIL_ADDRESS: inboxAddress };
    const providerConfig = readAmyAgentMailProviderConfig(providerEnv);
    const requestedGateOpen =
        flag(source, 'EVAN_ANAM_AGENTMAIL_ENABLED', 'AMY_ANAM_AGENTMAIL_ENABLED') === 'true'
        && flag(source, 'EVAN_ANAM_AGENTMAIL_KILL_SWITCH', 'AMY_ANAM_AGENTMAIL_KILL_SWITCH') === 'false'
        && flag(source, 'EVAN_ANAM_TOOLS_ENABLED', 'AMY_ANAM_TOOLS_ENABLED') === 'true'
        && flag(source, 'EVAN_ANAM_TOOLS_KILL_SWITCH', 'AMY_ANAM_TOOLS_KILL_SWITCH') === 'false'
        && flag(source, 'EVAN_ANAM_OUTBOUND_ACTIONS_ENABLED', 'AMY_ANAM_OUTBOUND_ACTIONS_ENABLED') === 'true'
        && flag(source, 'EVAN_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH', 'AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH') === 'false';
    const configured = provider === 'agentmail' && providerConfig.configured && spine.configured;
    return {
        provider,
        inboxAddress,
        adminEmail: (envValue(source, 'EVAN_MULLINS_ADMIN_EMAIL') || DEFAULT_INTERNAL).toLowerCase(),
        salesEmail: (envValue(source, 'EVAN_MULLINS_SALES_EMAIL') || DEFAULT_INTERNAL).toLowerCase(),
        configured,
        requestedGateOpen,
        effectiveGateOpen: configured && requestedGateOpen && spine.gatesOpen,
        redisUrl: spine.redisUrl,
        redisToken: spine.redisToken,
        providerEnv,
    };
}

const intentKey = (id: string) => `xagent:evan:anam:agentmail:intent:v1:${id}`;
const attemptKey = (id: string) => `xagent:evan:anam:agentmail:attempt:v1:${id}`;

async function redisCommand(command: Array<string | number>, options: Options = {}): Promise<unknown> {
    const config = readEvanAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen) throw new Error('Evan AgentMail is unavailable');
    let response: Response;
    try {
        response = await (options.fetchImpl ?? fetch)(`${config.redisUrl}/pipeline`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.redisToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([command]),
            cache: 'no-store',
            signal: AbortSignal.timeout(3_000),
        });
    } catch {
        throw new Error('Evan AgentMail receipt store request failed');
    }
    if (!response.ok) throw new Error('Evan AgentMail receipt store returned an error');
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) throw new Error('Evan AgentMail receipt response was too large');
    const payload = JSON.parse(raw) as PipelineItem[];
    if (!Array.isArray(payload) || payload.length !== 1 || payload[0]?.error) {
        throw new Error('Evan AgentMail receipt response was invalid');
    }
    return payload[0]?.result ?? null;
}

function parse<T>(raw: unknown, schema: string): T | null {
    if (raw === null || raw === undefined) return null;
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { schemaVersion?: unknown }).schemaVersion !== schema) {
        throw new Error('Evan AgentMail receipt was invalid');
    }
    return value as T;
}

export async function queueEvanAnamConversationFollowUp(input: {
    externalSessionId: string;
    browserSessionId: string;
    displayName: string;
    email: string;
    contactSecret: string;
}, options: Options = {}) {
    if (!readEvanAnamAgentMailConfig(options.env ?? process.env).effectiveGateOpen) throw new Error('Evan AgentMail is unavailable');
    const receiptId = createHash('sha256').update(`evan:anam:agentmail:intent:v1:${input.externalSessionId}`).digest('hex').slice(0, 32);
    const intent: Intent = {
        schemaVersion: 'evan_anam_agentmail_intent_v1',
        externalSessionId: input.externalSessionId,
        browserSessionId: input.browserSessionId,
        status: 'queued',
        receiptId,
        displayName: input.displayName.normalize('NFKC').trim().slice(0, 120),
        contactToken: createAmyAnamContactToken({
            browserSessionId: input.browserSessionId,
            email: input.email,
            displayName: input.displayName,
            purpose: 'evan_follow_up',
            secret: input.contactSecret,
            ttlSeconds: TTL,
        }),
        requestedAt: new Date().toISOString(),
        rawEmailStored: false,
        transcriptStored: false,
        messageContentStored: false,
    };
    const reserved = await redisCommand(['SET', intentKey(input.externalSessionId), JSON.stringify(intent), 'NX', 'EX', TTL], options);
    if (reserved !== 'OK') {
        const existing = parse<Intent>(await redisCommand(['GET', intentKey(input.externalSessionId)], options), 'evan_anam_agentmail_intent_v1');
        if (!existing) throw new Error('Evan AgentMail intent reservation conflicted');
        return { status: 'email_already_queued' as const, queued: true as const, sent: false as const, duplicate: true, receiptId: existing.receiptId, provider: 'agentmail' as const };
    }
    return { status: 'email_queued' as const, queued: true as const, sent: false as const, duplicate: false, receiptId, provider: 'agentmail' as const };
}

export async function sendEvanAnamConversationFollowUp(input: {
    externalSessionId: string;
    displayName: string;
    email: string;
    sessionStartedAt: string;
    sessionEndedAt: string;
    turns: AmyTranscriptTurn[] | unknown;
}, options: Options = {}) {
    const config = readEvanAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen) throw new Error('Evan AgentMail is unavailable');
    const receiptId = createHash('sha256').update(`evan:anam:agentmail:v1:${input.externalSessionId}`).digest('hex').slice(0, 32);
    const pending: Attempt = {
        schemaVersion: 'evan_anam_agentmail_attempt_v1',
        externalSessionId: input.externalSessionId,
        status: 'pending',
        receiptId,
        attemptedAt: new Date().toISOString(),
        completedAt: null,
        visitorMessageId: null,
        failureCode: null,
        deliveryStatus: { visitor: false, admin: false, sales: false },
        rawEmailStored: false,
        messageContentStored: false,
    };
    const reserved = await redisCommand(['SET', attemptKey(input.externalSessionId), JSON.stringify(pending), 'NX', 'EX', TTL], options);
    if (reserved !== 'OK') {
        const existing = parse<Attempt>(await redisCommand(['GET', attemptKey(input.externalSessionId)], options), 'evan_anam_agentmail_attempt_v1');
        if (!existing) throw new Error('Evan AgentMail attempt reservation conflicted');
        return {
            status: 'email_already_attempted' as const, sent: existing.status === 'sent', duplicate: true,
            receiptId: existing.receiptId, provider: 'agentmail' as const,
            deliveryCount: Object.values(existing.deliveryStatus).filter(Boolean).length,
            visitorSent: existing.deliveryStatus.visitor,
            internalNotificationsSent: existing.deliveryStatus.admin && existing.deliveryStatus.sales,
        };
    }
    try {
        const bundle = buildEvanEmailBundle({
            displayName: input.displayName,
            verifiedEmail: input.email,
            externalSessionId: input.externalSessionId,
            sessionStartedAt: input.sessionStartedAt,
            sessionEndedAt: input.sessionEndedAt,
            turns: normalizeAmyTranscript(input.turns),
        });
        const providerOptions = { ...options, env: config.providerEnv };
        const [visitor, admin, sales] = await Promise.allSettled([
            sendAmyEmailWithAgentMail({ to: input.email, ...bundle.visitor }, providerOptions),
            sendAmyEmailWithAgentMail({ to: config.adminEmail, ...bundle.admin }, providerOptions),
            sendAmyEmailWithAgentMail({ to: config.salesEmail, ...bundle.sales }, providerOptions),
        ]);
        if (visitor.status === 'rejected') throw new Error('Visitor delivery was not confirmed');
        const deliveryStatus = { visitor: true, admin: admin.status === 'fulfilled', sales: sales.status === 'fulfilled' };
        const sent: Attempt = {
            ...pending, status: 'sent', completedAt: new Date().toISOString(),
            visitorMessageId: visitor.value.messageId, deliveryStatus,
        };
        await redisCommand(['SET', attemptKey(input.externalSessionId), JSON.stringify(sent), 'XX', 'EX', TTL], options);
        return {
            status: 'email_sent' as const, sent: true, duplicate: false, receiptId,
            provider: 'agentmail' as const, deliveryCount: Object.values(deliveryStatus).filter(Boolean).length,
            visitorSent: true, internalNotificationsSent: deliveryStatus.admin && deliveryStatus.sales,
        };
    } catch {
        const failed: Attempt = { ...pending, status: 'failed', completedAt: new Date().toISOString(), failureCode: 'delivery_rejected_or_unknown' };
        await redisCommand(['SET', attemptKey(input.externalSessionId), JSON.stringify(failed), 'XX', 'EX', TTL], options).catch(() => undefined);
        throw new Error('Evan could not confirm email delivery');
    }
}

export async function dispatchEvanAnamPostSessionFollowUp(input: {
    session: AmyAnamSessionRecord;
    receipt: AmyAnamSessionReceipt;
    turns: AmyTranscriptTurn[] | unknown;
}, options: Options = {}) {
    if (!readEvanAnamAgentMailConfig(options.env ?? process.env).effectiveGateOpen) {
        return { status: 'email_unavailable' as const, sent: false as const };
    }
    const intent = parse<Intent>(await redisCommand(['GET', intentKey(input.session.externalSessionId)], options), 'evan_anam_agentmail_intent_v1');
    if (!intent) return { status: 'email_not_requested' as const, sent: false as const };
    if (intent.browserSessionId !== input.session.browserSessionId || input.receipt.externalSessionId !== input.session.externalSessionId) {
        throw new Error('Evan AgentMail post-session ownership did not match');
    }
    const spine = readAmyAnamSpineConfig(options.env ?? process.env);
    const contact = readAmyAnamContactToken({
        token: intent.contactToken,
        browserSessionId: input.session.browserSessionId,
        secret: spine.signingSecret,
    });
    if (!contact || contact.purpose !== 'evan_follow_up') {
        throw new Error('Evan AgentMail contact token expired or was invalid');
    }
    const result = await sendEvanAnamConversationFollowUp({
        externalSessionId: input.session.externalSessionId,
        displayName: intent.displayName,
        email: contact.email,
        sessionStartedAt: input.session.boundAt,
        sessionEndedAt: input.session.closeReceivedAt || input.receipt.completedAt,
        turns: input.turns,
    }, options);
    if (result.sent) await redisCommand(['DEL', intentKey(input.session.externalSessionId)], options).catch(() => undefined);
    return result;
}
