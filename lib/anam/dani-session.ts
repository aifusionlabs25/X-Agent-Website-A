import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
    AMY_ANAM_BROWSER_COOKIE,
    type AmyAnamBrowserSession,
    type AnamSessionAgentSlug,
    readAmyAnamBrowserSession,
} from './session-spine.ts';

export const DANI_ANAM_BROWSER_COOKIE = 'xagent_dani_anam_session';
export const DANI_ANAM_GUEST_COOKIE = 'xagent_dani_guest_mode';
export const DANI_ANAM_BROWSER_TTL_SECONDS = 4 * 60 * 60;

const SECRET_MIN_LENGTH = 32;
const DANI_SESSION_SIGNING_DOMAIN = 'xagent:dani:anam:browser-session:signing-key:v1';
const DANI_CONTACT_ENCRYPTION_DOMAIN = 'xagent:dani:anam:contact:encryption-key:v1';

type DaniAnamSessionPayload = {
    aud: 'dani';
    exp: number;
    iat: number;
    sid: string;
    v: 1;
};

export type DaniAnamBrowserSession = {
    id: string;
    createdAt: number;
    expiresAt: number;
};

export type DaniAnamSessionSecrets = {
    sessionSecret: string;
    contactSecret: string;
    sessionConfigured: boolean;
    contactConfigured: boolean;
    configured: boolean;
};

function envValue(source: NodeJS.ProcessEnv, name: string): string {
    return String(source[name] ?? '')
        .trim()
        .replace(/^(?:\uFEFF|\u00EF\u00BB\u00BF|\u00C3\u00AF\u00C2\u00BB\u00C2\u00BF)+/, '')
        .replace(/(?:\\r|\\n)+$/, '')
        .trim();
}

function requireSecret(secret: string, purpose: 'session' | 'contact'): string {
    const normalized = String(secret ?? '').trim();
    if (normalized.length < SECRET_MIN_LENGTH) {
        throw new Error(`Dani Anam ${purpose} secret is not configured`);
    }
    return normalized;
}

function domainSeparatedKey(secret: string, domain: string, purpose: 'session' | 'contact'): Buffer {
    return createHash('sha256')
        .update(`${domain}\0${requireSecret(secret, purpose)}`, 'utf8')
        .digest();
}

function sessionSigningKey(secret: string): Buffer {
    return domainSeparatedKey(secret, DANI_SESSION_SIGNING_DOMAIN, 'session');
}

/**
 * Provides Dani-specific key material for the separately encrypted contact token.
 * Keeping this derivation here prevents callers from reusing the session HMAC key.
 */
export function deriveDaniAnamContactEncryptionKey(secret: string): Buffer {
    return domainSeparatedKey(secret, DANI_CONTACT_ENCRYPTION_DOMAIN, 'contact');
}

export function readDaniAnamSessionSecrets(
    source: NodeJS.ProcessEnv = process.env,
): DaniAnamSessionSecrets {
    const sessionSecret = envValue(source, 'DANI_ANAM_SESSION_SECRET');
    const contactSecret = envValue(source, 'DANI_ANAM_CONTACT_SECRET');
    const sessionConfigured = sessionSecret.length >= SECRET_MIN_LENGTH;
    const contactConfigured = contactSecret.length >= SECRET_MIN_LENGTH;

    return {
        sessionSecret,
        contactSecret,
        sessionConfigured,
        contactConfigured,
        configured: sessionConfigured && contactConfigured,
    };
}

function isUuid(value: unknown): value is string {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length
        && timingSafeEqual(leftBuffer, rightBuffer);
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

function signDaniAnamBrowserSession(session: DaniAnamBrowserSession, secret: string): string {
    const payload: DaniAnamSessionPayload = {
        aud: 'dani',
        exp: session.expiresAt,
        iat: session.createdAt,
        sid: session.id,
        v: 1,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', sessionSigningKey(secret))
        .update(encoded, 'utf8')
        .digest('base64url');
    return `${encoded}.${signature}`;
}

export function daniAnamSessionCookieOptions(maxAge = DANI_ANAM_BROWSER_TTL_SECONDS) {
    return {
        httpOnly: true,
        maxAge,
        path: '/',
        priority: 'high' as const,
        sameSite: 'lax' as const,
        secure: process.env.NODE_ENV === 'production',
    };
}

export function createDaniAnamBrowserSessionWithSecret(secret: string, now = Date.now()) {
    if (!Number.isSafeInteger(now) || now < 0) {
        throw new Error('Dani Anam session time is invalid');
    }

    const session: DaniAnamBrowserSession = {
        id: randomUUID(),
        createdAt: now,
        expiresAt: now + DANI_ANAM_BROWSER_TTL_SECONDS * 1_000,
    };
    return { session, token: signDaniAnamBrowserSession(session, secret) };
}

export function createDaniAnamBrowserSession(
    now = Date.now(),
    source: NodeJS.ProcessEnv = process.env,
) {
    return createDaniAnamBrowserSessionWithSecret(
        readDaniAnamSessionSecrets(source).sessionSecret,
        now,
    );
}

export function readDaniAnamBrowserSession(
    request: Request,
    secret = readDaniAnamSessionSecrets().sessionSecret,
    now = Date.now(),
): DaniAnamBrowserSession | null {
    try {
        if (!Number.isSafeInteger(now) || now < 0) return null;

        const token = cookieValue(request, DANI_ANAM_BROWSER_COOKIE);
        if (!token) return null;
        const [encoded, suppliedSignature, ...extra] = token.split('.');
        if (!encoded || !suppliedSignature || extra.length > 0) return null;

        const expectedSignature = createHmac('sha256', sessionSigningKey(secret))
            .update(encoded, 'utf8')
            .digest('base64url');
        if (!safeEqual(suppliedSignature, expectedSignature)) return null;

        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<DaniAnamSessionPayload>;
        if (
            payload.aud !== 'dani'
            || payload.v !== 1
            || !isUuid(payload.sid)
            || !Number.isSafeInteger(payload.iat)
            || !Number.isSafeInteger(payload.exp)
            || (payload.iat as number) < 0
            || (payload.iat as number) > now
            || (payload.exp as number) <= (payload.iat as number)
            || (payload.exp as number) > (payload.iat as number) + DANI_ANAM_BROWSER_TTL_SECONDS * 1_000
            || (payload.exp as number) <= now
        ) {
            return null;
        }

        return {
            id: payload.sid,
            createdAt: payload.iat as number,
            expiresAt: payload.exp as number,
        };
    } catch {
        return null;
    }
}

/**
 * Transition helper for server-owned launch/session records. The agent slug must be
 * resolved from trusted server state; never pass a query, cookie, or request-body value.
 * Dani can only use Dani's cookie and secret. Amy and Evan continue to use the shared
 * Amy namespace until their callers are migrated independently.
 */
export function readAnamBrowserSessionForTrustedAgent(input: {
    request: Request;
    agentSlug: AnamSessionAgentSlug;
    daniSessionSecret: string;
    sharedAmySessionSecret: string;
    now?: number;
}): DaniAnamBrowserSession | AmyAnamBrowserSession | null {
    if (input.agentSlug === 'dani') {
        return readDaniAnamBrowserSession(
            input.request,
            input.daniSessionSecret,
            input.now,
        );
    }
    if (input.agentSlug === 'amy' || input.agentSlug === 'evan') {
        return readAmyAnamBrowserSession(
            input.request,
            input.sharedAmySessionSecret,
            input.now,
        );
    }
    return null;
}

export function browserSessionCookieNameForTrustedAgent(
    agentSlug: AnamSessionAgentSlug,
): typeof DANI_ANAM_BROWSER_COOKIE | typeof AMY_ANAM_BROWSER_COOKIE | null {
    if (agentSlug === 'dani') return DANI_ANAM_BROWSER_COOKIE;
    if (agentSlug === 'amy' || agentSlug === 'evan') return AMY_ANAM_BROWSER_COOKIE;
    return null;
}
