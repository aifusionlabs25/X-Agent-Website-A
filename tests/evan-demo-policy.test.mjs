import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    createEvanDemoGrant, EVAN_DEMO_COOKIE, EVAN_DEMO_GRANT_SECONDS,
    EVAN_EXTENDED_DEMO_SECONDS, EVAN_PUBLIC_DEMO_SECONDS,
    hasEvanDemoGrant, isEvanDemoPolicy, resolveEvanDemoPolicy, verifyEvanDemoAccessCode,
} from '../lib/anam/evan-demo-policy.ts';
import { createEvanDemoClock, formatEvanDemoTime, isEvanDemoDeadlineClose } from '../lib/anam/evan-demo-clock.ts';
import { isUnexpectedEvanClose } from '../lib/anam/evan-unexpected-close.ts';

const origin = 'https://evan-preview.example';
const publicId = '11111111-1111-4111-8111-111111111111';
const extendedId = '22222222-2222-4222-8222-222222222222';
const secret = 'fictional-local-test-secret-at-least-32-characters';
const env = {
    EVAN_EXTENDED_DEMO_ACCESS_KEY: secret,
    EVAN_PUBLIC_DEMO_PERSONA_ID: publicId,
    EVAN_EXTENDED_DEMO_PERSONA_ID: extendedId,
};
function request(token, url = `${origin}/api/anam-token`, init = {}) {
    return new Request(url, {
        ...init,
        headers: { ...init.headers, ...(token ? { cookie: `unrelated=1; ${EVAN_DEMO_COOKIE}=${token}; another=2` } : {}) },
    });
}
function signedGrant(value) {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${payload}.${createHmac('sha256', secret).update(`evan-demo:v1:${payload}`).digest('base64url')}`;
}

test('extended access requires an exact sufficiently strong configured code', () => {
    assert.equal(verifyEvanDemoAccessCode(secret, env), true);
    for (const value of ['', 'wrong', `${secret} `, null, 123, 'a'.repeat(257)]) {
        assert.equal(verifyEvanDemoAccessCode(value, env), false);
    }
    assert.equal(verifyEvanDemoAccessCode('short', { EVAN_EXTENDED_DEMO_ACCESS_KEY: 'short' }), false);
    assert.throws(() => createEvanDemoGrant(origin, {}), /not configured/);
});

test('a valid grant expires at its one-hour boundary and cannot start in the future', () => {
    const now = 10_000;
    const token = createEvanDemoGrant(origin, env, now);
    assert.equal(hasEvanDemoGrant(request(token), env, now), true);
    assert.equal(hasEvanDemoGrant(request(token), env, now - 1), false);
    assert.equal(hasEvanDemoGrant(request(token), env, now + EVAN_DEMO_GRANT_SECONDS * 1000 - 1), true);
    assert.equal(hasEvanDemoGrant(request(token), env, now + EVAN_DEMO_GRANT_SECONDS * 1000), false);
});

test('grants reject payload or signature tampering, malformed values, and rotation', () => {
    const token = createEvanDemoGrant(origin, env, 10_000);
    const [payload, signature] = token.split('.');
    const alteredPayload = Buffer.from(JSON.stringify({ v: 1, aud: origin, iat: 0, exp: 99_999_999 })).toString('base64url');
    for (const value of ['', '.', `${payload}.invalid`, `${alteredPayload}.${signature}`, `${token}.extra`, 'x'.repeat(2049)]) {
        assert.equal(hasEvanDemoGrant(request(value), env, 10_001), false);
    }
    assert.equal(hasEvanDemoGrant(request(token), { ...env, EVAN_EXTENDED_DEMO_ACCESS_KEY: 'new-independent-secret-at-least-32-chars' }, 10_001), false);
    assert.equal(hasEvanDemoGrant(request(token), {}, 10_001), false);
});

test('grants cannot move to another origin, port, or protocol', () => {
    const token = createEvanDemoGrant(origin, env, 10_000);
    for (const other of ['https://another-preview.example', 'http://evan-preview.example', 'https://evan-preview.example:8443']) {
        assert.equal(hasEvanDemoGrant(request(token, other), env, 10_001), false);
    }
});

test('signed malformed lifetimes and versions still fail policy validation', () => {
    const valid = { v: 1, aud: origin, iat: 10_000, exp: 10_000 + EVAN_DEMO_GRANT_SECONDS * 1000 };
    for (const patch of [{ v: 2 }, { iat: 10_000.5 }, { exp: valid.exp + 1 }, { exp: valid.iat }, { aud: 'https://other.example' }]) {
        assert.equal(hasEvanDemoGrant(request(signedGrant({ ...valid, ...patch })), env, 10_001), false);
    }
});

test('public mode ignores requested duration, mode, and provider identity', () => {
    const input = request(undefined, `${origin}/api/anam-token?mode=extended&maxSeconds=1800`, {
        method: 'POST', body: JSON.stringify({ mode: 'extended', maxSeconds: 1800, providerPersonaId: extendedId }),
    });
    assert.deepEqual(resolveEvanDemoPolicy(input, env), { mode: 'public', maxSeconds: EVAN_PUBLIC_DEMO_SECONDS, providerPersonaId: publicId });
});

test('a private grant cannot upgrade the default public policy', () => {
    const token = createEvanDemoGrant(origin, env);
    for (const url of [`${origin}/api/anam-token`, `${origin}/api/anam-token?mode=extended`, `${origin}/api/anam/evan/extended/token`]) {
        assert.deepEqual(resolveEvanDemoPolicy(request(token, url), env), {
            mode: 'public', maxSeconds: EVAN_PUBLIC_DEMO_SECONDS, providerPersonaId: publicId,
        }, 'the resolver requires explicit trusted server intent, not a URL or cookie alone');
    }
    assert.equal(hasEvanDemoGrant(request(token), env), true, 'reading public policy does not revoke private access');
});

test('only explicit protected intent plus an active grant selects the extended persona', () => {
    const token = createEvanDemoGrant(origin, env);
    assert.deepEqual(resolveEvanDemoPolicy(request(token), env, 'extended'), { mode: 'extended', maxSeconds: EVAN_EXTENDED_DEMO_SECONDS, providerPersonaId: extendedId });
    const expired = createEvanDemoGrant(origin, env, Date.now() - (EVAN_DEMO_GRANT_SECONDS + 10) * 1000);
    assert.equal(resolveEvanDemoPolicy(request(expired), env).mode, 'public');
    for (const input of [request(), request(expired), request(`${token}x`), request(token, 'https://other.example/api/anam-token')]) {
        assert.throws(() => resolveEvanDemoPolicy(input, env, 'extended'), 'private access must fail closed, not downgrade');
    }
    assert.throws(() => resolveEvanDemoPolicy(request(undefined), {}), /not configured/);
    assert.throws(() => resolveEvanDemoPolicy(request(token), { ...env, EVAN_EXTENDED_DEMO_PERSONA_ID: '' }, 'extended'), /not configured/);
});

test('missing private configuration does not affect public mode and no lane falls back to the other copy', () => {
    const token = createEvanDemoGrant(origin, env);
    for (const configuration of ['', undefined, 'invalid']) {
        const withoutPrivate = { ...env, EVAN_EXTENDED_DEMO_PERSONA_ID: configuration };
        assert.equal(resolveEvanDemoPolicy(request(token), withoutPrivate).providerPersonaId, publicId);
        assert.throws(() => resolveEvanDemoPolicy(request(token), withoutPrivate, 'extended'));
        const withoutPublic = { ...env, EVAN_PUBLIC_DEMO_PERSONA_ID: configuration };
        assert.throws(() => resolveEvanDemoPolicy(request(token), withoutPublic));
        assert.equal(resolveEvanDemoPolicy(request(token), withoutPublic, 'extended').providerPersonaId, extendedId);
    }
});

test('mixed public and private tabs can reuse the same grant without changing each other', () => {
    const token = createEvanDemoGrant(origin, env);
    const input = request(token);
    for (const mode of ['extended', 'public', 'extended', 'public']) {
        const policy = resolveEvanDemoPolicy(input, env, mode);
        assert.equal(policy.mode, mode);
        assert.equal(policy.maxSeconds, mode === 'public' ? 180 : 1800);
        assert.equal(hasEvanDemoGrant(input, env), true);
    }
});

test('stored policy validates the exact mode/duration pair', () => {
    for (const mode of ['public', 'extended']) {
        const maxSeconds = mode === 'public' ? 180 : 1800;
        assert.equal(isEvanDemoPolicy({ mode, maxSeconds, providerPersonaId: publicId }), true);
        assert.equal(isEvanDemoPolicy({ mode, maxSeconds: maxSeconds === 180 ? 1800 : 180, providerPersonaId: publicId }), false);
    }
    for (const value of [null, {}, [], { mode: 'public', maxSeconds: 180, providerPersonaId: 'not-an-id' }]) {
        assert.equal(isEvanDemoPolicy(value), false);
    }
});

test('waiting for microphone and connection does not consume the demo clock', () => {
    let now = 0;
    const clock = createEvanDemoClock(180, () => now);
    now = 600_000;
    assert.deepEqual(clock.read(), { remaining: 180, justExpired: false, started: false });
    clock.start();
    assert.deepEqual(clock.read(), { remaining: 180, justExpired: false, started: true });
});

test('repeated connection events never restart the timer', () => {
    let now = 0;
    const clock = createEvanDemoClock(180, () => now);
    clock.start();
    now = 60_000;
    clock.start();
    assert.equal(clock.read().remaining, 120);
    now = 179_999;
    assert.equal(clock.read().remaining, 1);
    now = 180_000;
    assert.deepEqual(clock.read(), { remaining: 0, justExpired: true, started: true });
    clock.start();
    assert.deepEqual(clock.read(), { remaining: 0, justExpired: false, started: true });
});

test('suspended tabs catch up using elapsed time and emit expiry only once', () => {
    let now = 0;
    const clock = createEvanDemoClock(1800, () => now);
    clock.start();
    now = 1_900_000;
    assert.deepEqual(clock.read(), { remaining: 0, justExpired: true, started: true });
    now += 5_000;
    assert.deepEqual(clock.read(), { remaining: 0, justExpired: false, started: true });
});

test('clock accepts only supported limits and formats visible time', () => {
    for (const value of [0, 179, 181, 3600, NaN, Infinity, '180']) assert.throws(() => createEvanDemoClock(value), /Invalid/);
    assert.equal(formatEvanDemoTime(180), '3:00');
    assert.equal(formatEvanDemoTime(1800), '30:00');
    assert.equal(formatEvanDemoTime(9), '0:09');
    assert.equal(formatEvanDemoTime(0), '0:00');
});

test('planned demo expiration does not trigger the unexpected-disconnect view', () => {
    assert.equal(isUnexpectedEvanClose({ isEvan: true, requestedCloseReason: 'demo_time_limit', publicAudioBlocked: false }), false);
    assert.equal(isUnexpectedEvanClose({ isEvan: true, requestedCloseReason: null, publicAudioBlocked: false }), true);
});

test('duration UI preserves Run57 capture, recovery, and contact context wiring', async () => {
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const gate = await readFile(new URL('../components/evan/EvanContactGate.tsx', import.meta.url), 'utf8');
    for (const symbol of ['createEvanCaptureClient', 'createEvanRefusedCloseRecovery', 'createEvanResponseRecovery', 'createEvanExplicitCloseFallback']) {
        assert.ok(player.includes(`${symbol}({`), `${symbol} remains connected`);
    }
    assert.match(player, /evanDemoClock\?\.start\(\)/);
    assert.match(player, /isEvanDemoDeadlineClose\(evanDemoClock\?\.read\(\), reason === ConnectionClosedCode.SERVER_CLOSED_CONNECTION\)/);
    assert.match(player, /requestedCloseReason = 'demo_time_limit'/);
    assert.match(gate, /EvanPlannerContactContext\.Provider value=\{plannerCheckIn\}/);
    assert.match(gate, /setPlannerCheckIn\(mode === 'email'/);
    assert.doesNotMatch(player + gate, /^<{7}|^={7}|^>{7}/m);
    assert.match(gate, /Demo mode: all recap and team emails go to AI Fusion Labs/);
});

test('provider deadline skew is bounded and does not hide early or transport failures', () => {
    assert.equal(isEvanDemoDeadlineClose({ started: true, remaining: 0 }, false), true);
    for (const remaining of [1, 2, 3]) {
        assert.equal(isEvanDemoDeadlineClose({ started: true, remaining }, true), true);
        assert.equal(isEvanDemoDeadlineClose({ started: true, remaining }, false), false);
    }
    for (const remaining of [4, 30, 180]) assert.equal(isEvanDemoDeadlineClose({ started: true, remaining }, true), false);
    assert.equal(isEvanDemoDeadlineClose({ started: false, remaining: 0 }, true), false);
    assert.equal(isEvanDemoDeadlineClose(undefined, true), false);
});
