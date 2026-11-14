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
const EVAN_PUBLIC_COPY_ID = '11111111-1111-4111-8111-111111111111';
const EVAN_PRIVATE_COPY_ID = '22222222-2222-4222-8222-222222222222';
const EVAN_DEMO_CODE = 'offline-private-demo-access-code-over-32-characters';
const PRIVATE_TOKEN_PATH = '/api/anam/evan/extended/token';

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
        EVAN_PUBLIC_DEMO_PERSONA_ID: EVAN_PUBLIC_COPY_ID,
        EVAN_EXTENDED_DEMO_PERSONA_ID: EVAN_PRIVATE_COPY_ID,
        EVAN_EXTENDED_DEMO_ACCESS_KEY: EVAN_DEMO_CODE,
        EVAN_PUBLIC_DEMO_ENABLED: 'true', EVAN_PUBLIC_DEMO_MAIL_ROUTING: 'all-aifl',
        ...options.env,
    };
    const db = new Map(), providerCalls = [], readinessCalls = [], evanReadinessCalls = [], unexpected = [];
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
                // Capture the real binding function's serialized launch/session
                // records without delegating Redis execution to a network.
                if (operation === 'EVAL' && command[2] === 2 && command[1].includes("return 'bound'")) {
                    db.set(command[3], command[9]);
                    db.set(command[4], command[10]);
                    return { result: 'bound' };
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
        ['lib/anam/evan-agentmail.ts', { readEvanAnamAgentMailConfig: () => ({ effectiveGateOpen: options.evanEmailAvailable === true }) }],
        ['lib/anam/evan-demo-runtime.ts', {
            verifyEvanDemoPersona: async (_apiKey, policy) => {
                evanReadinessCalls.push(JSON.parse(JSON.stringify(policy)));
                if (options.evanCloneDrift) throw new Error('Offline clone checkpoint mismatch');
            },
        }],
        ['lib/anam/evan-capture-service.ts', { readEvanCaptureConfig: () => ({ enabled: env.EVAN_CAPTURE_ENABLED === 'true' }) }],
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
    const privateTokenRoute = load('app/api/anam/evan/extended/token/route.ts');
    const demoAccessRoute = load('app/api/anam/evan/demo-access/route.ts');
    const accessRoute = load('app/api/anam/amy/access/route.ts');
    const evanAccessRoute = load('app/api/anam/evan/access/route.ts');
    const demoPolicy = load('lib/anam/evan-demo-policy.ts');
    const sessionApi = load('lib/anam/session-api.ts');
    const sessionStore = load('lib/anam/session-spine-store.ts');
    const spine = load('lib/anam/session-spine.ts');
    const agents = load('lib/agents.ts').ALL_AGENTS;
    function request(path, body, cookie = '', origin = ORIGIN, extraHeaders = {}) {
        return new Request(ORIGIN + path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...extraHeaders },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }
    async function result(response) {
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(unexpected, [], 'all requests must stay inside the offline adapters');
        return { response, status: response.status, data: await response.json() };
    }
    return {
        env, db, providerCalls, readinessCalls, evanReadinessCalls, spine, agents, sessionApi, sessionStore,
        post: async (body, cookie = '', origin = ORIGIN) => result(await tokenRoute.POST(request('/api/anam-token', body, cookie, origin))),
        postWithQuery: async (query, body, cookie = '') => result(await tokenRoute.POST(request('/api/anam-token?' + query, body, cookie))),
        postWithHeaders: async (body, cookie, headers) => result(await tokenRoute.POST(request('/api/anam-token', body, cookie, ORIGIN, headers))),
        postPrivate: async (body, cookie = '', origin = ORIGIN) => result(await privateTokenRoute.POST(request(PRIVATE_TOKEN_PATH, body, cookie, origin))),
        postPrivateWithQuery: async (query, body, cookie = '') => result(await privateTokenRoute.POST(request(PRIVATE_TOKEN_PATH + '?' + query, body, cookie))),
        demoStatus: async (cookie = '') => result(await demoAccessRoute.GET(request('/api/anam/evan/demo-access', undefined, cookie))),
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
        evanGuestCheckIn: async () => {
            const checked = await result(await evanAccessRoute.POST(request('/api/anam/evan/access', { guest: true })));
            const cookie = checked.response.cookies.get(spine.AMY_ANAM_BROWSER_COOKIE);
            return { ...checked, cookie: cookie ? `${cookie.name}=${encodeURIComponent(cookie.value)}` : '' };
        },
        evanEmailCheckIn: async () => {
            const checked = await result(await evanAccessRoute.POST(request('/api/anam/evan/access', {
                displayName: 'Offline Visitor', email: 'visitor@example.test', followUpConsent: true,
            })));
            return { ...checked, cookie: checked.response.cookies.getAll()
                .map(cookie => `${cookie.name}=${encodeURIComponent(cookie.value)}`).join('; ') };
        },
        demoGrantCookie: (grantOrigin = ORIGIN, now = Date.now()) => `${demoPolicy.EVAN_DEMO_COOKIE}=${demoPolicy.createEvanDemoGrant(grantOrigin, env, now)}`,
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

test('public Evan guest check-in receives only the 180-second provider copy', async () => {
    const h = harness();
    assert.equal((await h.post({ personaId: EVAN_PERSONA_ID })).status, 401, 'normal guest check-in remains required');
    const checked = await h.evanGuestCheckIn();
    assert.equal(checked.status, 200);
    const result = await h.post({ personaId: EVAN_PERSONA_ID }, checked.cookie);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.demoPolicy, { mode: 'public', maxSeconds: 180 });
    assert.equal(result.data.sessionSpineEnabled, true);
    assert.equal(h.providerCalls.length, 1);
    assert.equal(h.providerCalls[0].body.personaConfig.personaId, EVAN_PUBLIC_COPY_ID);
    assert.deepEqual(h.evanReadinessCalls.at(-1), { mode: 'public', maxSeconds: 180, providerPersonaId: EVAN_PUBLIC_COPY_ID });
    assert.equal(result.data.demoPolicy.providerPersonaId, undefined);
});

test('only the explicit private route plus signed grant selects the 1800-second provider copy', async () => {
    const h = harness(), checked = await h.evanGuestCheckIn();
    const result = await h.postPrivate({ personaId: EVAN_PERSONA_ID }, `${checked.cookie}; ${h.demoGrantCookie()}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.demoPolicy, { mode: 'extended', maxSeconds: 1800 });
    assert.equal(h.providerCalls[0].body.personaConfig.personaId, EVAN_PRIVATE_COPY_ID);
    assert.deepEqual(h.evanReadinessCalls, [{ mode: 'extended', maxSeconds: 1800, providerPersonaId: EVAN_PRIVATE_COPY_ID }]);
});

test('client query/body/header overrides and any private grant never upgrade public Evan', async () => {
    for (const mode of ['valid', 'query', 'body', 'headers', 'tampered', 'expired', 'cross-origin']) {
        const h = harness(), checked = await h.evanGuestCheckIn();
        let cookie = checked.cookie;
        if (['valid', 'query', 'body', 'headers'].includes(mode)) cookie += `; ${h.demoGrantCookie()}`;
        if (mode === 'tampered') cookie += `; ${h.demoGrantCookie()}x`;
        if (mode === 'expired') cookie += `; ${h.demoGrantCookie(ORIGIN, Date.now() - 3_700_000)}`;
        if (mode === 'cross-origin') cookie += `; ${h.demoGrantCookie('https://another-preview.invalid')}`;
        const body = { personaId: EVAN_PERSONA_ID, ...(mode === 'body' ? { mode: 'extended', maxSeconds: 1800, providerPersonaId: EVAN_PRIVATE_COPY_ID } : {}) };
        const result = mode === 'query'
            ? await h.postWithQuery(`mode=extended&maxSeconds=1800&providerPersonaId=${EVAN_PRIVATE_COPY_ID}`, body, cookie)
            : mode === 'headers' ? await h.postWithHeaders(body, cookie, {
                referer: ORIGIN + '/demo/evan/extended', 'x-evan-demo-mode': 'extended',
                'x-original-url': PRIVATE_TOKEN_PATH, 'x-forwarded-uri': PRIVATE_TOKEN_PATH,
            })
            : await h.post(body, cookie);
        assert.equal(result.status, 200, mode);
        assert.deepEqual(result.data.demoPolicy, { mode: 'public', maxSeconds: 180 }, mode);
        assert.equal(h.providerCalls[0].body.personaConfig.personaId, EVAN_PUBLIC_COPY_ID, mode);
    }
});

test('private token route rejects absent, malformed, expired, future, and foreign grants before preflight or launch', async () => {
    for (const kind of ['absent', 'malformed', 'tampered', 'expired', 'future', 'foreign-host', 'foreign-port', 'foreign-protocol']) {
        const h = harness(), checked = await h.evanGuestCheckIn();
        const grants = {
            absent: '', malformed: 'xagent_evan_extended_demo=not-a-grant', tampered: h.demoGrantCookie() + 'x',
            expired: h.demoGrantCookie(ORIGIN, Date.now() - 3_700_000),
            future: h.demoGrantCookie(ORIGIN, Date.now() + 60_000),
            'foreign-host': h.demoGrantCookie('https://foreign.invalid'),
            'foreign-port': h.demoGrantCookie(ORIGIN + ':8443'),
            'foreign-protocol': h.demoGrantCookie(ORIGIN.replace('https:', 'http:')),
        };
        const result = await h.postPrivateWithQuery('mode=extended&maxSeconds=1800', {
            personaId: EVAN_PERSONA_ID, mode: 'extended', maxSeconds: 1800,
        }, `${checked.cookie}; ${grants[kind]}`);
        assert.equal(result.status, 403, kind);
        assert.equal(result.data.sessionToken, undefined, kind);
        assert.equal(result.data.demoPolicy, undefined, 'a denied private call must not silently become public');
        assert.deepEqual(h.evanReadinessCalls, [], kind);
        assert.equal(h.providerCalls.length, 0, kind);
        assert.equal([...h.db.keys()].some(key => key.includes(':launch:')), false, kind);
    }
});

test('private token route requires its own trusted origin, Evan identity, and no variant', async () => {
    const h = harness(), checked = await h.evanGuestCheckIn();
    const cookie = `${checked.cookie}; ${h.demoGrantCookie()}`;
    for (const origin of ['', 'https://foreign.invalid', 'null']) {
        assert.equal((await h.postPrivate({ personaId: EVAN_PERSONA_ID }, cookie, origin)).status, 403);
    }
    for (const body of [{}, { personaId: AMY_ID }, { personaId: DANI_PERSONA_ID },
        { personaId: EVAN_PUBLIC_COPY_ID }, { personaId: EVAN_PRIVATE_COPY_ID },
        ...['amy-cara4', 'extended', '', null, false].map(variant => ({ personaId: EVAN_PERSONA_ID, variant }))]) {
        assert.equal((await h.postPrivate(body, cookie)).status, 403, JSON.stringify(body));
    }
    assert.deepEqual(h.evanReadinessCalls, []);
    assert.deepEqual(h.readinessCalls, []);
    assert.equal(h.providerCalls.length, 0);
    assert.equal([...h.db.keys()].some(key => key.includes(':launch:')), false);
});

test('a private grant alone does not replace the existing guest check-in', async () => {
    const h = harness();
    const result = await h.postPrivate({ personaId: EVAN_PERSONA_ID }, h.demoGrantCookie());
    assert.equal(result.status, 401);
    assert.equal(h.providerCalls.length, 0);
    assert.equal([...h.db.keys()].some(key => key.includes(':launch:')), false);
});

test('private email check-in preserves email eligibility and ignores duration inflation', async () => {
    const h = harness({ evanEmailAvailable: true }), checked = await h.evanEmailCheckIn();
    assert.equal(checked.status, 200);
    const result = await h.postPrivateWithQuery('maxSeconds=86400&mode=public', {
        personaId: EVAN_PERSONA_ID, maxSeconds: 86400, mode: 'public', providerPersonaId: EVAN_PUBLIC_COPY_ID,
    }, `${checked.cookie}; ${h.demoGrantCookie()}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.demoPolicy, { mode: 'extended', maxSeconds: 1800 });
    assert.equal(result.data.agentMailAvailable, true);
    assert.equal(result.data.rawEmailReturned, false);
    assert.equal(h.providerCalls[0].body.personaConfig.personaId, EVAN_PRIVATE_COPY_ID);
});

test('same-browser public and private launches remain separate without clearing access', async () => {
    const h = harness(), checked = await h.evanGuestCheckIn();
    const cookie = `${checked.cookie}; ${h.demoGrantCookie()}`;
    for (const extended of [true, false, true, false]) {
        const status = await h.demoStatus(cookie);
        assert.equal(status.status, 200);
        assert.deepEqual(status.data, { mode: 'public', maxSeconds: 180, extendedAccess: true, aiflDemoRecaps: true });
        assert.equal(status.response.headers.get('set-cookie'), null, 'public status must not revoke a private tab');
        const launched = await (extended ? h.postPrivate : h.post)({ personaId: EVAN_PERSONA_ID }, cookie);
        assert.equal(launched.status, 200);
        assert.deepEqual(launched.data.demoPolicy, { mode: extended ? 'extended' : 'public', maxSeconds: extended ? 1800 : 180 });
        assert.equal(launched.response.cookies.get('xagent_evan_extended_demo'), undefined);
    }
    assert.deepEqual(h.providerCalls.map(call => call.body.personaConfig.personaId),
        [EVAN_PRIVATE_COPY_ID, EVAN_PUBLIC_COPY_ID, EVAN_PRIVATE_COPY_ID, EVAN_PUBLIC_COPY_ID]);
});

test('private access expiration after a successful status check fails closed at token issuance', async () => {
    const h = harness(), checked = await h.evanGuestCheckIn();
    const status = await h.demoStatus(`${checked.cookie}; ${h.demoGrantCookie()}`);
    assert.equal(status.data.extendedAccess, true);
    const expiredCookie = `${checked.cookie}; ${h.demoGrantCookie(ORIGIN, Date.now() - 3_700_000)}`;
    const failed = await h.postPrivate({ personaId: EVAN_PERSONA_ID }, expiredCookie);
    assert.equal(failed.status, 403);
    assert.equal(failed.data.sessionToken, undefined);
    assert.deepEqual(h.evanReadinessCalls, []);
    assert.equal(h.providerCalls.length, 0);
    const publicStatus = await h.demoStatus(expiredCookie);
    assert.deepEqual(publicStatus.data, { mode: 'public', maxSeconds: 180, extendedAccess: false, aiflDemoRecaps: true });
});

test('public and private token routes share the same per-browser launch limit', async () => {
    const h = harness(), checked = await h.evanGuestCheckIn();
    const cookie = `${checked.cookie}; ${h.demoGrantCookie()}`;
    for (let index = 0; index < 5; index++) {
        const result = await (index % 2 ? h.postPrivate : h.post)({ personaId: EVAN_PERSONA_ID }, cookie);
        assert.equal(result.status, 200);
    }
    assert.equal((await h.postPrivate({ personaId: EVAN_PERSONA_ID }, cookie)).status, 429);
    assert.equal(h.providerCalls.length, 5, 'switching endpoint cannot double the existing launch allowance');
});

test('unconfigured Evan duration, unavailable spine, and clone drift fail closed', async () => {
    for (const patch of [
        { EVAN_PUBLIC_DEMO_PERSONA_ID: '' }, { EVAN_PUBLIC_DEMO_PERSONA_ID: 'invalid' },
        { AMY_ANAM_SESSION_SPINE_ENABLED: 'false' }, { AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'true' },
    ]) {
        const h = harness(), checked = await h.evanGuestCheckIn();
        Object.assign(h.env, patch);
        const result = await h.post({ personaId: EVAN_PERSONA_ID }, checked.cookie);
        assert.equal(result.status, 503);
        assert.equal(h.providerCalls.length, 0);
    }
    const h = harness({ evanCloneDrift: true }), checked = await h.evanGuestCheckIn();
    assert.equal((await h.post({ personaId: EVAN_PERSONA_ID }, checked.cookie)).status, 503);
    assert.equal(h.providerCalls.length, 0);
    assert.equal([...h.db.keys()].some(key => key.includes(':launch:')), false);
    const privateMissing = harness(), privateChecked = await privateMissing.evanGuestCheckIn();
    const privateCookie = `${privateChecked.cookie}; ${privateMissing.demoGrantCookie()}`;
    privateMissing.env.EVAN_EXTENDED_DEMO_PERSONA_ID = '';
    assert.equal((await privateMissing.postPrivate({ personaId: EVAN_PERSONA_ID }, privateCookie)).status, 503);
    assert.equal(privateMissing.providerCalls.length, 0);
    assert.equal((await privateMissing.post({ personaId: EVAN_PERSONA_ID }, privateCookie)).status, 200,
        'missing private configuration does not break the public lane');
});

test('provider copy IDs cannot be requested directly even with an extended grant', async () => {
    const h = harness(), checked = await h.evanGuestCheckIn();
    for (const personaId of [EVAN_PUBLIC_COPY_ID, EVAN_PRIVATE_COPY_ID]) {
        assert.equal((await h.post({ personaId }, `${checked.cookie}; ${h.demoGrantCookie()}`)).status, 403);
    }
    assert.equal(h.providerCalls.length, 0);
});

test('Evan launch and bound session preserve logical identity while provider metadata requires the selected copy', async () => {
    for (const extended of [false, true]) {
        const h = harness(), checked = await h.evanGuestCheckIn();
        const result = await (extended ? h.postPrivate : h.post)({ personaId: EVAN_PERSONA_ID }, checked.cookie + (extended ? `; ${h.demoGrantCookie()}` : ''));
        const launchKey = 'xagent:amy:anam:launch:v1:' + result.data.launchId;
        const launch = JSON.parse(h.db.get(launchKey));
        const providerPersonaId = extended ? EVAN_PRIVATE_COPY_ID : EVAN_PUBLIC_COPY_ID;
        assert.equal(launch.resolvedPersonaId, EVAN_PERSONA_ID);
        assert.equal(launch.agentSlug, 'evan');
        assert.equal(launch.evanDemoPolicy.providerPersonaId, providerPersonaId);
        assert.equal(h.providerCalls[0].body.clientLabel, launch.clientLabel);
        const metadata = { id: '33333333-3333-4333-8333-333333333333', personaId: providerPersonaId,
            clientLabel: launch.clientLabel, personaConfig: { type: 'stateful', metadata: { client: 'js-sdk' } } };
        assert.doesNotThrow(() => h.sessionApi.verifyAnamSessionMetadata(metadata, launch));
        for (const wrong of [EVAN_PERSONA_ID, extended ? EVAN_PUBLIC_COPY_ID : EVAN_PRIVATE_COPY_ID, SECURED_AMY_ID]) {
            assert.throws(() => h.sessionApi.verifyAnamSessionMetadata({ ...metadata, personaId: wrong }, launch), /persona did not match/);
        }
        assert.throws(() => h.sessionApi.verifyAnamSessionMetadata(metadata, { ...launch, agentSlug: 'amy' }), /policy was invalid/);
        assert.throws(() => h.sessionApi.verifyAnamSessionMetadata(metadata, { ...launch, resolvedPersonaId: SECURED_AMY_ID }), /policy was invalid/);
        assert.throws(() => h.sessionApi.verifyAnamSessionMetadata({ ...metadata, clientLabel: 'foreign' }, launch), /identity did not match/);
        assert.equal(await h.sessionStore.bindAmyAnamLaunch({ launch, browserSessionId: launch.browserSessionId, externalSessionId: metadata.id }), 'bound');
        const boundLaunch = JSON.parse(h.db.get(launchKey));
        const session = JSON.parse(h.db.get('xagent:amy:anam:session:v1:' + metadata.id));
        assert.equal(boundLaunch.evanDemoPolicy.providerPersonaId, providerPersonaId);
        assert.equal(session.resolvedPersonaId, EVAN_PERSONA_ID, 'capture and emails retain logical Evan');
        assert.equal(session.agentSlug, 'evan');
        assert.equal(session.variant, launch.variant);
    }
});

test('missing Evan configuration and private grants cannot affect Amy or unrelated public agents', async () => {
    const h = harness({ evanCloneDrift: true, env: { EVAN_PUBLIC_DEMO_PERSONA_ID: '', EVAN_EXTENDED_DEMO_PERSONA_ID: '' } });
    const checked = await h.checkIn();
    const result = await h.post({ personaId: AMY_ID }, `${checked.cookie}; ${h.demoGrantCookie()}`);
    assert.equal(result.status, 200);
    assert.equal(result.data.demoPolicy, undefined);
    assert.equal(h.providerCalls[0].body.personaConfig.personaId, SECURED_AMY_ID);
    const unrelated = h.agents.find(agent => agent.slug === 'michael').personaId;
    const other = await h.post({ personaId: unrelated }, h.demoGrantCookie());
    assert.equal(other.status, 200);
    assert.equal(other.data.demoPolicy, undefined);
    assert.equal(h.providerCalls[1].body.personaConfig.personaId, unrelated);
    assert.deepEqual(h.evanReadinessCalls, []);
});
