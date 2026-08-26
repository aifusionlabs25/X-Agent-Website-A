import { randomUUID } from 'node:crypto';
import { dispatchAmyAnamPostSessionFollowUp } from './agentmail.ts';
import {
    dispatchDaniAnamPostSessionFollowUp,
    scheduleDaniAnamEmailRetryAfterDispatchFailure,
} from './dani-agentmail.ts';
import { dispatchEvanAnamPostSessionFollowUp } from './evan-agentmail.ts';
import { DANI_PERSONA_ID, EVAN_PERSONA_ID } from './persona-ids.ts';
import { prepareDaniAnamMemoryReviewCandidate } from './dani-memory-candidate-finalizer.ts';
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
import {
    buildAmyAnamReceipt,
    resolveAnamSessionAgentSlug,
    resolveAnamSessionVariant,
} from './session-spine.ts';
import type { AmyAnamSessionReceipt, AmyAnamSessionRecord } from './session-spine.ts';
import {
    acquireAmyAnamCompletionLock,
    bindAmyAnamLaunch,
    hasDaniAnamEmailRetryDueEntry,
    markAmyAnamFinalizationFailed,
    markAmyAnamFinalizationPending,
    markAmyAnamVerificationPending,
    readAmyAnamFinalization,
    readAmyAnamLaunch,
    readAmyAnamReceipt,
    readAmyAnamSession,
    removeAmyAnamFinalizationDueEntry,
    releaseAmyAnamCompletionLock,
    scheduleAmyAnamFinalizationDueEntry,
    writeAmyAnamReceipt,
} from './session-spine-store.ts';

export type AmyAnamFinalizationResult =
    | 'busy'
    | 'bound'
    | 'completed'
    | 'failed'
    | 'missing'
    | 'pending';

const AMY_EMAIL_RETRY_DELAY_MS = 60_000;

async function scheduleAmyEmailRetry(externalSessionId: string): Promise<void> {
    await scheduleAmyAnamFinalizationDueEntry({
        externalSessionId,
        dueAt: Date.now() + AMY_EMAIL_RETRY_DELAY_MS,
    });
}

function buildHermesShadowEnvelope(
    session: AmyAnamSessionRecord,
    receipt: AmyAnamSessionReceipt,
) {
    if (resolveAnamSessionAgentSlug(session.resolvedPersonaId, session.agentSlug) !== 'amy') return undefined;
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
    if (resolveAnamSessionAgentSlug(session.resolvedPersonaId, session.agentSlug) !== 'amy') return 'ineligible';
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
                const normalizedSession = {
                    ...existingSession,
                    agentSlug: resolveAnamSessionAgentSlug(
                        existingSession.resolvedPersonaId,
                        existingSession.agentSlug,
                    ),
                    variant: resolveAnamSessionVariant(
                        existingSession.resolvedPersonaId,
                        existingSession.variant,
                    ),
                };
                await ensureAmyAnamHermesShadowQueued(normalizedSession, existingReceipt);
                if (
                    normalizedSession.agentSlug === 'amy'
                    && existingReceipt.status === 'completed'
                    && existingReceipt.transcript.source === 'anam_api'
                ) {
                    const launch = await readAmyAnamLaunch(normalizedSession.launchId);
                    if (
                        launch
                        && launch.browserSessionId === normalizedSession.browserSessionId
                        && launch.resolvedPersonaId === normalizedSession.resolvedPersonaId
                        && launch.boundSessionId === externalSessionId
                    ) {
                        try {
                            const transcript = await fetchCompletedAnamTranscript(externalSessionId, launch, {
                                pollDelaysMs: [0, 500, 1_500],
                                requestTimeoutMs: 2_000,
                            });
                            if (transcript.status === 'pending') return 'pending';
                            if (transcript.status === 'ready') {
                                const recoveredReceipt = buildAmyAnamReceipt({
                                    externalSessionId,
                                    closeReason: existingReceipt.closeReason,
                                    source: 'anam_api',
                                    turns: transcript.turns,
                                    variant: normalizedSession.variant,
                                });
                                if (
                                    recoveredReceipt.receiptId !== existingReceipt.receiptId
                                    || recoveredReceipt.transcript.contentSha256 !== existingReceipt.transcript.contentSha256
                                ) return 'completed';
                                const emailResult = await dispatchAmyAnamPostSessionFollowUp({
                                    session: normalizedSession,
                                    receipt: existingReceipt,
                                    turns: transcript.turns,
                                });
                                if (emailResult.sent) {
                                    await removeAmyAnamFinalizationDueEntry(externalSessionId).catch(() => undefined);
                                }
                                if (
                                    !emailResult.sent
                                    && (
                                        emailResult.status === 'email_failed'
                                        || emailResult.status === 'email_already_attempted'
                                    )
                                ) {
                                    await scheduleAmyEmailRetry(externalSessionId).catch(() => undefined);
                                    return 'pending';
                                }
                            }
                        } catch {
                            await scheduleAmyEmailRetry(externalSessionId).catch(() => undefined);
                            return 'pending';
                        }
                    }
                }
                if (
                    normalizedSession.resolvedPersonaId === DANI_PERSONA_ID
                    && normalizedSession.agentSlug === 'dani'
                    && existingReceipt.status === 'completed'
                    && existingReceipt.transcript.source === 'anam_api'
                ) {
                    const launch = await readAmyAnamLaunch(normalizedSession.launchId);
                    if (
                        launch
                        && launch.browserSessionId === normalizedSession.browserSessionId
                        && launch.resolvedPersonaId === normalizedSession.resolvedPersonaId
                        && launch.boundSessionId === externalSessionId
                    ) {
                        try {
                            const transcript = await fetchCompletedAnamTranscript(externalSessionId, launch, {
                                pollDelaysMs: [0, 500, 1_500],
                                requestTimeoutMs: 2_000,
                            });
                            if (transcript.status === 'pending') return 'pending';
                            if (transcript.status === 'ready') {
                                const recoveredReceipt = buildAmyAnamReceipt({
                                    externalSessionId,
                                    closeReason: existingReceipt.closeReason,
                                    source: 'anam_api',
                                    turns: transcript.turns,
                                    variant: normalizedSession.variant,
                                });
                                const transcriptMatchesReceipt =
                                    recoveredReceipt.receiptId === existingReceipt.receiptId
                                    && recoveredReceipt.variant === existingReceipt.variant
                                    && recoveredReceipt.transcript.messageCount === existingReceipt.transcript.messageCount
                                    && recoveredReceipt.transcript.contentSha256 === existingReceipt.transcript.contentSha256;
                                if (!transcriptMatchesReceipt) {
                                    console.error('[Dani Anam AgentMail] Recovery transcript did not match receipt', {
                                        externalSessionRef: externalSessionId.slice(-8),
                                        contentIncluded: false,
                                        outboundActions: 0,
                                    });
                                    return 'completed';
                                }
                                const emailResult = await dispatchDaniAnamPostSessionFollowUp({
                                    session: normalizedSession,
                                    receipt: existingReceipt,
                                    turns: transcript.turns,
                                });
                                console.info('[Dani Anam AgentMail] Post-receipt recovery finished', {
                                    externalSessionRef: externalSessionId.slice(-8),
                                    status: emailResult.status,
                                    sent: emailResult.sent,
                                    transcriptRevalidated: true,
                                    contentIncluded: false,
                                });
                                if (
                                    emailResult.status === 'email_partial'
                                    || emailResult.status === 'email_failed'
                                ) return 'pending';
                                if (
                                    emailResult.status === 'email_unavailable'
                                    && await hasDaniAnamEmailRetryDueEntry(externalSessionId)
                                ) return 'pending';
                            }
                        } catch {
                            const retrySchedule = await scheduleDaniAnamEmailRetryAfterDispatchFailure({
                                externalSessionId,
                                retryStartedAt: existingReceipt.completedAt,
                            }).catch(() => 'unavailable' as const);
                            // The canonical receipt remains terminal, but returning pending lets
                            // the bounded post-close loop and durable due set safely retry this
                            // Dani-only recovery without reopening receipt or memory finalization.
                            console.warn('[Dani Anam AgentMail] Post-receipt recovery deferred', {
                                externalSessionRef: externalSessionId.slice(-8),
                                retrySchedule,
                                contentIncluded: false,
                            });
                            return retrySchedule === 'expired' ? 'completed' : 'pending';
                        }
                    }
                }
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

        session = {
            ...session,
            agentSlug: resolveAnamSessionAgentSlug(session.resolvedPersonaId, session.agentSlug),
            variant: resolveAnamSessionVariant(session.resolvedPersonaId, session.variant),
        };

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

            if (transcript.status === 'unavailable') {
                console.warn('[Anam Session] Provider transcript unavailable', {
                    externalSessionRef: externalSessionId.slice(-8),
                    reason: transcript.reason,
                    contentIncluded: false,
                });
            }

            const receipt = buildAmyAnamReceipt({
                externalSessionId,
                closeReason: finalization.closeReason,
                source: transcript.status === 'ready' ? 'anam_api' : 'unavailable',
                turns: transcript.status === 'ready' ? transcript.turns : [],
                variant: session.variant,
            });
            const hermesShadowEnvelope = buildHermesShadowEnvelope(session, receipt);
            const daniMemoryReview = await prepareDaniAnamMemoryReviewCandidate({
                session,
                receipt,
                turns: transcript.status === 'ready' ? transcript.turns : [],
            }).catch(() => {
                console.warn('[Dani Anam Memory] Review candidate omitted', {
                    reason: 'eligibility_or_provenance_unavailable',
                    contentIncluded: false,
                    automaticApproval: false,
                });
                return undefined;
            });
            const receiptWriteStatus = await writeAmyAnamReceipt(session, finalization, receipt, {
                hermesShadowEnvelope,
                daniMemoryReviewArtifact: daniMemoryReview?.artifact,
                daniMemoryEligibility: daniMemoryReview?.eligibility,
            });
            if (
                daniMemoryReview
                && (receiptWriteStatus === 'candidate_stored' || receiptWriteStatus === 'candidate_duplicate')
            ) {
                console.info('[Dani Anam Memory] Review candidate committed with receipt', {
                    externalSessionId: daniMemoryReview.artifact.externalSessionId,
                    jobId: daniMemoryReview.artifact.jobId,
                    candidateDigest: daniMemoryReview.artifact.candidateDigest,
                    rawTranscriptIncluded: false,
                    rawEmailIncluded: false,
                    automaticApproval: false,
                });
            } else if (daniMemoryReview && receiptWriteStatus === 'candidate_conflict') {
                console.error('[Dani Anam Memory] Review candidate conflict; candidate unavailable', {
                    externalSessionId: daniMemoryReview.artifact.externalSessionId,
                    jobId: daniMemoryReview.artifact.jobId,
                    contentIncluded: false,
                    automaticApproval: false,
                });
            }
            const dispatchFollowUp = session.resolvedPersonaId === DANI_PERSONA_ID
                && session.agentSlug === 'dani'
                ? dispatchDaniAnamPostSessionFollowUp
                : session.resolvedPersonaId === EVAN_PERSONA_ID
                    && session.agentSlug === 'evan'
                    ? dispatchEvanAnamPostSessionFollowUp
                    : session.agentSlug === 'amy'
                        ? dispatchAmyAnamPostSessionFollowUp
                        : null;
            const emailResult = dispatchFollowUp
                ? await dispatchFollowUp({
                    session,
                    receipt,
                    turns: transcript.status === 'ready' ? transcript.turns : [],
                }).catch(async () => {
                    if (
                        session.resolvedPersonaId === DANI_PERSONA_ID
                        && session.agentSlug === 'dani'
                    ) {
                        const retrySchedule = await scheduleDaniAnamEmailRetryAfterDispatchFailure({
                            externalSessionId,
                            retryStartedAt: receipt.completedAt,
                        }).catch(() => 'unavailable' as const);
                        return retrySchedule === 'expired'
                            ? ({ status: 'email_retry_expired' as const, sent: false as const })
                            : ({ status: 'email_failed' as const, sent: false as const });
                    }
                    if (session.agentSlug === 'amy') {
                        return { status: 'email_failed' as const, sent: false as const };
                    }
                    return { status: 'email_unavailable' as const, sent: false as const };
                })
                : { status: 'email_unavailable' as const, sent: false as const };
            console.info('[Anam AgentMail] Post-session dispatch finished', {
                status: emailResult.status,
                sent: emailResult.sent,
                visitorProvider: 'visitorProvider' in emailResult
                    ? emailResult.visitorProvider
                    : null,
                afterSessionClose: true,
                finalTranscriptAvailable: transcript.status === 'ready',
                contentIncludedInLog: false,
            });
            if (
                session.resolvedPersonaId === DANI_PERSONA_ID
                && session.agentSlug === 'dani'
                && (
                    emailResult.status === 'email_partial'
                    || emailResult.status === 'email_failed'
                )
            ) return 'pending';
            if (
                session.agentSlug === 'amy'
                && !emailResult.sent
                && (
                    emailResult.status === 'email_failed'
                    || emailResult.status === 'email_already_attempted'
                )
            ) {
                await scheduleAmyEmailRetry(externalSessionId).catch(() => undefined);
                return 'pending';
            }
            return 'completed';
        } catch (error) {
            console.warn('[Amy Anam Finalization] Finalization step failed', {
                externalSessionId,
                errorType: error instanceof Error ? error.name : typeof error,
                errorCategory: error instanceof AnamSessionApiError ? error.message : 'unexpected_error',
                providerStatus: error instanceof AnamSessionApiError ? error.status : null,
                retryable: error instanceof AnamSessionApiError ? error.retryable : false,
                contentIncludedInLog: false,
            });
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
