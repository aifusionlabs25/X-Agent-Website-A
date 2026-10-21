import { createHash } from 'node:crypto';
import { ALL_AGENTS } from '../agents.ts';
import type { AccessRecord } from './grants.ts';
import { readAccessAuthConfig } from './auth-config.ts';
import { accessRedisCommand } from './redis.ts';
import { accessOwnerEmails } from './owners.ts';

const PREFIX = 'xagent:access:mail:v1:';
const TTL = 120 * 86400;
export type NotificationStatus = 'sent' | 'pending' | 'not-required';

export function accessNotificationMessages(record: AccessRecord) {
    const config = readAccessAuthConfig();
    if (!config.configured) throw new Error('Email configuration unavailable');
    const name = ALL_AGENTS.find(agent => agent.slug === record.agent)?.name;
    if (!name || !record.notificationId) return [];
    const preview = process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV !== 'production';
    const label = preview ? '[PREVIEW] ' : '';
    const review = new URL('/access/admin', config.origin);
    // An opaque record reference, never a permission-bearing token or email address.
    review.searchParams.set('request', record.notificationId);
    const entry = new URL(['/james', '/evan', '/dani'].includes(`/${record.agent}`) ? `/demo/${record.agent}` : `/agents/${record.agent}`, config.origin);
    const requested = record.notificationKind === 'request';
    const permissions = (requested && record.requestedCapabilities?.length ? record.requestedCapabilities : record.capabilities).join(', ');
    const details = `Agent: ${name}\nVisitor: ${record.email}\nPermissions: ${permissions}\n${record.expiresAt ? `Expires: ${record.expiresAt}\n` : ''}`;
    const context = preview ? '\nThis is a preview test. It does not grant access to the live site.\n' : '';
    const subject = requested ? `Access requested: ${name}` : `Access ${record.status}: ${name}`;
    const ownerText = `${subject}\n\n${details}${context}\nReview request: ${review.href}\n\nOwner sign-in is required. Opening this link does not approve access. Decisions must be made on the site; replying to this email does not change permissions.`;
    const messages = accessOwnerEmails().map(to => ({ to, subject: `${label}${subject}`, text: ownerText }));
    if (!requested) messages.push({ to: record.email, subject: `${label}Your ${name} access is ${record.status}`, text:
        `Your access to ${name} is ${record.status}.\n\n${details}${context}\n${record.status === 'approved' ? 'Sign in with this email to continue' : 'View agent access'}: ${entry.href}\n\nNo access code is needed. Revocation blocks new activity; an already running conversation may need to be ended separately.` });
    // Preview is an owner-only mail sandbox by default. Visitor messages can
    // be inspected in the owner's inbox without contacting real visitors.
    if (process.env.VERCEL_ENV === 'preview') {
        const recipient = accessOwnerEmails()[0];
        if (!recipient) throw new Error('Preview owner is not configured');
        return messages.map(message => ({ ...message, to: recipient,
            text: `Preview copy — intended recipient: ${message.to}\n\n${message.text}` }));
    }
    return messages;
}

export async function accessNotificationStatus(record: AccessRecord): Promise<NotificationStatus> {
    if (!record.notificationId) return 'not-required';
    return await accessRedisCommand(['GET', `${PREFIX}complete:${record.notificationId}`]) === '1' ? 'sent' : 'pending';
}

/** The pending event lives on the saved access record, so a failed send can be retried. */
export async function deliverAccessNotifications(record: AccessRecord): Promise<NotificationStatus> {
    if (!record.notificationId) return 'not-required';
    try {
        if (await accessNotificationStatus(record) === 'sent') return 'sent';
        const config = readAccessAuthConfig();
        const messages = accessNotificationMessages(record);
        if (!messages.length) throw new Error('No notification recipient');
        // Freeze the payload for stable provider idempotency even if settings change.
        const eventKey = `${PREFIX}event:${record.notificationId}`;
        await accessRedisCommand(['SET', eventKey, JSON.stringify(messages), 'NX', 'EX', TTL]);
        const raw = await accessRedisCommand(['GET', eventKey]);
        const frozen = (typeof raw === 'string' ? JSON.parse(raw) : raw) as typeof messages;
        for (let index = 0; index < frozen.length; index++) {
            const message = frozen[index];
            const id = createHash('sha256').update(`${config.origin}:${record.notificationId}:${index}`).digest('hex');
            const sentKey = `${PREFIX}sent:${id}`;
            if (await accessRedisCommand(['GET', sentKey]) === '1') continue;
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
                headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `access-${id}` },
                body: JSON.stringify({ from: config.from, ...message }),
            });
            if (!response.ok) throw new Error('Email delivery unavailable');
            await accessRedisCommand(['SET', sentKey, '1', 'EX', TTL]);
        }
        await accessRedisCommand(['SET', `${PREFIX}complete:${record.notificationId}`, '1', 'EX', TTL]);
        return 'sent';
    } catch { return 'pending'; }
}
