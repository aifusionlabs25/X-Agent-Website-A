import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchEvanAnamPostSessionFollowUp, queueEvanAnamConversationFollowUp } from '../lib/anam/evan-agentmail.ts';
import { buildAmyAnamReceipt, normalizeAmyTranscript } from '../lib/anam/session-spine.ts';
import { EVAN_PERSONA_ID } from '../lib/anam/persona-ids.ts';

const env = {
    VERCEL_ENV: 'preview', EVAN_CAPTURE_ENABLED: 'true', EVAN_CAPTURE_ENGINE: 'cloud', EVAN_CAPTURE_MODEL: 'offline-fixture-model',
    OPENAI_API_KEY: 'synthetic-openai-key-not-a-credential',
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true', AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 'synthetic-session-secret-'.repeat(3),
    AMY_ANAM_REDIS_REST_URL: 'https://redis.test', AMY_ANAM_REDIS_REST_TOKEN: 'synthetic-redis-token'.repeat(2),
    AGENTMAIL_API_KEY: 'synthetic-agentmail-key'.repeat(2), AGENTMAIL_API_BASE_URL: 'https://agentmail.test',
    EVAN_EMAIL_PROVIDER: 'agentmail', EVAN_AGENTMAIL_ADDRESS: 'capture-test@example.test',
    EVAN_ANAM_AGENTMAIL_ENABLED: 'true', EVAN_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
    EVAN_ANAM_TOOLS_ENABLED: 'true', EVAN_ANAM_TOOLS_KILL_SWITCH: 'false',
    EVAN_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true', EVAN_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
    EVAN_MULLINS_ADMIN_EMAIL: 'admin@example.test', EVAN_MULLINS_SALES_EMAIL: 'sales@example.test',
    EVAN_GUEST_DEMO_LEAD_ENABLED: 'false',
};
const user = content => ({ role: 'user', content });
const turns = [
    user('My name is Older Name. My phone number is 480-555-0101. I have a piano.'),
    { role: 'agent', content: 'What else should I note?' },
    user('Correction, my name is Avery Vale. My phone number is 480-555-0198. Do not move the piano. I have two walnut credenzas.'),
    user('My email is spoken@example.test.'),
    user('Please call in the morning.'),
    user('I am moving from Mesa to Gilbert. I need packing help.'),
];
const fact = (category, value, turn, quote, overrides = {}) => ({
    category, value, status: 'asserted', evidence: [{ turn, quote }], location: 'unspecified', scope: '', quantity: '', route: null, ...overrides,
});
const modelEnvelope = facts => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ facts }) } }] });
const json = value => Response.json(value);

function finalizedInput(sourceTurns = turns) {
    const normalized = normalizeAmyTranscript(sourceTurns);
    const externalSessionId = '11111111-1111-4111-8111-111111111111';
    return {
        session: {
            schemaVersion: 'amy_anam_session_v1', externalSessionId,
            browserSessionId: '22222222-2222-4222-8222-222222222222',
            launchId: '33333333-3333-4333-8333-333333333333', clientLabel: 'offline-test',
            provider: 'anam', agentSlug: 'evan', variant: 'evan-mullins', resolvedPersonaId: EVAN_PERSONA_ID,
            state: 'completed', createdAt: '2026-10-21T10:00:00Z', boundAt: '2026-10-21T10:00:00Z',
            closeReceivedAt: '2026-10-21T10:05:00Z', completedAt: '2026-10-21T10:05:01Z',
        },
        receipt: buildAmyAnamReceipt({ externalSessionId, variant: 'evan-mullins', source: 'anam_api', turns: normalized,
            closeReason: 'user_requested_end', now: Date.parse('2026-10-21T10:05:01Z') }),
        turns: normalized,
    };
}

function correctedFacts(maskedTurns) {
    const source = index => maskedTurns[index].content;
    const phone = index => source(index).match(/__CONTACT_PHONE_\d+__/)?.[0];
    assert.ok(phone(0)); assert.ok(phone(2));
    return [
        fact('name', 'Older Name', 0, source(0)), fact('name', 'Avery Vale', 2, source(2)),
        fact('phone', phone(0), 0, source(0)), fact('phone', phone(2), 2, source(2)),
        fact('inventory', 'piano', 2, source(2), { status: 'removed' }),
        fact('inventory', 'walnut credenzas', 2, source(2), { quantity: 'two' }),
        fact('callbackWindow', 'morning', 4, source(4)),
        fact('email', source(3).match(/__CONTACT_EMAIL_\d+__/)?.[0], 3, source(3)),
    ];
}

// Every dependency call is routed to this in-memory mock. The global tripwire
// also fails any accidental code path that forgets to forward fetchImpl.
function fixture(t, sourceTurns = turns) {
    t.mock.method(globalThis, 'fetch', () => { assert.fail('External fetch is forbidden in this offline dispatch test'); });
    const input = finalizedInput(sourceTurns), redis = new Map(), sent = [], calls = [], modelRequests = [];
    const state = { model: maskedTurns => json(modelEnvelope(correctedFacts(maskedTurns))) };
    const fetchImpl = async (url, init = {}) => {
        const target = String(url); calls.push(target);
        if (target === 'https://redis.test/pipeline') {
            const [[operation, key, value, mode]] = JSON.parse(String(init.body));
            let result = null;
            if (operation === 'SET') {
                if ((mode === 'NX' && !redis.has(key)) || (mode === 'XX' && redis.has(key))) {
                    redis.set(key, value); result = 'OK';
                }
            } else if (operation === 'GET') result = redis.get(key) ?? null;
            else if (operation === 'DEL') result = redis.delete(key) ? 1 : 0;
            else assert.fail(`Unmocked Redis operation: ${operation}`);
            return json([{ result }]);
        }
        if (target === 'https://api.openai.com/v1/chat/completions') {
            const body = JSON.parse(String(init.body)); modelRequests.push(body);
            return state.model(JSON.parse(body.messages[1].content).turns, body);
        }
        if (target === 'https://agentmail.test/v0/inboxes/capture-test%40example.test/messages/send') {
            sent.push(JSON.parse(String(init.body)));
            return json({ message_id: `synthetic-message-${sent.length}`, thread_id: `synthetic-thread-${sent.length}` });
        }
        assert.fail(`Unmocked dependency URL: ${target}`);
    };
    const options = { env, fetchImpl };
    return { input, state, redis, sent, calls, modelRequests, options,
        queue: () => queueEvanAnamConversationFollowUp({ externalSessionId: input.session.externalSessionId,
            browserSessionId: input.session.browserSessionId, displayName: 'Website Name', email: 'checkin@example.test',
            contactSecret: env.AMY_ANAM_SESSION_SECRET }, options),
        dispatch: () => dispatchEvanAnamPostSessionFollowUp(input, options),
    };
}

test('capture dispatch requires the exact finalized Evan source before any I/O', async t => {
    const changes = [
        input => { input.session.resolvedPersonaId = 'other-persona'; },
        input => { input.session.agentSlug = 'amy'; },
        input => { input.session.variant = 'amy-cara4'; },
        input => { input.receipt.variant = 'amy-cara4'; },
        input => { input.receipt.externalSessionId = 'another-session'; },
        input => { input.receipt.status = 'transcript_unavailable'; },
        input => { input.receipt.transcript.source = 'unavailable'; },
        input => { input.receipt.transcript.contentSha256 = '0'.repeat(64); },
        input => { input.turns[2].content = 'Injected corrected inventory'; },
        input => { input.turns.reverse(); },
    ];
    for (const change of changes) {
        const f = fixture(t); change(f.input);
        await assert.rejects(f.dispatch(), /Evan finalized capture source did not match/);
        assert.deepEqual(f.calls, []);
    }
});

test('one finalized capture feeds all three emails with current inventory and corrected contact notes', async t => {
    const f = fixture(t); await f.queue();
    const result = await f.dispatch();
    assert.equal(result.captureStatus, 'ready');
    assert.equal(result.deliveryCount, 3);
    assert.equal(f.modelRequests.length, 1, 'Admin, Sales and visitor reuse one capture, not three interpretations');
    assert.deepEqual(f.sent.map(message => message.to), [['admin@example.test'], ['sales@example.test'], ['checkin@example.test']]);
    for (const message of f.sent) {
        assert.match(message.text, /two walnut credenzas/);
        assert.match(message.text, /morning/);
        assert.doesNotMatch(message.text, /Older Name|Website Name|\bpiano\b|480-555-0101/);
        assert.doesNotMatch(message.text, /\bMesa\b|\bGilbert\b|Packing support/,
            'No legacy keywords may add facts omitted by the current capture');
    }
    for (const message of f.sent.slice(0, 2)) {
        assert.match(message.text, /Avery Vale/);
        assert.match(message.text, /Phone shared \(verify before follow-up\): \(480\) 555-0198/);
        assert.doesNotMatch(message.text, /Authorized callback/);
    }
    assert.match(f.sent[2].text, /Hi Avery,/);
    assert.doesNotMatch(f.sent[2].text, /555-0198|spoken@example\.test/);
    assert.equal(f.sent[0].attachments.length, 1);
    const attachment = Buffer.from(f.sent[0].attachments[0].content, 'base64').toString('utf8');
    assert.match(attachment, /SANITIZED SESSION TRANSCRIPT/);
    assert.match(attachment, /\[private contact\]/);
    assert.doesNotMatch(attachment, /480-555-0101|480-555-0198|spoken@example\.test/);
    assert.equal('attachments' in f.sent[1], false);
    assert.equal('attachments' in f.sent[2], false);
    const requestText = JSON.stringify(f.modelRequests[0]);
    assert.doesNotMatch(requestText, /480-555-0101|480-555-0198|spoken@example\.test|checkin@example\.test/);
});

test('provider failure, malformed, partial and ungrounded output send honest manual-review messages, never legacy facts', async t => {
    const modes = [
        () => new Response('synthetic provider failure', { status: 503 }),
        () => json({ choices: [{ finish_reason: 'stop', message: { content: '{"facts":[' } }] }),
        masked => json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify({ facts: correctedFacts(masked) }) } }] }),
        masked => json(modelEnvelope([...correctedFacts(masked), fact('inventory', 'imaginary harpsichord', 2, masked[2].content)])),
    ];
    for (const model of modes) {
        const f = fixture(t); f.state.model = model; await f.queue();
        const result = await f.dispatch();
        assert.equal(result.captureStatus, 'unavailable');
        assert.equal(f.modelRequests.length, 1);
        assert.equal(f.sent.length, 3);
        assert.deepEqual(f.sent.map(message => message.to[0]), ['admin@example.test', 'sales@example.test', 'checkin@example.test']);
        for (const message of f.sent) {
            assert.match(message.text, /structured move summary is unavailable/i);
            assert.match(message.text, /review the transcript and confirm/i);
            assert.doesNotMatch(message.text, /\bpiano\b|walnut credenzas|\bMesa\b|\bGilbert\b|Avery Vale|Older Name|555-0198/);
        }
    }
});

test('capture output cannot redirect the separately authorized check-in recipient', async t => {
    const f = fixture(t); await f.queue(); await f.dispatch();
    // The model legitimately captured the spoken address, but this is not a
    // recipient change request and is never authority to alter delivery routing.
    assert.equal(f.sent[2].to[0], 'checkin@example.test');
    assert.equal(f.sent.some(message => message.to.includes('spoken@example.test')), false);
});

test('local capture supplies the three email bodies with no model call and unchanged routing', async t => {
    const source = [user('My contact info is Avery Stone, 602-555-0138, email is avery@example.test.'),
        user('I have two walnut credenzas.'),
        user('Correction, my name is Jordan Blake.')];
    const f = fixture(t, source);
    f.options.env = { ...env, EVAN_CAPTURE_ENGINE: 'local', EVAN_CAPTURE_MODEL: '', OPENAI_API_KEY: '' };
    f.state.model = () => assert.fail('Local final capture must not call a model');
    await f.queue();
    const result = await f.dispatch();
    assert.equal(result.captureStatus, 'ready');
    assert.equal(result.deliveryCount, 3);
    assert.equal(f.modelRequests.length, 0);
    assert.deepEqual(f.sent.map(message => message.to[0]), ['admin@example.test', 'sales@example.test', 'checkin@example.test']);
    for (const message of f.sent) {
        assert.match(message.text, /two walnut credenzas/);
        assert.doesNotMatch(message.text, /Avery Stone|Website Name/);
    }
    assert.match(f.sent[0].text, /Jordan Blake/);
    assert.match(f.sent[1].text, /Jordan Blake/);
    assert.match(f.sent[2].text, /Hi Jordan,/);
});

test('guest delivery uses the deterministic visitor address even if a grounded model email is semantically misclassified', async t => {
    const f = fixture(t, [user('My email is guest@example.test.'), user("The landlord's email is landlord@example.test. I have a sideboard.")]);
    f.state.model = masked => json(modelEnvelope([
        fact('email', masked[1].content.match(/__CONTACT_EMAIL_\d+__/)?.[0], 1, masked[1].content),
        fact('inventory', 'sideboard', 1, masked[1].content),
    ]));
    const result = await f.dispatch();
    assert.equal(result.captureStatus, 'ready');
    assert.equal(f.modelRequests.length, 1);
    assert.deepEqual(f.sent.map(message => message.to[0]), ['admin@example.test', 'sales@example.test', 'guest@example.test']);
    assert.equal(f.sent.some(message => message.to.includes('landlord@example.test')), false);
    // This is a routing-authority test, not a claim that exact quote validation
    // can prove the model understood third-party versus visitor ownership.
});

test('without a deterministic guest email or callback authorization, no model can create a send', async t => {
    const f = fixture(t, [user('I have a sideboard. For example, a neighbor might use example@example.test.')]);
    f.state.model = () => { assert.fail('No recipient means no capture-dependent dispatch'); };
    const result = await f.dispatch();
    assert.equal(result.sent, false);
    assert.equal(f.modelRequests.length, 0);
    assert.equal(f.sent.length, 0);
});

test('a refusal after turn 200 suppresses check-in and guest recaps before extraction or delivery', async t => {
    const longTurns = [user('My email is guest@example.test.'),
        ...Array.from({ length: 204 }, (_, index) => ({ role: index % 2 ? 'agent' : 'user', content: `Moving detail ${index}.` })),
        user("Please don't email me a recap.")];
    for (const checkIn of [true, false]) {
        const f = fixture(t, longTurns);
        if (checkIn) await f.queue();
        f.state.model = () => { assert.fail('A late email refusal must not reach capture dispatch'); };
        const result = await f.dispatch();
        assert.equal(result.sent, false);
        if (checkIn) assert.equal(result.status, 'email_declined');
        assert.equal(f.modelRequests.length, 0);
        assert.equal(f.sent.length, 0);
    }
});
