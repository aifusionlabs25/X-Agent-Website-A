import type { MovePlanStop } from './evan-move-planner';

export type EvanRouteToolStop = {
    kind: MovePlanStop['kind'];
    address: string;
    city: string;
    label: string;
    order: number;
    confirmed: true;
};

const KIND_MAP: Record<string, MovePlanStop['kind']> = {
    origin: 'Origin',
    destination: 'Destination',
    additional_stop: 'Additional stop',
    'additional stop': 'Additional stop',
};

const clean = (value: unknown, maxLength: number) => typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';

export function parseEvanRouteToolStops(value: unknown): EvanRouteToolStop[] {
    if (!Array.isArray(value)) return [];

    return value.slice(0, 8).flatMap((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const record = candidate as Record<string, unknown>;
        const kind = KIND_MAP[clean(record.kind, 32).toLowerCase()];
        const address = clean(record.address, 240);
        const city = clean(record.city, 80);
        const label = clean(record.label, 80);
        const orderValue = typeof record.order === 'number' && Number.isInteger(record.order)
            ? record.order
            : index + 1;
        if (!kind || record.confirmed !== true || address.length < 8 || orderValue < 1 || orderValue > 8) return [];
        return [{ kind, address, city, label, order: orderValue, confirmed: true as const }];
    }).sort((left, right) => left.order - right.order);
}

export function routeToolStopsToMovePlanStops(stops: EvanRouteToolStop[]): MovePlanStop[] {
    return stops.map((stop) => ({
        kind: stop.kind,
        city: stop.city || stop.label || 'Address pending',
        address: stop.address,
        displayAddress: stop.address,
        label: stop.label,
        confirmed: true,
        precision: 'pending',
    }));
}
export function parseResolvedEvanRouteStops(value: unknown): MovePlanStop[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 8).flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const record = candidate as Record<string, unknown>;
        const kind = KIND_MAP[clean(record.kind, 32).toLowerCase()];
        const city = clean(record.city, 80);
        const address = clean(record.address, 240);
        const displayAddress = clean(record.displayAddress, 260);
        const label = clean(record.label, 80);
        const precisionValue = clean(record.precision, 32);
        const precision: MovePlanStop['precision'] = precisionValue === 'address'
            || precisionValue === 'address-range'
            || precisionValue === 'unresolved'
            ? precisionValue
            : 'unresolved';
        const coordinatesRecord = record.coordinates && typeof record.coordinates === 'object' && !Array.isArray(record.coordinates)
            ? record.coordinates as Record<string, unknown>
            : null;
        const latitude = coordinatesRecord?.latitude;
        const longitude = coordinatesRecord?.longitude;
        const coordinates = typeof latitude === 'number' && Number.isFinite(latitude)
            && typeof longitude === 'number' && Number.isFinite(longitude)
            && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
            ? { latitude, longitude }
            : undefined;
        if (!kind || !city || !address) return [];
        return [{
            kind,
            city,
            address,
            displayAddress: displayAddress || address,
            label,
            confirmed: true,
            precision: coordinates ? precision : 'unresolved',
            ...(coordinates ? { coordinates } : {}),
        }];
    });
}
