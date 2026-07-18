import { createHash } from 'node:crypto';
import {
    readAmyAgentMailProviderConfig,
    sendAmyEmailWithAgentMail,
} from '../email/amy-email-provider.ts';
import { buildAmyEmailBundle } from './agentmail-templates.ts';
import { createAmyAnamContactToken, readAmyAnamContactToken } from './contact-token.ts';
import type { AmyTranscriptTurn } from './session-spine.ts';
import type { AmyAnamSessionReceipt, AmyAnamSessionRecord } from './session-spine.ts';
import {
    normalizeAmyTranscript,
    readAmyAnamSpineConfig,
} from './session-spine.ts';
import { buildAmyWorkbenchModel } from './workbench-v2.ts';

const EMAIL_RECEIPT_TTL_SECONDS = 30 * 24 * 60 * 60;

type AgentMailStoreOptions = {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
};

type RedisPipelineItem = {
    result?: unknown;
    error?: string;
};

export type AmyAnamAgentMailConfig = {
    implemented: true;
    provider: 'agentmail' | 'off' | 'unsupported';
    enabled: boolean;
    killSwitchActive: boolean;
    toolsEnabled: boolean;
    toolsKillSwitchActive: boolean;
    outboundEnabled: boolean;
    outboundKillSwitchActive: boolean;
    configured: boolean;
    requestedGateOpen: boolean;
    effectiveGateOpen: boolean;
    inboxAddressConfigured: boolean;
    apiKeyConfigured: boolean;
    redisUrl: string;
    redisToken: string;
};

type AmyAnamEmailAttemptRecord = {
    schemaVersion: 'amy_anam_agentmail_attempt_v1';
    externalSessionId: string;
    status: 'pending' | 'sent' | 'failed';
    receiptId: string;
    provider: 'agentmail';
    attemptedAt: string;
    completedAt: string | null;
    messageId: string | null;
    threadId: string | null;
    failureCode: 'delivery_rejected_or_unknown' | null;
    deliveryStatus?: {
        visitor: boolean;
        admin: boolean;
        intake: boolean;
    };
    rawEmailStored: false;
    messageContentStored: false;
};

type AmyAnamEmailIntentRecord = {
    schemaVersion: 'amy_anam_agentmail_intent_v1';
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

export type AmyAnamFollowUpQueueResult = {
    status: 'email_queued' | 'email_already_queued';
    queued: true;
    sent: false;
    duplicate: boolean;
    receiptId: string;
    provider: 'agentmail';
};

export type AmyAnamPostSessionDispatchResult = AmyAnamFollowUpResult
    | { status: 'email_not_requested' | 'email_unavailable'; sent: false };

export type AmyAnamFollowUpResult = {
    status: 'email_sent' | 'email_already_attempted';
    sent: boolean;
    duplicate: boolean;
    receiptId: string;
    provider: 'agentmail';
    deliveryCount: number;
    visitorSent: boolean;
    internalNotificationsSent: boolean;
};

const AMY_ADMIN_EMAIL = 'aifusionlabs@gmail.com';
const AMY_INSIGHT_INTAKE_EMAIL = 'aifusionlabs@gmail.com';

function value(source: NodeJS.ProcessEnv, name: string): string {
    return String(source[name] ?? '')
        .trim()
        .replace(/^(?:\uFEFF|\u00EF\u00BB\u00BF|\u00C3\u00AF\u00C2\u00BB\u00C2\u00BF)+/, '')
        .replace(/(?:\\r|\\n)+$/, '')
        .trim();
}

export function readAmyAnamAgentMailConfig(
    source: NodeJS.ProcessEnv = process.env,
): AmyAnamAgentMailConfig {
    const spine = readAmyAnamSpineConfig(source);
    const providerName = value(source, 'AMY_EMAIL_PROVIDER').toLowerCase();
    const provider: AmyAnamAgentMailConfig['provider'] = providerName === 'agentmail'
        ? 'agentmail'
        : providerName === 'off' || !providerName
            ? 'off'
            : 'unsupported';
    const providerConfig = readAmyAgentMailProviderConfig(source);
    const enabled = value(source, 'AMY_ANAM_AGENTMAIL_ENABLED') === 'true';
    const killSwitchActive = value(source, 'AMY_ANAM_AGENTMAIL_KILL_SWITCH') !== 'false';
    const toolsEnabled = value(source, 'AMY_ANAM_TOOLS_ENABLED') === 'true';
    const toolsKillSwitchActive = value(source, 'AMY_ANAM_TOOLS_KILL_SWITCH') !== 'false';
    const outboundEnabled = value(source, 'AMY_ANAM_OUTBOUND_ACTIONS_ENABLED') === 'true';
    const outboundKillSwitchActive = value(source, 'AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH') !== 'false';
    const configured = provider === 'agentmail'
        && providerConfig.configured
        && spine.configured;
    const requestedGateOpen = enabled
        && !killSwitchActive
        && toolsEnabled
        && !toolsKillSwitchActive
        && outboundEnabled
        && !outboundKillSwitchActive;

    return {
        implemented: true,
        provider,
        enabled,
        killSwitchActive,
        toolsEnabled,
        toolsKillSwitchActive,
        outboundEnabled,
        outboundKillSwitchActive,
        configured,
        requestedGateOpen,
        effectiveGateOpen: configured && requestedGateOpen && spine.gatesOpen,
        inboxAddressConfigured: Boolean(providerConfig.inboxAddress),
        apiKeyConfigured: providerConfig.apiKey.length >= 16,
        redisUrl: spine.redisUrl,
        redisToken: spine.redisToken,
    };
}

function attemptKey(externalSessionId: string): string {
    return `xagent:amy:anam:agentmail:attempt:v1:${externalSessionId}`;
}

function intentKey(externalSessionId: string): string {
    return `xagent:amy:anam:agentmail:intent:v1:${externalSessionId}`;
}

async function redisPipeline(
    commands: Array<Array<string | number>>,
    options: AgentMailStoreOptions = {},
): Promise<RedisPipelineItem[]> {
    const config = readAmyAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen) throw new Error('Amy AgentMail is unavailable');

    let response: Response;
    try {
        response = await (options.fetchImpl ?? fetch)(`${config.redisUrl}/pipeline`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.redisToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(commands),
            cache: 'no-store',
            signal: AbortSignal.timeout(3_000),
        });
    } catch {
        throw new Error('Amy AgentMail receipt store request failed');
    }
    if (!response.ok) throw new Error('Amy AgentMail receipt store returned an error');
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) {
        throw new Error('Amy AgentMail receipt store response was too large');
    }
    const payload = JSON.parse(raw) as unknown;
    if (!Array.isArray(payload) || payload.length !== commands.length) {
        throw new Error('Amy AgentMail receipt store response was invalid');
    }
    for (const item of payload as RedisPipelineItem[]) {
        if (item?.error) throw new Error('Amy AgentMail receipt store rejected a command');
    }
    return payload as RedisPipelineItem[];
}

async function redisCommand(
    command: Array<string | number>,
    options: AgentMailStoreOptions,
): Promise<unknown> {
    return (await redisPipeline([command], options))[0]?.result ?? null;
}

function parseAttempt(valueToParse: unknown): AmyAnamEmailAttemptRecord | null {
    if (valueToParse === null || valueToParse === undefined) return null;
    const valueToNormalize = typeof valueToParse === 'string'
        ? JSON.parse(valueToParse) as unknown
        : valueToParse;
    if (!valueToNormalize || typeof valueToNormalize !== 'object' || Array.isArray(valueToNormalize)) {
        throw new Error('Amy AgentMail attempt receipt was invalid');
    }
    const record = valueToNormalize as Partial<AmyAnamEmailAttemptRecord>;
    const deliveryStatusIsValid = record.deliveryStatus === undefined || (
        typeof record.deliveryStatus === 'object'
        && record.deliveryStatus !== null
        && typeof record.deliveryStatus.visitor === 'boolean'
        && typeof record.deliveryStatus.admin === 'boolean'
        && typeof record.deliveryStatus.intake === 'boolean'
    );
    if (
        record.schemaVersion !== 'amy_anam_agentmail_attempt_v1'
        || typeof record.externalSessionId !== 'string'
        || !['pending', 'sent', 'failed'].includes(String(record.status))
        || typeof record.receiptId !== 'string'
        || record.provider !== 'agentmail'
        || !deliveryStatusIsValid
        || record.rawEmailStored !== false
        || record.messageContentStored !== false
    ) throw new Error('Amy AgentMail attempt receipt was invalid');
    return record as AmyAnamEmailAttemptRecord;
}

function parseIntent(valueToParse: unknown): AmyAnamEmailIntentRecord | null {
    if (valueToParse === null || valueToParse === undefined) return null;
    const valueToNormalize = typeof valueToParse === 'string'
        ? JSON.parse(valueToParse) as unknown
        : valueToParse;
    if (!valueToNormalize || typeof valueToNormalize !== 'object' || Array.isArray(valueToNormalize)) {
        throw new Error('Amy AgentMail intent was invalid');
    }
    const record = valueToNormalize as Partial<AmyAnamEmailIntentRecord>;
    if (
        record.schemaVersion !== 'amy_anam_agentmail_intent_v1'
        || typeof record.externalSessionId !== 'string'
        || typeof record.browserSessionId !== 'string'
        || record.status !== 'queued'
        || typeof record.receiptId !== 'string'
        || typeof record.displayName !== 'string'
        || typeof record.contactToken !== 'string'
        || typeof record.requestedAt !== 'string'
        || record.rawEmailStored !== false
        || record.transcriptStored !== false
        || record.messageContentStored !== false
    ) throw new Error('Amy AgentMail intent was invalid');
    return record as AmyAnamEmailIntentRecord;
}

function redactContactData(turns: AmyTranscriptTurn[]): AmyTranscriptTurn[] {
    return turns.map(turn => ({
        ...turn,
        content: String(turn.content ?? '')
            .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[private contact]')
            .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, '[private contact]'),
    }));
}

export function buildAmyConversationFollowUp(input: {
    displayName: string;
    turns: AmyTranscriptTurn[];
}) {
    const turns = redactContactData(input.turns);
    const generatedAt = new Date().toISOString();
    return buildAmyEmailBundle({
        displayName: input.displayName,
        verifiedEmail: 'private contact',
        externalSessionId: 'template-preview',
        sessionStartedAt: generatedAt,
        sessionEndedAt: generatedAt,
        generatedAt,
        turns,
        model: buildAmyWorkbenchModel(turns),
    }).visitor;
}

export async function queueAmyAnamConversationFollowUp(input: {
    externalSessionId: string;
    browserSessionId: string;
    displayName: string;
    email: string;
    contactSecret: string;
}, options: AgentMailStoreOptions = {}): Promise<AmyAnamFollowUpQueueResult> {
    const config = readAmyAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen) throw new Error('Amy AgentMail is unavailable');
    const requestedAt = new Date().toISOString();
    const receiptId = createHash('sha256')
        .update(`amy:anam:agentmail:intent:v1:${input.externalSessionId}`, 'utf8')
        .digest('hex')
        .slice(0, 32);
    const intent: AmyAnamEmailIntentRecord = {
        schemaVersion: 'amy_anam_agentmail_intent_v1',
        externalSessionId: input.externalSessionId,
        browserSessionId: input.browserSessionId,
        status: 'queued',
        receiptId,
        displayName: input.displayName,
        contactToken: createAmyAnamContactToken({
            browserSessionId: input.browserSessionId,
            email: input.email,
            secret: input.contactSecret,
        }),
        requestedAt,
        rawEmailStored: false,
        transcriptStored: false,
        messageContentStored: false,
    };
    const reserved = await redisCommand([
        'SET',
        intentKey(input.externalSessionId),
        JSON.stringify(intent),
        'NX',
        'EX',
        EMAIL_RECEIPT_TTL_SECONDS,
    ], options);
    if (reserved !== 'OK') {
        const existing = parseIntent(await redisCommand([
            'GET',
            intentKey(input.externalSessionId),
        ], options));
        if (!existing) throw new Error('Amy AgentMail intent reservation conflicted');
        return {
            status: 'email_already_queued',
            queued: true,
            sent: false,
            duplicate: true,
            receiptId: existing.receiptId,
            provider: 'agentmail',
        };
    }
    return {
        status: 'email_queued',
        queued: true,
        sent: false,
        duplicate: false,
        receiptId,
        provider: 'agentmail',
    };
}

export async function sendAmyAnamConversationFollowUp(input: {
    externalSessionId: string;
    displayName: string;
    email: string;
    sessionStartedAt: string;
    sessionEndedAt: string;
    turns: AmyTranscriptTurn[] | unknown;
}, options: AgentMailStoreOptions = {}): Promise<AmyAnamFollowUpResult> {
    const config = readAmyAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen) throw new Error('Amy AgentMail is unavailable');
    const turns = normalizeAmyTranscript(input.turns);
    const now = new Date().toISOString();
    const receiptId = createHash('sha256')
        .update(`amy:anam:agentmail:v1:${input.externalSessionId}`, 'utf8')
        .digest('hex')
        .slice(0, 32);
    const pending: AmyAnamEmailAttemptRecord = {
        schemaVersion: 'amy_anam_agentmail_attempt_v1',
        externalSessionId: input.externalSessionId,
        status: 'pending',
        receiptId,
        provider: 'agentmail',
        attemptedAt: now,
        completedAt: null,
        messageId: null,
        threadId: null,
        failureCode: null,
        deliveryStatus: {
            visitor: false,
            admin: false,
            intake: false,
        },
        rawEmailStored: false,
        messageContentStored: false,
    };
    const reserved = await redisCommand([
        'SET',
        attemptKey(input.externalSessionId),
        JSON.stringify(pending),
        'NX',
        'EX',
        EMAIL_RECEIPT_TTL_SECONDS,
    ], options);
    if (reserved !== 'OK') {
        const existing = parseAttempt(await redisCommand([
            'GET',
            attemptKey(input.externalSessionId),
        ], options));
        if (!existing) throw new Error('Amy AgentMail attempt reservation conflicted');
        return {
            status: 'email_already_attempted',
            sent: existing.status === 'sent',
            duplicate: true,
            receiptId: existing.receiptId,
            provider: 'agentmail',
            deliveryCount: existing.deliveryStatus
                ? Object.values(existing.deliveryStatus).filter(Boolean).length
                : existing.status === 'sent' ? 1 : 0,
            visitorSent: existing.deliveryStatus?.visitor ?? existing.status === 'sent',
            internalNotificationsSent: existing.deliveryStatus
                ? existing.deliveryStatus.admin && existing.deliveryStatus.intake
                : false,
        };
    }

    try {
        const safeTurns = redactContactData(turns);
        const bundle = buildAmyEmailBundle({
            displayName: input.displayName,
            verifiedEmail: input.email,
            externalSessionId: input.externalSessionId,
            sessionStartedAt: input.sessionStartedAt,
            sessionEndedAt: input.sessionEndedAt,
            turns: safeTurns,
            model: buildAmyWorkbenchModel(safeTurns),
        });
        const [visitorResult, adminResult, intakeResult] = await Promise.allSettled([
            sendAmyEmailWithAgentMail({ to: input.email, ...bundle.visitor }, options),
            sendAmyEmailWithAgentMail({ to: AMY_ADMIN_EMAIL, ...bundle.admin }, options),
            sendAmyEmailWithAgentMail({ to: AMY_INSIGHT_INTAKE_EMAIL, ...bundle.intake }, options),
        ]);
        if (visitorResult.status === 'rejected') {
            throw new Error('Amy visitor follow-up delivery was not confirmed');
        }
        const deliveryStatus = {
            visitor: true,
            admin: adminResult.status === 'fulfilled',
            intake: intakeResult.status === 'fulfilled',
        };
        if (!deliveryStatus.admin || !deliveryStatus.intake) {
            console.error('[Amy Anam AgentMail] One or more internal notifications were not confirmed');
        }
        const sent: AmyAnamEmailAttemptRecord = {
            ...pending,
            status: 'sent',
            completedAt: new Date().toISOString(),
            messageId: visitorResult.value.messageId,
            threadId: visitorResult.value.threadId,
            deliveryStatus,
        };
        await redisCommand([
            'SET',
            attemptKey(input.externalSessionId),
            JSON.stringify(sent),
            'XX',
            'EX',
            EMAIL_RECEIPT_TTL_SECONDS,
        ], options);
        return {
            status: 'email_sent',
            sent: true,
            duplicate: false,
            receiptId,
            provider: 'agentmail',
            deliveryCount: Object.values(deliveryStatus).filter(Boolean).length,
            visitorSent: true,
            internalNotificationsSent: deliveryStatus.admin && deliveryStatus.intake,
        };
    } catch {
        const failed: AmyAnamEmailAttemptRecord = {
            ...pending,
            status: 'failed',
            completedAt: new Date().toISOString(),
            failureCode: 'delivery_rejected_or_unknown',
        };
        await redisCommand([
            'SET',
            attemptKey(input.externalSessionId),
            JSON.stringify(failed),
            'XX',
            'EX',
            EMAIL_RECEIPT_TTL_SECONDS,
        ], options).catch(() => undefined);
        throw new Error('Amy could not confirm email delivery');
    }
}

export async function dispatchAmyAnamPostSessionFollowUp(input: {
    session: AmyAnamSessionRecord;
    receipt: AmyAnamSessionReceipt;
    turns: AmyTranscriptTurn[] | unknown;
}, options: AgentMailStoreOptions = {}): Promise<AmyAnamPostSessionDispatchResult> {
    const config = readAmyAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen) return { status: 'email_unavailable', sent: false };
    const intent = parseIntent(await redisCommand([
        'GET',
        intentKey(input.session.externalSessionId),
    ], options));
    if (!intent) return { status: 'email_not_requested', sent: false };
    if (
        intent.externalSessionId !== input.session.externalSessionId
        || intent.browserSessionId !== input.session.browserSessionId
        || input.receipt.externalSessionId !== input.session.externalSessionId
    ) throw new Error('Amy AgentMail post-session ownership did not match');
    const spine = readAmyAnamSpineConfig(options.env ?? process.env);
    const contact = readAmyAnamContactToken({
        token: intent.contactToken,
        browserSessionId: input.session.browserSessionId,
        secret: spine.signingSecret,
    });
    if (!contact) throw new Error('Amy AgentMail post-session contact token expired or was invalid');
    const result = await sendAmyAnamConversationFollowUp({
        externalSessionId: input.session.externalSessionId,
        displayName: intent.displayName,
        email: contact.email,
        sessionStartedAt: input.session.boundAt,
        sessionEndedAt: input.session.closeReceivedAt || input.receipt.completedAt,
        turns: input.turns,
    }, options);
    if (result.sent) {
        await redisCommand(['DEL', intentKey(input.session.externalSessionId)], options)
            .catch(() => undefined);
    }
    return result;
}
