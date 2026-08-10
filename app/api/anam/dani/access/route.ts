import { NextResponse } from 'next/server';
import {
    AmyAnamRequestError,
    isTrustedBrowserOrigin,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    requestFingerprint,
} from '@/lib/anam/session-spine';
import {
    DANI_ANAM_BROWSER_COOKIE,
    DANI_ANAM_GUEST_COOKIE,
    createDaniAnamBrowserSessionWithSecret,
    daniAnamSessionCookieOptions,
    readDaniAnamBrowserSession,
    readDaniAnamSessionSecrets,
} from '@/lib/anam/dani-session';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';
import {
    DANI_ANAM_CONTACT_COOKIE,
    createDaniAnamContactToken,
    daniAnamContactCookieOptions,
    readDaniAnamContactFromRequest,
} from '@/lib/anam/contact-token';
import {
    cancelDaniAnamOtpChallenge,
    createDaniAnamOtpChallenge,
    deleteDaniAnamBrowserIdentity,
    normalizeDaniAnamMemoryEmail,
    readDaniAnamApprovedMemoryHistory,
    readDaniAnamBrowserIdentity,
    readDaniAnamMemoryConfig,
} from '@/lib/anam/dani-user-memory';
import {
    cancelDaniAnamFollowUpOtpChallenge,
    clearDaniAnamFollowUpAuthorization,
    createDaniAnamFollowUpOtpChallenge,
    readDaniAnamAgentMailConfig,
    readDaniAnamFollowUpAuthorization,
} from '@/lib/anam/dani-agentmail';
import { sendDaniAnamMemoryVerificationEmail } from '@/lib/anam/dani-memory-verification-email';

function json(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
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

function status(input: {
    authenticated: boolean;
    displayName?: string | null;
    followUpAuthorized?: boolean;
    secureEmailCaptured?: boolean;
    guest?: boolean;
    emailFollowUpAvailable?: boolean;
    memoryAvailable?: boolean;
    memoryVerified?: boolean;
    memoryCount?: number;
    lastMemoryAt?: string | null;
}) {
    return {
        required: false,
        optional: true,
        authenticated: input.authenticated,
        displayName: input.displayName ?? null,
        secureEmailCaptured: input.secureEmailCaptured === true,
        followUpAuthorized: input.followUpAuthorized === true,
        guest: input.guest === true,
        emailFollowUpAvailable: input.emailFollowUpAvailable === true,
        memoryAvailable: input.memoryAvailable === true,
        memoryVerified: input.memoryVerified === true,
        memoryCount: input.memoryVerified ? Math.max(0, input.memoryCount ?? 0) : null,
        lastMemoryAt: input.memoryVerified ? input.lastMemoryAt ?? null : null,
        rawEmailReturned: false,
        identityHashReturned: false,
        memoryContentReturned: false,
    };
}

export async function GET(request: Request) {
    try {
        const spine = readAmyAnamSpineConfig();
        const daniSession = readDaniAnamSessionSecrets();
        if (!spine.gatesOpen || !daniSession.configured) {
            return json({ error: 'Dani session access is temporarily unavailable' }, { status: 503 });
        }
        const emailConfig = readDaniAnamAgentMailConfig();
        const memoryConfig = readDaniAnamMemoryConfig();
        const memoryEnrollmentAvailable = memoryConfig.gatesOpen && emailConfig.effectiveGateOpen;
        const browser = readDaniAnamBrowserSession(request, daniSession.sessionSecret);
        if (!browser) {
            return json(status({
                authenticated: false,
                emailFollowUpAvailable: emailConfig.effectiveGateOpen,
                memoryAvailable: memoryEnrollmentAvailable,
            }));
        }

        const cookieContact = emailConfig.effectiveGateOpen
            ? readDaniAnamContactFromRequest({
                request,
                browserSessionId: browser.id,
                secret: daniSession.contactSecret,
            })
            : null;
        const storedContact = !cookieContact && emailConfig.effectiveGateOpen
            ? await readDaniAnamFollowUpAuthorization({
                browserSessionId: browser.id,
                contactSecret: daniSession.contactSecret,
            })
            : null;
        const contact = cookieContact ?? storedContact;
        const daniContact = contact?.purpose === 'dani_follow_up' ? contact : null;
        const identity = memoryConfig.gatesOpen
            ? await readDaniAnamBrowserIdentity(browser.id)
            : null;
        const history = identity
            ? await readDaniAnamApprovedMemoryHistory(identity)
            : [];
        const guest = cookieValue(request, DANI_ANAM_GUEST_COOKIE) === '1'
            && !daniContact
            && !identity;

        return json(status({
            authenticated: guest || Boolean(daniContact) || Boolean(identity),
            displayName: identity?.displayName ?? daniContact?.displayName ?? null,
            secureEmailCaptured: Boolean(daniContact),
            followUpAuthorized: Boolean(daniContact),
            guest,
            emailFollowUpAvailable: emailConfig.effectiveGateOpen,
            memoryAvailable: memoryEnrollmentAvailable,
            memoryVerified: Boolean(identity),
            memoryCount: history.length,
            lastMemoryAt: history[0]?.approvedAt ?? null,
        }));
    } catch {
        return json({ error: 'Dani session access is temporarily unavailable' }, { status: 503 });
    }
}

export async function POST(request: Request) {
    try {
        if (!isTrustedBrowserOrigin(request)) {
            return json({ error: 'Request origin is not allowed' }, { status: 403 });
        }
        const spine = readAmyAnamSpineConfig();
        const daniSession = readDaniAnamSessionSecrets();
        if (!spine.gatesOpen || !daniSession.configured) {
            return json({ error: 'Dani session access is temporarily unavailable' }, { status: 503 });
        }
        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: requestFingerprint(request, 'dani-session-access'),
            limit: 10,
            windowSeconds: 15 * 60,
        });
        if (!rate.allowed) {
            return json({ error: 'Too many session attempts' }, {
                status: 429,
                headers: { 'Retry-After': String(rate.retryAfterSeconds) },
            });
        }

        const body = await readBoundedJsonObject(request, 4 * 1024);
        const allowedFields = new Set([
            'guest',
            'displayName',
            'email',
            'followUpConsent',
            'memoryConsent',
        ]);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return json({ error: 'Session request contained unsupported fields' }, { status: 400 });
        }

        const existingBrowser = readDaniAnamBrowserSession(request, daniSession.sessionSecret);
        const created = existingBrowser
            ? null
            : createDaniAnamBrowserSessionWithSecret(daniSession.sessionSecret);
        const browserSession = existingBrowser ?? created?.session;
        if (!browserSession) throw new Error('Dani browser session could not be created');
        const emailConfig = readDaniAnamAgentMailConfig();
        const memoryConfig = readDaniAnamMemoryConfig();
        const memoryEnrollmentAvailable = memoryConfig.gatesOpen && emailConfig.effectiveGateOpen;

        if (body.guest === true) {
            if (Object.keys(body).some(key => key !== 'guest')) {
                return json({ error: 'Guest access cannot include contact details' }, { status: 400 });
            }
            await clearDaniAnamFollowUpAuthorization(browserSession.id).catch(() => undefined);
            if (memoryConfig.gatesOpen) {
                await deleteDaniAnamBrowserIdentity(browserSession.id).catch(() => undefined);
            }
            const response = json(status({
                authenticated: true,
                guest: true,
                emailFollowUpAvailable: emailConfig.effectiveGateOpen,
                memoryAvailable: memoryEnrollmentAvailable,
            }));
            if (created) {
                response.cookies.set(DANI_ANAM_BROWSER_COOKIE, created.token, daniAnamSessionCookieOptions());
            }
            response.cookies.set(DANI_ANAM_CONTACT_COOKIE, '', daniAnamContactCookieOptions(0));
            response.cookies.set(DANI_ANAM_GUEST_COOKIE, '1', daniAnamSessionCookieOptions());
            return response;
        }
        if (Object.hasOwn(body, 'guest')) {
            return json({ error: 'Choose a verified email option or continue as a guest' }, { status: 400 });
        }

        const followUpConsent = body.followUpConsent === true;
        const memoryConsent = body.memoryConsent === true;
        if (!followUpConsent && !memoryConsent) {
            return json({ error: 'Choose email follow-up, returning memory, or continue as a guest' }, { status: 400 });
        }
        if (followUpConsent && !emailConfig.effectiveGateOpen) {
            return json({ error: 'Email follow-up is temporarily unavailable; continue without email instead' }, { status: 503 });
        }
        if (memoryConsent && !memoryEnrollmentAvailable) {
            return json({ error: 'Dani returning memory is temporarily unavailable' }, { status: 503 });
        }

        const displayName = typeof body.displayName === 'string'
            ? body.displayName.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120)
            : '';
        const email = normalizeDaniAnamMemoryEmail(typeof body.email === 'string' ? body.email : '');
        if (displayName.length < 2 || /^(?:user|visitor|guest|customer)$/i.test(displayName)) {
            return json({ error: 'Enter the name you would like Dani to use' }, { status: 400 });
        }
        const followUpToken = followUpConsent
            ? createDaniAnamContactToken({
                browserSessionId: browserSession.id,
                displayName,
                email,
                purpose: 'dani_follow_up',
                secret: daniSession.contactSecret,
            })
            : null;

        if (memoryConsent) {
            const challenge = await createDaniAnamOtpChallenge({
                browserSessionId: browserSession.id,
                displayName,
                email,
                memoryConsent: true,
                ...(followUpToken ? { encryptedFollowUpToken: followUpToken } : {}),
            });
            try {
                await sendDaniAnamMemoryVerificationEmail({
                    email,
                    verificationCode: challenge.verificationCode,
                    scope: followUpConsent ? 'memory_and_follow_up' : 'memory',
                });
            } catch {
                await cancelDaniAnamOtpChallenge(challenge.challengeId).catch(() => undefined);
                throw new Error('Dani memory verification email could not be delivered');
            }
            const response = json({
                authenticated: false,
                verificationRequired: true,
                challengeId: challenge.challengeId,
                expiresAt: challenge.expiresAt,
                followUpPending: followUpConsent,
                rawEmailReturned: false,
                verificationCodeReturned: false,
                memoryExistenceReturned: false,
            }, { status: 202 });
            if (created) {
                response.cookies.set(DANI_ANAM_BROWSER_COOKIE, created.token, daniAnamSessionCookieOptions());
            }
            response.cookies.set(DANI_ANAM_CONTACT_COOKIE, '', daniAnamContactCookieOptions(0));
            response.cookies.set(DANI_ANAM_GUEST_COOKIE, '', daniAnamSessionCookieOptions(0));
            return response;
        }

        if (!followUpToken) throw new Error('Dani follow-up authorization could not be created');
        const challenge = await createDaniAnamFollowUpOtpChallenge({
            browserSessionId: browserSession.id,
            contactToken: followUpToken,
            contactSecret: daniSession.contactSecret,
        });
        try {
            await sendDaniAnamMemoryVerificationEmail({
                email,
                verificationCode: challenge.verificationCode,
                scope: 'follow_up',
            });
        } catch {
            await cancelDaniAnamFollowUpOtpChallenge(challenge.challengeId).catch(() => undefined);
            throw new Error('Dani verification email could not be delivered');
        }
        const response = json({
            authenticated: false,
            verificationRequired: true,
            challengeId: challenge.challengeId,
            expiresAt: challenge.expiresAt,
            followUpPending: true,
            memoryPending: false,
            rawEmailReturned: false,
            verificationCodeReturned: false,
            memoryExistenceReturned: false,
        }, { status: 202 });
        if (created) {
            response.cookies.set(DANI_ANAM_BROWSER_COOKIE, created.token, daniAnamSessionCookieOptions());
        }
        response.cookies.set(DANI_ANAM_CONTACT_COOKIE, '', daniAnamContactCookieOptions(0));
        response.cookies.set(DANI_ANAM_GUEST_COOKIE, '', daniAnamSessionCookieOptions(0));
        return response;
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return json({ error: error.message }, { status: error.status });
        }
        const message = error instanceof Error ? error.message : '';
        if (/valid email/i.test(message)) {
            return json({ error: 'Enter a valid email address' }, { status: 400 });
        }
        if (/verification email/i.test(message)) {
            return json({ error: 'The verification code could not be delivered. Try again shortly.' }, { status: 502 });
        }
        console.error('[Dani Anam Access] Secure session access failed');
        return json({ error: 'Dani session access failed' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    if (!isTrustedBrowserOrigin(request)) {
        return json({ error: 'Request origin is not allowed' }, { status: 403 });
    }
    const daniSession = readDaniAnamSessionSecrets();
    const browser = daniSession.sessionConfigured
        ? readDaniAnamBrowserSession(request, daniSession.sessionSecret)
        : null;
    if (browser) {
        await clearDaniAnamFollowUpAuthorization(browser.id).catch(() => undefined);
        if (readDaniAnamMemoryConfig().gatesOpen) {
            await deleteDaniAnamBrowserIdentity(browser.id).catch(() => undefined);
        }
    }
    const response = json({ loggedOut: true });
    response.cookies.set(DANI_ANAM_BROWSER_COOKIE, '', daniAnamSessionCookieOptions(0));
    response.cookies.set(DANI_ANAM_CONTACT_COOKIE, '', daniAnamContactCookieOptions(0));
    response.cookies.set(DANI_ANAM_GUEST_COOKIE, '', daniAnamSessionCookieOptions(0));
    return response;
}
