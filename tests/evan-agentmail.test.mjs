import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEvanEmailBundle, buildEvanMovingIntake } from '../lib/anam/evan-agentmail-templates.ts';
import {
    queueEvanAnamConversationFollowUp,
    readEvanAnamAgentMailConfig,
    sendEvanAnamConversationFollowUp,
} from '../lib/anam/evan-agentmail.ts';

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

test('Evan AgentMail config uses the verified Hermes Hal inbox and separate admin/sales lanes', () => {
    const config = readEvanAnamAgentMailConfig(env);
    assert.equal(config.effectiveGateOpen, true);
    assert.equal(config.inboxAddress, 'hermes-hal@agentmail.to');
    assert.equal(config.adminEmail, 'aifusionlabs@gmail.com');
    assert.equal(config.salesEmail, 'aifusionlabs@gmail.com');
});

test('moving intake and all three templates are deterministic, Mullins-specific, and escaped', () => {
    const turns = [
        { role: 'user', content: 'I am moving from Scottsdale to Mesa in September from a three bedroom house.' },
        { role: 'agent', content: 'Any specialty items or access concerns?' },
        { role: 'user', content: 'A piano, stairs, packing, and I want a virtual walkthrough next Tuesday afternoon.' },
    ];
    const intake = buildEvanMovingIntake(turns);
    assert.equal(intake.originDestination.length > 0, true);
    assert.equal(intake.inventory.length > 0, true);
    assert.equal(intake.walkthrough.length > 0, true);
    const bundle = buildEvanEmailBundle({
        displayName: '<Pat>',
        verifiedEmail: 'pat@example.com',
        externalSessionId: 'session-1',
        sessionStartedAt: '2026-07-19T10:00:00Z',
        sessionEndedAt: '2026-07-19T10:10:00Z',
        turns,
    });
    assert.match(bundle.visitor.text, /\(602\) 943-8228/);
    assert.match(bundle.visitor.text, /derrick@mullinsmoving\.com/);
    assert.match(bundle.admin.text, /Session ID: session-1/);
    assert.match(bundle.sales.text, /virtual walkthrough/i);
    assert.match(bundle.sales.text, /Still to confirm:/);
    assert.doesNotMatch(bundle.visitor.html, /<Pat>/);
});

test('queue and send reserve one intent/attempt while producing exactly three AgentMail calls', async () => {
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
        turns: [{ role: 'user', content: 'Two bedroom move from Phoenix to Tempe with stairs.' }],
    };
    const first = await sendEvanAnamConversationFollowUp(sendInput, options);
    const duplicate = await sendEvanAnamConversationFollowUp(sendInput, options);
    assert.equal(first.deliveryCount, 3);
    assert.equal(duplicate.duplicate, true);
    assert.equal(sent.length, 3);
    assert.deepEqual(sent.map(message => message.to[0]), [
        'pat@example.com', 'aifusionlabs@gmail.com', 'aifusionlabs@gmail.com',
    ]);
});

test('Evan browser integration requires secure typed check-in and explicit consent tool', async () => {
    const [demo, player, route, tool] = await Promise.all([
        readFile(new URL('../app/demo/[slug]/page.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/evan/access/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../config/anam/evan-agentmail-client-tool.json', import.meta.url), 'utf8'),
    ]);
    assert.match(demo, /EvanContactGate/);
    assert.match(player, /send_mullins_follow_up_email/);
    assert.match(player, /Never say a quote, estimate, price, booking, or appointment will be emailed/);
    assert.match(route, /rawEmailReturned: false/);
    assert.match(route, /createAmyAnamContactToken/);
    assert.match(tool, /userConfirmed/);
    assert.match(tool, /conversation recap/);
    assert.match(tool, /does not create, attach, deliver, or promise a quote/);
});
