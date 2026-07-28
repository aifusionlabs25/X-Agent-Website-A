import type { MovePlanCoordinates, MovePlanStop } from './evan-move-planner';
import type { EvanRouteToolStop } from './evan-address-route';

export type EvanGeocodingProvider = 'geoapify' | 'census';

export type EvanGeocodedStop = MovePlanStop & {
    provider?: EvanGeocodingProvider;
    confidence?: number;
};

type FetchLike = typeof fetch;

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
): Promise<EvanGeocodedStop | null> {
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
        signal: AbortSignal.timeout(6_000),
    });
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
): Promise<EvanGeocodedStop | null> {
    const query = new URLSearchParams({
        address: stop.address,
        benchmark: 'Public_AR_Current',
        format: 'json',
    });
    const response = await fetchImpl(`${CENSUS_ENDPOINT}?${query.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(7_000),
    });
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
    options: { apiKey?: string; fetchImpl?: FetchLike } = {},
): Promise<EvanGeocodedStop> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const apiKey = options.apiKey?.trim() ?? '';
    try {
        if (apiKey) {
            const geoapify = await geocodeWithGeoapify(stop, apiKey, fetchImpl);
            if (geoapify) return geoapify;
        }
        const census = await geocodeWithCensus(stop, fetchImpl);
        return census ?? unresolved(stop);
    } catch {
        return unresolved(stop);
    }
}