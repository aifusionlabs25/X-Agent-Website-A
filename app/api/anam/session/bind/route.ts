import { NextResponse } from 'next/server';
import { verifyAnamSessionForLaunch, AnamSessionApiError } from '@/lib/anam/session-api';
import { DANI_PERSONA_ID, EVAN_PERSONA_ID } from '@/lib/anam/persona-readiness';
import {
    readAmyAnamContactFromRequest,
    readDaniAnamContactFromRequest,
} from '@/lib/anam/contact-token';
import {
    queueDaniAnamConversationFollowUp,
    readDaniAnamFollowUpAuthorization,
} from '@/lib/anam/dani-agentmail';
import { queueEvanAnamConversationFollowUp } from '@/lib/anam/evan-agentmail';
import {
    AmyAnamRequestError,
    isTrustedBrowserOrigin,
    isUuid,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    resolveAnamSessionAgentSlug,
} from '@/lib/anam/session-spine';
import {
    bindAmyAnamLaunch,
    consumeAmyAnamDistributedRateLimit,
    readAmyAnamLaunch,
} from '@/lib/anam/session-spine-store';
import {
    linkAmyAnamSessionMemoryIdentity,
    readAmyAnamMemoryConfig,
} from '@/lib/anam/user-memory';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    try {
        const config = readAmyAnamSpineConfig();
        if (!config.gatesOpen) {
            return noStoreJson({ error: 'Amy session tracking is unavailable' }, { status: 503 });
        }
        if (!isTrustedBrowserOrigin(request)) {
            return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
        }

        const browserSession = readAmyAnamBrowserSession(request, config.signingSecret);
        if (!browserSession) {
            return noStoreJson({ error: 'Session ownership is required' }, { status: 401 });
        }

        const body = await readBoundedJsonObject(request, 1024);
        const launchId = typeof body.launchId === 'string' ? body.launchId.trim() : '';
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        if (!isUuid(launchId) || !isUuid(sessionId)) {
            return noStoreJson({ error: 'Valid launch and session IDs are required' }, { status: 400 });
        }

        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: `bind:${browserSession.id}`,
            limit: 10,
            windowSeconds: 10 * 60,
        });
        if (!rate.allowed) {
            return noStoreJson(
                { error: 'Too many session binding attempts' },
                { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
            );
        }

        const launch = await readAmyAnamLaunch(launchId);
        if (!launch) {
            return noStoreJson({ error: 'Session launch was not found' }, { status: 404 });
        }
        if (launch.browserSessionId !== browserSession.id) {
            return noStoreJson({ error: 'Session ownership did not match' }, { status: 403 });
        }

        await verifyAnamSessionForLaunch(sessionId, launch);
        const status = await bindAmyAnamLaunch({
            launch,
            browserSessionId: browserSession.id,
            externalSessionId: sessionId,
        });

        if (status === 'bound' || status === 'duplicate') {
            const launchAgentSlug = resolveAnamSessionAgentSlug(
                launch.resolvedPersonaId,
                launch.agentSlug,
            );
            const memoryConfig = readAmyAnamMemoryConfig();
            let memoryIdentityLinked = false;
            let daniFollowUpQueued = false;
            let daniFollowUpDuplicate = false;
            let evanFollowUpQueued = false;
            let evanFollowUpDuplicate = false;
            if (memoryConfig.gatesOpen && launchAgentSlug === 'amy') {
                const memoryLinkStatus = await linkAmyAnamSessionMemoryIdentity({
                    browserSessionId: browserSession.id,
                    externalSessionId: sessionId,
                });
                if (memoryLinkStatus === 'conflict') {
                    return noStoreJson({ error: 'Memory session identity conflicted' }, { status: 409 });
                }
                memoryIdentityLinked = memoryLinkStatus === 'linked'
                    || memoryLinkStatus === 'duplicate';
            }
            if (launch.resolvedPersonaId === DANI_PERSONA_ID && launchAgentSlug === 'dani') {
                const cookieContact = readDaniAnamContactFromRequest({
                    request,
                    browserSessionId: browserSession.id,
                    secret: config.signingSecret,
                });
                const storedContact = cookieContact ? null : await readDaniAnamFollowUpAuthorization({
                    browserSessionId: browserSession.id,
                    contactSecret: config.signingSecret,
                });
                const contact = cookieContact ?? storedContact;
                if (contact?.displayName && contact.purpose === 'dani_follow_up') {
                    const queued = await queueDaniAnamConversationFollowUp({
                        externalSessionId: sessionId,
                        browserSessionId: browserSession.id,
                        displayName: contact.displayName,
                        email: contact.email,
                        contactSecret: config.signingSecret,
                    });
                    daniFollowUpQueued = queued.queued;
                    daniFollowUpDuplicate = queued.duplicate;
                }
                console.info('[Dani Anam Bind] Follow-up intent result', {
                    contactSource: cookieContact ? 'cookie' : storedContact ? 'server_authorization' : 'none',
                    queued: daniFollowUpQueued,
                    duplicate: daniFollowUpDuplicate,
                    contactContentLogged: false,
                });
            }
            if (launch.resolvedPersonaId === EVAN_PERSONA_ID) {
                const contact = readAmyAnamContactFromRequest({
                    request,
                    browserSessionId: browserSession.id,
                    secret: config.signingSecret,
                });
                if (contact?.displayName && contact.purpose === 'evan_follow_up') {
                    const queued = await queueEvanAnamConversationFollowUp({
                        externalSessionId: sessionId,
                        browserSessionId: browserSession.id,
                        displayName: contact.displayName,
                        email: contact.email,
                        contactSecret: config.signingSecret,
                    });
                    evanFollowUpQueued = queued.queued;
                    evanFollowUpDuplicate = queued.duplicate;
                }
            }
            return noStoreJson({
                bound: true,
                duplicate: status === 'duplicate',
                canary: true,
                memoryIdentityLinked,
                daniFollowUpQueued,
                daniFollowUpDuplicate,
                evanFollowUpQueued,
                evanFollowUpDuplicate,
                outbound: false,
            });
        }
        if (status === 'missing') {
            return noStoreJson({ error: 'Session launch expired' }, { status: 404 });
        }
        if (status === 'owner_mismatch' || status === 'persona_mismatch') {
            return noStoreJson({ error: 'Session ownership did not match' }, { status: 403 });
        }
        return noStoreJson({ error: 'Session is already bound' }, { status: 409 });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        if (error instanceof AnamSessionApiError) {
            return noStoreJson(
                { error: error.status === 403 ? 'Session verification failed' : 'Session verification is pending' },
                { status: error.status === 403 ? 403 : 503 },
            );
        }
        console.error('[Amy Anam Bind] Failed');
        return noStoreJson({ error: 'Session binding failed' }, { status: 500 });
    }
}
