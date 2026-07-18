import { after, NextResponse } from 'next/server';
import { finalizeAmyAnamSession } from '@/lib/anam/session-finalizer';
import {
    AmyAnamRequestError,
    boundedString,
    isTrustedBrowserOrigin,
    isUuid,
    publicAmyAnamReceipt,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
} from '@/lib/anam/session-spine';
import {
    consumeAmyAnamDistributedRateLimit,
    recordAmyAnamCompletion,
    readAmyAnamLaunch,
    readAmyAnamReceipt,
} from '@/lib/anam/session-spine-store';

export const maxDuration = 240;

const POST_CLOSE_RETRY_DELAYS_MS = [0, 5_000, 15_000, 30_000, 60_000] as const;

async function wait(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return;
    await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function finalizeAfterClose(sessionId: string) {
    let status: Awaited<ReturnType<typeof finalizeAmyAnamSession>> = 'pending';
    const sessionRef = sessionId.slice(-8);

    for (let attempt = 0; attempt < POST_CLOSE_RETRY_DELAYS_MS.length; attempt += 1) {
        await wait(POST_CLOSE_RETRY_DELAYS_MS[attempt]);
        status = await finalizeAmyAnamSession(sessionId).catch(() => 'failed' as const);
        console.info('[Amy Anam Complete] Post-close finalization attempt', {
            sessionRef,
            attempt: attempt + 1,
            status,
        });
        if (status === 'completed' || status === 'failed' || status === 'missing') break;
    }

    return status;
}

const ALLOWED_CLOSE_REASONS = new Set([
    'CONNECTION_CLOSED_CODE_NORMAL',
    'CONNECTION_CLOSED_CODE_MICROPHONE_PERMISSION_DENIED',
    'CONNECTION_CLOSED_CODE_SIGNALLING_CLIENT_CONNECTION_FAILURE',
    'CONNECTION_CLOSED_CODE_WEBRTC_FAILURE',
    'CONNECTION_CLOSED_CODE_SERVER_CLOSED_CONNECTION',
    'pagehide',
    'unmount',
    'unknown',
]);

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

        const body = await readBoundedJsonObject(request, 2 * 1024);
        const allowedFields = new Set(['launchId', 'sessionId', 'closeReason']);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return noStoreJson({ error: 'Completion request contains unsupported fields' }, { status: 400 });
        }

        const launchId = boundedString(body.launchId, 64);
        const sessionId = boundedString(body.sessionId, 64);
        const requestedCloseReason = boundedString(body.closeReason, 100);
        const closeReason = ALLOWED_CLOSE_REASONS.has(requestedCloseReason)
            ? requestedCloseReason
            : 'unknown';
        if (!isUuid(launchId) || !isUuid(sessionId)) {
            return noStoreJson({ error: 'Valid launch and session IDs are required' }, { status: 400 });
        }

        const launch = await readAmyAnamLaunch(launchId);
        if (!launch || launch.browserSessionId !== browserSession.id) {
            return noStoreJson({ error: 'Session ownership did not match' }, { status: 403 });
        }

        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: `complete:${browserSession.id}:${sessionId}`,
            limit: 10,
            windowSeconds: 10 * 60,
        });
        if (!rate.allowed) {
            return noStoreJson(
                { error: 'Too many completion attempts' },
                { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
            );
        }

        const completionStatus = await recordAmyAnamCompletion({
            launch,
            browserSessionId: browserSession.id,
            externalSessionId: sessionId,
            closeReason,
        });
        if (completionStatus === 'terminal') {
            const existingReceipt = await readAmyAnamReceipt(sessionId);
            if (existingReceipt) {
                return noStoreJson({
                    accepted: true,
                    duplicate: true,
                    ...publicAmyAnamReceipt(existingReceipt),
                });
            }
            return noStoreJson({ error: 'Session completion state was inconsistent' }, { status: 409 });
        }
        if (completionStatus !== 'queued' && completionStatus !== 'duplicate') {
            return noStoreJson(
                { error: 'Session completion could not be recorded' },
                { status: completionStatus === 'missing' ? 404 : 403 },
            );
        }

        after(async () => {
            const status = await finalizeAfterClose(sessionId);
            console.info('[Amy Anam Complete] Background finalization finished', {
                sessionRef: sessionId.slice(-8),
                status,
            });
        });

        return noStoreJson({
            accepted: true,
            duplicate: completionStatus === 'duplicate',
            status: 'queued',
            durable: true,
            canary: true,
            outbound: false,
        }, { status: 202 });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        console.error('[Amy Anam Complete] Failed');
        return noStoreJson({ error: 'Session finalization failed' }, { status: 500 });
    }
}

