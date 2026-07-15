import { NextResponse } from 'next/server';
import {
    isTrustedBrowserOrigin,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
} from '@/lib/anam/session-spine';
import {
    deleteAmyAnamApprovedMemoryHistory,
    readAmyAnamApprovedMemoryHistory,
    readAmyAnamBrowserIdentity,
    readAmyAnamMemoryConfig,
} from '@/lib/anam/user-memory';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

async function authenticatedIdentity(request: Request) {
    const memory = readAmyAnamMemoryConfig();
    if (!memory.gatesOpen) return null;
    const spine = readAmyAnamSpineConfig();
    const browserSession = readAmyAnamBrowserSession(request, spine.signingSecret);
    if (!browserSession) return null;
    return readAmyAnamBrowserIdentity(browserSession.id);
}

export async function GET(request: Request) {
    try {
        const identity = await authenticatedIdentity(request);
        if (!identity) return noStoreJson({ error: 'Authentication required' }, { status: 401 });
        const history = await readAmyAnamApprovedMemoryHistory(identity);
        return noStoreJson({
            approvedMemoryCount: history.length,
            recentMemoryDates: history.slice(-3).map(record => record.approvedAt),
            memoryContentReturned: false,
            rawEmailReturned: false,
            identityHashReturned: false,
        });
    } catch {
        return noStoreJson({ error: 'Amy memory status is unavailable' }, { status: 503 });
    }
}

export async function DELETE(request: Request) {
    try {
        if (!isTrustedBrowserOrigin(request)) {
            return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
        }
        const identity = await authenticatedIdentity(request);
        if (!identity) return noStoreJson({ error: 'Authentication required' }, { status: 401 });
        const deleted = await deleteAmyAnamApprovedMemoryHistory(identity);
        return noStoreJson({
            deleted,
            approvedMemoryCount: 0,
            rawEmailReturned: false,
            identityHashReturned: false,
        });
    } catch {
        return noStoreJson({ error: 'Amy memory deletion failed' }, { status: 503 });
    }
}
