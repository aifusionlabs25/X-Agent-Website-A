import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { DANI_PERSONA_ID, EVAN_PERSONA_ID } from '../lib/anam/persona-ids.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const AMY_ID = '8c7d5b42-b17e-4321-8bfa-381c8d93820f';
const SECURED_AMY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REDIS_URL = 'https://token-access-redis.invalid';
const PROVIDER_URL = 'https://api.anam.ai/v1/auth/session-token';
const ORIGIN = 'https://access-test.invalid';
const SECRET = 'offline-token-access-signing-secret-over-32-characters';

// Execute the complete routes with real resolution, configuration, cookie
// signatures, identity storage, launch reservation and rate-limit code. A VM
// gives every case isolated environment variables and a fetch implementation
// that never delegates to the network. Only unrelated integrations and the
// external persona-readiness preflight are replaced.
function harness(options = {}) {
    const env = {
        NODE_ENV: 'production', ANAM_API_KEY: 'offline-anam-key',
        ANAM_AMY_CARA4_PERSONA_ID: SECURED_AMY_ID,
        AMY_ANAM_SESSION_SPINE_ENABLED: 'true', AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_SESSION_SECRET: SECRET,
        AMY_ANAM_REDIS_REST_URL: REDIS_URL, AMY_ANAM_REDIS_REST_TOKEN: 'offline-redis-token',
        AMY_ANAM_MEMORY_ENABLED: 'true', AMY_ANAM_MEMORY_KILL_SWITCH: 'false',
        AMY_ANAM_MEMORY_ACCESS_CODE: 'offline-invitation-code',
        AMY_ANAM_MEMORY_IDENTITY_SALT: 'offline-identity-salt-over-32-characters',
        ...options.env,
    };
    const db = new Map(), providerCalls = [], readinessCalls = [], unexpected = [];
    const fetch = async (url, init = {}) => {
        const target = String(url), body = init.body ? JSON.parse(init.body) : null;
        if (target === PROVIDER_URL) {
            providerCalls.push({ body, headers: init.headers });
            return Response.json({ sessionToken: 'offline-approved-session-token' });
        }
        if (target === REDIS_URL + '/pipeline') {
            return Response.json(body.map(command => {
                const [operation, key, value] = command;
                if (operation === 'GET') return { result: db.get(key) ?? null };
                if (operation === 'SET') {
                    if (command.includes('NX') && db.has(key)) return { result: null };
                    db.set(key, value); return { result: 'OK' };
                }
                if (operation === 'DEL') return { result: Number(db.delete(key)) };
                if (operation === 'EVAL' && command[3].startsWith('xagent:amy:anam:rate:v1:')) {
                    const count = Number(db.get(command[3]) || 0) + 1;
                    db.set(command[3], count); return { result: [count, command[4]] };
                }
                unexpected.push('Redis command: ' + operation);
                throw new Error('Unexpected offline Redis command');
            }));
        }
        unexpected.push(target);
        throw new Error('No real network permitted: ' + target);
    };
    const mocks = new Map([
        ['lib/anam/outbound-email-config.ts', { readAmyAnamAgentMailConfig: () => ({ effectiveGateOpen: false }) }],
        ['lib/anam/dani-agentmail.ts', { readDaniAnamAgentMailConfig: () => ({ effectiveGateOpen: false }) }],
        ['lib/anam/evan-agentmail.ts', { readEvanAnamAgentMailConfig: () => ({ effectiveGateOpen: false }) }],
        ['lib/anam/dani-user-memory.ts', { readDaniAnamMemoryConfig: () => ({ enabled: false, gatesOpen: false }) }],
        ['lib/anam/dani-memory-candidate.ts', { assertDaniAnamMemoryReviewArtifact: () => { throw new Error('Unexpected Dani operation'); } }],
        ['lib/anam/persona-readiness.ts', {
            DANI_PERSONA_ID, EVAN_PERSONA_ID,
            readAmyCara4PersonaReadiness: async personaId => {
                readinessCalls.push(personaId);
                if (options.readinessThrows) throw new Error('Offline preflight outage');
                return { ready: options.ready !== false };
            },
            readDaniPersonaReadiness: async () => { throw new Error('Unexpected Dani preflight'); },
            readEvanPersonaReadiness: async () => { throw new Error('Unexpected Evan preflight'); },
        }],
    ].map(([path, value]) => [resolve(root, path), value]));
    const cache = new Map();
    const context = vm.createContext({
        process: { env }, fetch, Buffer, Request, Response, Headers, URL,
        AbortSignal, AbortController, setTimeout, clearTimeout,
        console: { error() {}, warn() {}, log() {} },
    });
    function load(path) {
        const filename = resolve(root, path);
        if (mocks.has(filename)) return mocks.get(filename);
        if (cache.has(filename)) return cache.get(filename).exports;
        const module = { exports: {} };
        cache.set(filename, module);
        const source = readFileSync(filename, 'utf8');
        const compiled = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
            fileName: filename,
        }).outputText;
        const localRequire = specifier => {
            if (specifier.startsWith('node:') || specifier === 'next/server') return require(specifier);
            let dependency;
            if (specifier.startsWith('@/')) dependency = resolve(root, specifier.slice(2));
            else if (specifier.startsWith('.')) dependency = resolve(dirname(filename), specifier);
            else throw new Error('Unmocked package: ' + specifier);
            return load(dependency.endsWith('.ts') ? dependency : dependency + '.ts');
        };
        const execute = vm.runInContext(`(function(require, module, exports) {\n${compiled}\n})`, context, { filename });
        execute(localRequire, module, module.exports);
        return module.exports;
    }
    const tokenRoute = load('app/api/anam-token/route.ts');
    const accessRoute = load('app/api/anam/amy/access/route.ts');
    const spine = load('lib/anam/session-spine.ts');
    const agents = load('lib/agents.ts').ALL_AGENTS;
    function request(path, body, cookie = '', origin = ORIGIN) {
        return new Request(ORIGIN + path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }
    async function result(response) {
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(unexpected, [], 'all requests must stay inside the offline adapters');
        return { response, status: response.status, data: await response.json() };
    }
    return {
        env, db, providerCalls, readinessCalls, spine, agents,
        post: async (body, cookie = '', origin = ORIGIN) => result(await tokenRoute.POST(request('/api/anam-token', body, cookie, origin))),
        status: async (cookie = '') => result(await accessRoute.GET(request('/api/anam/amy/access', undefined, cookie))),
        checkIn: async (memoryConsent = false, accessCode = env.AMY_ANAM_MEMORY_ACCESS_CODE) => {
            const checked = await result(await accessRoute.POST(request('/api/anam/amy/access', {
                displayName: 'Offline Visitor', email: 'visitor@example.test', accessCode, memoryConsent,
            })));
            const cookie = checked.response.cookies.get(spine.AMY_ANAM_BROWSER_COOKIE);
            return { ...checked, cookie: cookie ? `${cookie.name}=${encodeURIComponent(cookie.value)}` : '' };
        },
        signedCookie: (secret = SECRET, now = Date.now()) => {
            const created = spine.createAmyAnamBrowserSessionWithSecret(secret, now);
            return { ...created, cookie: `${spine.AMY_ANAM_BROWSER_COOKIE}=${encodeURIComponent(created.token)}` };
        },
    };
}

const variants = [
    ['omitted', {}], ['null', { variant: null }], ['empty', { variant: '' }],
    ['whitespace', { variant: '  ' }], ['explicit', { variant: 'amy-cara4' }],
];

for (const [label, variant] of variants) {
    test(`anonymous Amy ${label} variant cannot mint a provider token`, async () => {
        const h = harness();
        const result = await h.post({ personaId: AMY_ID, ...variant });
        assert.equal(result.status, 401);
        assert.equal(h.providerCalls.length, 0);
        assert.equal(result.data.sessionToken, undefined);
        assert.equal(result.response.headers.get('set-cookie'), null, 'denied launch must not create access');
    });
}

for (const [label, env] of [
    ['spine disabled', { AMY_ANAM_SESSION_SPINE_ENABLED: 'false' }],
    ['spine kill switch', { AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'true' }],
    ['spine secret missing', { AMY_ANAM_SESSION_SECRET: '' }],
    ['Redis configuration missing', { AMY_ANAM_REDIS_REST_TOKEN: '' }],
    ['memory disabled', { AMY_ANAM_MEMORY_ENABLED: 'false' }],
    ['memory kill switch', { AMY_ANAM_MEMORY_KILL_SWITCH: 'true' }],
    ['invitation code missing', { AMY_ANAM_MEMORY_ACCESS_CODE: '' }],
    ['identity salt missing', { AMY_ANAM_MEMORY_IDENTITY_SALT: '' }],
    ['canonical persona missing', { ANAM_AMY_CARA4_PERSONA_ID: '' }],
    ['canonical persona is legacy ID', { ANAM_AMY_CARA4_PERSONA_ID: AMY_ID }],
]) {
    test(`Amy fails closed when ${label}, for both legacy and explicit requests`, async () => {
        for (const variant of [{}, { variant: 'amy-cara4' }]) {
            const h = harness();
            const checked = await h.checkIn();
            assert.equal(checked.status, 200);
            Object.assign(h.env, env);
            assert.equal((await h.post({ personaId: AMY_ID, ...variant }, checked.cookie)).status, 503);
            assert.equal(h.providerCalls.length, 0);
        }
    });
}

test('Amy access GET stays required anonymously and fails closed with disabled or unavailable gates', async () => {
    const open = harness();
    const anonymous = await open.status();
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.data.required, true);
    assert.equal(anonymous.data.authenticated, false);
    for (const env of [
        { AMY_ANAM_MEMORY_ENABLED: 'false' }, { AMY_ANAM_SESSION_SPINE_ENABLED: 'false' },
        { AMY_ANAM_MEMORY_KILL_SWITCH: 'true' }, { AMY_ANAM_SESSION_SECRET: '' },
    ]) {
        const h = harness({ env });
        const unavailable = await h.status();
        assert.equal(unavailable.status, 503);
        assert.notEqual(unavailable.data.required, false);
        assert.equal(h.providerCalls.length, 0);
    }
});

test('Amy rejects forged, expired and unrecognized signed sessions without minting', async () => {
    for (const kind of ['wrong-secret', 'tampered', 'expired', 'no-identity', 'different-browser']) {
        const h = harness();
        let cookie;
        if (kind === 'different-browser') {
            assert.equal((await h.checkIn()).status, 200);
            cookie = h.signedCookie().cookie;
        } else if (kind === 'wrong-secret') cookie = h.signedCookie(SECRET + '-forged').cookie;
        else if (kind === 'expired') cookie = h.signedCookie(SECRET, Date.now() - 5 * 60 * 60 * 1000).cookie;
        else if (kind === 'tampered') cookie = h.signedCookie().cookie + '.extra';
        else cookie = h.signedCookie().cookie;
        const result = await h.post({ personaId: AMY_ID }, cookie);
        assert.equal(result.status, 401, kind);
        assert.equal(h.providerCalls.length, 0, kind);
    }
});

test('wrong invitation code cannot create a usable Amy session', async () => {
    const h = harness();
    const checked = await h.checkIn(false, 'wrong-invitation-code');
    assert.equal(checked.status, 401);
    assert.equal(checked.cookie, '');
    assert.equal((await h.post({ personaId: AMY_ID }, checked.cookie)).status, 401);
    assert.equal(h.providerCalls.length, 0);
});

for (const memoryConsent of [false, true]) {
    test(`approved Amy check-in mints only canonical persona with memoryConsent=${memoryConsent}`, async () => {
        for (const [, variant] of variants) {
            const h = harness();
            const checked = await h.checkIn(memoryConsent);
            assert.equal(checked.status, 200);
            assert.equal(checked.data.authenticated, true);
            const result = await h.post({ personaId: AMY_ID, ...variant }, checked.cookie);
            assert.equal(result.status, 200, JSON.stringify(result.data));
            assert.equal(result.data.sessionToken, 'offline-approved-session-token');
            assert.equal(result.data.variant, 'amy-cara4');
            assert.equal(result.data.sessionSpineEnabled, true);
            assert.equal(result.data.memoryUnlockAvailable, memoryConsent);
            assert.equal(result.data.memoryPolicyContextAvailable, true);
            assert.equal(h.providerCalls.length, 1);
            assert.equal(h.providerCalls[0].body.personaConfig.personaId, SECURED_AMY_ID);
            assert.deepEqual(h.readinessCalls, [SECURED_AMY_ID]);
            const launch = JSON.parse(h.db.get('xagent:amy:anam:launch:v1:' + result.data.launchId));
            assert.equal(launch.resolvedPersonaId, SECURED_AMY_ID);
            assert.equal(launch.variant, 'amy-cara4');
            assert.equal(launch.agentSlug, 'amy');
            assert.equal(h.providerCalls[0].body.clientLabel, launch.clientLabel);
            assert.equal(result.data.rawEmailReturned, false);
            assert.equal(result.data.identityHashReturned, false);
        }
    });
}

test('Amy readiness failures and untrusted origins cannot mint after an approved check-in', async () => {
    for (const options of [{ ready: false }, { readinessThrows: true }]) {
        const h = harness(options), checked = await h.checkIn();
        assert.equal((await h.post({ personaId: AMY_ID }, checked.cookie)).status, 503);
        assert.equal(h.providerCalls.length, 0);
    }
    for (const origin of ['https://untrusted.invalid', '']) {
        const h = harness(), checked = await h.checkIn();
        assert.equal((await h.post({ personaId: AMY_ID }, checked.cookie, origin)).status, 403);
        assert.equal(h.providerCalls.length, 0);
    }
});

test('unrelated public agents retain default token access even while Amy gates are disabled', async () => {
    const h = harness({ env: { AMY_ANAM_MEMORY_ENABLED: 'false', AMY_ANAM_SESSION_SPINE_ENABLED: 'false' } });
    const personaId = h.agents.find(agent => agent.slug === 'michael').personaId;
    const result = await h.post({ personaId });
    assert.equal(result.status, 200);
    assert.equal(result.data.sessionSpineEnabled, false);
    assert.equal(h.providerCalls.length, 1);
    assert.equal(h.providerCalls[0].body.personaConfig.personaId, personaId);
    assert.deepEqual(h.readinessCalls, []);
});

test('unknown personas, direct canonical IDs and unsupported or malformed variants are rejected', async () => {
    const h = harness();
    const unrelatedId = h.agents.find(agent => agent.slug === 'michael').personaId;
    const cases = [
        [{ personaId: 'unknown-persona' }, 403], [{ personaId: SECURED_AMY_ID }, 403],
        [{}, 400], [{ personaId: unrelatedId, variant: 'amy-cara4' }, 400],
        ...['legacy', false, 0, {}, []].map(variant => [{ personaId: AMY_ID, variant }, 400]),
    ];
    for (const [body, status] of cases) assert.equal((await h.post(body)).status, status, JSON.stringify(body));
    assert.equal(h.providerCalls.length, 0);
});
