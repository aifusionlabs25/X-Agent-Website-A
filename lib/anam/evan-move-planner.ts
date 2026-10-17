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

const sentences = (text: string) => text.split(/(?<=[.!?;])\s+|\s+(?:but|however)\s+/i).filter(Boolean);
const isUncommittedQuestion = (text: string) => /^(?:what if|suppose|hypothetically|do you|does mullins|can (?:you|we)|could (?:you|we)|would (?:you|we)|is there|are there|what about)\b/i.test(text.trim())
    && !/\b(?:add|remove|delete|replace|change|update|correct|reorder|put|make|switch|skip|move .+ (?:before|after))\b/i.test(text);
const isHypothetical = (text: string) => /^(?:what if|suppose|hypothetically)\b/i.test(text.trim()) || isUncommittedQuestion(text)
    || /\b(?:might|maybe|possibly|considering)\b/i.test(text)
    || /\b(?:we|i) (?:may|could|would) (?:move|relocate|need|want)\b/i.test(text);

// Only a local, explicit negative cue changes a captured fact. A negative cue
// about the piano must not erase packing mentioned later in the same sentence.
function isNegativeMention(text: string, index: number, length: number): boolean {
    const before = text.slice(0, index).replace(/^\s*(?:no|nope)[,!]\s*|^\s*no\s+(?=(?:we|i|our|my)\b)/i, '');
    const cues = [...before.matchAll(/\b(?:do not need|don't need|do not want|don't want|no longer(?: need| want| have)?|not needed|not moving|aren't moving|are not moving|without|remove|delete|exclude|cancel|skip|no|not|add(?: back)?|include|keep|need|want|have|there (?:is|are)|only|just)\b/gi)];
    const lastCue = cues.at(-1)?.[0] ?? '';
    if (/^(?:do not|don't|no|not|aren't|are not|without|remove|delete|exclude|cancel|skip)\b/i.test(lastCue)) return true;
    const after = text.slice(index + length);
    return /^\s*(?:(?:is|are|was|were|will be|should be|can be|has been|have been)\s+)?(?:not needed|no longer needed|removed|cancelled|canceled|excluded|not included)\b/i.test(after);
}

function latestMatch(userTurns: string[], patterns: RegExp[], kind: 'timing' | 'property'): string {
    let value = '';
    for (const turn of userTurns) {
        for (const sentence of sentences(turn)) {
            if (isHypothetical(sentence)) continue;
            const matches = patterns.flatMap((pattern) => [...sentence.matchAll(new RegExp(pattern.source, 'gi'))]
                .map((match) => ({ value: match[0], index: match.index ?? 0 })));
            // A specific "two-bedroom house" beats the overlapping generic
            // "house" match, while a later separate correction still wins.
            const specific = matches.filter((match) => !matches.some((other) => other !== match
                && other.index <= match.index
                && other.index + other.value.length >= match.index + match.value.length
                && other.value.length > match.value.length));
            for (const match of specific.sort((left, right) => left.index - right.index)) {
                if (!isNegativeMention(sentence, match.index, match.value.length)) {
                    if (kind === 'property' && /\bbedroom\b/i.test(value) && !/\bbedroom\b/i.test(match.value)
                        && !/\b(?:actually|instead|correction|change|switch|property (?:is|to)|it is|it's)\b/i.test(sentence)) continue;
                    value = compact(match.value.replace(/^[,.;:\s]+|[,.;:\s]+$/g, ''), 90);
                }
            }
        }
    }
    return value;
}

type CityMention = { city: string; index: number; end: number };
const cityMentions = (text: string): CityMention[] => CITY_NAMES.flatMap((city) => (
    [...text.matchAll(new RegExp(`\\b${city.replace(/ /g, '\\s+')}\\b`, 'gi'))]
        .map((match) => ({ city, index: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
)).sort((left, right) => left.index - right.index);
const sameCity = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const stopPurpose = (text: string) => text.match(/\b(?:storage|donation|garage|assisted living)\b/i)?.[0];

function locationQuestionRole(question: string): MovePlanStop['kind'] | null {
    if (!/\b(?:where|which|what|any)\b/i.test(question)) return null;
    if (/\b(?:extra|additional|other|storage|donation)\b[^?]*\bstops?\b/i.test(question)) return 'Additional stop';
    const origin = /\b(?:from|origin|pickup|picking up|starts?|starting|leaving)\b/i.test(question);
    const destination = /\b(?:to|destination|delivery|delivering|ends?|ending)\b/i.test(question);
    return origin !== destination ? origin ? 'Origin' : 'Destination' : null;
}

function cityRole(before: string, after: string): MovePlanStop['kind'] | null {
    if (/\b(?:additional|extra|storage|donation|garage)\b[^,.;!?]{0,45}$|\b(?:stop|stopping|pick up)\s+(?:in|at|from)\s*$/i.test(before)
        || /^\s*(?:storage|donation|garage|stop)\b/i.test(after)) return 'Additional stop';
    if (/\b(?:from|origin(?:ating)?(?: is)?(?: in| at)?|moving out of(?: (?:his|her|my|our|the) (?:house|home) in)?|leaving|starting in|starts? in|pickup(?: is)?(?: from| in| at)?)\s*$/i.test(before)) return 'Origin';
    if (/\b(?:destination(?: is)?(?: in| at)?|delivery(?: is)?(?: in| at)?|moving into(?: (?:a|the|our|my|his|her) (?:home|house) in)?|eventually (?:to |into )?(?:a|the|our|my) (?:home|house|apartment) in|new home(?: is| in| at)?|delivering to|deliver to|ending in|to)\s*$/i.test(before)) return 'Destination';
    return null;
}

/** Apply one user correction without discarding precise pins on unchanged stops. */
export function applyEvanRouteTurn(stops: MovePlanStop[], userTurn: string, previousAgentTurn = ''): MovePlanStop[] {
    let next = stops.slice();
    const selectCityStop = (city: string, context: string, roleHint: MovePlanStop['kind'] | null = null) => {
        let candidates = next.filter((stop) => sameCity(stop.city, city));
        const purpose = stopPurpose(context);
        const role = /\b(?:destination|delivery)\b/i.test(context) ? 'Destination'
            : /\b(?:origin|pickup)\b/i.test(context) ? 'Origin'
                : /\b(?:additional|extra|storage|donation|garage|stop)\b/i.test(context) ? 'Additional stop' : roleHint;
        if (role) candidates = candidates.filter((stop) => stop.kind === role);
        if (purpose) {
            candidates = candidates.filter((stop) => stop.kind === 'Additional stop'
                && (!stop.label || new RegExp(`\\b${purpose}\\b`, 'i').test(stop.label)));
        }
        // Street routes can have several different addresses in the same city.
        // An ambiguous city-only edit must not remove or replace all of them.
        return candidates.length === 1 ? candidates[0] : null;
    };
    const removeStop = (stop: MovePlanStop | null) => { if (stop) next = next.filter((candidate) => candidate !== stop); };
    const setStop = (city: string, kind: MovePlanStop['kind'], purpose?: string) => {
        const existing = next.find((stop) => stop.kind === kind && sameCity(stop.city, city));
        if (existing) return;
        if (kind === 'Additional stop' && next.some((stop) => sameCity(stop.city, city))) return;
        const replacement: MovePlanStop = { city, kind, ...(purpose ? { label: purpose } : {}) };
        if (kind !== 'Additional stop') {
            const index = next.findIndex((stop) => stop.kind === kind);
            next = next.filter((stop) => stop.kind !== kind && !(stop.kind === 'Additional stop' && sameCity(stop.city, city) && !stop.address));
            if (index >= 0) next.splice(Math.min(index, next.length), 0, replacement);
            else if (kind === 'Origin') next.unshift(replacement);
            else next.push(replacement);
        } else {
            const destination = next.findIndex((stop) => stop.kind === 'Destination');
            next.splice(destination < 0 ? next.length : destination, 0, replacement);
        }
    };

    for (const sentence of sentences(userTurn)) {
        if (isHypothetical(sentence)) continue;
        if (/^\s*(?:please\s+)?(?:clear|reset|start over with)\s+(?:the\s+)?(?:entire\s+|whole\s+)?(?:route|map|all (?:stops|locations))\b/i.test(sentence)) {
            next = [];
            continue;
        }
        const mentions = cityMentions(sentence);
        const handled = new Set<number>();

        // A concise answer to "from and to?" has the same meaning as a full
        // moving sentence. Bare city lists elsewhere do not establish a route.
        if (mentions.length === 2) {
            const prefix = sentence.slice(0, mentions[0].index).trim();
            const connector = sentence.slice(mentions[0].end, mentions[1].index).trim();
            const suffix = sentence.slice(mentions[1].end).replace(/[.!]/g, '').trim();
            const pairedQuestion = /\b(?:where|which|what)\b/i.test(previousAgentTurn)
                && /\b(?:from|origin|pickup)\b/i.test(previousAgentTurn)
                && /\b(?:to|destination|delivery)\b/i.test(previousAgentTurn);
            const explicitPair = /^(?:from)?$/i.test(prefix) && /^(?:to|->|\u2192)$/i.test(connector);
            const contextualPair = pairedQuestion && !prefix && /^(?:and|to)$/i.test(connector);
            if (!suffix && (explicitPair || contextualPair)) {
                setStop(mentions[0].city, 'Origin');
                setStop(mentions[1].city, 'Destination');
                handled.add(0);
                handled.add(1);
            }
        }

        // Replacement is a route edit, not another destination or an extra stop.
        for (let index = 0; index + 1 < mentions.length; index += 1) {
            const first = mentions[index];
            const second = mentions[index + 1];
            const before = sentence.slice(0, first.index);
            const between = sentence.slice(first.end, second.index);
            const replacementCommand = /\b(?:replace|change|switch|swap)\b/i.test(before) && !/\b(?:route|move)\s+from\s*$/i.test(before);
            const forward = replacementCommand && /\b(?:with|to|for)\b/i.test(between)
                || /\b(?:not|instead of)\s*$/i.test(before) && /\b(?:it is|it's|but|to|with|is)\b/i.test(between);
            const backward = /\b(?:instead of|rather than|not)\s*$/i.test(between);
            const oldCity = backward ? second.city : first.city;
            const newCity = backward ? first.city : second.city;
            if (!(forward || backward)) continue;
            const oldStop = selectCityStop(oldCity, before + between);
            if (!oldStop) {
                if (next.some((stop) => sameCity(stop.city, oldCity))) {
                    handled.add(index);
                    handled.add(index + 1);
                    index += 1;
                }
                continue;
            }
            const oldIndex = next.indexOf(oldStop);
            removeStop(oldStop);
            const replacement = { city: newCity, kind: oldStop.kind, ...(oldStop.label ? { label: oldStop.label } : {}) };
            next.splice(Math.min(oldIndex, next.length), 0, replacement);
            handled.add(index);
            handled.add(index + 1);
            index += 1;
        }

        // Reorder existing locations only. No new pin is invented from a request
        // such as "could we stop before Phoenix?".
        if (mentions.length === 2 && /\b(?:before|after)\b/i.test(sentence)) {
            const firstIndex = next.findIndex((stop) => sameCity(stop.city, mentions[0].city));
            const secondIndex = next.findIndex((stop) => sameCity(stop.city, mentions[1].city));
            const between = sentence.slice(mentions[0].end, mentions[1].index);
            if (firstIndex >= 0 && secondIndex >= 0 && next[firstIndex].kind === 'Additional stop'
                && next[secondIndex].kind === 'Additional stop' && /\b(?:before|after)\b/i.test(between)) {
                const [moved] = next.splice(firstIndex, 1);
                const anchor = next.findIndex((stop) => sameCity(stop.city, mentions[1].city));
                next.splice(anchor + (/\bafter\b/i.test(between) ? 1 : 0), 0, moved);
                handled.add(0);
                handled.add(1);
            }
        }

        const ordinal = sentence.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+stop\b/i);
        if (mentions.length === 1 && ordinal) {
            const index = next.findIndex((stop) => sameCity(stop.city, mentions[0].city) && stop.kind === 'Additional stop');
            if (index >= 0) {
                const [moved] = next.splice(index, 1);
                const target = ({ first: 0, second: 1, third: 2, fourth: 3, fifth: 4, '1st': 0, '2nd': 1, '3rd': 2, '4th': 3, '5th': 4 } as Record<string, number>)[ordinal[1].toLowerCase()];
                const firstMiddle = next.some((stop) => stop.kind === 'Origin') ? 1 : 0;
                const destination = next.findIndex((stop) => stop.kind === 'Destination');
                next.splice(Math.max(firstMiddle, Math.min(target, destination < 0 ? next.length : destination)), 0, moved);
                handled.add(0);
            }
        }

        if (!mentions.length && /^\s*(?:please\s+)?(?:remove|delete|clear)\s+(?:the\s+)?(?:current\s+)?(?:origin|pickup|destination|delivery)\b/i.test(sentence)) {
            const kind = /\b(?:origin|pickup)\b/i.test(sentence) ? 'Origin' : 'Destination';
            next = next.filter((stop) => stop.kind !== kind);
        }

        // Named removals work with confirmed tool labels, or the only extra stop.
        if (!mentions.length && /\b(?:remove|delete|skip|cancel|no longer need|do not need|don't need)\b/i.test(sentence) && /\bstops?\b/i.test(sentence)) {
            const purpose = stopPurpose(sentence);
            const extras = next.filter((stop) => stop.kind === 'Additional stop');
            const matching = extras.filter((stop) => purpose && new RegExp(`\\b${purpose}\\b`, 'i').test(stop.label ?? ''));
            if (/\b(?:all|any) (?:extra|additional|storage|donation)?\s*stops?\b/i.test(sentence)) {
                next = next.filter((stop) => stop.kind !== 'Additional stop' || (purpose && !matching.includes(stop)));
            } else if (matching.length === 1 || extras.length === 1) {
                next = next.filter((stop) => stop !== (matching[0] ?? extras[0]));
            }
        }

        for (const [index, mention] of mentions.entries()) {
            if (handled.has(index)) continue;
            const before = sentence.slice(0, mention.index);
            const after = sentence.slice(mention.end);
            const localBefore = before.slice(Math.max(before.lastIndexOf(',') + 1, before.lastIndexOf(';') + 1, mentions[index - 1]?.end ?? 0));
            const answer = sentence.trim().replace(/[.!]/g, '')
                .replace(/^(?:(?:no|actually|sorry|correction)[,:]?\s+)*(?:it is\s+|it's\s+)?/i, '')
                .replace(/\s+instead$/i, '');
            const isCityOnlyAnswer = mentions.length === 1 && answer.toLowerCase() === mention.city.toLowerCase();
            const kind = cityRole(localBefore, after) ?? (isCityOnlyAnswer ? locationQuestionRole(previousAgentTurn) : null);
            if (isNegativeMention(sentence, mention.index, mention.end - mention.index)) {
                // Explicit cancellation of a location is meaningful; a negated
                // service question or unrelated city mention is not a route edit.
                if (/\b(?:remove|delete|skip|cancel)(?: the)?\s*$/i.test(localBefore)
                    || /\b(?:remove|delete|skip|cancel|no longer need)\b[^,.;!?]*\b(?:stop|pickup|destination|origin|storage|donation)\b/i.test(localBefore)
                    || /\bnot\s*$/i.test(localBefore)
                    || kind && /\b(?:not moving|aren't moving|are not moving|no longer moving)\b/i.test(localBefore)) {
                    removeStop(selectCityStop(mention.city, localBefore + after, kind));
                }
                continue;
            }
            if (kind) {
                setStop(mention.city, kind, kind === 'Additional stop' ? stopPurpose(localBefore + after) : undefined);
            } else if (next.some((stop) => sameCity(stop.city, mention.city))) {
                continue;
            } else if (/\b(?:mov(?:e|ing)|relocat(?:e|ing)|route|pickup|pick up|deliver|destination|origin|stop)\b/i.test(sentence)
                || sentence.trim().replace(/[.!]/g, '').toLowerCase() === mention.city.toLowerCase()) {
                const fallback: MovePlanStop['kind'] = !next.some((stop) => stop.kind === 'Origin') ? 'Origin'
                    : !next.some((stop) => stop.kind === 'Destination') ? 'Destination' : 'Additional stop';
                setStop(mention.city, fallback);
            }
        }
    }
    return next.length === stops.length && next.every((stop, index) => stop === stops[index]) ? stops : next;
}

function routeStops(turns: EvanMovePlannerTurn[]): MovePlanStop[] {
    let stops: MovePlanStop[] = [];
    let previousAgentTurn = '';
    for (const turn of turns) {
        if (turn.role === 'agent') previousAgentTurn = turn.content;
        else {
            stops = applyEvanRouteTurn(stops, compact(turn.content, 1_000), previousAgentTurn);
            previousAgentTurn = '';
        }
    }
    return stops.map(({ city, kind }) => ({ city, kind }));
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

function labelsFrom(userTurns: string[], rules: Array<[RegExp, string]>, limit = 8) {
    const active = new Set<string>();
    for (const turn of userTurns) {
        for (const sentence of sentences(turn)) {
            if (isHypothetical(sentence)) continue;
            const matches = rules.flatMap(([pattern, label]) => [...sentence.matchAll(new RegExp(pattern.source, 'gi'))]
                .map((match) => ({ label, value: match[0], index: match.index ?? 0 })))
                .sort((left, right) => left.index - right.index);
            for (const match of matches) {
                if (isNegativeMention(sentence, match.index, match.value.length)) {
                    active.delete(match.label);
                    if (match.label === 'Packing support') active.delete('Full packing');
                } else {
                    active.add(match.label);
                    if (match.label === 'Packing support' && !/\bfull(?:[- ]service)? packing\b/i.test(sentence)
                        && /\b(?:only|instead|actually|change|switch)\b/i.test(sentence)) active.delete('Full packing');
                }
            }
        }
    }
    return rules.map(([, label]) => label).filter((label) => active.has(label)).slice(0, limit);
}

function uncertaintySignals(userTurns: string[]) {
    return unique(userTurns.flatMap((turn) => turn
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => /\b(?:not sure|I think|maybe|might|probably|tentative|have to check|don't know|do not know)\b/i.test(sentence))
        .map((sentence) => compact(sentence, 115))), 4);
}

export function buildEvanMovePlan(turns: EvanMovePlannerTurn[], confirmedStops: MovePlanStop[] | null = null): EvanMovePlanModel {
    const userTurns = turns
        .filter((turn) => turn.role === 'user')
        .map((turn) => compact(turn.content, 1_000))
        .filter(Boolean);
    const transcriptStops = routeStops(turns);
    const stops = confirmedStops !== null ? confirmedStops.slice(0, 8) : transcriptStops;
    const services = labelsFrom(userTurns, LABEL_RULES);
    if (services.includes('Full packing')) {
        const genericPacking = services.indexOf('Packing support');
        if (genericPacking >= 0) services.splice(genericPacking, 1);
    }
    const specialtyItems = labelsFrom(userTurns, SPECIALTY_RULES);
    const accessFactors = labelsFrom(userTurns, ACCESS_RULES);
    const carePriorities = labelsFrom(userTurns, CARE_RULES);
    const uncertainties = uncertaintySignals(userTurns);
    const timing = latestMatch(userTurns, [
        /\bless than \d+ days?\b/i,
        /\bwithin (?:the next )?\d+ days?\b/i,
        /\b(?:target(?: date)?(?: is|:)?|targeting|scheduled for|needs? to be|has to be) (?:the )?\d{1,2}(?:st|nd|rd|th)?\b/i,
        /\bby (?:the )?\d{1,2}(?:st|nd|rd|th)?\b/i,
        /\bon (?:the )?\d{1,2}(?:st|nd|rd|th)?(?: of [A-Z][a-z]+)?\b/i,
        /\b(?:next|this) (?:week|month|weekend)\b/i,
        /\b(?:one|two|three|four|five|six|seven|eight|nine|ten) weeks?\b/i,
        /\bflexible[^.!?]{0,40}\b(?:week|month|date|timing)\b/i,
    ], 'timing');
    const propertyScope = latestMatch(userTurns, [
        /\b(?:studio|one|two|three|four|five|six|\d+)[ -]bedroom (?:apartment|condo|home|house)?\b/i,
        /\b(?:apartment|condo|townhome|single[- ]family home|house|office|commercial space)\b/i,
    ], 'property');

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
        !hasOrigin ? 'Your pickup location, when you know it.' : '',
        !hasDestination ? 'Your final destination, when you know it.' : '',
        !timing ? 'Your preferred move date or date range.' : '',
        !propertyScope ? 'Approximate home size or number of rooms.' : '',
        !services.length ? 'Any packing, unpacking, or loading help you would like.' : '',
        !accessFactors.length ? 'Stairs, elevators, parking, and loading arrangements.' : '',
        specialtyItems.length ? 'Ask Mullins to review handling needs for your special items.' : '',
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
