import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { renderAmyVisitorRecap } from '../lib/anam/amy-visitor-email.ts';
import {
    buildAmyConversationFollowUp,
    readAmyAnamAgentMailConfig,
    dispatchAmyAnamPostSessionFollowUp,
    queueAmyAnamConversationFollowUp,
} from '../lib/anam/agentmail.ts';
import {
    createAmyAnamContactToken,
    readAmyAnamContactToken,
} from '../lib/anam/contact-token.ts';
import { sendAmyEmailWithAgentMail } from '../lib/email/amy-email-provider.ts';
import { sendAmyEmailWithResend } from '../lib/email/amy-resend-provider.ts';
import { buildAmyEmailBundle } from '../lib/anam/agentmail-templates.ts';
import { buildAmyWorkbenchModel } from '../lib/anam/workbench-v2.ts';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const BROWSER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SECRET = 's'.repeat(48);
const ENV = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: SECRET,
    AMY_ANAM_REDIS_REST_URL: 'https://redis.agentmail.test',
    AMY_ANAM_REDIS_REST_TOKEN: 'redis-agentmail-secret',
    AMY_EMAIL_PROVIDER: 'agentmail',
    AMY_AGENTMAIL_ADDRESS: 'amy-insight@agentmail.to',
    AGENTMAIL_API_KEY: 'am_agentmail_test_secret',
    AMY_ANAM_AGENTMAIL_ENABLED: 'true',
    AMY_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
    AMY_ANAM_TOOLS_ENABLED: 'true',
    AMY_ANAM_TOOLS_KILL_SWITCH: 'false',
    AMY_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true',
    AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
};

test('checked-in email is encrypted, session-bound, expiring, and tamper-evident', () => {
    const now = Date.UTC(2026, 6, 18, 12, 0, 0);
    const token = createAmyAnamContactToken({
        browserSessionId: BROWSER_ID,
        email: ' RVicks@Gmail.com ',
        secret: SECRET,
        now,
    });
    assert.equal(token.includes('rvicks@gmail.com'), false);
    assert.deepEqual(readAmyAnamContactToken({
        token,
        browserSessionId: BROWSER_ID,
        secret: SECRET,
        now: now + 1_000,
    }), { email: 'rvicks@gmail.com' });
    const evanToken = createAmyAnamContactToken({
        browserSessionId: BROWSER_ID,
        email: 'rvicks@gmail.com',
        displayName: 'Rob Vicks',
        purpose: 'evan_follow_up',
        secret: SECRET,
        now,
    });
    assert.deepEqual(readAmyAnamContactToken({
        token: evanToken,
        browserSessionId: BROWSER_ID,
        secret: SECRET,
        now: now + 1_000,
    }), { email: 'rvicks@gmail.com', displayName: 'Rob Vicks', purpose: 'evan_follow_up' });
    assert.equal(readAmyAnamContactToken({
        token,
        browserSessionId: BROWSER_ID,
        secret: SECRET,
        now: now + 1_000,
    })?.purpose, undefined);
    const amyFollowUpToken = createAmyAnamContactToken({
        browserSessionId: BROWSER_ID,
        email: 'rvicks@gmail.com',
        displayName: 'Rob Vicks',
        purpose: 'amy_follow_up',
        secret: SECRET,
        now,
    });
    assert.deepEqual(readAmyAnamContactToken({
        token: amyFollowUpToken,
        browserSessionId: BROWSER_ID,
        secret: SECRET,
        now: now + 1_000,
    }), { email: 'rvicks@gmail.com', displayName: 'Rob Vicks', purpose: 'amy_follow_up' });
    assert.equal(readAmyAnamContactToken({
        token,
        browserSessionId: 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        secret: SECRET,
        now: now + 1_000,
    }), null);
    const tamperedParts = token.split('.');
    tamperedParts[3] = `${tamperedParts[3].startsWith('A') ? 'B' : 'A'}${tamperedParts[3].slice(1)}`;
    assert.equal(readAmyAnamContactToken({
        token: tamperedParts.join('.'),
        browserSessionId: BROWSER_ID,
        secret: SECRET,
        now: now + 1_000,
    }), null);
    assert.equal(readAmyAnamContactToken({
        token,
        browserSessionId: BROWSER_ID,
        secret: SECRET,
        now: now + 5 * 60 * 60 * 1_000,
    }), null);
});

test('all AgentMail, tool, outbound, provider, and spine gates must be open', () => {
    const open = readAmyAnamAgentMailConfig(ENV);
    assert.equal(open.implemented, true);
    assert.equal(open.configured, true);
    assert.equal(open.effectiveGateOpen, true);

    for (const override of [
        { AMY_ANAM_AGENTMAIL_KILL_SWITCH: 'true' },
        { AMY_ANAM_TOOLS_KILL_SWITCH: 'true' },
        { AMY_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'true' },
        { AMY_EMAIL_PROVIDER: 'off' },
        { AGENTMAIL_API_KEY: '' },
        { AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'true' },
    ]) {
        assert.equal(readAmyAnamAgentMailConfig({ ...ENV, ...override }).effectiveGateOpen, false);
    }
    const resendVisitor = readAmyAnamAgentMailConfig({
        ...ENV,
        AMY_VISITOR_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_amy_visitor_test_secret',
    });
    assert.equal(resendVisitor.effectiveGateOpen, true);
    assert.equal(resendVisitor.visitorProvider, 'resend');
    assert.equal(resendVisitor.visitorProviderConfigured, true);
    assert.equal(readAmyAnamAgentMailConfig({
        ...ENV,
        AMY_VISITOR_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: '',
    }).effectiveGateOpen, false);
});

test('AgentMail adapter sends through Amy inbox and returns a bounded receipt', async () => {
    let request;
    const result = await sendAmyEmailWithAgentMail({
        to: 'visitor@example.com',
        subject: 'Amy follow-up',
        text: 'Hello there.',
        html: '<p>Hello there.</p>',
    }, {
        env: ENV,
        fetchImpl: async (url, init) => {
            request = { url, init };
            return new Response(JSON.stringify({ message_id: 'msg_1', thread_id: 'thr_1' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });
    assert.equal(request.url, 'https://api.agentmail.to/v0/inboxes/amy-insight%40agentmail.to/messages/send');
    assert.equal(request.init.headers.Authorization, 'Bearer am_agentmail_test_secret');
    const body = JSON.parse(request.init.body);
    assert.deepEqual(body.to, ['visitor@example.com']);
    assert.deepEqual(result, {
        provider: 'agentmail',
        sent: true,
        messageId: 'msg_1',
        threadId: 'thr_1',
    });
});

test('follow-up content is deterministic, redacts contact data, and escapes HTML', () => {
    const message = buildAmyConversationFollowUp({
        displayName: 'Rob Vicks <script>',
        turns: [
            { role: 'user', content: 'We need to migrate our ERP to Azure. Email me at attacker@example.com <script>alert(1)</script>.' },
            { role: 'agent', content: 'What continuity requirement matters most?' },
            { role: 'user', content: 'The overnight maintenance window is critical.' },
            { role: 'user', content: 'My address is R V I C K S at gmail dot com. Before we close, can you send a Pulse Session email?' },
        ],
    });
    assert.match(message.text, /ERP|Azure/i);
    assert.doesNotMatch(message.text, /attacker@example\.com/i);
    assert.doesNotMatch(message.text, /R V I C K S|gmail dot com/i);
    assert.doesNotMatch(message.html, /<script>/i);
    assert.match(message.html, /AI-powered conversational agent/i);
    assert.match(message.html, /A FOLLOW-UP FROM AMY/i);
    assert.match(message.html, /Thank you, Rob\.<br>/i);
    assert.doesNotMatch(message.html, /Thank you, Rob Vicks/i);
    assert.match(message.text, /speaking with me/i);
    assert.doesNotMatch(message.text, /appropriate specialists will review it and follow up/i);
    assert.match(message.html, /Continue with Amy/i);
    assert.match(message.html, /https:\/\/xagent\.aifusionlabs\.app\/demo\/amy\?variant=cara4/i);
    assert.doesNotMatch(message.text, /Thank you for speaking with Amy|Reply to this email if/i);
    assert.doesNotMatch(message.text, /Timing:\s*Before we close|Pulse Session/i);
});

test('email permission queues without sending, then finalization sends the complete three-email bundle', async () => {
    const store = new Map();
    const agentMailRequests = [];
    const fetchImpl = async (url, init) => {
        if (String(url).startsWith('https://redis.agentmail.test/')) {
            const commands = JSON.parse(init.body);
            const results = commands.map(command => {
                const [operation, key, storedValue, condition] = command;
                if (operation === 'GET') return { result: store.get(key) ?? null };
                if (operation === 'DEL') return { result: store.delete(key) ? 1 : 0 };
                if (operation === 'SET' && condition === 'NX') {
                    if (store.has(key)) return { result: null };
                    store.set(key, storedValue);
                    return { result: 'OK' };
                }
                if (operation === 'SET' && condition === 'XX') {
                    if (!store.has(key)) return { result: null };
                    store.set(key, storedValue);
                    return { result: 'OK' };
                }
                throw new Error(`Unexpected Redis command: ${operation}`);
            });
            return new Response(JSON.stringify(results), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        agentMailRequests.push({
            body: JSON.parse(init.body),
            idempotencyKey: new Headers(init.headers).get('Idempotency-Key'),
        });
        return new Response(JSON.stringify({ message_id: 'msg_once', thread_id: 'thr_once' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    const queueInput = {
        externalSessionId: SESSION_ID,
        browserSessionId: BROWSER_ID,
        displayName: 'Rob',
        email: 'rvicks@gmail.com',
        contactSecret: SECRET,
    };
    const queued = await queueAmyAnamConversationFollowUp(queueInput, { env: ENV, fetchImpl });
    const duplicateQueue = await queueAmyAnamConversationFollowUp(queueInput, { env: ENV, fetchImpl });
    assert.equal(queued.status, 'email_queued');
    assert.equal(queued.queued, true);
    assert.equal(queued.sent, false);
    assert.equal(duplicateQueue.status, 'email_already_queued');
    assert.equal(agentMailRequests.length, 0);

    const session = {
        schemaVersion: 'amy_anam_session_v1', browserSessionId: BROWSER_ID,
        launchId: '99999999-8888-4777-8666-555555555555', externalSessionId: SESSION_ID,
        clientLabel: 'xagent-amy:test', resolvedPersonaId: '77777777-6666-4555-8444-333333333333',
        provider: 'anam', agentSlug: 'amy', variant: 'amy-cara4', state: 'completed',
        createdAt: '2026-07-18T15:59:55.000Z', boundAt: '2026-07-18T16:00:00.000Z',
        closeReceivedAt: '2026-07-18T16:05:00.000Z', closeReason: 'user_ended',
        completedAt: '2026-07-18T16:05:10.000Z',
    };
    const receipt = {
        schemaVersion: 'amy_anam_session_receipt_v1', receiptId: 'receipt-final', provider: 'anam',
        externalSessionId: SESSION_ID, variant: 'amy-cara4', status: 'completed',
        completedAt: '2026-07-18T16:05:10.000Z', closeReason: 'user_ended',
        transcript: { source: 'anam_api', messageCount: 2, contentSha256: 'a'.repeat(64), rawTranscriptPersisted: false },
        actions: { hermes: false, memory: false, email: false, sheets: false },
    };
    const dispatched = await dispatchAmyAnamPostSessionFollowUp({
        session, receipt,
        turns: [
            { role: 'user', content: 'We need an Azure ERP migration roadmap.' },
            { role: 'agent', content: 'I will organize the two workstreams.' },
        ],
    }, { env: ENV, fetchImpl });
    assert.equal(dispatched.status, 'email_sent');
    assert.equal(dispatched.sent, true);
    assert.equal(dispatched.deliveryCount, 3);
    assert.equal(dispatched.internalNotificationsSent, true);
    assert.equal(agentMailRequests.length, 3);
    assert.deepEqual(agentMailRequests.map(request => request.body.to), [
        ['rvicks@gmail.com'], ['aifusionlabs@gmail.com'], ['aifusionlabs@gmail.com'],
    ]);
    assert.equal(new Set(agentMailRequests.map(request => request.idempotencyKey)).size, 3);
    assert.ok(agentMailRequests.every(request => /^amy\.[a-f0-9]{32}\.(?:visitor|admin|intake)\.v1$/.test(request.idempotencyKey)));
    assert.match(agentMailRequests[0].body.html, /Here’s what we took away/i);
    assert.match(agentMailRequests[1].body.subject, /AMY SESSION/i);
    assert.match(agentMailRequests[1].body.html, /Final call duration/i);
    assert.match(agentMailRequests[1].body.html, />5m 0s</i);
    assert.doesNotMatch(agentMailRequests[1].body.html, /Elapsed at email request|Live when follow-up was requested/i);
    assert.match(agentMailRequests[2].body.subject, /INSIGHT INTAKE/i);
    assert.match(agentMailRequests[2].body.html, /Sales &amp; Operations/i);
    assert.match(agentMailRequests[2].body.html, /Customer value and urgency/i);
    assert.match(agentMailRequests[2].body.html, /Recommended pursuit plan/i);
    assert.match(agentMailRequests[2].body.html, /Recommended next-meeting objective/i);
    const storedReceipts = [...store.values()].join('\n');
    assert.doesNotMatch(storedReceipts, /rvicks@gmail\.com|Azure|ERP migration/i);
    assert.match(storedReceipts, /"rawEmailStored":false/);
    assert.match(storedReceipts, /"messageContentStored":false/);
});

test('Resend visitor adapter preserves Amy HTML and the Visual Brief attachment', async () => {
    let request;
    const result = await sendAmyEmailWithResend({
        to: 'RVicks@Gmail.com',
        subject: 'Security readiness | A follow-up from Amy',
        text: 'Here is the recap I promised.',
        html: '<div><h1>Here is the recap I promised.</h1></div>',
        attachments: [{
            filename: 'amy-visual-brief.html',
            contentType: 'text/html; charset=utf-8',
            content: '<html><body>Visual Brief</body></html>',
        }],
    }, {
        env: {
            ...ENV,
            RESEND_API_KEY: 're_amy_visitor_test_secret',
            AMY_RESEND_FROM_ADDRESS: 'Amy from X Agents <hello@aifusionlabs.app>',
        },
        fetchImpl: async (url, init) => {
            request = { url, init };
            return new Response(JSON.stringify({ id: 'resend_msg_1' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
        idempotencyKey: 'amy.receipt.visitor.v1',
    });
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(new Headers(request.init.headers).get('Authorization'), 'Bearer re_amy_visitor_test_secret');
    assert.equal(new Headers(request.init.headers).get('Idempotency-Key'), 'amy.receipt.visitor.v1');
    const body = JSON.parse(request.init.body);
    assert.equal(body.from, 'Amy from X Agents <hello@aifusionlabs.app>');
    assert.deepEqual(body.to, ['rvicks@gmail.com']);
    assert.match(body.html, /recap I promised/i);
    assert.equal(body.attachments[0].filename, 'amy-visual-brief.html');
    assert.equal(body.attachments[0].content_type, 'text/html; charset=utf-8');
    assert.match(Buffer.from(body.attachments[0].content, 'base64').toString('utf8'), /Visual Brief/);
    assert.deepEqual(result, {
        provider: 'resend',
        sent: true,
        messageId: 'resend_msg_1',
        threadId: null,
    });
});

test('Amy can isolate visitor delivery on Resend while internal records stay on AgentMail', async () => {
    const store = new Map();
    const requests = [];
    const env = {
        ...ENV,
        AMY_VISITOR_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_amy_visitor_test_secret',
    };
    const fetchImpl = async (url, init) => {
        if (String(url).startsWith('https://redis.agentmail.test/')) {
            const commands = JSON.parse(init.body);
            const results = commands.map(command => {
                const [operation, key, storedValue, condition] = command;
                if (operation === 'GET') return { result: store.get(key) ?? null };
                if (operation === 'DEL') return { result: store.delete(key) ? 1 : 0 };
                if (operation === 'SET' && condition === 'NX') {
                    if (store.has(key)) return { result: null };
                    store.set(key, storedValue);
                    return { result: 'OK' };
                }
                if (operation === 'SET' && condition === 'XX') {
                    if (!store.has(key)) return { result: null };
                    store.set(key, storedValue);
                    return { result: 'OK' };
                }
                throw new Error(`Unexpected Redis command: ${operation}`);
            });
            return new Response(JSON.stringify(results), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        const provider = String(url).startsWith('https://api.resend.com/') ? 'resend' : 'agentmail';
        const body = JSON.parse(init.body);
        requests.push({ provider, body });
        return new Response(JSON.stringify(provider === 'resend'
            ? { id: 'resend_visitor_1' }
            : { message_id: `agentmail_${requests.length}`, thread_id: `thread_${requests.length}` }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    await queueAmyAnamConversationFollowUp({
        externalSessionId: SESSION_ID,
        browserSessionId: BROWSER_ID,
        displayName: 'Rob',
        email: 'rvicks@gmail.com',
        contactSecret: SECRET,
    }, { env, fetchImpl });
    const result = await dispatchAmyAnamPostSessionFollowUp({
        session: {
            schemaVersion: 'amy_anam_session_v1', browserSessionId: BROWSER_ID,
            launchId: '99999999-8888-4777-8666-555555555555', externalSessionId: SESSION_ID,
            clientLabel: 'xagent-amy:test', resolvedPersonaId: '77777777-6666-4555-8444-333333333333',
            provider: 'anam', agentSlug: 'amy', variant: 'amy-cara4', state: 'completed',
            createdAt: '2026-07-18T15:59:55.000Z', boundAt: '2026-07-18T16:00:00.000Z',
            closeReceivedAt: '2026-07-18T16:05:00.000Z', closeReason: 'user_ended',
            completedAt: '2026-07-18T16:05:10.000Z',
        },
        receipt: {
            schemaVersion: 'amy_anam_session_receipt_v1', receiptId: 'receipt-final', provider: 'anam',
            externalSessionId: SESSION_ID, variant: 'amy-cara4', status: 'completed',
            completedAt: '2026-07-18T16:05:10.000Z', closeReason: 'user_ended',
            transcript: { source: 'anam_api', messageCount: 2, contentSha256: 'a'.repeat(64), rawTranscriptPersisted: false },
            actions: { hermes: false, memory: false, email: false, sheets: false },
        },
        turns: [
            { role: 'user', content: 'We need a security readiness plan.' },
            { role: 'agent', content: 'I will organize the evidence and next decision.' },
        ],
    }, { env, fetchImpl });
    assert.equal(result.status, 'email_sent');
    assert.equal(result.visitorProvider, 'resend');
    assert.deepEqual(requests.map(request => request.provider), ['resend', 'agentmail', 'agentmail']);
    assert.deepEqual(requests.map(request => request.body.to), [
        ['rvicks@gmail.com'], ['aifusionlabs@gmail.com'], ['aifusionlabs@gmail.com'],
    ]);
    assert.match(requests[0].body.html, /Here’s what we took away/i);
    assert.match(requests[1].body.subject, /AMY SESSION/i);
    assert.match(requests[2].body.subject, /INSIGHT INTAKE/i);
});

test('failed Amy email bundle retries with stable per-lane idempotency keys', async () => {
    const store = new Map();
    const attempts = [];
    const successfulByKey = new Map();
    let adminFailedOnce = false;
    const fetchImpl = async (url, init) => {
        if (String(url).startsWith('https://redis.agentmail.test/')) {
            const commands = JSON.parse(init.body);
            const results = commands.map(command => {
                const [operation, key, storedValue, condition] = command;
                if (operation === 'GET') return { result: store.get(key) ?? null };
                if (operation === 'DEL') return { result: store.delete(key) ? 1 : 0 };
                if (operation === 'SET' && condition === 'NX') {
                    if (store.has(key)) return { result: null };
                    store.set(key, storedValue);
                    return { result: 'OK' };
                }
                if (operation === 'SET' && condition === 'XX') {
                    if (!store.has(key)) return { result: null };
                    store.set(key, storedValue);
                    return { result: 'OK' };
                }
                throw new Error(`Unexpected Redis command: ${operation}`);
            });
            return new Response(JSON.stringify(results), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        const body = JSON.parse(init.body);
        const idempotencyKey = new Headers(init.headers).get('Idempotency-Key');
        attempts.push({ idempotencyKey, to: body.to[0] });
        if (successfulByKey.has(idempotencyKey)) {
            return new Response(JSON.stringify(successfulByKey.get(idempotencyKey)), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (idempotencyKey.endsWith('.admin.v1') && !adminFailedOnce) {
            adminFailedOnce = true;
            return new Response(JSON.stringify({ error: 'temporary' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        const response = {
            message_id: `msg_${idempotencyKey.split('.').at(-2)}`,
            thread_id: `thr_${idempotencyKey.split('.').at(-2)}`,
        };
        successfulByKey.set(idempotencyKey, response);
        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    const queueInput = {
        externalSessionId: SESSION_ID,
        browserSessionId: BROWSER_ID,
        displayName: 'Rob',
        email: 'rvicks@gmail.com',
        contactSecret: SECRET,
    };
    await queueAmyAnamConversationFollowUp(queueInput, { env: ENV, fetchImpl });
    const session = {
        schemaVersion: 'amy_anam_session_v1', browserSessionId: BROWSER_ID,
        launchId: '99999999-8888-4777-8666-555555555555', externalSessionId: SESSION_ID,
        clientLabel: 'xagent-amy:test', resolvedPersonaId: '77777777-6666-4555-8444-333333333333',
        provider: 'anam', agentSlug: 'amy', variant: 'amy-cara4', state: 'completed',
        createdAt: '2026-07-18T15:59:55.000Z', boundAt: '2026-07-18T16:00:00.000Z',
        closeReceivedAt: '2026-07-18T16:05:00.000Z', closeReason: 'user_ended',
        completedAt: '2026-07-18T16:05:10.000Z',
    };
    const receipt = {
        schemaVersion: 'amy_anam_session_receipt_v1', receiptId: 'receipt-final', provider: 'anam',
        externalSessionId: SESSION_ID, variant: 'amy-cara4', status: 'completed',
        completedAt: '2026-07-18T16:05:10.000Z', closeReason: 'user_ended',
        transcript: { source: 'anam_api', messageCount: 2, contentSha256: 'a'.repeat(64), rawTranscriptPersisted: false },
        actions: { hermes: false, memory: false, email: false, sheets: false },
    };
    const input = {
        session,
        receipt,
        turns: [
            { role: 'user', content: 'We need an Azure AD audit brief.' },
            { role: 'agent', content: 'I will frame the decision and evidence gaps.' },
        ],
    };

    await assert.rejects(
        dispatchAmyAnamPostSessionFollowUp(input, { env: ENV, fetchImpl }),
        /could not confirm email delivery/i,
    );
    const retried = await dispatchAmyAnamPostSessionFollowUp(input, { env: ENV, fetchImpl });
    assert.equal(retried.status, 'email_sent');
    assert.equal(retried.deliveryCount, 3);
    assert.equal(attempts.length, 6);
    for (const lane of ['visitor', 'admin', 'intake']) {
        const laneAttempts = attempts.filter(attempt => attempt.idempotencyKey.endsWith(`.${lane}.v1`));
        assert.equal(laneAttempts.length, 2);
        assert.equal(new Set(laneAttempts.map(attempt => attempt.idempotencyKey)).size, 1);
    }
});

test('visitor follow-up preserves the conditional Visual Brief attachment without promising a session export', () => {
    const message = buildAmyConversationFollowUp({
        displayName: 'Rob',
        turns: [
            { role: 'user', content: "We're planning a cloud migration. We also want to use AI to optimize staffing schedules." },
            { role: 'user', content: 'The COO is sponsoring it. We have shift calendars and payroll logs, no pilot is approved, and CJIS data should be excluded.' },
            { role: 'user', content: 'Show me the visual brief and include it in the follow-up.' },
        ],
    });
    assert.match(message.html, /Your conversation at a glance/i);
    assert.doesNotMatch(message.html, /Your final Visual Brief|complete session|is attached/i);
    assert.doesNotMatch(message.text, /FINAL VISUAL BRIEF|complete session|is attached/i);
    assert.equal(message.attachments?.length, 1);
    assert.equal(message.attachments?.[0]?.filename, 'amy-visual-brief.html');
    assert.equal(message.attachments?.[0]?.contentType, 'text/html; charset=utf-8');
    assert.match(message.attachments?.[0]?.content ?? '', /01 \/ Executive snapshot/i);
    assert.match(message.attachments?.[0]?.content ?? '', /06 \/ Next decision/i);
    assert.match(message.attachments?.[0]?.content ?? '', /Two tracks.*one planned.*exploratory/is);
    assert.doesNotMatch(message.attachments?.[0]?.content ?? '', /device refresh|funded device|call recordings|ticket logs|Insight Public Sector/i);
});

test('A+C visitor presentation leaves both internal messages and the existing attachment byte-identical', () => {
    const turns = [
        { role: 'user', content: 'We need a StateRAMP cloud modernization brief by year-end.' },
        { role: 'user', content: 'Show me the Visual Brief and email it after the session.' },
    ];
    const bundle = buildAmyEmailBundle({
        displayName: 'Sample Visitor', verifiedEmail: 'sample@example.com',
        externalSessionId: 'sample-session', sessionStartedAt: '2026-08-27T12:00:00Z',
        sessionEndedAt: '2026-08-27T12:05:00Z', generatedAt: '2026-08-27T12:06:00Z',
        turns, model: buildAmyWorkbenchModel(turns),
    });
    const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    // Captured from the verified production checkpoint 2e667a1 before this template change.
    assert.equal(digest(bundle.admin), '8b071356837b271742f61dafc16e33539ad39a50dedd2e49862a08869b8e4623');
    assert.equal(digest(bundle.intake), 'a81e5d33331366934c104bfab0e3bb6a67cc6086bf35cc0cc771a3350e2c4fa7');
    assert.equal(digest(bundle.visitor.attachments), '489f36180394514dab34a6b9fa3c7145a61205238db123b3f0204ca260e8e8bd');
});

test('normal and empty conversations do not promise or add an attachment', () => {
    for (const turns of [[], [{ role: 'user', content: 'We want to discuss cloud planning.' }]]) {
        const message = buildAmyConversationFollowUp({ displayName: 'Alex', turns });
        assert.equal(message.attachments, undefined);
        assert.match(message.html, /CONVERSATION SUMMARY · KEY TAKEAWAYS/);
        assert.doesNotMatch(message.html + message.text, /attached|complete.*brief|download|01 OF 06/i);
        assert.doesNotMatch(message.html + message.text, /60 days|Alex, your AI pilot|pilot.*approved/i);
    }
});

test('visitor recap is email-safe, accessible, and escapes every displayed dynamic field', () => {
    const hostile = '<img src=x onerror=alert(1)> & "test"';
    const message = renderAmyVisitorRecap({
        firstName: hostile, lane: hostile, objective: hostile,
        details: [{ label: hostile, value: hostile }], nextStep: hostile,
        openQuestions: [hostile], rejoinUrl: 'https://xagent.aifusionlabs.app/demo/amy?variant=cara4',
    });
    assert.doesNotMatch(message.html, /<img src=x|<script|<iframe/);
    assert.match(message.html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;test&quot;/);
    assert.match(message.html, /<html lang="en">/);
    assert.match(message.html, /alt="Insight"/);
    assert.match(message.html, /@media only screen and \(max-width:480px\)/);
    assert.match(message.html, /\[if mso\]/);
    assert.match(message.text, /Suggested next step:/);
    assert.match(message.text, /not a booking confirmation/);
    assert.equal((message.html.match(/<h1 /g) ?? []).length, 1);
});

test('visitor-only sparse and question-based wording stays readable without changing the model', () => {
    const empty = buildAmyConversationFollowUp({ displayName: 'Alex', turns: [] });
    assert.match(empty.text, /No detailed conversation context was available/);
    assert.doesNotMatch(empty.text, /Waiting for the conversation|Clarify outcome/);
    const question = 'Which environment is in scope?';
    const rendered = renderAmyVisitorRecap({
        firstName: 'Alex', lane: 'Discovery', objective: 'Explore the priority', details: [],
        nextStep: 'Clarify environment is in scope.', openQuestions: [question],
        rejoinUrl: 'https://xagent.aifusionlabs.app/demo/amy?variant=cara4',
    });
    assert.match(rendered.text, /Clarify the next decision: Which environment is in scope\?/);
    assert.equal(rendered.text.split(question).length - 1, 1);
});

test('Amy intake email includes the same Visual Brief and confirmed callback', () => {
    const turns = [
        { role: 'user', content: 'We need a StateRAMP cloud modernization brief by year-end.' },
        { role: 'user', content: 'Show me the Visual Brief and email it after the session.' },
    ];
    const bundle = buildAmyEmailBundle({
        displayName: 'David',
        verifiedEmail: 'david@example.com',
        callbackPhone: '(480) 555-0107',
        externalSessionId: SESSION_ID,
        sessionStartedAt: '2026-08-12T04:00:00.000Z',
        sessionEndedAt: '2026-08-12T04:05:00.000Z',
        turns,
        model: buildAmyWorkbenchModel(turns, '', '', 'visual'),
    });
    assert.match(bundle.intake.html, /Final Visual Brief/i);
    assert.match(bundle.intake.html, /\(480\) 555-0107/);
    assert.equal(bundle.intake.attachments?.[0]?.filename, 'amy-visual-brief.html');
});
