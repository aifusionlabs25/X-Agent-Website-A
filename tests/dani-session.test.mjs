import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import {
    AMY_ANAM_BROWSER_COOKIE,
    createAmyAnamBrowserSessionWithSecret,
} from '../lib/anam/session-spine.ts';
import {
    createAmyAnamContactToken,
    createDaniAnamContactToken,
    readAmyAnamContactToken,
    readDaniAnamContactToken,
} from '../lib/anam/contact-token.ts';
import {
    DANI_ANAM_BROWSER_COOKIE,
    DANI_ANAM_BROWSER_TTL_SECONDS,
    browserSessionCookieNameForTrustedAgent,
    createDaniAnamBrowserSession,
    createDaniAnamBrowserSessionWithSecret,
    daniAnamSessionCookieOptions,
    deriveDaniAnamContactEncryptionKey,
    readAnamBrowserSessionForTrustedAgent,
    readDaniAnamBrowserSession,
    readDaniAnamSessionSecrets,
} from '../lib/anam/dani-session.ts';

const SESSION_SECRET = 'dani-session-secret-that-is-definitely-at-least-32-chars';
const CONTACT_SECRET = 'dani-contact-secret-that-is-definitely-at-least-32-chars';
const SHARED_AMY_SECRET = 'shared-amy-secret-that-is-definitely-at-least-32-chars';
const NOW = 1_900_000_000_000;
const SIGNING_DOMAIN = 'xagent:dani:anam:browser-session:signing-key:v1';

function requestWithCookies(cookies) {
    return new Request('https://xagent.example.test/api/anam/session/bind', {
        headers: {
            cookie: Object.entries(cookies)
                .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
                .join('; '),
        },
    });
}

function forgeDaniToken(payload, secret = SESSION_SECRET) {
    const key = createHash('sha256')
        .update(`${SIGNING_DOMAIN}\0${secret.trim()}`, 'utf8')
        .digest();
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', key)
        .update(encoded, 'utf8')
        .digest('base64url');
    return `${encoded}.${signature}`;
}

test('Dani session cookie is isolated, HttpOnly, audience-bound, and valid for four hours', () => {
    const { session, token } = createDaniAnamBrowserSessionWithSecret(SESSION_SECRET, NOW);
    const [encoded] = token.split('.');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));

    assert.equal(DANI_ANAM_BROWSER_COOKIE, 'xagent_dani_anam_session');
    assert.equal(session.expiresAt - session.createdAt, DANI_ANAM_BROWSER_TTL_SECONDS * 1_000);
    assert.deepEqual(payload, {
        aud: 'dani',
        exp: session.expiresAt,
        iat: session.createdAt,
        sid: session.id,
        v: 1,
    });
    assert.deepEqual(
        readDaniAnamBrowserSession(
            requestWithCookies({ [DANI_ANAM_BROWSER_COOKIE]: token }),
            SESSION_SECRET,
            NOW + 1,
        ),
        session,
    );

    const cookieOptions = daniAnamSessionCookieOptions();
    assert.equal(cookieOptions.httpOnly, true);
    assert.equal(cookieOptions.sameSite, 'lax');
    assert.equal(cookieOptions.path, '/');
    assert.equal(cookieOptions.priority, 'high');
    assert.equal(cookieOptions.maxAge, DANI_ANAM_BROWSER_TTL_SECONDS);
});

test('Dani session verification rejects tampering, wrong secret, expiry, future issue time, and wrong audience', () => {
    const { session, token } = createDaniAnamBrowserSessionWithSecret(SESSION_SECRET, NOW);
    const [encoded, signature] = token.split('.');
    const changedLastCharacter = signature.endsWith('a') ? 'b' : 'a';
    const tampered = `${encoded}.${signature.slice(0, -1)}${changedLastCharacter}`;
    const request = value => requestWithCookies({ [DANI_ANAM_BROWSER_COOKIE]: value });

    assert.equal(readDaniAnamBrowserSession(request(tampered), SESSION_SECRET, NOW + 1), null);
    assert.equal(readDaniAnamBrowserSession(request(`${token}.extra`), SESSION_SECRET, NOW + 1), null);
    assert.equal(readDaniAnamBrowserSession(request(token), `${SESSION_SECRET}-wrong`, NOW + 1), null);
    assert.equal(readDaniAnamBrowserSession(request(token), SESSION_SECRET, session.expiresAt), null);

    const basePayload = {
        aud: 'dani',
        exp: NOW + DANI_ANAM_BROWSER_TTL_SECONDS * 1_000,
        iat: NOW,
        sid: '11111111-2222-4333-8444-555555555555',
        v: 1,
    };
    const wrongAudience = forgeDaniToken({ ...basePayload, aud: 'amy' });
    const futureIssueTime = forgeDaniToken({
        ...basePayload,
        iat: NOW + 1,
        exp: NOW + 1 + DANI_ANAM_BROWSER_TTL_SECONDS * 1_000,
    });
    const invalidUuid = forgeDaniToken({ ...basePayload, sid: 'not-a-uuid' });

    assert.equal(readDaniAnamBrowserSession(request(wrongAudience), SESSION_SECRET, NOW), null);
    assert.equal(readDaniAnamBrowserSession(request(futureIssueTime), SESSION_SECRET, NOW), null);
    assert.equal(readDaniAnamBrowserSession(request(invalidUuid), SESSION_SECRET, NOW), null);
    assert.throws(
        () => createDaniAnamBrowserSessionWithSecret('too-short', NOW),
        /session secret is not configured/i,
    );
});

test('Dani session and contact secrets are independent env requirements with no Amy fallback', () => {
    const amyOnly = readDaniAnamSessionSecrets({
        AMY_ANAM_SESSION_SECRET: SHARED_AMY_SECRET,
    });
    assert.deepEqual(amyOnly, {
        sessionSecret: '',
        contactSecret: '',
        sessionConfigured: false,
        contactConfigured: false,
        configured: false,
    });

    const sessionOnly = readDaniAnamSessionSecrets({
        DANI_ANAM_SESSION_SECRET: SESSION_SECRET,
    });
    assert.equal(sessionOnly.sessionConfigured, true);
    assert.equal(sessionOnly.contactConfigured, false);
    assert.equal(sessionOnly.configured, false);

    const configured = readDaniAnamSessionSecrets({
        DANI_ANAM_SESSION_SECRET: `\uFEFF${SESSION_SECRET}\\r\\n`,
        DANI_ANAM_CONTACT_SECRET: `${CONTACT_SECRET}\\n`,
    });
    assert.equal(configured.sessionSecret, SESSION_SECRET);
    assert.equal(configured.contactSecret, CONTACT_SECRET);
    assert.equal(configured.configured, true);

    const created = createDaniAnamBrowserSession(NOW, {
        DANI_ANAM_SESSION_SECRET: SESSION_SECRET,
        DANI_ANAM_CONTACT_SECRET: CONTACT_SECRET,
    });
    assert.ok(created.token);
    assert.throws(
        () => createDaniAnamBrowserSession(NOW, { AMY_ANAM_SESSION_SECRET: SHARED_AMY_SECRET }),
        /session secret is not configured/i,
    );
    const contactKey = deriveDaniAnamContactEncryptionKey(CONTACT_SECRET);
    const sessionKeyForSameSecret = createHash('sha256')
        .update(`${SIGNING_DOMAIN}\0${CONTACT_SECRET}`, 'utf8')
        .digest();
    assert.equal(contactKey.length, 32);
    assert.notDeepEqual(contactKey, sessionKeyForSameSecret);
    assert.throws(
        () => deriveDaniAnamContactEncryptionKey('too-short'),
        /contact secret is not configured/i,
    );
});

test('trusted server agent selection never lets Dani fall back to the shared Amy cookie', () => {
    const dani = createDaniAnamBrowserSessionWithSecret(SESSION_SECRET, NOW);
    const amy = createAmyAnamBrowserSessionWithSecret(SHARED_AMY_SECRET, NOW);
    const request = requestWithCookies({
        [DANI_ANAM_BROWSER_COOKIE]: dani.token,
        [AMY_ANAM_BROWSER_COOKIE]: amy.token,
    });

    assert.deepEqual(
        readAnamBrowserSessionForTrustedAgent({
            request,
            agentSlug: 'dani',
            daniSessionSecret: SESSION_SECRET,
            sharedAmySessionSecret: SHARED_AMY_SECRET,
            now: NOW + 1,
        }),
        dani.session,
    );
    assert.deepEqual(
        readAnamBrowserSessionForTrustedAgent({
            request,
            agentSlug: 'amy',
            daniSessionSecret: SESSION_SECRET,
            sharedAmySessionSecret: SHARED_AMY_SECRET,
            now: NOW + 1,
        }),
        amy.session,
    );
    assert.deepEqual(
        readAnamBrowserSessionForTrustedAgent({
            request,
            agentSlug: 'evan',
            daniSessionSecret: SESSION_SECRET,
            sharedAmySessionSecret: SHARED_AMY_SECRET,
            now: NOW + 1,
        }),
        amy.session,
    );

    const amyOnlyRequest = requestWithCookies({ [AMY_ANAM_BROWSER_COOKIE]: amy.token });
    assert.equal(
        readAnamBrowserSessionForTrustedAgent({
            request: amyOnlyRequest,
            agentSlug: 'dani',
            daniSessionSecret: SESSION_SECRET,
            sharedAmySessionSecret: SHARED_AMY_SECRET,
            now: NOW + 1,
        }),
        null,
    );
    assert.equal(
        readAnamBrowserSessionForTrustedAgent({
            request,
            agentSlug: 'untrusted-client-value',
            daniSessionSecret: SESSION_SECRET,
            sharedAmySessionSecret: SHARED_AMY_SECRET,
            now: NOW + 1,
        }),
        null,
    );
    assert.equal(browserSessionCookieNameForTrustedAgent('dani'), DANI_ANAM_BROWSER_COOKIE);
    assert.equal(browserSessionCookieNameForTrustedAgent('amy'), AMY_ANAM_BROWSER_COOKIE);
    assert.equal(browserSessionCookieNameForTrustedAgent('evan'), AMY_ANAM_BROWSER_COOKIE);
    assert.equal(browserSessionCookieNameForTrustedAgent('untrusted-client-value'), null);
});

test('Dani contact tokens use a separate encryption domain and cannot cross-decrypt', () => {
    const browserSessionId = '11111111-2222-4333-8444-555555555555';
    const daniToken = createDaniAnamContactToken({
        browserSessionId,
        email: 'visitor@example.com',
        displayName: 'Visitor',
        purpose: 'dani_follow_up',
        secret: CONTACT_SECRET,
        now: NOW,
    });
    const amyToken = createAmyAnamContactToken({
        browserSessionId,
        email: 'visitor@example.com',
        secret: CONTACT_SECRET,
        now: NOW,
    });

    assert.equal(
        readDaniAnamContactToken({
            token: daniToken,
            browserSessionId,
            secret: CONTACT_SECRET,
            now: NOW + 1,
        })?.purpose,
        'dani_follow_up',
    );
    assert.equal(readAmyAnamContactToken({
        token: daniToken,
        browserSessionId,
        secret: CONTACT_SECRET,
        now: NOW + 1,
    }), null);
    assert.equal(readDaniAnamContactToken({
        token: amyToken,
        browserSessionId,
        secret: CONTACT_SECRET,
        now: NOW + 1,
    }), null);
});
