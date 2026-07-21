const AGENTMAIL_DEFAULT_API_BASE = 'https://api.agentmail.to';
const MAX_EMAIL_BODY_CHARACTERS = 30_000;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 512 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 768 * 1024;

type AgentMailEnvironment = Record<string, string | undefined>;

export type AmyEmailAttachment = {
    filename: string;
    contentType: string;
    content: string;
};

export type AmyEmailMessage = {
    to: string;
    subject: string;
    text: string;
    html: string;
    attachments?: AmyEmailAttachment[];
};

export type AmyAgentMailSendResult = {
    provider: 'agentmail';
    sent: true;
    messageId: string;
    threadId: string | null;
};

function value(source: AgentMailEnvironment, name: string): string {
    return String(source[name] ?? process.env[name] ?? '').trim();
}

function boundedText(input: unknown, max: number): string {
    return String(input ?? '').normalize('NFKC').trim().slice(0, max);
}

function normalizeRecipient(input: unknown): string {
    const recipient = boundedText(input, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        throw new Error('AgentMail recipient was invalid');
    }
    return recipient;
}

function normalizeAttachments(input: AmyEmailAttachment[] | undefined) {
    if (!input?.length) return undefined;
    if (input.length > MAX_ATTACHMENTS) throw new Error('AgentMail attachment count exceeded');
    let totalBytes = 0;
    const attachments = input.map(item => {
        const filename = boundedText(item.filename, 120);
        const contentType = boundedText(item.contentType, 120).toLowerCase();
        const content = String(item.content ?? '').normalize('NFKC');
        const bytes = Buffer.byteLength(content, 'utf8');
        if (!filename || /[\\/\x00-\x1f]/.test(filename)) throw new Error('AgentMail attachment filename was invalid');
        if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+;-]*(?:\s*;\s*charset=[a-z0-9_-]+)?$/i.test(contentType)) {
            throw new Error('AgentMail attachment content type was invalid');
        }
        if (!content || bytes > MAX_ATTACHMENT_BYTES) throw new Error('AgentMail attachment content was invalid');
        totalBytes += bytes;
        return {
            content: Buffer.from(content, 'utf8').toString('base64'),
            filename,
            content_type: contentType,
        };
    });
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('AgentMail total attachment size exceeded');
    return attachments;
}

export function readAmyAgentMailProviderConfig(
    source: AgentMailEnvironment = process.env,
) {
    const apiKey = value(source, 'AGENTMAIL_API_KEY');
    const inboxAddress = value(source, 'AMY_AGENTMAIL_ADDRESS').toLowerCase();
    const apiBaseUrl = (value(source, 'AGENTMAIL_API_BASE_URL') || AGENTMAIL_DEFAULT_API_BASE)
        .replace(/\/$/, '');
    return {
        apiKey,
        inboxAddress,
        apiBaseUrl,
        configured: apiKey.length >= 16
            && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inboxAddress)
            && apiBaseUrl.startsWith('https://'),
    };
}

export async function sendAmyEmailWithAgentMail(
    message: AmyEmailMessage,
    options: {
        env?: AgentMailEnvironment;
        fetchImpl?: typeof fetch;
    } = {},
): Promise<AmyAgentMailSendResult> {
    const config = readAmyAgentMailProviderConfig(options.env ?? process.env);
    if (!config.configured) throw new Error('AgentMail is not configured');

    const recipient = normalizeRecipient(message.to);
    const subject = boundedText(message.subject, 200);
    const text = boundedText(message.text, MAX_EMAIL_BODY_CHARACTERS);
    const html = boundedText(message.html, MAX_EMAIL_BODY_CHARACTERS);
    const attachments = normalizeAttachments(message.attachments);
    if (!subject || (!text && !html)) throw new Error('AgentMail message was incomplete');

    let response: Response;
    try {
        response = await (options.fetchImpl ?? fetch)(
            `${config.apiBaseUrl}/v0/inboxes/${encodeURIComponent(config.inboxAddress)}/messages/send`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to: [recipient],
                    subject,
                    text,
                    html,
                    ...(attachments ? { attachments } : {}),
                }),
                cache: 'no-store',
                signal: AbortSignal.timeout(8_000),
            },
        );
    } catch {
        throw new Error('AgentMail delivery status is unknown');
    }

    const payload = await response.json().catch(() => null) as {
        message_id?: unknown;
        thread_id?: unknown;
    } | null;
    if (!response.ok) throw new Error(`AgentMail rejected the message (${response.status})`);
    if (typeof payload?.message_id !== 'string' || !payload.message_id.trim()) {
        throw new Error('AgentMail returned an invalid delivery receipt');
    }

    return {
        provider: 'agentmail',
        sent: true,
        messageId: payload.message_id.trim().slice(0, 200),
        threadId: typeof payload.thread_id === 'string'
            ? payload.thread_id.trim().slice(0, 200) || null
            : null,
    };
}
