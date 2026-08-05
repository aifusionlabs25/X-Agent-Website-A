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
    readAmyAnamContactFromRequest,
} from '@/lib/anam/contact-token';
import { normalizeAmyAnamMemoryEmail } from '@/lib/anam/user-memory';
import { readEvanAnamAgentMailConfig } from '@/lib/anam/evan-agentmail';

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
            return json({ error: 'Evan session access is temporarily unavailable' }, { status: 503 });
        }
        const emailFollowUpAvailable = readEvanAnamAgentMailConfig().effectiveGateOpen;
        const browser = readAmyAnamBrowserSession(request, spine.signingSecret);
        if (!browser) return json(status({ authenticated: false, emailFollowUpAvailable }));

        const contact = readAmyAnamContactFromRequest({
            request,
            browserSessionId: browser.id,
            secret: spine.signingSecret,
        });
        return json(status({
            authenticated: true,
            displayName: contact?.displayName ?? null,
            secureEmailCaptured: Boolean(contact),
            followUpAuthorized: contact?.purpose === 'evan_follow_up',
            guest: !contact,
            emailFollowUpAvailable,
        }));
    } catch {
        return json({ error: 'Evan session access is temporarily unavailable' }, { status: 503 });
    }
}

export async function POST(request: Request) {
    try {
        if (!isTrustedBrowserOrigin(request)) {
            return json({ error: 'Request origin is not allowed' }, { status: 403 });
        }

        const spine = readAmyAnamSpineConfig();
        if (!spine.gatesOpen) {
            return json({ error: 'Evan session access is temporarily unavailable' }, { status: 503 });
        }

        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: requestFingerprint(request, 'evan-session-access'),
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
            const created = createAmyAnamBrowserSessionWithSecret(spine.signingSecret);
            const response = json(status({
                authenticated: true,
                guest: true,
                emailFollowUpAvailable: readEvanAnamAgentMailConfig().effectiveGateOpen,
            }));
            response.cookies.set(AMY_ANAM_BROWSER_COOKIE, created.token, amyAnamCookieOptions());
            response.cookies.set(AMY_ANAM_CONTACT_COOKIE, '', amyAnamContactCookieOptions(0));
            return response;
        }

        if (Object.hasOwn(body, 'guest')) {
            return json({ error: 'Choose email follow-up or continue as a guest' }, { status: 400 });
        }
        if (!readEvanAnamAgentMailConfig().effectiveGateOpen) {
            return json({ error: 'Email follow-up is temporarily unavailable; continue without email instead' }, { status: 503 });
        }

        const displayName = typeof body.displayName === 'string'
            ? body.displayName.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120)
            : '';
        const email = normalizeAmyAnamMemoryEmail(typeof body.email === 'string' ? body.email : '');
        if (displayName.length < 2 || /^(?:user|visitor|guest|customer)$/i.test(displayName)) {
            return json({ error: 'Enter the name you would like Mullins to use' }, { status: 400 });
        }
        if (body.followUpConsent !== true) {
            return json({ error: 'Choose the email recap option to continue with email' }, { status: 400 });
        }

        const created = createAmyAnamBrowserSessionWithSecret(spine.signingSecret);
        const token = createAmyAnamContactToken({
            browserSessionId: created.session.id,
            displayName,
            email,
            purpose: 'evan_follow_up',
            secret: spine.signingSecret,
        });
        const response = json(status({
            authenticated: true,
            displayName,
            secureEmailCaptured: true,
            followUpAuthorized: true,
            emailFollowUpAvailable: true,
        }));
        response.cookies.set(AMY_ANAM_BROWSER_COOKIE, created.token, amyAnamCookieOptions());
        response.cookies.set(AMY_ANAM_CONTACT_COOKIE, token, amyAnamContactCookieOptions());
        return response;
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return json({ error: error.message }, { status: error.status });
        }
        if (error instanceof Error && /valid email/i.test(error.message)) {
            return json({ error: 'Enter a valid email address' }, { status: 400 });
        }
        console.error('[Evan Anam Access] Secure session access failed');
        return json({ error: 'Evan session access failed' }, { status: 500 });
    }
}

export async function DELETE() {
    const response = json({ loggedOut: true });
    response.cookies.set(AMY_ANAM_BROWSER_COOKIE, '', amyAnamCookieOptions(0));
    response.cookies.set(AMY_ANAM_CONTACT_COOKIE, '', amyAnamContactCookieOptions(0));
    return response;
}
