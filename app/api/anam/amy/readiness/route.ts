import { NextResponse } from 'next/server';
import { buildAmyAnamCapabilityReadiness } from '@/lib/anam/capability-readiness';
import {
    isAmyAnamHermesWorkerAuthorized,
    readAmyAnamHermesWorkerBridgeConfig,
} from '@/lib/anam/hermes-worker-bridge';

export const dynamic = 'force-dynamic';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    return response;
}

export async function GET(request: Request) {
    let workerConfig;
    try {
        workerConfig = readAmyAnamHermesWorkerBridgeConfig();
    } catch {
        return noStoreJson(
            { error: 'Amy readiness authentication is unavailable' },
            { status: 503 },
        );
    }
    if (!workerConfig.secretConfigured) {
        return noStoreJson(
            { error: 'Amy readiness authentication is unavailable' },
            { status: 503 },
        );
    }
    if (!isAmyAnamHermesWorkerAuthorized(request)) {
        return noStoreJson({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        return noStoreJson(buildAmyAnamCapabilityReadiness());
    } catch {
        return noStoreJson(
            { error: 'Amy Anam capability readiness is unavailable' },
            { status: 500 },
        );
    }
}
