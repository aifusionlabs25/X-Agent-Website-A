import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from 'node:crypto';
import { deriveDaniAnamContactEncryptionKey } from './dani-session.ts';
import { normalizeAmyAnamMemoryEmail } from './user-memory.ts';

export const AMY_ANAM_CONTACT_COOKIE = 'xagent_amy_anam_contact';
export const DANI_ANAM_CONTACT_COOKIE = 'xagent_dani_anam_contact';
export const AMY_ANAM_CONTACT_TTL_SECONDS = 4 * 60 * 60;

const TOKEN_VERSION = 'v1';
const TOKEN_AAD = Buffer.from('xagent:amy:anam:contact:v1', 'utf8');
const DANI_TOKEN_AAD = Buffer.from('xagent:dani:anam:contact:v1', 'utf8');

type ContactPayload = {
    v: 1;
    sid: string;
    email: string;
    callbackPhone?: string;
    displayName?: string;
    purpose?: 'amy_follow_up' | 'dani_follow_up' | 'evan_follow_up';
    emailOwnershipVerified?: true;
    exp: number;
};

export type AmyAnamContact = {
    email: string;
    callbackPhone?: string;
    displayName?: string;
    purpose?: 'amy_follow_up' | 'dani_follow_up' | 'evan_follow_up';
    emailOwnershipVerified?: true;
};

export function normalizeAmyCallbackPhone(input: unknown): string {
    if (typeof input !== 'string') throw new Error('A valid callback number is required');
    const normalized = input.normalize('NFKC').trim();
    if (!/^[+()\d\s.-]{7,32}$/.test(normalized)) {
        throw new Error('A valid callback number is required');
    }
    const digits = normalized.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
        throw new Error('A valid callback number is required');
    }
    return normalized.replace(/\s+/g, ' ').slice(0, 32);
}

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

export function daniAnamContactCookieOptions(maxAge = AMY_ANAM_CONTACT_TTL_SECONDS) {
    return amyAnamContactCookieOptions(maxAge);
}

export function createAmyAnamContactToken(input: {
    browserSessionId: string;
    email: string;
    callbackPhone?: string;
    displayName?: string;
    purpose?: 'amy_follow_up' | 'dani_follow_up' | 'evan_follow_up';
    secret: string;
    now?: number;
    ttlSeconds?: number;
}): string {
    const now = input.now ?? Date.now();
    const ttlSeconds = Math.max(
        60,
        Math.min(30 * 24 * 60 * 60, Math.trunc(input.ttlSeconds ?? AMY_ANAM_CONTACT_TTL_SECONDS)),
    );
    const payload: ContactPayload = {
        v: 1,
        sid: input.browserSessionId,
        email: normalizeAmyAnamMemoryEmail(input.email),
        ...(input.callbackPhone ? { callbackPhone: normalizeAmyCallbackPhone(input.callbackPhone) } : {}),
        exp: now + ttlSeconds * 1_000,
        ...(input.displayName?.trim() ? { displayName: input.displayName.normalize('NFKC').trim().slice(0, 120) } : {}),
        ...(input.purpose === 'amy_follow_up' || input.purpose === 'dani_follow_up' || input.purpose === 'evan_follow_up'
            ? { purpose: input.purpose }
            : {}),
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

export function createDaniAnamContactToken(input: {
    browserSessionId: string;
    email: string;
    displayName?: string;
    purpose?: 'dani_follow_up';
    emailOwnershipVerified?: true;
    secret: string;
    now?: number;
    ttlSeconds?: number;
}): string {
    const now = input.now ?? Date.now();
    const ttlSeconds = Math.max(
        60,
        Math.min(30 * 24 * 60 * 60, Math.trunc(input.ttlSeconds ?? AMY_ANAM_CONTACT_TTL_SECONDS)),
    );
    const payload: ContactPayload = {
        v: 1,
        sid: input.browserSessionId,
        email: normalizeAmyAnamMemoryEmail(input.email),
        exp: now + ttlSeconds * 1_000,
        ...(input.displayName?.trim() ? { displayName: input.displayName.normalize('NFKC').trim().slice(0, 120) } : {}),
        ...(input.purpose === 'dani_follow_up' ? { purpose: input.purpose } : {}),
        ...(input.emailOwnershipVerified === true ? { emailOwnershipVerified: true as const } : {}),
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveDaniAnamContactEncryptionKey(input.secret), iv);
    cipher.setAAD(DANI_TOKEN_AAD);
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
}): AmyAnamContact | null {
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
        return {
            email: normalizeAmyAnamMemoryEmail(payload.email),
            ...(typeof payload.callbackPhone === 'string'
                ? { callbackPhone: normalizeAmyCallbackPhone(payload.callbackPhone) }
                : {}),
            ...(typeof payload.displayName === 'string' && payload.displayName.trim()
                ? { displayName: payload.displayName.normalize('NFKC').trim().slice(0, 120) }
                : {}),
            ...(payload.purpose === 'amy_follow_up' || payload.purpose === 'dani_follow_up' || payload.purpose === 'evan_follow_up'
                ? { purpose: payload.purpose }
                : {}),
        };
    } catch {
        return null;
    }
}

export function readDaniAnamContactToken(input: {
    token: string;
    browserSessionId: string;
    secret: string;
    now?: number;
}): AmyAnamContact | null {
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
            deriveDaniAnamContactEncryptionKey(input.secret),
            Buffer.from(ivValue, 'base64url'),
        );
        decipher.setAAD(DANI_TOKEN_AAD);
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
            || (payload.purpose !== undefined && payload.purpose !== 'dani_follow_up')
        ) return null;
        return {
            email: normalizeAmyAnamMemoryEmail(payload.email),
            ...(typeof payload.displayName === 'string' && payload.displayName.trim()
                ? { displayName: payload.displayName.normalize('NFKC').trim().slice(0, 120) }
                : {}),
            ...(payload.purpose === 'dani_follow_up' ? { purpose: payload.purpose } : {}),
            ...(payload.emailOwnershipVerified === true ? { emailOwnershipVerified: true as const } : {}),
        };
    } catch {
        return null;
    }
}

export function readAmyAnamContactFromRequest(input: {
    request: Request;
    browserSessionId: string;
    secret: string;
    now?: number;
}): AmyAnamContact | null {
    return readAnamContactFromRequest(input, AMY_ANAM_CONTACT_COOKIE);
}

export function readDaniAnamContactFromRequest(input: {
    request: Request;
    browserSessionId: string;
    secret: string;
    now?: number;
}): AmyAnamContact | null {
    const token = cookieValue(input.request, DANI_ANAM_CONTACT_COOKIE);
    if (!token) return null;
    const contact = readDaniAnamContactToken({
        token,
        browserSessionId: input.browserSessionId,
        secret: input.secret,
        now: input.now,
    });
    return contact?.emailOwnershipVerified === true ? contact : null;
}

function readAnamContactFromRequest(input: {
    request: Request;
    browserSessionId: string;
    secret: string;
    now?: number;
}, cookieName: string): AmyAnamContact | null {
    const token = cookieValue(input.request, cookieName);
    if (!token) return null;
    return readAmyAnamContactToken({
        token,
        browserSessionId: input.browserSessionId,
        secret: input.secret,
        now: input.now,
    });
}
