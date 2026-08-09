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
    DANI_ANAM_CONTACT_COOKIE,
    createAmyAnamContactToken,
    daniAnamContactCookieOptions,
    readDaniAnamContactFromRequest,
} from '@/lib/anam/contact-token';
import { normalizeAmyAnamMemoryEmail } from '@/lib/anam/user-memory';
import {
    clearDaniAnamFollowUpAuthorization,
    readDaniAnamAgentMailConfig,
    readDaniAnamFollowUpAuthorization,
    storeDaniAnamFollowUpAuthorization,
} from '@/lib/anam/dani-agentmail';

function json(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function status(input: {
    authenticated: boolean;
    displayName?: string | null;
    followUpAuthorized?: boolean;
    secureEmailCaptured?: boolean;
    guest?: boolean;
    emailFollowUpAvailable?: boolean;
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
        rawEmailReturned: false,
    };
}

export async function GET(request: Request) {
    try {
        const spine = readAmyAnamSpineConfig();
        if (!spine.gatesOpen) {
            return json({ error: 'Dani session access is temporarily unavailable' }, { status: 503 });
        }
        const emailFollowUpAvailable = readDaniAnamAgentMailConfig().effectiveGateOpen;
        const browser = readAmyAnamBrowserSession(request, spine.signingSecret);
        if (!browser) return json(status({ authenticated: false, emailFollowUpAvailable }));
        const cookieContact = readDaniAnamContactFromRequest({
            request,
            browserSessionId: browser.id,
            secret: spine.signingSecret,
        });
        const contact = cookieContact ?? (emailFollowUpAvailable
            ? await readDaniAnamFollowUpAuthorization({
                browserSessionId: browser.id,
                contactSecret: spine.signingSecret,
            })
            : null);
        const daniContact = contact?.purpose === 'dani_follow_up' ? contact : null;
        return json(status({
            authenticated: true,
            displayName: daniContact?.displayName ?? null,
            secureEmailCaptured: Boolean(daniContact),
            followUpAuthorized: Boolean(daniContact),
            guest: !daniContact,
            emailFollowUpAvailable,
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
        if (!spine.gatesOpen) {
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
        const allowedFields = new Set(['guest', 'displayName', 'email', 'followUpConsent']);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return json({ error: 'Session request contained unsupported fields' }, { status: 400 });
        }
        if (body.guest === true) {
            if (Object.keys(body).some(key => key !== 'guest')) {
                return json({ error: 'Guest access cannot include contact details' }, { status: 400 });
            }
            const existingBrowser = readAmyAnamBrowserSession(request, spine.signingSecret);
            const existingContact = existingBrowser
                ? readDaniAnamContactFromRequest({
                    request,
                    browserSessionId: existingBrowser.id,
                    secret: spine.signingSecret,
                })
                : null;
            const created = existingBrowser
                ? null
                : createAmyAnamBrowserSessionWithSecret(spine.signingSecret);
            if (existingBrowser) {
                await clearDaniAnamFollowUpAuthorization(existingBrowser.id);
            }
            const response = json(status({
                authenticated: true,
                guest: true,
                emailFollowUpAvailable: readDaniAnamAgentMailConfig().effectiveGateOpen,
            }));
            if (created) {
                response.cookies.set(AMY_ANAM_BROWSER_COOKIE, created.token, amyAnamCookieOptions());
            }
            if (existingContact?.purpose === 'dani_follow_up') {
                response.cookies.set(DANI_ANAM_CONTACT_COOKIE, '', daniAnamContactCookieOptions(0));
            }
            return response;
        }
        if (Object.hasOwn(body, 'guest')) {
            return json({ error: 'Choose email follow-up or continue as a guest' }, { status: 400 });
        }
        if (!readDaniAnamAgentMailConfig().effectiveGateOpen) {
            return json({ error: 'Email follow-up is temporarily unavailable; continue without email instead' }, { status: 503 });
        }

        const displayName = typeof body.displayName === 'string'
            ? body.displayName.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120)
            : '';
        const email = normalizeAmyAnamMemoryEmail(typeof body.email === 'string' ? body.email : '');
        if (displayName.length < 2 || /^(?:user|visitor|guest|customer)$/i.test(displayName)) {
            return json({ error: 'Enter the name you would like Dani to use' }, { status: 400 });
        }
        if (body.followUpConsent !== true) {
            return json({ error: 'Choose the email recap option to continue with email' }, { status: 400 });
        }

        const existingBrowser = readAmyAnamBrowserSession(request, spine.signingSecret);
        const created = existingBrowser
            ? null
            : createAmyAnamBrowserSessionWithSecret(spine.signingSecret);
        const browserSession = existingBrowser ?? created?.session;
        if (!browserSession) throw new Error('Dani browser session could not be created');
        const token = createAmyAnamContactToken({
            browserSessionId: browserSession.id,
            displayName,
            email,
            purpose: 'dani_follow_up',
            secret: spine.signingSecret,
        });
        await storeDaniAnamFollowUpAuthorization({
            browserSessionId: browserSession.id,
            contactToken: token,
            contactSecret: spine.signingSecret,
        });
        console.info('[Dani Anam Access] Follow-up authorization stored', {
            mode: 'email',
            rawEmailLogged: false,
        });
        const response = json(status({
            authenticated: true,
            displayName,
            secureEmailCaptured: true,
            followUpAuthorized: true,
            emailFollowUpAvailable: true,
        }));
        if (created) {
            response.cookies.set(AMY_ANAM_BROWSER_COOKIE, created.token, amyAnamCookieOptions());
        }
        response.cookies.set(DANI_ANAM_CONTACT_COOKIE, token, daniAnamContactCookieOptions());
        return response;
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return json({ error: error.message }, { status: error.status });
        }
        const message = error instanceof Error ? error.message : '';
        if (/valid email/i.test(message)) {
            return json({ error: 'Enter a valid email address' }, { status: 400 });
        }
        console.error('[Dani Anam Access] Secure session access failed');
        return json({ error: 'Dani session access failed' }, { status: 500 });
    }
}

export async function DELETE() {
    const response = json({ loggedOut: true });
    response.cookies.set(DANI_ANAM_CONTACT_COOKIE, '', daniAnamContactCookieOptions(0));
    return response;
}
