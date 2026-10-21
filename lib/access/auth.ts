import { createHash, createHmac } from 'node:crypto';
import { getServerSession, type NextAuthOptions } from 'next-auth';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Adapter, AdapterSession, VerificationToken } from 'next-auth/adapters';
import type { EmailConfig } from 'next-auth/providers/email';
import { UpstashRedisAdapter } from '@auth/upstash-redis-adapter';
import {
    ACCESS_LINK_SECONDS, ACCESS_NAMESPACE, ACCESS_SESSION_SECONDS, AccessUnavailableError,
    isTrustedAccessRequest, normalizeAuthEmail, readAccessAuthConfig, type AccessAuthConfig,
} from './auth-config.ts';
import { accessRedisCommand, createAccessRedisClient } from './redis.ts';
import { accessOwnerEmails } from './owners.ts';

export type AccessIdentity = { id: string; email: string; name: string | null };
export const ACCESS_AUTH_PREFIX = `${ACCESS_NAMESPACE}:auth:`;

export function createAccessAdapter(): Adapter {
    const client = createAccessRedisClient();
    const adapter = UpstashRedisAdapter(client, { baseKeyPrefix: ACCESS_AUTH_PREFIX }) as Adapter;
    const writeSession = async (session: AdapterSession) => {
        const ttl = Math.ceil((session.expires.getTime() - Date.now()) / 1000);
        if (ttl < 1 || ttl > ACCESS_SESSION_SECONDS) throw new AccessUnavailableError();
        const key = `${ACCESS_AUTH_PREFIX}user:session:${session.sessionToken}`;
        await client.set(key, JSON.stringify(session), { ex: ttl });
        await client.set(`${ACCESS_AUTH_PREFIX}user:session:by-user-id:${session.userId}`, key, { ex: ttl });
        return session;
    };
    return {
        ...adapter,
        createSession: writeSession,
        async updateSession(updates) {
            const record = await adapter.getSessionAndUser!(updates.sessionToken);
            if (!record) return null;
            // Sessions have an absolute four-hour lifetime, even if a client
            // repeatedly calls the library's session-update endpoint.
            return record.session;
        },
        async createVerificationToken(token) {
            const ttl = Math.ceil((token.expires.getTime() - Date.now()) / 1000);
            if (ttl < 1 || ttl > ACCESS_LINK_SECONDS) throw new AccessUnavailableError();
            await client.set(`${ACCESS_AUTH_PREFIX}user:token:${token.identifier}:${token.token}`, JSON.stringify(token), { ex: ttl });
            return token;
        },
        async useVerificationToken({ identifier, token }) {
            // GETDEL makes concurrent redemption one-time; the upstream
            // adapter currently separates GET and DEL.
            const stored = await client.getdel<VerificationToken>(`${ACCESS_AUTH_PREFIX}user:token:${identifier}:${token}`);
            if (!stored) return null;
            const expires = new Date(stored.expires);
            if (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) return null;
            return { ...stored, expires };
        },
    };
}

const RATE_SCRIPT = `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n`;

export async function allowAccessSignIn(request: Request, email: string, config = readAccessAuthConfig()): Promise<boolean> {
    if (!config.configured) throw new AccessUnavailableError();
    const ip = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128);
    const fingerprint = (value: string) => createHmac('sha256', config.secret).update(value).digest('hex');
    for (const [key, seconds, maximum] of [
        [`email:${fingerprint(normalizeAuthEmail(email))}`, 900, 5],
        [`ip:${fingerprint(ip)}`, 900, 20],
        ['global', 3600, 100],
    ] as const) {
        const count = await accessRedisCommand(['EVAL', RATE_SCRIPT, 1, `${ACCESS_NAMESPACE}:signin-rate:${key}`, seconds]);
        if (typeof count !== 'number' || !Number.isFinite(count)) throw new AccessUnavailableError();
        if (count > maximum) return false;
    }
    return true;
}

export function createAccessAuthOptions(config: AccessAuthConfig = readAccessAuthConfig(), onError: () => void = () => {}): NextAuthOptions {
    if (!config.configured) throw new AccessUnavailableError();
    const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: config.secure };
    const prefix = config.secure ? '__Secure-xagent-access' : 'xagent-access';
    const provider: EmailConfig = {
        id: 'email', name: 'Email', type: 'email', server: {}, options: {},
        from: config.from, maxAge: ACCESS_LINK_SECONDS, normalizeIdentifier: normalizeAuthEmail,
        async sendVerificationRequest({ identifier, url }) {
            if (process.env.VERCEL_ENV === 'preview') {
                const allowed = [...accessOwnerEmails(), ...(process.env.XAGENT_PREVIEW_TEST_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)];
                if (!allowed.includes(normalizeAuthEmail(identifier))) throw new Error('Preview sign-in is limited to the owner and configured testers');
            }
            const link = new URL(url);
            if (link.origin !== config.origin || link.pathname !== '/api/auth/callback/email') throw new AccessUnavailableError();
            const result = await fetch('https://api.resend.com/emails', {
                method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
                headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: config.from, to: [normalizeAuthEmail(identifier)], subject: `${process.env.VERCEL_ENV === 'preview' ? '[PREVIEW] ' : ''}Sign in to X Agents`,
                    text: `Sign in to X Agents:\n\n${link.href}\n\nThis link expires in 10 minutes and can be used once. Signing in does not grant agent access; the owner approves access separately. If you did not request this email, you can ignore it.`,
                }),
            });
            if (!result.ok) throw new AccessUnavailableError();
        },
    };
    return {
        secret: config.secret, adapter: createAccessAdapter(), providers: [provider],
        session: { strategy: 'database', maxAge: ACCESS_SESSION_SECONDS, updateAge: ACCESS_SESSION_SECONDS },
        useSecureCookies: config.secure,
        cookies: {
            sessionToken: { name: `${prefix}.session-token`, options: cookieOptions },
            csrfToken: { name: `${prefix}.csrf-token`, options: cookieOptions },
            callbackUrl: { name: `${prefix}.callback-url`, options: cookieOptions },
        },
        pages: { signIn: '/access', error: '/access', verifyRequest: '/access?checkEmail=1' },
        callbacks: {
            async redirect({ url }) {
                try {
                    const target = new URL(url, config.origin);
                    if (target.origin === config.origin) return target.href;
                } catch { /* Invalid and cross-origin callbacks go to the access page. */ }
                return `${config.origin}/access`;
            },
            async session({ session, user }) {
                return {
                    ...session,
                    user: user.emailVerified && user.email ? {
                        id: user.id, email: normalizeAuthEmail(user.email), name: user.name ?? null,
                    } : undefined,
                };
            },
        },
        // Auth errors may contain a token, email address, or Redis credentials.
        // Report only a generic service error at our HTTP boundary.
        logger: { error() { onError(); }, warn() {}, debug() {} },
    };
}

export async function readAccessIdentity(request: Request): Promise<AccessIdentity | null> {
    const config = readAccessAuthConfig();
    if (!config.configured) throw new AccessUnavailableError();
    if (!isTrustedAccessRequest(request, config)) return null;
    const cookies: Record<string, string> = Object.create(null);
    for (const part of (request.headers.get('cookie') || '').split(';')) {
        const index = part.indexOf('=');
        if (index < 1) continue;
        const key = part.slice(0, index).trim();
        try { cookies[key] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* Ignore malformed cookies. */ }
    }
    let failed = false;
    const options = createAccessAuthOptions(config, () => { failed = true; });
    // This public overload validates the supplied request through NextAuth's
    // database-session flow. It never accepts a cookie as proof by itself.
    const session = await getServerSession(
        { headers: Object.fromEntries(request.headers), cookies } as unknown as NextApiRequest,
        { getHeader() { return []; }, setHeader() {} } as unknown as NextApiResponse,
        options,
    );
    if (failed) throw new AccessUnavailableError();
    const user = session?.user as AccessIdentity | undefined;
    if (!user?.id || !user.email) return null;
    const token = cookies[`${config.secure ? '__Secure-' : ''}xagent-access.session-token`];
    if (token) {
        const binding = await accessRedisCommand(['GET', `xagent:access:passkey:v1:session:${createHash('sha256').update(token).digest('hex')}`]);
        if (binding && (typeof binding !== 'string' || !binding.startsWith('xagent:access:passkey:v1:credential:')
            || !await accessRedisCommand(['GET', binding]))) return null;
    }
    return { id: user.id, email: user.email, name: user.name ?? null };
}
