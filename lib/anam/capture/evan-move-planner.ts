import { stripEvanCaptureLeadIn } from './evan-capture-language.ts';

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
    possibleStops: MovePlanStop[];
    routeNeedsClarification: boolean;
    timing: string;
    propertyScope: string;
    packingPlan: string;
    services: string[];
    inventoryItems: string[];
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

export function formatEvanRouteSummary(stops: MovePlanStop[], needsClarification: boolean): string {
    if (!stops.length) return needsClarification ? 'Confirm your pickup and destination' : 'Where are you moving from and to?';
    const origin = stops.find(stop => stop.kind === 'Origin');
    const destination = stops.find(stop => stop.kind === 'Destination');
    if (needsClarification && origin && !destination) return `${origin.city} \u2192 Destination to confirm`;
    if (needsClarification && destination && !origin) return `Pickup to confirm \u2192 ${destination.city}`;
    return stops.map(stop => stop.city).join(' \u2192 ');
}

const compact = (value: string, length = 150) => {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length > length ? `${clean.slice(0, length - 3).trim()}...` : clean;
};

const unique = (values: string[], limit = 8) => [...new Set(values.filter(Boolean))].slice(0, limit);

const sentences = (text: string) => text.split(/(?<=[.!?;])\s+|\s+(?:but|however)\s+|(?:,\s*|\s+and\s+)(?=(?:(?:we|i)\s+)?(?:maybe|possibly|perhaps|might|may)\b)|(?<=\bflexible)\s+(?=(?:(?:uh|um)\s+)?(?:i|we|there)\s+(?:might|may|could)\b)/i).filter(Boolean);
const isUncommittedQuestion = (text: string) => /^(?:what if|suppose|hypothetically|do you|does mullins|can (?:you|we)|could (?:you|we)|would (?:you|we)|is there|are there|what about)\b/i.test(text.trim())
    && !/\b(?:add|remove|delete|replace|change|update|correct|reorder|put|make|switch|skip|move .+ (?:before|after))\b/i.test(text);
const isHypothetical = (text: string) => {
    // "I may need help moving from A to B" describes a real planning inquiry,
    // even though the visitor has not booked or settled every detail.
    const tentativeHelpInquiry = /\b(?:i|we)\s+may\s+need\s+help\s+(?:with\s+)?mov(?:ing|e)\s+from\b/i.test(text);
    return /^(?:what if|suppose|hypothetically)\b/i.test(text.trim()) || isUncommittedQuestion(text)
    || /\b(?:might|maybe|possibly|considering)\b/i.test(text)
    || !tentativeHelpInquiry && /\bmay\s+(?:be|need|want|have|include|require)\b/i.test(text)
    || /\b(?:possible|potential|tentative|unconfirmed)\s+(?:(?:extra|additional|storage|donation)\s+)*(?:stop|pickup|drop[- ]?off)\b/i.test(text)
    || !tentativeHelpInquiry && /\b(?:we|i) (?:may|could|would) (?:move|relocate|need|want)\b/i.test(text);
};

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
                    if (kind === 'property' && /\b(?:bedroom|bed)\b/i.test(value) && !/\b(?:bedroom|bed)\b/i.test(match.value)
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

/** ASR can punctuate a single directional answer as "Mesa, AZ. To Tempe".
 * Join only an isolated city/state prefix followed immediately by "to";
 * preserve the original source span for capture evidence. Unrelated prose,
 * hypothetical/third-party prefixes and quoted examples are not joined. */
export function joinEvanRouteAnswerClauses(text: string, clauses: string[]): string[] {
    const result: string[] = [];
    let offset = 0;
    for (let index = 0; index < clauses.length; index++) {
        const clause = clauses[index];
        const start = text.indexOf(clause, offset);
        offset = start + clause.length;
        const mentions = cityMentions(clause);
        const next = clauses[index + 1];
        if (mentions.length === 1 && next && /^(?:and\s+)?to\s+/i.test(next)) {
            const mention = mentions[0];
            const prefix = stripEvanCaptureLeadIn(clause.slice(0, mention.index));
            const suffix = clause.slice(mention.end);
            const originPrefix = /^(?:from|(?:(?:I(?:['’]m| am)|we(?:['’]re| are))\s+)?moving\s+from)?$/i.test(prefix);
            if (originPrefix && /^(?:,?\s*(?:Arizona|AZ))?[.;]$/i.test(suffix)) {
                const end = text.indexOf(next, offset) + next.length;
                result.push(text.slice(start, end));
                offset = end;
                index++;
                continue;
            }
        }
        result.push(clause);
    }
    return result;
}

function locationQuestionRole(question: string): MovePlanStop['kind'] | null {
    // A pickup readback before a destination question must not make the
    // question appear to ask about both endpoints.
    question = question.match(/[^.!?]*\?/g)?.at(-1) ?? question;
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

function asksForBothRouteEndpoints(question: string): boolean {
    const finalQuestion = question.match(/[^.!?]*\?/g)?.at(-1) ?? question;
    return /\b(?:where|which|what|confirm|repeat|say|spell)\b/i.test(finalQuestion)
        && /\b(?:from|origin|pickup)\b/i.test(finalQuestion)
        && /\b(?:to|destination|delivery|headed)\b/i.test(finalQuestion);
}

function unrecognizedPairedRouteAnswer(sentence: string, previousAgentTurn: string, mentions: CityMention[]): boolean {
    if (mentions.length || isHypothetical(sentence)
        || !/\b(?:move|moving|route|pickup|destination|delivery)\b/i.test(previousAgentTurn)) return false;
    // This is only a signal to ask for both names, never evidence for a pin.
    return /\bfrom\s+[A-Z][a-z'-]*(?:\s+[A-Z][a-z'-]*){0,2}\s+to\s+[A-Z][a-z'-]*(?:\s+[A-Z][a-z'-]*){0,2}\b/.test(sentence);
}

function partialPairedRouteAnswer(sentence: string, previousAgentTurn: string, mentions: CityMention[], routeAttempted = false): CityMention | null {
    if (mentions.length !== 1 || isHypothetical(sentence)) return null;
    const mention = mentions[0];
    const before = sentence.slice(0, mention.index).trim().replace(/\u2019/g, "'");
    const after = sentence.slice(mention.end).trim();
    const explicitMovingRoute = /\b(?:we(?:'re| are)|i(?:'m| am))\s+moving\s+from$/i.test(before);
    if (!asksForBothRouteEndpoints(previousAgentTurn) && !routeAttempted && !explicitMovingRoute) return null;
    const routeIntro = /^(?:(?:right|yeah|yes|well|okay|ok)[,\s]+)*(?:it(?:'s| is)|(?:we(?:'re| are)|i(?:'m| am)) moving(?: from)?|from)?$/i;
    const unknownDestination = /^(?:,\s*(?:Arizona|AZ))?\s+to\s+[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3}(?:,\s*(?:Arizona|AZ))?[.!?]?$/i;
    // A caller may greet Evan before explicitly saying "I'm moving from".
    // The explicit route clause is sufficient even when that greeting means
    // the short-answer prefix no longer matches from the start of the turn.
    return (explicitMovingRoute || routeIntro.test(before)) && unknownDestination.test(after) ? mention : null;
}

function correctedUnresolvedDestination(sentence: string, mention: CityMention, stops: MovePlanStop[], routeAttempted: boolean): boolean {
    const origin = stops.find(stop => stop.kind === 'Origin');
    if (!routeAttempted || !origin || stops.some(stop => stop.kind === 'Destination')
        || sameCity(origin.city, mention.city)) return false;
    const before = sentence.slice(0, mention.index).trim().replace(/\u2019/g, "'");
    const after = sentence.slice(mention.end).trim();
    // Only a clear correction can fill the missing endpoint. An unrelated city
    // mention must not become a destination merely because the route is partial.
    return /^(?:(?:sorry|no|actually|wait|correction)[,\s]+)*(?:i mean|it(?:'s| is)|the (?:city|destination) is)\s*$/i.test(before)
        && /^(?:,?\s*(?:Arizona|AZ))?[.!?]?$/i.test(after);
}

/** Apply one user correction without discarding precise pins on unchanged stops. */
export function applyEvanRouteTurn(stops: MovePlanStop[], userTurn: string, previousAgentTurn = '', earlierUserSentences = '', routeAttempted = false): MovePlanStop[] {
    let next = stops.slice();
    let sameTurnHistory = earlierUserSentences;
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

    for (const sentence of joinEvanRouteAnswerClauses(userTurn, sentences(userTurn))) {
        if (isHypothetical(sentence)) {
            sameTurnHistory += ` ${sentence}`;
            continue;
        }
        if (/^\s*(?:please\s+)?(?:clear|reset|start over with)\s+(?:the\s+)?(?:entire\s+|whole\s+)?(?:route|map|all (?:stops|locations))\b/i.test(sentence)) {
            next = [];
            sameTurnHistory += ` ${sentence}`;
            continue;
        }
        const mentions = cityMentions(sentence);
        const handled = new Set<number>();

        // Keep the one city actually recognized in a from/to answer. The
        // unfamiliar endpoint is not inferred from Evan's later readback.
        const partialAnswer = partialPairedRouteAnswer(sentence, previousAgentTurn, mentions, routeAttempted);
        if (partialAnswer) {
            setStop(partialAnswer.city, 'Origin');
            handled.add(0);
        }

        // A concise answer to "from and to?" has the same meaning as a full
        // moving sentence. Bare city lists elsewhere do not establish a route.
        if (mentions.length === 2) {
            const prefix = stripEvanCaptureLeadIn(sentence.slice(0, mentions[0].index));
            const connector = sentence.slice(mentions[0].end, mentions[1].index).trim()
                .replace(/[.;]\s*(?:and\s+)?(?=to\b)/i, ' ').trim();
            const suffix = sentence.slice(mentions[1].end).replace(/[.!]/g, '').trim();
            const pairedQuestion = asksForBothRouteEndpoints(previousAgentTurn);
            // Accept ordinary first-person/request lead-ins, including an
            // interrupted conversational answer. Still require a directional
            // connector and bounded suffix; unrelated prose is not a route.
            const routeLeadIn = /^(?:from|(?:(?:I(?:['’]m| am)|we(?:['’]re| are))\s+)?(?:moving|looking for(?:\s+(?:a|my|our)\s+move)?|planning\s+(?:a|my|our)\s+move)(?:\s+from)?|(?:I|we)\s+(?:need|want|would like)\s+(?:to move|(?:a|my|our)\s+move)(?:\s+from)?|(?:the|my|our)\s+move\s+is(?:\s+from)?)?$/i.test(prefix);
            const explicitPair = routeLeadIn && /^(?:,?\s*(?:Arizona|AZ)\s+)?(?:to|->|\u2192)$/i.test(connector);
            const contextualPair = pairedQuestion && !prefix && /^(?:,?\s*(?:Arizona|AZ)\s+)?(?:and|to)$/i.test(connector);
            // A state/date qualifier does not erase the origin in a short
            // paired answer. Permit only bounded geographic/calendar tails,
            // never arbitrary prose after two unrelated city mentions.
            const routeSuffix = suffix.replace(/^,?\s*(?:Arizona|AZ)\b\s*,?\s*/i, '')
                .replace(/^,\s*/, '').trim();
            const calendarSuffix = /^(?:(?:in|on|around|during|for)\s+)?(?:the\s+)?(?:(?:early|mid[- ]?|late|(?:first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\s+week\s+(?:of|in))\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{1,2}(?:st|nd|rd|th)?)?$/i.test(routeSuffix);
            const movingQuestion = /\b(?:move|moving|relocation|route|pickup|destination)\b/i.test(previousAgentTurn);
            // Recognized speech can join a bare city pair with "de". In a
            // moving answer only, use the two visitor-supplied cities in order
            // as approximate city pins. This never supplies street addresses
            // or imports a city from the agent's subsequent readback.
            const recognizedPair = movingQuestion && /^(?:from)?$/i.test(prefix)
                && /^(?:,?\s*(?:Arizona|AZ)\s+)?de$/i.test(connector);
            const statedDestinationThisTurn = next.some(stop => stop.kind === 'Destination'
                && sameCity(stop.city, mentions[1].city))
                && cityMentions(sameTurnHistory).some(mention => sameCity(mention.city, mentions[1].city)
                    && cityRole(sameTurnHistory.slice(0, mention.index), sameTurnHistory.slice(mention.end)) === 'Destination'
                    && !isNegativeMention(sameTurnHistory, mention.index, mention.end - mention.index));
            // ASR may drop "it" from "it's" and punctuation around the state:
            // "is gilbert arizona to chandler arizona" still names two route
            // endpoints when Evan has just asked a moving question.
            const conversationalPair = (movingQuestion || statedDestinationThisTurn)
                && /^(?:(?:right|yeah|yes|well|okay|ok)[, ]+)*(?:it(?:'s| is)|is|(?:we(?:'re| are)|i(?:'m| am)) moving)$/i.test(prefix)
                && /^(?:,?\s*(?:in\s+)?(?:Arizona|AZ)\s+)?to$/i.test(connector)
                && /^(?:,?\s*(?:Arizona|AZ))?$/i.test(suffix);
            if (((!routeSuffix || calendarSuffix) && (explicitPair || contextualPair || recognizedPair)) || conversationalPair) {
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
            if (mentions.length === 2 && next.length === 0
                && !/\b(?:move|moving|relocat(?:e|ion)|route|pickup|pick up|deliver|destination|origin|from)\b/i.test(sentence)
                && !/\b(?:move|moving|relocation|route|pickup|destination)\b/i.test(previousAgentTurn)) continue;
            const before = sentence.slice(0, mention.index);
            const after = sentence.slice(mention.end);
            const localBefore = before.slice(Math.max(before.lastIndexOf(',') + 1, before.lastIndexOf(';') + 1, mentions[index - 1]?.end ?? 0));
            const answer = sentence.trim().replace(/[.!]/g, '')
                .replace(/^(?:(?:no|actually|sorry|correction)[,:]?\s+)*(?:it is\s+|it's\s+)?/i, '')
                .replace(/\s+instead$/i, '');
            const cityAnswer = answer.replace(/,?\s+(?:also\s+)?(?:in\s+)?(?:Arizona|AZ)$/i, '').trim();
            const isCityOnlyAnswer = mentions.length === 1 && cityAnswer.toLowerCase() === mention.city.toLowerCase();
            const kind = cityRole(localBefore, after)
                ?? (mentions.length === 1 && correctedUnresolvedDestination(sentence, mention, next, routeAttempted)
                    ? 'Destination' : null)
                ?? (isCityOnlyAnswer ? locationQuestionRole(previousAgentTurn) : null);
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
        sameTurnHistory += ` ${sentence}`;
    }
    return next.length === stops.length && next.every((stop, index) => stop === stops[index]) ? stops : next;
}

function isExplicitRouteConfirmation(text: string): boolean {
    return /^(?:yes[,\s]+)?(?:that(?:'s| is)\s+(?:right|correct)|correct|you(?:'ve| have) got (?:it|that) right)[.!\s]*$/i.test(text.trim().replace(/’/g, "'"));
}

function confirmedCityReadback(stops: MovePlanStop[], lastUser: string, agent: string, user: string, grounded: Set<string>): MovePlanStop[] {
    if (!isExplicitRouteConfirmation(user) || !/\bto\b/i.test(lastUser) || isHypothetical(lastUser)) return stops;
    const userMentions = cityMentions(lastUser);
    if (userMentions.length !== 1) return stops;
    const userAnchor = userMentions[0];
    const userPrefix = lastUser.slice(0, userAnchor.index).trim().replace(/’/g, "'");
    const userSuffix = lastUser.slice(userAnchor.end).trim();
    const knownOriginAttempt = /^(?:(?:right|yes|yeah|correct|actually|sorry|no)[,.—-]?\s*)*(?:(?:i(?:'m| am)|we(?:'re| are))\s+moving\s+|moving\s+)?(?:from\s*)?$/i.test(userPrefix)
        && /^(?:,\s*(?:Arizona|AZ)\s*)?\s*[Tt]o\s+[A-Z][A-Za-z-]*(?:\s+[A-Z][A-Za-z-]*){0,2}[.!]?$/.test(userSuffix);
    if (!knownOriginAttempt) return stops;
    const normalizedAgent = agent.replace(/’/g, "'");
    const readback = cityMentions(normalizedAgent);
    if (readback.length !== 2 || !readback.every(({ city }) => grounded.has(city))) return stops;
    const before = normalizedAgent.slice(0, readback[0].index).trim();
    const between = normalizedAgent.slice(readback[0].end, readback[1].index).trim();
    const after = normalizedAgent.slice(readback[1].end).trim().replace(/^,\s*(?:Arizona|AZ)\b[,\s]*/i, '');
    if (!/^(?:(?:so|okay|ok|got it|just to confirm|to confirm|let me confirm|i have|i've got|you(?:'re| are) moving|the route is|your move is|moving)[,:.—-]?\s*)*(?:from\s*)?$/i.test(before)
        || !/^(?:,\s*(?:Arizona|AZ)\s+)?(?:to|->|\u2192)$/i.test(between)
        || !/^[,.;—-]?\s*(?:(?:is that|does that sound)\s+(?:right|correct)|right|correct)\s*\?$/i.test(after)) return stops;
    const origin = stops.find(stop => stop.kind === 'Origin');
    const destination = stops.find(stop => stop.kind === 'Destination');
    // Only fill the unresolved side of the visitor's immediately preceding
    // route attempt, retaining the known anchor. No fuzzy city normalization.
    if (!destination && (!origin || sameCity(origin.city, userAnchor.city)) && sameCity(userAnchor.city, readback[0].city)) {
        return applyEvanRouteTurn(stops, `From ${readback[0].city} to ${readback[1].city}.`);
    }
    return stops;
}

function possibleStopStatement(text: string): boolean {
    if (/^(?:what if|suppose|hypothetically|do you|does mullins|would you|is there|are there)\b/i.test(text.trim())) return false;
    if (/\?\s*$/.test(text) && !/^(?:can|could) you (?:please )?(?:note|list|keep|mark)\b/i.test(text.trim())) return false;
    return /\b(?:might|may|maybe|possibly|possible|possibility|potential|tentative|unconfirmed|considering|not confirmed)\b/i.test(text)
        && /\b(?:stop|storage|pickup|drop[- ]?off|donation)\b/i.test(text);
}

function routeStops(turns: EvanMovePlannerTurn[]): { stops: MovePlanStop[]; possibleStops: MovePlanStop[]; incompleteSpokenRoute: boolean } {
    let stops: MovePlanStop[] = [];
    let possibleStops: MovePlanStop[] = [];
    let incompleteSpokenRoute = false;
    let previousAgentTurn = '';
    let previousUserTurn = '';
    const groundedCities = new Set<string>();
    for (const turn of turns) {
        if (turn.role === 'agent') previousAgentTurn = turn.content;
        else {
            const content = compact(turn.content, 1_000);
            stops = confirmedCityReadback(stops, previousUserTurn, previousAgentTurn, content, groundedCities);
            let earlierUserSentences = '';
            for (const sentence of joinEvanRouteAnswerClauses(content, sentences(content))) {
                const mentions = cityMentions(sentence);
                if (/\b(?:clear|reset|start over)\b.*\b(?:route|map|all (?:stops|locations))\b/i.test(sentence)) {
                    possibleStops = [];
                    incompleteSpokenRoute = false;
                }
                if (unrecognizedPairedRouteAnswer(sentence, previousAgentTurn, mentions)
                    || partialPairedRouteAnswer(sentence, previousAgentTurn, mentions, incompleteSpokenRoute)) incompleteSpokenRoute = true;
                const cancellation = /\b(?:remove|delete|skip|cancel|drop|no longer need|don't need|do not need)\b/i.test(sentence)
                    || /^\s*no\b.+\bstop\b/i.test(sentence);
                if (cancellation) {
                    if (mentions.length) possibleStops = possibleStops.filter(stop => !mentions.some(mention => sameCity(stop.city, mention.city)));
                    else {
                        const purpose = stopPurpose(sentence);
                        const matching = possibleStops.filter(stop => purpose && stop.label?.toLowerCase() === purpose.toLowerCase());
                        if (/\b(?:all|any)\b.*\bstops?\b/i.test(sentence)) possibleStops = purpose ? possibleStops.filter(stop => !matching.includes(stop)) : [];
                        else if (matching.length === 1) possibleStops = possibleStops.filter(stop => stop !== matching[0]);
                        else if (/\b(?:that|the)\b.*\b(?:stops?|storage)\b/i.test(sentence) && possibleStops.length === 1) possibleStops = [];
                    }
                }
                const between = mentions.length === 2 ? sentence.slice(mentions[0].end, mentions[1].index) : '';
                const backwardReplacement = mentions.length === 2 && /\b(?:instead of|rather than|not)\s*$/i.test(between);
                const replacement = mentions.length === 2 && (backwardReplacement
                    || /\b(?:change|replace|switch|swap)\b/i.test(sentence) && /\b(?:with|to|for)\b/i.test(between));
                let replacedPossible = false;
                if (replacement) {
                    const old = possibleStops.find(stop => sameCity(stop.city, mentions[backwardReplacement ? 1 : 0].city));
                    const newCity = mentions[backwardReplacement ? 0 : 1].city;
                    if (old) {
                        possibleStops = possibleStops.filter(stop => stop === old || !sameCity(stop.city, newCity))
                            .map(stop => stop === old ? { ...stop, city: newCity } : stop);
                        replacedPossible = true;
                    }
                }
                const tentative = possibleStopStatement(sentence) && mentions.length <= 1;
                if (tentative && !cancellation && mentions.length <= 1) {
                    for (const mention of mentions) {
                        if (isNegativeMention(sentence, mention.index, mention.end - mention.index)) continue;
                        if (!possibleStops.some(stop => sameCity(stop.city, mention.city))) {
                            possibleStops.push({ city: mention.city, kind: 'Additional stop', confirmed: false,
                                ...(stopPurpose(sentence) ? { label: stopPurpose(sentence) } : {}) });
                        }
                    }
                }
                const definiteStop = !tentative && !isHypothetical(sentence) && !cancellation
                    && /\b(?:add|include|confirm|definitely|go ahead|will need|do need)\b/i.test(sentence)
                    && /\b(?:stop|storage|pickup|drop[- ]?off|donation)\b/i.test(sentence);
                if (definiteStop) {
                    const selected = mentions.length
                        ? possibleStops.filter(stop => mentions.some(mention => sameCity(stop.city, mention.city)))
                        : possibleStops.length === 1 && /\b(?:that|the)\b/i.test(sentence) ? possibleStops : [];
                    for (const stop of selected) stops = applyEvanRouteTurn(stops, `Add an additional stop in ${stop.city}.`);
                    possibleStops = possibleStops.filter(stop => !selected.includes(stop));
                }
                // A possible-location correction stays possible. It must not
                // leak into live pins or directions via the ordinary parser.
                if (!tentative && !replacedPossible) {
                    stops = applyEvanRouteTurn(stops, sentence, previousAgentTurn, earlierUserSentences, incompleteSpokenRoute);
                }
                if (!isUncommittedQuestion(sentence) && !/^\s*(?:what if|suppose|hypothetically)\b/i.test(sentence)
                    && (/\b(?:mov(?:e|ing)|from|to|origin|destination|bedrooms?|house|home|apartment|storage|stop)\b/i.test(sentence)
                        || mentions.length === 1 && locationQuestionRole(previousAgentTurn))) {
                    for (const mention of mentions) if (!isNegativeMention(sentence, mention.index, mention.end - mention.index)) groundedCities.add(mention.city);
                }
                earlierUserSentences += ` ${sentence}`;
            }
            possibleStops = possibleStops.filter(stop => !stops.some(actual => actual.kind === 'Additional stop' && sameCity(actual.city, stop.city)));
            previousUserTurn = content;
            previousAgentTurn = '';
        }
    }
    return { stops: stops.map(({ city, kind }) => ({ city, kind })), possibleStops: possibleStops.slice(0, 8), incompleteSpokenRoute };
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

const INVENTORY_RULES: Array<[RegExp, string]> = [
    [/\bqueen(?:[- ]size)? bed\b/i, 'Queen bed'],
    [/\bsofa\b|\bcouch\b/i, 'Sofa'],
    [/\blove[ -]?seats?\b/i, 'Loveseat'],
    [/\bdesks?\b/i, 'Desk'],
    [/\b(?:small\s+)?dining table\b/i, 'Dining table'],
];

function floorAccessFrom(turns: EvanMovePlannerTurn[], stops: MovePlanStop[]): string[] {
    const floorByLocation: Partial<Record<'Origin' | 'Destination', string>> = {};
    const noElevator = new Set<'Origin' | 'Destination'>();
    const stairsByLocation = new Set<'Origin' | 'Destination'>();
    let floorWithoutLocation = '';
    let noElevatorWithoutLocation = false;
    const cityPlaces = stops.filter(stop => stop.kind === 'Origin' || stop.kind === 'Destination')
        .map(stop => stop.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
    const cityCue = cityPlaces.length ? `|(?:${cityPlaces.join('|')})\\s+(?:place|home|house|townhouse|apartment)` : '';
    // The access fact may precede its endpoint: "stairs at pickup, ground floor
    // delivery" describes two locations even though "delivery" is not the
    // first word after the comma. Keep each endpoint in its own clause.
    const nextLocationClause = new RegExp(`(?:,\\s*|\\s+and\\s+)(?=[^,;.!?]{0,70}\\b(?:origin|destination|delivery|drop[- ]?off|pick[ -]?up${cityCue})\\b)`, 'i');
    let previousAgentTurn = '';
    for (const item of turns) {
        if (item.role === 'agent') {
            previousAgentTurn = compact(item.content, 1_000);
            continue;
        }
        const turn = compact(item.content, 1_000);
        const asksAboutAccess = /\b(?:stairs?|staircase|elevator|floor|access)\b/i.test(previousAgentTurn);
        const asksAboutOrigin = /\b(?:origin|pick[ -]?up)\b/i.test(previousAgentTurn);
        const asksAboutDestination = /\b(?:destination|delivery|drop[- ]?off)\b/i.test(previousAgentTurn);
        const answerNamesEndpoint = /\b(?:origin|pick[ -]?up|destination|delivery|drop[- ]?off)\b/i.test(turn);
        const questionLocation: 'Origin' | 'Destination' | null = asksAboutAccess && !answerNamesEndpoint
            && asksAboutOrigin !== asksAboutDestination
            ? (asksAboutOrigin ? 'Origin' : 'Destination') : null;
        previousAgentTurn = '';
        let lastLocation: 'Origin' | 'Destination' | null = null;
        for (const sentence of sentences(turn)) {
            if (isHypothetical(sentence)) continue;
            // ASR can omit the pause between two access facts: "stairs at pick
            // up ground floor delivery". Restore only that explicit endpoint
            // boundary; a floor without a delivery cue must not change sides.
            const accessSentence = sentence.replace(
                /\b(stairs?|staircase)\s*,\s*(?:a|at|the)\s+(pick[ -]?up|origin)\b/gi,
                '$1 at $2',
            ).replace(
                /\b(pick[ -]?up|origin)\s+((?:(?:ground|first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+floor|floor\s+(?:ground|first|second|third|fourth|fifth|\d+))\s+(?:delivery|destination|drop[- ]?off))\b/gi,
                '$1, $2',
            );
            for (const clause of accessSentence.split(nextLocationClause)) {
                const explicitLocation: 'Origin' | 'Destination' | null = /\b(?:origin|pick[ -]?up)\b/i.test(clause) ? 'Origin'
                    : /\b(?:destination|drop[- ]?off|delivery)\b/i.test(clause) ? 'Destination' : null;
                const cityRoles = stops.filter(stop => (stop.kind === 'Origin' || stop.kind === 'Destination')
                    && new RegExp(`\\b${stop.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i').test(clause))
                    .map(stop => stop.kind);
                const cityLocation: 'Origin' | 'Destination' | null = cityRoles.length === 1
                    && (cityRoles[0] === 'Origin' || cityRoles[0] === 'Destination') ? cityRoles[0] : null;
                const location: 'Origin' | 'Destination' | null = explicitLocation
                    ?? (cityRoles.length ? cityLocation : lastLocation ?? questionLocation);
                const floor = [...clause.matchAll(/\b(?:(?:ground|first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+floor|floor\s+(?:ground|first|second|third|fourth|fifth|\d+))\b/gi)]
                    .find(match => !isNegativeMention(clause, match.index ?? 0, match[0].length));
                const normalizedFloor = floor ? floor[0].toLowerCase().replace(/^floor\s+/, '').replace(/\s+floor$/, '') + ' floor' : '';
                const saysNoElevator = /\bno elevator\b|\bwithout (?:an? )?elevator\b|\bstairs? only\b|\bonly stairs?\b/i.test(clause);
                const saysElevator = /\b(?:has|with|there is) (?:an? )?elevator\b/i.test(clause);
                const stairs = /\bstairs?\b|\bstaircase\b/i.exec(clause);
                const saysStairs = Boolean(stairs && !isNegativeMention(clause, stairs.index, stairs[0].length));
                const saysNoStairs = /\b(?:no|without) stairs?\b/i.test(clause);
                if (!location) {
                    if (normalizedFloor) floorWithoutLocation = normalizedFloor;
                    if (saysNoElevator) noElevatorWithoutLocation = true;
                    if (saysElevator) noElevatorWithoutLocation = false;
                    if (saysNoStairs) stairsByLocation.clear();
                    continue;
                }
                if (normalizedFloor) {
                    floorByLocation[location] = normalizedFloor;
                    if (floorWithoutLocation === normalizedFloor || /\b(?:actually|correction|instead|sorry)\b/i.test(clause)) floorWithoutLocation = '';
                }
                if (saysNoElevator) {
                    noElevator.add(location);
                    noElevatorWithoutLocation = false;
                }
                if (saysElevator) noElevator.delete(location);
                if (saysNoStairs) stairsByLocation.delete(location);
                else if (saysStairs && !saysNoElevator) stairsByLocation.add(location);
                lastLocation = location;
            }
        }
    }
    const located = (['Origin', 'Destination'] as const).flatMap(location => {
        const floor = floorByLocation[location];
        return floor || noElevator.has(location) || stairsByLocation.has(location)
            ? [`${location}: ${[floor, noElevator.has(location) ? 'no elevator' : '', stairsByLocation.has(location) ? 'stairs' : ''].filter(Boolean).join(', ')}`]
            : [];
    });
    return floorWithoutLocation || noElevatorWithoutLocation
        ? [...located, `Location to confirm: ${[floorWithoutLocation, noElevatorWithoutLocation ? 'no elevator' : ''].filter(Boolean).join(', ')}`]
        : located;
}

const BOX_COUNT_NUMBER = String.raw`(?:\d{1,3}|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)`;
const BOX_COUNT_RANGE = `${BOX_COUNT_NUMBER}(?:\\s*(?:[-–—]|to)\\s*${BOX_COUNT_NUMBER})?`;
const BOX_COUNT_PATTERN = new RegExp(`\\b(?:(?:about|around|roughly|approximately)\\s+)?${BOX_COUNT_RANGE}\\s+boxes\\b`, 'gi');
const APPROXIMATE_BOX_MAYBE_PATTERN = new RegExp(`\\bmaybe\\s+(?=(?:(?:about|around|roughly|approximately)\\s+)?${BOX_COUNT_RANGE}\\s+boxes\\b)`, 'gi');

function inventoryFrom(userTurns: string[]): string[] {
    // "Maybe around 20 boxes" is an approximate count, not a hypothetical
    // move. Keep the rest of that utterance (including named furniture) while
    // leaving genuinely tentative items such as "maybe a piano" uncommitted.
    const inventoryTurns = userTurns.map(turn => turn.replace(
        /\bmaybe\s+(?=(?:about|around|roughly|approximately)\b)/gi, '',
    ).replace(APPROXIMATE_BOX_MAYBE_PATTERN, ''));
    const items = labelsFrom(inventoryTurns, INVENTORY_RULES);
    for (const turn of inventoryTurns) {
        if (isHypothetical(turn)) continue;
        // Voice transcripts may spell a quantity that the spoken recap renders
        // as digits. Keep either form in the working move list.
        const boxes = [...turn.matchAll(BOX_COUNT_PATTERN)].at(-1)?.[0];
        if (boxes) {
            const existing = items.findIndex(item => /\bboxes\b/i.test(item));
            if (existing >= 0) items.splice(existing, 1);
            items.push(boxes.trim().replace(/^./, first => first.toUpperCase()));
        }
    }
    return unique(items, 12);
}

const CARE_RULES: Array<[RegExp, string]> = [
    [/\bwalker\b|\bwheelchair\b|\bmobility\b/i, 'Mobility considerations'],
    [/\belderly\b|\bsenior\b/i, 'Senior comfort'],
    [/\bstress(?:ed|ful)?\b|\bchaotic\b/i, 'Minimize disruption'],
    [/\bfinish time\b|\btime sensitive\b|\burgent\b|\bless than \d+ days?\b/i, 'Time-sensitive move'],
    [/\bmultiple destinations?\b|\bseveral stops?\b/i, 'Multi-stop coordination'],
];

function isVisitorPacking(text: string): boolean {
    return /\b(?:i|we)(?:'ll|'m|'re|\s+will|\s+can|\s+am|\s+are|\s+plan\s+to|\s+intend\s+to)?\s+(?:handle|handling|do|doing|manage|managing|tak(?:e|ing)\s+care\s+of)\s+(?:(?:all|most|some|the|our|my|of)\s+)*packing\b/i.test(text)
        || /\b(?:i|we)(?:'ll|'m|'re|\s+will|\s+can|\s+am|\s+are)\s+(?:pack|packing)\b/i.test(text)
        || /\b(?:packing|pack)\b.{0,45}\b(?:myself|ourselves|on\s+(?:my|our)\s+own)\b/i.test(text);
}

function rejectsVisitorPacking(text: string): boolean {
    return /\b(?:i|we)(?:'m|'re|\s+am|\s+are|\s+will)?\s+(?:cannot|can't|won't|don't|do not|will not|no longer)\b.{0,30}\bpack(?:ing)?\b/i.test(text);
}

function packingPlanFrom(userTurns: string[], services: string[]): string {
    let selfPacking = false;
    let declinedPacking = false;
    let possiblePacking = '';
    for (const turn of userTurns) {
        // A caller can ask about help for a few fragile items while planning
        // to pack the rest. Keep the inquiry visible without making it a
        // confirmed service request.
        const exploratoryPacking = /\b(?:could|can|would)\s+(?:someone|you|mullins|your (?:team|crew)|the (?:team|crew))\s+help\b[^?]*\bpack(?:ing)?\b[^?]*\?/i.test(turn)
            || /\bpack(?:ing)?\b[^?]*\b(?:but|except)\s+(?:could|can|would)\s+(?:someone|you|mullins|your (?:team|crew)|the (?:team|crew))\s+help\b[^?]*\?/i.test(turn);
        for (const sentence of sentences(turn)) {
            if (/^(?:(?:maybe|perhaps|possibly)[,\s]+)?(?:i|we)\s+(?:might|may|could)\s+(?:need|want|use)\b/i.test(sentence.trim())
                && /\bpack(?:ing)?\b/i.test(sentence) && /\b(?:help|support|assistance)\b/i.test(sentence)
                && !/\b(?:no|not|without|don't|do not)\b/i.test(sentence)
                && !/\?\s*$/.test(sentence)) {
                possiblePacking = compact(sentence, 115);
                continue;
            }
            if (isHypothetical(sentence)) continue;
            for (const clause of sentence.split(/\s+and\s+/i)) {
                if (/\?\s*$/.test(clause) || /\b(?:i|we)\s+(?:may|could)\s+(?:do|handle|manage|pack)/i.test(clause)) continue;
                const selfPackingRemainder = Boolean(possiblePacking)
                    && /\b(?:rest|most|otherwise)\b/i.test(clause)
                    && /\b(?:myself|ourselves)\b/i.test(clause)
                    && /\b(?:pack|packing|manage|handle)\b/i.test(clause);
                if (/\bpack(?:ing)?\b/i.test(clause) && !selfPackingRemainder) possiblePacking = '';
                if (/\b(?:no|without|skip|cancel|remove|(?:do not|don't) (?:need|want)|no longer need)\s+(?:any\s+|the\s+)?packing(?:\s+(?:help|support|assistance|services?))?\b|\bpacking(?:\s+(?:help|support|assistance|services?))?\s+(?:is\s+)?(?:not needed|no longer needed)\b/i.test(clause)) declinedPacking = true;
                if (rejectsVisitorPacking(clause)) selfPacking = false;
                else if (selfPackingRemainder) selfPacking = true;
                else if (isVisitorPacking(clause) && !/\b(?:not|don't|do not|can't|cannot)\b/i.test(clause)) selfPacking = true;
                else if (/\b(?:need|want|request|add|include)\b.*\bfull(?:[- ]service)? packing\b/i.test(clause)) selfPacking = false;
            }
        }
        if (exploratoryPacking && !declinedPacking) {
            const question = turn.match(/\b(?:could|can|would)\s+(?:someone|you|mullins|your (?:team|crew)|the (?:team|crew))\s+help\b[^?]*\?/i)?.[0];
            possiblePacking = compact(question ?? turn, 115);
        }
    }
    if (possiblePacking) return `${selfPacking ? 'Packing some items yourself; ' : ''}Possible packing help: ${possiblePacking}`;
    const assistance = services.includes('Full packing') || services.includes('Packing support');
    return selfPacking ? assistance ? 'Packing some items yourself; assistance requested' : 'Packing yourself'
        : assistance ? 'Packing assistance requested' : declinedPacking ? 'No packing help requested' : '';
}

function labelsFrom(userTurns: string[], rules: Array<[RegExp, string]>, limit = 8) {
    const active = new Set<string>();
    for (const turn of userTurns) {
        for (const sentence of sentences(turn)) {
            if (isHypothetical(sentence)) continue;
            const matches = rules.flatMap(([pattern, label]) => [...sentence.matchAll(new RegExp(pattern.source, 'gi'))]
                .map((match) => ({ label, value: match[0], index: match.index ?? 0 })))
                .sort((left, right) => left.index - right.index);
            for (const match of matches) {
                const localStart = sentence.slice(0, match.index).toLowerCase().lastIndexOf(' and ') + 5;
                const localClause = sentence.slice(localStart > 4 ? localStart : 0).split(/\s+and\s+/i)[0];
                if (['Storage stop', 'Donation items'].includes(match.label)
                    && /\b(?:if needed|if necessary|if required|only if)\b/i.test(localClause)) {
                    // "Storage first, if needed" is a possible stop, not a
                    // request for storage service. Other access facts still apply.
                    active.delete(match.label);
                    continue;
                }
                const visitorPacking = (match.label === 'Packing support' || match.label === 'Full packing') && isVisitorPacking(localClause);
                const packingLabel = match.label === 'Packing support' || match.label === 'Full packing';
                const declinedPackingHelp = packingLabel && /^\s+(?:help|support|assistance|services?)\s+(?:(?:is|are)\s+)?(?:not needed|no longer needed)\b/i.test(sentence.slice(match.index + match.value.length));
                if (packingLabel && (/\?\s*$/.test(localClause) && visitorPacking || /\b(?:i|we)\s+(?:may|could)\s+(?:do|handle|manage|pack)/i.test(localClause))) continue;
                if (isNegativeMention(sentence, match.index, match.value.length) || visitorPacking || declinedPackingHelp || packingLabel && rejectsVisitorPacking(localClause)) {
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
    const transcriptRoute = routeStops(turns);
    const stops = confirmedStops !== null ? confirmedStops.slice(0, 8) : transcriptRoute.stops;
    // Speech recognition can render a spoken route as unfamiliar names. Keep
    // the map unpinned until the caller confirms cities the parser can match.
    const describedRoute = userTurns.some(turn => /\b(?:mov(?:e|ing)|relocat(?:e|ing))\b[^.!?]{0,90}\bfrom\b[^.!?]{1,70}\bto\b/i.test(turn));
    const routeNeedsClarification = (describedRoute || transcriptRoute.incompleteSpokenRoute)
        && (!stops.some(stop => stop.kind === 'Origin') || !stops.some(stop => stop.kind === 'Destination'));
    const possibleStops = transcriptRoute.possibleStops.filter(stop => !stops.some(actual => actual.kind === 'Additional stop' && sameCity(actual.city, stop.city)));
    const services = labelsFrom(userTurns, LABEL_RULES);
    const inventoryItems = inventoryFrom(userTurns);
    if (services.includes('Full packing')) {
        const genericPacking = services.indexOf('Packing support');
        if (genericPacking >= 0) services.splice(genericPacking, 1);
    }
    const packingPlan = packingPlanFrom(userTurns, services);
    const specialtyItems = labelsFrom(userTurns, SPECIALTY_RULES);
    const floorAccess = floorAccessFrom(turns, stops);
    const accessFactors = unique([
        ...floorAccess,
        ...labelsFrom(userTurns, ACCESS_RULES).filter(label =>
            (label !== 'Elevator requirements' || floorAccess.length === 0)
            && (label !== 'Stairs' || !floorAccess.some(item => /^(?:Origin|Destination):.*\bstairs\b/i.test(item)))),
    ]);
    const carePriorities = labelsFrom(userTurns, CARE_RULES);
    const uncertainties = uncertaintySignals(userTurns);
    const baseTiming = latestMatch(userTurns, [
        /\b(?:move(?:\s+date)?\s+(?:on|is|for|around)?\s*|(?:by|on|for|around)\s+)(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\b/i,
        /^\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\s*$/i,
        /\b(?:early|mid[- ]?|late|beginning of|middle of|end of)\s+(?:the\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
        /\b(?:first|second|third|last) week (?:of|in) (?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
        /\b(?:first|last)\s+(?:one|two|three|\d+)\s+weeks?\s+(?:of|in)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
        /\bless than \d+ days?\b/i,
        /\bwithin (?:the next )?\d+ days?\b/i,
        /\b(?:target(?: date)?(?: is|:)?|targeting|scheduled for|needs? to be|has to be) (?:the )?\d{1,2}(?:st|nd|rd|th)?\b/i,
        /\bby (?:the )?\d{1,2}(?:st|nd|rd|th)?\b/i,
        /\bon (?:the )?\d{1,2}(?:st|nd|rd|th)?(?: of [A-Z][a-z]+)?\b/i,
        /\b(?:next|this) (?:week|month|weekend)\b/i,
        /\b(?:one|two|three|four|five|six|seven|eight|nine|ten) weeks?\b/i,
        /\bmid[- ]month\b/i,
        /\b(?:the\s+)?middle\s+of\s+(?:(?:this|next|the)\s+)?month\b/i,
    ], 'timing');
    let flexibleDate = false;
    let flexibility = 'date flexible';
    for (const turn of userTurns) {
        for (const sentence of sentences(turn)) {
            if (/\b(?:call|callback|email|phone)\b/i.test(sentence) || isHypothetical(sentence)) continue;
            if (/\b(?:date|dates|timing|move|schedule|day|days)\b[^.!?]{0,45}\bflexible\b|\bflexible\b[^.!?]{0,45}\b(?:week|month|date|dates|timing|day|days)\b|^(?:(?:i'm|i am|we're|we are|pretty|quite|still|very)\s+)*flexible[.!\s]*$/i.test(sentence.trim())) {
                flexibleDate = !/\b(?:not|isn't|aren't|no longer)\b/i.test(sentence);
                flexibility = /\bflexible within (?:that|the|same) week\b/i.test(sentence) ? 'flexible within that week' : 'date flexible';
            }
        }
    }
    const calendarDate = baseTiming.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\b/i)?.[0];
    const normalizedTiming = calendarDate ?? baseTiming;
    const timing = flexibleDate ? normalizedTiming ? `${normalizedTiming}; ${flexibility}` : 'Date flexible' : normalizedTiming;
    const propertyScope = latestMatch(userTurns, [
        /\b(?:one|two|three|four|five|six|\d+)[ -]beds?\s+town\s*house\b/i,
        /\b(?:one|two|three|four|five|six|\d+)[ -]bedrooms?(?:\s+(?:apartment|condo|home|house|townhouse|townhome))?\b/i,
        /\bstudio(?:\s+apartment)?\b/i,
        /\b(?:apartment|condo|townhouse|townhome|single[- ]family home|house|office|commercial space)\b/i,
    ], 'property').replace(/\b(one|two|three|four|five|six|\d+)[ -]beds?\s+town\s*house\b/i,
        '$1-bedroom townhouse');

    const highlights: MovePlanSignal[] = [
        stops.length ? { label: 'Route', value: formatEvanRouteSummary(stops, routeNeedsClarification) } : null,
        timing ? { label: 'Timing', value: timing } : null,
        propertyScope ? { label: 'Property / scope', value: propertyScope } : null,
        inventoryItems.length ? { label: 'Move items', value: inventoryItems.join(', ') } : null,
        packingPlan ? { label: 'Packing plan', value: packingPlan } : null,
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
        !services.length && !packingPlan ? 'Any packing, unpacking, or loading help you would like.' : '',
        !accessFactors.length ? 'Stairs, elevators, parking, and loading arrangements.' : '',
        specialtyItems.length ? 'Ask Mullins to review handling needs for your special items.' : '',
    ], 6);

    return {
        status: userTurns.length ? 'building' : 'listening',
        stops,
        possibleStops,
        routeNeedsClarification,
        timing,
        propertyScope,
        packingPlan,
        services,
        inventoryItems,
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
