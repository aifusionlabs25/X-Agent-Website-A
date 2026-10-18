import { createHash } from 'node:crypto';

export const SHARED_ORIGIN = 'https://xagent.aifusionlabs.app';
export const SHARED_COOKIE = '__Secure-xagent-access.session-token=james-offline-shared-session';
const AUTH = 'xagent:access:v1:auth:';
const POLICY = 'xagent:access:policy:v1:';

// Existing James business-lifecycle fixtures now carry a verified account as
// well as their agent-local browser cookie. This is real NextAuth session and
// real policy data; no production auth guard is mocked or bypassed.
export function authorizedRequest(input, init = {}) {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('cookie', [SHARED_COOKIE, headers.get('cookie')].filter(Boolean).join('; '));
    return new Request(input, { ...init, headers });
}

export function installJamesSharedAccess({ browserIds = [], capabilities = ['conversation', 'actions'] } = {}) {
    Object.assign(process.env, {
        VERCEL: '1', VERCEL_ENV: 'production', NEXTAUTH_URL: SHARED_ORIGIN,
        XAGENT_AUTH_SECRET: 'offline-james-shared-auth-key-at-least-thirty-two-characters',
        RESEND_API_KEY: 'offline-only-resend-key', XAGENT_ACCESS_OWNER_EMAILS: 'owner@example.test',
    });
    const redisUrl = process.env.AMY_ANAM_REDIS_REST_URL;
    const downstream = globalThis.fetch;
    const db = new Map();
    const identity = { id: 'james-offline-verified-user', email: 'approved-james@example.test', name: 'Approved James tester', emailVerified: new Date().toISOString() };
    const grantKey = email => POLICY + 'record:' + createHash('sha256').update(`${email}\0james`).digest('hex');
    function setGrant(overrides = {}, email = identity.email) {
        db.set(grantKey(email), JSON.stringify({ email, agent: 'james', capabilities, status: 'approved',
            expiresAt: new Date(Date.now() + 3600000).toISOString(), updatedAt: new Date().toISOString(),
            updatedBy: 'owner@example.test', ...overrides }));
    }
    function bind(browserId) {
        db.set(`${POLICY}browser:james:${browserId}`, JSON.stringify({ userId: identity.id, email: identity.email, agent: 'james', browserId }));
    }
    db.set(`${AUTH}user:${identity.id}`, JSON.stringify(identity));
    db.set(`${AUTH}user:session:james-offline-shared-session`, JSON.stringify({ sessionToken: 'james-offline-shared-session', userId: identity.id,
        expires: new Date(Date.now() + 4 * 3600000).toISOString() }));
    setGrant(); browserIds.forEach(bind);
    globalThis.fetch = async (url, init = {}) => {
        if (String(url) === redisUrl && init.body) {
            const command = JSON.parse(init.body), [operation, key, value] = command;
            if (typeof key === 'string' && (key.startsWith(AUTH) || key.startsWith(POLICY))) {
                const op = operation.toUpperCase();
                if (op === 'GET') return Response.json({ result: db.get(key) ?? null });
                if (op === 'SMEMBERS') return Response.json({ result: [] });
                if (op === 'DEL') return Response.json({ result: Number(db.delete(key)) });
                if (op === 'SET') {
                    if (command.some(item => String(item).toUpperCase() === 'NX') && db.has(key)) return Response.json({ result: null });
                    db.set(key, value); return Response.json({ result: 'OK' });
                }
                throw new Error('Unexpected offline shared access command ' + op);
            }
        }
        return downstream(url, init);
    };
    return { db, identity, bind, setGrant };
}
