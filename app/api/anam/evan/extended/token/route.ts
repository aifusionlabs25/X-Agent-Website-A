import { NextResponse } from 'next/server';
import { POST as issueSessionToken } from '@/app/api/anam-token/route';
import { hasEvanDemoGrant } from '@/lib/anam/evan-demo-policy';
import { EVAN_PERSONA_ID } from '@/lib/anam/persona-readiness';
import { isTrustedBrowserOrigin, readBoundedJsonObject } from '@/lib/anam/session-spine';

// Reuse the same check-in, rate limits, capture, email and launch binding. Only
// this protected endpoint may select the extended policy; the public endpoint
// always stays public, even when the same browser carries a private grant.
export async function POST(request: Request) {
    const denied = () => NextResponse.json(
        { error: 'Unlock the private Evan demo before starting a longer session.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
    if (!isTrustedBrowserOrigin(request) || !hasEvanDemoGrant(request)) return denied();
    try {
        const body = await readBoundedJsonObject(request.clone(), 2 * 1024);
        if (body.personaId !== EVAN_PERSONA_ID || body.variant !== undefined) return denied();
    } catch {
        return NextResponse.json({ error: 'Invalid session request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    return issueSessionToken(request);
}
