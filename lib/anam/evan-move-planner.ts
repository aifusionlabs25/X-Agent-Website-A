export type EvanMovePlannerTurn = {
    role: 'user' | 'agent';
    content: string;
};

export type EvanMovePlannerView = 'brief' | 'route' | 'inventory' | 'readiness';

export type MovePlanSignal = {
    label: string;
    value: string;
};

export type MovePlanStop = {
    city: string;
    kind: 'Origin' | 'Destination' | 'Additional stop';
    address?: string;
    displayAddress?: string;
    label?: string;
    confirmed?: boolean;
    coordinates?: MovePlanCoordinates;
    precision?: 'address' | 'address-range' | 'city' | 'pending' | 'unresolved';
};

export type MovePlanCoordinates = {
    latitude: number;
    longitude: number;
};

export interface EvanMovePlanModel {
    status: 'listening' | 'building';
    stops: MovePlanStop[];
    timing: string;
    propertyScope: string;
    services: string[];
    specialtyItems: string[];
    accessFactors: string[];
    carePriorities: string[];
    uncertainties: string[];
    highlights: MovePlanSignal[];
    openItems: string[];
    readiness: number;
    capturedCategories: number;
    totalCategories: number;
}

export const EVAN_MOVE_PLANNER_BOUNDARY = 'Conversation working view only. Mullins Moving must confirm scope, pricing, availability, handling requirements, and every appointment.';

const CITY_NAMES = [
    'Phoenix', 'Mesa', 'Chandler', 'Surprise', 'Scottsdale', 'Tempe', 'Gilbert',
    'Glendale', 'Queen Creek', 'Peoria', 'Goodyear', 'Avondale', 'Buckeye',
    'Paradise Valley', 'Fountain Hills', 'Sun City', 'Cave Creek', 'Carefree',
    'Litchfield Park', 'Maricopa', 'Tucson', 'Flagstaff', 'Prescott', 'Sedona',
];

const CITY_COORDINATES: Record<string, MovePlanCoordinates> = {
    Phoenix: { latitude: 33.4484, longitude: -112.0740 },
    Mesa: { latitude: 33.4152, longitude: -111.8315 },
    Chandler: { latitude: 33.3062, longitude: -111.8413 },
    Surprise: { latitude: 33.6292, longitude: -112.3679 },
    Scottsdale: { latitude: 33.4942, longitude: -111.9261 },
    Tempe: { latitude: 33.4255, longitude: -111.9400 },
    Gilbert: { latitude: 33.3528, longitude: -111.7890 },
    Glendale: { latitude: 33.5387, longitude: -112.1860 },
    'Queen Creek': { latitude: 33.2487, longitude: -111.6343 },
    Peoria: { latitude: 33.5806, longitude: -112.2374 },
    Goodyear: { latitude: 33.4353, longitude: -112.3577 },
    Avondale: { latitude: 33.4356, longitude: -112.3496 },
    Buckeye: { latitude: 33.3703, longitude: -112.5838 },
    'Paradise Valley': { latitude: 33.5312, longitude: -111.9426 },
    'Fountain Hills': { latitude: 33.6042, longitude: -111.7257 },
    'Sun City': { latitude: 33.5975, longitude: -112.2718 },
    'Cave Creek': { latitude: 33.8334, longitude: -111.9507 },
    Carefree: { latitude: 33.8223, longitude: -111.9182 },
    'Litchfield Park': { latitude: 33.4934, longitude: -112.3577 },
    Maricopa: { latitude: 33.0581, longitude: -112.0476 },
    Tucson: { latitude: 32.2226, longitude: -110.9747 },
    Flagstaff: { latitude: 35.1983, longitude: -111.6513 },
    Prescott: { latitude: 34.5400, longitude: -112.4685 },
    Sedona: { latitude: 34.8697, longitude: -111.7610 },
};

export function getMovePlanStopCoordinates(stop: MovePlanStop): MovePlanCoordinates | null {
    return stop.coordinates ?? CITY_COORDINATES[stop.city] ?? null;
}

export function buildGoogleMapsDirectionsUrl(stops: MovePlanStop[]): string {
    const locations = stops.map((stop) => stop.displayAddress || stop.address || `${stop.city}, Arizona`).filter(Boolean);
    if (!locations.length) return '';

    if (locations.length === 1) {
        const search = new URLSearchParams({ api: '1', query: locations[0] });
        return `https://www.google.com/maps/search/?${search.toString()}`;
    }

    const directions = new URLSearchParams({
        api: '1',
        travelmode: 'driving',
        origin: locations[0],
        destination: locations.at(-1) ?? locations[0],
    });
    if (locations.length > 2) directions.set('waypoints', locations.slice(1, -1).join('|'));
    return `https://www.google.com/maps/dir/?${directions.toString()}`;
}

const compact = (value: string, length = 150) => {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length > length ? `${clean.slice(0, length - 3).trim()}...` : clean;
};

const unique = (values: string[], limit = 8) => [...new Set(values.filter(Boolean))].slice(0, limit);

const firstMatch = (text: string, patterns: RegExp[]) => {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[0]) return compact(match[0].replace(/^[,.;:\s]+|[,.;:\s]+$/g, ''), 90);
    }
    return '';
};

function routeStops(userTurns: string[]): MovePlanStop[] {
    const mentions = userTurns.flatMap((turn, turnIndex) => CITY_NAMES.flatMap((city) => {
        const pattern = new RegExp(`\\b${city.replace(/ /g, '\\s+')}\\b`, 'gi');
        return [...turn.matchAll(pattern)].map((match) => {
            const index = match.index ?? 0;
            const before = turn.slice(Math.max(0, index - 72), index).toLowerCase();
            const after = turn.slice(index + city.length, index + city.length + 48).toLowerCase();
            let kind: MovePlanStop['kind'] | null = null;

            if (/\b(?:from|origin(?:ating)?(?: is| in| at)?|moving out of|leaving|starting in|starts? in|pickup from)\s*$/.test(before)) {
                kind = 'Origin';
            } else if (/\b(?:final destination(?: is| in| at)?|destination(?: is| in| at)?|moving into|new home(?: is| in| at)?|delivering to|deliver to|ending in|to)\s*$/.test(before)) {
                kind = 'Destination';
            } else if (/\b(?:additional stop|extra stop|stop(?:ping)?(?: is| in| at)?|pick up(?: is| in| at| from)?|pickup in|storage(?: unit)?(?: is| in| at)?|donation(?: center)?(?: is| in| at)?|garage(?: is| in| at)?)\s*$/.test(before)
                || /\b(?:storage|donation|facility|assisted living|pickup|pick up|stop)\b/.test(before + after)) {
                kind = 'Additional stop';
            }

            return { city, turnIndex, index, kind };
        });
    })).sort((a, b) => a.turnIndex - b.turnIndex || a.index - b.index);

    if (!mentions.length) return [];

    // Explicit role statements are authoritative. A later correction replaces the
    // earlier origin or destination instead of turning it into an extra stop.
    let origin = '';
    let destination = '';
    const additionalStops: string[] = [];
    for (const mention of mentions) {
        if (mention.kind === 'Origin') origin = mention.city;
        else if (mention.kind === 'Destination') destination = mention.city;
        else if (mention.kind === 'Additional stop' && !additionalStops.includes(mention.city)) {
            additionalStops.push(mention.city);
        }
    }

    const orderedCities = unique(mentions.map((mention) => mention.city), CITY_NAMES.length);
    const explicitlyRoutedCities = new Set(
        mentions
            .filter((mention) => mention.kind === 'Origin' || mention.kind === 'Destination')
            .map((mention) => mention.city),
    );
    origin ||= orderedCities[0] ?? '';
    destination ||= orderedCities.findLast((city) => city !== origin) ?? '';

    const middle = unique([
        ...additionalStops,
        ...orderedCities.filter((city) => !explicitlyRoutedCities.has(city)),
    ], CITY_NAMES.length).filter((city) => city !== origin && city !== destination);

    return [
        origin ? { city: origin, kind: 'Origin' as const } : null,
        ...middle.map((city) => ({ city, kind: 'Additional stop' as const })),
        destination ? { city: destination, kind: 'Destination' as const } : null,
    ].filter((stop): stop is MovePlanStop => stop !== null);
}

const LABEL_RULES: Array<[RegExp, string]> = [
    [/\bfull[- ]service packing\b|\bfull packing\b/i, 'Full packing'],
    [/\bpacking\b/i, 'Packing support'],
    [/\bunpacking\b/i, 'Unpacking'],
    [/\blabor[- ]only\b/i, 'Labor-only support'],
    [/\bstorage unit\b|\bstorage\b/i, 'Storage stop'],
    [/\bcommercial\b|\boffice move\b/i, 'Commercial move'],
    [/\bsenior move\b|\belderly\b|\bassisted living\b/i, 'Senior move support'],
    [/\blong[- ]distance\b|\bout of state\b/i, 'Long-distance move'],
    [/\bdonation\b/i, 'Donation items'],
    [/\bdisassembl(?:e|y|ing)\b/i, 'Furniture disassembly'],
];

const SPECIALTY_RULES: Array<[RegExp, string]> = [
    [/\bsectional(?: sofa| couch)?\b/i, 'Sectional'],
    [/\btreadmill\b/i, 'Treadmill'],
    [/\btool chest\b/i, 'Tool chest'],
    [/\blarge mirrors?\b/i, 'Large mirrors'],
    [/\bantiques?\b|\bantique furniture\b/i, 'Antiques'],
    [/\bartwork\b|\bfine art\b|\bpaintings?\b/i, 'Artwork'],
    [/\bgrandfather clock\b/i, 'Grandfather clock'],
    [/\bpianos?\b/i, 'Piano'],
    [/\bsafes?\b/i, 'Safe'],
    [/\bcurio cabinet\b/i, 'Curio cabinet'],
    [/\bmedical equipment\b/i, 'Medical equipment'],
    [/\bfragile\b/i, 'Fragile items'],
    [/\bpool table\b/i, 'Pool table'],
    [/\bgun safe\b/i, 'Gun safe'],
];

const ACCESS_RULES: Array<[RegExp, string]> = [
    [/\bnarrow driveway\b/i, 'Narrow driveway'],
    [/\bstairs?\b|\bstaircase\b/i, 'Stairs'],
    [/\belevator\b/i, 'Elevator requirements'],
    [/\bloading dock\b|\bloading window\b/i, 'Loading access'],
    [/\bgated?\b|\bgate code\b/i, 'Gate access'],
    [/\bparking\b/i, 'Parking constraints'],
    [/\bmove[- ]in hours\b|\bpermitted hours\b|\bfacility hours\b/i, 'Facility hours'],
    [/\bhoa\b/i, 'HOA requirements'],
    [/\bapartment\b/i, 'Apartment access'],
];

const CARE_RULES: Array<[RegExp, string]> = [
    [/\bwalker\b|\bwheelchair\b|\bmobility\b/i, 'Mobility considerations'],
    [/\belderly\b|\bsenior\b/i, 'Senior comfort'],
    [/\bstress(?:ed|ful)?\b|\bchaotic\b/i, 'Minimize disruption'],
    [/\bfinish time\b|\btime sensitive\b|\burgent\b|\bless than \d+ days?\b/i, 'Time-sensitive move'],
    [/\bmultiple destinations?\b|\bseveral stops?\b/i, 'Multi-stop coordination'],
];

function labelsFrom(text: string, rules: Array<[RegExp, string]>, limit = 8) {
    return unique(rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label), limit);
}

function uncertaintySignals(userTurns: string[]) {
    return unique(userTurns.flatMap((turn) => turn
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => /\b(?:not sure|I think|maybe|might|have to check|don't know|do not know)\b/i.test(sentence))
        .map((sentence) => compact(sentence, 115))), 4);
}

export function buildEvanMovePlan(turns: EvanMovePlannerTurn[], confirmedStops: MovePlanStop[] = []): EvanMovePlanModel {
    const userTurns = turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => compact(turn.content, 1_000))
        .filter(Boolean);
    const text = userTurns.join(' ');
    const transcriptStops = routeStops(userTurns);
    const stops = confirmedStops.length ? confirmedStops.slice(0, 8) : transcriptStops;
    const services = labelsFrom(text, LABEL_RULES);
    if (services.includes('Full packing')) {
        const genericPacking = services.indexOf('Packing support');
        if (genericPacking >= 0) services.splice(genericPacking, 1);
    }
    const specialtyItems = labelsFrom(text, SPECIALTY_RULES);
    const accessFactors = labelsFrom(text, ACCESS_RULES);
    const carePriorities = labelsFrom(text, CARE_RULES);
    const uncertainties = uncertaintySignals(userTurns);
    const timing = firstMatch(text, [
        /\bless than \d+ days?\b/i,
        /\bwithin (?:the next )?\d+ days?\b/i,
        /\b(?:target(?: date)?(?: is|:)?|targeting|scheduled for|needs? to be|has to be) (?:the )?\d{1,2}(?:st|nd|rd|th)?\b/i,
        /\bby (?:the )?\d{1,2}(?:st|nd|rd|th)?\b/i,
        /\bon (?:the )?\d{1,2}(?:st|nd|rd|th)?(?: of [A-Z][a-z]+)?\b/i,
        /\b(?:next|this) (?:week|month|weekend)\b/i,
        /\b(?:one|two|three|four|five|six|seven|eight|nine|ten) weeks?\b/i,
        /\bflexible[^.!?]{0,40}\b(?:week|month|date|timing)\b/i,
    ]);
    const propertyScope = firstMatch(text, [
        /\b(?:studio|one|two|three|four|five|six|\d+)[ -]bedroom (?:apartment|condo|home|house)?\b/i,
        /\b(?:apartment|condo|townhome|single[- ]family home|house|office|commercial space)\b/i,
    ]);

    const highlights: MovePlanSignal[] = [
        stops.length ? { label: 'Route', value: stops.map((stop) => stop.city).join(' \u2192 ') } : null,
        timing ? { label: 'Timing', value: timing } : null,
        propertyScope ? { label: 'Property / scope', value: propertyScope } : null,
        services.length ? { label: 'Requested support', value: services.join(', ') } : null,
        specialtyItems.length ? { label: 'Special handling', value: specialtyItems.join(', ') } : null,
        accessFactors.length ? { label: 'Access', value: accessFactors.join(', ') } : null,
    ].filter((signal): signal is MovePlanSignal => signal !== null);

    const hasOrigin = stops.some((stop) => stop.kind === 'Origin');
    const hasDestination = stops.some((stop) => stop.kind === 'Destination');
    const categories = [
        hasOrigin && hasDestination,
        Boolean(timing),
        Boolean(propertyScope),
        services.length > 0 || specialtyItems.length > 0,
        accessFactors.length > 0,
        carePriorities.length > 0,
    ];
    const capturedCategories = categories.filter(Boolean).length;
    const readiness = Math.round((capturedCategories / categories.length) * 100);

    const openItems = unique([
        !hasOrigin ? 'Confirm the move origin.' : '',
        !hasDestination ? 'Confirm the final destination.' : '',
        !timing ? 'Capture the preferred move date or window.' : '',
        !propertyScope ? 'Confirm the approximate home or business size.' : '',
        !services.length ? 'Clarify packing, labor, storage, or other requested services.' : '',
        !accessFactors.length ? 'Check stairs, elevators, parking, gates, and loading access.' : '',
        specialtyItems.length ? 'Mullins must review specialty-item handling requirements.' : '',
        ...uncertainties.map((item) => `Clarify: ${item}`),
    ], 6);

    return {
        status: userTurns.length ? 'building' : 'listening',
        stops,
        timing,
        propertyScope,
        services,
        specialtyItems,
        accessFactors,
        carePriorities,
        uncertainties,
        highlights,
        openItems,
        readiness,
        capturedCategories,
        totalCategories: categories.length,
    };
}
