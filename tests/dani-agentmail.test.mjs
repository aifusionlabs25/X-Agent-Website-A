import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildDaniEmailBundle } from '../lib/anam/dani-agentmail-templates.ts';
import {
    cancelDaniAnamConversationFollowUp,
    dispatchDaniAnamPostSessionFollowUp,
    queueDaniAnamConversationFollowUp,
    readDaniAnamAgentMailConfig,
    sendDaniAnamConversationFollowUp,
} from '../lib/anam/dani-agentmail.ts';
import { DANI_PERSONA_ID, EVAN_PERSONA_ID } from '../lib/anam/persona-ids.ts';
import {
    DANI_AI_SOLUTIONS_VARIANT,
    resolveAnamSessionAgentSlug,
    resolveAnamSessionVariant,
} from '../lib/anam/session-spine.ts';
import { ensureAmyAnamHermesShadowQueued } from '../lib/anam/session-finalizer.ts';

const env = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 's'.repeat(48),
    AMY_ANAM_REDIS_REST_URL: 'https://redis.test',
    AMY_ANAM_REDIS_REST_TOKEN: 'r'.repeat(32),
    AGENTMAIL_API_KEY: 'a'.repeat(32),
    DANI_EMAIL_PROVIDER: 'agentmail',
    DANI_AGENTMAIL_ADDRESS: 'hermes-hal@agentmail.to',
    DANI_ADMIN_EMAIL: 'aifusionlabs@gmail.com',
    DANI_CALL_SUMMARY_EMAIL: 'aifusionlabs@gmail.com',
    DANI_ANAM_AGENTMAIL_ENABLED: 'true',
    DANI_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
    DANI_ANAM_TOOLS_ENABLED: 'true',
    DANI_ANAM_TOOLS_KILL_SWITCH: 'false',
    DANI_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true',
    DANI_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
};

const turns = [
    { role: 'agent', content: 'What business workflow would you like to improve?' },
    { role: 'user', content: 'Our service team spends hours answering the same policy questions at rob@example.com.' },
    { role: 'agent', content: 'Which source is authoritative and what must remain human-controlled?' },
    { role: 'user', content: 'Approved policy documents are authoritative. A manager must approve exceptions. Call me at 480-555-0186.' },
    { role: 'user', content: 'My API key is sk-example-secret-token-123456 and the test SSN is 123-45-6789.' },
    { role: 'user', content: 'We should compare a grounded knowledge assistant with a conversational X Agent.' },
];

function createMockTransport({ rejectAll = false } = {}) {
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
            else if (operation === 'DEL') result = redis.delete(key) ? 1 : 0;
            else if (operation === 'EXISTS') result = redis.has(key) ? 1 : 0;
            return new Response(JSON.stringify([{ result }]), { status: 200 });
        }
        if (target.includes('/v0/inboxes/hermes-hal%40agentmail.to/messages/send')) {
            if (rejectAll) return new Response(JSON.stringify({ error: 'rejected' }), { status: 500 });
            const body = JSON.parse(String(init.body));
            sent.push(body);
            return new Response(JSON.stringify({ message_id: `message-${sent.length}`, thread_id: `thread-${sent.length}` }), { status: 200 });
        }
        throw new Error(`Unexpected request: ${target}`);
    };
    return { redis, sent, fetchImpl };
}

test('Dani AgentMail config validates both internal recipients before opening the gate', () => {
    const config = readDaniAnamAgentMailConfig(env);
    assert.equal(config.effectiveGateOpen, true);
    assert.equal(config.inboxAddress, 'hermes-hal@agentmail.to');
    assert.equal(config.adminEmail, 'aifusionlabs@gmail.com');
    assert.equal(config.summaryEmail, 'aifusionlabs@gmail.com');
    assert.equal(readDaniAnamAgentMailConfig({
        ...env,
        DANI_AGENTMAIL_ADDRESS: '',
        AMY_AGENTMAIL_ADDRESS: 'shared-amy@agentmail.to',
    }).inboxAddress, 'shared-amy@agentmail.to');
    assert.equal(readDaniAnamAgentMailConfig({ ...env, DANI_ADMIN_EMAIL: 'broken' }).effectiveGateOpen, false);
    assert.equal(readDaniAnamAgentMailConfig({ ...env, DANI_CALL_SUMMARY_EMAIL: 'broken' }).effectiveGateOpen, false);
});

test('Dani templates separate visitor, Admin, and Call Summary audiences and redact spoken contact data', () => {
    const bundle = buildDaniEmailBundle({
        displayName: '<Rob> Vicks',
        verifiedEmail: 'secure@example.com',
        externalSessionId: 'dani-template-session',
        sessionStartedAt: '2026-08-09T16:00:00Z',
        sessionEndedAt: '2026-08-09T16:08:00Z',
        turns,
    });
    assert.match(bundle.visitor.subject, /conversation recap from Dani/i);
    assert.match(bundle.visitor.text, /working recap/i);
    assert.match(bundle.visitor.text, /Useful next validation/i);
    assert.doesNotMatch(bundle.visitor.text, /internal Call Summary|lead score|founder coaching/i);
    assert.match(bundle.admin.subject, /^\[DANI SESSION END\]/);
    assert.match(bundle.admin.text, /Sanitized conversation timeline/i);
    assert.match(bundle.summary.subject, /^\[DANI CALL SUMMARY\]/);
    assert.match(bundle.summary.text, /Potential solution patterns/i);
    for (const message of [bundle.visitor, bundle.admin, bundle.summary]) {
        assert.doesNotMatch(message.text, /rob@example\.com|480-555-0186|sk-example-secret-token-123456|123-45-6789|<Rob>/i);
        assert.doesNotMatch(message.html, /rob@example\.com|480-555-0186|sk-example-secret-token-123456|123-45-6789|<Rob>/i);
    }
});

test('typed opt-in queues once, explicit revocation is durable, and a retry cannot silently re-enable it', async () => {
    const transport = createMockTransport();
    const options = { env, fetchImpl: transport.fetchImpl };
    const input = {
        externalSessionId: 'c9ee53d5-5fc2-4ac2-9f19-af55f1541e23',
        browserSessionId: '944a2f90-c628-4543-8f74-df3427f1918b',
        displayName: 'Pat',
        email: 'pat@example.com',
        contactSecret: env.AMY_ANAM_SESSION_SECRET,
    };
    assert.equal((await queueDaniAnamConversationFollowUp(input, options)).status, 'email_queued');
    assert.equal((await queueDaniAnamConversationFollowUp(input, options)).status, 'email_already_queued');
    assert.equal((await cancelDaniAnamConversationFollowUp(input, options)).status, 'email_cancelled');
    const afterCancellation = await queueDaniAnamConversationFollowUp(input, options);
    assert.equal(afterCancellation.status, 'email_cancelled');
    assert.equal(afterCancellation.queued, false);

    const dispatch = await dispatchDaniAnamPostSessionFollowUp({
        session: {
            schemaVersion: 'amy_anam_session_v1',
            browserSessionId: input.browserSessionId,
            launchId: '85bb0897-3811-4849-a388-a020860682ac',
            externalSessionId: input.externalSessionId,
            clientLabel: 'xagent-dani:test',
            resolvedPersonaId: DANI_PERSONA_ID,
            provider: 'anam',
            agentSlug: 'dani',
            variant: DANI_AI_SOLUTIONS_VARIANT,
            state: 'completed',
            createdAt: '2026-08-09T16:00:00Z',
            boundAt: '2026-08-09T16:00:01Z',
            closeReceivedAt: '2026-08-09T16:08:00Z',
        },
        receipt: {
            schemaVersion: 'amy_anam_session_receipt_v1', receiptId: 'receipt', provider: 'anam',
            externalSessionId: input.externalSessionId, variant: DANI_AI_SOLUTIONS_VARIANT,
            status: 'completed', completedAt: '2026-08-09T16:08:01Z', closeReason: 'user ended',
            transcript: { source: 'anam_api', messageCount: turns.length, contentSha256: 'hash', rawTranscriptPersisted: false },
            actions: { hermes: false, memory: false, email: false, sheets: false },
        },
        turns,
    }, options);
    assert.equal(dispatch.status, 'email_cancelled');
    assert.equal(transport.sent.length, 0);
});

test('Dani sends exactly three messages once after a substantive provider transcript', async () => {
    const transport = createMockTransport();
    const options = { env, fetchImpl: transport.fetchImpl };
    const input = {
        externalSessionId: '7ae79874-85e8-4a02-865b-75f47583dd43',
        displayName: 'Pat',
        email: 'pat@example.com',
        sessionStartedAt: '2026-08-09T16:00:00Z',
        sessionEndedAt: '2026-08-09T16:08:00Z',
        turns,
    };
    const first = await sendDaniAnamConversationFollowUp(input, options);
    const duplicate = await sendDaniAnamConversationFollowUp(input, options);
    assert.equal(first.status, 'email_sent');
    assert.equal(first.deliveryCount, 3);
    assert.equal(duplicate.status, 'email_already_attempted');
    assert.equal(duplicate.duplicate, true);
    assert.equal(transport.sent.length, 3);
    assert.deepEqual(transport.sent.map(message => message.to[0]), [
        'pat@example.com', 'aifusionlabs@gmail.com', 'aifusionlabs@gmail.com',
    ]);
});

test('Dani suppresses greeting-only calls and reports zero-lane provider failure accurately', async () => {
    const noUser = createMockTransport();
    const ineligible = await sendDaniAnamConversationFollowUp({
        externalSessionId: 'f34a23a0-ceff-4787-bcc3-ab38aa1ba27b',
        displayName: 'Pat', email: 'pat@example.com',
        sessionStartedAt: '2026-08-09T16:00:00Z', sessionEndedAt: '2026-08-09T16:00:05Z',
        turns: [{ role: 'agent', content: 'Hi, I am Dani.' }],
    }, { env, fetchImpl: noUser.fetchImpl });
    assert.equal(ineligible.status, 'conversation_ineligible');
    assert.equal(noUser.sent.length, 0);

    const rejected = createMockTransport({ rejectAll: true });
    const failed = await sendDaniAnamConversationFollowUp({
        externalSessionId: 'b6b81abf-4493-45b5-ae13-d8e223480203',
        displayName: 'Pat', email: 'pat@example.com',
        sessionStartedAt: '2026-08-09T16:00:00Z', sessionEndedAt: '2026-08-09T16:08:00Z', turns,
    }, { env, fetchImpl: rejected.fetchImpl });
    assert.equal(failed.status, 'email_failed');
    assert.equal(failed.deliveryCount, 0);
});

test('legacy Evan records mislabelled as Amy cannot enter Hermes and select Evan dispatch', async () => {
    const legacySession = {
        schemaVersion: 'amy_anam_session_v1',
        browserSessionId: 'legacy-evan-browser',
        launchId: 'f15312db-c01d-4f19-b7df-14015b899c46',
        externalSessionId: 'aa8b171b-e06d-40a6-939a-dd5e92a34ed6',
        clientLabel: 'xagent-amy:f15312db-c01d-4f19-b7df-14015b899c46',
        resolvedPersonaId: EVAN_PERSONA_ID,
        provider: 'anam',
        agentSlug: 'amy',
        variant: 'amy-cara4',
        state: 'completed',
        createdAt: '2026-08-09T16:00:00Z',
        boundAt: '2026-08-09T16:00:01Z',
        completedAt: '2026-08-09T16:08:01Z',
    };
    const legacyReceipt = {
        schemaVersion: 'amy_anam_session_receipt_v1',
        receiptId: 'legacy-evan-receipt',
        provider: 'anam',
        externalSessionId: legacySession.externalSessionId,
        variant: 'amy-cara4',
        status: 'completed',
        completedAt: legacySession.completedAt,
        closeReason: 'user ended',
        transcript: { source: 'anam_api', messageCount: 2, contentSha256: 'hash', rawTranscriptPersisted: false },
        actions: { hermes: false, memory: false, email: false, sheets: false },
    };

    assert.equal(resolveAnamSessionAgentSlug(EVAN_PERSONA_ID, 'amy'), 'evan');
    assert.equal(resolveAnamSessionVariant(EVAN_PERSONA_ID, 'amy-cara4'), 'evan-mullins');
    assert.equal(resolveAnamSessionAgentSlug(DANI_PERSONA_ID, undefined), 'dani');
    assert.equal(resolveAnamSessionVariant(DANI_PERSONA_ID, undefined), DANI_AI_SOLUTIONS_VARIANT);
    assert.equal(await ensureAmyAnamHermesShadowQueued(legacySession, legacyReceipt), 'ineligible');

    const finalizer = await readFile(new URL('../lib/anam/session-finalizer.ts', import.meta.url), 'utf8');
    const dispatchStart = finalizer.indexOf('const dispatchFollowUp =');
    const dispatchEnd = finalizer.indexOf('const emailResult =', dispatchStart);
    const normalization = finalizer.lastIndexOf('agentSlug: resolveAnamSessionAgentSlug', dispatchStart);
    assert.ok(normalization >= 0 && normalization < dispatchStart);
    assert.match(
        finalizer.slice(dispatchStart, dispatchEnd),
        /session\.resolvedPersonaId === EVAN_PERSONA_ID[\s\S]*session\.agentSlug === 'evan'[\s\S]*\? dispatchEvanAnamPostSessionFollowUp/,
    );
});

test('Dani browser integration uses agent-scoped typed consent, provider finalization, and no legacy transcript fallback', async () => {
    const [gate, access, tokenRoute, bind, email, player, finalizer, legacy, tool, contactToken] = await Promise.all([
        readFile(new URL('../components/dani/DaniContactGate.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/dani/access/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam-token/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/session/bind/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/session/email/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../lib/anam/session-finalizer.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/save-transcript/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../config/anam/dani-agentmail-client-tool.json', import.meta.url), 'utf8'),
        readFile(new URL('../lib/anam/contact-token.ts', import.meta.url), 'utf8'),
    ]);
    assert.match(gate, /Email me Dani&apos;s thank-you and working recap/);
    assert.match(gate, /Continue without email/);
    assert.doesNotMatch(gate, /method: 'DELETE'/);
    assert.match(access, /purpose: 'dani_follow_up'/);
    assert.match(access, /DANI_ANAM_CONTACT_COOKIE/);
    assert.doesNotMatch(access, /response\.cookies\.set\(AMY_ANAM_BROWSER_COOKIE, '',/);
    assert.match(contactToken, /xagent_dani_anam_contact/);
    assert.match(tokenRoute, /readDaniAnamContactFromRequest/);
    assert.match(bind, /queueDaniAnamConversationFollowUp/);
    assert.match(bind, /readDaniAnamContactFromRequest/);
    assert.match(email, /cancelDaniAnamConversationFollowUp/);
    assert.match(email, /const contact = isDani \? daniContact : sharedContact/);
    assert.match(player, /send_dani_follow_up_email/);
    assert.match(player, /setDaniAnamFollowUpPreference/);
    const transcript = finalizer.indexOf('await fetchCompletedAnamTranscript');
    const receipt = finalizer.indexOf('await writeAmyAnamReceipt');
    const dispatch = finalizer.indexOf('? dispatchDaniAnamPostSessionFollowUp');
    assert.ok(transcript >= 0 && receipt > transcript && dispatch > receipt);
    assert.match(legacy, /Dani transcripts are accepted only through the provider-authoritative Anam session finalizer/);
    assert.match(tool, /email_cancelled/);
    assert.match(tool, /website only/i);
});
