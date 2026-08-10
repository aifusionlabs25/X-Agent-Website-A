import { NextResponse } from 'next/server';
import {
    readDaniAnamBrowserSession,
    readDaniAnamSessionSecrets,
} from '@/lib/anam/dani-session';
import {
    readDaniAnamApprovedMemoryHistory,
    readDaniAnamBrowserIdentity,
    readDaniAnamMemoryConfig,
    revokeDaniAnamMemoryConsent,
} from '@/lib/anam/dani-user-memory';
import { isTrustedBrowserOrigin } from '@/lib/anam/session-spine';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

async function verifiedIdentity(request: Request) {
    const memory = readDaniAnamMemoryConfig();
    const daniSession = readDaniAnamSessionSecrets();
    if (!memory.gatesOpen || !daniSession.configured) return null;
    const browser = readDaniAnamBrowserSession(request, daniSession.sessionSecret);
    if (!browser) return null;
    return readDaniAnamBrowserIdentity(browser.id);
}

export async function GET(request: Request) {
    try {
        const identity = await verifiedIdentity(request);
        if (!identity) {
            return noStoreJson({ error: 'Verified Dani memory access is required' }, { status: 401 });
        }
        const history = await readDaniAnamApprovedMemoryHistory(identity);
        return noStoreJson({
            memoryVerified: true,
            memoryCount: history.length,
            lastMemoryAt: history[0]?.approvedAt ?? null,
            rawEmailReturned: false,
            identityHashReturned: false,
            memoryContentReturned: false,
        });
    } catch {
        return noStoreJson({ error: 'Dani memory status is unavailable' }, { status: 503 });
    }
}

export async function DELETE(request: Request) {
    try {
        if (!isTrustedBrowserOrigin(request)) {
            return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
        }
        const identity = await verifiedIdentity(request);
        if (!identity) {
            return noStoreJson({ error: 'Verified Dani memory access is required' }, { status: 401 });
        }
        const result = await revokeDaniAnamMemoryConsent({ identity });
        return noStoreJson({
            deleted: true,
            revoked: true,
            duplicate: result.status === 'duplicate',
            deletedCount: result.deletedCount,
            rawEmailReturned: false,
            identityHashReturned: false,
            memoryContentReturned: false,
        });
    } catch {
        return noStoreJson({ error: 'Dani memory could not be deleted' }, { status: 503 });
    }
}
