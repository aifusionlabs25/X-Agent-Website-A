import type { AmyEmailAttachment, AmyEmailMessage } from './amy-email-provider.ts';

const RESEND_DEFAULT_API_BASE = 'https://api.resend.com';
const RESEND_DEFAULT_FROM = 'Amy from X Agents <hello@aifusionlabs.app>';
const MAX_EMAIL_BODY_CHARACTERS = 30_000;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 512 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 768 * 1024;
const RESEND_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;

type ResendEnvironment = Record<string, string | undefined>;

export type AmyResendSendResult = {
    provider: 'resend';
    sent: true;
    messageId: string;
    threadId: null;
};

function value(source: ResendEnvironment, name: string): string {
    return String(source[name] ?? process.env[name] ?? '').trim();
}

function boundedText(input: unknown, max: number): string {
    return String(input ?? '').normalize('NFKC').trim().slice(0, max);
}

function normalizeRecipient(input: unknown): string {
    const recipient = boundedText(input, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        throw new Error('Resend recipient was invalid');
    }
    return recipient;
}

function normalizeAttachments(input: AmyEmailAttachment[] | undefined) {
    if (!input?.length) return undefined;
    if (input.length > MAX_ATTACHMENTS) throw new Error('Resend attachment count exceeded');
    let totalBytes = 0;
    const attachments = input.map(item => {
        const filename = boundedText(item.filename, 120);
        const contentType = boundedText(item.contentType, 120).toLowerCase();
        const content = String(item.content ?? '').normalize('NFKC');
        const bytes = Buffer.byteLength(content, 'utf8');
        if (!filename || /[\\/\x00-\x1f]/.test(filename)) throw new Error('Resend attachment filename was invalid');
        if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+;-]*(?:\s*;\s*charset=[a-z0-9_-]+)?$/i.test(contentType)) {
            throw new Error('Resend attachment content type was invalid');
        }
        if (!content || bytes > MAX_ATTACHMENT_BYTES) throw new Error('Resend attachment content was invalid');
        totalBytes += bytes;
        return {
            content: Buffer.from(content, 'utf8').toString('base64'),
            filename,
            content_type: contentType,
        };
    });
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Resend total attachment size exceeded');
    return attachments;
}

export function readAmyResendProviderConfig(
    source: ResendEnvironment = process.env,
) {
    const apiKey = value(source, 'RESEND_API_KEY');
    const apiBaseUrl = (value(source, 'RESEND_API_BASE_URL') || RESEND_DEFAULT_API_BASE)
        .replace(/\/$/, '');
    const fromAddress = value(source, 'AMY_RESEND_FROM_ADDRESS') || RESEND_DEFAULT_FROM;
    return {
        apiKey,
        apiBaseUrl,
        fromAddress,
        configured: apiKey.length >= 16
            && apiBaseUrl.startsWith('https://')
            && /<[^\s@]+@aifusionlabs\.app>$|^[^\s@]+@aifusionlabs\.app$/i.test(fromAddress),
    };
}

export async function sendAmyEmailWithResend(
    message: AmyEmailMessage,
    options: {
        env?: ResendEnvironment;
        fetchImpl?: typeof fetch;
        idempotencyKey?: string;
    } = {},
): Promise<AmyResendSendResult> {
    const config = readAmyResendProviderConfig(options.env ?? process.env);
    if (!config.configured) throw new Error('Resend is not configured for Amy');

    const recipient = normalizeRecipient(message.to);
    const subject = boundedText(message.subject, 200);
    const text = boundedText(message.text, MAX_EMAIL_BODY_CHARACTERS);
    const html = boundedText(message.html, MAX_EMAIL_BODY_CHARACTERS);
    const attachments = normalizeAttachments(message.attachments);
    if (!subject || (!text && !html)) throw new Error('Resend message was incomplete');
    const idempotencyKey = options.idempotencyKey?.trim();
    if (idempotencyKey !== undefined && !RESEND_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw new Error('Resend idempotency key was invalid');
    }

    let response: Response;
    try {
        response = await (options.fetchImpl ?? fetch)(`${config.apiBaseUrl}/emails`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
            },
            body: JSON.stringify({
                from: config.fromAddress,
                to: [recipient],
                subject,
                text,
                html,
                reply_to: 'hello@aifusionlabs.app',
                tags: [
                    { name: 'agent', value: 'amy' },
                    { name: 'lane', value: 'visitor' },
                ],
                ...(attachments ? { attachments } : {}),
            }),
            cache: 'no-store',
            signal: AbortSignal.timeout(8_000),
        });
    } catch {
        throw new Error('Resend delivery status is unknown');
    }

    const payload = await response.json().catch(() => null) as { id?: unknown } | null;
    if (!response.ok) throw new Error(`Resend rejected the message (${response.status})`);
    if (typeof payload?.id !== 'string' || !payload.id.trim()) {
        throw new Error('Resend returned an invalid delivery receipt');
    }

    return {
        provider: 'resend',
        sent: true,
        messageId: payload.id.trim().slice(0, 200),
        threadId: null,
    };
}
