import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const ORIGIN = 'https://xagent.aifusionlabs.app';
const REDIS_URL = 'https://shared-policy-redis.invalid';
const EMAIL = 'visitor@example.test';
const OWNER_EMAIL = 'aifusionlabs@gmail.com';
const BROWSER = 'offline-browser-one';

// Invoke the production policy, grant store and route handlers. The verified
// identity boundary is replaced here; access-auth.test.mjs exercises the real
// authentication library. Every Redis command passes through the real bounded
// HTTP transport, with a strict in-memory adapter and no network fallback.
function harness(t, options = {}) {
    const env = { NODE_ENV: 'production', AMY_ANAM_REDIS_REST_URL: REDIS_URL,
        AMY_ANAM_REDIS_REST_TOKEN: 'offline-policy-token', ...options.env };
    const identities = new Map([
        ['visitor', { id: 'user-visitor', email: EMAIL, name: 'Visitor' }],
        ['other', { id: 'user-other', email: 'other@example.test', name: 'Other' }],
        ['same-email', { id: 'replacement-user', email: EMAIL, name: 'Replacement' }],
        ['owner', { id: 'user-owner', email: OWNER_EMAIL, name: 'Owner' }],
    ]);
    const db = new Map(), expires = new Map(), sets = new Map(), sorted = new Map();
    const commands = [], unexpected = [];
    let outage = false, authOutage = false, beforeNextCas = null;
    function get(key) {
        if (expires.get(key) <= Date.now()) { db.delete(key); expires.delete(key); }
        return db.get(key) ?? null;
    }
    function put(key, value, ttl) {
        db.set(key, value);
        if (ttl) expires.set(key, Date.now() + Number(ttl) * 1000);
    }
    const fetch = async (url, init = {}) => {
        if (options.clientFetch && String(url).startsWith('/')) return options.clientFetch(String(url), init);
        if (String(url) !== REDIS_URL) {
            unexpected.push(String(url));
            throw new Error('External network forbidden by this test');
        }
        if (outage) return Response.json({ error: 'offline outage' }, { status: 503 });
        const command = JSON.parse(init.body);
        commands.push(command);
        const [operation, key, value] = command;
        let result;
        if (operation === 'GET') result = get(key);
        else if (operation === 'SET') {
            const ex = command.indexOf('EX');
            result = command.includes('NX') && get(key) !== null ? null : 'OK';
            if (result === 'OK') put(key, value, ex < 0 ? null : command[ex + 1]);
        } else if (operation === 'MGET') result = command.slice(1).map(get);
        else if (operation === 'SMEMBERS') result = [...(sets.get(key) ?? [])];
        else if (operation === 'SADD' || operation === 'SREM') {
            const set = sets.get(key) ?? new Set();
            result = operation === 'SADD' ? Number(!set.has(value)) : Number(set.has(value));
            if (operation === 'SADD') set.add(value); else set.delete(value);
            sets.set(key, set);
        } else if (operation === 'ZREVRANGE') {
            result = [...(sorted.get(key) ?? new Map())].sort((a, b) => b[1] - a[1])
                .slice(Number(value), Number(command[3]) + 1).map(([id]) => id);
        } else if (operation === 'EVAL') {
            const script = key, count = Number(value);
            const keys = command.slice(3, 3 + count), args = command.slice(3 + count);
            if (script.includes("redis.call('INCR'")) {
                result = Number(get(keys[0]) ?? 0) + 1;
                put(keys[0], result, result === 1 ? args[0] : null);
            } else if (script.includes("redis.call('ZADD'")) {
                if (script.includes('local old=') && beforeNextCas) {
                    const run = beforeNextCas;
                    beforeNextCas = null;
                    await run();
                }
                if (script.includes('local old=') && (get(keys[0]) ?? '') !== args[4]) result = 0;
                else {
                    put(keys[0], args[0], args[1]);
                    const index = sorted.get(keys[1]) ?? new Map();
                    index.set(args[3], Number(args[2]));
                    if (script.includes('ZREMRANGEBYSCORE')) {
                        for (const [id, score] of index) if (score <= Number(args[4])) index.delete(id);
                    }
                    sorted.set(keys[1], index);
                    result = 1;
                }
            } else { unexpected.push('Redis script: ' + script); throw new Error('Unknown offline script'); }
        } else { unexpected.push('Redis command: ' + operation); throw new Error('Unknown offline command'); }
        return Response.json({ result });
    };
    const mockAuth = { readAccessIdentity: async request => {
        if (authOutage) throw new Error('Offline authentication outage');
        return identities.get(request.headers.get('x-offline-identity')) ?? null;
    } };
    const cache = new Map();
    const context = vm.createContext({ process: { env }, fetch, Buffer, Request, Response, Headers,
        URL, AbortSignal, AbortController, setTimeout, clearTimeout, console: { error() {}, warn() {}, log() {} } });
    function load(path) {
        const filename = resolve(root, path);
        if (filename === resolve(root, 'lib/access/auth.ts')) return mockAuth;
        if (cache.has(filename)) return cache.get(filename).exports;
        const loadedModule = { exports: {} };
        cache.set(filename, loadedModule);
        const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
        }).outputText;
        const localRequire = specifier => {
            if (specifier.startsWith('node:') || specifier === '@upstash/redis' || specifier === 'next/server') return require(specifier);
            const dependency = specifier.startsWith('@/') ? resolve(root, specifier.slice(2))
                : specifier.startsWith('.') ? resolve(dirname(filename), specifier) : null;
            if (!dependency) throw new Error('Unmocked package: ' + specifier);
            return load(dependency.endsWith('.ts') ? dependency : dependency + '.ts');
        };
        const execute = vm.runInContext(`(function(require, module, exports) {\n${compiled}\n})`, context, { filename });
        execute(localRequire, loadedModule, loadedModule.exports);
        return loadedModule.exports;
    }
    const policy = load('lib/access/policy.ts'), grants = load('lib/access/grants.ts');
    const statusRoute = load('app/api/access/route.ts'), requestRoute = load('app/api/access/request/route.ts');
    const adminRoute = load('app/api/access/admin/route.ts');
    const agents = load('lib/agents.ts').ALL_AGENTS.map(agent => agent.slug);
    function request(path = '/api/access', body, identity = 'visitor', origin = ORIGIN) {
        return new Request(ORIGIN + path, { method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', ...(identity ? { 'x-offline-identity': identity } : {}),
                ...(origin ? { origin } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    async function response(pending) {
        const result = await pending;
        assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.equal(result.headers.get('vary'), 'Cookie');
        return { status: result.status, data: await result.json() };
    }
    async function save(agent = 'amy', overrides = {}) {
        const record = { email: EMAIL, agent, capabilities: ['conversation'], requestedCapabilities: [],
            status: 'approved', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            updatedAt: new Date().toISOString(), updatedBy: OWNER_EMAIL, ...overrides };
        await grants.writeAccessRecord(record);
        return record;
    }
    t.after(() => assert.deepEqual(unexpected, [], 'all calls stayed inside offline adapters'));
    return { policy, grants, agents, env, db, commands, request, save, load,
        deny: (agent, capability = 'conversation', identity = 'visitor', origin = ORIGIN) =>
            policy.requireAgentAccess(request('/api/launch', {}, identity, origin), agent, capability),
        status: (agent, capability = 'conversation', identity = 'visitor') => response(statusRoute.GET(request(
            agent === undefined ? '/api/access' : `/api/access?agent=${agent}&capability=${capability}`, undefined, identity))),
        ask: (body, identity = 'visitor', origin = ORIGIN) => response(requestRoute.POST(request('/api/access/request', body, identity, origin))),
        admin: (body, identity = 'owner', origin = ORIGIN) => response(adminRoute.POST(request('/api/access/admin', body, identity, origin))),
        dashboard: (identity = 'owner') => response(adminRoute.GET(request('/api/access/admin', undefined, identity))),
        setOutage: value => { outage = value; }, setAuthOutage: value => { authOutage = value; },
        beforeNextCas: run => { beforeNextCas = run; },
    };
}

test('anonymous visitors are denied every activity for all ten registered agents', async t => {
    const h = harness(t);
    assert.deepEqual([...h.agents].sort(), ['amy', 'claire', 'dani', 'evan', 'james', 'luke', 'michael', 'morgan', 'sarah-netic', 'taylor']);
    for (const agent of h.agents) {
        for (const activity of ['conversation', 'meeting', 'actions']) assert.equal((await h.deny(agent, activity, null)).status, 401);
        const result = await h.status(agent, 'conversation', null);
        assert.equal(result.status, 200);
        assert.equal(result.data.authenticated, false);
        assert.equal(result.data.authorized, false);
    }
    assert.equal(h.commands.length, 0, 'anonymous access cannot create policy records');
});

test('an approval is limited to its exact account, agent and capability', async t => {
    const h = harness(t);
    await h.save('amy');
    assert.equal(await h.deny('amy'), null);
    for (const agent of h.agents.filter(agent => agent !== 'amy')) assert.equal((await h.deny(agent)).status, 403);
    assert.equal((await h.deny('amy', 'meeting')).status, 403);
    assert.equal((await h.deny('amy', 'actions')).status, 403);
    assert.equal((await h.deny('amy', 'conversation', 'other')).status, 403);
    assert.equal((await h.status('amy')).data.authorized, true);
});

test('expired, revoked, declined and pending records never authorize', async t => {
    const h = harness(t);
    for (const overrides of [{ expiresAt: new Date(Date.now() - 1).toISOString() }, { expiresAt: null },
        { status: 'revoked' }, { status: 'declined' }, { status: 'pending', expiresAt: null }]) {
        await h.save('amy', overrides);
        assert.equal((await h.deny('amy')).status, 403);
        assert.equal((await h.status('amy')).data.authorized, false);
    }
});

test('unknown agents and activities fail closed even for owner', async t => {
    const h = harness(t);
    for (const [agent, capability] of [['unknown-agent', 'conversation'], ['amy', 'administrator'], ['AMY', 'conversation']]) {
        assert.equal((await h.deny(agent, capability, 'owner')).status, 403);
        assert.equal((await h.status(agent, capability, 'owner')).status, 400);
    }
});

test('owner has all activities but global and per-agent pauses override owner access', async t => {
    const h = harness(t);
    for (const agent of h.agents) for (const activity of ['conversation', 'meeting', 'actions']) assert.equal(await h.deny(agent, activity, 'owner'), null);
    await h.grants.setAccessAgentDisabled('amy', true);
    assert.equal((await h.deny('amy', 'conversation', 'owner')).status, 403);
    assert.equal(await h.deny('james', 'conversation', 'owner'), null);
    await h.grants.setAccessAgentDisabled('amy', false);
    h.env.XAGENT_ACCESS_DISABLED_AGENTS = 'amy';
    assert.equal((await h.deny('amy', 'conversation', 'owner')).status, 403);
    h.env.XAGENT_ACCESS_DISABLED_AGENTS = '*';
    for (const agent of h.agents) assert.equal((await h.deny(agent, 'conversation', 'owner')).status, 403);
});

test('configured owner replaces the default owner instead of adding an implicit account', async t => {
    const h = harness(t, { env: { XAGENT_ACCESS_OWNER_EMAILS: ' OTHER@example.test ' } });
    assert.equal(await h.deny('amy', 'actions', 'other'), null);
    assert.equal((await h.deny('amy', 'actions', 'owner')).status, 403);
});

test('Redis and authentication failures deny access and return an unavailable status', async t => {
    const h = harness(t);
    await h.save();
    h.setOutage(true);
    assert.equal((await h.deny('amy')).status, 503);
    assert.equal((await h.deny('amy', 'conversation', 'owner')).status, 503);
    assert.equal((await h.status('amy')).status, 503);
    assert.equal((await h.dashboard()).status, 503);
    h.setOutage(false);
    h.env.AMY_ANAM_REDIS_REST_TOKEN = '';
    assert.equal((await h.deny('amy')).status, 503);
    h.setAuthOutage(true);
    assert.equal((await h.status()).status, 503);
    assert.equal((await h.deny('amy')).status, 503);
});

test('corrupt stored records fail closed instead of authorizing', async t => {
    const h = harness(t);
    await h.save();
    const key = [...h.db.keys()].find(key => key.includes(':record:'));
    const original = h.db.get(key);
    for (const value of ['not json', JSON.stringify({ ...JSON.parse(original), email: 'other@example.test' }),
        JSON.stringify({ ...JSON.parse(original), capabilities: ['administrator'] })]) {
        h.db.set(key, value);
        assert.equal((await h.deny('amy')).status, 503);
    }
});

test('browser bindings prevent account switching and cannot be overwritten', async t => {
    const h = harness(t);
    await h.save();
    await h.save('amy', { email: 'other@example.test' });
    await h.policy.bindAgentAccessBrowser(h.request(), 'amy', BROWSER);
    assert.equal(await h.policy.requireAgentBrowserAccess(h.request(), 'amy', BROWSER), null);
    for (const identity of ['other', 'same-email', 'owner']) {
        assert.equal((await h.policy.requireAgentBrowserAccess(h.request('/api/launch', {}, identity), 'amy', BROWSER)).status, 403);
    }
    await assert.rejects(h.policy.bindAgentAccessBrowser(h.request('/api/launch', {}, 'other'), 'amy', BROWSER), /another account/);
    assert.equal((await h.grants.readAccessBrowser('amy', BROWSER)).email, EMAIL);
    assert.equal((await h.policy.requireAgentBrowserAccess(h.request(), 'amy', 'unknown-browser')).status, 403);
});

test('meeting-only approval allows entry but cannot start a conversation', async t => {
    const h = harness(t);
    await h.save('dani', { capabilities: ['meeting'] });
    assert.equal(await h.policy.requireAgentEntryAccess(h.request(), 'dani'), null);
    assert.equal((await h.deny('dani', 'conversation')).status, 403);
    assert.equal(await h.deny('dani', 'meeting'), null);
    assert.equal((await h.policy.requireAgentEntryAccess(h.request('/api/access', undefined, null), 'dani')).status, 401);
});

test('background work rechecks current capability, expiry, revocation and pauses', async t => {
    const h = harness(t);
    assert.equal(await h.policy.isStoredBrowserAccessAllowed('amy', BROWSER), false, 'unbound legacy jobs must not run');
    await h.policy.bindAgentAccessBrowser(h.request(), 'amy', BROWSER);
    await h.save();
    assert.equal(await h.policy.isStoredBrowserAccessAllowed('amy', BROWSER), false, 'conversation grant does not permit actions');
    await h.save('amy', { capabilities: ['conversation', 'actions'] });
    assert.equal(await h.policy.isStoredBrowserAccessAllowed('amy', BROWSER), true);
    await h.save('amy', { capabilities: ['actions'], status: 'revoked' });
    assert.equal(await h.policy.isStoredBrowserAccessAllowed('amy', BROWSER), false);
    await h.save('amy', { capabilities: ['actions'], expiresAt: new Date(Date.now() - 10).toISOString() });
    assert.equal(await h.policy.isStoredBrowserAccessAllowed('amy', BROWSER), false);
    await h.save('amy', { capabilities: ['actions'] });
    await h.grants.setAccessAgentDisabled('amy', true);
    assert.equal(await h.policy.isStoredBrowserAccessAllowed('amy', BROWSER), false);
    await h.grants.setAccessAgentDisabled('amy', false);
    h.env.XAGENT_ACCESS_DISABLED_AGENTS = '*';
    assert.equal(await h.policy.isStoredBrowserAccessAllowed('amy', BROWSER), false);
    h.env.XAGENT_ACCESS_DISABLED_AGENTS = '';
    h.setOutage(true);
    assert.equal(await h.policy.isStoredBrowserAccessAllowed('amy', BROWSER), false);
});

test('access requests require a verified identity and a same-origin write', async t => {
    const h = harness(t);
    const body = { agent: 'amy', capability: 'conversation' };
    assert.equal((await h.ask(body, null)).status, 401);
    assert.equal((await h.ask(body, 'visitor', 'https://attacker.invalid')).status, 403);
    assert.equal((await h.ask(body, 'visitor', null)).status, 403);
    assert.equal(h.commands.length, 0);
    assert.equal((await h.ask({ agent: 'unknown', capability: 'conversation' })).status, 400);
    assert.equal((await h.ask({ agent: 'amy', capability: 'administrator' })).status, 400);
});

test('requests save only the signed-in account as pending and cannot self-approve', async t => {
    const h = harness(t);
    assert.equal((await h.ask({ agent: 'amy', capability: 'conversation', email: OWNER_EMAIL,
        status: 'approved', capabilities: ['conversation', 'meeting', 'actions'], expiresAt: '2099-01-01' })).status, 200);
    const record = await h.grants.readAccessRecord(EMAIL, 'amy');
    assert.equal(record.status, 'pending');
    assert.equal(record.expiresAt, null);
    assert.deepEqual([...record.capabilities], ['conversation']);
    assert.equal(await h.grants.readAccessRecord(OWNER_EMAIL, 'amy'), null);
    assert.equal((await h.status('amy')).data.requested, true);
    assert.equal((await h.deny('amy')).status, 403);
});

test('requesting another capability preserves the current approval without extending it', async t => {
    const h = harness(t);
    const approved = await h.save();
    assert.equal((await h.ask({ agent: 'amy', capability: 'meeting' })).status, 200);
    const record = await h.grants.readAccessRecord(EMAIL, 'amy');
    assert.equal(record.status, 'approved');
    assert.deepEqual([...record.capabilities], ['conversation']);
    assert.deepEqual([...record.requestedCapabilities], ['meeting']);
    assert.equal(record.expiresAt, approved.expiresAt);
    assert.equal(record.updatedBy, OWNER_EMAIL);
    assert.equal(await h.deny('amy'), null);
    assert.equal((await h.deny('amy', 'meeting')).status, 403);
    assert.equal((await h.status('amy', 'meeting')).data.requested, true);
});

test('a concurrent owner approval survives an in-flight visitor request', async t => {
    const h = harness(t);
    h.beforeNextCas(() => h.save('amy', { capabilities: ['meeting'] }));
    assert.equal((await h.ask({ agent: 'amy', capability: 'conversation' })).status, 200);
    const record = await h.grants.readAccessRecord(EMAIL, 'amy');
    assert.equal(record.status, 'approved');
    assert.equal(record.updatedBy, OWNER_EMAIL);
    assert.deepEqual([...record.capabilities], ['meeting']);
    assert.deepEqual([...record.requestedCapabilities], ['conversation']);
    assert.equal(await h.deny('amy', 'meeting'), null);
    assert.equal((await h.deny('amy')).status, 403);
});

test('a concurrent owner revocation cannot be resurrected by a visitor request', async t => {
    const h = harness(t);
    await h.save();
    h.beforeNextCas(() => h.save('amy', { status: 'revoked', expiresAt: null }));
    assert.equal((await h.ask({ agent: 'amy', capability: 'meeting' })).status, 200);
    assert.equal((await h.deny('amy')).status, 403);
    assert.equal((await h.deny('amy', 'meeting')).status, 403);
    assert.notEqual((await h.grants.readAccessRecord(EMAIL, 'amy')).status, 'approved');
});

test('request rate limiting bounds repeated submissions without granting access', async t => {
    const h = harness(t);
    for (let i = 0; i < 20; i += 1) assert.equal((await h.ask({ agent: 'amy' })).status, 200);
    assert.equal((await h.ask({ agent: 'amy' })).status, 429);
    assert.equal((await h.deny('amy')).status, 403);
});

test('admin routes deny anonymous users, nonowners and cross-origin mutations', async t => {
    const h = harness(t);
    const body = { agent: 'amy', email: EMAIL, operation: 'revoke' };
    assert.equal((await h.dashboard(null)).status, 401);
    assert.equal((await h.dashboard('visitor')).status, 403);
    assert.equal((await h.admin(body, null)).status, 401);
    assert.equal((await h.admin(body, 'visitor')).status, 403);
    assert.equal((await h.admin(body, 'owner', 'https://attacker.invalid')).status, 403);
    assert.equal((await h.admin(body, 'owner', null)).status, 403);
    assert.equal(h.commands.length, 0, 'denied admin calls never touch stored grants');
});

test('owner approval, dashboard listing and revocation change live policy decisions', async t => {
    const h = harness(t);
    assert.equal((await h.ask({ agent: 'james', capability: 'conversation' })).status, 200);
    assert.equal((await h.admin({ agent: 'james', email: ' VISITOR@EXAMPLE.TEST ', operation: 'approve',
        capabilities: ['conversation', 'actions'], expiresAt: new Date(Date.now() + 3600_000).toISOString() })).status, 200);
    assert.equal(await h.deny('james', 'conversation'), null);
    assert.equal(await h.deny('james', 'actions'), null);
    assert.equal((await h.deny('james', 'meeting')).status, 403);
    const dashboard = await h.dashboard();
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.data.agents.length, 10);
    assert.equal(dashboard.data.records.length, 1);
    assert.equal(dashboard.data.records[0].updatedBy, OWNER_EMAIL);
    assert.equal((await h.admin({ agent: 'james', email: EMAIL, operation: 'revoke' })).status, 200);
    assert.equal((await h.deny('james', 'actions')).status, 403);
    assert.equal((await h.grants.readAccessRecord(EMAIL, 'james')).status, 'revoked');
});

test('admin validates grant expiry, identity and capabilities before writing an approval', async t => {
    const h = harness(t);
    const valid = { agent: 'amy', email: EMAIL, operation: 'approve', capabilities: ['conversation'],
        expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    for (const invalid of [{ agent: 'not-an-agent' }, { email: 'invalid' }, { capabilities: [] },
        { capabilities: ['owner'] }, { expiresAt: 'invalid' }, { expiresAt: new Date(Date.now() - 1).toISOString() },
        { expiresAt: new Date(Date.now() + 91 * 86400_000).toISOString() }, { operation: 'grant-owner' }]) {
        assert.equal((await h.admin({ ...valid, ...invalid })).status, 400);
    }
    assert.equal(await h.grants.readAccessRecord(EMAIL, 'amy'), null);
});

test('owner pause and resume route blocks existing approvals and appears in dashboard', async t => {
    const h = harness(t);
    await h.save();
    assert.equal((await h.admin({ agent: 'amy', operation: 'set-agent-state', disabled: true })).status, 200);
    assert.equal((await h.deny('amy')).status, 403);
    assert.deepEqual((await h.dashboard()).data.disabledAgents, ['amy']);
    assert.equal((await h.admin({ agent: 'amy', operation: 'set-agent-state', disabled: false })).status, 200);
    assert.equal(await h.deny('amy'), null);
});

test('account status never implies authorization to an agent', async t => {
    const h = harness(t);
    const visitor = await h.status();
    assert.equal(visitor.status, 200);
    assert.equal(visitor.data.authenticated, true);
    assert.equal(visitor.data.authorized, false);
    assert.equal(visitor.data.email, EMAIL);
    assert.equal(visitor.data.owner, false);
    assert.equal((await h.status(undefined, undefined, 'owner')).data.owner, true);
});

test('owner dashboard reads two hundred records within the Redis command bound', async t => {
    const h = harness(t);
    for (let i = 0; i < 200; i += 1) await h.save('amy', { email: `visitor-${i}@example.test` });
    const result = await h.dashboard();
    assert.equal(result.status, 200);
    assert.equal(result.data.records.length, 200);
    const batches = h.commands.filter(command => command[0] === 'MGET');
    assert.ok(batches.length > 1);
    assert.ok(batches.every(command => command.length <= 100));
});

test('sign-in return destinations preserve local queries and reject external redirects', t => {
    const h = harness(t);
    const { safeAccessReturnTo } = h.load('components/access/navigation.ts');
    const local = '/agents/amy/meeting?invitation=local-value&step=consent#join';
    assert.equal(safeAccessReturnTo(local), local);
    assert.equal(safeAccessReturnTo('/demo/james?qa=1'), '/demo/james?qa=1');
    for (const value of [null, 'https://attacker.invalid', '//attacker.invalid', '/\\attacker.invalid',
        '/%2f%2fattacker.invalid', '/%5cattacker.invalid', '/%00hidden', '/%zz', '/\n/attacker.invalid']) {
        assert.equal(safeAccessReturnTo(value, '/#agents'), '/#agents');
    }
});

test('Amy meeting preparation uses the verified account without requesting email or memory consent', async t => {
    const calls = [];
    const h = harness(t, { clientFetch: async (url, init) => {
        calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
        if (url === '/api/access') return Response.json({ authenticated: true, displayName: 'Verified Organizer' });
        assert.equal(url, '/api/anam/amy/access');
        return Response.json({ authenticated: true, displayName: 'Verified Organizer' });
    } });
    const adapter = h.load('lib/meeting-concierge/v1/adapters/amy-client.ts').amyMeetingConciergeAdapter;
    assert.equal(adapter.checkInEnabled, false);
    assert.equal(adapter.checkIn, undefined);
    assert.equal((await adapter.prepareOrganizer()).authenticated, true);
    assert.deepEqual(calls, [
        { url: '/api/access', body: null },
        { url: '/api/anam/amy/access', body: { displayName: 'Verified Organizer', memoryConsent: false, followUpConsent: false } },
    ]);
});

test('Amy meeting preparation stops if account verification is unavailable', async t => {
    let calls = 0;
    const h = harness(t, { clientFetch: async url => {
        calls++;
        assert.equal(url, '/api/access');
        return Response.json({ error: 'Unavailable' }, { status: 503 });
    } });
    const adapter = h.load('lib/meeting-concierge/v1/adapters/amy-client.ts').amyMeetingConciergeAdapter;
    await assert.rejects(adapter.prepareOrganizer(), /Sign in/);
    assert.equal(calls, 1, 'failed account check cannot bootstrap an agent session');
});

test('Evan meeting preparation creates only a guest context and never opts into follow-up', async t => {
    const calls = [];
    const h = harness(t, { clientFetch: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return Response.json({ authenticated: true, guest: true, followUpAuthorized: false });
    } });
    const adapter = h.load('lib/meeting-concierge/v1/adapters/evan-client.ts').evanMeetingConciergeAdapter;
    assert.equal(adapter.checkInEnabled, false);
    assert.equal(adapter.checkIn, undefined);
    assert.equal((await adapter.prepareOrganizer()).authenticated, true);
    assert.deepEqual(calls, [{ url: '/api/anam/evan/access', body: { guest: true } }]);
});
