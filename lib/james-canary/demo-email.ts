import { timingSafeEqual } from 'node:crypto';
import { brief, readiness, sha } from './state.ts';
import type { Session } from './state.ts';
import { instructionLeakageSuspected } from './speech-quality.ts';

export const INTERNAL_DEMO_RECIPIENT = 'aifusionlabs@gmail.com';
export const DEMO_SENDER_NAME = 'AI Fusion Labs Demo';
type Environment = Record<string, string | undefined>;
export type DemoGrant = { id: string; expiresAt: number };
export type DemoMessage = { to: string; subject: string; text: string; html: string };
export type DemoDelivery = {
    status: 'RESERVED' | 'SENT' | 'FAILED_OR_UNKNOWN'; recipient: string;
    bodyHash: string; reservedAt: string; messageId?: string;
};
export type DemoEmailState = {
    grantId: string; expiresAt: number; sender: string; replyTo: string;
    snapshotHash?: string; consentAt?: string;
    deliveries?: { internal: DemoDelivery; caller: DemoDelivery };
};
const addressPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
function address(value: unknown): string {
    if (typeof value !== 'string' || value.length > 254 || !addressPattern.test(value) || /[\r\n]/.test(value)) {
        throw new Error('Demo email address is invalid');
    }
    return value.toLowerCase();
}
export function readDemoEmailConfig(env: Environment = process.env) {
    if (env.JAMES_DEMO_EMAIL_ENABLED !== 'true') throw new Error('Demo email is off');
    const apiKey = env.JAMES_AGENTMAIL_API_KEY || env.AGENTMAIL_API_KEY || '';
    const sender = address(env.JAMES_AGENTMAIL_ADDRESS);
    const replyTo = address(env.JAMES_DEMO_REPLY_TO);
    if (apiKey.length < 16) throw new Error('James AgentMail credentials are missing');
    // Never reuse Amy's sender, endpoint overrides, or Knowles branding implicitly.
    return { apiKey, sender, replyTo, apiBaseUrl: 'https://api.agentmail.to' as const };
}
export function verifyDemoGrant(token: unknown, now = Date.now(), env: Environment = process.env): DemoGrant {
    if (env.JAMES_DEMO_EMAIL_ENABLED !== 'true') throw new Error('Demo email is off');
    const digest = env.JAMES_DEMO_EMAIL_ACCESS_SHA256 || '';
    const expiresAt = Date.parse(env.JAMES_DEMO_EMAIL_EXPIRES_AT || '');
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token) || !/^[a-f0-9]{64}$/.test(digest)
        || !timingSafeEqual(Buffer.from(sha(token), 'hex'), Buffer.from(digest, 'hex'))) {
        throw new Error('Demo operator authorization is invalid');
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > 24 * 60 * 60 * 1000) {
        throw new Error('Demo operator authorization expired or exceeds the 24-hour test window');
    }
    return { id: digest, expiresAt };
}
export async function preflightDemoTransport(options: { env?: Environment; fetchImpl?: typeof fetch } = {}) {
    const config = readDemoEmailConfig(options.env);
    const response = await (options.fetchImpl || fetch)(`${config.apiBaseUrl}/v0/inboxes/${encodeURIComponent(config.sender)}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` }, cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    const inbox = await response.json().catch(() => null);
    if (!response.ok || address(inbox?.email || inbox?.inbox_id) !== config.sender
        || inbox?.display_name !== DEMO_SENDER_NAME) {
        throw new Error('Dedicated James inbox must exist with display name AI Fusion Labs Demo');
    }
    return { sender: config.sender, replyTo: config.replyTo, senderName: DEMO_SENDER_NAME, internalRecipient: INTERNAL_DEMO_RECIPIENT };
}
const htmlEscape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function message(to: string, subject: string, text: string): DemoMessage {
    if (text.length > 30_000 || subject.length > 200) throw new Error('Summary exceeds email size limit; no truncated email sent');
    return { to, subject, text, html: '<!doctype html><html><body><pre style="white-space:pre-wrap;font-family:Georgia,serif">' + htmlEscape(text) + '</pre></body></html>' };
}
export function prepareDemoMessages(session: Session, now = Date.now(), env: Environment = process.env) {
    const authorization = session.demoEmail;
    if (!authorization || authorization.expiresAt <= now || session.ownerTest || session.email) throw new Error('Active demo authorization required');
    const config = readDemoEmailConfig(env);
    if (authorization.sender !== config.sender || authorization.replyTo !== config.replyTo) throw new Error('Demo sender configuration changed; no send authorized');
    if (session.state !== 'CLOSED' || !session.providerRelease || !readiness(session.intake).ready) throw new Error('Verified closed and complete notes required');
    if (instructionLeakageSuspected(session.turns)) throw new Error('Possible instruction leakage: review this conversation before emailing summaries');
    const email = session.intake.facts.find(f => f.field === 'primary_email' && f.status === 'VISITOR_CONFIRMED');
    if (!email || session.intake.emailCandidate || session.intake.declined.includes('primary_email')) throw new Error('Caller email must be explicitly confirmed in the conversation');
    const callerAddress = address(email.value);
    const sections = brief(session.intake).filter(section => section.title !== 'HANDOFF STATUS');
    const sectionText = (includeStatus: boolean) => sections.map(section => section.title + '\n' + section.items.map(item =>
        (item.label && (includeStatus || !['ANSWERED', 'DEFERRED_TO_FIRM', 'UNRESOLVED'].includes(item.label)) ? item.label.replaceAll('_', ' ') + ': ' : '') + item.text
    ).join('\n')).join('\n\n');
    const boundary = 'AI Fusion Labs demonstration only. This is not legal advice, a submission to Knowles Law Firm, or confirmation of representation, firm review, a callback, or any deadline.';
    const internal = message(INTERNAL_DEMO_RECIPIENT, 'AI Fusion Labs Demo — James intake for internal review', [
        'AI FUSION LABS DEMO — INTERNAL REVIEW SUMMARY', boundary,
        'Visitor-reported details, not independently verified facts. Unknowns and questions remain unresolved unless explicitly stated otherwise.',
        sectionText(true),
        'EVIDENCE / REVIEW\nSession: ' + session.id + '\nProvider transcript verified.\nSnapshot: ' + session.stateHash,
    ].join('\n\n'));
    const caller = message(callerAddress, 'AI Fusion Labs Demo — your conversation recap with James', [
        'Your conversation recap with James', boundary,
        'Here is the information you shared in this demo. Please reply if anything needs correcting. Questions listed below are recorded for review, not answered legal advice.',
        sectionText(false),
        'This recap does not mean a law firm has received or reviewed your information. Do not rely on this demo to take legal action or meet a deadline.',
        'AI Fusion Labs Demo',
    ].join('\n\n'));
    return { internal, caller, snapshotHash: session.stateHash, callerAddress, sender: config.sender, replyTo: config.replyTo };
}
export async function sendDemoMessage(message: DemoMessage, options: { env?: Environment; fetchImpl?: typeof fetch; idempotencyKey: string }) {
    const config = readDemoEmailConfig(options.env);
    if (!/^[a-z0-9-]{1,200}$/.test(options.idempotencyKey)) throw new Error('Invalid demo send identifier');
    const response = await (options.fetchImpl || fetch)(`${config.apiBaseUrl}/v0/inboxes/${encodeURIComponent(config.sender)}/messages/send`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': options.idempotencyKey },
        body: JSON.stringify({ to: [address(message.to)], reply_to: [config.replyTo], subject: message.subject, text: message.text, html: message.html, track_opens: false }),
        cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || typeof result?.message_id !== 'string' || !result.message_id.trim()) throw new Error('No verified AgentMail send receipt; do not retry');
    return { messageId: result.message_id.trim().slice(0, 200) };
}
/** Both reservations are durably saved before either transport attempt. Reload,
 * failure, storage loss after acceptance, and repeated requests never retry. */
export async function sendDemoSummaries(session: Session, consent: { snapshotHash: unknown; callerAddress: unknown; approved: unknown }, deps: {
    save: (previous: Session, next: Session) => Promise<void>;
    stamp: (previous: Session, next: Session, event: unknown) => Session;
    send?: typeof sendDemoMessage; env?: Environment; now?: number;
}) {
    if (session.demoEmail?.deliveries) return session;
    const prepared = prepareDemoMessages(session, deps.now ?? Date.now(), deps.env);
    if (consent.approved !== true || consent.snapshotHash !== prepared.snapshotHash || consent.callerAddress !== prepared.callerAddress) {
        throw new Error('Approve both current summaries and the confirmed caller address before sending');
    }
    const reservedAt = new Date(deps.now ?? Date.now()).toISOString();
    const reserved = structuredClone(session);
    reserved.intake.handoff = 'PREPARED';
    Object.assign(reserved.demoEmail!, { snapshotHash: prepared.snapshotHash, consentAt: reservedAt, deliveries: {
        internal: { status: 'RESERVED', recipient: prepared.internal.to, bodyHash: sha(prepared.internal.text), reservedAt },
        caller: { status: 'RESERVED', recipient: prepared.caller.to, bodyHash: sha(prepared.caller.text), reservedAt },
    } });
    let current = deps.stamp(session, reserved, { action: 'demo-email-reservation', snapshotHash: prepared.snapshotHash, consent: true });
    await deps.save(session, current);
    for (const lane of ['internal', 'caller'] as const) {
        const next = structuredClone(current);
        const delivery = next.demoEmail!.deliveries![lane];
        try {
            const result = await (deps.send || sendDemoMessage)(prepared[lane], { env: deps.env, idempotencyKey: 'james-demo-' + session.demoEmail!.grantId + '-' + lane });
            if (!result.messageId) throw new Error('Missing provider receipt');
            delivery.status = 'SENT'; delivery.messageId = result.messageId;
        } catch { delivery.status = 'FAILED_OR_UNKNOWN'; }
        const stamped = deps.stamp(current, next, { action: 'demo-email-result', lane, status: delivery.status });
        // If receipt storage fails, the durable RESERVED state means unknown,
        // not permission to retry. Stop before attempting the other email.
        try { await deps.save(current, stamped); } catch { return current; }
        current = stamped;
    }
    return current;
}
