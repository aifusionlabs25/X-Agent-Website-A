import { after, NextResponse } from 'next/server';
import { requireAgentAccess, requireAgentBrowserAccess } from '@/lib/access/policy';
import {
    ensureAmyAnamHermesShadowQueued,
    finalizeAmyAnamSession,
} from '@/lib/anam/session-finalizer';
import { readAmyAnamHermesShadowConfig } from '@/lib/anam/hermes-shadow';
import type { AmyAnamHermesShadowReceipt } from '@/lib/anam/hermes-shadow';
import { readAmyAnamHermesShadowReceipt } from '@/lib/anam/hermes-shadow-store';
import {
    readDaniAnamBrowserSession,
    readDaniAnamSessionSecrets,
} from '@/lib/anam/dani-session';
import {
    isValidAnamSessionId,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
    requestFingerprint,
    resolveAnamSessionAgentSlug,
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

        const sessionId = new URL(request.url).searchParams.get('sessionId')?.trim() ?? '';
        if (!isValidAnamSessionId(sessionId)) {
            return noStoreJson({ error: 'A valid session ID is required' }, { status: 400 });
        }

        const preAuthRate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: requestFingerprint(request, 'status-preauth'),
            limit: 240,
            windowSeconds: 10 * 60,
        });
        if (!preAuthRate.allowed) {
            return noStoreJson(
                { error: 'Too many status requests' },
                { status: 429, headers: { 'Retry-After': String(preAuthRate.retryAfterSeconds) } },
            );
        }

        const [session, finalization] = await Promise.all([
            readAmyAnamSession(sessionId),
            readAmyAnamFinalization(sessionId),
        ]);
        if (!session && !finalization) return noStoreJson({ found: false });
        const sessionAgentSlug = session
            ? resolveAnamSessionAgentSlug(session.resolvedPersonaId, session.agentSlug)
            : null;
        if (!sessionAgentSlug) {
            return noStoreJson({ error: 'Session agent access could not be confirmed' }, { status: 403 });
        }
        const accessDenied = await requireAgentAccess(request, sessionAgentSlug);
        if (accessDenied) return accessDenied;
        const daniSessionSecrets = readDaniAnamSessionSecrets();
        if (sessionAgentSlug === 'dani' && !daniSessionSecrets.configured) {
            return noStoreJson({ error: 'Dani session access is temporarily unavailable' }, { status: 503 });
        }
        const sharedBrowserSession = readAmyAnamBrowserSession(request, config.signingSecret);
        const daniBrowserSession = daniSessionSecrets.sessionConfigured
            ? readDaniAnamBrowserSession(request, daniSessionSecrets.sessionSecret)
            : null;
        const browserSession = sessionAgentSlug === 'dani'
            ? daniBrowserSession
            : sessionAgentSlug
                ? sharedBrowserSession
                : [daniBrowserSession, sharedBrowserSession]
                    .find(candidate => candidate?.id === finalization?.browserSessionId) ?? null;
        if (!browserSession) {
            return noStoreJson({ error: 'Session ownership is required' }, { status: 401 });
        }
        const browserDenied = await requireAgentBrowserAccess(request, sessionAgentSlug, browserSession.id);
        if (browserDenied) return browserDenied;
        if (
            (session && session.browserSessionId !== browserSession.id)
            || (finalization && finalization.browserSessionId !== browserSession.id)
        ) {
            return noStoreJson({ error: 'Session ownership did not match' }, { status: 403 });
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

        let hermesReceipt: AmyAnamHermesShadowReceipt | null = null;
        try {
            const hermesConfig = readAmyAnamHermesShadowConfig();
            if (receipt && session && hermesConfig.gatesOpen) {
                hermesReceipt = await readAmyAnamHermesShadowReceipt(sessionId);
                if (!hermesReceipt) {
                    after(async () => {
                        await ensureAmyAnamHermesShadowQueued(session, receipt).catch(() => undefined);
                    });
                }
            }
        } catch {
            hermesReceipt = null;
        }

        return noStoreJson({
            found: true,
            status: receipt?.status ?? finalization?.state ?? session?.state,
            providerClosed: Boolean(receipt),
            transcriptReady: receipt?.transcript.source === 'anam_api',
            transcriptUnavailable: receipt?.transcript.source === 'unavailable',
            finalizationDurable: Boolean(finalization),
            finalizationAttempts: finalization?.attempts ?? 0,
            hermesStatus: hermesReceipt?.status ?? 'not_queued',
            hermesQueued: Boolean(hermesReceipt),
            hermesCompleted: hermesReceipt?.status === 'completed',
            hermesExecutionHappened: hermesReceipt?.hermesExecutionHappened ?? false,
            hermesContractValid: hermesReceipt?.outputContractValid ?? false,
            toolsCalled: 0,
            emailsSent: 0,
            memoryWritten: false,
            outboundActionTaken: false,
            contentIncluded: false,
        });
    } catch {
        console.error('[Amy Anam Status] Failed');
        return noStoreJson({ error: 'Session status is unavailable' }, { status: 500 });
    }
}
