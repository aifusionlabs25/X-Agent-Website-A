import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import test from 'node:test';
import { encodeCBOR } from '@levischuck/tiny-cbor';
import { handleOwnerPasskey } from '../lib/access/passkeys.ts';
import { createAccessAdapter, readAccessIdentity } from '../lib/access/auth.ts';
import { previewAccessCommand } from '../lib/access/redis.ts';
import { accessNotificationMessages, deliverAccessNotifications } from '../lib/access/notifications.ts';

const ORIGIN = 'https://xagent.aifusionlabs.app';
const ENV = { NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production',
    AMY_ANAM_REDIS_REST_URL: 'https://owner-test.invalid', AMY_ANAM_REDIS_REST_TOKEN: 'offline',
    RESEND_API_KEY: 'offline', XAGENT_AUTH_SECRET: 'offline-owner-secret-at-least-thirty-two-characters' };
const hash = input => createHash('sha256').update(input).digest();
const b64 = input => Buffer.from(input).toString('base64url');

async function fixture(run) {
    const keys = [...Object.keys(ENV), 'NEXTAUTH_URL', 'VERCEL_URL', 'VERCEL_GIT_COMMIT_REF', 'XAGENT_ACCESS_OWNER_EMAILS'];
    const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    keys.forEach(key => delete process.env[key]); Object.assign(process.env, ENV);
    const originalFetch = globalThis.fetch;
    const db = new Map(), sets = new Map(), mail = [], expiries = new Map();
    let emailOutage = false;
    globalThis.fetch = async (url, init) => {
        if (String(url) === 'https://api.resend.com/emails') {
            if (emailOutage) return Response.json({}, { status: 503 });
            mail.push({ ...JSON.parse(init.body), idempotency: init.headers['Idempotency-Key'] });
            return Response.json({ id: 'offline-mail' });
        }
        assert.equal(String(url), ENV.AMY_ANAM_REDIS_REST_URL, 'no live network');
        const cmd = JSON.parse(init.body), op = cmd[0].toUpperCase(), key = cmd[1];
        const get = key => { if (expiries.get(key) <= Date.now()) db.delete(key); return db.get(key) ?? null; };
        let result;
        if (op === 'GET') result = get(key);
        else if (op === 'GETDEL') { result = get(key); db.delete(key); }
        else if (op === 'SET') {
            result = cmd.includes('NX') && get(key) !== null ? null : 'OK';
            if (result) { db.set(key, cmd[2]); const ex = cmd.findIndex(x => String(x).toUpperCase() === 'EX'); if (ex > 0) expiries.set(key, Date.now() + Number(cmd[ex + 1]) * 1000); }
        } else if (op === 'SMEMBERS') result = [...(sets.get(key) ?? [])];
        else if (op === 'DEL') result = Number(db.delete(key));
        else if (op === 'EVAL') {
            const count = cmd[2], k = cmd.slice(3, 3 + count), args = cmd.slice(3 + count);
            if (key.includes("redis.call('INCR'")) { result = Number(get(k[0]) ?? 0) + 1; db.set(k[0], result); }
            else if (key.includes("redis.call('SCARD'")) {
                const set = sets.get(k[1]) ?? new Set();
                result = set.size >= 5 || get(k[0]) ? 0 : 1;
                if (result) { db.set(k[0], args[0]); set.add(k[0]); sets.set(k[1], set); }
            } else if (key.includes('~=ARGV[1]')) {
                result = get(k[0]) === args[0] ? 1 : 0;
                if (result) db.set(k[0], args[1]);
            } else if (key.includes("redis.call('SREM'")) { db.delete(k[0]); sets.get(k[1])?.delete(k[0]); result = 1; }
            else throw new Error('Unexpected script');
        } else throw new Error('Unexpected command: ' + op);
        return Response.json({ result });
    };
    try {
        const adapter = createAccessAdapter();
        const owner = await adapter.createUser({ email: 'aifusionlabs@gmail.com', emailVerified: new Date(), name: 'Owner' });
        const guest = await adapter.createUser({ email: 'guest@example.test', emailVerified: new Date(), name: 'Guest' });
        for (const [token, user] of [['owner', owner], ['guest', guest]]) await adapter.createSession({ sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3600_000) });
        const call = (operation, extra = {}, cookie = '', origin = ORIGIN) => handleOwnerPasskey(new Request(ORIGIN + '/api/access/passkey', {
            method: 'POST', headers: { origin, cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, ...extra }),
        }));
        await run({ call, owner, db, mail, expiries, setEmailOutage: value => { emailOutage = value; } });
    } finally { globalThis.fetch = originalFetch; for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
const ownerCookie = '__Secure-xagent-access.session-token=owner';
const cookieFrom = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

function authenticator() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' }), id = randomBytes(32);
    const cose = encodeCBOR(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
    return {
        id: b64(id),
        registration(challenge, origin = ORIGIN, flags = 0x45) {
            const size = Buffer.alloc(2); size.writeUInt16BE(id.length);
            const authData = Buffer.concat([hash(new URL(origin).hostname), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), size, id, Buffer.from(cose)]);
            const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
            return { id: b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, response: {
                clientDataJSON: b64(clientData), attestationObject: b64(encodeCBOR(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]))), transports: ['internal'] } };
        },
        authentication(challenge, { origin = ORIGIN, flags = 5, counter = 1, badSignature = false } = {}) {
            const count = Buffer.alloc(4); count.writeUInt32BE(counter);
            const authData = Buffer.concat([hash(new URL(origin).hostname), Buffer.from([flags]), count]);
            const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
            const signature = sign('sha256', Buffer.concat([authData, hash(clientData)]), privateKey);
            if (badSignature) signature[signature.length - 1] ^= 1;
            return { id: b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, response: { authenticatorData: b64(authData), clientDataJSON: b64(clientData), signature: b64(signature) } };
        },
    };
}
async function enroll(call, device) {
    const options = await call('register-options', {}, ownerCookie); assert.equal(options.status, 200);
    const { options: data } = await options.json();
    const result = await call('register-verify', { response: device.registration(data.challenge) }, ownerCookie + '; ' + cookieFrom(options));
    assert.equal(result.status, 200, JSON.stringify(await result.json()));
}

test('passkey enrollment requires a verified owner and same-origin request', () => fixture(async ({ call }) => {
    for (const cookie of ['', '__Secure-xagent-access.session-token=guest']) assert.equal((await call('register-options', {}, cookie)).status, 403);
    assert.equal((await call('register-options', {}, ownerCookie, 'https://evil.invalid')).status, 403);
}));

test('real WebAuthn registration and signature create a shared owner session; replay and removal fail closed', () => fixture(async ({ call }) => {
    const device = authenticator(); await enroll(call, device);
    const start = await call('authenticate-options'); const { options } = await start.json();
    const assertion = device.authentication(options.challenge);
    const login = await call('authenticate-verify', { response: assertion }, cookieFrom(start));
    assert.equal(login.status, 200, JSON.stringify(await login.clone().json()));
    const sessionCookie = cookieFrom(login);
    const identity = () => readAccessIdentity(new Request(ORIGIN + '/api/access', { headers: { cookie: sessionCookie } }));
    assert.equal((await identity()).email, 'aifusionlabs@gmail.com');
    assert.equal((await call('authenticate-verify', { response: assertion }, cookieFrom(start))).status, 400);
    assert.equal((await call('remove', { id: device.id }, ownerCookie)).status, 200);
    assert.equal(await identity(), null, 'removal invalidates existing passkey sessions');
}));

test('passkeys reject wrong origin, missing user verification, bad signatures, missing cookies and expired challenges', () => fixture(async ({ call, expiries }) => {
    const device = authenticator(); await enroll(call, device);
    for (const mutation of [{ origin: 'https://evil.invalid' }, { flags: 1 }, { badSignature: true }]) {
        const start = await call('authenticate-options'); const { options } = await start.json();
        assert.equal((await call('authenticate-verify', { response: device.authentication(options.challenge, mutation) }, cookieFrom(start))).status, 400);
    }
    const start = await call('authenticate-options'); const { options } = await start.json();
    const response = device.authentication(options.challenge);
    assert.equal((await call('authenticate-verify', { response })).status, 400);
    for (const key of expiries.keys()) if (key.includes(':challenge:')) expiries.set(key, 0);
    assert.equal((await call('authenticate-verify', { response }, cookieFrom(start))).status, 400);
}));

test('owner removal from configuration blocks an enrolled passkey', () => fixture(async ({ call }) => {
    const device = authenticator(); await enroll(call, device);
    const start = await call('authenticate-options'); const { options } = await start.json();
    process.env.XAGENT_ACCESS_OWNER_EMAILS = 'replacement@example.test';
    assert.equal((await call('authenticate-verify', { response: device.authentication(options.challenge) }, cookieFrom(start))).status, 400);
}));

const sample = { email: 'guest@example.test', agent: 'james', capabilities: ['conversation'], status: 'approved', expiresAt: '2026-12-01T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', updatedBy: 'aifusionlabs@gmail.com', notificationId: 'offline-event', notificationKind: 'decision' };

test('notifications send decision to visitor and owner, retry without duplicates, and preserve failed delivery', () => fixture(async ({ mail, setEmailOutage }) => {
    setEmailOutage(true); assert.equal(await deliverAccessNotifications(sample), 'pending'); assert.equal(mail.length, 0);
    setEmailOutage(false); assert.equal(await deliverAccessNotifications(sample), 'sent'); assert.equal(mail.length, 2);
    assert.equal(await deliverAccessNotifications(sample), 'sent'); assert.equal(mail.length, 2);
    assert.deepEqual(mail.map(item => item.to), ['aifusionlabs@gmail.com', 'guest@example.test']);
    assert.ok(mail[0].text.includes('/access/admin?request=offline-event'));
    assert.ok(mail[1].text.includes('/demo/james'));
    assert.ok(mail.every(item => item.idempotency));
}));

test('preview notification copies go only to owner and preview storage never addresses live keys', () => fixture(async () => {
    process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_URL = 'access-test.vercel.app'; process.env.VERCEL_GIT_COMMIT_REF = 'feat/shared-agent-access';
    process.env.KV_REST_API_URL = ENV.AMY_ANAM_REDIS_REST_URL; process.env.KV_REST_API_TOKEN = 'offline';
    try {
        const messages = accessNotificationMessages(sample);
        assert.ok(messages.every(item => item.to === 'aifusionlabs@gmail.com' && item.subject.startsWith('[PREVIEW]')));
        assert.ok(messages[1].text.includes('https://access-test.vercel.app/demo/james'));
        const command = previewAccessCommand(['EVAL', 'script', 2, 'xagent:access:a', 'xagent:access:b', 'unchanged-value']);
        assert.match(command[3], /^xagent:preview:/); assert.match(command[4], /^xagent:preview:/); assert.equal(command[5], 'unchanged-value');
        assert.deepEqual(previewAccessCommand(command), command, 'already-scoped keys are not prefixed twice');
    } finally { delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; }
}));
