import type { MovePlanCoordinates, MovePlanStop } from './evan-move-planner';
import type { EvanRouteToolStop } from './evan-address-route';

export type EvanGeocodingProvider = 'geoapify' | 'census';

export type EvanGeocodedStop = MovePlanStop & {
    provider?: EvanGeocodingProvider;
    confidence?: number;
};

type FetchLike = typeof fetch;

type EvanGeocodingOptions = {
    apiKey?: string;
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
};

export class EvanGeocodingCancelledError extends Error {
    constructor() {
        super('Street-level route update cancelled');
        this.name = 'EvanGeocodingCancelledError';
    }
}

function assertNotCancelled(signal?: AbortSignal): void {
    // Do not propagate signal.reason: it can contain a private request URL.
    if (signal?.aborted) throw new EvanGeocodingCancelledError();
}

function providerSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

const GEOAPIFY_ENDPOINT = 'https://api.geoapify.com/v1/geocode/search';
const CENSUS_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

function validCoordinates(latitude: unknown, longitude: unknown): MovePlanCoordinates | null {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
}

function unresolved(stop: EvanRouteToolStop): EvanGeocodedStop {
    return {
        kind: stop.kind,
        city: stop.city || stop.label || 'Address not resolved',
        address: stop.address,
        displayAddress: stop.address,
        label: stop.label,
        confirmed: true,
        precision: 'unresolved',
    };
}

async function geocodeWithGeoapify(
    stop: EvanRouteToolStop,
    apiKey: string,
    fetchImpl: FetchLike,
    signal?: AbortSignal,
): Promise<EvanGeocodedStop | null> {
    assertNotCancelled(signal);
    const query = new URLSearchParams({
        text: stop.address,
        format: 'json',
        filter: 'countrycode:us',
        limit: '1',
        apiKey,
    });
    const response = await fetchImpl(`${GEOAPIFY_ENDPOINT}?${query.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: providerSignal(6_000, signal),
    });
    assertNotCancelled(signal);
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as {
        results?: Array<{
            lat?: unknown;
            lon?: unknown;
            formatted?: unknown;
            city?: unknown;
            state?: unknown;
            postcode?: unknown;
            rank?: { confidence?: unknown };
        }>;
    } | null;
    assertNotCancelled(signal);
    const result = payload?.results?.[0];
    const coordinates = validCoordinates(result?.lat, result?.lon);
    if (!result || !coordinates) return null;
    const confidence = typeof result.rank?.confidence === 'number' ? result.rank.confidence : undefined;
    if (confidence !== undefined && confidence < 0.55) return null;
    const formatted = typeof result.formatted === 'string' ? result.formatted.trim() : stop.address;
    const city = typeof result.city === 'string' && result.city.trim() ? result.city.trim() : stop.city;
    return {
        kind: stop.kind,
        city: city || stop.label || 'Confirmed address',
        address: stop.address,
        displayAddress: formatted,
        label: stop.label,
        confirmed: true,
        coordinates,
        precision: 'address',
        provider: 'geoapify',
        confidence,
    };
}

async function geocodeWithCensus(
    stop: EvanRouteToolStop,
    fetchImpl: FetchLike,
    signal?: AbortSignal,
): Promise<EvanGeocodedStop | null> {
    assertNotCancelled(signal);
    const query = new URLSearchParams({
        address: stop.address,
        benchmark: 'Public_AR_Current',
        format: 'json',
    });
    const response = await fetchImpl(`${CENSUS_ENDPOINT}?${query.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: providerSignal(7_000, signal),
    });
    assertNotCancelled(signal);
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as {
        result?: {
            addressMatches?: Array<{
                matchedAddress?: unknown;
                coordinates?: { x?: unknown; y?: unknown };
                addressComponents?: { city?: unknown };
            }>;
        };
    } | null;
    assertNotCancelled(signal);
    const result = payload?.result?.addressMatches?.[0];
    const coordinates = validCoordinates(result?.coordinates?.y, result?.coordinates?.x);
    if (!result || !coordinates) return null;
    const formatted = typeof result.matchedAddress === 'string' ? result.matchedAddress.trim() : stop.address;
    const matchedCity = result.addressComponents?.city;
    const city = typeof matchedCity === 'string' && matchedCity.trim() ? matchedCity.trim() : stop.city;
    return {
        kind: stop.kind,
        city: city || stop.label || 'Confirmed address',
        address: stop.address,
        displayAddress: formatted,
        label: stop.label,
        confirmed: true,
        coordinates,
        precision: 'address-range',
        provider: 'census',
    };
}

export async function geocodeEvanRouteStop(
    stop: EvanRouteToolStop,
    options: EvanGeocodingOptions = {},
): Promise<EvanGeocodedStop> {
    assertNotCancelled(options.signal);
    const fetchImpl = options.fetchImpl ?? fetch;
    const apiKey = options.apiKey?.trim() ?? '';
    try {
        if (apiKey) {
            const geoapify = await geocodeWithGeoapify(stop, apiKey, fetchImpl, options.signal);
            assertNotCancelled(options.signal);
            if (geoapify) return geoapify;
        }
        assertNotCancelled(options.signal);
        const census = await geocodeWithCensus(stop, fetchImpl, options.signal);
        assertNotCancelled(options.signal);
        return census ?? unresolved(stop);
    } catch {
        assertNotCancelled(options.signal);
        return unresolved(stop);
    }
}

function waitBetweenStops(signal?: AbortSignal): Promise<void> {
    assertNotCancelled(signal);
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(new EvanGeocodingCancelledError());
        };
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, 225);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export async function geocodeEvanRouteStops(
    stops: EvanRouteToolStop[],
    options: EvanGeocodingOptions = {},
): Promise<EvanGeocodedStop[]> {
    assertNotCancelled(options.signal);
    const resolved: EvanGeocodedStop[] = [];
    // Keep the existing sequential order and provider-friendly request spacing.
    for (const [index, stop] of stops.entries()) {
        assertNotCancelled(options.signal);
        if (index > 0) await waitBetweenStops(options.signal);
        assertNotCancelled(options.signal);
        const result = await geocodeEvanRouteStop(stop, options);
        assertNotCancelled(options.signal);
        resolved.push(result);
    }
    return resolved;
}
