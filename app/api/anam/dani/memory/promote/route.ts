import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
    readDaniAnamMemoryConfig,
} from '@/lib/anam/dani-user-memory';
import { readBoundedJsonObject } from '@/lib/anam/session-spine';
import { decideStoredDaniAnamMemoryCandidate } from '@/lib/anam/dani-memory-review-decision';

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

export async function POST(request: Request) {
    try {
        const config = readDaniAnamMemoryConfig();
        const suppliedSecret = bearerSecret(request);
        if (
            !config.promotionGatesOpen
            || !suppliedSecret
            || !safeEqual(suppliedSecret, config.operatorSecret)
        ) {
            return noStoreJson({ error: 'Dani memory promotion is unavailable' }, { status: 403 });
        }
        const body = await readBoundedJsonObject(request, 8 * 1024);
        const allowedFields = new Set([
            'action',
            'externalSessionId',
            'jobId',
            'candidateDigest',
            'reasonCode',
        ]);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return noStoreJson({ error: 'Memory decision contained unsupported fields' }, { status: 400 });
        }
        if (body.action !== 'approve' && body.action !== 'reject') {
            return noStoreJson({ error: 'Choose exactly one memory decision' }, { status: 400 });
        }
        if (
            typeof body.externalSessionId !== 'string'
            || typeof body.jobId !== 'string'
            || typeof body.candidateDigest !== 'string'
        ) {
            return noStoreJson({ error: 'Exact stored candidate identifiers are required' }, { status: 400 });
        }
        const result = await decideStoredDaniAnamMemoryCandidate({
            action: body.action,
            externalSessionId: body.externalSessionId,
            jobId: body.jobId,
            candidateDigest: body.candidateDigest,
            operatorSecret: suppliedSecret,
            reasonCode: typeof body.reasonCode === 'string' ? body.reasonCode : undefined,
        });
        return noStoreJson({
            ...result,
            rawEmailReturned: false,
            transcriptReturned: false,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/digest|invalid|empty|decision already exists|stored.*candidate|did not match/i.test(message)) {
            return noStoreJson({ error: 'Dani memory decision was invalid or conflicted' }, { status: 409 });
        }
        console.error('[Dani Anam Memory Promotion] Failed');
        return noStoreJson({ error: 'Dani memory decision failed' }, { status: 500 });
    }
}
