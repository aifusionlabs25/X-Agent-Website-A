import { createHash, randomBytes } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions,
    verifyAuthenticationResponse, type RegistrationResponseJSON, type AuthenticationResponseJSON } from 'xagent-webauthn-server';
import { createAccessAdapter, readAccessIdentity, type AccessIdentity } from './auth.ts';
import { ACCESS_SESSION_SECONDS, isTrustedAccessRequest, readAccessAuthConfig } from './auth-config.ts';
import { accessRedisCommand } from './redis.ts';
import { consumeAccessRate } from './grants.ts';
import { isAccessOwner } from './owners.ts';
import { accessJson } from './policy.ts';
import { AmyAnamRequestError, readBoundedJsonObject, requestFingerprint } from '../anam/session-spine.ts';

export const PASSKEY_PREFIX = 'xagent:access:passkey:v1:';
type Credential = { id: string; publicKey: string; counter: number; userId: string; email: string; rpID: string; createdAt: string };
type Ceremony = { challenge: string; kind: 'register' | 'authenticate'; origin: string; userId?: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const credentialKey = (id: string) => `${PASSKEY_PREFIX}credential:${digest(id)}`;
function parse<T>(raw: unknown): T | null { return raw === null ? null : typeof raw === 'string' ? JSON.parse(raw) : raw as T; }
function cookieName() { return `${readAccessAuthConfig().secure ? '__Secure-' : ''}xagent-passkey-challenge`; }
function cookie(value: string, age: number) { return `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${readAccessAuthConfig().secure ? '; Secure' : ''}`; }
function readChallengeCookie(request: Request) {
    return request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName()}=`))?.split('=')[1] ?? '';
}

async function begin(ceremony: Ceremony, options: unknown) {
    const nonce = randomBytes(32).toString('base64url');
    await accessRedisCommand(['SET', `${PASSKEY_PREFIX}challenge:${digest(nonce)}`, JSON.stringify(ceremony), 'EX', 300]);
    const response = accessJson({ options });
    response.headers.append('Set-Cookie', cookie(nonce, 300));
    return response;
}

async function consume(request: Request, kind: Ceremony['kind']): Promise<Ceremony> {
    const nonce = readChallengeCookie(request);
    if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new Error('Missing challenge');
    const ceremony = parse<Ceremony>(await accessRedisCommand(['GETDEL', `${PASSKEY_PREFIX}challenge:${digest(nonce)}`]));
    if (!ceremony || ceremony.kind !== kind || ceremony.origin !== readAccessAuthConfig().origin) throw new Error('Expired challenge');
    return ceremony;
}

async function credentialsFor(identity: AccessIdentity): Promise<Credential[]> {
    const ids = await accessRedisCommand(['SMEMBERS', `${PASSKEY_PREFIX}user:${digest(identity.id)}`]);
    if (!Array.isArray(ids) || ids.length > 50) throw new Error('Invalid credential index');
    const records = await Promise.all(ids.map(id => accessRedisCommand(['GET', String(id)]).then(raw => parse<Credential>(raw))));
    return records.filter((record): record is Credential => Boolean(record && record.userId === identity.id));
}

export async function handleOwnerPasskey(request: Request): Promise<Response> {
    try {
        const config = readAccessAuthConfig();
        if (!config.configured) return accessJson({ error: 'Owner sign-in is temporarily unavailable.' }, 503);
        if (!isTrustedAccessRequest(request, config)) return accessJson({ error: 'Request origin is not allowed' }, 403);
        if (!await consumeAccessRate(requestFingerprint(request, 'owner-passkey'), 40, 900)) return accessJson({ error: 'Please wait before trying again.' }, 429);
        const body = await readBoundedJsonObject(request, 32768);
        const rpID = new URL(config.origin).hostname;
        const identity = await readAccessIdentity(request);
        const owner = identity && isAccessOwner(identity.email) ? identity : null;
        if (['list', 'register-options', 'register-verify', 'remove'].includes(String(body.operation)) && !owner) {
            return accessJson({ error: 'Sign in with your owner email first.' }, 403);
        }
        if (body.operation === 'list') {
            const credentials = await credentialsFor(owner!);
            return accessJson({ credentials: credentials.filter(item => item.rpID === rpID).map(({ id, createdAt }) => ({ id, createdAt })) });
        }
        if (body.operation === 'register-options') {
            const credentials = await credentialsFor(owner!);
            if (credentials.length >= 5) return accessJson({ error: 'Remove an old passkey before adding another.' }, 400);
            const options = await generateRegistrationOptions({ rpName: 'X Agents Owner', rpID,
                userID: new Uint8Array(createHash('sha256').update(owner!.id).digest()), userName: owner!.email,
                attestationType: 'none', excludeCredentials: credentials.map(item => ({ id: item.id })),
                authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            });
            return begin({ challenge: options.challenge, kind: 'register', origin: config.origin, userId: owner!.id }, options);
        }
        if (body.operation === 'register-verify') {
            const ceremony = await consume(request, 'register');
            if (ceremony.userId !== owner!.id) throw new Error('Account changed');
            const result = await verifyRegistrationResponse({ response: body.response as RegistrationResponseJSON,
                expectedChallenge: ceremony.challenge, expectedOrigin: config.origin, expectedRPID: rpID, requireUserVerification: true });
            if (!result.verified) throw new Error('Registration failed');
            const credential = result.registrationInfo.credential;
            const record: Credential = { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'),
                counter: credential.counter, userId: owner!.id, email: owner!.email, rpID, createdAt: new Date().toISOString() };
            const saved = await accessRedisCommand(['EVAL',
                "if redis.call('SCARD',KEYS[2])>=5 or redis.call('EXISTS',KEYS[1])==1 then return 0 end; redis.call('SET',KEYS[1],ARGV[1]); redis.call('SADD',KEYS[2],KEYS[1]); return 1",
                2, credentialKey(record.id), `${PASSKEY_PREFIX}user:${digest(owner!.id)}`, JSON.stringify(record)]);
            if (saved !== 1) throw new Error('Credential already registered or limit reached');
            const response = accessJson({ saved: true }); response.headers.append('Set-Cookie', cookie('', 0)); return response;
        }
        if (body.operation === 'authenticate-options') {
            const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
            return begin({ challenge: options.challenge, kind: 'authenticate', origin: config.origin }, options);
        }
        if (body.operation === 'authenticate-verify') {
            const ceremony = await consume(request, 'authenticate');
            const assertion = body.response as AuthenticationResponseJSON;
            if (!assertion || typeof assertion.id !== 'string' || assertion.id.length > 2048) throw new Error('Invalid assertion');
            const raw = await accessRedisCommand(['GET', credentialKey(assertion.id)]);
            const record = parse<Credential>(raw);
            if (!record || record.rpID !== rpID || !isAccessOwner(record.email)) throw new Error('Unknown owner credential');
            const adapter = createAccessAdapter();
            const user = await adapter.getUser!(record.userId);
            if (!user?.emailVerified || user.email !== record.email) throw new Error('Owner identity unavailable');
            if (assertion.response.userHandle && assertion.response.userHandle !== createHash('sha256').update(user.id).digest('base64url')) throw new Error('Invalid user handle');
            const result = await verifyAuthenticationResponse({ response: assertion, expectedChallenge: ceremony.challenge,
                expectedOrigin: config.origin, expectedRPID: rpID, requireUserVerification: true,
                credential: { id: record.id, publicKey: new Uint8Array(Buffer.from(record.publicKey, 'base64url')), counter: record.counter },
            });
            if (!result.verified) throw new Error('Invalid signature');
            const changed = { ...record, counter: result.authenticationInfo.newCounter };
            // Compare-and-set prevents concurrent logins from undoing removal/counter changes.
            const updated = await accessRedisCommand(['EVAL',
                "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1",
                1, credentialKey(record.id), typeof raw === 'string' ? raw : JSON.stringify(raw), JSON.stringify(changed)]);
            if (updated !== 1) throw new Error('Credential changed');
            const token = randomBytes(32).toString('base64url');
            // Keep a credential binding for every passkey session. Removing a key
            // invalidates its sessions at the next application identity check.
            await accessRedisCommand(['SET', `${PASSKEY_PREFIX}session:${digest(token)}`, credentialKey(record.id), 'EX', ACCESS_SESSION_SECONDS]);
            await adapter.createSession!({ sessionToken: token, userId: user.id, expires: new Date(Date.now() + ACCESS_SESSION_SECONDS * 1000) });
            const response = accessJson({ signedIn: true });
            response.headers.append('Set-Cookie', cookie('', 0));
            response.headers.append('Set-Cookie', `${config.secure ? '__Secure-' : ''}xagent-access.session-token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ACCESS_SESSION_SECONDS}${config.secure ? '; Secure' : ''}`);
            return response;
        }
        if (body.operation === 'remove') {
            if (typeof body.id !== 'string' || body.id.length > 2048) return accessJson({ error: 'Invalid passkey' }, 400);
            const key = credentialKey(body.id);
            const record = parse<Credential>(await accessRedisCommand(['GET', key]));
            if (!record || record.userId !== owner!.id) return accessJson({ error: 'Passkey not found' }, 404);
            await accessRedisCommand(['EVAL', "redis.call('DEL',KEYS[1]); redis.call('SREM',KEYS[2],KEYS[1]); return 1",
                2, key, `${PASSKEY_PREFIX}user:${digest(owner!.id)}`]);
            return accessJson({ removed: true });
        }
        return accessJson({ error: 'Unknown passkey action' }, 400);
    } catch (error) {
        if (error instanceof AmyAnamRequestError) return accessJson({ error: error.message }, error.status);
        return accessJson({ error: 'Passkey sign-in could not be completed. Try again or use your owner email.' }, 400);
    }
}
