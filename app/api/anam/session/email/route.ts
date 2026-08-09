import { NextResponse } from 'next/server';
import { queueAmyAnamConversationFollowUp } from '@/lib/anam/agentmail';
import {
    cancelDaniAnamConversationFollowUp,
    queueDaniAnamConversationFollowUp,
} from '@/lib/anam/dani-agentmail';
import { queueEvanAnamConversationFollowUp } from '@/lib/anam/evan-agentmail';
import { DANI_PERSONA_ID, EVAN_PERSONA_ID } from '@/lib/anam/persona-readiness';
import {
    readAmyAnamContactFromRequest,
    readDaniAnamContactFromRequest,
} from '@/lib/anam/contact-token';
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
import { resolveAnamSessionAgentSlug } from '@/lib/anam/session-spine';
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
        const sharedContact = readAmyAnamContactFromRequest({
            request,
            browserSessionId: browserSession.id,
            secret: spine.signingSecret,
        });
        const daniContact = readDaniAnamContactFromRequest({
            request,
            browserSessionId: browserSession.id,
            secret: spine.signingSecret,
        });
        if (!sharedContact && !daniContact) {
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
        if (typeof body.userConfirmed !== 'boolean') {
            return noStoreJson({ error: 'A valid email preference is required' }, { status: 400 });
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
        const sessionAgentSlug = session
            ? resolveAnamSessionAgentSlug(session.resolvedPersonaId, session.agentSlug)
            : null;
        const launchAgentSlug = launch
            ? resolveAnamSessionAgentSlug(launch.resolvedPersonaId, launch.agentSlug)
            : null;
        const isEvan = session?.resolvedPersonaId === EVAN_PERSONA_ID
            && launch?.resolvedPersonaId === EVAN_PERSONA_ID
            && sessionAgentSlug === 'evan'
            && launchAgentSlug === 'evan';
        const isDani = session?.resolvedPersonaId === DANI_PERSONA_ID
            && launch?.resolvedPersonaId === DANI_PERSONA_ID
            && sessionAgentSlug === 'dani'
            && launchAgentSlug === 'dani';
        const contact = isDani ? daniContact : sharedContact;
        if (!contact) {
            return noStoreJson({ error: 'Follow-up consent was not confirmed for this persona' }, { status: 409 });
        }
        if (isEvan && contact.purpose !== 'evan_follow_up') {
            return noStoreJson({ error: 'Evan follow-up consent was not confirmed' }, { status: 409 });
        }
        if (isDani && contact.purpose !== 'dani_follow_up') {
            return noStoreJson({ error: 'Dani follow-up consent was not confirmed' }, { status: 409 });
        }
        const isAmy = sessionAgentSlug === 'amy' && launchAgentSlug === 'amy';
        if (!isAmy && !isDani && !isEvan) {
            return noStoreJson({ error: 'Email is unavailable for this persona' }, { status: 409 });
        }
        if (!ownershipMatches) {
            return noStoreJson({ error: 'Email session ownership could not be confirmed' }, { status: 409 });
        }
        if (body.userConfirmed === false) {
            if (!isDani) {
                return noStoreJson({ error: 'Explicit email permission is required' }, { status: 400 });
            }
            const result = await cancelDaniAnamConversationFollowUp({
                externalSessionId: sessionId,
                browserSessionId: browserSession.id,
            });
            return noStoreJson({
                ...result,
                rawEmailReturned: false,
                messageContentReturned: false,
            });
        }
        const displayName = isDani || isEvan ? contact.displayName : identity?.displayName;
        if (!displayName) {
            return noStoreJson({ error: 'Email session ownership could not be confirmed' }, { status: 409 });
        }

        const queueFollowUp = isDani
            ? queueDaniAnamConversationFollowUp
            : isEvan
                ? queueEvanAnamConversationFollowUp
                : queueAmyAnamConversationFollowUp;
        const result = await queueFollowUp({
            externalSessionId: sessionId,
            browserSessionId: browserSession.id,
            displayName,
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
            return noStoreJson({ error: 'Email is temporarily unavailable' }, { status: 503 });
        }
        console.error('[Anam AgentMail] Post-session email intent was not recorded');
        return noStoreJson({ error: 'The follow-up email could not be scheduled' }, { status: 502 });
    }
}
