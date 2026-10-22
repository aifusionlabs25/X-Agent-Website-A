import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CookieJar,
    EVAN_CANDIDATE_PERSONA_ID,
    createWebsiteClient,
    runWebsiteSmoke,
    validateTarget,
} from '../scripts/anam/smoke-evan-website.mjs';

const origin = 'https://evan-candidate.vercel.app';
const accessPath = '/api/anam/evan/access';
function response(body, status = 200, cookies = []) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    for (const cookie of cookies) headers.append('Set-Cookie', cookie);
    return new Response(JSON.stringify(body), { status, headers });
}

test('target validation permits only HTTPS deployed hosts or local testing', () => {
    for (const value of [origin, 'https://xagent.aifusionlabs.app/demo/evan', 'http://localhost:3000']) {
        assert.ok(validateTarget(value));
    }
    for (const value of ['http://evan-candidate.vercel.app', 'https://vercel.app.evil.test', 'https://evil.test', `${origin}:444`, 'https://user:password@evan-candidate.vercel.app']) {
        assert.throws(() => validateTarget(value));
    }
});

test('cookie jar respects secure, path, domain, and clearing', () => {
    const jar = new CookieJar();
    jar.capture(response({}, 200, [
        'browser=secret; Path=/; Secure; HttpOnly',
        'contact=secret2; Path=/api/anam; Secure',
        'foreign=secret3; Domain=another.vercel.app; Path=/',
    ]).headers, `${origin}${accessPath}`);
    assert.equal(jar.header(`${origin}/demo/evan`), 'browser=secret');
    assert.equal(jar.header(`${origin}/api/anam/evan/access`), 'contact=secret2; browser=secret');
    assert.equal(jar.header(`${origin}/api/anam-token`), 'browser=secret');
    assert.equal(jar.header('http://evan-candidate.vercel.app/'), '');
    jar.capture(response({}, 200, ['browser=; Max-Age=0; Path=/']).headers, origin);
    assert.equal(jar.header(`${origin}/demo/evan`), '');
    jar.clear();
    assert.equal(jar.header(`${origin}${accessPath}`), '');
});

test('share bootstrap refuses off-origin redirects without forwarding credentials', async () => {
    const calls = [];
    const client = createWebsiteClient(new URL(origin), async (url, options) => {
        calls.push({ url, options });
        return new Response('', { status: 302, headers: { Location: 'https://vercel.com/sso', 'Set-Cookie': 'secret=credential; Path=/' } });
    });
    await assert.rejects(client.request('Share', `${origin}/?_vercel_share=private`, { allowRedirects: true }), /Cross-origin redirect blocked/);
    assert.equal(calls.length, 1);
});

test('both lanes test deployed access and token boundaries without engine or email calls', async () => {
    const calls = [];
    const logs = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url: new URL(url), options });
        const cookies = options.headers.Cookie || '';
        const email = cookies.includes('contact=email-secret');
        const authenticated = cookies.includes('browser=browser-secret');
        const status = {
            authenticated, optional: true, rawEmailReturned: false,
            guest: authenticated && !email, followUpAuthorized: email,
            secureEmailCaptured: email, emailFollowUpAvailable: true,
        };
        if (url.pathname === accessPath && options.method === 'GET') return response(status);
        if (url.pathname === accessPath && options.method === 'DELETE') {
            return response({ loggedOut: true }, 200, ['browser=; Max-Age=0; Path=/', 'contact=; Max-Age=0; Path=/']);
        }
        if (url.pathname === accessPath && options.method === 'POST') {
            const body = JSON.parse(options.body);
            assert.equal(options.headers.Origin, origin);
            if (!body.guest) assert.equal(body.email, 'evan-smoke@example.com');
            return response({ ...status, authenticated: true, guest: body.guest === true, followUpAuthorized: !body.guest, secureEmailCaptured: !body.guest }, 200,
                ['browser=browser-secret; Path=/; Secure; HttpOnly', ...(body.guest ? [] : ['contact=email-secret; Path=/; Secure; HttpOnly'])]);
        }
        if (url.pathname === '/api/anam-token') {
            assert.deepEqual(JSON.parse(options.body), { personaId: EVAN_CANDIDATE_PERSONA_ID });
            assert.equal(authenticated, true);
            return response({ sessionToken: 'private-anam-token', launchId: 'private-launch-id', sessionSpineEnabled: true, agentMailAvailable: email, rawEmailReturned: false, identityHashReturned: false });
        }
        assert.fail('Unexpected network destination');
    };
    const result = await runWebsiteSmoke({ url: `${origin}/demo/evan`, fetchImpl, log: line => logs.push(line) });
    assert.deepEqual(result.lanes, ['guest', 'email']);
    assert.equal(result.engineStarted, false);
    assert.equal(result.emailSent, false);
    assert.equal(calls.filter(call => call.url.pathname === '/api/anam-token').length, 2);
    assert.equal(calls.filter(call => call.options.method === 'DELETE').length, 2);
    assert.doesNotMatch(logs.join('\n'), /browser-secret|email-secret|private-anam-token|private-launch-id/);
});

test('initial configuration failure stops before any mutation', async () => {
    let calls = 0;
    await assert.rejects(runWebsiteSmoke({ url: origin, log() {}, fetchImpl: async () => {
        calls++;
        return response({ error: 'Evan session access is temporarily unavailable' }, 503);
    } }), /Initial access status: HTTP 503: Evan session access is temporarily unavailable/);
    assert.equal(calls, 1);
});

test('post failure still clears signed cookies and redacts unknown server payloads', async () => {
    const methods = [];
    await assert.rejects(runWebsiteSmoke({ url: origin, log() {}, fetchImpl: async (_url, options) => {
        methods.push(options.method);
        if (options.method === 'GET') return response({ authenticated: false, optional: true, rawEmailReturned: false });
        if (options.method === 'POST') return response({ error: 'super-secret-do-not-log', sessionToken: 'private' }, 500);
        return response({ loggedOut: true });
    } }), error => {
        assert.match(error.message, /guest check-in: HTTP 500/);
        assert.doesNotMatch(error.message, /super-secret|private/);
        return true;
    });
    assert.deepEqual(methods, ['GET', 'POST', 'DELETE']);
});

test('share URL must have the exact deployment origin', async () => {
    await assert.rejects(runWebsiteSmoke({ url: origin, shareUrl: 'https://another.vercel.app/?_vercel_share=secret', fetchImpl() { assert.fail('No request permitted'); }, log() {} }), /exact --url deployment origin/);
});
