import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
    readDaniAnamMemoryConfig,
    readDaniAnamSessionMemoryIdentity,
} from '@/lib/anam/dani-user-memory';
import { readDaniAnamMemoryReviewCandidate } from '@/lib/anam/session-spine-store';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function bearerSecret(request: Request): string {
    const authorization = request.headers.get('authorization') ?? '';
    return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, 'utf8');
    const rightBuffer = Buffer.from(right, 'utf8');
    return leftBuffer.length === rightBuffer.length
        && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function GET(request: Request) {
    try {
        const config = readDaniAnamMemoryConfig();
        const suppliedSecret = bearerSecret(request);
        if (
            !config.gatesOpen
            || !config.promotionConfigured
            || !suppliedSecret
            || !safeEqual(suppliedSecret, config.operatorSecret)
        ) {
            return noStoreJson({ error: 'Dani memory review is unavailable' }, { status: 403 });
        }

        const url = new URL(request.url);
        const allowedParameters = new Set(['externalSessionId', 'jobId', 'candidateDigest']);
        if ([...url.searchParams.keys()].some(key => !allowedParameters.has(key))) {
            return noStoreJson({ error: 'Dani memory review contained unsupported parameters' }, { status: 400 });
        }
        const externalSessionId = url.searchParams.get('externalSessionId') ?? '';
        const jobId = url.searchParams.get('jobId') ?? '';
        const candidateDigest = (url.searchParams.get('candidateDigest') ?? '').toLowerCase();
        if (!externalSessionId || !jobId || !/^[a-f0-9]{64}$/.test(candidateDigest)) {
            return noStoreJson({ error: 'Exact Dani memory review identifiers are required' }, { status: 400 });
        }

        const artifact = await readDaniAnamMemoryReviewCandidate({
            externalSessionId,
            jobId,
        });
        if (!artifact || artifact.candidateDigest !== candidateDigest) {
            return noStoreJson({ error: 'Dani memory review candidate was not found' }, { status: 404 });
        }
        const activeIdentity = await readDaniAnamSessionMemoryIdentity(externalSessionId);
        if (!activeIdentity) {
            return noStoreJson({ error: 'Dani memory review candidate was not found' }, { status: 404 });
        }
        return noStoreJson({
            candidate: artifact,
            operatorReviewRequired: true,
            automaticApproval: false,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/identity was invalid|did not match/i.test(message)) {
            return noStoreJson({ error: 'Dani memory review candidate was invalid' }, { status: 409 });
        }
        console.error('[Dani Anam Memory Review] Candidate read failed safely');
        return noStoreJson({ error: 'Dani memory review is unavailable' }, { status: 503 });
    }
}
