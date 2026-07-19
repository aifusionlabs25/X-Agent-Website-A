import { finalizeAmyAnamSession } from '@/lib/anam/session-finalizer';
import {
    isValidAnamSessionId,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
} from '@/lib/anam/session-spine';
import {
    consumeAmyAnamDistributedRateLimit,
    readAmyAnamFinalization,
    readAmyAnamSession,
    requeueAmyAnamProviderResponseFailure,
} from '@/lib/anam/session-spine-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function cleanHtml(value: string): string {
    return value.replace(/[<>&"']/g, '');
}

function htmlResponse(title: string, message: string, status = 200, action?: string) {
    const safeTitle = cleanHtml(title);
    const safeMessage = cleanHtml(message);
    const form = action
        ? '<form method="post" action="' + cleanHtml(action) + '"><button type="submit">Retry email delivery</button></form>'
        : '';
    const document = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'
        + safeTitle
        + '</title></head><body><main><h1>'
        + safeTitle
        + '</h1><p>'
        + safeMessage
        + '</p>'
        + form
        + '</main></body></html>';
    const response = new Response(document, {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    response.headers.set(
        'Content-Security-Policy',
        "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    return response;
}

async function readOwnedSession(request: Request) {
    const config = readAmyAnamSpineConfig();
    if (!config.gatesOpen) {
        return {
            error: htmlResponse(
                'Recovery unavailable',
                'Amy session tracking is unavailable.',
                503,
            ),
        };
    }

    const browserSession = readAmyAnamBrowserSession(request, config.signingSecret);
    if (!browserSession) {
        return {
            error: htmlResponse(
                'Recovery unavailable',
                'This browser no longer owns the Amy session.',
                401,
            ),
        };
    }

    const sessionId = new URL(request.url).searchParams.get('sessionId')?.trim() ?? '';
    if (!isValidAnamSessionId(sessionId)) {
        return {
            error: htmlResponse(
                'Recovery unavailable',
                'A valid Amy session is required.',
                400,
            ),
        };
    }

    const [session, finalization] = await Promise.all([
        readAmyAnamSession(sessionId),
        readAmyAnamFinalization(sessionId),
    ]);
    if (!session || !finalization) {
        return {
            error: htmlResponse(
                'Recovery unavailable',
                'The Amy session was not found.',
                404,
            ),
        };
    }
    if (
        session.browserSessionId !== browserSession.id
        || finalization.browserSessionId !== browserSession.id
    ) {
        return {
            error: htmlResponse(
                'Recovery unavailable',
                'This browser does not own that Amy session.',
                403,
            ),
        };
    }

    return { browserSession, finalization, sessionId };
}

export async function GET(request: Request) {
    try {
        const owned = await readOwnedSession(request);
        if ('error' in owned) return owned.error;
        if (
            owned.finalization.state !== 'failed'
            || owned.finalization.failureCode !== 'provider_response'
        ) {
            return htmlResponse(
                'No retry needed',
                'This session is not eligible for an email recovery retry.',
            );
        }
        const action = '/support/amy-email-recovery?sessionId='
            + encodeURIComponent(owned.sessionId);
        return htmlResponse(
            'Amy email recovery',
            'The transcript is now available. Retry the post-session email bundle once.',
            200,
            action,
        );
    } catch {
        return htmlResponse(
            'Recovery unavailable',
            'Amy email recovery could not be prepared.',
            500,
        );
    }
}

export async function POST(request: Request) {
    try {
        if (request.headers.get('origin') !== new URL(request.url).origin) {
            return htmlResponse(
                'Recovery unavailable',
                'The recovery request origin was not accepted.',
                403,
            );
        }
        const owned = await readOwnedSession(request);
        if ('error' in owned) return owned.error;

        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: 'owner-recovery:' + owned.browserSession.id,
            limit: 3,
            windowSeconds: 15 * 60,
        });
        if (!rate.allowed) {
            return htmlResponse(
                'Please wait',
                'Too many recovery attempts were requested.',
                429,
            );
        }

        const requeueStatus = await requeueAmyAnamProviderResponseFailure(owned.sessionId);
        const finalizationStatus = requeueStatus === 'requeued'
            ? await finalizeAmyAnamSession(owned.sessionId)
            : null;
        console.info('[Amy Anam Recovery] Owner retry finished', {
            externalSessionId: owned.sessionId,
            requeueStatus,
            finalizationStatus,
            outbound: finalizationStatus === 'completed',
        });

        if (finalizationStatus === 'completed' || requeueStatus === 'completed') {
            return htmlResponse(
                'Recovery complete',
                'Amy finished the post-session email workflow.',
            );
        }
        if (finalizationStatus === 'pending') {
            return htmlResponse(
                'Recovery queued',
                'Amy is waiting for the final Anam transcript and will retry automatically.',
            );
        }
        return htmlResponse(
            'Recovery not completed',
            'This session could not be retried safely.',
            409,
        );
    } catch {
        return htmlResponse(
            'Recovery unavailable',
            'Amy email recovery failed safely.',
            500,
        );
    }
}
