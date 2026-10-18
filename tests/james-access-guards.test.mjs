import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createJamesServer } from '../lib/james-canary/server.ts';
import { createPublicJamesServer } from '../lib/james-canary/public-server.ts';
import { PERSONA_ID } from '../lib/james-canary/state.ts';
import { RUNTIME_CANDIDATE_ID } from '../lib/james-canary/runtime-session.ts';
import { authorizedRequest, installJamesSharedAccess, SHARED_ORIGIN } from './helpers/james-shared-access.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/james-candidate-runtime.json', import.meta.url), 'utf8'));
const AUTH = 'xagent:access:v1:auth:';

async function withJames(run) {
    const previousEnv = { ...process.env }, previousFetch = globalThis.fetch;
    Object.assign(process.env, {
        AMY_ANAM_SESSION_SPINE_ENABLED: 'true', AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_SESSION_SECRET: 'offline-james-guard-signing-secret-at-least-thirty-two-characters',
        AMY_ANAM_REDIS_REST_URL: 'https://james-guards-redis.invalid', AMY_ANAM_REDIS_REST_TOKEN: 'offline-only',
        ANAM_API_KEY: 'offline-only', JAMES_PUBLIC_DEMO_EMAIL_ENABLED: 'false', JAMES_DEMO_EMAIL_ENABLED: 'false',
    });
    const db = new Map(), providerCalls = [];
    globalThis.fetch = async (url, init = {}) => {
        const target = String(url), body = init.body ? JSON.parse(init.body) : null;
        if (target === 'https://james-guards-redis.invalid/pipeline') return Response.json([{ result: [1, 600] }]);
        if (target === 'https://james-guards-redis.invalid') {
            if (body[0] === 'GET') return Response.json({ result: db.get(body[1]) ?? null });
            if (body[0] === 'EVAL') {
                const key = body[3], arg = 3 + body[2], revision = body[arg], value = body[arg + 1];
                const old = db.get(key);
                if (revision === -1 ? old !== undefined : !old || JSON.parse(old).revision !== revision) return Response.json({ result: 0 });
                db.set(key, value); return Response.json({ result: 1 });
            }
            throw new Error('Unexpected offline James Redis operation');
        }
        providerCalls.push(target);
        if (target === `https://api.anam.ai/v1/personas/${RUNTIME_CANDIDATE_ID}`) return Response.json(fixture.candidate);
        if (target === `https://api.anam.ai/v1/personas/${PERSONA_ID}`) return Response.json({ id: PERSONA_ID, brain: { systemPrompt: 'Offline fixture' }, voice: { id: 'offline-voice' } });
        if (target === 'https://api.anam.ai/v1/auth/session-token') return Response.json({ sessionToken: 'offline-provider-token' });
        throw new Error('Network forbidden: unrecognized offline target');
    };
    const access = installJamesSharedAccess({ capabilities: ['conversation'] });
    const surfaces = [
        { name: 'public-notepad', path: '/api/james-notepad', ...createPublicJamesServer(() => { throw new Error('No background action expected'); }) },
        { name: 'canary', path: '/api/james-canary', ...createJamesServer() },
    ];
    const request = (surface, body, cookie = '', authenticated = true, query = '') => {
        const make = authenticated ? authorizedRequest : (input, init) => new Request(input, init);
        return make(`${SHARED_ORIGIN}${surface.path}${query}`, {
            method: body ? 'POST' : 'GET', headers: { origin: SHARED_ORIGIN, 'Content-Type': 'application/json', cookie },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
    };
    try { await run({ surfaces, request, access, providerCalls, db }); }
    finally {
        globalThis.fetch = previousFetch;
        for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
        Object.assign(process.env, previousEnv);
    }
}

test('both James GET and POST deny anonymous visitors before any provider operation', async () => withJames(async h => {
    for (const surface of h.surfaces) {
        assert.equal((await surface.get(h.request(surface, null, '', false, '?id=11111111-2222-4333-8444-555555555555'))).status, 401, surface.name);
        assert.equal((await surface.post(h.request(surface, { action: 'start' }, '', false))).status, 401, surface.name);
    }
    assert.deepEqual(h.providerCalls, []); assert.equal(h.db.size, 0);
}));

test('approved James starts bind their browser to the verified account and load successfully', async () => withJames(async h => {
    for (const surface of h.surfaces) {
        const launched = await surface.post(h.request(surface, { action: 'start' }));
        const data = await launched.json();
        assert.equal(launched.status, 200, JSON.stringify(data));
        assert.equal(data.sessionToken, 'offline-provider-token');
        const cookie = launched.headers.get('set-cookie').split(';')[0];
        const loaded = await surface.get(h.request(surface, null, cookie, true, `?id=${data.id}`));
        assert.equal(loaded.status, 200);
    }
    const bindings = [...h.access.db].filter(([key]) => key.startsWith('xagent:access:policy:v1:browser:james:'));
    assert.equal(bindings.length, 2);
    assert.ok(bindings.every(([, raw]) => JSON.parse(raw).userId === h.access.identity.id));
    assert.equal(h.providerCalls.filter(url => url.endsWith('/auth/session-token')).length, 2);
}));

test('revoked, expired, wrong-activity and missing James approvals deny GET and POST before provider I/O', async () => {
    for (const overrides of [{ status: 'revoked' }, { expiresAt: new Date(Date.now() - 1000).toISOString() }, { capabilities: ['meeting'] }, { status: 'pending' }]) {
        await withJames(async h => {
            h.access.setGrant(overrides);
            for (const surface of h.surfaces) {
                assert.equal((await surface.get(h.request(surface, null, '', true, '?id=11111111-2222-4333-8444-555555555555'))).status, 403);
                assert.equal((await surface.post(h.request(surface, { action: 'start' }))).status, 403);
            }
            assert.deepEqual(h.providerCalls, []);
        });
    }
});

test('James check-in cookies cannot expose another account’s saved session', async () => withJames(async h => {
    for (const surface of h.surfaces) {
        const launched = await surface.post(h.request(surface, { action: 'start' })), data = await launched.json();
        assert.equal(launched.status, 200);
        const browserCookie = launched.headers.get('set-cookie').split(';')[0];
        const other = { id: 'other-verified-james-user', email: 'other-james@example.test', emailVerified: new Date().toISOString() };
        h.access.db.set(`${AUTH}user:${other.id}`, JSON.stringify(other));
        h.access.db.set(`${AUTH}user:session:other-session`, JSON.stringify({ sessionToken: 'other-session', userId: other.id, expires: new Date(Date.now() + 3600000).toISOString() }));
        h.access.setGrant({}, other.email);
        const cookie = `__Secure-xagent-access.session-token=other-session; ${browserCookie}`;
        const before = h.providerCalls.length;
        assert.equal((await surface.get(h.request(surface, null, cookie, false, `?id=${data.id}`))).status, 403);
        assert.equal((await surface.post(h.request(surface, { action: 'turn', id: data.id, turn: { id: 'forged', role: 'user', content: 'private note' } }, cookie, false))).status, 403);
        assert.equal(h.providerCalls.length, before);
    }
}));

test('James existing sessions stop authorizing after approval revocation and cannot send with conversation-only permission', async () => withJames(async h => {
    for (const surface of h.surfaces) {
        h.access.setGrant();
        const launched = await surface.post(h.request(surface, { action: 'start' })), data = await launched.json();
        assert.equal(launched.status, 200);
        const cookie = launched.headers.get('set-cookie').split(';')[0], before = h.providerCalls.length;
        assert.equal((await surface.post(h.request(surface, { action: 'send-demo-email', id: data.id }, cookie))).status, 403);
        h.access.setGrant({ status: 'revoked' });
        assert.equal((await surface.get(h.request(surface, null, cookie, true, `?id=${data.id}`))).status, 403);
        assert.equal((await surface.post(h.request(surface, { action: 'start' }, cookie))).status, 403);
        assert.equal(h.providerCalls.length, before);
    }
}));
