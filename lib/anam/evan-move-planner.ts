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

const compact = (value: string, length = 150) => {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length > length ? `${clean.slice(0, length - 1).trim()}â€¦` : clean;
};

const unique = (values: string[], limit = 8) => [...new Set(values.filter(Boolean))].slice(0, limit);

const firstMatch = (text: string, patterns: RegExp[]) => {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[0]) return compact(match[0].replace(/^[,.;:\s]+|[,.;:\s]+$/g, ''), 90);
    }
    return '';
};

function routeStops(text: string): MovePlanStop[] {
    const mentions = CITY_NAMES.flatMap((city) => {
        const pattern = new RegExp(`\\b${city.replace(/ /g, '\\s+')}\\b`, 'gi');
        return [...text.matchAll(pattern)].map((match) => ({ city, index: match.index ?? 0 }));
    }).sort((a, b) => a.index - b.index);

    const deduped = mentions.filter((mention, index, all) =>
        all.findIndex((candidate) => candidate.city === mention.city) === index,
    );
    if (!deduped.length) return [];

    return deduped.map((mention, index) => {
        const before = text.slice(Math.max(0, mention.index - 42), mention.index).toLowerCase();
        const after = text.slice(mention.index + mention.city.length, mention.index + mention.city.length + 28).toLowerCase();
        let kind: MovePlanStop['kind'] = 'Additional stop';

        if (/\b(?:from|origin(?:ating)? in|moving out of|house in)\s*$/.test(before)) kind = 'Origin';
        else if (/\b(?:to|into|destination(?: is| in)?|new home in|moving into)\s*$/.test(before)) kind = 'Destination';
        else if (/\b(?:storage|garage|donation|facility|assisted living|pickup|stop)\b/.test(before + after)) kind = 'Additional stop';
        else if (index === 0) kind = 'Origin';
        else if (index === deduped.length - 1) kind = 'Destination';

        return { city: mention.city, kind };
    });
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

export function buildEvanMovePlan(turns: EvanMovePlannerTurn[]): EvanMovePlanModel {
    const userTurns = turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => compact(turn.content, 1_000))
        .filter(Boolean);
    const text = userTurns.join(' ');
    const stops = routeStops(text);
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
        stops.length ? { label: 'Route', value: stops.map((stop) => stop.city).join(' â†’ ') } : null,
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

