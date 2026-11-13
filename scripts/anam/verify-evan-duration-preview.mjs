import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createWebsiteClient } from './smoke-evan-website.mjs';
import { EVAN_DEMO_SOURCE_PERSONA_ID, EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID } from '../../lib/anam/evan-demo-persona.ts';

const preview = JSON.parse(readFileSync('.vercel/evan-duration-preview.json', 'utf8'));
const target = new URL(preview.url);
if (preview.environment !== 'amy-ceo-rehearsal' || !/^x-agent-website-[a-z0-9]+-robs-projects-e72bad73\.vercel\.app$/.test(target.hostname)) throw new Error('Only immutable rehearsal URLs are allowed');
const share = new URL(process.env.EVAN_PREVIEW_SHARE_URL);
if (share.origin !== target.origin || !share.searchParams.has('_vercel_share')) throw new Error('Exact approved preview share link required');
const { code } = JSON.parse(readFileSync('.vercel/evan-duration-private-access.json', 'utf8'));
const client = createWebsiteClient(target);
const results = [];
try {
    const response = await client.request('Preview sign-in', share, { allowRedirects: true });
    assert.equal(response.ok, true); await response.body?.cancel();
    const publicMode = await client.json('Public policy', '/api/anam/evan/demo-access');
    assert.equal(publicMode.mode, 'public'); assert.equal(publicMode.maxSeconds, 180); assert.equal(publicMode.aiflDemoRecaps, true);
    const wrong = await client.request('Wrong private code', '/api/anam/evan/demo-access', { method: 'POST', body: { code: 'invalid-preview-test-code' } });
    assert.equal(wrong.status, 403); await wrong.body?.cancel();
    results.push('Public180, AIFL-only disclosure, wrong-code403');
    await client.json('Guest check-in', '/api/anam/evan/access', { method: 'POST', body: { guest: true } });
    const meeting = await client.request('Public meeting denied', '/api/anam/evan/meetings', { method: 'POST', body: {} });
    assert.equal(meeting.status, 401); await meeting.body?.cancel();
    for (const [mode, seconds, id] of [['public', 180, EVAN_DEMO_PUBLIC_PERSONA_ID], ['extended', 1800, EVAN_DEMO_EXTENDED_PERSONA_ID]]) {
        if (mode === 'extended') {
            const unlocked = await client.json('Unlock private demo', '/api/anam/evan/demo-access', { method: 'POST', body: { code } });
            assert.equal(unlocked.maxSeconds, 1800);
            const status = await client.json('Private cookie round trip', '/api/anam/evan/demo-access');
            assert.equal(status.mode, mode);
        }
        const token = await client.json(`${mode} duration token`, '/api/anam-token', { method: 'POST', body: {
            personaId: EVAN_DEMO_SOURCE_PERSONA_ID,
            // Caller-supplied attempts to extend the public cap must be ignored.
            maxSeconds: 86400, mode: 'extended',
        } });
        assert.deepEqual(token.demoPolicy, { mode, maxSeconds: seconds });
        assert.equal(token.evanCaptureEnabled, true);
        assert.equal(token.sessionSpineEnabled, true);
        assert.ok(typeof token.sessionToken === 'string' && token.sessionToken.trim(), 'Nonempty provider token required');
        assert.ok(typeof token.launchId === 'string' && token.launchId.trim(), 'Session-bound launch reservation required');
        // Inspect only if Anam exposes config in its signed token. Never print
        // or persist the token, launch ID, cookies or private access code.
        let configVerified = false;
        try {
            const payload = JSON.parse(Buffer.from(token.sessionToken.split('.')[1], 'base64url').toString());
            if (payload.personaConfig?.personaId) {
                assert.equal(payload.personaConfig.personaId, id);
                configVerified = true;
            }
        } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
        results.push(`${mode} token policy ${seconds}s; capture on; nonempty token and tracked launch; embedded persona verified=${configVerified}`);
        token.sessionToken = ''; token.launchId = '';
    }
    await client.json('Remove private grant', '/api/anam/evan/demo-access', { method: 'DELETE' });
    assert.equal((await client.json('Public restored', '/api/anam/evan/demo-access')).mode, 'public');
    results.push('Private grant removed; public policy restored');
    const receipt = { url: target.origin, verifiedAt: new Date().toISOString(), results, engineStarted: false, emailSent: false, productionChanged: false };
    writeFileSync('.vercel/evan-duration-verification.json', JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt, null, 2));
} finally {
    await client.json('Remove private test grant', '/api/anam/evan/demo-access', { method: 'DELETE' }).catch(() => undefined);
    await client.json('Remove test check-in', '/api/anam/evan/access', { method: 'DELETE' }).catch(() => undefined);
    client.clear();
}
