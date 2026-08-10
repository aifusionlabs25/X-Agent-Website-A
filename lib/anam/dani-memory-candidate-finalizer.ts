import { buildDaniAnamMemoryReviewCandidate } from './dani-memory-candidate.ts';
import type { DaniAnamMemoryReviewArtifact } from './dani-memory-candidate.ts';
import {
    createDaniAnamMemoryCandidateEligibility,
    readDaniAnamSessionMemoryIdentity,
} from './dani-user-memory.ts';
import type {
    DaniAnamMemoryCandidateEligibility,
    DaniAnamSessionMemoryIdentity,
} from './dani-user-memory.ts';
import { DANI_PERSONA_ID } from './persona-ids.ts';
import { DANI_AI_SOLUTIONS_VARIANT } from './session-spine.ts';
import type {
    AmyAnamSessionReceipt,
    AmyAnamSessionRecord,
    AmyTranscriptTurn,
} from './session-spine.ts';

export type DaniAnamMemoryCandidateCommit = {
    artifact: DaniAnamMemoryReviewArtifact;
    eligibility: DaniAnamMemoryCandidateEligibility;
};

type Dependencies = {
    readIdentity: (externalSessionId: string) => Promise<DaniAnamSessionMemoryIdentity | null>;
};

const defaultDependencies: Dependencies = {
    readIdentity: externalSessionId => readDaniAnamSessionMemoryIdentity(externalSessionId),
};

/**
 * Produces a review-only candidate only when every durable provenance condition
 * is already true. The session-spine transaction binds this eligibility snapshot
 * to the immutable candidate and canonical receipt. Active Dani consent is checked
 * again against Dani's memory store before review or promotion, so revocation wins.
 */
export async function prepareDaniAnamMemoryReviewCandidate(input: {
    session: AmyAnamSessionRecord;
    receipt: AmyAnamSessionReceipt;
    turns: AmyTranscriptTurn[];
}, dependencies: Dependencies = defaultDependencies): Promise<DaniAnamMemoryCandidateCommit | undefined> {
    const { session, receipt } = input;
    if (
        session.schemaVersion !== 'amy_anam_session_v1'
        || session.provider !== 'anam'
        || session.agentSlug !== 'dani'
        || session.resolvedPersonaId !== DANI_PERSONA_ID
        || session.variant !== DANI_AI_SOLUTIONS_VARIANT
        || receipt.schemaVersion !== 'amy_anam_session_receipt_v1'
        || receipt.externalSessionId !== session.externalSessionId
        || receipt.variant !== DANI_AI_SOLUTIONS_VARIANT
        || receipt.status !== 'completed'
        || receipt.transcript.source !== 'anam_api'
        || receipt.transcript.rawTranscriptPersisted !== false
        || Object.values(receipt.actions).some(Boolean)
    ) return undefined;

    const identity = await dependencies.readIdentity(session.externalSessionId);
    if (!identity) return undefined;

    return {
        artifact: buildDaniAnamMemoryReviewCandidate({
            session,
            receipt,
            turns: input.turns,
        }),
        eligibility: createDaniAnamMemoryCandidateEligibility(identity),
    };
}
