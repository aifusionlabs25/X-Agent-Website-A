import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as resolver from '../lib/anam/session-config.ts';
import * as policy from '../lib/anam/amy-demo-policy.ts';

// Execute the actual route bodies with deny-by-default dependency doubles.
// No real credentials, provider calls, email, or persisted visitor records.
const nativeRequire = createRequire(import.meta.url);
const sideEffect = () => { throw new Error('Unexpected external side effect'); };
const unavailable = new Proxy({}, { get: () => sideEffect });
function loadRoute(path, mocks = {}, env = {}, fetchDouble = sideEffect) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const exports = {};
    const require = name => {
        if (name === 'next/server') return { NextResponse: { json(body, init) {
            const result = Response.json(body, init);
            result.cookies = { set() {} };
            return result;
        } } };
        if (name === '@/lib/anam/amy-demo-policy') return policy;
        if (name === '@/lib/anam/session-config') return resolver;
        if (name === 'node:crypto') return nativeRequire(name);
        return mocks[name] ?? unavailable;
    };
    vm.runInNewContext(code, {
        exports, require, process: { env }, console: { error() {}, info() {}, warn() {} },
        Response, Request, Headers, AbortSignal, fetch: fetchDouble,
    }, { filename: path });
    return exports;
}
const amy = resolver.AMY_PUBLIC_PERSONA_ID;
const current = '11111111-2222-4333-8444-555555555555';
const other = '22222222-2222-4333-8444-555555555555';
const agents = [{ slug: 'amy', personaId: amy }, { slug: 'other', personaId: other }];
function resolve(variant, personaId = amy, configured = current) {
    return resolver.resolveAnamSessionPersona({ requestedPersonaId: personaId, requestedVariant: variant,
        allowedPersonaIds: [amy, other], amyCara4PersonaId: configured });
}
test('missing and blank Amy variants cannot select the old persona; other defaults stay unchanged', () => {
    for (const variant of [undefined, null, '', ' ', resolver.AMY_CARA4_VARIANT]) {
        assert.deepEqual(resolve(variant), { ok: true, personaId: current, variant: resolver.AMY_CARA4_VARIANT });
    }
    assert.deepEqual(resolve(undefined, other), { ok: true, personaId: other });
    assert.equal(resolve(undefined, amy, '').ok, false);
    assert.equal(resolve(undefined, amy, amy).ok, false);
    for (const variant of ['cara4', 'old', 'public', false, 0, {}, ['amy-cara4']]) {
        assert.equal(resolve(variant).ok, false, JSON.stringify(variant));
    }
});

test('legacy Amy transcript submissions are rejected without analysis, persistence, or email', async () => {
    const route = loadRoute('app/api/save-transcript/route.ts', { '@/lib/agents': { ALL_AGENTS: agents } });
    for (const variant of [undefined, resolver.AMY_CARA4_VARIANT, 'public']) {
        const result = await route.POST(new Request('https://example.test/api/save-transcript', {
            method: 'POST', body: JSON.stringify({ personaId: amy, variant, transcript: [{ role: 'user', content: 'Fictional test only' }] }),
        }));
        assert.equal(result.status, 409);
        assert.match((await result.json()).error, /provider-authoritative/);
    }
});

test('public recall/status/delete are blocked even with forged consent, names and session IDs', async () => {
    const memory = loadRoute('app/api/anam/amy/memory/route.ts');
    const identity = loadRoute('app/api/anam/session/identity/route.ts');
    for (const method of ['GET', 'DELETE']) {
        const response = await memory[method](new Request('https://example.test/api/anam/amy/memory', { method }));
        assert.equal(response.status, 403);
        assert.match((await response.json()).error, /Returning memory is paused/);
    }
    const response = await identity.POST(new Request('https://example.test/api/anam/session/identity', {
        method: 'POST', body: JSON.stringify({ preferredName: 'Person B', memoryAccessConfirmed: true,
            email: 'person-a@example.test', sessionId: current, launchId: other }),
    }));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).memoryUnlocked, false);
});

class RequestError extends Error {}
function tokenMocks(overrides = {}) {
    const spine = {
        readAmyAnamSpineConfig: () => ({ enabled: true, gatesOpen: true, signingSecret: 'test-only' }),
        readBoundedJsonObject: request => request.json(),
        isTrustedBrowserOrigin: () => true,
        requestFingerprint: () => 'fixture-only',
        readAmyAnamBrowserSession: () => null,
        AmyAnamRequestError: RequestError,
        ...overrides,
    };
    return {
        '@/lib/agents': { ALL_AGENTS: agents },
        '@/lib/anam/session-spine': spine,
        '@/lib/anam/session-spine-store': { consumeAmyAnamDistributedRateLimit: async () => ({ allowed: true }) },
        '@/lib/anam/user-memory': { readAmyAnamMemoryConfig: () => ({ gatesOpen: true }), readAmyAnamBrowserIdentity: async () => null },
        '@/lib/anam/dani-session': { readDaniAnamSessionSecrets: () => ({}) },
        '@/lib/anam/dani-user-memory': { readDaniAnamMemoryConfig: () => ({}) },
        '@/lib/anam/outbound-email-config': { readAmyAnamAgentMailConfig: () => ({}) },
        '@/lib/anam/dani-agentmail': { readDaniAnamAgentMailConfig: () => ({}) },
        '@/lib/anam/evan-agentmail': { readEvanAnamAgentMailConfig: () => ({}) },
        '@/lib/anam/persona-readiness': {},
    };
}
const tokenRequest = variant => new Request('https://example.test/api/anam-token', {
    method: 'POST', body: JSON.stringify({ personaId: amy, variant }),
});
test('actual token route rejects missing check-in before contacting Anam, for canonical and old requests', async () => {
    const route = loadRoute('app/api/anam-token/route.ts', tokenMocks(), { ANAM_AMY_CARA4_PERSONA_ID: current });
    for (const variant of [undefined, resolver.AMY_CARA4_VARIANT]) {
        assert.equal((await route.POST(tokenRequest(variant))).status, 401);
    }
});
test('Amy flags cannot disable check-in protection; bad origins and rate limits fail before provider calls', async () => {
    for (const [overrides, expected] of [
        [{ readAmyAnamSpineConfig: () => ({ enabled: false, gatesOpen: false }) }, 503],
        [{ isTrustedBrowserOrigin: () => false }, 403],
    ]) {
        const route = loadRoute('app/api/anam-token/route.ts', tokenMocks(overrides), { ANAM_AMY_CARA4_PERSONA_ID: current });
        assert.equal((await route.POST(tokenRequest())).status, expected);
    }
    const mocks = tokenMocks();
    mocks['@/lib/anam/session-spine-store'].consumeAmyAnamDistributedRateLimit = async () => ({ allowed: false, retryAfterSeconds: 60 });
    const route = loadRoute('app/api/anam-token/route.ts', mocks, { ANAM_AMY_CARA4_PERSONA_ID: current });
    const result = await route.POST(tokenRequest());
    assert.equal(result.status, 429);
    assert.equal(result.headers.get('Retry-After'), '60');
});

test('valid Amy check-in starts the pinned persona with follow-up intact and recall disabled', async () => {
    const launches = [];
    const providerBodies = [];
    const mocks = tokenMocks({
        readAmyAnamBrowserSession: () => ({ id: 'fixture-browser' }),
        createAmyAnamLaunch: (browserSessionId, personaId, _now, agentSlug) => ({
            browserSessionId, personaId, agentSlug, launchId: 'fixture-launch', clientLabel: 'fixture-label',
        }),
    });
    mocks['@/lib/anam/user-memory'] = {
        readAmyAnamMemoryConfig: () => ({ enabled: true, gatesOpen: true }),
        readAmyAnamBrowserIdentity: async () => ({ memoryConsent: true, emailIdentityHash: 'legacy-fixture' }),
        buildAmyAnamMemoryAccessPolicy: enabled => { assert.equal(enabled, false); return 'Fresh session only'; },
    };
    mocks['@/lib/anam/contact-token'] = {
        readAmyAnamContactFromRequest: () => ({ purpose: 'amy_follow_up', email: 'test@example.test' }),
    };
    mocks['@/lib/anam/outbound-email-config'] = { readAmyAnamAgentMailConfig: () => ({ effectiveGateOpen: true }) };
    mocks['@/lib/anam/persona-readiness'] = { readAmyCara4PersonaReadiness: async () => ({ ready: true }) };
    mocks['@/lib/anam/session-spine-store'].storeAmyAnamLaunch = async launch => { launches.push(launch); return true; };
    const route = loadRoute('app/api/anam-token/route.ts', mocks, {
        ANAM_AMY_CARA4_PERSONA_ID: current, ANAM_API_KEY: 'fixture-not-a-real-key',
    }, async (_url, init) => {
        providerBodies.push(JSON.parse(init.body));
        return Response.json({ sessionToken: 'fixture-provider-token' });
    });
    for (const variant of [undefined, resolver.AMY_CARA4_VARIANT]) {
        const response = await route.POST(tokenRequest(variant));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.memoryUnlockAvailable, false);
        assert.equal(body.agentMailAvailable, true);
        assert.equal(body.sessionSpineEnabled, true);
        assert.equal(body.rawEmailReturned, false);
        assert.equal(body.variant, resolver.AMY_CARA4_VARIANT);
    }
    assert.equal(launches.length, 2);
    assert.ok(launches.every(launch => launch.personaId === current && launch.agentSlug === 'amy'));
    assert.ok(providerBodies.every(body => body.personaConfig.personaId === current));
    assert.ok(providerBodies.every(body => !JSON.stringify(body).includes('test@example.test')));
});

test('check-in preserves follow-up contact but ignores legacy recall consent and never looks up history', async () => {
    let stored;
    let contact;
    const route = loadRoute('app/api/anam/amy/access/route.ts', {
        '@/lib/anam/session-spine': {
            readAmyAnamSpineConfig: () => ({ signingSecret: 'fixture' }),
            isTrustedBrowserOrigin: () => true, requestFingerprint: () => 'fixture',
            readBoundedJsonObject: request => request.json(), AmyAnamRequestError: RequestError,
            createAmyAnamBrowserSessionWithSecret: () => ({ session: { id: 'fixture-session' }, token: 'fixture' }),
            amyAnamCookieOptions: () => ({}),
        },
        '@/lib/anam/session-spine-store': { consumeAmyAnamDistributedRateLimit: async () => ({ allowed: true }) },
        '@/lib/anam/user-memory': {
            readAmyAnamMemoryConfig: () => ({ gatesOpen: true, accessCode: 'fixture-code' }),
            storeAmyAnamBrowserIdentity: async input => { stored = input; return input; },
            normalizeAmyAnamMemoryEmail: value => value.trim().toLowerCase(),
            readAmyAnamApprovedMemoryHistory: sideEffect,
        },
        '@/lib/anam/contact-token': {
            createAmyAnamContactToken: input => { contact = input; return 'fixture-contact'; },
            amyAnamContactCookieOptions: () => ({}),
        },
    });
    const response = await route.POST(new Request('https://example.test/api/anam/amy/access', {
        method: 'POST', body: JSON.stringify({ displayName: 'Fictional Visitor', email: 'test@example.test',
            accessCode: 'fixture-code', memoryConsent: true }),
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.authenticated, true);
    assert.equal(result.memoryConsent, false);
    assert.equal(result.approvedMemoryCount, 0);
    assert.equal(result.memoryAccessMode, 'fresh_session_only');
    assert.equal(stored.memoryConsent, false);
    assert.equal(contact.purpose, 'amy_follow_up');
    assert.equal(contact.email, 'test@example.test');
    assert.equal(JSON.stringify(result).includes('test@example.test'), false);
});
