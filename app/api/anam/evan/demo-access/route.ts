import { NextResponse } from 'next/server';
import { createEvanDemoGrant, EVAN_DEMO_COOKIE, EVAN_DEMO_GRANT_SECONDS, hasEvanDemoGrant, verifyEvanDemoAccessCode } from '@/lib/anam/evan-demo-policy';
import { AmyAnamRequestError, isTrustedBrowserOrigin, readAmyAnamSpineConfig, readBoundedJsonObject, requestFingerprint } from '@/lib/anam/session-spine';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';

function json(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
    const extended = hasEvanDemoGrant(request);
    return json({ mode: 'public', maxSeconds: 180, extendedAccess: extended,
        aiflDemoRecaps: process.env.EVAN_PUBLIC_DEMO_ENABLED === 'true' && process.env.EVAN_PUBLIC_DEMO_MAIL_ROUTING === 'all-aifl' });
}

export async function POST(request: Request) {
    try {
        if (!isTrustedBrowserOrigin(request)) return json({ error: 'Request origin is not allowed' }, 403);
        if (!readAmyAnamSpineConfig().gatesOpen) return json({ error: 'Extended demo access is unavailable' }, 503);
        const limit = await consumeAmyAnamDistributedRateLimit({ fingerprint: requestFingerprint(request, 'evan-demo-unlock'), limit: 5, windowSeconds: 15 * 60 });
        if (!limit.allowed) return json({ error: 'Too many attempts. Please try again later.' }, 429);
        const body = await readBoundedJsonObject(request, 1024);
        if (!verifyEvanDemoAccessCode(body.code)) return json({ error: 'That access code is not valid.' }, 403);
        const response = json({ mode: 'extended', maxSeconds: 1800 });
        response.cookies.set(EVAN_DEMO_COOKIE, createEvanDemoGrant(new URL(request.url).origin), {
            httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: EVAN_DEMO_GRANT_SECONDS,
        });
        return response;
    } catch (error) {
        return json({ error: error instanceof AmyAnamRequestError ? error.message : 'Extended demo access is unavailable' }, error instanceof AmyAnamRequestError ? error.status : 503);
    }
}

export async function DELETE(request: Request) {
    if (!isTrustedBrowserOrigin(request)) return json({ error: 'Request origin is not allowed' }, 403);
    const response = json({ mode: 'public', maxSeconds: 180 });
    response.cookies.set(EVAN_DEMO_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
    return response;
}
