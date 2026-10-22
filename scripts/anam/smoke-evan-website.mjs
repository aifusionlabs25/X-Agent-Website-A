import { pathToFileURL } from 'node:url';

export const EVAN_CANDIDATE_PERSONA_ID = '6097c73e-b6ef-48c5-94c7-9a95d4863b99';
const ACCESS_PATH = '/api/anam/evan/access';
const SAFE_SERVER_ERRORS = new Set([
    'Evan session access is temporarily unavailable',
    'Evan session access failed',
    'Email follow-up is temporarily unavailable; continue without email instead',
    'Request origin is not allowed',
    'Too many session attempts',
    'Too many session starts',
    'Evan is temporarily unavailable while his configuration is checked.',
    'Amy session tracking is temporarily unavailable',
    'Choose an email recap or continue without email first',
    'Server configuration error',
    'Internal server error',
    'Failed to authenticate with Anam',
]);

export class SmokeFailure extends Error {
    constructor(stage, message) {
        super(`${stage}: ${message}`);
        this.name = 'SmokeFailure';
    }
}

export function validateTarget(value) {
    let url;
    try { url = new URL(value); } catch { throw new SmokeFailure('Target', 'Provide a valid --url.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const hosted = url.hostname === 'xagent.aifusionlabs.app' || url.hostname.endsWith('.vercel.app');
    if (url.username || url.password || (!local && !hosted)
        || (local ? !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:')
        || (!local && url.port)) {
        throw new SmokeFailure('Target', 'Use HTTPS on the X Agent domain or a Vercel deployment, or localhost.');
    }
    url.hash = '';
    return url;
}

// An in-memory, single-origin jar. No browser cookies or secrets are read from disk.
export class CookieJar {
    cookies = new Map();

    capture(headers, responseUrl) {
        if (typeof headers.getSetCookie !== 'function') {
            throw new SmokeFailure('Runtime', 'Node with Headers.getSetCookie support is required.');
        }
        const url = new URL(responseUrl);
        for (const value of headers.getSetCookie()) {
            const [pair, ...attributes] = value.split(';');
            const at = pair.indexOf('=');
            if (at < 1) continue;
            const name = pair.slice(0, at).trim();
            if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
            const cookie = {
                name,
                value: pair.slice(at + 1).trim(),
                path: url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) || '/',
                secure: false,
                expires: Infinity,
            };
            let domainAllowed = true;
            let maxAge;
            for (const attribute of attributes) {
                const separator = attribute.indexOf('=');
                const key = (separator < 0 ? attribute : attribute.slice(0, separator)).trim().toLowerCase();
                const setting = separator < 0 ? '' : attribute.slice(separator + 1).trim();
                if (key === 'domain') domainAllowed = setting.replace(/^\./, '').toLowerCase() === url.hostname;
                if (key === 'path' && setting.startsWith('/')) cookie.path = setting;
                if (key === 'secure') cookie.secure = true;
                if (key === 'expires' && Number.isFinite(Date.parse(setting))) cookie.expires = Date.parse(setting);
                if (key === 'max-age' && /^-?\d+$/.test(setting)) maxAge = Number(setting);
            }
            if (!domainAllowed) continue;
            if (maxAge !== undefined) cookie.expires = Date.now() + maxAge * 1000;
            const key = `${name}:${cookie.path}`;
            if (cookie.expires <= Date.now()) this.cookies.delete(key);
            else this.cookies.set(key, cookie);
        }
    }

    header(requestUrl) {
        const url = new URL(requestUrl);
        return [...this.cookies.values()]
            .filter(cookie => cookie.expires > Date.now()
                && (!cookie.secure || url.protocol === 'https:')
                && (url.pathname === cookie.path
                    || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`)))
            .sort((a, b) => b.path.length - a.path.length)
            .map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    }

    clear() { this.cookies.clear(); }
}

export function createWebsiteClient(target, fetchImpl = fetch) {
    const origin = target.origin;
    const jar = new CookieJar();

    async function request(stage, path, { method = 'GET', body, allowRedirects = false } = {}) {
        let url = new URL(path, origin);
        for (let hop = 0; hop <= 4; hop++) {
            if (url.origin !== origin || url.username || url.password) {
                throw new SmokeFailure(stage, 'Cross-origin redirect blocked. Use a valid share URL for this deployment.');
            }
            const headers = { Accept: 'application/json', Origin: origin, Referer: `${origin}/demo/evan` };
            const cookies = jar.header(url);
            if (cookies) headers.Cookie = cookies;
            if (body !== undefined) headers['Content-Type'] = 'application/json';
            let response;
            try {
                response = await fetchImpl(url, {
                    method,
                    headers,
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                    redirect: 'manual',
                    cache: 'no-store',
                    signal: AbortSignal.timeout(30_000),
                });
            } catch {
                throw new SmokeFailure(stage, 'Network request failed or timed out.');
            }
            jar.capture(response.headers, url);
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('location');
                if (!allowRedirects || method !== 'GET' || !location) {
                    throw new SmokeFailure(stage, `HTTP ${response.status}: redirect instead of the expected endpoint; check deployment access.`);
                }
                try { url = new URL(location, url); } catch {
                    throw new SmokeFailure(stage, 'Invalid redirect returned.');
                }
                continue;
            }
            return response;
        }
        throw new SmokeFailure(stage, 'Too many redirects.');
    }

    async function json(stage, path, options) {
        const response = await request(stage, path, options);
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            const error = SAFE_SERVER_ERRORS.has(payload?.error) ? payload.error : 'Endpoint failed (response details redacted).';
            throw new SmokeFailure(stage, `HTTP ${response.status}: ${error}`);
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new SmokeFailure(stage, `HTTP ${response.status}: expected a JSON object, not a login or maintenance page.`);
        }
        return payload;
    }

    return { request, json, clear: () => jar.clear() };
}

function expectFields(stage, payload, expected) {
    for (const [field, value] of Object.entries(expected)) {
        if (payload[field] !== value) throw new SmokeFailure(stage, `Expected ${field}=${String(value)}; actual value redacted.`);
    }
    // Even a successful boundary must not leak the raw email or identity hash.
    if (Object.hasOwn(payload, 'email') || Object.hasOwn(payload, 'emailIdentityHash')) {
        throw new SmokeFailure(stage, 'Unexpected private contact field returned.');
    }
}

export async function runWebsiteSmoke({ url, shareUrl, fetchImpl = fetch, log = console.log }) {
    const target = validateTarget(url);
    const bootstrap = shareUrl ? validateTarget(shareUrl) : target.searchParams.has('_vercel_share') ? target : null;
    if (bootstrap && bootstrap.origin !== target.origin) {
        throw new SmokeFailure('Target', '--share-url must belong to the exact --url deployment origin.');
    }
    const client = createWebsiteClient(target, fetchImpl);
    let touchedAccess = false;
    let failure;
    const results = [];
    log(`Testing Evan website boundaries at ${target.origin}`);
    log(`Persona: ${EVAN_CANDIDATE_PERSONA_ID}`);
    log('Scope: guest and synthetic-email check-in plus session-token issuance. No engine, live call, or email is started.');
    log('The test creates short-lived launch reservations and consumes two launch/rate-limit attempts.');
    try {
        if (bootstrap) {
            const response = await client.request('Deployment share access', bootstrap, { allowRedirects: true });
            if (!response.ok) throw new SmokeFailure('Deployment share access', `HTTP ${response.status}: share link was not accepted.`);
            await response.body?.cancel();
        }
        const initial = await client.json('Initial access status', ACCESS_PATH);
        expectFields('Initial access status', initial, { authenticated: false, optional: true, rawEmailReturned: false });
        log('PASS initial access endpoint');

        for (const lane of ['guest', 'email']) {
            touchedAccess = true;
            const expected = {
                authenticated: true,
                guest: lane === 'guest',
                followUpAuthorized: lane === 'email',
                secureEmailCaptured: lane === 'email',
                rawEmailReturned: false,
            };
            if (lane === 'email') expected.emailFollowUpAvailable = true;
            const body = lane === 'guest' ? { guest: true } : {
                displayName: 'Evan Smoke Test',
                email: 'evan-smoke@example.com',
                followUpConsent: true,
            };
            const access = await client.json(`${lane} check-in`, ACCESS_PATH, { method: 'POST', body });
            expectFields(`${lane} check-in`, access, expected);
            const roundTrip = await client.json(`${lane} cookie round trip`, ACCESS_PATH);
            expectFields(`${lane} cookie round trip`, roundTrip, expected);
            const token = await client.json(`${lane} website token`, '/api/anam-token', {
                method: 'POST', body: { personaId: EVAN_CANDIDATE_PERSONA_ID },
            });
            expectFields(`${lane} website token`, token, {
                sessionSpineEnabled: true,
                agentMailAvailable: lane === 'email',
                rawEmailReturned: false,
                identityHashReturned: false,
            });
            if (typeof token.sessionToken !== 'string' || !token.sessionToken.trim()
                || typeof token.launchId !== 'string' || !token.launchId.trim()) {
                throw new SmokeFailure(`${lane} website token`, 'Missing session token or session-bound launch reservation.');
            }
            // Do not persist, log, or use this token to start a call.
            token.sessionToken = '';
            token.launchId = '';
            results.push(lane);
            log(`PASS ${lane}: check-in, signed-cookie round trip, candidate token, and email-consent isolation`);
            await client.json(`${lane} logout`, ACCESS_PATH, { method: 'DELETE' });
            const cleared = await client.json(`${lane} logout round trip`, ACCESS_PATH);
            expectFields(`${lane} logout round trip`, cleared, { authenticated: false, rawEmailReturned: false });
            touchedAccess = false;
        }
    } catch (error) {
        failure = error instanceof SmokeFailure ? error : new SmokeFailure('Smoke check', 'Unexpected failure (details redacted).');
    } finally {
        if (touchedAccess) {
            try { await client.json('Cleanup logout', ACCESS_PATH, { method: 'DELETE' }); }
            catch { log('WARNING server logout could not be confirmed; all local test cookies were discarded.'); }
        }
        client.clear();
    }
    if (failure) throw failure;
    log('PASS both website entry paths. Live audio/video, transcript delivery, and actual email delivery still require a human conversation test.');
    return { passed: true, personaId: EVAN_CANDIDATE_PERSONA_ID, lanes: results, engineStarted: false, emailSent: false };
}

function parseArgs(args) {
    const options = {};
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === '--help' || argument === '-h') return { help: true };
        const separator = argument.indexOf('=');
        const key = separator < 0 ? argument : argument.slice(0, separator);
        if (!['--url', '--share-url'].includes(key)) throw new SmokeFailure('Arguments', 'Only --url and optional --share-url are supported.');
        const value = separator < 0 ? args[++index] : argument.slice(separator + 1);
        if (!value || value.startsWith('--')) throw new SmokeFailure('Arguments', 'A URL value is required.');
        options[key === '--url' ? 'url' : 'shareUrl'] = value;
    }
    if (!options.url) throw new SmokeFailure('Arguments', '--url is required.');
    return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) console.log('Usage: node scripts/anam/smoke-evan-website.mjs --url <deployment-url> [--share-url <same-origin-share-url>]\nTests both website check-in paths without starting a call or sending email. Never logs tokens, cookies, or share-link credentials.');
        else await runWebsiteSmoke(options);
    } catch (error) {
        console.error(`FAIL ${error instanceof SmokeFailure ? error.message : 'Smoke check failed (details redacted).'}`);
        process.exitCode = 1;
    }
}
