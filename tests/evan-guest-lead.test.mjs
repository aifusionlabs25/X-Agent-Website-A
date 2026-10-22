import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEvanConsentedGuestLead, extractEvanGuestRecapRecipient } from '../lib/anam/evan-guest-lead.ts';
import { dispatchEvanAnamPostSessionFollowUp } from '../lib/anam/evan-agentmail.ts';
import { buildEvanEmailBundle, buildEvanGuestLeadBrief } from '../lib/anam/evan-agentmail-templates.ts';

test('run47 self-introduction survives guest extraction and all three email identities', () => {
    const turns = [
        { role: 'user', content: 'Okay. Thanks. What happens next? Could someone call tomorrow about an estimate?' },
        { role: 'agent', content: "If you'd like, I can email a short recap after the call so the team can follow up on an estimate." },
        { role: 'user', content: "Sure. I'm Jordan Avery. My phone is 202 555 0146 and my email is jordan.avery@example.com." },
        { role: 'agent', content: 'Thanks Jordan. Did I get that right, two oh two, five five five, oh one four six, and jordan.avery at example dot com?' },
        { role: 'user', content: "Yes, that's exactly right." },
    ];
    const lead = extractEvanConsentedGuestLead(turns);
    assert.equal(lead.nameForReview, 'Jordan Avery');
    assert.equal(lead.displayName, null, 'first-name acknowledgement is not full-name readback');
    const recipient = extractEvanGuestRecapRecipient(turns);
    assert.deepEqual(recipient, { email: 'jordan.avery@example.com', displayName: 'Jordan Avery', confirmedByReadback: true });
    const bundle = buildEvanEmailBundle({ displayName: recipient.displayName, verifiedEmail: recipient.email,
        externalSessionId: 'run47-local-regression', sessionStartedAt: '2026-10-22T00:21:09Z',
        sessionEndedAt: '2026-10-22T00:23:38Z', turns, emailSource: 'spoken' });
    assert.match(bundle.admin.text, /Visitor: Jordan Avery/);
    assert.match(bundle.sales.text, /Customer: Jordan Avery/);
    assert.match(bundle.visitor.text, /Hi Jordan,/);
    assert.equal(extractEvanGuestRecapRecipient([...turns, { role: 'user', content: 'Forget my name.' }]).displayName, 'Visitor');
});

test('guest bundled introductions do not turn descriptions or third-party names into caller identity', () => {
    for (const text of [
        "Sure. I'm moving from Mesa. My email is casey@example.com.",
        "Sure. I'm All Set. My email is casey@example.com.",
        'My friend is Jordan Avery. My email is casey@example.com.',
        'For example, I am Jordan Avery. My email is casey@example.com.',
        '"I am Jordan Avery." My email is casey@example.com.',
    ]) assert.equal(extractEvanGuestRecapRecipient([{ role: 'user', content: text }]).displayName, 'Visitor', text);
});

const goodTurns = [
    { role: 'user', content: 'Could somebody call me tomorrow about the move?' },
    { role: 'agent', content: 'What name should I use?' },
    { role: 'user', content: 'My name is Jordan Avery.' },
    { role: 'agent', content: 'Jordan Avery, did I get that right?' },
    { role: 'user', content: 'Yes.' },
    { role: 'agent', content: 'What phone number is best?' },
    { role: 'user', content: 'My phone number is 202-555-0146.' },
    { role: 'agent', content: 'Two oh two, five five five, oh one four six. Did I get that right?' },
    { role: 'user', content: "That's right." },
    { role: 'agent', content: 'What email would you like to share for the team?' },
    { role: 'user', content: 'My email is jordan.avery@example.com.' },
    { role: 'agent', content: 'Jordan dot Avery at example dot com. Did I get that right?' },
    { role: 'user', content: 'Yes.' },
    { role: 'user', content: 'The move is from Mesa to Tempe, second week of November.' },
];

const run43Turns = [
    { role: 'user', content: 'Could someone call tomorrow about an estimate?' },
    { role: 'agent', content: 'Would you like to leave a callback number, or would you prefer to reach out to Mullins Moving directly tomorrow?' },
    { role: 'user', content: "I'm happy to leave my info for a possible follow up. Jordan Avery, phone 2025550146, email jordan.avery@example.com. What happens next?" },
    { role: 'agent', content: 'Thanks, Jordan. Let me make sure I got that right: Jordan Avery, phone 2-0-2, 5-5-5, 0-1-4-6, and email jordan dot avery at example dot com. Did I get that right?' },
    { role: 'user', content: "Yes, that's right." },
];

test('guest lead requires visitor-supplied values, verbal confirmation, and follow-up request', () => {
    assert.deepEqual(extractEvanConsentedGuestLead(goodTurns), {
        displayName: 'Jordan Avery', nameForReview: null, phone: '2025550146', email: 'jordan.avery@example.com',
        requestedFollowUp: true, callbackWindow: 'tomorrow',
    });
    assert.equal(extractEvanConsentedGuestLead(goodTurns.slice(1)), null);
    assert.equal(extractEvanConsentedGuestLead(goodTurns.slice(0, 8)), null);
    assert.equal(extractEvanConsentedGuestLead([...goodTurns, { role: 'user', content: 'No follow-up, please.' }]), null);
});

test('agent-invented or corrected-but-unconfirmed contact is not sent as a lead', () => {
    assert.equal(extractEvanConsentedGuestLead([
        { role: 'user', content: 'Could someone call me?' },
        { role: 'agent', content: 'Your number is 202-555-0146, correct?' },
        { role: 'user', content: 'Yes.' },
    ]), null);
    const corrected = extractEvanConsentedGuestLead([
        ...goodTurns,
        { role: 'user', content: 'Actually my email is jordan.new@example.com.' },
    ]);
    assert.equal(corrected?.email, null);
    assert.equal(corrected?.phone, '2025550146');
});

test('live guest wording captures consent after natural readbacks without creating a visitor recap', () => {
    const turns = [
        { role: 'agent', content: 'Do you want to share a name and callback number in case the team needs to reach you?' },
        { role: 'user', content: 'Sure. Jordan Avery.' },
        { role: 'user', content: 'Phone number 202-555-0146.' },
        { role: 'agent', content: 'Got it, Jordan Avery, two oh two… five five five… oh one four six. Did I get that right?' },
        { role: 'user', content: "Yes, that's right." },
        { role: 'agent', content: "Is there an email address you'd like to use for any follow-up?" },
        { role: 'user', content: "Yeah, it's jordan.avery@example.com." },
        { role: 'agent', content: "That's" },
        { role: 'user', content: "But if that isn't needed here, that's fine." },
        { role: 'agent', content: 'Let me repeat it: jordan dot avery at example dot com. Did I get that right?' },
        { role: 'user', content: "Yes, that's perfect." },
        { role: 'agent', content: "Is there anything else on the move you'd like to cover before we wrap up" },
        { role: 'user', content: 'Could someone might be able to call me tomorrow about an estimate?' },
    ];
    assert.deepEqual(extractEvanConsentedGuestLead(turns), {
        displayName: 'Jordan Avery', nameForReview: null, phone: '2025550146', email: 'jordan.avery@example.com',
        requestedFollowUp: true, callbackWindow: 'tomorrow',
    });
    assert.equal(extractEvanConsentedGuestLead([
        ...turns.slice(0, 4), { role: 'user', content: "Yes, but that's wrong." },
        ...turns.slice(5, 10), { role: 'user', content: "Yes, but that email is wrong." },
        ...turns.slice(11),
    ]), null, 'qualified or corrected readbacks are not confirmation');
});

test('actual compound guest contact reply preserves confirmed channels and marks an un-read-back surname for review', () => {
    const turns = [
        { role: 'agent', content: 'If you share a name, callback number, and email, I can gather that request for possible follow-up.' },
        { role: 'user', content: "Sure, Jordan Avery, phone number 202-555-0146, email jordan.avery@example.com. But if that isn't needed here, that's fine." },
        { role: 'agent', content: 'Thanks, Jordan. Let me make sure I got those right. Phone: two oh two, five five five, oh one four six. Email: jordan dot avery at example dot com. Did I get that right?' },
        { role: 'user', content: "Yes, that's right, for the phone. And yes, that's perfect for the email." },
        { role: 'user', content: 'Could somebody call me tomorrow?' },
    ];
    const lead = extractEvanConsentedGuestLead(turns);
    assert.deepEqual(lead, {
        displayName: null, nameForReview: 'Jordan Avery', phone: '2025550146',
        email: 'jordan.avery@example.com', requestedFollowUp: true, callbackWindow: 'tomorrow',
    });
    const brief = buildEvanGuestLeadBrief({ externalSessionId: 'fictional-retest', lead, turns });
    assert.match(brief.text, /Name shared, needs confirmation: Jordan Avery/);
    assert.match(brief.text, /Email: jordan\.avery@example\.com/);
    assert.match(brief.text, /Details marked for review were shared by the visitor but not read back and confirmed/i);
    assert.equal(extractEvanConsentedGuestLead([...turns, { role: 'user', content: 'Forget my name.' }])?.nameForReview, null);
    const withoutInvitation = extractEvanConsentedGuestLead(turns.slice(1));
    assert.equal(withoutInvitation?.email, null, 'a bare email label without the invitation is not authoritative');
    assert.equal(withoutInvitation?.nameForReview, null);
});

test('run-43 direct callback request and volunteered contact bundle qualify for exactly one internal brief', () => {
    assert.deepEqual(extractEvanConsentedGuestLead(run43Turns), {
        displayName: 'Jordan Avery', nameForReview: null, phone: '2025550146',
        email: 'jordan.avery@example.com', requestedFollowUp: true, callbackWindow: 'tomorrow',
    });
    assert.equal(extractEvanConsentedGuestLead(run43Turns.slice(1))?.displayName, 'Jordan Avery',
        'the explicit visitor offer still requests possible follow-up');
    assert.equal(extractEvanConsentedGuestLead(run43Turns.slice(0, 4)), null,
        'contact readback without visitor confirmation cannot send');
});

test('split visitor contact details require the adjacent offer and later spoken confirmation', () => {
    const split = [
        run43Turns[0], run43Turns[1],
        { role: 'user', content: "I'm happy to leave my info for a possible follow up." },
        { role: 'user', content: 'Jordan Avery, phone 2025550146, email jordan.avery@example.com.' },
        run43Turns[3], run43Turns[4],
    ];
    assert.deepEqual(extractEvanConsentedGuestLead(split), {
        displayName: 'Jordan Avery', nameForReview: null, phone: '2025550146',
        email: 'jordan.avery@example.com', requestedFollowUp: true, callbackWindow: 'tomorrow',
    });
    assert.equal(extractEvanConsentedGuestLead([
        ...split.slice(0, 3), { role: 'agent', content: 'What size is the home?' }, ...split.slice(3),
    ]), null, 'intervening agent speech does not carry the contact offer');
});

test('run-44 internal brief labels volunteered name and email for review while keeping phone confirmed', () => {
    const turns = [
        { role: 'user', content: 'Okay, thanks. Could someone call tomorrow about an estimate?' },
        { role: 'agent', content: "I can't schedule a call, but I can pass along a request for an estimate. What's the best number to reach you at?" },
        { role: 'user', content: 'Sure, uh Jordan Avery, phone number 202-555-0146, email jordan.avery@example.com.' },
        { role: 'agent', content: 'Thanks, Jordan. Let me make sure I have that right: 2-0-2, 5-5-5, 0-1-4-6. Did I get that right?' },
        { role: 'user', content: "Yes, that's right." },
        { role: 'agent', content: "To make sure they can reach you, I'll need your email — can you give me that?" },
        { role: 'user', content: "Yeah, it's jordan.avery@example.com, but if that isn't needed here, that's fine." },
    ];
    const lead = extractEvanConsentedGuestLead(turns);
    assert.deepEqual(lead, {
        displayName: null, nameForReview: 'Jordan Avery', phone: '2025550146', email: null,
        emailForReview: 'jordan.avery@example.com', requestedFollowUp: true, callbackWindow: 'tomorrow',
    });
    const brief = buildEvanGuestLeadBrief({ externalSessionId: 'fictional-run44', lead, turns });
    assert.match(brief.text, /Name shared, needs confirmation: Jordan Avery/);
    assert.match(brief.text, /Email shared, needs confirmation: jordan\.avery@example\.com/);
    assert.match(brief.text, /Email: Not verbally confirmed/);
    assert.doesNotMatch(brief.text, /Phone and email values shown above were.*verbally confirmed/);
    assert.equal(extractEvanConsentedGuestLead(turns.slice(2)), null, 'a bare bundle cannot create follow-up consent');
});

test('a voluntarily shared guest email sends one visitor recap and two internal briefs, idempotently', async () => {
    const env = {
        AMY_ANAM_SESSION_SPINE_ENABLED: 'true', AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_SESSION_SECRET: 's'.repeat(48),
        AMY_ANAM_REDIS_REST_URL: 'https://redis.test', AMY_ANAM_REDIS_REST_TOKEN: 'r'.repeat(32),
        AGENTMAIL_API_KEY: 'a'.repeat(32), EVAN_AGENTMAIL_ADDRESS: 'hermes-hal@agentmail.to',
        EVAN_GUEST_DEMO_LEAD_ENABLED: 'true', VERCEL_ENV: 'preview',
        EVAN_ANAM_AGENTMAIL_ENABLED: 'true', EVAN_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
        EVAN_ANAM_TOOLS_ENABLED: 'true', EVAN_ANAM_TOOLS_KILL_SWITCH: 'false',
        EVAN_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true', EVAN_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
    };
    const redis = new Map();
    const sent = [];
    const fetchImpl = async (url, init = {}) => {
        if (String(url) === 'https://redis.test/pipeline') {
            const [[operation, key, value, mode]] = JSON.parse(String(init.body));
            let result = null;
            if (operation === 'SET') {
                if ((mode === 'NX' && !redis.has(key)) || (mode === 'XX' && redis.has(key))) { redis.set(key, value); result = 'OK'; }
            } else if (operation === 'GET') result = redis.get(key) ?? null;
            return new Response(JSON.stringify([{ result }]), { status: 200 });
        }
        if (String(url).includes('/messages/send')) {
            sent.push(JSON.parse(String(init.body)));
            return new Response(JSON.stringify({ message_id: 'demo-message-1', thread_id: 'demo-thread-1' }), { status: 200 });
        }
        throw new Error('Unexpected endpoint');
    };
    const input = {
        session: { externalSessionId: 'demo-session', browserSessionId: 'browser-session' },
        receipt: { externalSessionId: 'demo-session' }, turns: goodTurns,
    };
    const first = await dispatchEvanAnamPostSessionFollowUp(input, { env, fetchImpl });
    const second = await dispatchEvanAnamPostSessionFollowUp(input, { env, fetchImpl });
    assert.equal(first.status, 'email_sent');
    assert.equal(second.status, 'email_already_attempted');
    assert.equal(sent.length, 3);
    assert.deepEqual(sent.map(message => message.to[0]), [
        'aifusionlabs@gmail.com', 'aifusionlabs@gmail.com', 'jordan.avery@example.com',
    ]);
    assert.match(sent[0].subject, /EVAN SESSION/);
    assert.match(sent[1].subject, /ACTION/);
    assert.match(sent[2].subject, /Thank you for speaking with Evan/);
    assert.match(sent[2].text, /internal briefs went to AI Fusion Labs.*not to Mullins Moving/i);
    assert.equal(sent[0].attachments.length, 1);
    assert.equal('attachments' in sent[1], false);
    assert.equal('attachments' in sent[2], false);
    const repairedRun = await dispatchEvanAnamPostSessionFollowUp({
        ...input, session: { ...input.session, externalSessionId: 'run-43-replay' },
        receipt: { externalSessionId: 'run-43-replay' }, turns: run43Turns,
    }, { env, fetchImpl });
    assert.equal(repairedRun.status, 'email_sent');
    assert.equal(sent.length, 6);
    assert.deepEqual(sent[5].to, ['jordan.avery@example.com']);
    const production = await dispatchEvanAnamPostSessionFollowUp({
        ...input, session: { ...input.session, externalSessionId: 'production-session' },
        receipt: { externalSessionId: 'production-session' },
    }, { env: { ...env, VERCEL_ENV: 'production' }, fetchImpl });
    assert.equal(production.sent, false);
    assert.equal(sent.length, 6, 'production without Mullins recipients cannot promise handoff');
    const phoneOnly = await dispatchEvanAnamPostSessionFollowUp({
        ...input, session: { ...input.session, externalSessionId: 'phone-only-session' },
        receipt: { externalSessionId: 'phone-only-session' }, turns: goodTurns.slice(0, 9),
    }, { env, fetchImpl });
    assert.equal(phoneOnly.status, 'demo_lead_sent');
    assert.equal(sent.length, 7);
    assert.deepEqual(sent[6].to, ['aifusionlabs@gmail.com']);
    assert.match(sent[6].subject, /EVAN DEMO LEAD/);
    const declinedEmail = await dispatchEvanAnamPostSessionFollowUp({
        ...input, session: { ...input.session, externalSessionId: 'no-email-session' },
        receipt: { externalSessionId: 'no-email-session' },
        turns: [...goodTurns, { role: 'user', content: "Don't email me a recap, but the team may call me." }],
    }, { env, fetchImpl });
    assert.equal(declinedEmail.status, 'demo_lead_sent');
    assert.equal(sent.length, 8);
    assert.deepEqual(sent[7].to, ['aifusionlabs@gmail.com']);
});

test('volunteered email needs no extra consent or callback request, but declining email suppresses the recap', () => {
    const volunteered = [
        { role: 'agent', content: 'What is the best way to reach you?' },
        { role: 'user', content: 'My name is Jordan Avery, phone 202-555-0146, and my email is jordan.avery@example.com.' },
    ];
    assert.deepEqual(extractEvanGuestRecapRecipient(volunteered), {
        email: 'jordan.avery@example.com', displayName: 'Jordan Avery', confirmedByReadback: false,
    });
    assert.equal(extractEvanGuestRecapRecipient([...volunteered, { role: 'user', content: "Don't email me a recap." }]), null);
    assert.equal(extractEvanGuestRecapRecipient([
        { role: 'agent', content: 'Your email is jordan.avery@example.com, right?' },
        { role: 'user', content: 'Yes.' },
    ]), null, 'Evan cannot invent the recipient');
    assert.equal(extractEvanGuestRecapRecipient([
        ...volunteered, { role: 'user', content: 'Actually, my email is jordan.new@example.com.' },
    ])?.email, 'jordan.new@example.com', 'a later visitor correction replaces the old address');
    assert.equal(extractEvanGuestRecapRecipient([
        ...volunteered, { role: 'user', content: 'My email is not jordan.avery@example.com; it is jordan.new@example.com.' },
    ])?.email, 'jordan.new@example.com', 'a negated old address is never reused');
    assert.equal(extractEvanGuestRecapRecipient([
        ...volunteered, { role: 'user', content: 'My email is not jordan.avery@example.com.' },
    ]), null, 'a rejected address cannot receive the recap');
});
