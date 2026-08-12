import assert from 'node:assert/strict';
import test from 'node:test';
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
            { role: 'user', content: 'Before we close, can you send a Pulse Session email?' },
        ],
    });
    assert.match(message.text, /ERP|Azure/i);
    assert.doesNotMatch(message.text, /attacker@example\.com/i);
    assert.doesNotMatch(message.html, /<script>/i);
    assert.match(message.html, /AI-powered conversational agent/i);
    assert.match(message.html, /Insight · Follow-up from Amy/i);
    assert.match(message.html, />Hi Rob,</i);
    assert.doesNotMatch(message.html, />Hi Rob Vicks,</i);
    assert.match(message.text, /speaking with me/i);
    assert.match(message.text, /appropriate specialists will review it and follow up/i);
    assert.match(message.html, /Reconnect with Amy/i);
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
        agentMailRequests.push(JSON.parse(init.body));
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
    assert.deepEqual(agentMailRequests.map(request => request.to), [
        ['rvicks@gmail.com'], ['aifusionlabs@gmail.com'], ['aifusionlabs@gmail.com'],
    ]);
    assert.match(agentMailRequests[0].html, /Here&#039;s the recap I promised/i);
    assert.match(agentMailRequests[1].subject, /AMY SESSION/i);
    assert.match(agentMailRequests[1].html, /Final call duration/i);
    assert.match(agentMailRequests[1].html, />5m 0s</i);
    assert.doesNotMatch(agentMailRequests[1].html, /Elapsed at email request|Live when follow-up was requested/i);
    assert.match(agentMailRequests[2].subject, /INSIGHT INTAKE/i);
    assert.match(agentMailRequests[2].html, /Sales &amp; Operations/i);
    assert.match(agentMailRequests[2].html, /Customer value and urgency/i);
    assert.match(agentMailRequests[2].html, /Recommended pursuit plan/i);
    assert.match(agentMailRequests[2].html, /Recommended next-meeting objective/i);
    const storedReceipts = [...store.values()].join('\n');
    assert.doesNotMatch(storedReceipts, /rvicks@gmail\.com|Azure|ERP migration/i);
    assert.match(storedReceipts, /"rawEmailStored":false/);
    assert.match(storedReceipts, /"messageContentStored":false/);
});

test('visitor follow-up embeds and attaches the final conversation-grounded Visual Brief', () => {
    const message = buildAmyConversationFollowUp({
        displayName: 'Rob',
        turns: [
            { role: 'user', content: "We're planning a cloud migration. We also want to use AI to optimize staffing schedules." },
            { role: 'user', content: 'The COO is sponsoring it. We have shift calendars and payroll logs, no pilot is approved, and CJIS data should be excluded.' },
            { role: 'user', content: 'Show me the visual brief and include it in the follow-up.' },
        ],
    });
    assert.match(message.html, /Your final Visual Brief/i);
    assert.match(message.html, /Two tracks.*one planned.*exploratory/is);
    assert.match(message.text, /FINAL VISUAL BRIEF/i);
    assert.equal(message.attachments?.length, 1);
    assert.equal(message.attachments?.[0]?.filename, 'amy-visual-brief.html');
    assert.equal(message.attachments?.[0]?.contentType, 'text/html; charset=utf-8');
    assert.match(message.attachments?.[0]?.content ?? '', /01 \/ Executive snapshot/i);
    assert.match(message.attachments?.[0]?.content ?? '', /06 \/ Next decision/i);
    assert.doesNotMatch(message.attachments?.[0]?.content ?? '', /device refresh|funded device|call recordings|ticket logs|Insight Public Sector/i);
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
