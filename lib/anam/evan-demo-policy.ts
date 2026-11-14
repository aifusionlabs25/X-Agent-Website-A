import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const EVAN_PUBLIC_DEMO_SECONDS = 180;
export const EVAN_EXTENDED_DEMO_SECONDS = 1_800;
export const EVAN_DEMO_COOKIE = 'xagent_evan_extended_demo';
export const EVAN_DEMO_GRANT_SECONDS = 60 * 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EvanDemoPolicy = {
    mode: 'public' | 'extended';
    maxSeconds: typeof EVAN_PUBLIC_DEMO_SECONDS | typeof EVAN_EXTENDED_DEMO_SECONDS;
    providerPersonaId: string;
};

function accessKey(env: NodeJS.ProcessEnv): string {
    const key = env.EVAN_EXTENDED_DEMO_ACCESS_KEY?.trim() ?? '';
    return key.length >= 32 ? key : '';
}

function equal(left: string, right: string): boolean {
    const hash = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(hash(left), hash(right));
}

export function verifyEvanDemoAccessCode(code: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
    const key = accessKey(env);
    // Human access codes are not cookie-signing secrets. Keep the existing strong
    // key for grants, and use the legacy code only when no custom code is set.
    const expected = env.EVAN_EXTENDED_DEMO_ACCESS_CODE === undefined ? key : env.EVAN_EXTENDED_DEMO_ACCESS_CODE;
    return Boolean(key) && typeof expected === 'string' && expected.length >= 6 && expected.length <= 256
        && expected === expected.trim()
        && typeof code === 'string' && code.length <= 256 && equal(code, expected);
}

export function createEvanDemoGrant(origin: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): string {
    const key = accessKey(env);
    if (!key) throw new Error('Extended Evan demo access is not configured');
    const payload = Buffer.from(JSON.stringify({ v: 1, aud: origin, iat: now, exp: now + EVAN_DEMO_GRANT_SECONDS * 1000 })).toString('base64url');
    return `${payload}.${createHmac('sha256', key).update(`evan-demo:v1:${payload}`).digest('base64url')}`;
}

export function hasEvanDemoGrant(request: Request, env: NodeJS.ProcessEnv = process.env, now = Date.now()): boolean {
    try {
        const key = accessKey(env);
        if (!key) return false;
        const cookie = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${EVAN_DEMO_COOKIE}=`));
        const token = cookie?.slice(EVAN_DEMO_COOKIE.length + 1) ?? '';
        if (token.length > 2048) return false;
        const [payload, signature, extra] = token.split('.');
        if (!payload || !signature || extra !== undefined) return false;
        const expected = createHmac('sha256', key).update(`evan-demo:v1:${payload}`).digest('base64url');
        if (!equal(signature, expected)) return false;
        const grant = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return grant.v === 1 && grant.aud === new URL(request.url).origin
            && Number.isSafeInteger(grant.iat) && Number.isSafeInteger(grant.exp)
            && grant.iat <= now && grant.exp > now && grant.exp > grant.iat
            && grant.exp - grant.iat === EVAN_DEMO_GRANT_SECONDS * 1000;
    } catch { return false; }
}

export function resolveEvanDemoPolicy(request: Request, env: NodeJS.ProcessEnv = process.env, mode: 'public' | 'extended' = 'public'): EvanDemoPolicy {
    // Permission alone never upgrades an ordinary public launch. Private entry
    // must be selected by a server route, not body/query/header/browser storage.
    const extended = mode === 'extended';
    if (extended && !hasEvanDemoGrant(request, env)) throw new Error('Private Evan demo access is required');
    const providerPersonaId = (extended ? env.EVAN_EXTENDED_DEMO_PERSONA_ID : env.EVAN_PUBLIC_DEMO_PERSONA_ID)?.trim() ?? '';
    if (!uuid.test(providerPersonaId)) throw new Error('Evan duration policy is not configured');
    return { mode: extended ? 'extended' : 'public', maxSeconds: extended ? EVAN_EXTENDED_DEMO_SECONDS : EVAN_PUBLIC_DEMO_SECONDS, providerPersonaId };
}

export function isEvanDemoPolicy(value: unknown): value is EvanDemoPolicy {
    if (!value || typeof value !== 'object') return false;
    const policy = value as EvanDemoPolicy;
    return uuid.test(policy.providerPersonaId)
        && ((policy.mode === 'public' && policy.maxSeconds === EVAN_PUBLIC_DEMO_SECONDS)
            || (policy.mode === 'extended' && policy.maxSeconds === EVAN_EXTENDED_DEMO_SECONDS));
}
