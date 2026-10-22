import { NextResponse } from 'next/server';
import { EVAN_PERSONA_ID } from '@/lib/anam/persona-ids';
import { EvanCaptureError, evanCaptureDigest, extractEvanCapture, parseEvanCaptureTurns, readEvanCaptureConfig } from '@/lib/anam/evan-capture-service';
import { AmyAnamRequestError, EVAN_MULLINS_VARIANT, isTrustedBrowserOrigin, isUuid, readAmyAnamBrowserSession, readAmyAnamSpineConfig, readBoundedJsonObject } from '@/lib/anam/session-spine';
import { consumeAmyAnamDistributedRateLimit, readAmyAnamLaunch, readAmyAnamSession } from '@/lib/anam/session-spine-store';

function reply(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
    const startedAt = Date.now();
    let sourceTurnCount = 0;
    let revision: number | null = null;
    try {
        if (!isTrustedBrowserOrigin(request)) return reply({ error: 'Request origin is not allowed' }, 403);
        const config = readEvanCaptureConfig();
        const spine = readAmyAnamSpineConfig();
        if (!config.configured || !spine.gatesOpen) return reply({ error: 'Move detail capture is unavailable' }, 503);
        const browser = readAmyAnamBrowserSession(request, spine.signingSecret);
        if (!browser) return reply({ error: 'Session ownership is required' }, 401);
        const body = await readBoundedJsonObject(request, 96 * 1024);
        if (Object.keys(body).some(key => !['launchId', 'sessionId', 'revision', 'turns'].includes(key))
            || !isUuid(body.launchId) || !isUuid(body.sessionId)
            || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) return reply({ error: 'Invalid capture request' }, 400);
        const turns = parseEvanCaptureTurns(body.turns);
        sourceTurnCount = turns.length;
        revision = Number(body.revision);
        const [launch, session] = await Promise.all([
            readAmyAnamLaunch(body.launchId as string), readAmyAnamSession(body.sessionId as string),
        ]);
        if (!launch || !session || launch.browserSessionId !== browser.id || session.browserSessionId !== browser.id
            || launch.boundSessionId !== body.sessionId || session.externalSessionId !== body.sessionId
            || session.launchId !== body.launchId || launch.resolvedPersonaId !== EVAN_PERSONA_ID
            || session.resolvedPersonaId !== EVAN_PERSONA_ID || session.state !== 'bound'
            || launch.agentSlug !== 'evan' || session.agentSlug !== 'evan'
            || launch.variant !== EVAN_MULLINS_VARIANT || session.variant !== EVAN_MULLINS_VARIANT) return reply({ error: 'Evan session is not active' }, 409);
        const rate = await consumeAmyAnamDistributedRateLimit({ fingerprint: `evan-capture:${browser.id}:${session.externalSessionId}`, limit: 80, windowSeconds: 30 * 60 });
        if (!rate.allowed) return reply({ error: 'Move detail capture limit reached' }, 429);
        const capture = await extractEvanCapture({ turns, revision: Number(body.revision) }, { signal: request.signal });
        console.info('[Evan Capture]', { status: 'ready', revision, sourceTurnCount,
            factCount: capture.facts.length, elapsedMs: Date.now() - startedAt, contentLogged: false });
        return reply({ capture, sourceDigest: evanCaptureDigest(turns) });
    } catch (error) {
        console.warn('[Evan Capture]', { status: 'unavailable', revision, sourceTurnCount,
            code: error instanceof EvanCaptureError ? error.code : 'request_failed', elapsedMs: Date.now() - startedAt, contentLogged: false });
        if (error instanceof AmyAnamRequestError) return reply({ error: 'Invalid capture request' }, error.status);
        if (error instanceof EvanCaptureError) return reply({ error: 'Move detail capture needs retry', code: error.code }, error.code === 'invalid_input' ? 400 : 503);
        return reply({ error: 'Move detail capture needs retry' }, 503);
    }
}
