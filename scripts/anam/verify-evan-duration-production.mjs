// Access/token verification only. Never starts an engine, sends email, deploys,
// changes protection, or modifies environment settings. Importing is side-effect free.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createWebsiteClient } from './smoke-evan-website.mjs';
import {
    EVAN_DEMO_SOURCE_PERSONA_ID, EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID,
} from '../../lib/anam/evan-demo-persona.ts';

const LIVE_ORIGIN = 'https://xagent.aifusionlabs.app';
const ACCESS = '/api/anam/evan/access';
const POLICY = '/api/anam/evan/demo-access';
const PRIVATE_TOKEN = '/api/anam/evan/extended/token';
const IMMUTABLE_HOST = /^x-agent-website-[a-z0-9]+-robs-projects-e72bad73\.vercel\.app$/;
const root = fileURLToPath(new URL('../../', import.meta.url));
const stageReceiptPath = path.join(root, '.vercel/evan-duration-production-stage.json');
const stageVerificationPath = path.join(root, '.vercel/evan-duration-production-verification.json');

class VerificationFailure extends Error {
    constructor(stage) { super(`Verification failed at ${stage}; response details redacted.`); this.stage = stage; }
}
function expect(condition, stage) { if (!condition) throw new VerificationFailure(stage); }
function fields(payload, expected, stage) {
    expect(payload && typeof payload === 'object' && !Array.isArray(payload), stage);
    for (const [key, value] of Object.entries(expected)) expect(payload[key] === value, stage);
    expect(!Object.hasOwn(payload, 'email') && !Object.hasOwn(payload, 'emailIdentityHash'), stage);
}

export function productionVerificationTarget(receipt, { live = false, stageVerification } = {}) {
    expect(receipt?.environment === 'production' && receipt.skipDomain === true, 'stage-authority');
    expect(typeof receipt.sourceCommit === 'string' && /^[a-f0-9]{40}$/i.test(receipt.sourceCommit), 'stage-source');
    expect(typeof receipt.deploymentId === 'string' && /^dpl_[A-Za-z0-9]+$/.test(receipt.deploymentId), 'stage-deployment');
    let immutable;
    try { immutable = new URL(receipt.url); } catch { throw new VerificationFailure('stage-url'); }
    expect(immutable.protocol === 'https:' && IMMUTABLE_HOST.test(immutable.hostname)
        && !immutable.port && !immutable.username && !immutable.password && !immutable.search
        && !immutable.hash && immutable.pathname === '/', 'stage-url');
    if (live) {
        expect(receipt.promoted === true && receipt.productionOrigin === LIVE_ORIGIN
            && typeof receipt.promotedAt === 'string' && Number.isFinite(Date.parse(receipt.promotedAt)), 'promotion-authority');
        expect(stageVerification?.passed === true && stageVerification.mode === 'stage'
            && stageVerification.url === immutable.origin
            && stageVerification.deploymentId === receipt.deploymentId
            && stageVerification.sourceCommit === receipt.sourceCommit
            && stageVerification.engineStarted === false && stageVerification.emailSent === false, 'verified-stage-authority');
    }
    return { target: new URL(live ? LIVE_ORIGIN : immutable.origin), immutableOrigin: immutable.origin };
}

function verifiedShare(value, target) {
    if (!value) return null;
    let share;
    try { share = new URL(value); } catch { throw new VerificationFailure('share-url'); }
    expect(share.protocol === 'https:' && share.origin === target.origin
        && !share.username && !share.password && !share.hash
        && Boolean(share.searchParams.get('_vercel_share')), 'share-origin');
    return share;
}

export async function runProductionDurationVerification({
    receipt, privateCode, live = false, stageVerification, shareUrl, fetchImpl = fetch,
}) {
    const { target, immutableOrigin } = productionVerificationTarget(receipt, { live, stageVerification });
    return runDurationBoundaryVerification({ target, privateCode, shareUrl, fetchImpl, resultInfo: {
        mode: live ? 'live' : 'stage', immutableOrigin, environment: 'production',
        sourceCommit: receipt.sourceCommit, deploymentId: receipt.deploymentId,
    } });
}

// Shared read/launch-reservation checks. Public entry is tested both before and
// after unlocking the private path, using one in-memory browser cookie jar.
export async function runDurationBoundaryVerification({ target, privateCode, shareUrl, fetchImpl = fetch, resultInfo }) {
    const share = verifiedShare(shareUrl, target);
    expect(typeof privateCode === 'string' && privateCode.length >= 32 && privateCode.length <= 256, 'private-code-configuration');
    const client = createWebsiteClient(target, fetchImpl);
    const result = {
        schema: 2, ...resultInfo, url: target.origin,
        verifiedAt: new Date().toISOString(), passed: false, checks: [], tokenReservations: 0,
        engineStarted: false, emailSent: false, productionConfigurationChanged: false,
        limitations: [
            'Checks create at most four short-lived launch reservations and consume access/token rate limits.',
            'No live audio, actual timeout, planner conversation, or email delivery is exercised.',
            'AIFL routing disclosure and email eligibility are checked, not recipient delivery.',
            'Deployment identity is supplied by the release-owner receipt; this script does not query Vercel aliases.',
        ],
    };
    let activeStage = 'initial-policy';
    let accessTouched = false;
    let grantTouched = false;
    const json = async (stage, endpoint, options) => {
        activeStage = stage;
        return client.json(stage, endpoint, options);
    };
    const expectPolicy = (payload, extendedAccess, stage) => fields(payload, {
        mode: 'public', maxSeconds: 180, extendedAccess, aiflDemoRecaps: true,
    }, stage);
    async function denyPrivate(stage) {
        activeStage = stage;
        const response = await client.request(stage, PRIVATE_TOKEN, {
            method: 'POST', body: { personaId: EVAN_DEMO_SOURCE_PERSONA_ID },
        });
        try { expect(response.status === 403, stage); } finally { await response.body?.cancel(); }
        result.checks.push({ check: stage, passed: true });
    }
    async function checkIn(lane) {
        const stage = `${lane}-check-in`;
        const email = lane === 'email';
        const expected = { authenticated: true, guest: !email, followUpAuthorized: email,
            secureEmailCaptured: email, rawEmailReturned: false, emailFollowUpAvailable: true };
        accessTouched = true;
        const body = email ? { displayName: 'Evan Release Verification', email: 'evan-release-check@example.com', followUpConsent: true }
            : { guest: true };
        fields(await json(stage, ACCESS, { method: 'POST', body }), expected, stage);
        fields(await json(`${lane}-cookie-round-trip`, ACCESS), expected, `${lane}-cookie-round-trip`);
    }
    async function logout(lane) {
        await json(`${lane}-logout`, ACCESS, { method: 'DELETE' });
        fields(await json(`${lane}-logout-round-trip`, ACCESS), { authenticated: false, rawEmailReturned: false }, `${lane}-logout-round-trip`);
        accessTouched = false;
    }
    async function tokenCheck(mode, email, tamper = false, suffix = '') {
        const stage = `${mode}-${email ? 'email' : 'guest'}-token${suffix}`;
        const expectedId = mode === 'public' ? EVAN_DEMO_PUBLIC_PERSONA_ID : EVAN_DEMO_EXTENDED_PERSONA_ID;
        let token;
        try {
            const endpoint = mode === 'extended' ? PRIVATE_TOKEN : '/api/anam-token';
            token = await json(stage, `${endpoint}${tamper ? '?mode=extended&maxSeconds=86400' : ''}`, {
                method: 'POST', body: { personaId: EVAN_DEMO_SOURCE_PERSONA_ID,
                    ...(tamper ? { mode: 'extended', maxSeconds: 86400, providerPersonaId: EVAN_DEMO_EXTENDED_PERSONA_ID } : {}) },
            });
            result.tokenReservations++;
            fields(token, { sessionSpineEnabled: true, evanCaptureEnabled: true, agentMailAvailable: email,
                evanGuestEmailAvailable: true, evanMullinsHandoffConfigured: false,
                rawEmailReturned: false, identityHashReturned: false }, stage);
            fields(token.demoPolicy, { mode, maxSeconds: mode === 'public' ? 180 : 1800 }, `${stage}-duration`);
            expect(typeof token.sessionToken === 'string' && Boolean(token.sessionToken.trim())
                && typeof token.launchId === 'string' && Boolean(token.launchId.trim()), `${stage}-reservation`);
            let embeddedPersonaVerified = false;
            // Opaque provider tokens are valid. If an inspectable configuration
            // is present, reject a mismatched clone without printing the payload.
            let claims;
            try { claims = JSON.parse(Buffer.from(token.sessionToken.split('.')[1], 'base64url').toString()); } catch { /* opaque token */ }
            if (claims?.personaConfig?.personaId) {
                expect(claims.personaConfig.personaId === expectedId, `${stage}-provider-copy`);
                embeddedPersonaVerified = true;
            }
            result.checks.push({ check: stage, passed: true, embeddedPersonaVerified });
        } finally {
            if (token) { token.sessionToken = ''; token.launchId = ''; }
        }
    }
    try {
        if (share) {
            activeStage = 'deployment-share-access';
            const response = await client.request(activeStage, share, { allowRedirects: true });
            try { expect(response.ok, activeStage); } finally { await response.body?.cancel(); }
        }
        expectPolicy(await json('initial-policy', POLICY), false, 'initial-policy');
        fields(await json('initial-check-in-status', ACCESS), { authenticated: false, optional: true, rawEmailReturned: false }, 'initial-check-in-status');
        activeStage = 'wrong-private-code';
        grantTouched = true;
        const denied = await client.request(activeStage, POLICY, { method: 'POST', body: { code: 'invalid-production-verification-code' } });
        try { expect(denied.status === 403, activeStage); } finally { await denied.body?.cancel(); }
        expectPolicy(await json('wrong-code-remains-public', POLICY), false, 'wrong-code-remains-public');
        await json('remove-invalid-grant', POLICY, { method: 'DELETE' });
        grantTouched = false;
        result.checks.push({ check: 'public-180-aifl-disclosure-wrong-code-403', passed: true });

        await checkIn('guest');
        await denyPrivate('private-without-grant-denied');
        activeStage = 'public-external-meeting-denied';
        const meeting = await client.request(activeStage, '/api/anam/evan/meetings', { method: 'POST', body: {} });
        try { expect(meeting.status === 401, activeStage); } finally { await meeting.body?.cancel(); }
        result.checks.push({ check: activeStage, passed: true });
        await tokenCheck('public', false, true);
        await logout('guest');

        await checkIn('email');
        await tokenCheck('public', true);
        await logout('email');

        grantTouched = true;
        fields(await json('private-code-unlock', POLICY, { method: 'POST', body: { code: privateCode } }), { mode: 'extended', maxSeconds: 1800 }, 'private-code-unlock');
        expectPolicy(await json('private-cookie-round-trip', POLICY), true, 'private-cookie-round-trip');
        await checkIn('private-guest');
        await tokenCheck('extended', false);
        await tokenCheck('public', false, true, '-with-private-grant');
        expectPolicy(await json('public-visit-preserves-private-grant', POLICY), true, 'public-visit-preserves-private-grant');
        await json('private-grant-removal', POLICY, { method: 'DELETE' });
        expectPolicy(await json('public-policy-restored', POLICY), false, 'public-policy-restored');
        grantTouched = false;
        await denyPrivate('private-after-revocation-denied');
        await logout('private-guest');
        result.checks.push({ check: 'private-1800-public-restoration-and-all-logouts', passed: true });
        result.passed = true;
    } catch (error) {
        result.failureStage = error instanceof VerificationFailure ? error.stage : activeStage;
        result.failure = 'Stopped at first failed boundary; response details redacted.';
    } finally {
        // Only cleanup is allowed after a failure; no later test lane is attempted.
        const cleanupFailures = [];
        if (grantTouched) {
            try { await client.json('cleanup-private-grant', POLICY, { method: 'DELETE' }); }
            catch { cleanupFailures.push('private-grant'); }
        }
        if (accessTouched) {
            try { await client.json('cleanup-check-in', ACCESS, { method: 'DELETE' }); }
            catch { cleanupFailures.push('check-in'); }
        }
        client.clear();
        result.localCookiesDiscarded = true;
        result.serverCleanupConfirmed = cleanupFailures.length === 0;
        if (cleanupFailures.length) {
            result.passed = false;
            result.failureStage ??= 'cleanup';
            result.cleanupFailures = cleanupFailures;
        }
    }
    return result;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
        console.log('Usage: node scripts/anam/verify-evan-duration-production.mjs [--live]');
        console.log('Default: verify the exact production --skip-domain stage receipt. --live requires matching verified-stage and promotion receipts.');
        console.log('Optional EVAN_PREVIEW_SHARE_URL must match the exact target origin. No engine, email, deployment, or protection change.');
        return;
    }
    expect(args.length === 0 || args.length === 1 && args[0] === '--live', 'arguments');
    const live = args[0] === '--live';
    const receipt = JSON.parse(readFileSync(stageReceiptPath, 'utf8'));
    const stageVerification = live ? JSON.parse(readFileSync(stageVerificationPath, 'utf8')) : undefined;
    const { code } = JSON.parse(readFileSync(path.join(root, '.vercel/evan-duration-private-access.json'), 'utf8'));
    const result = await runProductionDurationVerification({ receipt, privateCode: code, live, stageVerification,
        shareUrl: process.env.EVAN_PREVIEW_SHARE_URL });
    const output = live ? path.join(root, '.vercel/evan-duration-live-verification.json') : stageVerificationPath;
    writeFileSync(output, JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(`FAIL ${error instanceof VerificationFailure ? error.message : 'Production verification setup failed; details redacted.'}`);
        process.exitCode = 1;
    });
}
