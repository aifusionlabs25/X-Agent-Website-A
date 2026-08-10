import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildDaniEmailBundle } from '../lib/anam/dani-agentmail-templates.ts';
import { sendDaniAnamMemoryVerificationEmail } from '../lib/anam/dani-memory-verification-email.ts';
import {
    cancelDaniAnamConversationFollowUp,
    clearDaniAnamFollowUpAuthorization,
    consumeDaniAnamFollowUpOtpChallenge,
    createDaniAnamFollowUpOtpChallenge,
    dispatchDaniAnamPostSessionFollowUp,
    finalizeDaniAnamVerifiedFollowUpAuthorization,
    queueDaniAnamConversationFollowUp,
    readDaniAnamAgentMailConfig,
    readDaniAnamFollowUpAuthorization,
    scheduleDaniAnamEmailRetryAfterDispatchFailure,
    sendDaniAnamConversationFollowUp,
    storeDaniAnamFollowUpAuthorization,
} from '../lib/anam/dani-agentmail.ts';
import { createDaniAnamContactToken } from '../lib/anam/contact-token.ts';
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
    DANI_ANAM_SESSION_SECRET: 'dani-session-secret-'.padEnd(48, 's'),
    DANI_ANAM_CONTACT_SECRET: 'dani-contact-secret-'.padEnd(48, 'c'),
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

function createMockTransport({
    rejectAll = false,
    rejectSubjectsOnce = [],
    rejectSubjectCounts = {},
    failAuthorizationSetCount = 0,
    failDeliveryReceiptSetCounts = {},
} = {}) {
    const redis = new Map();
    const zsets = new Map();
    const sent = [];
    const attempts = [];
    const idempotentMessages = new Map();
    const subjectFailureCounts = new Map();
    let remainingAuthorizationFailures = failAuthorizationSetCount;
    const remainingDeliveryReceiptFailures = new Map(
        Object.entries(failDeliveryReceiptSetCounts).map(([lane, count]) => [lane, Number(count)]),
    );
    const runRedisCommand = command => {
        const operation = command[0];
        let result = null;
        if (operation === 'SET') {
            const [, key, value, ...args] = command;
            if (String(key).includes(':authorization:') && remainingAuthorizationFailures > 0) {
                remainingAuthorizationFailures -= 1;
                return { error: 'injected authorization failure' };
            }
            const failedLane = [...remainingDeliveryReceiptFailures.entries()].find(([lane, count]) => (
                count > 0 && String(key).includes(`:delivery:v1:`) && String(key).endsWith(`:${lane}`)
            ));
            if (failedLane) {
                remainingDeliveryReceiptFailures.set(failedLane[0], failedLane[1] - 1);
                return { error: 'injected delivery receipt failure' };
            }
            const mode = args.find(item => item === 'NX' || item === 'XX');
            if (mode === 'NX' && redis.has(key)) result = null;
            else if (mode === 'XX' && !redis.has(key)) result = null;
            else { redis.set(key, value); result = 'OK'; }
        } else if (operation === 'GET') result = redis.get(command[1]) ?? null;
        else if (operation === 'DEL') result = redis.delete(command[1]) ? 1 : 0;
        else if (operation === 'EXISTS') result = redis.has(command[1]) ? 1 : 0;
        else if (operation === 'EXPIRE') result = redis.has(command[1]) || zsets.has(command[1]) ? 1 : 0;
        else if (operation === 'ZADD') {
            const [, key, score, member] = command;
            const zset = zsets.get(key) ?? new Map();
            const existed = zset.has(member);
            zset.set(member, Number(score));
            zsets.set(key, zset);
            result = existed ? 0 : 1;
        } else if (operation === 'ZREM') {
            const [, key, member] = command;
            result = zsets.get(key)?.delete(member) ? 1 : 0;
        } else if (operation === 'ZSCORE') {
            const [, key, member] = command;
            const score = zsets.get(key)?.get(member);
            result = score === undefined ? null : String(score);
        } else if (operation === 'ZRANGEBYSCORE') {
            const [, key, minValue, maxValue, , offset = 0, limit = Number.MAX_SAFE_INTEGER] = command;
            const minimum = minValue === '-inf' ? Number.NEGATIVE_INFINITY : Number(minValue);
            const maximum = maxValue === '+inf' ? Number.POSITIVE_INFINITY : Number(maxValue);
            result = [...(zsets.get(key)?.entries() ?? [])]
                .filter(([, score]) => score >= minimum && score <= maximum)
                .sort((left, right) => left[1] - right[1] || String(left[0]).localeCompare(String(right[0])))
                .slice(Number(offset), Number(offset) + Number(limit))
                .map(([member]) => member);
        } else if (
            operation === 'EVAL'
            && String(command[1]).startsWith('-- ')
            && !String(command[1]).includes('\n')
        ) {
            // Redis line comments consume a single-line script and return nil.
            result = null;
        } else if (operation === 'EVAL' && String(command[1]).includes('DANI_AGENTMAIL_OTP_CONSUME_V1')) {
            const key = command[3];
            const raw = redis.get(key);
            if (!raw) result = ['invalid'];
            else {
                const challenge = JSON.parse(raw);
                const [, , , , challengeId, browserSessionId, now, otpHash, maxAttempts] = command;
                if (challenge.challengeId !== challengeId || challenge.browserSessionId !== browserSessionId) {
                    result = ['invalid'];
                } else if (now >= challenge.expiresAt) {
                    redis.delete(key);
                    result = ['expired'];
                } else if (challenge.otpHash !== otpHash) {
                    challenge.attemptCount += 1;
                    if (challenge.attemptCount >= Number(maxAttempts)) {
                        redis.delete(key);
                        result = ['locked'];
                    } else {
                        redis.set(key, JSON.stringify(challenge));
                        result = ['invalid'];
                    }
                } else {
                    redis.delete(key);
                    result = ['verified', challenge.contactToken];
                }
            }
        }
        return { result };
    };
    const fetchImpl = async (url, init = {}) => {
        const target = String(url);
        if (target === 'https://redis.test/pipeline') {
            const commands = JSON.parse(String(init.body));
            return new Response(JSON.stringify(commands.map(runRedisCommand)), { status: 200 });
        }
        if (target.includes('/v0/inboxes/hermes-hal%40agentmail.to/messages/send')) {
            const body = JSON.parse(String(init.body));
            const headers = init.headers ?? {};
            const idempotencyKey = headers instanceof Headers
                ? headers.get('Idempotency-Key')
                : headers['Idempotency-Key'] ?? headers['idempotency-key'] ?? null;
            attempts.push({ body, idempotencyKey });
            const rejectedSubject = [
                ...rejectSubjectsOnce,
                ...Object.keys(rejectSubjectCounts),
            ].find(value => body.subject.includes(value));
            const rejectionLimit = rejectedSubject
                ? Number(rejectSubjectCounts[rejectedSubject] ?? 1)
                : 0;
            const rejectionCount = subjectFailureCounts.get(rejectedSubject) ?? 0;
            if (rejectAll || (rejectedSubject && rejectionCount < rejectionLimit)) {
                if (rejectedSubject) subjectFailureCounts.set(rejectedSubject, rejectionCount + 1);
                return new Response(JSON.stringify({ error: 'rejected' }), { status: 503 });
            }
            const serializedBody = JSON.stringify(body);
            const existingMessage = idempotencyKey ? idempotentMessages.get(idempotencyKey) : null;
            if (existingMessage) {
                if (existingMessage.serializedBody !== serializedBody) {
                    return new Response(JSON.stringify({ error: 'idempotency conflict' }), { status: 409 });
                }
                return new Response(JSON.stringify(existingMessage.response), { status: 200 });
            }
            const response = {
                message_id: `message-${sent.length + 1}`,
                thread_id: `thread-${sent.length + 1}`,
            };
            sent.push(body);
            if (idempotencyKey) idempotentMessages.set(idempotencyKey, { serializedBody, response });
            return new Response(JSON.stringify(response), { status: 200 });
        }
        throw new Error(`Unexpected request: ${target}`);
    };
    return { redis, zsets, sent, attempts, fetchImpl };
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

test('all Dani OTP email scopes fail closed behind the outbound-action kill switch', async () => {
    const transport = createMockTransport();
    for (const scope of ['follow_up', 'memory', 'memory_and_follow_up']) {
        await assert.rejects(() => sendDaniAnamMemoryVerificationEmail({
            email: 'pat@example.com',
            verificationCode: '123456',
            scope,
        }, {
            env: { ...env, DANI_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'true' },
            fetchImpl: transport.fetchImpl,
        }), /verification email is unavailable/i);
    }
    assert.equal(transport.attempts.length, 0);
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
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
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

test('Dani follow-up authorization survives the access-to-bind handoff without storing raw email', async () => {
    const transport = createMockTransport();
    const options = { env, fetchImpl: transport.fetchImpl };
    const browserSessionId = '09680877-2c33-48aa-8316-3359950f7bcd';
    const token = createDaniAnamContactToken({
        browserSessionId,
        displayName: 'Pat',
        email: 'pat@example.com',
        purpose: 'dani_follow_up',
        emailOwnershipVerified: true,
        secret: env.DANI_ANAM_CONTACT_SECRET,
    });
    const stored = await storeDaniAnamFollowUpAuthorization({
        browserSessionId,
        contactToken: token,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
    }, options);
    assert.deepEqual(stored, { stored: true, rawEmailStored: false });
    const recovered = await readDaniAnamFollowUpAuthorization({
        browserSessionId,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
    }, options);
    assert.equal(recovered?.email, 'pat@example.com');
    assert.equal(recovered?.displayName, 'Pat');
    assert.equal(recovered?.purpose, 'dani_follow_up');
    await clearDaniAnamFollowUpAuthorization(browserSessionId, options);
    assert.equal(await readDaniAnamFollowUpAuthorization({
        browserSessionId,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
    }, options), null);
});

test('follow-up-only OTP verifies ownership without opening Dani memory or storing raw contact data', async () => {
    const transport = createMockTransport();
    const options = { env, fetchImpl: transport.fetchImpl };
    const browserSessionId = 'ca924a34-1c76-44b9-b3cb-66ea735498a5';
    const token = createDaniAnamContactToken({
        browserSessionId,
        displayName: 'Pat',
        email: 'private@example.com',
        purpose: 'dani_follow_up',
        secret: env.DANI_ANAM_CONTACT_SECRET,
    });
    const challenge = await createDaniAnamFollowUpOtpChallenge({
        browserSessionId,
        contactToken: token,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
        now: Date.parse('2026-08-09T16:00:00Z'),
    }, options);
    const storedChallenge = [...transport.redis.values()].find(value => (
        typeof value === 'string' && value.includes('dani_anam_agentmail_otp_v1')
    ));
    assert.equal(typeof storedChallenge, 'string');
    assert.doesNotMatch(storedChallenge, /private@example\.com/i);
    assert.doesNotMatch(storedChallenge, new RegExp(challenge.verificationCode));
    assert.equal((await consumeDaniAnamFollowUpOtpChallenge({
        challengeId: challenge.challengeId,
        browserSessionId,
        verificationCode: '000000' === challenge.verificationCode ? '000001' : '000000',
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
        now: Date.parse('2026-08-09T16:01:00Z'),
    }, options)).status, 'invalid');
    const verified = await consumeDaniAnamFollowUpOtpChallenge({
        challengeId: challenge.challengeId,
        browserSessionId,
        verificationCode: challenge.verificationCode,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
        now: Date.parse('2026-08-09T16:01:30Z'),
    }, options);
    assert.equal(verified.status, 'verified');
    assert.equal(verified.status === 'verified' && verified.contactToken, token);
    assert.equal((await consumeDaniAnamFollowUpOtpChallenge({
        challengeId: challenge.challengeId,
        browserSessionId,
        verificationCode: challenge.verificationCode,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
        now: Date.parse('2026-08-09T16:02:00Z'),
    }, options)).status, 'invalid');
});

test('a consumed follow-up OTP still yields the authoritative cookie token when authorization storage fails', async () => {
    const transport = createMockTransport({ failAuthorizationSetCount: 1 });
    const options = { env, fetchImpl: transport.fetchImpl };
    const browserSessionId = '027cf436-f591-4e24-8963-8e6631d3fa57';
    const token = createDaniAnamContactToken({
        browserSessionId,
        displayName: 'Pat',
        email: 'pat@example.com',
        purpose: 'dani_follow_up',
        secret: env.DANI_ANAM_CONTACT_SECRET,
    });
    const challenge = await createDaniAnamFollowUpOtpChallenge({
        browserSessionId,
        contactToken: token,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
    }, options);
    const consumed = await consumeDaniAnamFollowUpOtpChallenge({
        challengeId: challenge.challengeId,
        browserSessionId,
        verificationCode: challenge.verificationCode,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
    }, options);
    assert.equal(consumed.status, 'verified');
    assert.ok(consumed.status === 'verified');
    const deferred = await finalizeDaniAnamVerifiedFollowUpAuthorization({
        browserSessionId,
        contactToken: consumed.contactToken,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
    }, options);
    assert.equal(deferred.authorizationStored, false);
    assert.notEqual(deferred.contactToken, token);
    assert.equal(deferred.contact.email, 'pat@example.com');
    const recovered = await finalizeDaniAnamVerifiedFollowUpAuthorization({
        browserSessionId,
        contactToken: deferred.contactToken,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
    }, options);
    assert.equal(recovered.authorizationStored, true);
    assert.equal((await readDaniAnamFollowUpAuthorization({
        browserSessionId,
        contactSecret: env.DANI_ANAM_CONTACT_SECRET,
    }, options))?.email, 'pat@example.com');
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

test('Dani retries only a missing email lane inside the initial finalization with the same provider idempotency key', async () => {
    const transport = createMockTransport({ rejectSubjectsOnce: ['[DANI SESSION END]'] });
    const options = { env, fetchImpl: transport.fetchImpl };
    const input = {
        externalSessionId: '8bd81fb0-2ff8-4eb0-a18e-e3af31b24951',
        displayName: 'Pat',
        email: 'pat@example.com',
        sessionStartedAt: '2026-08-09T16:00:00Z',
        sessionEndedAt: '2026-08-09T16:08:00Z',
        turns,
    };
    const first = await sendDaniAnamConversationFollowUp(input, options);
    assert.equal(first.status, 'email_sent');
    assert.equal(first.deliveryCount, 3);
    assert.equal(first.visitorSent, true);
    assert.equal(first.internalNotificationsSent, true);
    assert.equal(transport.attempts.length, 4);
    assert.equal(new Set(transport.attempts.map(attempt => attempt.idempotencyKey)).size, 3);

    const failedAdminAttempt = transport.attempts.find(attempt => (
        attempt.body.subject.includes('[DANI SESSION END]')
    ));
    assert.ok(failedAdminAttempt?.idempotencyKey);
    assert.equal(transport.attempts[3].body.subject.includes('[DANI SESSION END]'), true);
    assert.equal(transport.attempts[3].idempotencyKey, failedAdminAttempt.idempotencyKey);
    assert.deepEqual(transport.attempts[3].body, failedAdminAttempt.body);

    const completeDuplicate = await sendDaniAnamConversationFollowUp(input, options);
    assert.equal(completeDuplicate.status, 'email_already_attempted');
    assert.equal(transport.attempts.length, 4);
    assert.equal(transport.sent.length, 3);
});

test('a later post-receipt recovery reuses byte-stable email content and the original lane key', async () => {
    const transport = createMockTransport({
        rejectSubjectCounts: { '[DANI SESSION END]': 3 },
    });
    const baseNow = Date.parse('2026-08-09T16:00:00Z');
    const input = {
        externalSessionId: 'ed0b770a-240f-43df-b46b-0bc3628f1a54',
        displayName: 'Pat',
        email: 'pat@example.com',
        sessionStartedAt: '2026-08-09T16:00:00Z',
        sessionEndedAt: '2026-08-09T16:08:00Z',
        turns,
    };
    const partial = await sendDaniAnamConversationFollowUp(input, {
        env,
        fetchImpl: transport.fetchImpl,
        now: baseNow,
    });
    assert.equal(partial.status, 'email_partial');
    const retryDueSet = [...transport.zsets.entries()].find(([key]) => key.includes(':agentmail:retry-due:v1'))?.[1];
    assert.equal(retryDueSet?.get(input.externalSessionId), baseNow + 5 * 60 * 1_000);
    const adminAttemptsBeforeRecovery = transport.attempts.filter(attempt => (
        attempt.body.subject.includes('[DANI SESSION END]')
    ));
    assert.equal(adminAttemptsBeforeRecovery.length, 3);

    const recovered = await sendDaniAnamConversationFollowUp(input, {
        env,
        fetchImpl: transport.fetchImpl,
        now: baseNow + 5_000,
    });
    assert.equal(recovered.status, 'email_sent');
    const adminAttempts = transport.attempts.filter(attempt => (
        attempt.body.subject.includes('[DANI SESSION END]')
    ));
    assert.equal(adminAttempts.length, 4);
    assert.equal(new Set(adminAttempts.map(attempt => attempt.idempotencyKey)).size, 1);
    for (const attempt of adminAttempts.slice(1)) {
        assert.deepEqual(attempt.body, adminAttempts[0].body);
    }
    assert.equal(retryDueSet?.has(input.externalSessionId), false);
});

test('a lost local lane receipt retries with provider idempotency and still delivers at most one message per lane', async () => {
    const transport = createMockTransport({
        failDeliveryReceiptSetCounts: { visitor: 1 },
    });
    const result = await sendDaniAnamConversationFollowUp({
        externalSessionId: 'b5b933f3-27e2-4bcb-b19d-8523828b8374',
        displayName: 'Pat',
        email: 'pat@example.com',
        sessionStartedAt: '2026-08-09T16:00:00Z',
        sessionEndedAt: '2026-08-09T16:08:00Z',
        turns,
    }, {
        env,
        fetchImpl: transport.fetchImpl,
        now: Date.parse('2026-08-09T16:08:00Z'),
    });
    assert.equal(result.status, 'email_sent');
    assert.equal(transport.attempts.length, 4);
    assert.equal(transport.sent.length, 3);
    const visitorAttempts = transport.attempts.filter(attempt => (
        attempt.body.subject.includes('Your conversation recap from Dani')
    ));
    assert.equal(visitorAttempts.length, 2);
    assert.equal(new Set(visitorAttempts.map(attempt => attempt.idempotencyKey)).size, 1);
    assert.deepEqual(visitorAttempts[1].body, visitorAttempts[0].body);
});

test('a thrown post-receipt dispatch gets a durable fallback due entry and expires from receipt time', async () => {
    const transport = createMockTransport();
    const baseNow = Date.parse('2026-08-09T16:08:00Z');
    const externalSessionId = '77c5ad08-f0f2-4c7a-9706-74170c7fe678';
    assert.equal(await scheduleDaniAnamEmailRetryAfterDispatchFailure({
        externalSessionId,
        retryStartedAt: new Date(baseNow).toISOString(),
    }, {
        env,
        fetchImpl: transport.fetchImpl,
        now: baseNow,
    }), 'scheduled');
    const retryDueSet = [...transport.zsets.entries()].find(([key]) => key.includes(':agentmail:retry-due:v1'))?.[1];
    assert.equal(retryDueSet?.get(externalSessionId), baseNow + 5 * 60 * 1_000);

    assert.equal(await scheduleDaniAnamEmailRetryAfterDispatchFailure({
        externalSessionId,
        retryStartedAt: new Date(baseNow).toISOString(),
    }, {
        env,
        fetchImpl: transport.fetchImpl,
        now: baseNow + 23 * 60 * 60 * 1_000,
    }), 'expired');
    assert.equal(retryDueSet?.has(externalSessionId), false);
    assert.equal(transport.attempts.length, 0);
});

test('Dani fails closed instead of retrying a missing lane after AgentMail idempotency protection expires', async () => {
    const transport = createMockTransport({ rejectAll: true });
    const baseNow = Date.parse('2026-08-09T16:00:00Z');
    const input = {
        externalSessionId: '3e30e66b-8dc6-4fcf-98c5-1001f5a1356f',
        displayName: 'Pat',
        email: 'pat@example.com',
        sessionStartedAt: '2026-08-09T16:00:00Z',
        sessionEndedAt: '2026-08-09T16:08:00Z',
        turns,
    };
    const first = await sendDaniAnamConversationFollowUp(input, {
        env,
        fetchImpl: transport.fetchImpl,
        now: baseNow,
    });
    assert.equal(first.status, 'email_failed');
    const retryDueSet = [...transport.zsets.entries()].find(([key]) => key.includes(':agentmail:retry-due:v1'))?.[1];
    assert.equal(retryDueSet?.has(input.externalSessionId), true);
    const attemptsInsideSafeWindow = transport.attempts.length;
    assert.equal(attemptsInsideSafeWindow, 9);

    const expiredRetry = await sendDaniAnamConversationFollowUp(input, {
        env,
        fetchImpl: transport.fetchImpl,
        now: baseNow + 23 * 60 * 60 * 1_000 + 1,
    });
    assert.equal(expiredRetry.status, 'email_retry_expired');
    assert.equal(expiredRetry.duplicate, true);
    assert.equal(transport.attempts.length, attemptsInsideSafeWindow);
    assert.equal(retryDueSet?.has(input.externalSessionId), false);
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

test('Dani browser integration uses agent-scoped typed contact authorization, provider finalization, and no legacy transcript fallback', async () => {
    const [gate, access, verifyAccess, tokenRoute, bind, email, player, finalizer, legacy, tool, contactToken] = await Promise.all([
        readFile(new URL('../components/dani/DaniContactGate.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/dani/access/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/dani/access/verify/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam-token/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/session/bind/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/anam/session/email/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../lib/anam/session-finalizer.ts', import.meta.url), 'utf8'),
        readFile(new URL('../app/api/save-transcript/route.ts', import.meta.url), 'utf8'),
        readFile(new URL('../config/anam/dani-agentmail-client-tool.json', import.meta.url), 'utf8'),
        readFile(new URL('../lib/anam/contact-token.ts', import.meta.url), 'utf8'),
    ]);
    assert.doesNotMatch(gate, /Email me Dani&apos;s thank-you and working recap/);
    assert.match(gate, /type="checkbox"/);
    assert.match(gate, /Email my recap/);
    assert.match(gate, /Remember me across sessions/);
    assert.match(gate, /<fieldset aria-describedby="dani-email-purpose-help">/);
    assert.match(gate, /checked=\{followUpConsent\}/);
    assert.match(gate, /checked=\{memoryConsent\}/);
    assert.match(gate, /Start conversation/);
    assert.match(gate, /\{ displayName, email, followUpConsent, memoryConsent \}/);
    assert.doesNotMatch(gate, /followUpConsent: true/);
    assert.match(gate, /!followUpConsent && !memoryConsent/);
    assert.match(gate, /\/api\/anam\/dani\/access\/verify/);
    assert.match(gate, /payload\.memoryVerified !== true && payload\.followUpAuthorized !== true/);
    assert.match(gate, /Continue without email/);
    assert.doesNotMatch(gate, /method: 'DELETE'/);
    assert.match(access, /purpose: 'dani_follow_up'/);
    assert.match(access, /DANI_ANAM_CONTACT_COOKIE/);
    assert.match(access, /createDaniAnamFollowUpOtpChallenge/);
    assert.match(access, /verificationRequired: true/);
    assert.match(access, /if \(!followUpConsent && !memoryConsent\)/);
    assert.match(access, /scope: followUpConsent \? 'memory_and_follow_up' : 'memory'/);
    assert.match(access, /const memoryEnrollmentAvailable = memoryConfig\.gatesOpen && emailConfig\.effectiveGateOpen/);
    assert.match(access, /if \(memoryConsent && !memoryEnrollmentAvailable\)/);
    assert.doesNotMatch(access, /memoryAvailable: memoryConfig\.gatesOpen/);
    assert.doesNotMatch(access, /await storeDaniAnamFollowUpAuthorization/);
    const followUpVerify = verifyAccess.indexOf('isDaniAnamFollowUpOtpChallengeId(challengeId)');
    const memoryGate = verifyAccess.indexOf('if (!memory.gatesOpen)');
    assert.ok(followUpVerify >= 0 && memoryGate > followUpVerify);
    assert.match(verifyAccess, /memoryVerified: false/);
    assert.match(verifyAccess, /followUpAuthorized: true/);
    assert.match(verifyAccess, /DANI_ANAM_CONTACT_COOKIE/);
    assert.doesNotMatch(access, /response\.cookies\.set\(AMY_ANAM_BROWSER_COOKIE, '',/);
    assert.match(contactToken, /xagent_dani_anam_contact/);
    assert.match(tokenRoute, /readDaniAnamContactFromRequest/);
    assert.match(bind, /queueDaniAnamConversationFollowUp/);
    assert.match(bind, /readDaniAnamContactFromRequest/);
    assert.match(bind, /readDaniAnamFollowUpAuthorization/);
    assert.match(email, /cancelDaniAnamConversationFollowUp/);
    assert.match(email, /const contact = isDani \? daniContact : sharedContact/);
    assert.match(player, /send_dani_follow_up_email/);
    assert.match(player, /setDaniAnamFollowUpPreference/);
    const transcript = finalizer.indexOf('await fetchCompletedAnamTranscript');
    const receipt = finalizer.indexOf('await writeAmyAnamReceipt');
    const dispatch = finalizer.indexOf('? dispatchDaniAnamPostSessionFollowUp');
    assert.ok(transcript >= 0 && receipt > transcript && dispatch > receipt);
    const existingReceiptBranch = finalizer.indexOf('if (existingReceipt)');
    const recoveryDispatch = finalizer.indexOf('Post-receipt recovery finished', existingReceiptBranch);
    const initialState = finalizer.indexOf('const initialState =', existingReceiptBranch);
    assert.ok(existingReceiptBranch >= 0 && recoveryDispatch > existingReceiptBranch && recoveryDispatch < initialState);
    const recoverySlice = finalizer.slice(existingReceiptBranch, initialState);
    assert.match(recoverySlice, /fetchCompletedAnamTranscript/);
    assert.match(recoverySlice, /recoveredReceipt\.transcript\.contentSha256 === existingReceipt\.transcript\.contentSha256/);
    assert.match(recoverySlice, /emailResult\.status === 'email_partial'[\s\S]*emailResult\.status === 'email_failed'[\s\S]*return 'pending'/);
    assert.match(finalizer.slice(dispatch), /emailResult\.status === 'email_partial'[\s\S]*emailResult\.status === 'email_failed'[\s\S]*return 'pending'/);
    assert.match(legacy, /Dani transcripts are accepted only through the provider-authoritative Anam session finalizer/);
    assert.match(tool, /email_cancelled/);
    assert.match(tool, /website only/i);
});
