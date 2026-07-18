import { NextResponse } from 'next/server';
import { verifyAmyAnamLiveIdentity } from '@/lib/anam/live-identity';
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
import {
    readAmyAnamApprovedMemoryHistory,
    readAmyAnamBrowserIdentity,
    readAmyAnamMemoryConfig,
} from '@/lib/anam/user-memory';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    try {
        const spineConfig = readAmyAnamSpineConfig();
        const memoryConfig = readAmyAnamMemoryConfig();
        if (!spineConfig.gatesOpen || !memoryConfig.gatesOpen) {
            return noStoreJson({ error: 'Amy returning memory is unavailable' }, { status: 503 });
        }
        if (!isTrustedBrowserOrigin(request)) {
            return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
        }

        const browserSession = readAmyAnamBrowserSession(request, spineConfig.signingSecret);
        if (!browserSession) {
            return noStoreJson({ error: 'Session ownership is required' }, { status: 401 });
        }

        const body = await readBoundedJsonObject(request, 2 * 1024);
        const launchId = typeof body.launchId === 'string' ? body.launchId.trim() : '';
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        const preferredName = body.preferredName;
        const memoryAccessConfirmed = body.memoryAccessConfirmed;
        if (!isUuid(launchId) || !isUuid(sessionId)) {
            return noStoreJson({ error: 'Valid launch and session IDs are required' }, { status: 400 });
        }

        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: `live-identity:${browserSession.id}`,
            limit: 5,
            windowSeconds: 10 * 60,
        });
        if (!rate.allowed) {
            return noStoreJson(
                { error: 'Too many identity confirmation attempts' },
                { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
            );
        }

        const [launch, session, browserIdentity] = await Promise.all([
            readAmyAnamLaunch(launchId),
            readAmyAnamSession(sessionId),
            readAmyAnamBrowserIdentity(browserSession.id),
        ]);
        if (!launch || !session || !browserIdentity) {
            return noStoreJson({ error: 'Live identity could not be confirmed' }, { status: 409 });
        }
        const ownershipMatches = launch.browserSessionId === browserSession.id
            && launch.boundSessionId === sessionId
            && session.browserSessionId === browserSession.id
            && session.launchId === launchId
            && session.externalSessionId === sessionId;
        if (!ownershipMatches) {
            return noStoreJson({ error: 'Live identity could not be confirmed' }, { status: 409 });
        }

        const identityVerification = verifyAmyAnamLiveIdentity({
            preferredName,
            memoryAccessConfirmed,
            browserIdentity,
            approvedHistory: [],
        });
        if (!identityVerification) {
            return noStoreJson({ error: 'Live identity could not be confirmed' }, { status: 409 });
        }

        const approvedHistory = await readAmyAnamApprovedMemoryHistory(browserIdentity);
        const verification = verifyAmyAnamLiveIdentity({
            preferredName: identityVerification.preferredName,
            memoryAccessConfirmed: true,
            browserIdentity,
            approvedHistory,
        });
        if (!verification) throw new Error('Verified identity state changed unexpectedly');

        return noStoreJson({
            confirmed: true,
            memoryUnlocked: true,
            preferredName: verification.preferredName,
            memoryContext: verification.memoryContext,
            memoryCount: verification.memoryCount,
            rawEmailReturned: false,
            identityHashReturned: false,
        });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        if (error instanceof Error && /preferred name|memory permission/i.test(error.message)) {
            return noStoreJson({ error: 'Live identity could not be confirmed' }, { status: 400 });
        }
        console.error('[Amy Anam Live Identity] Failed');
        return noStoreJson({ error: 'Live identity confirmation failed' }, { status: 500 });
    }
}
