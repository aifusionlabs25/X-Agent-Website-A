import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../lib/meeting-concierge/v1/server.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tickets = require('../lib/meeting-concierge/v1/tickets.ts');
const ORIGIN = 'https://meeting-access.invalid';
const SECRET = 'offline-meeting-status-secret-over-32-characters';
const BROWSER = 'approved-browser';
const INVITE = '11111111-2222-4333-8444-555555555555';

// Execute the complete shared handler with a strict offline provider. The
// policy itself is tested separately; these tests verify its placement/scope.
function harness({ denyStatus = null, browserDenied = false, expiresAt = null, currentApproval = true } = {}) {
    const calls = { policy: [], browser: [], organizer: 0, rate: 0, persona: 0, provider: [] };
    const policy = {
        async requireAgentAccess(_request, agent, capability) {
            calls.policy.push([agent, capability]);
            assert.deepEqual([agent, capability], ['amy', 'meeting']);
            return denyStatus ? Response.json({ error: 'Access denied' }, { status: denyStatus }) : null;
        },
        async requireAgentBrowserAccess(_request, agent, browser, capability) {
            calls.browser.push([agent, browser, capability]);
            assert.deepEqual([agent, browser, capability], ['amy', BROWSER, 'meeting']);
            return browserDenied ? Response.json({ error: 'Account mismatch' }, { status: 403 }) : null;
        },
        async accessDecision(_request, agent, capability) {
            assert.deepEqual([agent, capability], ['amy', 'meeting']);
            return { authorized: currentApproval, owner: false, record: { expiresAt } };
        },
    };
    const exports = {};
    const context = vm.createContext({
        exports, module: { exports }, Request, Response, URL, Buffer, AbortController, setTimeout, clearTimeout,
        process: { env: { ANAM_API_KEY: 'offline-provider-key' } }, console: { info() {}, warn() {}, error() {} },
        require(name) {
            if (name === 'node:crypto') return require(name);
            if (name === 'next/server') return { NextResponse: { json: Response.json } };
            if (name === '../../access/policy.ts') return policy;
            if (name === './tickets') return tickets;
            throw new Error('Unexpected module: ' + name);
        },
        async fetch(url, init = {}) {
            assert.ok(String(url).startsWith('https://api.anam.ai/v1/meetings/invites'));
            calls.provider.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
            return Response.json({ id: INVITE, provider: 'google_meet', status: 'pending' });
        },
    });
    new vm.Script(compiled, { filename: 'meeting-server.js' }).runInContext(context);
    const handlers = exports.createMeetingConciergeHandlers({
        agentKey: 'amy', agentName: 'Amy', displayName: 'Amy',
        statusTokenSecret: () => SECRET,
        readOrganizer: async () => { calls.organizer++; return { authenticated: true, displayName: 'Organizer', isolationId: BROWSER }; },
        resolvePersona: async () => { calls.persona++; return { personaId: 'offline-persona' }; },
        platform: {
            isTrustedBrowserOrigin: request => request.headers.get('origin') === ORIGIN,
            readBoundedJsonObject: request => request.json(),
            requestFingerprint: () => 'offline-fingerprint',
            consumeRateLimit: async () => { calls.rate++; return { allowed: true, retryAfterSeconds: 0 }; },
        },
    });
    return { calls, handlers };
}

function request(method, body = {}) {
    return new Request(ORIGIN + '/api/anam/amy/meetings', {
        method, headers: { origin: ORIGIN, 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
}
const createBody = { meetingUrl: 'https://meet.google.com/abc-defg-hij', groupCall: false, maxDurationMinutes: 15 };

test('anonymous and unapproved meeting GET/POST/DELETE stop before all side effects', async () => {
    for (const denyStatus of [401, 403]) for (const method of ['GET', 'POST', 'DELETE']) {
        const h = harness({ denyStatus });
        assert.equal((await h.handlers[method](request(method, createBody))).status, denyStatus);
        assert.equal(h.calls.organizer + h.calls.rate + h.calls.persona + h.calls.provider.length, 0);
    }
});

test('a valid old browser cookie cannot expose or mutate another account meeting', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
        const h = harness({ browserDenied: true });
        assert.equal((await h.handlers[method](request(method, createBody))).status, 403);
        assert.equal(h.calls.persona + h.calls.provider.length, 0);
    }
});

test('meeting approval can create an invitation without requesting conversation or email permission', async () => {
    const h = harness();
    const response = await h.handlers.POST(request('POST', createBody));
    assert.equal(response.status, 201);
    assert.equal(h.calls.provider.length, 1);
    assert.equal(h.calls.provider[0].method, 'POST');
    assert.equal(h.calls.provider[0].body.meetingUrl, createBody.meetingUrl);
    assert.equal(h.calls.policy.every(([, capability]) => capability === 'meeting'), true);
    const ticket = (await response.json()).invite.id;
    assert.equal(tickets.readMeetingConciergeStatusTicket({ agentKey: 'amy', isolationId: BROWSER, secret: SECRET, ticket }), INVITE);
});

test('meeting dispatch rejects a revoked grant and schedules extending past approval expiry', async () => {
    for (const configuration of [
        { currentApproval: false },
        { expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() },
    ]) {
        const h = harness(configuration);
        assert.equal((await h.handlers.POST(request('POST', createBody))).status, 403);
        assert.equal(h.calls.persona + h.calls.provider.length, 0);
    }
    const h = harness({ expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
    assert.equal((await h.handlers.POST(request('POST', { ...createBody, joinAt: new Date(Date.now() + 90 * 60_000).toISOString() }))).status, 403);
    assert.equal(h.calls.persona + h.calls.provider.length, 0);
});

test('approved meeting read and cancellation keep the original scoped status ticket', async () => {
    const ticket = tickets.issueMeetingConciergeStatusTicket({ agentKey: 'amy', isolationId: BROWSER, secret: SECRET, inviteId: INVITE });
    const h = harness();
    const read = new Request(ORIGIN + '/api/anam/amy/meetings?inviteId=' + encodeURIComponent(ticket), { headers: { origin: ORIGIN } });
    assert.equal((await h.handlers.GET(read)).status, 200);
    assert.equal((await h.handlers.DELETE(request('DELETE', { inviteId: ticket }))).status, 200);
    assert.deepEqual(h.calls.provider.map(call => call.method), ['GET', 'DELETE']);
});
