import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { readAmyAnamHermesShadowJobReceipt } from '@/lib/anam/hermes-shadow-store';
import { AmyAnamRequestError, readBoundedJsonObject } from '@/lib/anam/session-spine';
import {
    readAmyAnamMemoryConfig,
    rejectAmyAnamMemoryCandidate,
    storeAmyAnamApprovedMemory,
} from '@/lib/anam/user-memory';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function authorized(request: Request, expected: string): boolean {
    const header = request.headers.get('authorization') ?? '';
    const candidate = header.startsWith('Bearer ') ? header.slice(7) : '';
    const candidateDigest = createHash('sha256').update(candidate).digest();
    const expectedDigest = createHash('sha256').update(expected).digest();
    return timingSafeEqual(candidateDigest, expectedDigest);
}

export async function POST(request: Request) {
    try {
        const config = readAmyAnamMemoryConfig();
        if (!config.promotionGatesOpen) {
            return noStoreJson({ error: 'Amy memory promotion is unavailable' }, { status: 503 });
        }
        if (!authorized(request, config.operatorSecret)) {
            return noStoreJson({ error: 'Unauthorized' }, { status: 401 });
        }
        const body = await readBoundedJsonObject(request, 12 * 1024);
        const decision = body.decision;
        const jobId = typeof body.jobId === 'string' ? body.jobId : '';
        const outputSha256 = typeof body.outputSha256 === 'string' ? body.outputSha256 : '';
        if (!['approve', 'reject'].includes(String(decision))) {
            return noStoreJson({ error: 'A valid operator decision is required' }, { status: 400 });
        }
        const receipt = await readAmyAnamHermesShadowJobReceipt(jobId);
        if (
            !receipt
            || receipt.status !== 'completed'
            || !receipt.outputContractValid
            || receipt.outputSha256 !== outputSha256
            || receipt.jobId !== jobId
            || receipt.contentIncluded
            || receipt.generatedContentPersistedInCloud
            || receipt.memoryWrites !== 0
            || receipt.outboundActions !== 0
        ) {
            return noStoreJson({ error: 'Hermes proof did not match the reviewed candidate' }, { status: 409 });
        }

        if (decision === 'reject') {
            const status = await rejectAmyAnamMemoryCandidate({
                externalSessionId: receipt.externalSessionId,
                jobId,
                outputSha256,
                reasonCode: typeof body.reasonCode === 'string' ? body.reasonCode : undefined,
            });
            return noStoreJson({
                decision: 'rejected',
                status,
                contentReturned: false,
                identityReturned: false,
            });
        }

        const result = await storeAmyAnamApprovedMemory({
            externalSessionId: receipt.externalSessionId,
            jobId,
            outputSha256,
            summary: typeof body.summary === 'string' ? body.summary : '',
            inquiryType: typeof body.inquiryType === 'string' ? body.inquiryType : undefined,
            recommendedNextSteps: Array.isArray(body.recommendedNextSteps)
                ? body.recommendedNextSteps.filter((item): item is string => typeof item === 'string')
                : undefined,
        });
        return noStoreJson({
            decision: 'approved',
            status: result.status,
            approvedMemoryCount: result.recordCount,
            contentReturned: false,
            identityReturned: false,
        });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        const message = error instanceof Error ? error.message : '';
        if (/summary was empty|identity was invalid/i.test(message)) {
            return noStoreJson({ error: 'The reviewed memory candidate was invalid' }, { status: 400 });
        }
        if (/session identity was unavailable|decision already exists/i.test(message)) {
            return noStoreJson({ error: 'The memory decision conflicts with stored session state' }, { status: 409 });
        }
        return noStoreJson({ error: 'Amy memory promotion failed safely' }, { status: 503 });
    }
}
