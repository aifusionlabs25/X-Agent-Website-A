import { after, NextResponse } from 'next/server';
import { finalizeAmyAnamSession } from '@/lib/anam/session-finalizer';
import {
    isValidAnamSessionId,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
} from '@/lib/anam/session-spine';
import {
    consumeAmyAnamDistributedRateLimit,
    readAmyAnamFinalization,
    readAmyAnamReceipt,
    readAmyAnamSession,
} from '@/lib/anam/session-spine-store';

export const maxDuration = 60;

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function GET(request: Request) {
    try {
        const config = readAmyAnamSpineConfig();
        if (!config.gatesOpen) {
            return noStoreJson({ error: 'Amy session tracking is unavailable' }, { status: 503 });
        }

        const browserSession = readAmyAnamBrowserSession(request, config.signingSecret);
        if (!browserSession) {
            return noStoreJson({ error: 'Session ownership is required' }, { status: 401 });
        }

        const sessionId = new URL(request.url).searchParams.get('sessionId')?.trim() ?? '';
        if (!isValidAnamSessionId(sessionId)) {
            return noStoreJson({ error: 'A valid session ID is required' }, { status: 400 });
        }

        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: `status:${browserSession.id}`,
            limit: 60,
            windowSeconds: 10 * 60,
        });
        if (!rate.allowed) {
            return noStoreJson(
                { error: 'Too many status requests' },
                { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
            );
        }

        const [session, finalization] = await Promise.all([
            readAmyAnamSession(sessionId),
            readAmyAnamFinalization(sessionId),
        ]);
        if (!session && !finalization) return noStoreJson({ found: false });
        if (
            (session && session.browserSessionId !== browserSession.id)
            || (finalization && finalization.browserSessionId !== browserSession.id)
        ) {
            return noStoreJson({ error: 'Session ownership did not match' }, { status: 403 });
        }

        const receipt = await readAmyAnamReceipt(sessionId);
        if (
            !receipt
            && (
                finalization?.state === 'verification_pending'
                || finalization?.state === 'queued'
                || finalization?.state === 'awaiting_transcript'
            )
            && (
                !finalization.nextAttemptAt
                || Date.parse(finalization.nextAttemptAt) <= Date.now()
            )
        ) {
            after(async () => {
                await finalizeAmyAnamSession(sessionId).catch(() => undefined);
            });
        }
        return noStoreJson({
            found: true,
            status: receipt?.status ?? finalization?.state ?? session?.state,
            providerClosed: Boolean(receipt),
            transcriptReady: receipt?.transcript.source === 'anam_api',
            transcriptUnavailable: receipt?.transcript.source === 'unavailable',
            finalizationDurable: Boolean(finalization),
            finalizationAttempts: finalization?.attempts ?? 0,
            hermesQueued: false,
            hermesCompleted: false,
            outboundActionTaken: false,
            contentIncluded: false,
        });
    } catch {
        console.error('[Amy Anam Status] Failed');
        return noStoreJson({ error: 'Session status is unavailable' }, { status: 500 });
    }
}
