import { NextResponse } from 'next/server';
import { queueAmyAnamConversationFollowUp } from '@/lib/anam/agentmail';
import { readAmyAnamContactFromRequest } from '@/lib/anam/contact-token';
import {
    AmyAnamRequestError,
    isTrustedBrowserOrigin,
    isUuid,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
} from '@/lib/anam/session-spine';
import {
    consumeAmyAnamDistributedRateLimit,
    readAmyAnamLaunch,
    readAmyAnamSession,
} from '@/lib/anam/session-spine-store';
import { readAmyAnamBrowserIdentity } from '@/lib/anam/user-memory';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    try {
        if (!isTrustedBrowserOrigin(request)) {
            return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
        }
        const spine = readAmyAnamSpineConfig();
        if (!spine.gatesOpen) {
            return noStoreJson({ error: 'Amy session tracking is unavailable' }, { status: 503 });
        }
        const browserSession = readAmyAnamBrowserSession(request, spine.signingSecret);
        if (!browserSession) {
            return noStoreJson({ error: 'Session ownership is required' }, { status: 401 });
        }
        const contact = readAmyAnamContactFromRequest({
            request,
            browserSessionId: browserSession.id,
            secret: spine.signingSecret,
        });
        if (!contact) {
            return noStoreJson({ error: 'A private checked-in email is required' }, { status: 409 });
        }

        const body = await readBoundedJsonObject(request, 8 * 1024);
        const allowedFields = new Set(['launchId', 'sessionId', 'userConfirmed']);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return noStoreJson({ error: 'Email request contained unsupported fields' }, { status: 400 });
        }
        const launchId = typeof body.launchId === 'string' ? body.launchId.trim() : '';
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        if (!isUuid(launchId) || !isUuid(sessionId)) {
            return noStoreJson({ error: 'Valid launch and session IDs are required' }, { status: 400 });
        }
        if (body.userConfirmed !== true) {
            return noStoreJson({ error: 'Explicit email permission is required' }, { status: 400 });
        }

        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: `agentmail:${browserSession.id}`,
            limit: 3,
            windowSeconds: 60 * 60,
        });
        if (!rate.allowed) {
            return noStoreJson(
                { error: 'Too many email attempts' },
                { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
            );
        }

        const [launch, session, identity] = await Promise.all([
            readAmyAnamLaunch(launchId),
            readAmyAnamSession(sessionId),
            readAmyAnamBrowserIdentity(browserSession.id),
        ]);
        const ownershipMatches = launch?.browserSessionId === browserSession.id
            && launch.launchId === launchId
            && launch.boundSessionId === sessionId
            && session?.browserSessionId === browserSession.id
            && session.launchId === launchId
            && session.externalSessionId === sessionId;
        if (!ownershipMatches || !identity) {
            return noStoreJson({ error: 'Email session ownership could not be confirmed' }, { status: 409 });
        }

        const result = await queueAmyAnamConversationFollowUp({
            externalSessionId: sessionId,
            browserSessionId: browserSession.id,
            displayName: identity.displayName,
            email: contact.email,
            contactSecret: spine.signingSecret,
        });
        return noStoreJson({
            ...result,
            rawEmailReturned: false,
            messageContentReturned: false,
        });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        const message = error instanceof Error ? error.message : '';
        if (/unavailable|not configured/i.test(message)) {
            return noStoreJson({ error: 'Amy email is temporarily unavailable' }, { status: 503 });
        }
        console.error('[Amy Anam AgentMail] Post-session email intent was not recorded');
        return noStoreJson({ error: 'Amy could not schedule the post-session email' }, { status: 502 });
    }
}
