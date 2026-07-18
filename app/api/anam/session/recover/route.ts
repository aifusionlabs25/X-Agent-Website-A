import { NextResponse } from 'next/server';
import {
    drainDueAmyAnamFinalizations,
    isAmyAnamRecoveryRequestAuthorized,
    readAmyAnamRecoveryConfig,
} from '@/lib/anam/session-recovery';
import { readAmyAnamSpineConfig } from '@/lib/anam/session-spine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    return response;
}

async function handleRecoveryRequest(request: Request) {
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

    const spineConfig = readAmyAnamSpineConfig();
    if (!spineConfig.gatesOpen) {
        return noStoreJson({ error: 'Amy session tracking is unavailable' }, { status: 503 });
    }

    try {
        const summary = await drainDueAmyAnamFinalizations();
        console.info('[Amy Anam Recovery] Drain finished', summary);
        return noStoreJson({
            ok: true,
            ...summary,
            durable: true,
            outbound: false,
        });
    } catch {
        console.error('[Amy Anam Recovery] Drain failed');
        return noStoreJson({ error: 'Amy session recovery failed' }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return handleRecoveryRequest(request);
}

export async function POST(request: Request) {
    return handleRecoveryRequest(request);
}
