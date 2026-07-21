import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEvanEmailBundle, buildEvanMovingIntake } from '../lib/anam/evan-agentmail-templates.ts';
import {
    queueEvanAnamConversationFollowUp,
    readEvanAnamAgentMailConfig,
    sendEvanAnamConversationFollowUp,
} from '../lib/anam/evan-agentmail.ts';
import { sendAmyEmailWithAgentMail } from '../lib/email/amy-email-provider.ts';

const env = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 's'.repeat(48),
    AMY_ANAM_REDIS_REST_URL: 'https://redis.test',
    AMY_ANAM_REDIS_REST_TOKEN: 'r'.repeat(32),
    AGENTMAIL_API_KEY: 'a'.repeat(32),
    EVAN_EMAIL_PROVIDER: 'agentmail',
    EVAN_AGENTMAIL_ADDRESS: 'hermes-hal@agentmail.to',
    EVAN_ANAM_AGENTMAIL_ENABLED: 'true',
    EVAN_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
    EVAN_ANAM_TOOLS_ENABLED: 'true',
    EVAN_ANAM_TOOLS_KILL_SWITCH: 'false',
    EVAN_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true',
    EVAN_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
    EVAN_MULLINS_ADMIN_EMAIL: 'aifusionlabs@gmail.com',
    EVAN_MULLINS_SALES_EMAIL: 'aifusionlabs@gmail.com',
};

const latestTestTurns = [
    { role: 'agent', content: "Hi, I'm Evan with Mullins Moving. What kind of move are you planning?" },
    { role: 'user', content: "I'm handling a complicated move for my dad. We need to move him out of his house in Mesa, plus some items from a storage unit in Chandler, into a home in Surprise. I've got less than 10 days and my dad is elderly." },
    { role: 'agent', content: 'What date and services do you need?' },
    { role: 'user', content: "I need everything done by the 28th. We'll need full packing, there's antique furniture, artwork, and a grandfather clock. Also, my dad's on a walker, so we can't have a long chaotic day. Can you guarantee a finish time?" },
    { role: 'agent', content: 'What access considerations should I note?' },
    { role: 'user', content: "The Mesa house has a narrow driveway and I think a staircase. The storage unit in Chandler? I'm not sure about access. I'd have to check. Also, I don't have a full inventory yet. Can you still give me a ballpark price?" },
    { role: 'agent', content: 'Would you like a recap?' },
    { role: 'user', content: "Email me at wrong@example.com. I'm worried about the antiques. Are they fully insured?" },
    { role: 'user', content: 'How soon can I get an actual quote? I need to compare quickly. Another mover gave me a rough number.' },
    { role: 'user', content: 'local dashboard is intentionally read-only nope' },
    { role: 'agent', content: 'What phone number should the team use?' },
    { role: 'user', content: 'You can reach me at 480-555-0186. I will be expecting their call.' },
];

const attachedSessionTurns = [
    { role: 'agent', content: 'Tell me about the move you are planning.' },
    { role: 'user', content: "We're moving from our house in Gilbert to our new home in Queen Creek, with a storage unit in Mesa." },
    { role: 'user', content: 'Mesa needs to be the second stop before Queen Creek.' },
    { role: 'user', content: "It is about three weeks from now, aiming for the 15th. We'll need full packing for the kitchen." },
    { role: 'user', content: 'The large items include a sectional, treadmill, tool chest, large mirrors, artwork, and a grandfather clock.' },
    { role: 'user', content: "There are stairs at the Gilbert house and a narrow driveway at the Queen Creek destination. I don't have the exact street addresses yet." },
    { role: 'agent', content: 'What number should the team use if you want a call?' },
    { role: 'user', content: 'Call me at 80-555-0186.' },
];

const ordinaryMoveTurns = [
    { role: 'agent', content: 'What kind of move are you planning?' },
    { role: 'user', content: 'I am moving from a two-bedroom apartment in Tempe to Chandler on the 10th of August.' },
    { role: 'user', content: 'I need packing help for a sectional. The Tempe apartment has an elevator.' },
];

test('Evan AgentMail config uses the verified Hermes Hal inbox and separate admin/sales lanes', () => {
    const config = readEvanAnamAgentMailConfig(env);
    assert.equal(config.effectiveGateOpen, true);
    assert.equal(config.inboxAddress, 'hermes-hal@agentmail.to');
    assert.equal(config.adminEmail, 'aifusionlabs@gmail.com');
    assert.equal(config.salesEmail, 'aifusionlabs@gmail.com');
});

test('Evan intake turns the latest test into concise, useful, non-duplicated categories', () => {
    const intake = buildEvanMovingIntake(latestTestTurns);
    assert.deepEqual(intake.moveType, ['Senior move', 'Residential move', 'Multi-stop move']);
    assert.deepEqual(intake.originDestination, ['Mesa \u2192 Chandler \u2192 Surprise']);
    assert.deepEqual(intake.timing, ['Target day: 28th (month not confirmed)']);
    assert.match(intake.access.join(' '), /narrow driveway/i);
    assert.match(intake.customerCare.join(' '), /Mobility considerations|Senior comfort/i);
    assert.match(intake.coverageQuestions.join(' '), /coverage/i);
    assert.match(intake.quoteRequests.join(' '), /quote/i);
    assert.equal(intake.moveType.some(item => /dashboard/i.test(item)), false);
});

test('attached-session intake normalizes the corrected route and keeps only genuine blockers', () => {
    const intake = buildEvanMovingIntake(attachedSessionTurns);
    assert.deepEqual(intake.moveType, ['Residential move', 'Multi-stop move']);
    assert.deepEqual(intake.originDestination, ['Gilbert \u2192 Mesa \u2192 Queen Creek']);
    assert.deepEqual(intake.timing, ['About three weeks; target day: 15th (month not confirmed)']);
    assert.deepEqual(intake.services, ['Full kitchen packing']);
    assert.deepEqual(intake.inventory, [
        'Sectional',
        'Treadmill',
        'Tool chest',
        'Large mirrors',
        'Artwork',
        'Grandfather clock',
    ]);
    assert.deepEqual(intake.access, ['Stairs at Gilbert origin', 'Narrow driveway at Queen Creek destination']);
    assert.deepEqual(intake.customerCare, []);
    assert.deepEqual(intake.quoteRequests, []);
    assert.deepEqual(intake.coverageQuestions, []);
    assert.deepEqual(intake.walkthrough, []);
    assert.deepEqual(intake.missing, [
        'month / year for the requested target day',
        'home size / room count',
        'storage-unit access details',
        'exact street addresses',
        'valid callback number if phone follow-up is preferred',
    ]);

    const bundle = buildEvanEmailBundle({
        displayName: 'Jordan',
        verifiedEmail: 'jordan@example.com',
        externalSessionId: 'attached-session',
        sessionStartedAt: '2026-07-20T10:00:00Z',
        sessionEndedAt: '2026-07-20T10:08:00Z',
        turns: attachedSessionTurns,
    });
    assert.match(bundle.sales.text, /Route: Gilbert \u2192 Mesa \u2192 Queen Creek/);
    assert.match(bundle.sales.text, /Full kitchen packing/);
    assert.match(bundle.sales.text, /Specialty \/ high-care items\n- Sectional\n- Treadmill\n- Tool chest\n- Large mirrors\n- Artwork\n- Grandfather clock/);
    assert.match(bundle.sales.text, /Critical details to confirm before quoting/);
    assert.doesNotMatch(bundle.sales.text, /Senior \/ mobility care|Customer-care priorities|Valuation \/ coverage questions|Walkthrough preference|Time-sensitive request/);
    assert.doesNotMatch(bundle.sales.text, /\b(?:I|we) (?:will|can|promise|guarantee|send|provide)\b/i);
    assert.doesNotMatch(bundle.sales.html, /Not captured - confirm with customer/);
});

test('ordinary non-senior move does not invent care, urgency, coverage, or walkthrough sections', () => {
    const bundle = buildEvanEmailBundle({
        displayName: 'Taylor',
        verifiedEmail: 'taylor@example.com',
        externalSessionId: 'ordinary-session',
        sessionStartedAt: '2026-08-01T16:00:00Z',
        sessionEndedAt: '2026-08-01T16:04:00Z',
        turns: ordinaryMoveTurns,
    });
    assert.deepEqual(bundle.intake.moveType, ['Residential move']);
    assert.deepEqual(bundle.intake.originDestination, ['Tempe \u2192 Chandler']);
    assert.deepEqual(bundle.intake.timing, ['Target day: 10th of August']);
    assert.deepEqual(bundle.intake.services, ['Packing support']);
    assert.deepEqual(bundle.intake.inventory, ['Sectional']);
    assert.deepEqual(bundle.intake.customerCare, []);
    assert.deepEqual(bundle.intake.coverageQuestions, []);
    assert.deepEqual(bundle.intake.walkthrough, []);
    assert.doesNotMatch(bundle.sales.text, /Senior \/ mobility care|Customer-care priorities|Valuation \/ coverage questions|Walkthrough preference|Time-sensitive request/);
});

test('the three Evan emails are polished for their audience and Admin receives a sanitized transcript attachment', () => {
    const bundle = buildEvanEmailBundle({
        displayName: '<Rob> Vicks',
        verifiedEmail: 'rvicks@gmail.com',
        externalSessionId: '5a19fd25-74db-42d0-b5d2-dd8223ae23e1',
        sessionStartedAt: '2026-07-20T23:30:18.712Z',
        sessionEndedAt: '2026-07-20T23:34:24.526Z',
        turns: latestTestTurns,
    });

    assert.match(bundle.visitor.html, /Mullins%20Moving%20logo\.png/);
    assert.match(bundle.visitor.html, /Move details we heard/);
    assert.match(bundle.visitor.html, /https:\/\/calendly\.com\/aifusionlabs/);
    assert.match(bundle.visitor.text, /Mullins staff - not Evan - will determine availability, prepare any quote/);
    assert.doesNotMatch(bundle.visitor.html, /<Rob>/);
    assert.doesNotMatch(bundle.visitor.text, /wrong@example\.com|480-555-0186|dashboard/i);

    assert.match(bundle.sales.subject, /^\[ACTION\]/);
    assert.match(bundle.sales.text, /Authorized callback: 480-555-0186/);
    assert.match(bundle.sales.text, /Customer-care priorities/);
    assert.match(bundle.sales.text, /Valuation \/ coverage questions/);
    assert.match(bundle.sales.text, /Recommended rep action plan/);
    assert.match(bundle.sales.text, /Mullins staff determines feasibility and prepares any quote/);
    assert.doesNotMatch(bundle.sales.text, /Conversation detail|dashboard|Mr\. Gates/i);

    assert.match(bundle.admin.subject, /4m 06s - transcript attached/);
    assert.match(bundle.admin.text, /Visitor questions: 5/);
    assert.doesNotMatch(bundle.admin.text, /\d+\. EVAN:|\d+\. VISITOR:|dashboard/i);
    assert.equal(bundle.admin.attachments.length, 1);
    assert.match(bundle.admin.attachments[0].filename, /^evan-mullins-transcript-5a19fd25/);
    assert.equal(bundle.admin.attachments[0].contentType, 'text/plain; charset=utf-8');
    assert.match(bundle.admin.attachments[0].content, /SANITIZED SESSION TRANSCRIPT/);
    assert.match(bundle.admin.attachments[0].content, /\[private contact\]/);
    assert.doesNotMatch(bundle.admin.attachments[0].content, /wrong@example\.com|480-555-0186/);
});

test('queue and send reserve one intent/attempt, send three emails, and Base64-encode only the Admin attachment', async () => {
    const redis = new Map();
    const sent = [];
    const fetchImpl = async (url, init = {}) => {
        const target = String(url);
        if (target === 'https://redis.test/pipeline') {
            const [command] = JSON.parse(String(init.body));
            const [operation, key, value, mode] = command;
            let result = null;
            if (operation === 'SET') {
                if (mode === 'NX' && redis.has(key)) result = null;
                else if (mode === 'XX' && !redis.has(key)) result = null;
                else { redis.set(key, value); result = 'OK'; }
            } else if (operation === 'GET') result = redis.get(key) ?? null;
            else if (operation === 'DEL') { result = redis.delete(key) ? 1 : 0; }
            return new Response(JSON.stringify([{ result }]), { status: 200 });
        }
        if (target.includes('/v0/inboxes/hermes-hal%40agentmail.to/messages/send')) {
            const body = JSON.parse(String(init.body));
            sent.push(body);
            return new Response(JSON.stringify({ message_id: `message-${sent.length}`, thread_id: `thread-${sent.length}` }), { status: 200 });
        }
        throw new Error(`Unexpected request: ${target}`);
    };
    const options = { env, fetchImpl };
    const input = {
        externalSessionId: '3d26775e-8732-41ed-8658-0ecb48a1eafe',
        browserSessionId: '2fd07342-77b9-435a-9954-fe66afad0fe7',
        displayName: 'Pat',
        email: 'pat@example.com',
        contactSecret: env.AMY_ANAM_SESSION_SECRET,
    };
    assert.equal((await queueEvanAnamConversationFollowUp(input, options)).duplicate, false);
    assert.equal((await queueEvanAnamConversationFollowUp(input, options)).duplicate, true);
    const sendInput = {
        externalSessionId: input.externalSessionId,
        displayName: input.displayName,
        email: input.email,
        sessionStartedAt: '2026-07-19T10:00:00Z',
        sessionEndedAt: '2026-07-19T10:10:00Z',
        turns: latestTestTurns,
    };
    const first = await sendEvanAnamConversationFollowUp(sendInput, options);
    const duplicate = await sendEvanAnamConversationFollowUp(sendInput, options);
    assert.equal(first.deliveryCount, 3);
    assert.equal(duplicate.duplicate, true);
    assert.equal(sent.length, 3);
    assert.deepEqual(sent.map(message => message.to[0]), [
        'pat@example.com', 'aifusionlabs@gmail.com', 'aifusionlabs@gmail.com',
    ]);
    assert.equal('attachments' in sent[0], false);
    assert.equal(sent[1].attachments.length, 1);
    assert.equal('attachments' in sent[2], false);
    const decoded = Buffer.from(sent[1].attachments[0].content, 'base64').toString('utf8');
    assert.match(decoded, /SANITIZED SESSION TRANSCRIPT/);
    assert.match(decoded, /\[private contact\]/);
    assert.equal(sent[1].attachments[0].content_type, 'text/plain; charset=utf-8');
});

test('AgentMail attachment validation fails closed before contacting the provider', async () => {
    let called = false;
    await assert.rejects(() => sendAmyEmailWithAgentMail({
        to: 'pat@example.com', subject: 'Test', text: 'Body', html: '<p>Body</p>',
        attachments: [{ filename: '../unsafe.txt', contentType: 'text/plain', content: 'unsafe' }],
    }, {
        env: { AGENTMAIL_API_KEY: 'a'.repeat(32), AMY_AGENTMAIL_ADDRESS: 'hermes-hal@agentmail.to' },
        fetchImpl: async () => { called = true; return new Response(); },
    }), /filename was invalid/);
    assert.equal(called, false);
});

test('Evan browser integration requires scoped check-in consent, bind-time intent, and farewell-first close', async () => {
    const [demo, player, gate, route, bind, contactToken, emailTool, endTool] = await Promise.all([
        readFile(new URL('../app/demo/[slug]/page.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../components/evan/EvanContactGate.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/evan/access/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/session/bind/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../lib/anam/contact-token.ts', import.meta.url), 'utf8'),
        readFile(new URL('../config/anam/evan-agentmail-client-tool.json', import.meta.url), 'utf8'),
        readFile(new URL('../config/anam/evan-end-session-client-tool.json', import.meta.url), 'utf8'),
    ]);
    assert.match(demo, /EvanContactGate/);
    assert.match(player, /send_mullins_follow_up_email/);
    assert.match(player, /registerToolCallHandler\(\s*'end_mullins_session'/s);
    assert.match(player, /requestedCloseReason = 'user_requested_end'/);
    assert.match(player, /evanCloseCoordinator\?\.arm\(\)/);
    assert.match(player, /completeFarewell\(\)/);
    assert.doesNotMatch(player, /Closing immediately after confirmed farewell/);
    assert.match(gate, /type="checkbox"/);
    assert.match(gate, /checked=\{followUpConsent\}/);
    assert.match(gate, /Email me one conversation recap[\s\S]*Mullins Admin and Sales/);
    assert.match(gate, /JSON\.stringify\(\{ displayName, email, followUpConsent \}\)/);
    assert.match(route, /body\.followUpConsent !== true/);
    assert.match(route, /purpose: 'evan_follow_up'/);
    assert.match(route, /rawEmailReturned: false/);
    assert.match(bind, /queueEvanAnamConversationFollowUp/);
    assert.match(bind, /contact\.purpose !== 'evan_follow_up'/);
    assert.match(bind, /outbound: false/);
    assert.match(contactToken, /purpose\?: 'evan_follow_up'/);
    assert.match(emailTool, /userConfirmed/);
    assert.match(emailTool, /does not create, attach, deliver, or promise a quote/);
    assert.match(endTool, /"awaitResult": true/);
    assert.match(endTool, /farewell_required/);
});
