import { createHmac } from 'node:crypto';

export const ACCESS_NAMESPACE = 'xagent:access:v1';
export const ACCESS_SESSION_SECONDS = 4 * 60 * 60;
export const ACCESS_LINK_SECONDS = 10 * 60;
export const ACCESS_PRODUCTION_ORIGIN = 'https://xagent.aifusionlabs.app';

export class AccessUnavailableError extends Error {
    constructor() { super('Shared access is temporarily unavailable'); }
}

type Environment = Record<string, string | undefined>;

export function readAccessRedisConfig(env: Environment = process.env) {
    const url = env.AMY_ANAM_REDIS_REST_URL?.trim() ?? '';
    const token = env.AMY_ANAM_REDIS_REST_TOKEN?.trim() ?? '';
    let validUrl = false;
    try {
        const parsed = new URL(url);
        validUrl = parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
    } catch { /* Missing configuration is reported at the request boundary. */ }
    return { configured: validUrl && Boolean(token), url: url.replace(/\/$/, ''), token };
}

export function readAccessAuthConfig(env: Environment = process.env) {
    const redis = readAccessRedisConfig(env);
    const dedicatedSecret = env.XAGENT_AUTH_SECRET?.trim();
    const amySecret = env.AMY_ANAM_SESSION_SECRET?.trim();
    const secret = dedicatedSecret !== undefined ? dedicatedSecret : amySecret && amySecret.length >= 32
        ? createHmac('sha256', amySecret).update(`${ACCESS_NAMESPACE}:auth-secret`).digest('hex') : '';
    const resendKey = env.RESEND_API_KEY?.trim() ?? '';
    let origin = ACCESS_PRODUCTION_ORIGIN;
    let validOrigin = true;
    try {
        if (env.VERCEL_ENV === 'preview') {
            const preview = new URL(`https://${env.VERCEL_URL ?? ''}`);
            validOrigin = /^[a-z0-9-]+\.vercel\.app$/i.test(preview.hostname) && preview.href === `${preview.origin}/`;
            origin = preview.origin;
        } else if (env.NODE_ENV !== 'production' && !env.VERCEL_ENV) {
            const local = new URL(env.NEXTAUTH_URL || 'http://localhost:3000');
            validOrigin = local.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(local.hostname)
                && local.href === `${local.origin}/`;
            origin = local.origin;
        }
        // v4 uses NEXTAUTH_URL before Vercel's request host. Never allow a stale
        // value to send production sign-in links to another deployment.
        if (env.NEXTAUTH_URL) {
            const configuredUrl = new URL(env.NEXTAUTH_URL);
            if (configuredUrl.origin !== origin || !['/', '/api/auth'].includes(configuredUrl.pathname)
                || configuredUrl.search || configuredUrl.hash || configuredUrl.username || configuredUrl.password) validOrigin = false;
        }
        if (env.NODE_ENV === 'production' && !env.VERCEL && !env.NEXTAUTH_URL) validOrigin = false;
    } catch { validOrigin = false; }
    return {
        configured: redis.configured && secret.length >= 32 && Boolean(resendKey) && validOrigin,
        origin, secret, resendKey, secure: origin.startsWith('https:'),
        from: 'X Agents <hello@aifusionlabs.app>',
    };
}

export type AccessAuthConfig = ReturnType<typeof readAccessAuthConfig>;

export function isTrustedAccessRequest(request: Request, config = readAccessAuthConfig()): boolean {
    try {
        if (new URL(request.url).origin !== config.origin) return false;
        const expected = new URL(config.origin);
        for (const key of ['host', 'x-forwarded-host']) {
            const value = request.headers.get(key);
            if (value !== null && value.toLowerCase() !== expected.host.toLowerCase()) return false;
        }
        const protocol = request.headers.get('x-forwarded-proto');
        if (protocol && `${protocol}:` !== expected.protocol) return false;
        const origin = request.headers.get('origin');
        if (origin !== null && origin !== config.origin) return false;
        return ['GET', 'HEAD'].includes(request.method) || origin === config.origin;
    } catch { return false; }
}

export function normalizeAuthEmail(value: string): string {
    const email = value.normalize('NFKC').trim().toLowerCase();
    if (email.length > 254 || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email)) {
        throw new Error('Invalid email address');
    }
    return email;
}
