import { NextResponse } from 'next/server';
import {
    AMY_ANAM_BROWSER_COOKIE, AmyAnamRequestError, amyAnamCookieOptions,
    createAmyAnamBrowserSessionWithSecret, isTrustedBrowserOrigin,
    readAmyAnamBrowserSession, readAmyAnamSpineConfig, readBoundedJsonObject, requestFingerprint,
} from '@/lib/anam/session-spine';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';
import {
    AMY_ANAM_CONTACT_COOKIE, amyAnamContactCookieOptions, createAmyAnamContactToken,
    readAmyAnamContactFromRequest,
} from '@/lib/anam/contact-token';
import { normalizeAmyAnamMemoryEmail } from '@/lib/anam/user-memory';
import { readEvanAnamAgentMailConfig } from '@/lib/anam/evan-agentmail';

function json(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}
const status = (authenticated: boolean, displayName: string | null = null, followUpAuthorized = false) => ({
    required: true, authenticated, displayName, secureEmailCaptured: authenticated,
    followUpAuthorized, rawEmailReturned: false,
});

export async function GET(request: Request) {
    try {
        const spine = readAmyAnamSpineConfig();
        if (!spine.gatesOpen || !readEvanAnamAgentMailConfig().effectiveGateOpen) {
            return json({ error: 'Evan email check-in is temporarily unavailable' }, { status: 503 });
        }
        const browser = readAmyAnamBrowserSession(request, spine.signingSecret);
        if (!browser) return json(status(false));
        const contact = readAmyAnamContactFromRequest({ request, browserSessionId: browser.id, secret: spine.signingSecret });
        return json(status(Boolean(contact), contact?.displayName ?? null, contact?.purpose === 'evan_follow_up'));
    } catch {
        return json({ error: 'Evan email check-in is temporarily unavailable' }, { status: 503 });
    }
}

export async function POST(request: Request) {
    try {
        if (!isTrustedBrowserOrigin(request)) return json({ error: 'Request origin is not allowed' }, { status: 403 });
        const spine = readAmyAnamSpineConfig();
        if (!spine.gatesOpen || !readEvanAnamAgentMailConfig().effectiveGateOpen) {
            return json({ error: 'Evan email check-in is temporarily unavailable' }, { status: 503 });
        }
        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: requestFingerprint(request, 'evan-email-access'), limit: 10, windowSeconds: 15 * 60,
        });
        if (!rate.allowed) return json({ error: 'Too many check-in attempts' }, {
            status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        });
        const body = await readBoundedJsonObject(request, 4 * 1024);
        const allowedFields = new Set(['displayName', 'email', 'followUpConsent']);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return json({ error: 'Check-in contained unsupported fields' }, { status: 400 });
        }
        const displayName = typeof body.displayName === 'string'
            ? body.displayName.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
        const email = normalizeAmyAnamMemoryEmail(typeof body.email === 'string' ? body.email : '');
        if (displayName.length < 2 || /^(?:user|visitor|guest|customer)$/i.test(displayName)) {
            return json({ error: 'Enter the name you would like Mullins to use' }, { status: 400 });
        }
        if (body.followUpConsent !== true) {
            return json({ error: 'Choose the session follow-up option to continue' }, { status: 400 });
        }
        const created = createAmyAnamBrowserSessionWithSecret(spine.signingSecret);
        const token = createAmyAnamContactToken({
            browserSessionId: created.session.id, displayName, email,
            purpose: 'evan_follow_up', secret: spine.signingSecret,
        });
        const response = json(status(true, displayName, true));
        response.cookies.set(AMY_ANAM_BROWSER_COOKIE, created.token, amyAnamCookieOptions());
        response.cookies.set(AMY_ANAM_CONTACT_COOKIE, token, amyAnamContactCookieOptions());
        return response;
    } catch (error) {
        if (error instanceof AmyAnamRequestError) return json({ error: error.message }, { status: error.status });
        if (error instanceof Error && /valid email/i.test(error.message)) {
            return json({ error: 'Enter a valid email address' }, { status: 400 });
        }
        console.error('[Evan Anam AgentMail] Secure check-in failed');
        return json({ error: 'Evan email check-in failed' }, { status: 500 });
    }
}

export async function DELETE() {
    const response = json({ loggedOut: true });
    response.cookies.set(AMY_ANAM_BROWSER_COOKIE, '', amyAnamCookieOptions(0));
    response.cookies.set(AMY_ANAM_CONTACT_COOKIE, '', amyAnamContactCookieOptions(0));
    return response;
}
