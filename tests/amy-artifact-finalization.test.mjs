import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { completeAmyAnamClientSession } from '../lib/anam/session-spine-client.ts';
import { recordAmyAnamCompletion } from '../lib/anam/session-spine-store.ts';
import { AMY_ANAM_BROWSER_COOKIE, createAmyAnamBrowserSessionWithSecret } from '../lib/anam/session-spine.ts';
import { DANI_PERSONA_ID, EVAN_PERSONA_ID } from '../lib/anam/persona-ids.ts';
import { queueAmyAnamConversationFollowUp, dispatchAmyAnamPostSessionFollowUp } from '../lib/anam/agentmail.ts';
import { comparisonTurns } from './fixtures/amy-planning-comparison.mjs';

const env = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true', AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 'artifact-test-secret-only'.repeat(3),
    AMY_ANAM_REDIS_REST_URL: 'https://redis.artifact.test', AMY_ANAM_REDIS_REST_TOKEN: 'test-only',
};
const launchId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const { session: browser, token } = createAmyAnamBrowserSessionWithSecret(env.AMY_ANAM_SESSION_SECRET);
const launch = { launchId, browserSessionId: browser.id, agentSlug: 'amy', resolvedPersonaId: '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08', boundSessionId: sessionId };
const state = globalThis.__amyArtifactRouteTest = { launch, calls: [], status: 'queued' };
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const source = await readFile(new URL('../app/api/anam/session/complete/route.ts', import.meta.url), 'utf8');
let compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const mocks = {
    'next/server': moduleUrl('export const after = () => {}; export const NextResponse = {json: (body, init) => Response.json(body, init)};'),
    '@/lib/anam/session-finalizer': moduleUrl('export async function finalizeAmyAnamSession() {throw new Error("Unexpected real finalization")}'),
    '@/lib/anam/dani-session': moduleUrl('export const readDaniAnamSessionSecrets=()=>({configured:false}); export const readDaniAnamBrowserSession=()=>null;'),
    '@/lib/anam/session-spine': new URL('../lib/anam/session-spine.ts', import.meta.url).href,
    '@/lib/anam/session-spine-store': moduleUrl(`
        const state = globalThis.__amyArtifactRouteTest;
        export const consumeAmyAnamDistributedRateLimit = async () => ({allowed: true});
        export const readAmyAnamLaunch = async () => state.launch;
        export const readAmyAnamReceipt = async () => null;
        export const recordAmyAnamCompletion = async input => {state.calls.push(input); return state.status};
    `),
};
for (const [from, to] of Object.entries(mocks)) compiled = compiled.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `"${to}"`);
const { POST } = await import(moduleUrl(compiled));
const baseBody = { launchId, sessionId, closeReason: 'pagehide' };
const request = (body, cookie = token, origin = 'https://xagent.aifusionlabs.app') => new Request('https://xagent.aifusionlabs.app/api/anam/session/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin, cookie: `${AMY_ANAM_BROWSER_COOKIE}=${cookie}` }, body: JSON.stringify(body),
});

test('actual completion route accepts only bounded metadata from the authenticated Amy browser', async () => {
    const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    try {
        state.calls.length = 0;
        const response = await POST(request({ ...baseBody, artifactView: 'visual', artifactRevision: 2 }));
        assert.equal(response.status, 202);
        assert.deepEqual(state.calls[0].displayedArtifact, { view: 'visual', revision: 2 });
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        for (const extra of [
            { artifactView: 'visual', artifactRevision: 0 }, { artifactView: 'visual', artifactRevision: 10001 },
            { artifactView: 'visual', artifactRevision: '2' }, { artifactView: 'html', artifactRevision: 1 },
            { artifactRevision: 2 }, { artifactView: 'visual', artifactRevision: 2, transcript: [] },
            { artifactView: 'visual', artifactRevision: 2, html: '<h1>forged</h1>' },
        ]) assert.equal((await POST(request({ ...baseBody, ...extra }))).status, 400);
        assert.equal(state.calls.length, 1);
        assert.equal((await POST(request(baseBody, 'invalid'))).status, 401);
        assert.equal((await POST(request(baseBody, token, 'https://evil.example'))).status, 403);
        state.launch = { ...launch, browserSessionId: 'another-browser' };
        assert.equal((await POST(request({ ...baseBody, artifactView: 'visual', artifactRevision: 2 }))).status, 403);
        for (const [agentSlug, resolvedPersonaId] of [['dani', DANI_PERSONA_ID], ['evan', EVAN_PERSONA_ID]]) {
            state.launch = { ...launch, agentSlug, resolvedPersonaId };
            assert.equal((await POST(request({ ...baseBody, artifactView: 'visual', artifactRevision: 2 }))).status, 400);
        }
        assert.equal(state.calls.length, 1);
        state.launch = launch;
        assert.equal((await POST(request(baseBody))).status, 202);
        assert.equal(state.calls.at(-1).displayedArtifact, undefined);
    } finally {
        state.launch = launch;
        for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value;
    }
});

test('metadata is atomic with completion and survives close-before-bind without content storage', async () => {
    let command;
    const input = { launch, browserSessionId: browser.id, externalSessionId: sessionId, closeReason: 'pagehide', displayedArtifact: { view: 'visual', revision: 2 } };
    const result = await recordAmyAnamCompletion(input, { env, fetchImpl: async (_url, init) => {
        [command] = JSON.parse(init.body);
        return Response.json([{ result: 'queued' }]);
    } });
    assert.equal(result, 'queued');
    assert.equal(command[0], 'EVAL');
    assert.match(command[1], /owner_mismatch/);
    assert.match(command[1], /session_conflict/);
    assert.match(command[1], /finalization\.browserSessionId.*return 'duplicate'/);
    assert.match(command[1], /session\.displayedArtifact = cjson.decode\(ARGV\[9\]\)/);
    const args = command.slice(9);
    assert.deepEqual(JSON.parse(args[5]).displayedArtifact, input.displayedArtifact);
    assert.deepEqual(JSON.parse(args[8]), input.displayedArtifact);
    assert.equal(args[7], 7 * 24 * 60 * 60);
    assert.doesNotMatch(JSON.stringify(args), /transcript|<html|customer facts/);
    const finalizer = await readFile(new URL('../lib/anam/session-finalizer.ts', import.meta.url), 'utf8');
    assert.match(finalizer, /=== 'amy' && finalization\.displayedArtifact/);
});

test('store rejects other agents and malformed metadata without contacting Redis', async () => {
    const fetchImpl = () => { throw new Error('No network allowed'); };
    for (const [agentSlug, resolvedPersonaId] of [['dani', DANI_PERSONA_ID], ['evan', EVAN_PERSONA_ID]]) {
        assert.equal(await recordAmyAnamCompletion({ launch: { ...launch, agentSlug, resolvedPersonaId }, browserSessionId: browser.id, externalSessionId: sessionId, closeReason: 'pagehide', displayedArtifact: { view: 'visual', revision: 1 } }, { env, fetchImpl }), 'owner_mismatch');
    }
    for (const displayedArtifact of [{ view: 'visual', revision: 1, content: 'forged' }, { view: 'other', revision: 1 }, { view: 'visual', revision: -1 }]) {
        assert.equal(await recordAmyAnamCompletion({ launch, browserSessionId: browser.id, externalSessionId: sessionId, closeReason: 'pagehide', displayedArtifact }, { env, fetchImpl }), 'owner_mismatch');
    }
});

test('keepalive transport includes no client facts and leaves legacy/other-agent bodies unchanged', async () => {
    const requests = [];
    const fetchImpl = async (_url, init) => { requests.push(init); return Response.json({ accepted: true }); };
    await completeAmyAnamClientSession({ ...baseBody, artifactView: 'visual', artifactRevision: 2, fetchImpl });
    await completeAmyAnamClientSession({ ...baseBody, fetchImpl });
    assert.deepEqual(JSON.parse(requests[0].body), { ...baseBody, artifactView: 'visual', artifactRevision: 2 });
    assert.deepEqual(JSON.parse(requests[1].body), baseBody);
    assert.ok(requests.every(init => init.keepalive && init.credentials === 'same-origin'));
});

test('finalized display metadata reaches the real email dispatcher with unchanged contact and idempotency gates', async () => {
    const mailEnv = { ...env, AMY_EMAIL_PROVIDER: 'agentmail', AMY_VISITOR_EMAIL_PROVIDER: 'resend',
        AMY_AGENTMAIL_ADDRESS: 'amy-insight@agentmail.to', AGENTMAIL_API_KEY: 'am_test_only_artifact_secret', RESEND_API_KEY: 're_test_only_artifact_secret',
        AMY_ANAM_AGENTMAIL_ENABLED: 'true', AMY_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
        AMY_ANAM_TOOLS_ENABLED: 'true', AMY_ANAM_TOOLS_KILL_SWITCH: 'false',
        AMY_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true', AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false' };
    const store = new Map();
    const requests = [];
    const fetchImpl = async (url, init) => {
        if (String(url).startsWith(env.AMY_ANAM_REDIS_REST_URL)) return Response.json(JSON.parse(init.body).map(([operation, key, value, condition]) => {
            if (operation === 'GET') return { result: store.get(key) ?? null };
            if (operation === 'DEL') return { result: store.delete(key) ? 1 : 0 };
            assert.equal(operation, 'SET');
            if ((condition === 'NX' && store.has(key)) || (condition === 'XX' && !store.has(key))) return { result: null };
            store.set(key, value);
            return { result: 'OK' };
        }));
        assert.match(String(url), /^https:\/\/(?:api\.resend\.com|api\.agentmail\.to)\//);
        requests.push({ url, body: JSON.parse(init.body), key: new Headers(init.headers).get('Idempotency-Key') });
        return Response.json(String(url).includes('resend') ? { id: 'test-visitor' } : { message_id: 'test-internal', thread_id: 'test-thread' });
    };
    const options = { env: mailEnv, fetchImpl };
    await queueAmyAnamConversationFollowUp({ externalSessionId: sessionId, browserSessionId: browser.id, displayName: 'Demo Visitor', email: 'typed@example.com', contactSecret: env.AMY_ANAM_SESSION_SECRET }, options);
    assert.equal(requests.length, 0);
    const session = { ...launch, externalSessionId: sessionId, displayedArtifact: { view: 'visual', revision: 2 }, boundAt: '2026-09-02T21:07:33Z', closeReceivedAt: '2026-09-02T21:11:07Z' };
    const input = { session, receipt: { externalSessionId: sessionId, completedAt: session.closeReceivedAt }, turns: comparisonTurns };
    await assert.rejects(dispatchAmyAnamPostSessionFollowUp({ ...input, session: { ...session, browserSessionId: 'wrong-browser' } }, options), /ownership/);
    assert.equal(requests.length, 0);
    assert.equal((await dispatchAmyAnamPostSessionFollowUp(input, options)).deliveryCount, 3);
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[0].body.to, ['typed@example.com']);
    for (const index of [0, 2]) {
        const attachment = requests[index].body.attachments[0];
        assert.equal(attachment.filename, 'amy-visual-brief.html');
        const html = Buffer.from(attachment.content, 'base64').toString('utf8');
        assert.match(html, /Integrated planning/);
        assert.match(html, /Phased planning/);
        assert.match(html, /IT and compliance/);
    }
    assert.equal(new Set(requests.map(item => item.key)).size, 3);
    assert.equal((await dispatchAmyAnamPostSessionFollowUp(input, options)).status, 'email_not_requested');
    assert.equal(requests.length, 3);
    assert.doesNotMatch([...store.values()].join(' '), /typed@example.com|cost savings|IT and compliance/);
});
