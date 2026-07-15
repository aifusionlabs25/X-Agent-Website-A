import { randomUUID } from 'node:crypto';
import {
    AnamSessionApiError,
    fetchCompletedAnamTranscript,
    verifyAnamSessionForLaunch,
} from './session-api.ts';
import { buildAmyAnamReceipt } from './session-spine.ts';
import {
    acquireAmyAnamCompletionLock,
    bindAmyAnamLaunch,
    markAmyAnamFinalizationFailed,
    markAmyAnamFinalizationPending,
    markAmyAnamVerificationPending,
    readAmyAnamFinalization,
    readAmyAnamLaunch,
    readAmyAnamReceipt,
    readAmyAnamSession,
    releaseAmyAnamCompletionLock,
    writeAmyAnamReceipt,
} from './session-spine-store.ts';

export type AmyAnamFinalizationResult =
    | 'busy'
    | 'bound'
    | 'completed'
    | 'failed'
    | 'missing'
    | 'pending';

export async function finalizeAmyAnamSession(
    externalSessionId: string,
): Promise<AmyAnamFinalizationResult> {
    const lockToken = randomUUID();
    if (!await acquireAmyAnamCompletionLock(externalSessionId, lockToken)) return 'busy';

    try {
        const existingReceipt = await readAmyAnamReceipt(externalSessionId);
        if (existingReceipt) return 'completed';

        const initialState = await Promise.all([
            readAmyAnamSession(externalSessionId),
            readAmyAnamFinalization(externalSessionId),
        ]);
        let session = initialState[0];
        const finalization = initialState[1];
        if (!finalization) return 'missing';
        if (
            finalization.state === 'completed'
            || finalization.state === 'transcript_unavailable'
        ) {
            return 'completed';
        }
        if (finalization.state === 'failed') return 'failed';

        let launch = await readAmyAnamLaunch(finalization.launchId);
        if (
            !launch
            || launch.browserSessionId !== finalization.browserSessionId
            || finalization.externalSessionId !== externalSessionId
        ) {
            await markAmyAnamFinalizationFailed({
                session,
                finalization,
                failureCode: 'provider_verification',
            });
            return 'failed';
        }

        let newlyBound = false;
        if (!session) {
            try {
                await verifyAnamSessionForLaunch(externalSessionId, launch, {
                    pollDelaysMs: [0, 200, 500, 1_000],
                    requestTimeoutMs: 2_000,
                });
            } catch (error) {
                if (error instanceof AnamSessionApiError && error.retryable) {
                    await markAmyAnamVerificationPending({
                        finalization,
                        retryAfterMs: 30_000,
                    });
                    return 'pending';
                }
                const failureCode = error instanceof AnamSessionApiError && error.status === 500
                    ? 'configuration'
                    : 'provider_verification';
                await markAmyAnamFinalizationFailed({
                    session: null,
                    finalization,
                    failureCode,
                });
                return 'failed';
            }

            const bindStatus = await bindAmyAnamLaunch({
                launch,
                browserSessionId: finalization.browserSessionId,
                externalSessionId,
            });
            if (bindStatus !== 'bound' && bindStatus !== 'duplicate') {
                await markAmyAnamFinalizationFailed({
                    session: null,
                    finalization,
                    failureCode: 'provider_verification',
                });
                return 'failed';
            }
            [session, launch] = await Promise.all([
                readAmyAnamSession(externalSessionId),
                readAmyAnamLaunch(finalization.launchId),
            ]);
            newlyBound = true;
        }

        if (
            !session
            || !launch
            || session.externalSessionId !== externalSessionId
            || session.launchId !== finalization.launchId
            || session.browserSessionId !== finalization.browserSessionId
            || launch.browserSessionId !== session.browserSessionId
            || launch.resolvedPersonaId !== session.resolvedPersonaId
            || launch.boundSessionId !== externalSessionId
        ) {
            await markAmyAnamFinalizationFailed({
                session,
                finalization,
                failureCode: 'provider_verification',
            });
            return 'failed';
        }

        if (newlyBound) {
            await markAmyAnamFinalizationPending({
                session,
                finalization,
                retryAfterMs: 1_000,
            });
            return 'bound';
        }

        try {
            const transcript = await fetchCompletedAnamTranscript(externalSessionId, launch, {
                pollDelaysMs: [0, 500, 1_000, 2_000, 3_000],
                requestTimeoutMs: 2_000,
            });
            if (transcript.status === 'pending') {
                await markAmyAnamFinalizationPending({
                    session,
                    finalization,
                    retryAfterMs: 30_000,
                });
                return 'pending';
            }

            const receipt = buildAmyAnamReceipt({
                externalSessionId,
                closeReason: finalization.closeReason,
                source: transcript.status === 'ready' ? 'anam_api' : 'unavailable',
                turns: transcript.status === 'ready' ? transcript.turns : [],
            });
            await writeAmyAnamReceipt(session, finalization, receipt);
            return 'completed';
        } catch (error) {
            if (error instanceof AnamSessionApiError && error.retryable) {
                await markAmyAnamFinalizationPending({
                    session,
                    finalization,
                    retryAfterMs: 30_000,
                });
                return 'pending';
            }

            const failureCode = error instanceof AnamSessionApiError && error.status === 403
                ? 'provider_verification'
                : error instanceof AnamSessionApiError && error.status === 500
                    ? 'configuration'
                    : 'provider_response';
            await markAmyAnamFinalizationFailed({ session, finalization, failureCode });
            return 'failed';
        }
    } finally {
        await releaseAmyAnamCompletionLock(externalSessionId, lockToken).catch(() => undefined);
    }
}
