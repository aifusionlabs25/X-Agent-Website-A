import { applyEvanRouteTurn } from './evan-move-planner.ts';
import type { MovePlanStop } from './evan-move-planner.ts';

const STREET = /\b\d{1,6}[a-z]?(?:-\d{1,6})?\s+(?:[a-z0-9.'-]+\s+){0,7}(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|court|ct|way|circle|cir|trail|trl|place|pl|parkway|pkwy)\b/gi;
const normalizeStreet = (value: string) => value.toLowerCase().replace(/[.,]/g, '')
    .replace(/\b(north|south|east|west|street|road|avenue|drive|lane|boulevard|court|circle|trail|place|parkway)\b/g,
        word => ({ north: 'n', south: 's', east: 'e', west: 'w', street: 'st', road: 'rd', avenue: 'ave', drive: 'dr', lane: 'ln', boulevard: 'blvd', court: 'ct', circle: 'cir', trail: 'trl', place: 'pl', parkway: 'pkwy' }[word] || word))
    .replace(/\s+/g, ' ').trim();

// Retain a previously resolved pin only for the same confirmed address/role.
// Reordering or correcting a different stop should not erase a good street pin.
export function preserveUnchangedEvanRoutePins(next: MovePlanStop[], previous: MovePlanStop[] | null): MovePlanStop[] {
    return next.map(stop => {
        if (stop.coordinates && (stop.precision === 'address' || stop.precision === 'address-range')) return stop;
        const prior = previous?.find(candidate => candidate.kind === stop.kind && candidate.address && stop.address
            && candidate.city.trim().toLowerCase() === stop.city.trim().toLowerCase()
            && normalizeStreet(candidate.address) === normalizeStreet(stop.address)
            && candidate.confirmed && candidate.coordinates
            && (candidate.precision === 'address' || candidate.precision === 'address-range'));
        return prior ? { ...stop, displayAddress: prior.displayAddress, coordinates: prior.coordinates, precision: prior.precision } : stop;
    });
}

export function finishAbandonedEvanRouteLookup(stops: MovePlanStop[]): MovePlanStop[] {
    return stops.some(stop => stop.precision === 'pending')
        ? stops.map(stop => stop.precision === 'pending' ? { ...stop, precision: 'unresolved' as const } : stop)
        : stops;
}

/**
 * Apply only completed visitor turns to a previously confirmed route. A spoken
 * address correction revokes the old street pin; it never geocodes or confirms
 * the new address. The existing confirmation + tool flow restores street pins.
 */
export function reconcileEvanConfirmedRoute(stops: MovePlanStop[], userTurn: string, previousAgentTurn = ''): MovePlanStop[] {
    let next = applyEvanRouteTurn(stops, userTurn, previousAgentTurn);

    for (const clause of userTurn.split(/[;!?]|\.(?:\s|$)|\bbut\b/i)) {
        // Uncertainty in a different sentence must not hide an explicit correction.
        if (/\b(?:what if|suppose|hypothetically|might|maybe)\b/i.test(clause)) continue;
        const streets = [...clause.matchAll(STREET)].map(match => normalizeStreet(match[0]));
        const explicitChange = /\b(?:change|changed|changing|correct|correction|update|updated|wrong|different|instead|actually)\b/i.test(clause);
        const addressSubject = /\b(?:address|street|house number|unit|suite)\b/i.test(clause);
        if (!streets.length && !(explicitChange && addressSubject)) continue;

        const roleText = /\b(?:origin|pickup|pick[- ]up|destination|delivery|drop[- ]off|storage|additional stop|extra stop|donation|mov(?:e|ing) (?:from|to))\b/i.test(clause)
            ? clause : previousAgentTurn;
        const kind = /\b(?:origin|pickup|pick[- ]up|mov(?:e|ing) from)\b/i.test(roleText) ? 'Origin'
            : /\b(?:destination|delivery|drop[- ]off|mov(?:e|ing) to)\b/i.test(roleText) ? 'Destination'
                : /\b(?:storage|additional stop|extra stop|donation)\b/i.test(roleText) ? 'Additional stop' : null;
        const targeted = next.filter(stop => stop.address && (!kind || stop.kind === kind));
        // A repeat of a known address is not a correction. Do not revoke other
        // same-city pins just because the caller repeats this address aloud.
        if (streets.length && streets.every(street => targeted.some(stop => normalizeStreet(stop.address!).includes(street)))
            && !(/\b(?:unit|suite|house number)\b/i.test(clause) && explicitChange)) continue;

        next = next.map(stop => {
            if (!targeted.includes(stop)) return stop;
            return { city: stop.city, kind: stop.kind, label: stop.label, confirmed: false, precision: 'unresolved' as const };
        });
    }
    return next.length === stops.length && next.every((stop, index) => stop === stops[index]) ? stops : next;
}
