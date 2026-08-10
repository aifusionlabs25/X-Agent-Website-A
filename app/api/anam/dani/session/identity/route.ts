import { NextResponse } from 'next/server';
import { DANI_PERSONA_ID } from '@/lib/anam/persona-ids';
import { verifyDaniAnamLiveIdentity } from '@/lib/anam/dani-live-identity';
import {
    readDaniAnamBrowserSession,
    readDaniAnamSessionSecrets,
} from '@/lib/anam/dani-session';
import {
    readDaniAnamApprovedMemoryHistory,
    readDaniAnamBrowserIdentity,
    readDaniAnamMemoryConfig,
    readDaniAnamSessionMemoryIdentity,
} from '@/lib/anam/dani-user-memory';
import {
    AmyAnamRequestError,
    isTrustedBrowserOrigin,
    isUuid,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    resolveAnamSessionAgentSlug,
} from '@/lib/anam/session-spine';
import {
    consumeAmyAnamDistributedRateLimit,
    readAmyAnamLaunch,
    readAmyAnamSession,
} from '@/lib/anam/session-spine-store';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    try {
        const spine = readAmyAnamSpineConfig();
        const memory = readDaniAnamMemoryConfig();
        const daniSession = readDaniAnamSessionSecrets();
        if (!spine.gatesOpen || !memory.gatesOpen || !daniSession.configured) {
            return noStoreJson({ error: 'Dani returning memory is unavailable' }, { status: 503 });
        }
        if (!isTrustedBrowserOrigin(request)) {
            return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
        }
        const browserSession = readDaniAnamBrowserSession(
            request,
            daniSession.sessionSecret,
        );
        if (!browserSession) {
            return noStoreJson({ error: 'Dani session ownership is required' }, { status: 401 });
        }

        const body = await readBoundedJsonObject(request, 2 * 1024);
        const allowedFields = new Set([
            'launchId',
            'sessionId',
            'preferredName',
            'memoryAccessConfirmed',
        ]);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return noStoreJson({ error: 'Identity request contained unsupported fields' }, { status: 400 });
        }
        const launchId = typeof body.launchId === 'string' ? body.launchId.trim() : '';
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        if (!isUuid(launchId) || !isUuid(sessionId)) {
            return noStoreJson({ error: 'Valid launch and session IDs are required' }, { status: 400 });
        }

        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: `dani-live-identity:${browserSession.id}`,
            limit: 5,
            windowSeconds: 10 * 60,
        });
        if (!rate.allowed) {
            return noStoreJson(
                { error: 'Too many identity confirmation attempts' },
                { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
            );
        }

        const [launch, session, browserIdentity, sessionIdentity] = await Promise.all([
            readAmyAnamLaunch(launchId),
            readAmyAnamSession(sessionId),
            readDaniAnamBrowserIdentity(browserSession.id),
            readDaniAnamSessionMemoryIdentity(sessionId),
        ]);
        if (!launch || !session || !browserIdentity || !sessionIdentity) {
            return noStoreJson({ error: 'Dani live identity could not be confirmed' }, { status: 409 });
        }
        const personaMatches = launch.resolvedPersonaId === DANI_PERSONA_ID
            && session.resolvedPersonaId === DANI_PERSONA_ID
            && sessionIdentity.personaId === DANI_PERSONA_ID
            && resolveAnamSessionAgentSlug(launch.resolvedPersonaId, launch.agentSlug) === 'dani'
            && resolveAnamSessionAgentSlug(session.resolvedPersonaId, session.agentSlug) === 'dani';
        const ownershipMatches = launch.browserSessionId === browserSession.id
            && launch.boundSessionId === sessionId
            && session.browserSessionId === browserSession.id
            && session.launchId === launchId
            && session.externalSessionId === sessionId
            && sessionIdentity.browserSessionId === browserSession.id
            && sessionIdentity.emailIdentityHash === browserIdentity.emailIdentityHash
            && sessionIdentity.consentEpoch === browserIdentity.consentEpoch;
        if (!personaMatches || !ownershipMatches) {
            return noStoreJson({ error: 'Dani live identity could not be confirmed' }, { status: 409 });
        }

        const initialVerification = verifyDaniAnamLiveIdentity({
            preferredName: body.preferredName,
            memoryAccessConfirmed: body.memoryAccessConfirmed,
            browserIdentity,
            approvedHistory: [],
        });
        if (!initialVerification) {
            return noStoreJson({ error: 'Dani live identity could not be confirmed' }, { status: 409 });
        }
        const approvedHistory = await readDaniAnamApprovedMemoryHistory(browserIdentity);
        const verification = verifyDaniAnamLiveIdentity({
            preferredName: initialVerification.preferredName,
            memoryAccessConfirmed: true,
            browserIdentity,
            approvedHistory,
        });
        if (!verification) throw new Error('Dani verified identity state changed unexpectedly');

        return noStoreJson({
            confirmed: true,
            memoryUnlocked: true,
            preferredName: verification.preferredName,
            memoryContext: verification.memoryContext,
            memoryCount: verification.memoryCount,
            rawEmailReturned: false,
            identityHashReturned: false,
            verificationCodeReturned: false,
        });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        if (error instanceof Error && /preferred name|memory permission/i.test(error.message)) {
            return noStoreJson({ error: 'Dani live identity could not be confirmed' }, { status: 400 });
        }
        console.error('[Dani Anam Live Identity] Failed');
        return noStoreJson({ error: 'Dani live identity confirmation failed' }, { status: 500 });
    }
}
