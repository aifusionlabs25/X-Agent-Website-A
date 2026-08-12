import assert from 'node:assert/strict';
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
Tool (end_amy_session): Result: {"status":"farewell_required"}
Amy: Thanks for talking this through with me. Take care.`;
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
Tool (end_amy_session): Result: {"status":"farewell_required"}
Amy: Thanks for talking this through with me. Take care.`;
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
