import assert from 'node:assert/strict';
import test from 'node:test';
import { previewVerificationTarget, runPreviewDurationVerification } from '../scripts/anam/verify-evan-duration-preview.mjs';
import { productionVerificationTarget, runProductionDurationVerification, verificationAccessCode } from '../scripts/anam/verify-evan-duration-production.mjs';
import { EVAN_DEMO_SOURCE_PERSONA_ID } from '../lib/anam/evan-demo-persona.ts';

const origin = 'https://x-agent-website-unit123-robs-projects-e72bad73.vercel.app';
const preview = { url: origin, environment: 'amy-ceo-rehearsal' };
const privateCode = 'fictional-private-test-code-never-log-this-1234';
const stage = { url: origin, environment: 'production', skipDomain: true,
    sourceCommit: 'a'.repeat(40), deploymentId: 'dpl_unit123' };
const ACCESS = '/api/anam/evan/access';
const POLICY = '/api/anam/evan/demo-access';
const PRIVATE = '/api/anam/evan/extended/token';

function fixture({ expectedCode = privateCode, publicUpgradeBug = false, privatePermissionBug = false, revokedPermissionBug = false, cookieLostBug = false } = {}) {
    const calls = [];
    const issued = [];
    let unlockedOnce = false;
    const json = (payload, status = 200, cookie) => new Response(JSON.stringify(payload), {
        status, headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
    });
    const fetchImpl = async (input, options = {}) => {
        const url = new URL(input);
        const method = options.method ?? 'GET';
        const headers = new Headers(options.headers);
        const cookie = headers.get('cookie') ?? '';
        const grant = /(?:^|; )private=allowed(?:;|$)/.test(cookie);
        const guest = /(?:^|; )visitor=guest(?:;|$)/.test(cookie);
        const email = /(?:^|; )visitor=email(?:;|$)/.test(cookie);
        const body = options.body ? JSON.parse(options.body) : undefined;
        calls.push({ path: url.pathname, method, grant, guest, email });
        assert.ok([ACCESS, POLICY, PRIVATE, '/api/anam-token', '/api/anam/evan/meetings'].includes(url.pathname), 'No engine or email endpoint permitted');
        const identity = () => ({ authenticated: guest || email, guest, followUpAuthorized: email,
            secureEmailCaptured: email, rawEmailReturned: false, emailFollowUpAvailable: true });
        if (url.pathname === POLICY) {
            if (method === 'GET') return json({ mode: 'public', maxSeconds: 180, extendedAccess: grant,
                aiflDemoRecaps: true });
            if (method === 'DELETE') return json({ mode: 'public', maxSeconds: 180 }, 200, 'private=; Path=/; Max-Age=0; Secure; HttpOnly');
            assert.equal(method, 'POST');
            if (body.code !== expectedCode) return json({ error: 'Invalid' }, 403);
            unlockedOnce = true;
            return json({ mode: 'extended', maxSeconds: 1800 }, 200, 'private=allowed; Path=/; Secure; HttpOnly; Max-Age=3600');
        }
        if (url.pathname === ACCESS) {
            if (method === 'DELETE') return json({}, 200, 'visitor=; Path=/; Max-Age=0; Secure; HttpOnly');
            if (method === 'GET') return json({ ...identity(), optional: true });
            assert.equal(method, 'POST');
            const isEmail = body.guest !== true;
            return json({ authenticated: true, guest: !isEmail, followUpAuthorized: isEmail,
                secureEmailCaptured: isEmail, rawEmailReturned: false, emailFollowUpAvailable: true },
            200, `visitor=${isEmail ? 'email' : 'guest'}; Path=/; Secure; HttpOnly`);
        }
        if (url.pathname === '/api/anam/evan/meetings') return json({}, 401);
        assert.equal(method, 'POST');
        assert.equal(body.personaId, EVAN_DEMO_SOURCE_PERSONA_ID);
        assert.ok(guest || email, 'Valid check-in before token boundary');
        if (url.pathname === PRIVATE && !grant) {
            if (privatePermissionBug || revokedPermissionBug && unlockedOnce) return json({}, 200);
            return json({}, 403);
        }
        const extended = url.pathname === PRIVATE || publicUpgradeBug && grant;
        issued.push({ path: url.pathname, extended, grant, email });
        return json({ sessionToken: 'opaque-session-token-do-not-print', launchId: 'launch-do-not-print',
            demoPolicy: { mode: extended ? 'extended' : 'public', maxSeconds: extended ? 1800 : 180 },
            evanCaptureEnabled: true, sessionSpineEnabled: true, agentMailAvailable: email,
            evanGuestEmailAvailable: true, evanMullinsHandoffConfigured: false,
            rawEmailReturned: false, identityHashReturned: false }, 200,
        cookieLostBug && grant && url.pathname === '/api/anam-token' ? 'private=; Path=/; Max-Age=0; Secure; HttpOnly' : undefined);
    };
    return { calls, issued, fetchImpl };
}

test('preview import is side-effect free and target validation rejects production/aliases/arbitrary paths', () => {
    assert.equal(previewVerificationTarget(preview).origin, origin);
    for (const url of ['https://xagent.aifusionlabs.app', origin + '/demo/evan', origin + '?mode=extended',
        origin + '#hash', origin.replace('https:', 'http:'), origin.replace('https://', 'https://user:secret@'),
        origin.replace('.vercel.app', '.vercel.app:4430'), 'https://x-agent-website-a.vercel.app']) {
        assert.throws(() => previewVerificationTarget({ ...preview, url }));
    }
    assert.throws(() => previewVerificationTarget({ ...preview, environment: 'production' }));
});

test('same-cookie preview verifies exactly four reservations, explicit private endpoint, and revocation without calls/emails', async () => {
    const fake = fixture();
    const result = await runPreviewDurationVerification({ preview, privateCode, fetchImpl: fake.fetchImpl });
    assert.equal(result.passed, true);
    assert.equal(result.mode, 'preview');
    assert.equal(result.productionChanged, false);
    assert.equal(result.tokenReservations, 4);
    assert.equal(result.engineStarted, false);
    assert.equal(result.emailSent, false);
    assert.equal(result.serverCleanupConfirmed, true);
    assert.equal(result.localCookiesDiscarded, true);
    assert.deepEqual(fake.issued, [
        { path: '/api/anam-token', extended: false, grant: false, email: false },
        { path: '/api/anam-token', extended: false, grant: false, email: true },
        { path: PRIVATE, extended: true, grant: true, email: false },
        { path: '/api/anam-token', extended: false, grant: true, email: false },
    ]);
    assert.equal(fake.calls.filter(call => call.path === PRIVATE && !call.grant).length, 2);
    const serialized = JSON.stringify(result);
    for (const value of [privateCode, 'opaque-session-token-do-not-print', 'launch-do-not-print', 'private=allowed']) assert.ok(!serialized.includes(value));
});

for (const [bug, stageName, reservationCount] of [
    ['publicUpgradeBug', 'public-guest-token-with-private-grant-duration', 4],
    ['privatePermissionBug', 'private-without-grant-denied', 0],
    ['revokedPermissionBug', 'private-after-revocation-denied', 4],
    ['cookieLostBug', 'public-visit-preserves-private-grant', 4],
]) {
    test(`verification fails closed for ${bug}, cleans up, and stops at that boundary`, async () => {
        const fake = fixture({ [bug]: true });
        const result = await runPreviewDurationVerification({ preview, privateCode, fetchImpl: fake.fetchImpl });
        assert.equal(result.passed, false);
        assert.equal(result.failureStage, stageName);
        assert.equal(result.tokenReservations, reservationCount);
        assert.equal(result.serverCleanupConfirmed, true);
        assert.equal(result.localCookiesDiscarded, true);
        assert.equal(result.engineStarted, false);
        assert.equal(result.emailSent, false);
    });
}

test('mismatched share URL and invalid private code configuration are rejected before network', async () => {
    let calls = 0;
    const fetchImpl = () => { calls++; throw new Error('No calls expected'); };
    await assert.rejects(runPreviewDurationVerification({ preview, privateCode, fetchImpl,
        shareUrl: 'https://different.vercel.app/?_vercel_share=secret' }));
    for (const invalid of ['', 'short', ' Cedar7', 'Cedar7 ', '\tCedar7', 'Cedar7\n', 'a'.repeat(257), null, undefined, 123456]) {
        await assert.rejects(runPreviewDurationVerification({ preview, privateCode: invalid, fetchImpl }));
    }
    assert.equal(calls, 0);
});

test('access receipts preserve the signing secret and prefer only a valid separate access code', () => {
    const legacy = { code: privateCode };
    assert.equal(verificationAccessCode(legacy), privateCode);
    for (const accessCode of ['Cedar7', 'a'.repeat(256)]) {
        const access = { code: privateCode, accessCode };
        assert.equal(verificationAccessCode(access), accessCode);
        assert.equal(access.code, privateCode, 'the signing secret must never be replaced');
    }
    for (const accessCode of ['', 'short', ' Cedar7', 'Cedar7 ', '\tCedar7', 'Cedar7\n', 'a'.repeat(257), null, undefined, 123456]) {
        assert.throws(() => verificationAccessCode({ code: privateCode, accessCode }), /private-code-configuration/,
            'a present but invalid custom code must not fall back to the signing secret');
    }
    for (const access of [null, undefined, [], {}, { code: 'short' }]) {
        assert.throws(() => verificationAccessCode(access), /private-code-configuration/);
    }
});

test('short human code completes the unchanged preview and staged boundary matrix without secret disclosure', async () => {
    const accessCode = 'Cedar7';
    const selected = verificationAccessCode({ code: privateCode, accessCode });
    const previewResult = await runPreviewDurationVerification({ preview, privateCode: selected,
        fetchImpl: fixture({ expectedCode: accessCode }).fetchImpl });
    const stageResult = await runProductionDurationVerification({ receipt: stage, privateCode: selected,
        fetchImpl: fixture({ expectedCode: accessCode }).fetchImpl });
    for (const result of [previewResult, stageResult]) {
        assert.equal(result.passed, true);
        assert.equal(result.tokenReservations, 4);
        assert.equal(result.engineStarted, false);
        assert.equal(result.emailSent, false);
        assert.equal(result.serverCleanupConfirmed, true);
        const serialized = JSON.stringify(result);
        for (const value of [accessCode, privateCode, 'opaque-session-token-do-not-print', 'private=allowed']) {
            assert.ok(!serialized.includes(value));
        }
    }
    const wrongCase = await runPreviewDurationVerification({ preview, privateCode: accessCode.toLowerCase(),
        fetchImpl: fixture({ expectedCode: accessCode }).fetchImpl });
    assert.equal(wrongCase.passed, false, 'the verifier must send the exact code without case normalization');
    assert.equal(wrongCase.failureStage, 'private-code-unlock');
    assert.equal(wrongCase.serverCleanupConfirmed, true);
});

test('production staged and live checks use the same explicit route matrix with strict promotion receipts', async () => {
    const staged = await runProductionDurationVerification({ receipt: stage, privateCode, fetchImpl: fixture().fetchImpl });
    assert.equal(staged.passed, true);
    assert.equal(staged.mode, 'stage');
    assert.equal(staged.tokenReservations, 4);
    assert.throws(() => productionVerificationTarget(stage, { live: true, stageVerification: staged }));
    const promoted = { ...stage, promoted: true, promotedAt: '2026-11-14T18:14:13.835Z', productionOrigin: 'https://xagent.aifusionlabs.app' };
    assert.throws(() => productionVerificationTarget(promoted, { live: true, stageVerification: { ...staged, sourceCommit: 'b'.repeat(40) } }));
    const live = await runProductionDurationVerification({ receipt: promoted, privateCode, live: true,
        stageVerification: staged, fetchImpl: fixture().fetchImpl });
    assert.equal(live.passed, true);
    assert.equal(live.mode, 'live');
    assert.equal(live.url, 'https://xagent.aifusionlabs.app');
    assert.equal(live.tokenReservations, 4);
});
