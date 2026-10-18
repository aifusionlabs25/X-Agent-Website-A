import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { allowAccessSignIn, createAccessAuthOptions } from '@/lib/access/auth';
import { isTrustedAccessRequest, normalizeAuthEmail, readAccessAuthConfig } from '@/lib/access/auth-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ nextauth: string[] }> };

function failure(status: number, error: string, origin: string) {
    return Response.json({ error, url: `${origin}/access?error=${encodeURIComponent(error)}` }, {
        status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' },
    });
}

async function boundedBody(request: Request): Promise<string | null> {
    const reader = request.clone().body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) { void reader.cancel(); return null; }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function handler(request: NextRequest, context: Context) {
    const config = readAccessAuthConfig();
    if (!config.configured) return failure(503, 'Configuration', config.origin);
    if (!isTrustedAccessRequest(request, config)) return failure(403, 'AccessDenied', config.origin);
    try {
        const { nextauth } = await context.params;
        const [action, provider] = nextauth;
        if (nextauth.length > 2 || (provider && !['email'].includes(provider)) || action === '_log') {
            return failure(400, 'InvalidRequest', config.origin);
        }
        if (request.method === 'POST') {
            // NextAuth reads the same body below, after a bounded clone check.
            const body = await boundedBody(request);
            if (body === null) return failure(413, 'InvalidRequest', config.origin);
            if (action === 'signin' && provider === 'email') {
                const contentType = request.headers.get('content-type') || '';
                const data = contentType.includes('application/json') ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));
                if (typeof data.email !== 'string') return failure(400, 'EmailSignin', config.origin);
                let email: string;
                try { email = normalizeAuthEmail(data.email); } catch { return failure(400, 'EmailSignin', config.origin); }
                if (!await allowAccessSignIn(request, email, config)) return failure(429, 'RateLimit', config.origin);
            }
        }
        let failed = false;
        const response: Response = await NextAuth(createAccessAuthOptions(config, () => { failed = true; }))(request, context);
        if (failed) return failure(503, 'ServiceUnavailable', config.origin);
        response.headers.set('Cache-Control', 'no-store');
        response.headers.set('Vary', 'Cookie');
        response.headers.set('Referrer-Policy', 'no-referrer');
        return response;
    } catch { return failure(503, 'ServiceUnavailable', config.origin); }
}

export { handler as GET, handler as POST };
