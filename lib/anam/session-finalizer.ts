import { randomUUID } from 'node:crypto';
import { dispatchAmyAnamPostSessionFollowUp } from './agentmail.ts';
import {
    AnamSessionApiError,
    fetchCompletedAnamTranscript,
    verifyAnamSessionForLaunch,
} from './session-api.ts';
import {
    createAmyAnamHermesShadowPointer,
    readAmyAnamHermesShadowConfig,
} from './hermes-shadow.ts';
import {
    buildAmyAnamHermesShadowQueuedEnvelope,
    enqueueAmyAnamHermesShadowPointer,
} from './hermes-shadow-store.ts';
import { buildAmyAnamReceipt } from './session-spine.ts';
import type { AmyAnamSessionReceipt, AmyAnamSessionRecord } from './session-spine.ts';
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

function buildHermesShadowEnvelope(
    session: AmyAnamSessionRecord,
    receipt: AmyAnamSessionReceipt,
) {
    let config;
    try {
        config = readAmyAnamHermesShadowConfig();
    } catch {
        console.warn('[Amy Anam Hermes] Shadow envelope omitted', {
            reason: 'configuration_invalid',
            contentIncluded: false,
            outboundActions: 0,
        });
        return undefined;
    }
    if (!config.gatesOpen || receipt.status !== 'completed') return undefined;

    try {
        const pointer = createAmyAnamHermesShadowPointer({ session, receipt });
        const envelope = buildAmyAnamHermesShadowQueuedEnvelope(pointer);
        console.info('[Amy Anam Hermes] Shadow envelope prepared', {
            messageCount: receipt.transcript.messageCount,
            contentIncluded: false,
            outboundActions: 0,
        });
        return envelope;
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const reason = message.includes('session identity')
            ? 'session_identity_invalid'
            : message.includes('authoritative receipt')
                ? 'receipt_ineligible'
                : message.includes('queue gates')
                    ? 'queue_gates_closed'
                    : 'envelope_invalid';
        console.warn('[Amy Anam Hermes] Shadow envelope omitted', {
            reason,
            receiptStatus: receipt.status,
            transcriptSource: receipt.transcript.source,
            messageCount: receipt.transcript.messageCount,
            hasContentSha256: Boolean(receipt.transcript.contentSha256),
            rawTranscriptPersisted: receipt.transcript.rawTranscriptPersisted,
            actionsEnabled: Object.values(receipt.actions).some(Boolean),
            contentIncluded: false,
            outboundActions: 0,
        });
        return undefined;
    }
}

export async function ensureAmyAnamHermesShadowQueued(
    session: AmyAnamSessionRecord,
    receipt: AmyAnamSessionReceipt,
): Promise<'closed' | 'duplicate' | 'ineligible' | 'queued'> {
    let config;
    try {
        config = readAmyAnamHermesShadowConfig();
    } catch {
        return 'closed';
    }
    if (!config.gatesOpen) return 'closed';
    if (receipt.status !== 'completed') return 'ineligible';

    try {
        const pointer = createAmyAnamHermesShadowPointer({ session, receipt });
        const result = await enqueueAmyAnamHermesShadowPointer(pointer);
        return result.queued ? 'queued' : 'duplicate';
    } catch {
        return 'closed';
    }
}

export async function finalizeAmyAnamSession(
    externalSessionId: string,
): Promise<AmyAnamFinalizationResult> {
    const lockToken = randomUUID();
    if (!await acquireAmyAnamCompletionLock(externalSessionId, lockToken)) return 'busy';

    try {
        const existingReceipt = await readAmyAnamReceipt(externalSessionId);
        if (existingReceipt) {
            const existingSession = await readAmyAnamSession(externalSessionId);
            if (existingSession) {
                await ensureAmyAnamHermesShadowQueued(existingSession, existingReceipt);
            }
            return 'completed';
        }

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
                emptyTranscriptGraceStartedAt: Date.parse(finalization.receivedAt),
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
            const hermesShadowEnvelope = buildHermesShadowEnvelope(session, receipt);
            await writeAmyAnamReceipt(session, finalization, receipt, { hermesShadowEnvelope });
            const emailResult = await dispatchAmyAnamPostSessionFollowUp({
                session,
                receipt,
                turns: transcript.status === 'ready' ? transcript.turns : [],
            }).catch(() => ({ status: 'email_unavailable' as const, sent: false as const }));
            console.info('[Amy Anam AgentMail] Post-session dispatch finished', {
                status: emailResult.status,
                sent: emailResult.sent,
                afterSessionClose: true,
                finalTranscriptAvailable: transcript.status === 'ready',
                contentIncludedInLog: false,
            });
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
