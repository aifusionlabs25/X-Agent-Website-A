import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AMY_CANONICAL_GREETING, evaluateAmyTranscript } from '../lib/anam/amy-live-qa.ts';

const failedPublicSafetyTranscript = `Session Transcript
Session ID: 210f6317-3c17-4931-bad9-5844a5e7108a
Persona: Amy Insight SDR - Cara 4 Canary

Amy: Hello! What would be most useful for us to discuss today?
User: We have a device refresh funded. Leadership is asking about AI and security is pushing compliance.
Amy: Got it—your goal is to deploy the new devices, pilot an AI solution, and keep everything compliant. How does that line up with the AI proof-of-concept schedule?
User: We don't have the AI pilot scheduled yet. Just interest. The device rollout starts next quarter.
User: We're under CJIS because of law enforcement data and state security standards.
Amy: AI can be part of a CJIS-compliant environment, with data handling, model access, audit logging, and strict access restrictions.
User: We are looking at administrative paperwork, shift scheduling, and staffing reports. Nothing like case files. If we keep it non-sensitive, does that simplify things?
Amy: If the AI only touches non-CJIS administrative data, you can keep it out of the protected domain and apply standard security controls rather than the full CJIS regime.
User: What would you do if you were me?
Amy: If I were in your shoes, I'd run a small, low-risk AI proof-of-concept that automates shift-scheduling and staffing reports, keeping the data strictly non-CJIS. I'd: 1. Define a 10% reduction target. 2. Host the model on-prem or in a private cloud. 3. Start the test in the same quarter as the device rollout. 4. Have security certify the AI tool, its logging, access controls, integration behavior, and user-experience impacts across every affected team and system before calling the approach complete.
User: Show me a visual summary before we wrap.
Tool (show_visual_brief): Result: {"status":"view_rebuilt"}
Amy: The visual brief is now open.
User: That's what I needed. I'll take this forward.
Amy: <end_amy_session
User: Thanks, Amy. Let's call it a day.`;

test('the latest Amy public-safety transcript fails on the observed critical defects', () => {
    const report = evaluateAmyTranscript(failedPublicSafetyTranscript);
    const codes = new Set(report.findings.map((finding) => finding.code));
    assert.equal(report.status, 'fail');
    assert.ok(report.metrics.maximumAssistantWords > 40);
    for (const code of ['greeting_mismatch', 'unsupported_cjis_boundary', 'invented_ai_pilot', 'invented_technical_plan', 'tool_markup_exposed', 'premature_close_attempt', 'missing_end_session_tool']) {
        assert.ok(codes.has(code), `expected ${code}`);
    }
});

test('a concise bounded public-safety conversation passes', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: We have a funded device refresh and leadership is interested in AI, but no pilot is approved.
Amy: Keep the device rollout on its committed track and treat AI as separate discovery. Which administrative burden matters most?
User: Scheduling, but our agency security owner has not validated whether the data is outside CJIS.
Amy: Then the data boundary is still open. I can frame the business decision while your security owner and an Insight public-sector specialist validate it.
User: Thanks, Amy. Let's call it a day.
Tool (end_amy_session): Result: {"status":"closing_motion_and_farewell_required","retryAllowed":false}
Amy: Your security boundary remains open for specialist validation, and the session follow-up will arrive at your private check-in address. Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    assert.equal(report.status, 'pass');
    assert.equal(report.findings.length, 0);
});

test('provider fallback language is a critical live-QA failure even after a successful visual tool call', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: Please show me the visual brief.
Tool (show_visual_brief): Result: {"status":"view_rebuilt"}
Amy: The visual brief is now open. Sorry, I'm having trouble thinking right now.
User: Update it with the staffing scope.
Tool (show_visual_brief): Result: {"status":"view_rebuilt"}
Amy: Sorry, I'm having trouble thinking right now.
User: Let's wrap up.
Tool (end_amy_session): Result: {"status":"closing_motion_and_farewell_required","retryAllowed":false}
Amy: The staffing scope remains subject to validation, and the session follow-up will arrive at your private check-in address. Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    const fallbacks = report.findings.filter((finding) => finding.code === 'provider_fallback_exposed');
    assert.equal(report.status, 'fail');
    assert.equal(fallbacks.length, 2);
    assert.ok(fallbacks.every((finding) => finding.severity === 'critical'));
});

test('spoken email handling and a refused thats-it close are critical live-QA failures', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: My email is R V I C K S at gmail dot com.
Amy: I have R-V-I-C-K-S @ gmail dot com recorded.
User: That's it.
Tool (end_amy_session): Result: {"status":"close_not_requested"}`;
    const report = evaluateAmyTranscript(transcript);
    const codes = new Set(report.findings.map((finding) => finding.code));
    assert.equal(report.status, 'fail');
    assert.ok(codes.has('spoken_email_handling'));
    assert.ok(codes.has('missing_end_session_tool'));
});

test('latest endpoint transcript fails on hard truncation, reasoning leakage, proof substitution, commitments, and closing', async () => {
    const transcript = await readFile(
        new URL('./fixtures/amy-endpoint-truncation-session.txt', import.meta.url),
        'utf8',
    );
    const report = evaluateAmyTranscript(transcript);
    const codes = new Set(report.findings.map((finding) => finding.code));
    assert.equal(report.status, 'fail');
    for (const code of [
        'assistant_interrupted',
        'reasoning_markup_exposed',
        'case_study_visual_substitution',
        'duplicate_visual_confirmation',
        'unsupported_service_commitment',
        'missing_end_session_tool',
    ]) assert.ok(codes.has(code), `expected ${code}`);
});

test('session 3d852e0a regression detects interview drift, retry storms, capability mismatch, unsupported follow-up, and broken close receipts', () => {
    const transcript = `Session Transcript
Session ID: 3d852e0a-8de4-4c2b-869e-09b422044ffb
Persona: Amy Insight SDR - Cara 4 Canary

Amy: ${AMY_CANONICAL_GREETING}
User: I'm Jack, CEO of Insight. I'm evaluating what you can do and how you work. Tell me.
Amy: What's the primary outcome you'd like to achieve with Insight's help?
User: Show me the Insight Intelligence Layer.
Tool (show_visual_brief): Result: {"status":"view_rebuilt"}
Amy: The Visual Brief is open.
User: Show me Cisco product options in the catalog.
Tool (show_solution_catalog): Result: {"status":"failed"}
Tool (show_solution_catalog): Result: {"status":"failed"}
Tool (show_solution_catalog): Result: {"status":"failed"}
Tool (show_solution_catalog): Result: {"status":"failed"}
Tool (show_solution_catalog): Result: {"status":"failed"}
Tool (show_solution_catalog): Result: {"status":"failed"}
Tool (show_solution_catalog): Result: {"status":"failed"}
Amy: An Insight team member will review everything and follow up with you.
User: Close the visual.
Tool (end_amy_session): Result: {"status":"close_not_requested"}
User: Goodbye.
Tool (end_amy_session): Result: {"status":"farewell_required"}
Tool (end_amy_session): Result: {"status":"close_in_progress","retryAllowed":false}
Tool (end_amy_session): Result: {"status":"close_in_progress","retryAllowed":false}
Tool (end_amy_session): Result: {"status":"close_in_progress","retryAllowed":false}
Amy: Thanks for talking this through with me. Take care.
User: Amy, you're still here.
Tool (end_amy_session): Result: {"status":"close_in_progress","retryAllowed":false}`;

    const report = evaluateAmyTranscript(transcript);
    const codes = new Set(report.findings.map((finding) => finding.code));
    assert.equal(report.status, 'fail');
    for (const code of [
        'executive_interview_drift',
        'tool_retry_storm',
        'unsupported_human_followup',
        'visual_capability_mismatch',
        'premature_close_attempt',
        'failed_end_session_receipt',
    ]) assert.ok(codes.has(code), `expected ${code}`);
    assert.equal(report.findings.filter((finding) => finding.code === 'tool_retry_storm').length, 1);
    assert.ok(
        report.findings.some((finding) => finding.code === 'failed_end_session_receipt'
            && /called 6 times/i.test(finding.excerpt ?? '')),
        'the deliberately repeated end calls must be diagnosed as a broken close sequence',
    );
});

test('the one-call soft-close receipt is terminal and requires no second tool call', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: We need a validated security next step by next month.
Amy: I can capture the priority and boundary for the right specialist validation.
User: Thanks, Amy. Let's wrap it here.
Tool (end_amy_session): Result: {"status":"closing_motion_and_farewell_required","retryAllowed":false}
Amy: The security priority remains subject to specialist validation, and your session follow-up will arrive at the private check-in address. Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    assert.equal(report.status, 'pass');
    assert.equal(report.findings.length, 0);
    assert.equal(report.metrics.toolTurns, 1);
});

test('business-progress phrases never become close requests in live QA', () => {
    const continuingTurns = [
        'We need Insight to take care of deployment.',
        'I have to go through our security review.',
        'I need to go over the budget.',
        'We are finished with discovery and ready for the next topic.',
        'We are good for 500 users in phase one.',
        'I am good with the proposed security approach; now discuss cost.',
        'That is all of the data for the first site; next is the second.',
        'We are all set for the pilot requirements; now discuss rollout.',
        'Can your team take care?',
        'Would Insight take care?',
        'The question is whether you can take care.',
        'What happens if I say goodbye?',
        'Can you explain why we should end the call?',
        'Are you saying I have to go?',
        'Why would I end the session?',
        'Do you end the call when I say goodbye?',
        'What happens if I say that is all?',
        'Do you close if I say we are all set?',
        'Are you saying that is it?',
        'Why would I say thanks for your time?',
        'What happens if I say I have to run?',
        'Are you saying we are all set?',
        'The note says take care.',
        'Please say bye Amy.',
        'I have to run diagnostics before we decide.',
        "I'm going to jump off this topic and discuss cost.",
    ];

    for (const userTurn of continuingTurns) {
        const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: ${userTurn}
Amy: Understood. What should we examine next?`;
        const report = evaluateAmyTranscript(transcript);
        assert.equal(report.status, 'pass', userTurn);
        assert.equal(report.findings.length, 0, userTurn);
    }
});

test('ending Amy on business-progress language is a premature close', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: We need Insight to take care of deployment.
Tool (end_amy_session): Result: {"status":"farewell_required","retryAllowed":false}`;
    const report = evaluateAmyTranscript(transcript);
    assert.ok(report.findings.some((finding) => finding.code === 'premature_close_attempt'));
    assert.equal(report.status, 'fail');
});

test('close_in_progress alone is not accepted as a successful terminal receipt', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: Goodbye.
Tool (end_amy_session): Result: {"status":"close_in_progress","retryAllowed":false}`;
    const report = evaluateAmyTranscript(transcript);
    const codes = new Set(report.findings.map((finding) => finding.code));
    assert.equal(report.status, 'fail');
    assert.ok(codes.has('failed_end_session_receipt'));
    assert.ok(codes.has('missing_end_session_tool'));
});

test('an email or identity receipt never authorizes a promised human follow-up', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: Please send my standard recap.
Tool (send_follow_up_email): Result: {"status":"sent"}
Amy: The recap is included. An Insight team member will review it and contact you.
User: Goodbye.
Tool (end_amy_session): Result: {"status":"farewell_required"}
Amy: Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    assert.ok(report.findings.some((finding) => finding.code === 'unsupported_human_followup'));
});

test('a part-number request fails QA if Amy calls any catalog lookup tool', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: Look up Cisco part number C9200L-24P-4G and tell me the live price, inventory, and lead time.
Tool (search_insight_catalog): Result: {"status":"catalog_no_match","retryAllowed":false}
Amy: This demo does not have live catalog data.
User: Goodbye.
Tool (end_amy_session): Result: {"status":"farewell_required"}
Amy: Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    assert.ok(report.findings.some((finding) => finding.code === 'prohibited_live_catalog_lookup'));
    assert.equal(report.status, 'fail');
});

test('the polite no-live-catalog boundary passes without a tool call', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: Look up Cisco SKU C9200L-24P-4G and tell me the live price, inventory, and lead time.
Amy: This demo has no live catalog connection; that requires an approved Insight integration. I can narrow the directional category and capture what needs validation.
User: Goodbye.
Tool (end_amy_session): Result: {"status":"farewell_required"}
Amy: Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    assert.equal(report.status, 'pass');
    assert.equal(report.findings.length, 0);
});

test('a concise bounded executive capability interview passes with the dedicated capability surface', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: I'm Jack, CEO of Insight. I'm evaluating what you can do. Show me the Insight Intelligence Layer.
Tool (show_amy_intelligence): Result: {"status":"amy_intelligence_opened","view":"capabilities","customerArtifact":false,"sessionEnded":false}
Amy: The Amy Intelligence capability overview is open; it shows how I discover, create working views, preserve specialist boundaries, and support follow-up.
User: Thank you, Amy. Goodbye.
Tool (end_amy_session): Result: {"status":"farewell_required"}
Amy: Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    assert.equal(report.status, 'pass');
    assert.equal(report.findings.length, 0);
});

test('latest CEO-demo regressions detect meeting denial, deployment overclaim, unsupported intake claims, and a skipped question', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: I'm Jack, CEO of Insight. How do you work, and can you join a live client meeting?
Amy: At Insight, I'm used for one-to-one website interactions. I can't join live client calls or monitor conversations in real time.
User: What happens with the session afterward?
Amy: Insight gets a record, and the appropriate team can review it and follow up.
User: Is there anything else you'd like to share?
Tool (skip_turn): Result: {"status":"skipped"}
User: I asked whether there is anything else you want to share.
Amy: I can also create conversation-grounded working views.
User: Goodbye.
Tool (end_amy_session): Result: {"status":"farewell_required","retryAllowed":false}
Amy: Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    const codes = new Set(report.findings.map((finding) => finding.code));
    for (const code of [
        'meeting_concierge_capability_denial',
        'demo_deployment_overclaim',
        'unsupported_internal_record',
        'clear_question_skipped',
    ]) assert.ok(codes.has(code), `expected ${code}`);
    assert.equal(report.status, 'fail');
});

test('a truthful Meeting Concierge and follow-up explanation passes', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: I'm evaluating you. Can you join one of our Teams meetings, and what happens afterward?
Amy: This independent demo includes Meeting Concierge, so an organizer can invite me to Teams after private check-in. The standard follow-up goes to your check-in address with configured demo copies; it does not promise human action.
User: Is there anything else you'd like to share?
Amy: I can also organize confirmed conversation facts into working views while keeping architecture, pricing, and commitments with qualified humans.
User: Goodbye.
Tool (end_amy_session): Result: {"status":"farewell_required","retryAllowed":false}
Amy: Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    assert.equal(report.status, 'pass');
    assert.equal(report.findings.length, 0);
});

test('latest CEO transcript regressions detect the missed first question, defensive refusal, false approval, wrong visual, and contact misdirection', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: Hi, Amy. I'm Jack, CEO of Insight. Tell me what you do and why I should care.
Amy: Nice to meet you, Jack.
User: Do you have any questions for me as CEO?
Amy: I can't ask you questions as if I were part of the team.
User: Give me the executive version.
Tool (show_visual_brief): Result: {"status":"view_rebuilt"}
Amy: The executive brief is open.
User: Where does your information come from?
Amy: My curated knowledge base was approved by Insight.
User: Who founded AI Fusion Labs?
Amy: I do not have that detail. Reach out through Insight's channels.
User: Goodbye.
Tool (end_amy_session): Result: {"status":"farewell_required"}
Amy: Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    const codes = new Set(report.findings.map((finding) => finding.code));
    for (const code of [
        'capability_question_unanswered',
        'executive_question_refusal',
        'executive_summary_visual_substitution',
        'insight_approval_overclaim',
        'company_contact_misdirection',
    ]) assert.ok(codes.has(code), `expected ${code}`);
    assert.equal(report.status, 'fail');
});

test('the corrected concise CEO flow passes the final transcript gates', () => {
    const transcript = `Amy: ${AMY_CANONICAL_GREETING}
User: Hi, Amy. I'm Jack, CEO of Insight. Tell me what you do and why I should care.
Tool (show_amy_intelligence): Result: {"status":"amy_intelligence_opened"}
Amy: Good to meet you, Jack. I turn discovery conversations into grounded working briefs, helping specialists spend less time re-qualifying and more time acting.
User: Do you have any questions for me as CEO?
Amy: Which proof would matter most to you: faster qualification, better specialist routing, or a stronger customer experience?
User: Give me the executive version.
Amy: Amy structures early discovery so qualified opportunities reach the right specialist with clearer context and fewer repeated questions.
User: Could a future Salesforce API integration add live CRM access?
Amy: Potentially. An approved backend integration could enable it, while Insight specialists would validate feasibility, permissions, security, governance, and scope.
User: Where does your information come from?
Amy: A curated, public-safe knowledge base prepared for this independent demo, plus facts you confirm in our conversation.
User: Who founded AI Fusion Labs?
Amy: That detail is not in my approved Amy knowledge. The person who shared this demo or an AI Fusion Labs contact can confirm it.
User: Goodbye.
Tool (end_amy_session): Result: {"status":"farewell_required"}
Amy: Thanks for talking this through with me. Take care.`;
    const report = evaluateAmyTranscript(transcript);
    assert.equal(report.status, 'pass');
    assert.equal(report.findings.length, 0);
});
