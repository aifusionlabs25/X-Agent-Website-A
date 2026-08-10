import { NextResponse } from 'next/server';
import {
    drainDueAmyAnamFinalizations,
    drainDueDaniAnamEmailRetries,
    isAmyAnamRecoveryRequestAuthorized,
    isDaniAnamEmailRecoveryRequestAuthorized,
    readAmyAnamRecoveryConfig,
    readDaniAnamEmailRecoveryConfig,
} from '@/lib/anam/session-recovery';
import type { AmyAnamRecoverySummary } from '@/lib/anam/session-recovery';
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

async function requireOpenSessionSpine() {
    const spineConfig = readAmyAnamSpineConfig();
    return spineConfig.gatesOpen;
}

function mergeRecoverySummaries(summaries: AmyAnamRecoverySummary[]): AmyAnamRecoverySummary {
    const mergedResults = {
        busy: 0,
        bound: 0,
        completed: 0,
        failed: 0,
        missing: 0,
        pending: 0,
    };
    for (const summary of summaries) {
        for (const result of Object.keys(mergedResults) as Array<keyof typeof mergedResults>) {
            mergedResults[result] += summary.results[result];
        }
    }
    return {
        status: summaries.some(summary => summary.status === 'drained') ? 'drained' : 'busy',
        selected: summaries.reduce((total, summary) => total + summary.selected, 0),
        attempted: summaries.reduce((total, summary) => total + summary.attempted, 0),
        cleaned: summaries.reduce((total, summary) => total + summary.cleaned, 0),
        invalid: summaries.reduce((total, summary) => total + summary.invalid, 0),
        skippedDueToDeadline: summaries.reduce(
            (total, summary) => total + summary.skippedDueToDeadline,
            0,
        ),
        errors: summaries.reduce((total, summary) => total + summary.errors, 0),
        durationMs: summaries.reduce((total, summary) => total + summary.durationMs, 0),
        results: mergedResults,
    };
}

async function handleScheduledRecoveryRequest(request: Request, daniOnly: boolean) {
    const amyRecovery = readAmyAnamRecoveryConfig();
    const daniEmailRecovery = readDaniAnamEmailRecoveryConfig();
    const anyAuthenticationConfigured = (
        (!daniOnly && amyRecovery.authenticationConfigured)
        || daniEmailRecovery.authenticationConfigured
    );
    if (!anyAuthenticationConfigured) {
        return noStoreJson({ error: 'Anam recovery authentication is not configured' }, { status: 503 });
    }
    const anyGateOpen = (!daniOnly && amyRecovery.gatesOpen) || daniEmailRecovery.gatesOpen;
    if (!anyGateOpen) {
        return noStoreJson({ error: 'Anam session recovery is unavailable' }, { status: 503 });
    }

    const amyAuthorized = !daniOnly
        && amyRecovery.gatesOpen
        && isAmyAnamRecoveryRequestAuthorized(request);
    const daniAuthorized = daniEmailRecovery.gatesOpen
        && isDaniAnamEmailRecoveryRequestAuthorized(request);
    if (!amyAuthorized && !daniAuthorized) {
        return noStoreJson({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!await requireOpenSessionSpine()) {
        return noStoreJson({ error: 'Anam session tracking is unavailable' }, { status: 503 });
    }

    try {
        const summaries: AmyAnamRecoverySummary[] = [];
        if (amyAuthorized) summaries.push(await drainDueAmyAnamFinalizations());
        if (daniAuthorized) summaries.push(await drainDueDaniAnamEmailRetries());
        const summary = mergeRecoverySummaries(summaries);
        console.info('[Anam Recovery] Scheduled drain finished', {
            ...summary,
            finalizationsEnabled: amyAuthorized,
            daniEmailRetriesEnabled: daniAuthorized,
            outbound: daniAuthorized,
        });
        return noStoreJson({
            ok: true,
            ...summary,
            durable: true,
            lanes: {
                finalizations: amyAuthorized,
                daniEmailRetries: daniAuthorized,
            },
            outbound: daniAuthorized,
        });
    } catch {
        console.error('[Anam Recovery] Scheduled drain failed');
        return noStoreJson({ error: 'Anam session recovery failed' }, { status: 500 });
    }
}

async function handleTargetedAmyRecoveryRequest(request: Request) {
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

    if (!await requireOpenSessionSpine()) {
        return noStoreJson({ error: 'Amy session tracking is unavailable' }, { status: 503 });
    }

    try {
        const targetSessionId = new URL(request.url).searchParams.get('sessionId')?.trim() ?? '';
        if (!targetSessionId) {
            return noStoreJson({ error: 'Targeted recovery requires a session id' }, { status: 400 });
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
    } catch {
        console.error('[Amy Anam Recovery] Targeted retry failed');
        return noStoreJson({ error: 'Amy targeted session recovery failed' }, { status: 500 });
    }
}

export async function GET(request: Request) {
    const slot = new URL(request.url).searchParams.get('slot');
    if (slot && slot !== 'a' && slot !== 'b') {
        return noStoreJson({ error: 'Invalid recovery slot' }, { status: 400 });
    }
    return handleScheduledRecoveryRequest(request, slot === 'b');
}

export async function POST(request: Request) {
    return handleTargetedAmyRecoveryRequest(request);
}
