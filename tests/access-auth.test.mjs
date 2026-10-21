import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
    ACCESS_LINK_SECONDS, ACCESS_NAMESPACE, ACCESS_SESSION_SECONDS,
    isTrustedAccessRequest, readAccessAuthConfig, AccessUnavailableError,
} from '../lib/access/auth-config.ts';
import {
    ACCESS_AUTH_PREFIX, allowAccessSignIn, createAccessAdapter,
    createAccessAuthOptions, readAccessIdentity,
} from '../lib/access/auth.ts';

const ORIGIN = 'https://xagent.aifusionlabs.app';
const SECRET = 'offline-shared-access-secret-over-thirty-two-characters';
const NextAuth = createRequire(import.meta.url)('next-auth').default;
const ENV = {
    NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production',
    AMY_ANAM_REDIS_REST_URL: 'https://shared-access-redis.invalid',
    AMY_ANAM_REDIS_REST_TOKEN: 'offline-redis-token',
    AMY_ANAM_SESSION_SECRET: SECRET, RESEND_API_KEY: 'offline-resend-key',
};

function request(cookie, extra = {}) {
    return new Request(`${ORIGIN}/api/access`, {
        headers: { host: 'xagent.aifusionlabs.app', ...(cookie ? { cookie } : {}), ...extra },
    });
}

async function offline(run, { simulateEmail = false } = {}) {
    const keys = new Set([...Object.keys(ENV), 'XAGENT_AUTH_SECRET', 'NEXTAUTH_URL', 'AUTH_TRUST_HOST', 'VERCEL_URL']);
    const previous = Object.fromEntries([...keys].map(key => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, ENV);
    const originalFetch = globalThis.fetch;
    const db = new Map(), expirations = new Map(), commands = [], unexpected = [], emailMessages = [];
    let unavailable = false;
    globalThis.fetch = async (url, init) => {
        if (simulateEmail && String(url) === 'https://api.resend.com/emails') {
            emailMessages.push(JSON.parse(init.body));
            return Response.json({ id: 'offline-only-email-id' });
        }
        if (String(url) !== ENV.AMY_ANAM_REDIS_REST_URL) {
            unexpected.push(String(url));
            throw new Error('External network forbidden by this test');
        }
        if (unavailable) return Response.json({ error: 'offline outage' }, { status: 503 });
        const command = JSON.parse(init.body);
        commands.push(command);
        const [operation, key, value] = command;
        const op = operation.toUpperCase();
        if (expirations.get(key) <= Date.now()) { db.delete(key); expirations.delete(key); }
        let result;
        if (op === 'GET') result = db.get(key) ?? null;
        else if (op === 'GETDEL') { result = db.get(key) ?? null; db.delete(key); expirations.delete(key); }
        else if (op === 'SET') {
            db.set(key, value);
            const ex = command.findIndex(part => String(part).toUpperCase() === 'EX');
            if (ex >= 0) expirations.set(key, Date.now() + Number(command[ex + 1]) * 1000);
            result = 'OK';
        } else if (op === 'DEL') result = Number(db.delete(key));
        else if (op === 'EVAL') {
            const rateKey = command[3];
            result = Number(db.get(rateKey) || 0) + 1;
            db.set(rateKey, result);
        } else {
            unexpected.push(operation);
            throw new Error('Unexpected Redis command');
        }
        return Response.json({ result });
    };
    try {
        await run({ db, expirations, commands, emailMessages, setUnavailable(value) { unavailable = value; } });
        assert.deepEqual(unexpected, [], 'tests never contact Resend or any live service');
    } finally {
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
}

test('configuration fails closed and derives a separate signing key without feature flags', () => {
    assert.equal(readAccessAuthConfig({}).configured, false);
    const config = readAccessAuthConfig(ENV);
    assert.equal(config.configured, true);
    assert.notEqual(config.secret, SECRET);
    assert.equal(config.secret, createHmac('sha256', SECRET).update(`${ACCESS_NAMESPACE}:auth-secret`).digest('hex'));
    assert.equal(readAccessAuthConfig({ ...ENV, XAGENT_AUTH_SECRET: 'too-short' }).configured, false);
    assert.equal(readAccessAuthConfig({ ...ENV, RESEND_API_KEY: '' }).configured, false);
    assert.equal(readAccessAuthConfig({ ...ENV, NEXTAUTH_URL: 'https://attacker.invalid' }).configured, false);
    assert.equal(readAccessAuthConfig({ ...ENV, AMY_ANAM_SESSION_SPINE_ENABLED: 'false' }).configured, true);
});

test('production, preview, forwarded-host and mutation origins are bounded', () => {
    const config = readAccessAuthConfig(ENV);
    assert.equal(isTrustedAccessRequest(request(), config), true);
    assert.equal(isTrustedAccessRequest(request(null, { 'x-forwarded-host': 'attacker.invalid' }), config), false);
    assert.equal(isTrustedAccessRequest(request(null, { 'x-forwarded-proto': 'http' }), config), false);
    assert.equal(isTrustedAccessRequest(new Request(`${ORIGIN}/api/auth/signin/email`, { method: 'POST' }), config), false);
    assert.equal(isTrustedAccessRequest(new Request(`${ORIGIN}/api/auth/signin/email`, { method: 'POST', headers: { origin: ORIGIN } }), config), true);
    const preview = readAccessAuthConfig({ ...ENV, KV_REST_API_URL: ENV.AMY_ANAM_REDIS_REST_URL, KV_REST_API_TOKEN: ENV.AMY_ANAM_REDIS_REST_TOKEN, VERCEL_ENV: 'preview', VERCEL_URL: 'x-agent-offline.vercel.app' });
    assert.equal(preview.configured, true);
    assert.equal(isTrustedAccessRequest(new Request('https://x-agent-offline.vercel.app/api/access'), preview), true);
    assert.equal(isTrustedAccessRequest(request(), preview), false);
});

test('magic links have Redis TTL and exactly one simultaneous redemption succeeds', async () => offline(async ({ expirations, commands }) => {
    const adapter = createAccessAdapter();
    const token = { identifier: 'visitor@example.com', token: 'hashed-token', expires: new Date(Date.now() + ACCESS_LINK_SECONDS * 1000) };
    await adapter.createVerificationToken(token);
    const key = `${ACCESS_AUTH_PREFIX}user:token:${token.identifier}:${token.token}`;
    assert.ok(expirations.get(key) > Date.now());
    const result = await Promise.all(Array.from({ length: 12 }, () => adapter.useVerificationToken(token)));
    assert.equal(result.filter(Boolean).length, 1);
    assert.ok(result.find(Boolean).expires instanceof Date);
    assert.equal(commands.filter(command => command[0].toUpperCase() === 'GETDEL').length, 12);
}));

test('real NextAuth magic-link flow creates a verified database session and rejects link reuse', async () => offline(async ({ emailMessages }) => {
    const options = createAccessAuthOptions();
    async function authRequest(path, { method = 'GET', body, cookies = {}, query = {} } = {}) {
        const headers = new Map();
        const result = { status: 200, body: undefined, headers };
        const response = {
            status(code) { result.status = code; return this; },
            getHeader(name) { return headers.get(name.toLowerCase()); },
            setHeader(name, value) { headers.set(name.toLowerCase(), value); return this; },
            end() {}, send(value) { result.body = value; }, json(value) { result.body = value; },
        };
        await NextAuth({ method, body, cookies, headers: { host: 'xagent.aifusionlabs.app' }, query: { nextauth: path.split('/'), ...query } }, response, options);
        return result;
    }
    const csrf = await authRequest('csrf');
    assert.ok(csrf.body.csrfToken);
    const cookies = Object.fromEntries(csrf.headers.get('set-cookie').map(value => {
        const first = value.split(';')[0], index = first.indexOf('=');
        return [first.slice(0, index), decodeURIComponent(first.slice(index + 1))];
    }));
    const signIn = await authRequest('signin/email', {
        method: 'POST', cookies,
        body: { csrfToken: csrf.body.csrfToken, email: 'Visitor@example.com', callbackUrl: `${ORIGIN}/access`, json: 'true' },
    });
    assert.equal(signIn.status, 200);
    assert.equal(emailMessages.length, 1);
    const verifyPage = await authRequest('verify-request', { query: { provider: 'email', type: 'email' } });
    assert.equal(verifyPage.headers.get('location'), '/access?checkEmail=1');
    assert.deepEqual(emailMessages[0].to, ['visitor@example.com']);
    const link = new URL(emailMessages[0].text.split('\n').find(line => line.startsWith('https://')));
    assert.equal(link.origin, ORIGIN);
    const callback = await authRequest('callback/email', { query: Object.fromEntries(link.searchParams) });
    assert.equal(callback.status, 302);
    const sessionCookie = callback.headers.get('set-cookie').find(value => value.startsWith('__Secure-xagent-access.session-token='));
    assert.ok(sessionCookie);
    const identity = await readAccessIdentity(request(sessionCookie.split(';')[0]));
    assert.equal(identity.email, 'visitor@example.com');
    assert.ok(identity.id);
    const replay = await authRequest('callback/email', { query: Object.fromEntries(link.searchParams) });
    assert.ok(replay.headers.get('location').includes('error=Verification'));
    assert.equal((replay.headers.get('set-cookie') || []).some(value => value.startsWith('__Secure-xagent-access.session-token=')), false);
}, { simulateEmail: true }));

test('expired magic links cannot be redeemed even if a stored record outlives its TTL', async () => offline(async ({ db }) => {
    const adapter = createAccessAdapter();
    const token = { identifier: 'visitor@example.com', token: 'expired-hash', expires: new Date(Date.now() - 1000) };
    db.set(`${ACCESS_AUTH_PREFIX}user:token:${token.identifier}:${token.token}`, JSON.stringify(token));
    assert.equal(await adapter.useVerificationToken(token), null);
}));

test('real NextAuth database sessions require verified identity and are revocable', async () => offline(async ({ db, expirations }) => {
    const adapter = createAccessAdapter();
    const user = await adapter.createUser({ email: 'visitor@example.com', emailVerified: new Date(), name: 'Visitor' });
    const expires = new Date(Date.now() + ACCESS_SESSION_SECONDS * 1000);
    await adapter.createSession({ sessionToken: 'offline-session', userId: user.id, expires });
    const cookie = '__Secure-xagent-access.session-token=offline-session';
    assert.deepEqual(await readAccessIdentity(request(cookie)), { id: user.id, email: user.email, name: 'Visitor' });
    assert.equal(await readAccessIdentity(request()), null);
    assert.equal(await readAccessIdentity(request('__Secure-xagent-access.session-token=forged')), null);
    assert.equal(await readAccessIdentity(request('amy-anam-session=offline-session')), null);
    assert.ok(expirations.get(`${ACCESS_AUTH_PREFIX}user:session:offline-session`) <= expires.getTime() + 1000);
    await adapter.updateSession({ sessionToken: 'offline-session', expires: new Date(Date.now() + 86400000) });
    assert.equal((await adapter.getSessionAndUser('offline-session')).session.expires.getTime(), expires.getTime());
    await adapter.updateUser({ id: user.id, emailVerified: null });
    assert.equal(await readAccessIdentity(request(cookie)), null);
    await adapter.updateUser({ id: user.id, emailVerified: new Date() });
    const sessionKey = `${ACCESS_AUTH_PREFIX}user:session:offline-session`;
    db.set(sessionKey, JSON.stringify({ sessionToken: 'offline-session', userId: user.id, expires: new Date(Date.now() - 1000) }));
    assert.equal(await readAccessIdentity(request(cookie)), null);
    await adapter.createSession({ sessionToken: 'offline-revoked', userId: user.id, expires });
    await adapter.deleteSession('offline-revoked');
    assert.equal(await readAccessIdentity(request('__Secure-xagent-access.session-token=offline-revoked')), null);
}));

test('storage outages and missing configuration surface unavailable instead of authorizing', async () => offline(async ({ setUnavailable }) => {
    setUnavailable(true);
    await assert.rejects(() => readAccessIdentity(request('__Secure-xagent-access.session-token=test')), AccessUnavailableError);
    delete process.env.RESEND_API_KEY;
    await assert.rejects(() => readAccessIdentity(request()), AccessUnavailableError);
}));

test('email sign-in rate limiting blocks repeated delivery attempts without live email', async () => offline(async ({ commands }) => {
    for (let index = 0; index < 5; index++) assert.equal(await allowAccessSignIn(request(), 'visitor@example.com'), true);
    assert.equal(await allowAccessSignIn(request(), 'visitor@example.com'), false);
    assert.ok(commands.every(command => !JSON.stringify(command).includes('visitor@example.com')));
    const options = createAccessAuthOptions();
    assert.equal(options.providers[0].maxAge, 600);
    assert.equal(options.session.maxAge, 14400);
    assert.equal(await options.callbacks.redirect({ url: 'https://attacker.invalid/steal', baseUrl: ORIGIN }), `${ORIGIN}/access`);
    assert.equal(await options.callbacks.redirect({ url: '/demo/amy', baseUrl: ORIGIN }), `${ORIGIN}/demo/amy`);
}));
