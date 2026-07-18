import { NextResponse } from 'next/server';
import {
    AMY_ANAM_HERMES_WORKER_BRIDGE_MAX_BODY_BYTES,
    buildAmyAnamHermesWorkerSessionIdentity,
    isAmyAnamHermesWorkerAuthorized,
    normalizeAmyAnamHermesWorkerBridgeRequest,
    readAmyAnamHermesWorkerBridgeConfig,
} from '@/lib/anam/hermes-worker-bridge';
import { readAmyAnamHermesShadowConfig } from '@/lib/anam/hermes-shadow';
import {
    acknowledgeAmyAnamHermesShadowReceipt,
    beginAmyAnamHermesShadowExecution,
    leaseNextAmyAnamHermesShadowJob,
    readAmyAnamSessionRecordForHermes,
    retryOrDeadLetterAmyAnamHermesShadowJob,
} from '@/lib/anam/hermes-shadow-store';
import {
    AmyAnamRequestError,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
} from '@/lib/anam/session-spine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex');
    return response;
}

export async function POST(request: Request) {
    const bridgeConfig = readAmyAnamHermesWorkerBridgeConfig();
    if (!bridgeConfig.secretConfigured) {
        return noStoreJson({ error: 'Amy Hermes worker authentication is unavailable' }, { status: 503 });
    }
    if (!isAmyAnamHermesWorkerAuthorized(request)) {
        return noStoreJson({ error: 'Unauthorized' }, { status: 401 });
    }
    const shadowConfig = readAmyAnamHermesShadowConfig();
    const spineConfig = readAmyAnamSpineConfig();
    if (!shadowConfig.gatesOpen || !spineConfig.gatesOpen) {
        return noStoreJson({ error: 'Amy Hermes shadow processing is unavailable' }, { status: 503 });
    }

    try {
        const body = await readBoundedJsonObject(
            request,
            AMY_ANAM_HERMES_WORKER_BRIDGE_MAX_BODY_BYTES,
        );
        let operation;
        try {
            operation = normalizeAmyAnamHermesWorkerBridgeRequest(body);
        } catch {
            return noStoreJson({ error: 'Invalid worker request' }, { status: 400 });
        }

        if (operation.operation === 'claim') {
            const lease = await leaseNextAmyAnamHermesShadowJob();
            if (!lease) {
                return noStoreJson({
                    ok: true,
                    operation: 'claim',
                    found: false,
                    contentIncluded: false,
                });
            }
            try {
                const session = await readAmyAnamSessionRecordForHermes(
                    lease.job.pointer.externalSessionId,
                );
                return noStoreJson({
                    ok: true,
                    operation: 'claim',
                    found: true,
                    lease,
                    session: buildAmyAnamHermesWorkerSessionIdentity(session),
                    contentIncluded: false,
                });
            } catch {
                await retryOrDeadLetterAmyAnamHermesShadowJob({
                    lease,
                    failureCode: 'session_record_invalid',
                    hermesExecutionHappened: false,
                });
                return noStoreJson({
                    ok: true,
                    operation: 'claim',
                    found: false,
                    contentIncluded: false,
                });
            }
        }

        if (operation.operation === 'begin') {
            const status = await beginAmyAnamHermesShadowExecution(operation.lease);
            return noStoreJson({
                ok: true,
                operation: 'begin',
                status,
                contentIncluded: false,
            });
        }

        if (operation.operation === 'ack') {
            const acknowledged = await acknowledgeAmyAnamHermesShadowReceipt({
                lease: operation.lease,
                receipt: operation.receipt,
            });
            return noStoreJson({
                ok: true,
                operation: 'ack',
                status: acknowledged ? 'completed' : 'stale',
                contentIncluded: false,
            });
        }

        const status = await retryOrDeadLetterAmyAnamHermesShadowJob({
            lease: operation.lease,
            failureCode: operation.failureCode,
            hermesExecutionHappened: operation.hermesExecutionHappened,
        });
        return noStoreJson({
            ok: true,
            operation: 'fail',
            status,
            contentIncluded: false,
        });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        return noStoreJson({ error: 'Amy Hermes worker bridge failed' }, { status: 500 });
    }
}
