import { NextResponse } from 'next/server';
import { parseEvanRouteToolStops } from '@/lib/anam/evan-address-route';
import { geocodeEvanRouteStop } from '@/lib/anam/evan-geocoding';
import { isEvanLocalTestMode } from '@/lib/anam/evan-local-test-mode';
import { readAmyAnamContactFromRequest } from '@/lib/anam/contact-token';
import {
    isTrustedBrowserOrigin,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    requestFingerprint,
} from '@/lib/anam/session-spine';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

async function authorize(request: Request): Promise<Response | null> {
    if (!isTrustedBrowserOrigin(request)) {
        return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
    }
    if (isEvanLocalTestMode()) return null;

    const spine = readAmyAnamSpineConfig();
    if (!spine.gatesOpen) {
        return noStoreJson({ error: 'Street-level route updates are temporarily unavailable' }, { status: 503 });
    }
    const browser = readAmyAnamBrowserSession(request, spine.signingSecret);
    if (!browser) return noStoreJson({ error: 'Evan session check-in is required' }, { status: 401 });
    const contact = readAmyAnamContactFromRequest({
        request,
        browserSessionId: browser.id,
        secret: spine.signingSecret,
    });
    if (!contact || contact.purpose !== 'evan_follow_up') {
        return noStoreJson({ error: 'Evan session check-in is required' }, { status: 401 });
    }
    const rate = await consumeAmyAnamDistributedRateLimit({
        fingerprint: requestFingerprint(request, 'evan-route-geocode'),
        limit: 24,
        windowSeconds: 15 * 60,
    });
    if (!rate.allowed) {
        return noStoreJson({ error: 'Too many route updates' }, {
            status: 429,
            headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        });
    }
    return null;
}

export async function POST(request: Request) {
    try {
        const denied = await authorize(request);
        if (denied) return denied;

        const body = await readBoundedJsonObject(request, 12 * 1024);
        if (Object.keys(body).some((key) => key !== 'stops')) {
            return noStoreJson({ error: 'Route update contained unsupported fields' }, { status: 400 });
        }
        const stops = parseEvanRouteToolStops(body.stops);
        if (!stops.length) {
            return noStoreJson({ error: 'No confirmed street addresses were provided' }, { status: 400 });
        }

        const resolved = [];
        for (const [index, stop] of stops.entries()) {
            if (index > 0) await new Promise((resolve) => setTimeout(resolve, 225));
            resolved.push(await geocodeEvanRouteStop(stop, {
                apiKey: process.env.GEOAPIFY_API_KEY,
            }));
        }
        const mappedCount = resolved.filter((stop) => Boolean(stop.coordinates)).length;
        const publicStops = resolved.map((stop) => ({
            kind: stop.kind,
            city: stop.city,
            address: stop.address,
            displayAddress: stop.displayAddress,
            label: stop.label,
            confirmed: stop.confirmed,
            coordinates: stop.coordinates,
            precision: stop.precision,
        }));
        return noStoreJson({
            status: mappedCount === resolved.length ? 'resolved' : mappedCount ? 'partial' : 'unresolved',
            mappedCount,
            stops: publicStops,
            providerDetailReturned: false,
        });
    } catch {
        return noStoreJson({ error: 'Street-level route update failed' }, { status: 500 });
    }
}