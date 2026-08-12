import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
    AMY_ANAM_BROWSER_COOKIE,
    AmyAnamRequestError,
    amyAnamCookieOptions,
    createAmyAnamBrowserSessionWithSecret,
    isTrustedBrowserOrigin,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    requestFingerprint,
} from '@/lib/anam/session-spine';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';
import {
    AMY_ANAM_CONTACT_COOKIE,
    amyAnamContactCookieOptions,
    createAmyAnamContactToken,
} from '@/lib/anam/contact-token';
import {
    deleteAmyAnamBrowserIdentity,
    readAmyAnamApprovedMemoryHistory,
    readAmyAnamBrowserIdentity,
    readAmyAnamMemoryConfig,
    normalizeAmyAnamMemoryEmail,
    storeAmyAnamBrowserIdentity,
} from '@/lib/anam/user-memory';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function accessCodeMatches(candidate: string, expected: string): boolean {
    const candidateDigest = createHash('sha256').update(candidate).digest();
    const expectedDigest = createHash('sha256').update(expected).digest();
    return timingSafeEqual(candidateDigest, expectedDigest);
}

function safeIdentityStatus(input: {
    required: boolean;
    authenticated: boolean;
    displayName?: string;
    memoryConsent?: boolean;
    history?: Array<{ approvedAt: string }>;
}) {
    const history = input.history ?? [];
    return {
        required: input.required,
        authenticated: input.authenticated,
        displayName: input.displayName ?? null,
        memoryConsent: input.memoryConsent === true,
        approvedMemoryCount: history.length,
        recentMemoryDates: history
            .slice(-3)
            .map(record => record.approvedAt),
        rawEmailReturned: false,
        identityHashReturned: false,
        memoryContentReturned: false,
    };
}

export async function GET(request: Request) {
    try {
        const config = readAmyAnamMemoryConfig();
        if (!config.enabled) {
            return noStoreJson(safeIdentityStatus({
                required: false,
                authenticated: true,
            }));
        }
        if (!config.gatesOpen) {
            return noStoreJson({ error: 'Amy returning memory is temporarily unavailable' }, { status: 503 });
        }
        const spine = readAmyAnamSpineConfig();
        const browserSession = readAmyAnamBrowserSession(request, spine.signingSecret);
        if (!browserSession) {
            return noStoreJson(safeIdentityStatus({ required: true, authenticated: false }));
        }
        const identity = await readAmyAnamBrowserIdentity(browserSession.id);
        if (!identity) {
            return noStoreJson(safeIdentityStatus({ required: true, authenticated: false }));
        }
        const history = await readAmyAnamApprovedMemoryHistory(identity);
        return noStoreJson(safeIdentityStatus({
            required: true,
            authenticated: true,
            displayName: identity.displayName,
            memoryConsent: identity.memoryConsent,
            history,
        }));
    } catch {
        return noStoreJson({ error: 'Amy returning memory status is unavailable' }, { status: 503 });
    }
}

export async function POST(request: Request) {
    try {
        const config = readAmyAnamMemoryConfig();
        if (!config.gatesOpen) {
            return noStoreJson({ error: 'Amy returning memory is temporarily unavailable' }, { status: 503 });
        }
        if (!isTrustedBrowserOrigin(request)) {
            return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
        }
        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: requestFingerprint(request, 'memory-access'),
            limit: 10,
            windowSeconds: 15 * 60,
        });
        if (!rate.allowed) {
            return noStoreJson(
                { error: 'Too many access attempts' },
                { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
            );
        }

        const body = await readBoundedJsonObject(request, 4 * 1024);
        const displayName = typeof body.displayName === 'string' ? body.displayName : '';
        const email = typeof body.email === 'string' ? body.email : '';
        const accessCode = typeof body.accessCode === 'string' ? body.accessCode : '';
        const memoryConsent = body.memoryConsent === true;
        if (!displayName.trim() || !email.trim() || !accessCode) {
            return noStoreJson(
                { error: 'Enter a valid name, email, and access code' },
                { status: 400 },
            );
        }
        if (!accessCodeMatches(accessCode, config.accessCode)) {
            return noStoreJson({ error: 'Invalid access code' }, { status: 401 });
        }

        const spine = readAmyAnamSpineConfig();
        const created = createAmyAnamBrowserSessionWithSecret(spine.signingSecret);
        const identity = await storeAmyAnamBrowserIdentity({
            browserSessionId: created.session.id,
            displayName,
            email,
            memoryConsent,
        });
        const contactToken = createAmyAnamContactToken({
            browserSessionId: created.session.id,
            email: normalizeAmyAnamMemoryEmail(email),
            displayName: identity.displayName,
            purpose: 'amy_follow_up',
            secret: spine.signingSecret,
        });
        const history = await readAmyAnamApprovedMemoryHistory(identity);
        const response = noStoreJson(safeIdentityStatus({
            required: true,
            authenticated: true,
            displayName: identity.displayName,
            memoryConsent: identity.memoryConsent,
            history,
        }));
        response.cookies.set(
            AMY_ANAM_BROWSER_COOKIE,
            created.token,
            amyAnamCookieOptions(),
        );
        response.cookies.set(
            AMY_ANAM_CONTACT_COOKIE,
            contactToken,
            amyAnamContactCookieOptions(),
        );
        return response;
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        const message = error instanceof Error ? error.message : '';
        if (/valid email/i.test(message)) {
            return noStoreJson({ error: 'Enter a valid email address' }, { status: 400 });
        }
        if (/valid name/i.test(message)) {
            return noStoreJson({ error: 'Enter a valid name' }, { status: 400 });
        }
        console.error('[Amy Anam Memory Access] Failed');
        return noStoreJson({ error: 'Amy returning memory access failed' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const config = readAmyAnamMemoryConfig();
        const spine = readAmyAnamSpineConfig();
        if (config.gatesOpen && isTrustedBrowserOrigin(request)) {
            const browserSession = readAmyAnamBrowserSession(request, spine.signingSecret);
            if (browserSession) {
                await deleteAmyAnamBrowserIdentity(browserSession.id).catch(() => undefined);
            }
        }
        const response = noStoreJson({ loggedOut: true });
        response.cookies.set(
            AMY_ANAM_BROWSER_COOKIE,
            '',
            amyAnamCookieOptions(0),
        );
        response.cookies.set(
            AMY_ANAM_CONTACT_COOKIE,
            '',
            amyAnamContactCookieOptions(0),
        );
        return response;
    } catch {
        return noStoreJson({ error: 'Logout failed' }, { status: 500 });
    }
}
