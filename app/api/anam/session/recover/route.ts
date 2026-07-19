import { NextResponse } from 'next/server';
import {
    drainDueAmyAnamFinalizations,
    isAmyAnamRecoveryRequestAuthorized,
    readAmyAnamRecoveryConfig,
} from '@/lib/anam/session-recovery';
import { finalizeAmyAnamSession } from '@/lib/anam/session-finalizer';
import { isValidAnamSessionId, readAmyAnamSpineConfig } from '@/lib/anam/session-spine';
import { requeueAmyAnamProviderResponseFailure } from '@/lib/anam/session-spine-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    return response;
}

async function handleRecoveryRequest(request: Request, allowTargetedRetry: boolean) {
    const recoveryConfig = readAmyAnamRecoveryConfig();
    if (!recoveryConfig.authenticationConfigured) {
        return noStoreJson({ error: 'Amy recovery authentication is not configured' }, { status: 503 });
    }
    if (!recoveryConfig.gatesOpen) {
        return noStoreJson({ error: 'Amy session recovery is unavailable' }, { status: 503 });
    }
    if (!isAmyAnamRecoveryRequestAuthorized(request)) {
        return noStoreJson({ error: 'Unauthorized' }, { status: 401 });
    }

    const spineConfig = readAmyAnamSpineConfig();
    if (!spineConfig.gatesOpen) {
        return noStoreJson({ error: 'Amy session tracking is unavailable' }, { status: 503 });
    }

    try {
        const targetSessionId = new URL(request.url).searchParams.get('sessionId')?.trim() ?? '';
        if (targetSessionId) {
            if (!allowTargetedRetry) {
                return noStoreJson({ error: 'Targeted recovery requires POST' }, { status: 405 });
            }
            if (!isValidAnamSessionId(targetSessionId)) {
                return noStoreJson({ error: 'Invalid Anam session id' }, { status: 400 });
            }

            const requeueStatus = await requeueAmyAnamProviderResponseFailure(targetSessionId);
            const finalizationStatus = requeueStatus === 'requeued'
                ? await finalizeAmyAnamSession(targetSessionId)
                : null;
            console.info('[Amy Anam Recovery] Targeted retry finished', {
                externalSessionId: targetSessionId,
                requeueStatus,
                finalizationStatus,
                outbound: finalizationStatus === 'completed',
            });
            return noStoreJson({
                ok: requeueStatus === 'requeued' || requeueStatus === 'completed',
                mode: 'targeted',
                sessionId: targetSessionId,
                requeueStatus,
                finalizationStatus,
                durable: true,
                outbound: finalizationStatus === 'completed',
            }, {
                status: requeueStatus === 'missing'
                    ? 404
                    : requeueStatus === 'not_retryable'
                        ? 409
                        : 200,
            });
        }

        const summary = await drainDueAmyAnamFinalizations();
        console.info('[Amy Anam Recovery] Drain finished', summary);
        return noStoreJson({
            ok: true,
            ...summary,
            durable: true,
            outbound: false,
        });
    } catch {
        console.error('[Amy Anam Recovery] Drain failed');
        return noStoreJson({ error: 'Amy session recovery failed' }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return handleRecoveryRequest(request, false);
}

export async function POST(request: Request) {
    return handleRecoveryRequest(request, true);
}
