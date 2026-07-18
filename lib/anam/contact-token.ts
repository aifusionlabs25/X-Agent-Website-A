import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from 'node:crypto';
import { normalizeAmyAnamMemoryEmail } from './user-memory.ts';

export const AMY_ANAM_CONTACT_COOKIE = 'xagent_amy_anam_contact';
export const AMY_ANAM_CONTACT_TTL_SECONDS = 4 * 60 * 60;

const TOKEN_VERSION = 'v1';
const TOKEN_AAD = Buffer.from('xagent:amy:anam:contact:v1', 'utf8');

type ContactPayload = {
    v: 1;
    sid: string;
    email: string;
    exp: number;
};

function encryptionKey(secret: string): Buffer {
    if (secret.trim().length < 32) throw new Error('Amy contact encryption is unavailable');
    return createHash('sha256')
        .update(`xagent:amy:anam:contact-token:v1\0${secret.trim()}`, 'utf8')
        .digest();
}

function cookieValue(request: Request, name: string): string | null {
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader) return null;
    for (const pair of cookieHeader.split(';')) {
        const separator = pair.indexOf('=');
        if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
        try {
            return decodeURIComponent(pair.slice(separator + 1).trim());
        } catch {
            return null;
        }
    }
    return null;
}

export function amyAnamContactCookieOptions(maxAge = AMY_ANAM_CONTACT_TTL_SECONDS) {
    return {
        httpOnly: true,
        maxAge,
        path: '/',
        priority: 'high' as const,
        sameSite: 'lax' as const,
        secure: process.env.NODE_ENV === 'production',
    };
}

export function createAmyAnamContactToken(input: {
    browserSessionId: string;
    email: string;
    secret: string;
    now?: number;
}): string {
    const now = input.now ?? Date.now();
    const payload: ContactPayload = {
        v: 1,
        sid: input.browserSessionId,
        email: normalizeAmyAnamMemoryEmail(input.email),
        exp: now + AMY_ANAM_CONTACT_TTL_SECONDS * 1_000,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(input.secret), iv);
    cipher.setAAD(TOKEN_AAD);
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final(),
    ]);
    return [
        TOKEN_VERSION,
        iv.toString('base64url'),
        ciphertext.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
    ].join('.');
}

export function readAmyAnamContactToken(input: {
    token: string;
    browserSessionId: string;
    secret: string;
    now?: number;
}): { email: string } | null {
    try {
        const [version, ivValue, ciphertextValue, tagValue, ...extra] = input.token.split('.');
        if (
            version !== TOKEN_VERSION
            || !ivValue
            || !ciphertextValue
            || !tagValue
            || extra.length > 0
        ) return null;

        const decipher = createDecipheriv(
            'aes-256-gcm',
            encryptionKey(input.secret),
            Buffer.from(ivValue, 'base64url'),
        );
        decipher.setAAD(TOKEN_AAD);
        decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(ciphertextValue, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
        const payload = JSON.parse(plaintext) as Partial<ContactPayload>;
        if (
            payload.v !== 1
            || payload.sid !== input.browserSessionId
            || typeof payload.email !== 'string'
            || typeof payload.exp !== 'number'
            || payload.exp <= (input.now ?? Date.now())
        ) return null;
        return { email: normalizeAmyAnamMemoryEmail(payload.email) };
    } catch {
        return null;
    }
}

export function readAmyAnamContactFromRequest(input: {
    request: Request;
    browserSessionId: string;
    secret: string;
    now?: number;
}): { email: string } | null {
    const token = cookieValue(input.request, AMY_ANAM_CONTACT_COOKIE);
    if (!token) return null;
    return readAmyAnamContactToken({
        token,
        browserSessionId: input.browserSessionId,
        secret: input.secret,
        now: input.now,
    });
}
