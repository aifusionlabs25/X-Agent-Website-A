import { createHash } from 'node:crypto';
import {
    readAmyAgentMailProviderConfig,
    sendAmyEmailWithAgentMail,
} from '../email/amy-email-provider.ts';
import type { AmyTranscriptTurn } from './session-spine.ts';
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
    rawEmailStored: false;
    messageContentStored: false;
};

export type AmyAnamFollowUpResult = {
    status: 'email_sent' | 'email_already_attempted';
    sent: boolean;
    duplicate: boolean;
    receiptId: string;
    provider: 'agentmail';
};

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
    if (
        record.schemaVersion !== 'amy_anam_agentmail_attempt_v1'
        || typeof record.externalSessionId !== 'string'
        || !['pending', 'sent', 'failed'].includes(String(record.status))
        || typeof record.receiptId !== 'string'
        || record.provider !== 'agentmail'
        || record.rawEmailStored !== false
        || record.messageContentStored !== false
    ) throw new Error('Amy AgentMail attempt receipt was invalid');
    return record as AmyAnamEmailAttemptRecord;
}

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function buildAmyConversationFollowUp(input: {
    displayName: string;
    turns: AmyTranscriptTurn[];
}) {
    const model = buildAmyWorkbenchModel(input.turns);
    const facts = model.facts
        .filter(fact => fact.section !== 'Identity')
        .slice(0, 6)
        .map(fact => `${fact.label}: ${fact.value}`);
    const name = String(input.displayName || 'there')
        .replace(/[^\p{L}\p{M}' -]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'there';
    const nextStep = model.brief.nextStep || 'Continue the conversation with the appropriate Insight specialist.';
    const lines = [
        `Hi ${name},`,
        '',
        'Thank you for speaking with Amy. Here is the working follow-up from your conversation.',
        '',
        ...(facts.length ? ['Conversation highlights', ...facts.map(fact => `- ${fact}`), ''] : []),
        `Suggested next step: ${nextStep}`,
        '',
        'This is a conversation working summary, not a final design, quote, commitment, or compliance determination. Reply to this email if you would like to add context or request human follow-up.',
        '',
        'Amy is an AI-powered conversational agent. Important decisions should be confirmed with an appropriate Insight specialist.',
    ];
    const text = lines.join('\n');
    const highlightsHtml = facts.length
        ? `<h2 style="font-size:16px;margin:24px 0 8px">Conversation highlights</h2><ul>${facts.map(fact => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>`
        : '';
    const html = [
        '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;max-width:680px">',
        `<p>Hi ${escapeHtml(name)},</p>`,
        '<p>Thank you for speaking with Amy. Here is the working follow-up from your conversation.</p>',
        highlightsHtml,
        `<p><strong>Suggested next step:</strong> ${escapeHtml(nextStep)}</p>`,
        '<p style="margin-top:28px;color:#52525b">This is a conversation working summary, not a final design, quote, commitment, or compliance determination. Reply to this email if you would like to add context or request human follow-up.</p>',
        '<p style="font-size:12px;color:#71717a;border-top:1px solid #e4e4e7;padding-top:16px">Amy is an AI-powered conversational agent. Important decisions should be confirmed with an appropriate Insight specialist.</p>',
        '</div>',
    ].join('');
    return {
        subject: 'Your conversation with Amy',
        text,
        html,
    };
}

export async function sendAmyAnamConversationFollowUp(input: {
    externalSessionId: string;
    displayName: string;
    email: string;
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
        };
    }

    try {
        const message = buildAmyConversationFollowUp({
            displayName: input.displayName,
            turns,
        });
        const delivery = await sendAmyEmailWithAgentMail({
            to: input.email,
            ...message,
        }, options);
        const sent: AmyAnamEmailAttemptRecord = {
            ...pending,
            status: 'sent',
            completedAt: new Date().toISOString(),
            messageId: delivery.messageId,
            threadId: delivery.threadId,
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
