import {
    promoteDaniAnamMemoryCandidate,
    rejectDaniAnamMemoryCandidate,
} from './dani-user-memory.ts';
import { readDaniAnamMemoryReviewCandidate } from './session-spine-store.ts';
import type { DaniAnamMemoryReviewArtifact } from './dani-memory-candidate.ts';

type DecisionInput = {
    action: 'approve' | 'reject';
    externalSessionId: string;
    jobId: string;
    candidateDigest: string;
    operatorSecret: string;
    reasonCode?: string;
};

type Dependencies = {
    readCandidate: (input: {
        externalSessionId: string;
        jobId: string;
    }) => Promise<DaniAnamMemoryReviewArtifact | null>;
    promote: typeof promoteDaniAnamMemoryCandidate;
    reject: typeof rejectDaniAnamMemoryCandidate;
};

const defaultDependencies: Dependencies = {
    readCandidate: input => readDaniAnamMemoryReviewCandidate(input),
    promote: promoteDaniAnamMemoryCandidate,
    reject: rejectDaniAnamMemoryCandidate,
};

export async function decideStoredDaniAnamMemoryCandidate(
    input: DecisionInput,
    dependencies: Dependencies = defaultDependencies,
) {
    const candidateDigest = String(input.candidateDigest ?? '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(candidateDigest)) {
        throw new Error('Stored Dani memory candidate identity was invalid');
    }
    const artifact = await dependencies.readCandidate({
        externalSessionId: input.externalSessionId,
        jobId: input.jobId,
    });
    if (
        !artifact
        || artifact.externalSessionId !== input.externalSessionId
        || artifact.jobId !== input.jobId
        || artifact.candidateDigest !== candidateDigest
    ) {
        throw new Error('Stored Dani memory candidate did not match the decision');
    }

    const storedCandidate = {
        externalSessionId: artifact.externalSessionId,
        jobId: artifact.jobId,
        candidateDigest: artifact.candidateDigest,
        summary: artifact.summary,
        inquiryType: artifact.inquiryType,
        recommendedNextSteps: artifact.recommendedNextSteps,
        operatorSecret: input.operatorSecret,
    };
    if (input.action === 'approve') {
        const result = await dependencies.promote(storedCandidate);
        return {
            decision: 'approved' as const,
            status: result.status,
            recordCount: result.recordCount,
            memoryId: result.memoryId,
        };
    }
    const status = await dependencies.reject({
        ...storedCandidate,
        reasonCode: input.reasonCode,
    });
    return { decision: 'rejected' as const, status };
}
