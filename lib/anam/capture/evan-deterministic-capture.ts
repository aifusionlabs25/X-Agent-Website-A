import { applyEvanRouteTurn, buildEvanMovePlan, joinEvanRouteAnswerClauses } from './evan-move-planner.ts';
import type { MovePlanStop } from './evan-move-planner.ts';
import { buildEvanPlannerContact } from './evan-planner-contact.ts';
import { resolveEvanContactIdentities, extractEvanContactIntent, hasEvanCallbackNameAcknowledgment } from './evan-contact-identity.ts';
import { confirmedEvanInventoryCorrection } from './evan-inventory-correction.ts';
import { isEvanGenericMoveIntroduction, stripEvanCaptureLeadIn } from './evan-capture-language.ts';
import { confirmedEvanDisassembly, EvanCaptureValidationError, validateEvanCapture } from './evan-capture.ts';
import type { EvanCaptureCategory, EvanCaptureFact, EvanCaptureRecord, EvanCaptureTurn } from './evan-capture.ts';

/** Local, bounded grammar, not unrestricted language understanding. Unknown
 * moving clauses stay visible for review; they are never asserted as facts.
 * Canonical planner labels are never used as fabricated visitor evidence. */
export const EVAN_DETERMINISTIC_CAPTURE_COVERAGE = 'Local moving-language rules; unsupported or ambiguous details remain to confirm. No model or inferred totals.';

const fold = (value: string) => value.normalize('NFKC').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const clean = (value: string) => value.trim().replace(/^[,;:‘’“”"'\s]+|[,;:.!?‘’“”"'\s]+$/g, '');
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (source: string, value: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'iu').test(source);
const itemIdentity = (value: string) => fold(value).replace(/(?:ches|shes|xes|zes)$/u, value => value.slice(0, -2))
    .replace(/ies$/u, 'y').replace(/(?<!s)s$/u, '');
const itemReferent = (value: string) => itemIdentity(value).replace(/\bsofa\b/g, 'couch').replace(/\bbedside table\b/g, 'nightstand');
const NUM = String.raw`(?:\d+(?:[,.]\d+)?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)`;
const COUNT = `(?:between\\s+${NUM}\\s+and\\s+${NUM}|(?:at least|at most|no more than|up to)\\s+${NUM}|(?:(?:about|around|roughly|approximately)\\s+)?${NUM}(?:\\s*(?:to|[-–—])\\s*${NUM}|\\s+more)?|(?:a|one) pair|a couple|an?|some|several)`;
const QUANTITY = new RegExp(`^(${COUNT})(?:\\s+of)?\\s+`, 'i');
const ITEMS = /\b(?:queen(?:[- ]size)? beds?|king(?:[- ]size)? beds?|sectional(?: sofas?| couches?)?|dining tables?|pool tables?|grandfather clocks?|tool chests?|curio cabinets?|gun safes?|medical equipment|large mirrors?|walnut sideboards?|armoires?|credenzas?|barstools?|sideboards?|love[ -]?seats?|sofas?|couches|couch|desks?|tables?|chairs?|dressers?|bookcases?|beds?|mattresses|mattress|treadmills?|pianos?|safes?|antiques?|artwork|fine art|paintings?|boxes|crates|cabinets?)\b/gi;
const SERVICES = /\b(?:full[- ]service packing|full packing|packing(?:\s+(?:help|support|assistance))?|unpacking|labor[- ]only|loading(?:\s+help)?|unloading(?:\s+help)?|disassembl(?:e|y|ing)|tak(?:e|ing) apart|reassembly|storage|donation|commercial move|office move|senior move|long[- ]distance|out of state)\b/gi;
const ACCESS = new RegExp(String.raw`\b(?:${NUM}\s+flights?(?:\s+of\s+stairs)?|narrow driveway|no stairs?|stairs?|staircase|no elevator|elevator|loading (?:bay|dock)|loading window|gate code|gated|parking|move[- ]in hours|permitted hours|facility hours|HOA|(?:ground|first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)) floor)\b`, 'gi');
const CARE = /\b(?:walker|wheelchair|mobility|elderly|senior|stress(?:ed|ful)?|chaotic|finish time|time sensitive|urgent|multiple destinations?|several stops?|fragile)\b/gi;
const PROPERTY = /\b(?:(?:one|two|three|four|five|six|\d+)[ -](?:bedrooms?|beds?)(?:\s+(?:apartment|condo|home|house|townhouse|townhome))?|studio(?: apartment)?|single[- ]family home|apartment|condo|townhouse|townhome|house|office|commercial space)\b/gi;
const TIMING = /\b(?:(?:early|mid[- ]?|late|beginning of|middle of|end of|(?:first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th) week (?:of|in))\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{1,2}(?:st|nd|rd|th)?)?\b|\b(?:next|this) (?:week|month|weekend)\b|\b(?:within (?:the next )?\d+ days?|less than \d+ days?|(?:one|two|three|four|five|six|seven|eight|nine|ten) weeks?|mid[- ]month|(?:the )?middle of (?:(?:this|next|the) )?month)\b/gi;
const ADDRESS = /\b\d{1,6}\s+[\p{L}\p{N}.'’ -]{1,70}?\s+(?:Street|St|Road|Rd|Lane|Ln|Drive|Dr|Avenue|Ave|Way|Court|Ct|Boulevard|Blvd|Place|Pl|Circle|Cir)(?:\s+(?:apt|unit|suite|#)\s*[\p{L}\p{N}-]+)?\b/giu;

/** A short date answer is not a callback/packing commitment. Keep literal
 * negative preferences ("not flexible", "weekends won't work") asserted as
 * constraints, and uncertainty as uncertainty. No dates are inferred. */
function timingPreference(clause: string, question: string, hasDate: boolean, joinedMoveDay = false, explicitDateAnchor = false): { category: 'timingFlexibility' | 'timingPreference'; value: string; status: EvanCaptureFact['status'] } | null {
    // ASR may put a sentence boundary before a connective ("Midweek. And
    // it's flexible."). Strip only discourse lead-ins, never qualification.
    const value = clean(clause).replace(/^(?:(?:actually|correction|and|but|also)[, ]+)+/i, '');
    if (!value || value.length > 180) return null;
    const explicitMove = explicitDateAnchor || /\b(?:(?:move|moving)\s+(?:date|day|timing|schedule)|for\s+(?:the|my|our)\s+move)\b/i.test(value);
    const otherTopic = /\b(?:call(?:back)?|call back|phone|email|contact|packing|unpacking|estimate|appointment|furniture|inventory)\b/i;
    if (otherTopic.test(value)) return null;
    const dateQuestion = /\b(?:date|dates|move timing|when.{0,30}mov(?:e|ing)|mov(?:e|ing).{0,30}when)\b/i.test(question);
    if (!hasDate && !explicitMove && !dateQuestion) return null;
    const unknown = /\b(?:not sure|unsure|don't know|do not know)\b/i.test(value);
    const tentative = /\b(?:maybe|perhaps|possibly|might)\b/i.test(value);
    const body = value.replace(/^(?:(?:I(?:['’]m| am)|we(?:['’]re| are))\s+)?(?:not sure|unsure)\s+(?:if|whether)\s+/i, '')
        .replace(/^(?:maybe|perhaps|possibly)\s+/i, '')
        .replace(/^for\s+(?:the|my|our)\s+move,?\s+/i, '')
        .replace(/\s+for\s+(?:the|my|our)\s+move$/i, '');
    const flexibility = /^(?:(?:I(?:['’]m| am)|we(?:['’]re| are)|(?:it|that)(?:['’]s| is)|(?:the|my|our|this|that)\s+(?:move\s+)?date\s+is)\s+)?(?:(?:still|fairly|pretty|quite|very|somewhat|completely|fully)\s+)?(?:(?:not|no longer)\s+)?flexible(?:\s+(?:by|within|on|about|with)\s+(?:a few days(?: either side)?|a couple of days|the (?:move )?date|dates?|timing))?$/i.test(body);
    const day = '(?:mid[ -]?week|weekdays?|weekends?|(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)days?)';
    const preference = new RegExp(`^(?:(?:I|we)\\s+(?:would\\s+)?prefer\\s+)?${day}(?:\\s+(?:(?:would|will|might)\\s+)?works?(?:\\s+(?:best|better))?(?:\\s+for\\s+(?:me|us))?|\\s+(?:is|are)\\s+(?:best|better)|\\s+(?:won['’]t|doesn['’]t|don['’]t|will not|do not)\\s+work)?$`, 'i').test(body);
    if (!flexibility && !preference) return null;
    // A volunteered day preference can follow a non-scheduling inventory or
    // service question. Do not discard it merely because Evan said "packing".
    // Actual scheduling of another activity, contact, and vague "I'm flexible"
    // replies still belong to that other topic unless the caller names the move.
    const otherSchedule = /\b(?:call(?:back)?|call back|phone|email|contact|appointment|when|dates?|days?|times?|schedule|scheduling|available|availability|flexible|morning|afternoon|evening|mid[ -]?week|weekdays?|weekends?|(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|works?(?:\s+(?:best|better))?\s+for)\b/i;
    if (!explicitMove && otherTopic.test(question) && (flexibility && !joinedMoveDay || otherSchedule.test(question))) return null;
    return { category: flexibility ? 'timingFlexibility' : 'timingPreference', value,
        status: unknown ? 'unknown' : tentative ? 'tentative' : 'asserted' };
}

function timingPreferences(clause: string, question: string, hasDate: boolean) {
    const whole = timingPreference(clause, question, hasDate);
    if (whole) return [whole];
    // A bounded calendar anchor may accompany its own day/flexibility in one
    // answer. It is not itself a preference; do not reject its sibling details
    // merely because ASR kept them in the same sentence. Every remaining part
    // must still be a timing answer, with the original other-topic exclusions.
    const parts = clause.split(/,\s*(?:and\s+)?|\s+(?:and|but)\s+/i);
    if (parts.length < 2 || parts.length > 3) return [];
    const anchors = parts.flatMap((part, index) => {
        const dates = [...part.matchAll(TIMING)];
        if (dates.length !== 1) return [];
        const date = dates[0];
        const before = clean(part.slice(0, date.index));
        const after = clean(part.slice(date.index + date[0].length));
        if (after && !/^for\s+(?:the|my|our)\s+move$/i.test(after)) return [];
        if (!/^(?:(?:actually|correction|maybe|perhaps|possibly)\s+)*(?:(?:for\s+(?:the|my|our)\s+move|(?:the|my|our)\s+move(?:\s+(?:date|window))?\s+(?:is|will be)|(?:I|we)(?:['’](?:m|re)|\s+(?:am|are))?\s+(?:moving|hoping to move|planning to move)(?:\s+(?:on|in|during|around))?)\s*)?(?:the)?$/i.test(before)) return [];
        return [{ index, explicit: /\bmov(?:e|ing)\b/i.test(`${before} ${after}`), status: statusFor(part) }];
    });
    if (anchors.length > 1) return [];
    const anchor = anchors[0];
    const preferenceParts = parts.filter((_, index) => index !== anchor?.index);
    const anchored = hasDate || Boolean(anchor);
    const explicit = anchor?.explicit ?? false;
    // A same-answer day preference anchors its joined qualifier to the known
    // move date, even after a non-scheduling estimate/packing remark. It does
    // not override actual callback/appointment scheduling in the question.
    const joinedMoveDay = preferenceParts.some(part => timingPreference(part, question, anchored, false, explicit)?.category === 'timingPreference');
    const preferences = preferenceParts.map(part => timingPreference(part, question, anchored, joinedMoveDay, explicit));
    if (preferences.some(preference => !preference)) return [];
    const known = preferences.filter(preference => preference !== null);
    const status: EvanCaptureFact['status'] = anchor?.status === 'unknown' || known.some(preference => preference.status === 'unknown') ? 'unknown'
        : anchor?.status === 'tentative' || known.some(preference => preference.status === 'tentative') ? 'tentative' : 'asserted';
    return known.map(preference => ({ ...preference, status }));
}

function statusFor(text: string, index = text.length): EvanCaptureFact['status'] {
    const before = text.slice(0, index);
    const cues = [...before.matchAll(/\b(?:do not need|don['’]t need|do not want|don['’]t want|do not have|don['’]t have|do not own|don['’]t own|never (?:said|had|owned|requested)|no longer(?: need| want| have)?|not moving|not taking|aren['’]t moving|are not moving|without|remove|delete|exclude|cancel|skip|no(?! more than)|not|add(?: back)?|include|keep|need|want|have|there (?:is|are)|reinstate)\b/gi)];
    if (/^(?:do not|don['’]t|never|no|not|aren['’]t|are not|without|remove|delete|exclude|cancel|skip)\b/i.test(cues.at(-1)?.[0] ?? '')) return 'removed';
    if (/\b(?:not needed|no longer needed|not included|removed|cancelled|canceled|excluded|is staying|are staying|stays behind|stay behind)\b/i.test(text.slice(index).split(/\band\b|[,;]/i)[0])) return 'removed';
    if (/\b(?:do not know|don't know|not sure|unsure|have to check|need to check)\b/i.test(text)) return 'unknown';
    if (/\b(?:maybe|might|may need|possibly|perhaps|considering|tentative|if needed|if necessary|only if)\b/i.test(text)) return 'tentative';
    return 'asserted';
}

function inventoryPieces(list: string): string[] {
    return list.split(/,\s*/).flatMap(raw => {
        const segment = clean(raw).replace(/^(?:and|also|plus)\s+/i, '');
        // Recognize complete quantities BEFORE splitting the list. A range
        // can follow an unpunctuated item ("desk about 20 to 25 boxes"), not
        // just lead the segment. Its second number/"and" is not a new item.
        // Source offsets preserve the exact range and approximation wording.
        const quantities = [...segment.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${COUNT}(?:\\s+of)?\\s+`, 'giu'))];
        const modifier = '(?:about|around|roughly|approximately|between|at least|at most|no more than|up to)';
        const boundaries = [...segment.matchAll(new RegExp(`\\s+and\\s+|\\s+(?=(?:${modifier}\\s+)?${NUM}(?:\\s|[-–—]))`, 'gi'))]
            .filter(boundary => !quantities.some(quantity => boundary.index >= quantity.index
                && boundary.index < quantity.index + quantity[0].length));
        const pieces: string[] = [];
        let start = 0;
        for (const boundary of [...boundaries.map(match => ({ index: match.index, length: match[0].length })),
            { index: segment.length, length: 0 }]) {
            pieces.push(segment.slice(start, boundary.index));
            start = boundary.index + boundary.length;
        }
        return pieces;
    }).map(piece => piece.replace(/^(?:(?:um+|uh+|erm|er|hmm)[, ]+)+/i, '').trim())
        .filter(piece => Boolean(piece) && !/^(?:um+|uh+|erm|er|hmm)$/i.test(clean(piece)));
}

function untrustedQuoteRanges(text: string): Array<[number, number]> {
    if (!/\b(?:sample|example|form|says|said|quote)\b/i.test(text)
        || /\b(?:my|our)\s+(?:actual\s+)?(?:move|moving|inventory|furniture)\s+list\b/i.test(text) && !/\b(?:sample|example)\b/i.test(text)) return [];
    return [...text.matchAll(/(?<![\p{L}\p{N}])[‘“"'](?=[\p{L}\p{N}])[\s\S]{1,1800}?[’”"'](?=$|[\s.,;!?])/gu)]
        .map(match => [match.index, match.index + match[0].length]);
}

function locationFor(text: string, question = ''): EvanCaptureFact['location'] {
    const match = (source: string): EvanCaptureFact['location'] => {
        const origin = /\b(?:origin|pick[ -]?up)\b/i.test(source);
        const destination = /\b(?:destination|delivery|drop[- ]?off)\b/i.test(source);
        if (origin !== destination) return origin ? 'origin' : 'destination';
        if (/\b(?:additional|extra|storage|donation)\s+(?:stop|unit|location)\b/i.test(source)) return 'additional';
        return 'unspecified';
    };
    // Only the actual request can supply a missing location. An acknowledgment
    // about the previous topic ("easy drop-off") is not evidence that the next
    // generic inventory answer describes belongings already at the destination.
    const requests = question.split(/(?<=[.!?;])\s+/).map(part => part.trim());
    let request = requests.findLast(part => /\?\s*$/.test(part)
        || /(?:^|,\s*)(?:please\s+)?(?:tell me|describe|list)\b/i.test(part)
        || /^(?:(?:okay|ok|so|now|please)[, ]+)*(?:tell me|describe|list|what|which|how|where|when|do you|can you|could you|would you|are there|is there|any)\b/i.test(part)) ?? '';
    const questionStart = request.search(/\b(?:what|which|how|where|when|do you|can you|could you|would you|are there|is there|any|tell me|describe|list)\b/i);
    const locationTopic = /^(?:(?:and|now|so|okay|ok)[, ]+)*(?:(?:at|for|from|about|regarding|as for)\s+)?(?:(?:the|your|our|my)\s+)?(?:origin|pick[ -]?up|destination|delivery|drop[- ]?off|(?:additional|extra|storage|donation)\s+(?:stop|unit|location))\s*[,;:—-]?\s*(?:please\s*)?$/i;
    if (questionStart > 0 && !locationTopic.test(request.slice(0, questionStart))) {
        request = request.slice(questionStart);
    }
    return match(text) !== 'unspecified' ? match(text) : match(request);
}

function scopeFor(text: string): string {
    const addresses = [...text.matchAll(ADDRESS)];
    if (addresses.length === 1) return addresses[0][0];
    return text.match(/\b(?:in|from|at)\s+(?:the\s+)?(bedroom|living room|dining room|garage|basement|attic|kitchen|den|study|workshop)\b/i)?.[1] ?? '';
}

// Property and access answers describe the same building, including when its
// role is supplied by the immediately preceding question. Never apply this
// context to possessions/services, or carry it through unrelated turns.
// null means no role cue; unspecified means conflicting cues, not permission
// to fall back to an older question and guess one endpoint.
function buildingLocationHint(source: string): EvanCaptureFact['location'] | null {
    const origin = /\b(?:origin|pick[ -]?up|mov(?:e|ing)\s+(?:from|out\s+of)|current\s+(?:home|house|apartment|condo|place|property))\b|^\s*(?:from|out\s+of)\b/i.test(source);
    const destination = /\b(?:destination|deliver(?:y|ies)|drop[- ]?off|mov(?:e|ing)\s+(?:in)?to|new\s+(?:home|house|apartment|condo|place|property))\b|^\s*(?:in)?to\b/i.test(source)
        || origin && /\b(?:from|out\s+of)\s+and\s+(?:in)?to\b/i.test(source);
    if (origin || destination) return origin && destination ? 'unspecified' : origin ? 'origin' : 'destination';
    const other = locationFor(source);
    return other === 'unspecified' ? null : other;
}

function buildingLocationFor(text: string, question = ''): EvanCaptureFact['location'] {
    return buildingLocationHint(text) ?? buildingLocationHint(question) ?? 'unspecified';
}

function accessLocationFor(text: string, index: number, question: string): EvanCaptureFact['location'] {
    // Comma-separated details share their nearest preceding building label,
    // until another explicit building label starts. Never scan past this clause.
    const parts = buildingDetailParts(text).filter(part => part.index <= index);
    for (const part of parts.reverse()) {
        const role = buildingLocationHint(part.text);
        if (role !== null) return role;
    }
    // A sole trailing label ("one flight of stairs, at pickup") is still
    // explicit. Conflicting whole-clause labels remain unassigned.
    return buildingLocationFor(text, question);
}

/** A visitor's complete "apartment to house" correction outranks a preceding
 * question about only one end of the move. Do not infer roles from a list or
 * alternatives joined with "or". Keep both source spans independent. */
function pairedPropertyLocation(text: string, matches: RegExpMatchArray[], index: number): EvanCaptureFact['location'] {
    if (matches.length !== 2 || matches.some(match => !/\b(?:apartment|condo|home|house|townhouse|townhome|studio|office|space)\b/i.test(match[0]))) return 'unspecified';
    const [first, second] = matches;
    let prefix = stripEvanCaptureLeadIn(text.slice(0, first.index));
    // A route/date can precede the property pair in the same answer. Only
    // discard that prefix when it independently establishes both route ends.
    const boundary = Math.max(prefix.lastIndexOf(','), prefix.lastIndexOf(';'));
    if (boundary >= 0) {
        const route = buildEvanMovePlan([{ role: 'user', content: prefix.slice(0, boundary) }]);
        if (route.stops.some(stop => stop.kind === 'Origin') && route.stops.some(stop => stop.kind === 'Destination')) {
            prefix = stripEvanCaptureLeadIn(prefix.slice(boundary + 1));
        }
    }
    const between = text.slice((first.index ?? 0) + first[0].length, second.index).trim();
    if (!/^(?:(?:actually|correction|no)[, ]+)?(?:(?:I(?:['’]m| am)|we(?:['’]re| are))\s+)?(?:moving\s+)?(?:from\s+)?(?:an?\s*)?$/i.test(prefix)
        || !/^(?:in)?to\s*(?:an?)?$/i.test(between)) return 'unspecified';
    return index === first.index ? 'origin' : index === second.index ? 'destination' : 'unspecified';
}

/** Preserve a location lead-in across its comma: "at pickup, there's ...".
 * Parts retain source offsets and never borrow a label from another fact. */
function buildingDetailParts(text: string): Array<{ text: string; index: number }> {
    const ranges = [...text.matchAll(new RegExp(`\\bbetween\\s+${NUM}\\s+and\\s+${NUM}\\b`, 'gi'))];
    const boundaries = [...text.matchAll(new RegExp(`[,;]|\\s+and\\s+|\\s+(?=(?:in)?to\\s+(?:an?\\s+)?${PROPERTY.source})`, 'gi'))]
        .filter(boundary => !ranges.some(range => boundary.index > range.index && boundary.index < range.index + range[0].length));
    const parts: Array<{ text: string; index: number }> = [];
    let start = 0;
    for (const boundary of [...boundaries.map(match => ({ index: match.index, length: match[0].length })), { index: text.length, length: 0 }]) {
        const raw = text.slice(start, boundary.index);
        const value = raw.trim();
        if (value) {
            const index = start + raw.indexOf(value);
            const previous = parts.at(-1);
            if (previous && /^(?:(?:actually|correction)[,\s]+)?(?:(?:at\s+)?(?:the\s+)?)?(?:origin|pick[ -]?up|destination|delivery|drop[- ]?off)(?:\s+(?:location|place|property))?\s*:?$/i.test(previous.text)
                && [...value.matchAll(PROPERTY), ...value.matchAll(ACCESS)].length) {
                previous.text = text.slice(previous.index, index + value.length);
            } else parts.push({ text: value, index });
        }
        start = boundary.index + boundary.length;
    }
    return parts;
}

function inventoryListPieces(list: string): string[] {
    // Classify building clauses before count/list splitting can turn their
    // connectors into apparent objects. Real sibling items remain eligible.
    if (![...list.matchAll(PROPERTY), ...list.matchAll(ACCESS)].length) return inventoryPieces(list);
    return buildingDetailParts(list).flatMap(part => {
        // Splitting a building description may detach its role/city or verb
        // from the property noun. Neither fragment is an owned object. This
        // rule runs only inside a list containing building details; keep real
        // sibling objects, including names outside our known-item vocabulary.
        const structural = clean(part.text);
        if (/^(?:(?:at|for)\s+)?(?:(?:the|my|our)\s+)?(?:origin|pick[ -]?up|destination|delivery|drop[- ]?off)(?:\s+(?:in|at)\s+[\p{L} .'-]+)?$/iu.test(structural)
            || /^(?:(?:I(?:['’]m| am)|we(?:['’]re| are))\s+)?(?:moving|going)(?:\s+(?:from|out of|into|to))?$/i.test(structural)) return [];
        const properties = [...part.text.matchAll(PROPERTY)].filter(detail => {
            // A property noun can be part of an object name (office partitions,
            // doll house). Only classify the whole nominal as a building, or
            // use explicit building grammar; do not require a known item noun.
            const remainder = clean(part.text.slice(0, detail.index) + ' ' + part.text.slice(detail.index + detail[0].length))
                .replace(/\s*\bat\s+(?:the\s+)?(?:origin|pick[ -]?up|destination|delivery|drop[- ]?off)$/i, '').trim();
            return !remainder || new RegExp(`^${COUNT}$`, 'i').test(remainder)
                || new RegExp(`^${NUM}\\s+or$`, 'i').test(remainder)
                || /^(?:(?:going|moving)\s+)?(?:from|(?:in)?to)\s*(?:an?)?$/i.test(remainder)
                || /^(?:(?:at|for)\s+)?(?:(?:the|my|our)\s+)?(?:origin|pick[ -]?up|destination|delivery|drop[- ]?off)[,\s:]*(?:an?)?$/i.test(remainder)
                || /\b(?:there|is|are|has|from|into)\b/i.test(part.text);
        });
        const details = [...properties, ...part.text.matchAll(ACCESS)];
        const independentItem = [...part.text.matchAll(ITEMS)].some(item => !details.some(detail =>
            item.index >= detail.index && item.index + item[0].length <= detail.index + detail[0].length));
        return details.length && !independentItem ? [] : inventoryPieces(part.text);
    });
}

function clausesFor(text: string): string[] {
    // Splits preserve exact source substrings; replacements are never evidence.
    const clauses = text.split(/(?<=[.!?;])\s+|\s+but\s+|,\s*(?=(?:then\s+)?(?:storage|donation|finish|end|destination|origin)\b)|,?\s+and\s+(?=(?:i|we|there|finish|end|change|update|correct|remove|delete|keep|include|add|the (?:origin|destination)|at (?:the )?(?:origin|destination))\b)/i)
        // Separate explicit sequential street stops without detaching a shared
        // tentative/negative prefix and accidentally confirming its sibling.
        .flatMap(value => statusFor(value) === 'asserted' && [...value.matchAll(ADDRESS)].length > 1
            ? value.split(/,\s*(?=then\s+(?:at|to)\b)/i) : [value])
        .map(value => value.trim()).filter(Boolean);
    return joinEvanRouteAnswerClauses(text, clauses);
}

function asksForHomeContents(question: string): boolean {
    const lastQuestion = question.match(/[^.!?]*\?/g)?.at(-1) ?? question;
    // Contents already at the new home are not necessarily on this move.
    if (/\b(?:destination|new\s+(?:home|house|apartment|place))\b/i.test(lastQuestion)) return false;
    const home = '(?:(?:the|your|our|that|this)\\s+)?(?:(?:\\d+|one|two|three|four|five|six)[ -]bedroom\\s+)?(?:apartment|home|house|condo|townhouse|place)';
    return new RegExp(`\\b(?:what(?:['’]s|\\s+is)\\s+(?:in|inside)|what\\s+do\\s+you\\s+have\\s+(?:in|inside)|(?:contents|belongings)\\s+(?:of|in))\\s+${home}\\b`, 'i').test(lastQuestion);
}

function fact(category: EvanCaptureCategory, value: string, turn: number, quote: string, extra: Partial<EvanCaptureFact> = {}): EvanCaptureFact {
    return { category, value, status: 'asserted', evidence: [{ turn, quote }], location: 'unspecified', scope: '', quantity: '', route: null, ...extra };
}

function currentFieldEvidence(previous: EvanCaptureFact | undefined, latest: EvanCaptureFact['evidence'][number], values: string[]): EvanCaptureFact['evidence'] {
    const available = [...(previous?.evidence ?? []), latest];
    const selected = new Set<EvanCaptureFact['evidence'][number]>([latest]);
    // A correction can update a count while retaining an older descriptor or
    // scope. Preserve a source for every CURRENT field, not just the first turn.
    for (const value of values.filter(Boolean)) {
        const source = available.findLast(evidence => has(fold(evidence.quote), fold(value)));
        if (source) selected.add(source);
    }
    return [...selected].sort((left, right) => left.turn - right.turn);
}

function sourceSpan(turns: EvanCaptureTurn[], value: string, end = turns.length - 1): { turn: number; quote: string; value: string } | null {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'iu');
    for (let index = end; index >= 0; index--) {
        if (turns[index].role !== 'user') continue;
        const matched = turns[index].content.match(pattern);
        if (matched) return { turn: index, quote: turns[index].content, value: matched[0] };
    }
    return null;
}

function inventorySubject(text: string, owned: EvanCaptureFact[]): EvanCaptureFact | null {
    const subject = text.match(/^(?:(?:actually|correction)[, ]+)?(?:the|that|this|my|our)\s+(.+?)\s+(?:has|have|is|are|needs?|must)\b/i)?.[1]
        ?.replace(/(?:['’]s)?\s+(?:lid|legs?|doors?)$/i, '');
    if (!subject) return null;
    const matches = owned.filter(value => itemReferent(value.value) === itemReferent(subject)
        || itemReferent(value.value).endsWith(` ${itemReferent(subject)}`));
    return matches.length === 1 ? matches[0] : null;
}

/** Recompute the bounded session snapshot locally. Values use visitor spans or
 * an explicitly validated immediate service-confirmation pair. Revalidate both
 * at the boundary; an agent-only assertion is never a captured request. */
export function buildDeterministicEvanCapture(turns: EvanCaptureTurn[], revision: number): EvanCaptureRecord {
    if (!Array.isArray(turns) || turns.length > 400 || turns.some(turn => !turn || !['user', 'agent'].includes(turn.role)
        || typeof turn.content !== 'string' || !turn.content.trim() || turn.content.length > 2_000)
        || turns.reduce((size, turn) => size + turn.content.length, 0) > 80_000) throw new EvanCaptureValidationError();
    const state = new Map<string, EvanCaptureFact>();
    const inventoryAliases = new Map<string, string>();
    const handlingOwners = new Map<string, string>();
    const unknownCountOwners = new Map<string, string>();
    const contactEvidence = new Map<string, EvanCaptureFact>();
    let previousQuestion = '';
    const identities = resolveEvanContactIdentities(turns);
    let cityStops: MovePlanStop[] = [];
    const addressRoutes = new Map<string, EvanCaptureFact>();
    const routeEvidence: Array<{ turn: number; quote: string }> = [];
    const routeInput: EvanCaptureTurn[] = [];
    let previousContact = buildEvanPlannerContact([]);
    const put = (key: string, next: EvanCaptureFact) => {
        const old = state.get(key);
        // A same-endpoint type confirmation is not a replacement building.
        // Retain the fuller visitor-sourced fact (including its evidence), but
        // never transfer bedrooms across endpoints or through a real change,
        // removal or uncertainty. A new count/type still replaces the old one.
        if (old?.category === 'property' && next.category === 'property'
            && old.status === 'asserted' && next.status === 'asserted'
            && next.location !== 'unspecified'
            && /^(?:house|apartment|condo|townhouse|townhome|home)$/i.test(next.value)
            && new RegExp(`\\b(?:${NUM})[- ]bedrooms?\\s+${escape(next.value)}\\b`, 'i').test(old.value)
            && !/\b(?:different|another|changed|new property|new place)\b/i.test(next.evidence.at(-1)?.quote ?? '')) return;
        if (old && old.value !== next.value && !['name', 'phone', 'email', 'timing', 'property', 'packing', 'contactPreference', 'callbackWindow'].includes(next.category)) {
            next = { ...next, value: old.value, evidence: [...old.evidence.slice(0, 1), ...next.evidence].slice(-8) };
        }
        state.set(key, next);
    };
    const addUnknown = (text: string, turn: number) => {
        // Keep a source excerpt visible for review instead of calling an
        // unsupported meaningful statement a successfully understood fact.
        // A visitor clarifying that they are the customer supplies no missing
        // move detail, even when the sentence contains the word "move".
        if (/\b(?:I(?:['’]m| am)|we(?:['’]re| are))\s+(?:the|a)\s+(?:customer|caller)s?\s+(?:calling|asking|talking)\s+(?:about|regarding)\s+(?:my|our)\s+move\b/i.test(text)) return;
        // Conversation controls and generic introductions are not unresolved
        // moving details. This only filters notes; it never authorizes closing.
        if (/^(?:(?:please|okay|ok)[, ]+)?(?:I\s+(?:need|want|have)\s+to\s+)?(?:end|stop|finish|close)\s+(?:the|this|our)\s+(?:call|conversation|session)(?:\s+now)?[.!?]*$/i.test(text.trim())) return;
        if (isEvanGenericMoveIntroduction(text) || isEvanGenericMoveIntroduction(turns[turn].content)) return;
        const value = clean(text).slice(0, 360);
        // Identical unresolved statements are one current uncertainty, not one
        // fact per repetition. Keep the latest exact wording and provenance.
        if (value) state.set(`unknown:${fold(clean(text))}`, fact('question', value, turn, text, { status: 'unknown' }));
    };

    for (const [index, turn] of turns.entries()) {
        if (turn.role === 'agent') {
            previousQuestion = turn.content;
            if (hasEvanCallbackNameAcknowledgment(turns.slice(0, index + 1))) {
                const contact = buildEvanPlannerContact(turns.slice(0, index + 1));
                const exact = contactEvidence.get(`name:${fold(contact.displayName)}`);
                if (exact && !contact.hiddenFields.includes('displayName')) put('contact:name', exact);
                previousContact = contact;
            }
            continue;
        }
        const question = previousQuestion;
        previousQuestion = '';
        const identity = identities[index];
        for (const category of ['name', 'phone', 'email'] as const) {
            const candidate = identity[category];
            if (candidate) contactEvidence.set(`${category}:${fold(candidate.value)}`, fact(category, candidate.value, candidate.sourceTurn, candidate.quote));
        }
        const clearAll = /\b(?:remove|delete|clear|hide|forget)\s+(?:(?:all|my|the)\s+)*(?:contact\s+(?:details|information)|personal\s+(?:details|information))\b/i.exec(turn.content);
        const intent = extractEvanContactIntent(clearAll ? turn.content.slice(clearAll.index + clearAll[0].length) : turn.content, question);
        for (const category of ['contactPreference', 'callbackWindow'] as const) {
            const candidate = intent[category];
            if (candidate) contactEvidence.set(`${category}:${fold(candidate.value)}`,
                fact(category, candidate.quote, index, candidate.quote));
        }
        const contact = buildEvanPlannerContact(turns.slice(0, index + 1));
        const fields = [['name', 'displayName'], ['phone', 'phone'], ['email', 'email'], ['contactPreference', 'contactPreference'], ['callbackWindow', 'callbackWindow']] as const;
        for (const [category, field] of fields) {
            if (contact.hiddenFields.includes(field) || !contact[field] && previousContact[field]) {
                const original = state.get(`contact:${category}`);
                const word = category === 'name' ? /\bname\b/i : category === 'phone' ? /\b(?:phone|number)\b/i : category === 'email' ? /\b(?:email|e-mail|address)\b/i : null;
                const value = turn.content.match(word ?? /\b(?:contact|callback|time|details|information)\b/i)?.[0]
                    ?? turn.content.match(/\b(?:contact|details|information)\b/i)?.[0]
                    // A normalized phone/email is not necessarily a literal
                    // span. Tombstones use the retained original source text.
                    ?? original?.evidence[0]?.quote.slice(0, 360);
                if (value) put(`contact:${category}`, fact(category, value, index, turn.content, { status: 'removed',
                    evidence: [...(original?.evidence.slice(0, 1) ?? []), { turn: index, quote: turn.content }] }));
            } else if (contact[field]) {
                const exact = contactEvidence.get(`${category}:${fold(contact[field])}`);
                if (exact) put(`contact:${category}`, exact);
            }
        }
        previousContact = contact;

        for (const service of confirmedEvanDisassembly(turns, index)) {
            state.set(`confirmed-disassembly:${fold(service.scope)}`, service);
        }

        const inventoryCorrection = confirmedEvanInventoryCorrection(turn.content, question, [...state.entries()], index);
        if (inventoryCorrection) {
            const { oldKey, next } = inventoryCorrection;
            const aliasKey = JSON.stringify([next.location, fold(next.scope), itemIdentity(next.value)]);
            const newKey = `inventory:${aliasKey}`;
            state.delete(oldKey);
            state.set(newKey, next);
            inventoryAliases.set(aliasKey, next.value);
            for (const [key, owner] of handlingOwners) if (owner === oldKey) handlingOwners.set(key, newKey);
            for (const [key, owner] of unknownCountOwners) if (owner === oldKey) unknownCountOwners.set(key, newKey);
            // The bounded correction consumed the entire reply; do not parse
            // its "not books" tail again as a separate removal or possession.
            continue;
        }

        const quotedRanges = untrustedQuoteRanges(turn.content);
        let clauseOffset = 0;
        let pendingInventoryMention: { value: string; quote: string } | null = null;
        let pendingRouteUncertainty = false;
        let handlingFocus: EvanCaptureFact | null = null;
        let previousBuildingClause: { location: EvanCaptureFact['location']; quote: string } | null = null;
        for (const clause of clausesFor(turn.content)) {
            const priorBuildingClause: { location: EvanCaptureFact['location']; quote: string } | null = previousBuildingClause;
            previousBuildingClause = null;
            // Resolve only a direct building anaphor in the very next clause
            // of this visitor utterance. Any intervening topic, question,
            // hypothetical, third party or ambiguous building pair breaks it.
            const buildingAnaphor = priorBuildingClause && /^(?:it|(?:this|that)\s+(?:home|house|apartment|condo|place|property|building))\s+(?:(?:might|may|could)\s+)?(?:has|have|is|does|doesn't|does not)\b/i.test(clause)
                ? priorBuildingClause : null;
            const clauseStart = turn.content.indexOf(clause, clauseOffset);
            clauseOffset = clauseStart + clause.length;
            if (quotedRanges.some(([start, end]) => clauseStart >= start && clauseStart < end)) { handlingFocus = null; continue; }
            const hypothetical = /^\s*(?:what if|suppose|hypothetically|for example|imagine|if\s+(?:i|we)\s+(?:had|bought|owned|were|could|(?:do\s+)?have))\b/i.test(clause)
                || /\b(?:sample|example)\b.*\b(?:not my|not our|only|form)\b/i.test(clause);
            const asking = /\?\s*$/.test(clause) || /^(?:do you|does mullins|can you|could you|would you|how|what|is there|are there)\b/i.test(clause);
            if (hypothetical) { handlingFocus = null; addUnknown(clause, index); continue; }
            // A connection check is conversation control, not a moving question.
            if (/^(?:hello[,! ]+)?(?:are you still there|can you (?:still )?hear me|are you there)\??$/i.test(clause)) continue;
            // A caller (or a test persona) can accidentally speak both sides
            // of a contact readback. It is not a moving question, nor does it
            // confirm the value; keep genuine follow-up questions separately.
            if (/^did I (?:get|read|hear|catch) (?:that|it) (?:right|correct)\??$/i.test(clause)
                && /\bI (?:read|heard|got|have) (?:that|it) as\b/i.test(turn.content.slice(0, clauseStart))
                && /(?:@|\b(?:email|e-mail|phone|number)\b)/i.test(turn.content.slice(0, clauseStart))
                && /^\s*(?:yes|yeah|yep|correct|that(?:'s| is) right)\b/i.test(turn.content.slice(clauseStart + clause.length))) continue;
            if (asking && !/\b(?:please|add|remove|include|cancel|change|replace|I need|we need)\b/i.test(clause)) {
                handlingFocus = null;
                put(`question:${fold(clause)}`, fact('question', clean(clause).slice(0, 360), index, clause));
                // Possession in a service question is not yet moving scope.
                // A following unambiguous declaration may refer to this single
                // object, with both source clauses kept as evidence.
                const mention = clause.match(/\bmove\s+(?:my|our)\s+([^?!;]+)[?!]?$/i)?.[1];
                pendingInventoryMention = mention && !/\b(?:and|or|from|to|if)\b|,/i.test(mention)
                    ? { value: clean(mention), quote: clause } : null;
                continue;
            }
            let captured = false;
            if (pendingRouteUncertainty && /^(?:I(?:['’]m| am)|we(?:['’]re| are))\s+(?:still\s+)?(?:not sure|unsure)(?:\s+yet)?[.!?,]*$/i.test(clause)) {
                // The preceding tentative route already carries this state;
                // a detached generic note would remain stale after commitment.
                pendingRouteUncertainty = false;
                continue;
            }
            pendingRouteUncertainty = false;
            if (pendingInventoryMention && /^(?:it(?:['’]s| is)|that(?:['’]s| is))\s+(?:(?:definitely|still)\s+)?on\s+(?:our|my|the)\s+move list\b/i.test(clause)) {
                const value = pendingInventoryMention.value;
                const aliasKey = JSON.stringify(['unspecified', '', itemIdentity(value)]);
                inventoryAliases.set(aliasKey, value);
                put(`inventory:${aliasKey}`, fact('inventory', value, index, pendingInventoryMention.quote, {
                    evidence: [{ turn: index, quote: pendingInventoryMention.quote }, { turn: index, quote: clause }],
                }));
                pendingInventoryMention = null;
                captured = true;
            } else pendingInventoryMention = null;
            const thirdParty = /^(?:my|our|his|her|their|the|he|she|they)\b[^.!?]{0,80}\b(?:has|owns|said|says)\b/i.test(clause)
                && !/\b(?:my|our)\s+(?:inventory|items|move list|furniture)\b/i.test(clause)
                && !inventorySubject(clause, [...state.values()].filter(value => value.category === 'inventory' && value.status === 'asserted'));
            if (thirdParty) { handlingFocus = null; addUnknown(clause, index); continue; }
            // Recap choice and coordinator contact are independent. A refusal
            // is a retained preference, not deletion of the email address.
            if (/\b(?:recap|summary)\s+email\b|\bemail\s+(?:recap|summary)\b/i.test(clause)
                && /^(?:(?:actually|please)[, ]+)?(?:don['’]t|do not|never|no|skip|cancel|send me|I (?:still )?(?:do not want|don['’]t want|want|would like))\b/i.test(clause)
                && clause.length <= 360) {
                state.set('contact:recapPreference', fact('recapPreference', clean(clause), index, clause));
                captured = true;
            }
            if (/\b(?:I|we)(?:\s+am|\s+are|['’]m|['’]re)?\s+(?:not moving|not taking|aren['’]t moving)\s+(?:them|those|these|it)\b/i.test(clause)) {
                const sameTurn = [...state.entries()].filter(([, value]) => value.category === 'inventory'
                    && value.evidence.some(evidence => evidence.turn === index));
                for (const [key, previous] of sameTurn) state.set(key, { ...previous, status: 'removed',
                    evidence: [...previous.evidence.slice(0, 1), { turn: index, quote: clause }] });
                if (sameTurn.length) captured = true;
            }
            // The only normalized cue is a role synonym; location values still
            // must occur in the untouched visitor text before projection.
            // A supplied endpoint pair may lead a comma-separated inventory
            // answer. Validate the prefix through the existing route rules;
            // arbitrary city mentions do not authorize a route or possessions.
            const commaAt = clause.indexOf(',');
            const pairedPrefix = commaAt > 0 ? clause.slice(0, commaAt).trim() : '';
            const pairedTail = commaAt > 0 ? clause.slice(commaAt + 1).trim() : '';
            const prefixStops = pairedPrefix && QUANTITY.test(pairedTail)
                ? applyEvanRouteTurn([], pairedPrefix, question) : [];
            const hasPairedPrefix = prefixStops.length === 2
                && prefixStops[0].kind === 'Origin' && prefixStops[1].kind === 'Destination';
            const routeInventory = hasPairedPrefix && ![...pairedTail.matchAll(TIMING)].some(match => clean(match[0]) === clean(pairedTail))
                ? pairedTail : '';
            const routeClause = (hasPairedPrefix ? pairedPrefix : clause).replace(/\b(?:finish(?:ing)?|end(?:ing)?)\s+in\b/gi, 'destination is');
            routeEvidence.push({ turn: index, quote: clause });
            if (question) routeInput.push({ role: 'agent', content: question });
            routeInput.push({ role: 'user', content: clause });
            const previousStops = JSON.stringify(cityStops);
            cityStops = applyEvanRouteTurn(cityStops, routeClause, question);
            if (JSON.stringify(cityStops) !== previousStops) captured = true;
            const location = locationFor(clause, question), scope = scopeFor(clause);
            const status = statusFor(clause);
            if (status !== 'asserted' && /\b(?:stop|storage|donation)\b/i.test(clause)
                && buildEvanMovePlan(routeInput).possibleStops.some(stop => has(clause, stop.city))) {
                captured = true;
                pendingRouteUncertainty = true;
            }
            const addresses = [...clause.matchAll(ADDRESS)];
            if (addresses.length === 1 && /\b(?:origin|pick[ -]?up|destination|delivery|drop[- ]?off|stop|storage|donation|moving from|moving to)\b/i.test(clause + ' ' + question)) {
                const address = addresses[0][0];
                const related = cityStops.filter(stop => has(clause, stop.city));
                const role = location !== 'unspecified' ? location : related.length === 1
                    ? related[0].kind === 'Origin' ? 'origin' : related[0].kind === 'Destination' ? 'destination' : 'additional'
                    : /\b(?:storage|donation|stop)\b/i.test(clause) ? 'additional' : 'unspecified';
                const city = related.length === 1 ? sourceSpan([turn], related[0].city)?.value ?? '' : '';
                const purpose = clause.match(/\b(?:storage|donation|garage|assisted living)\b/i)?.[0] ?? '';
                const prior = /\b(?:actually|correction|change|replace|instead)\b/i.test(clause) && purpose
                    ? [...addressRoutes.entries()].filter(([, value]) => value.location === 'additional' && fold(value.route?.purpose ?? '') === fold(purpose)) : [];
                const corrected = role === 'additional' && prior.length === 1 ? prior[0] : null;
                const key = role === 'origin' || role === 'destination' ? role : corrected?.[0] ?? fold(address);
                addressRoutes.set(key, fact('route', corrected?.[1].value ?? address, index, clause, {
                    location: role, scope: role === 'additional' ? corrected?.[1].scope ?? address : '', status,
                    evidence: corrected ? [...corrected[1].evidence.slice(0, 1), { turn: index, quote: clause }] : [{ turn: index, quote: clause }],
                    route: { city, address, purpose, order: null } }));
                captured = true;
            }
            if (/\b(?:clear|reset)\b.*\b(?:route|map|all stops)\b/i.test(clause)) addressRoutes.clear();
            if (/\b(?:remove|delete|skip|cancel)\b.*\bstop\b/i.test(clause) && addresses.length === 0) {
                const purpose = clause.match(/\b(?:storage|donation|garage|assisted living)\b/i)?.[0];
                const matches = [...addressRoutes.entries()].filter(([, value]) => purpose && fold(value.route?.purpose ?? '') === fold(purpose));
                if (matches.length === 1) addressRoutes.set(matches[0][0], { ...matches[0][1], status: 'removed',
                    evidence: [...matches[0][1].evidence.slice(0, 1), { turn: index, quote: clause }] });
            }

            const contentsQuestion = asksForHomeContents(question);
            const routeOnlyQuestion = /\b(?:where|cities|city|states?|locations?|addresses?|from\s+and\s+to)\b/i.test(question)
                && !/\b(?:items|furniture|inventory|move list|boxes|pieces|belongings)\b/i.test(question);
            const inventoryQuestion = !routeOnlyQuestion && (contentsQuestion || (/\b(?:what|which|list|describe|anything|anything else|how many|how much)\b.*\b(?:items|furniture|inventory|move list|moving|taking|comes|coming|boxes|pieces)\b/i.test(question)
                && !/\b(?:what|which)\s+(?:(?:size|type|kind)(?:\s+of)?\s+)?(?:home|house|apartment|property)\b/i.test(question)));
            const sameTurnInventory = [...state.values()].some(value => value.category === 'inventory'
                && value.evidence.some(source => source.turn === index));
            const continuationCue = (inventoryQuestion || sameTurnInventory || /\bto add[.!?]*$/i.test(clause))
                ? clause.match(/^there(?:['’]s|\s+(?:is|are))(?:\s+also)?\s+/i) : null;
            const removeAction = clause.match(/^(?:(?:actually|correction)[, ]+)?(?:please\s+)?take\s+(?:(?:the|that)\s+)?(.+?)\s+(?:off|out of)\s+(?:the |my |our )?(?:move list|inventory|list|move)[.!?]*$/i);
            const restoreAction = clause.match(/^(?:(?:actually|correction)[, ]+)?(?:please\s+)?put\s+(?:(?:the|that)\s+)?(.+?)\s+back(?:\s+on\s+(?:the |my |our )?(?:move list|inventory|list|move))?(?:\s+after all)?[.!?]*$/i);
            const countAction = clause.match(new RegExp(`^(?:(?:actually|correction)[, ]+)?(?:please\\s+)?(?:change|update|correct)\\s+(?:the\\s+)?(.+?)\\s+to\\s+(${COUNT})[.!?]*$`, 'i'));
            const actionObject = removeAction?.[1] ?? restoreAction?.[1] ?? countAction?.[1] ?? '';
            const inventoryCommand = clause.match(/^(?:(?:actually|correction)[, ]+)?(?:(?:please|maybe|possibly|perhaps)\s+)?(?:add(?: back)?|include|keep|remove|exclude|delete|skip|reinstate|make that)\s+(?:the\s+)?/i);
            // "Include help taking apart ..." adds a service, not belongings.
            // Resolve that command's object before the generic inventory list
            // path can split its item references into new inventory entries.
            // A separate "include another desk" declaration still uses the
            // normal inventory path, including quantities and location labels.
            // Noun-first service objects are references only when every named
            // item is already grounded; never swallow new/extra belongings.
            const commandObject = inventoryCommand ? clause.slice(inventoryCommand[0].length) : '';
            const serviceTail = commandObject.match(/^(.+?)\s+(?:disassembly|reassembly)(?:\s+(?:help|support|assistance|services?))?(?:,?\s+please)?[.!?]*$/i);
            const existingServiceTargets = serviceTail && !/\b(?:another|additional|extra|second|other|new)\b/i.test(serviceTail[1])
                && inventoryListPieces(serviceTail[1]).every(target => {
                    const referent = itemReferent(clean(target).replace(/^(?:both\s+)?(?:(?:the|that|this|my|our|a|an)\s+)?/i, ''));
                    return !!referent && [...state.values()].some(previous => previous.category === 'inventory'
                        && (itemReferent(previous.value) === referent || itemReferent(previous.value).endsWith(` ${referent}`)));
                });
            const serviceCommand = inventoryCommand !== null
                && (/^(?:both\s+)?(?:(?:(?:some|a little)\s+)?(?:help|support|assistance)(?:\s+(?:with|to))?\s+)?(?:disassembl(?:e|y|ing)|tak(?:e|ing) apart|reassembly)\b/i
                    .test(commandObject) || existingServiceTargets);
            const inventoryCue = clause.match(/\b(?:items|inventory|furniture|move list)(?:\s+(?:includes?|are|is|consists of)\b|\s*:)\s*/i)
                ?? clause.match(/\b(?:I|we)(?:['’](?:m|re|ll)|\s+(?:am|are|will|might|may|could))?\s+(?:(?:only|definitely|just|also)\s+)*(?:(?:do(?:\s+not)?|don['’]t)\s+)?(?:(?:only|definitely|just|also)\s+)*(?:have|own|need to move|want to move|moving|move|taking|take|bringing|bring)\s+(?!from\b|(?:in)?to\b|out\s+of\b)/i)
                ?? (serviceCommand ? null : inventoryCommand)
                ?? continuationCue;
            const countUnknown = /\b(?:haven['’]t|have not|not yet)\s+counted\b|\b(?:don['’]t|do not) know (?:the |how many|how much)|\b(?:counts?|quantities)\b.*\b(?:unknown|not sure|not counted)\b/i.test(clause);
            if (countUnknown && (inventoryQuestion || sameTurnInventory)) {
                const groups = [...state.entries()].filter(([, value]) => value.category === 'inventory'
                    && value.status === 'asserted' && !value.quantity
                    && (has(clause, value.value) || /\b(?:those|them|these)\b/i.test(clause)
                        && value.evidence.some(source => source.turn === index)));
                if (!groups.length) addUnknown(clause, index);
                for (const [owner, item] of groups) {
                    const key = `count-unknown:${owner}`;
                    unknownCountOwners.set(key, owner);
                    state.set(key, fact('question', clean(clause), index, clause, { status: 'unknown', scope: item.value,
                        location: item.location, evidence: currentFieldEvidence(item, { turn: index, quote: clause }, [item.value]) }));
                }
                captured = true;
            }
            const disqualifiedInventory = /\b(?:questions?|concerns?)\s+(?:about|regarding|on)\b/i.test(clause)
                || countUnknown
                || serviceCommand
                || /\b(?:I|we)(?:['’]m|\s+am|['’]re|\s+are)\s+(?:an?\s+)?[^.!?]{0,50}\b(?:maker|builder|seller|dealer|designer|repairer)\b/i.test(clause);
            let list = actionObject || routeInventory || (inventoryCue ? clause.slice((inventoryCue.index ?? 0) + inventoryCue[0].length)
                : inventoryQuestion && !/\b(?:has|is|are|please|careful|broken|cracked)\b/i.test(clause)
                    && !/^(?:I|we|my|our|it|they|he|she|you|yes|no|thanks|thank you)\b/i.test(clause) ? clause : '');
            // A contents question does not turn a volunteered date/access
            // answer into an object. Explicit possession still uses the
            // existing item parser; a changed topic keeps its own capture.
            if (contentsQuestion && !inventoryCue && (
                ![...clause.matchAll(ITEMS)].length && [TIMING, ACCESS, PROPERTY].some(pattern => [...clause.matchAll(pattern)].length)
                || /^(?:bye(?: bye)?|goodbye|take care|okay|ok|sure|all right|that(?:['’]s| is) (?:all|it))[.!?]*$/i.test(clause)
            )) list = '';
            if (/^[‘“"']/.test(list)) list = list.match(/^[‘“"']([\s\S]*?)[’”"'](?=$|[\s.,;!?])/)?.[1] ?? list;
            const declaredSuffix = !list && clause.match(/^\s*(.+?)\s+(?:(?:is|are)\s+(?:(?:definitely|still)\s+)?coming|(?:is|are) on (?:the |our |my )?move list)\b/i);
            if (declaredSuffix) list = declaredSuffix[1];
            // "20-25 boxes" is a counted object, not a numeric date. Keep
            // calendar-only answers excluded; slash dates cannot be quantities.
            const initialQuantity = list.match(QUANTITY);
            const startsCountedItem = initialQuantity
                && new RegExp(`^${ITEMS.source}`, 'i').test(list.slice(initialQuantity[0].length));
            // A schedule, route, or property answer is not an owned object,
            // even when introduced by the otherwise valid "I'm moving" cue.
            if (list && (/^(?:(?:in|on|by|at|around|during)\s+)?(?:(?:(?:early|late)\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)|(?:next|this)\s+(?:week|month|weekend|year)|tomorrow|today)\b/i.test(list)
                || new RegExp(`^(?:(?:in|on|by|at|around|during)\\s+)?(?:the\\s+)?(?:${TIMING.source})`, 'i').test(list)
                || /^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(list) && !startsCountedItem)) list = '';
            const pieces = list ? inventoryListPieces(list) : [clause];
            for (const piece of pieces) {
                if (disqualifiedInventory) continue;
                if (actionObject && /^(?:it|them|those|these|that|something|anything|everything|all)$/i.test(clean(actionObject))) {
                    addUnknown(clause, index); captured = true; continue;
                }
                let candidates: Array<{ value: string; quantity: string; position: number }> = [];
                if (list && !/\b(?:phone|email|contact|details|name|packing|unpacking|stairs|elevator|bedrooms?|route|map|stop|storage unit|donation center|children|kids|family|questions?|concerns?|appointment|booking|no idea|not decided)\b/i.test(piece)
                    && !new RegExp(`^(?:not|instead of)\\s+${COUNT}[.!?]*$`, 'i').test(piece)) {
                    const segment = clean(piece).replace(/^(?:and|also|plus)\s+/i, '')
                        .replace(/^(?:maybe|perhaps|possibly)\s+/i, '')
                        .replace(status === 'removed' ? /^any\s+/i : /$^/, '')
                        .replace(/^(?:no(?! more than)|not any|none of the|the)\s+/i, '')
                        .replace(/\s+(?:from|off)\s+(?:the |my |our )?(?:move(?: list)?|inventory|list)$/i, '')
                        .replace(/\s+(?:to move|to add|on (?:the |our |my )?move list|after all|now)$/i, '')
                        .split(/\s+(?:at|from|in)\s+(?:(?:the|my|our)\s+)?(?:(?:origin|pick[ -]?up|destination|delivery|additional stop|extra stop|bedroom|living room|dining room|garage|basement|attic|kitchen|den|study|workshop)\b|\d)/i)[0];
                    const count = segment.match(QUANTITY);
                    const value = clean(segment.slice(count?.[0].length ?? 0));
                    if (value && value.length <= 360 && !/^(?:yes|no|nothing|none|not sure|don't know|do not know)$/i.test(value)) {
                        candidates = [{ value, quantity: countAction?.[2] ?? count?.[1] ?? '', position: piece.indexOf(value) }];
                    }
                }
                const existingReference = [...state.values()].some(value => value.category === 'inventory' && has(piece, value.value));
                const inventoryPredicate = /\b(?:I|we)\b.*\b(?:have|own|moving|taking|move|take|said)\b|\b(?:remove|delete|exclude|skip|cancel|keep|reinstate|add back|put\b.*\bback|make that|coming|staying)\b/i.test(piece);
                if (!candidates.length && (list || inventoryPredicate || existingReference)) candidates = [...piece.matchAll(ITEMS)].map(match => {
                    const prefix = piece.slice(0, match.index);
                    const count = prefix.match(new RegExp(`((?:(?:about|around|roughly|approximately)\\s+)?${NUM}(?:\\s*(?:to|[-–—])\\s*${NUM})?|an?|some|several)\\s+$`, 'i'));
                    return { value: match[0], quantity: count?.[1] ?? '', position: match.index };
                });
                // Previously grounded arbitrary descriptors can be removed or
                // reinstated without adding their nouns to a vocabulary list.
                if (/\b(?:remove|delete|exclude|skip|cancel|keep|reinstate|add back)\b/i.test(piece)) {
                    for (const previous of state.values()) {
                        if (previous.category === 'inventory' && has(piece, previous.value)
                            && !candidates.some(candidate => fold(candidate.value) === fold(previous.value))) {
                            candidates.push({ value: previous.value, quantity: '', position: fold(piece).indexOf(fold(previous.value)) });
                        }
                    }
                }
                candidates = candidates.filter(item => !candidates.some(other => other !== item && other.position <= item.position
                    && other.position + other.value.length >= item.position + item.value.length && other.value.length > item.value.length));
                for (const item of candidates) {
                    if (/\b(?:I|we)\s+(?:pack|will pack|am packing|are packing)\b/i.test(piece) && !/\b(?:move|moving|have|include)\b/i.test(piece)) continue;
                    // A service request refers to belongings; it does not
                    // declare them again at an unspecified location. Preserve
                    // the original item, quantity and location even when two
                    // locations have the same item (no guessed ownership).
                    // Explicit inventory additions/corrections stay on their
                    // ordinary path, and service capture continues below.
                    const serviceReference = !inventoryCue && !actionObject && !declaredSuffix
                        && /\b(?:disassembl(?:e|y|ing)|tak(?:e|ing) apart|reassembly)\b/i.test(piece)
                        && !/\b(?:another|additional|extra|second|other)\b/i.test(piece);
                    if (serviceReference && [...state.values()].some(previous => previous.category === 'inventory'
                        && (itemReferent(previous.value) === itemReferent(item.value)
                            || itemReferent(previous.value).endsWith(` ${itemReferent(item.value)}`)))) {
                        captured = true;
                        continue;
                    }
                    let itemScope = scopeFor(piece) || scope;
                    let itemLocation = locationFor(piece) !== 'unspecified' ? locationFor(piece) : location;
                    let normalized = itemIdentity(item.value);
                    // A definite later reference can resolve this narrow ASR
                    // confusion, but never merge explicit extra beds or locations.
                    if (/^queen(?:[- ]size)? bed$/i.test(item.value)
                        && /\b(?:the|that|my|our)\s+queen(?:[- ]size)? bed\b/i.test(piece)
                        && !/\b(?:another|additional|second|other|also have)\b/i.test(piece)) {
                        const beds = [...state.entries()].filter(([, value]) => value.category === 'inventory'
                            && value.status === 'asserted' && /\bbed$/i.test(value.value));
                        if (beds.length === 1 && /^(?:a\s+)?clean(?:[- ]size)? bed$/i.test(beds[0][1].value)
                            && (!beds[0][1].quantity || /^(?:a|one|1)$/i.test(beds[0][1].quantity))
                            && beds[0][1].location === itemLocation && beds[0][1].scope === itemScope) {
                            state.delete(beds[0][0]);
                        }
                    }
                    if (actionObject || declaredSuffix || /\b(?:remove|delete|exclude|skip|cancel|keep|reinstate|add back|correction|actually|make that|change)\b/i.test(clause)) {
                        const referents = [...state.values()].filter(value => value.category === 'inventory'
                            && (itemReferent(value.value) === itemReferent(item.value) || itemReferent(value.value).endsWith(` ${itemReferent(item.value)}`))
                            && (!itemScope || fold(value.scope) === fold(itemScope))
                            && (itemLocation === 'unspecified' || value.location === itemLocation));
                        if (referents.length === 1) {
                            itemScope = referents[0].scope; itemLocation = referents[0].location;
                            normalized = itemIdentity(referents[0].value);
                        }
                        else if (referents.length > 1) { addUnknown(clause, index); captured = true; continue; }
                        else if (countAction) { addUnknown(clause, index); captured = true; continue; }
                    }
                    const aliasKey = JSON.stringify([itemLocation, fold(itemScope), normalized]);
                    const stableValue = inventoryAliases.get(aliasKey) ?? item.value;
                    inventoryAliases.set(aliasKey, stableValue);
                    const old = state.get(`inventory:${aliasKey}`);
                    // An unscoped additional amount is not a replacement total.
                    // Keep it for review rather than silently overwriting the
                    // original group or inventing an aggregate quantity.
                    if (/\bmore$/i.test(item.quantity) && (old || !itemScope)) {
                        addUnknown(clause, index); captured = true; continue;
                    }
                    const listPrefix = list ? clause.slice(0, Math.max(0, clause.indexOf(list))) : '';
                    // Polarity inside one list item must not leak to a sibling.
                    // The declaration prefix carries global modal/negative intent.
                    const itemStatus = removeAction ? 'removed' : restoreAction || countAction ? 'asserted'
                        : list ? statusFor(listPrefix + piece, listPrefix.length + item.position)
                            : statusFor(clause, clause.indexOf(piece) + item.position);
                    const quantity = item.quantity || old?.quantity || '';
                    put(`inventory:${aliasKey}`, fact('inventory', stableValue, index, clause, {
                        quantity: itemStatus === 'removed' ? old?.quantity ?? item.quantity : quantity,
                        location: itemLocation, scope: itemScope, status: itemStatus,
                        evidence: currentFieldEvidence(old, { turn: index, quote: clause }, [stableValue, quantity, itemScope]),
                    }));
                    captured = true;
                }
            }

            // Caller-supplied handling observations belong to an existing item,
            // not a new item count or a requested service. Resolve an explicit
            // subject uniquely; pronouns only inherit the immediately preceding
            // clause in this same user utterance, never an agent's assumption.
            const subject = clause.match(/^(?:(?:actually|correction)[, ]+)?(?:the|that|this|my|our)\s+(.+?)\s+(?:has|have|is|are|needs?|must)\b/i)?.[1];
            const owned = [...state.values()].filter(value => value.category === 'inventory' && value.status === 'asserted');
            const mentionedHere = owned.filter(value => value.evidence.some(source => source.turn === index && source.quote === clause));
            const subjectItem = inventorySubject(clause, owned);
            const sameClauseItem = mentionedHere.length === 1 ? mentionedHere[0] : null;
            const pronoun = /^(?:it\b|it['’]s\b|that one\b|the same one\b)/i.test(clause);
            const detailItem: EvanCaptureFact | null = pronoun ? handlingFocus ?? sameClauseItem : subject ? subjectItem : sameClauseItem;
            const handling = /\b(?:careful|protect|fragile|cracked|broken|damaged|repaired|fixed)\b|\b(?:legs?|lid|doors?)\b.*\b(?:do not|don['’]t|cannot|can['’]t|can|does not|doesn['’]t)\s+(?:come off|be removed|open|close)\b/i.test(clause);
            const dimension = new RegExp(`\\b${NUM}\\s+(?:inches|inch|feet|foot|cm|centimeters|metres|meters)\\s+(wide|tall|high|long|deep)\\b`, 'i').exec(clause);
            const material = /\b(?:made of|solid)\s+[\p{L}-]+/iu.test(clause);
            const drawers = new RegExp(`\\b${NUM}\\s+drawers?\\b`, 'i').test(clause);
            if (detailItem && (handling || dimension || material || drawers) && clause.length <= 360) {
                // Ambiguous identical item descriptions in different rooms need
                // clarification; the record must not attach care to both.
                const identical = owned.filter(value => itemReferent(value.value) === itemReferent(detailItem.value));
                if (identical.length === 1) {
                    const part = clause.match(/\b(?:lid|legs?|doors?)\b/i)?.[0]
                        ?? dimension?.[1] ?? (material ? 'material' : drawers ? 'drawers' : 'general');
                    const key = `item-care:${detailItem.location}:${fold(detailItem.scope)}:${itemIdentity(detailItem.value)}:${itemIdentity(part)}`;
                    const owner = [...state.entries()].find(([, candidate]) => candidate === detailItem)?.[0];
                    if (owner) handlingOwners.set(key, owner);
                    // The item already owns its quantity. A plain "I have four
                    // fragile dishes" declaration contributes only fragility
                    // here, so a later count correction cannot leave a stale
                    // duplicate count in the care note or recap emails.
                    const descriptorOnly = list && sameClauseItem === detailItem
                        && /\bfragile\b/i.test(detailItem.value)
                        && !/\b(?:careful|protect|cracked|broken|damaged|repaired|fixed|legs?|lid|doors?)\b/i.test(clause)
                        && !dimension && !material && !drawers;
                    const value = descriptorOnly ? clause.match(/\bfragile\b/i)![0] : clean(clause);
                    state.set(key, fact('care', value, index, clause, { scope: detailItem.value, location: detailItem.location,
                        status: /\b(?:maybe|might|possibly|perhaps|not sure|unsure)\b/i.test(clause) ? 'unknown' : 'asserted',
                        evidence: currentFieldEvidence(detailItem, { turn: index, quote: clause }, [detailItem.value, value]) }));
                    captured = true;
                } else { addUnknown(clause, index); captured = true; }
            }
            handlingFocus = subjectItem ?? sameClauseItem ?? (pronoun && detailItem ? detailItem : null);

            const selfPacking = /\b(?:I|we)(?:['’](?:ll|m|re)|\s+will|\s+am|\s+are|\s+can)?\s+(?:pack|packing|(?:handle|handling|do|doing|manage|managing|take care of|taking care of)\s+(?:(?:all|most|some|the|our|my|of)\s+)*packing)\b|\b(?:pack|packing)\b.*\b(?:myself|ourselves)\b/i.test(clause);
            const packingObject = clean(clause.match(/\bpack(?:ing)?\s+(?:the\s+)?(.+?)(?=\s+(?:myself|ourselves)\b|[.!?;]|$)/i)?.[1] ?? '');
            const packingScope = scope || (/^(?:everything|all|all of it|it|myself|ourselves|help|support|assistance)$/i.test(packingObject) ? '' : packingObject);
            const packingKey = `packing:${selfPacking ? 'customer' : 'crew'}:${location}:${fold(packingScope)}`;
            if (selfPacking && clause.length <= 360) {
                put(packingKey, fact('packing', clean(clause), index, clause, { status, location, scope: packingScope }));
                if (status === 'asserted' && !/\b(?:some|most|part|half)\b/i.test(clause)) {
                    for (const [key, previous] of state) {
                        if (previous.category === 'service' && /\bpacking\b/i.test(previous.value)
                            && previous.location === location && (!packingScope || previous.scope === packingScope)) {
                            state.set(key, { ...previous, status: 'removed', evidence: [...previous.evidence.slice(0, 1), { turn: index, quote: clause }] });
                        }
                        if (!packingScope && key.startsWith(`packing:crew:${location}:`)) state.delete(key);
                    }
                }
                captured = true;
            }
            const requestedPacking = /\b(?:need|want|request|help|please)\b.*\b(?:pack|packing)\b/i.test(clause) && !selfPacking;
            if (requestedPacking && clause.length <= 360) {
                if (/\b(?:only|actually|instead|correction)\b/i.test(clause)) {
                    for (const key of state.keys()) if (key.startsWith(`packing:crew:${location}:`)) state.delete(key);
                }
                put(packingKey, fact('packing', clean(clause), index, clause, { status, location, scope: packingScope }));
                captured = true;
            }
            // Resolve 'reassembly for both' only against exactly two explicit,
            // immediately preceding visitor disassembly requests acknowledged by
            // the agent. Both scopes remain grounded in the visitor's words.
            const pairedReassembly = /^(?:(?:yes|yeah|sure|please)[,!.\s]+)?(?:(?:I|we)\s+(?:need|want|would like)\s+)?reassembly\s+for\s+both(?:\s+(?:of\s+them|items|pieces))?(?:\s+at\s+(?:(?:the|my|our)\s+(?:new\s+)?|new\s+)(?:house|home|destination))?[.!\s]*$/i.test(clause)
                && turns[index - 1]?.role === 'agent' && turns[index - 2]?.role === 'user'
                && /\b(?:disassembl(?:e|y|ing)|tak(?:e|ing) apart)\b/i.test(turns[index - 1].content);
            const priorDisassembly = pairedReassembly ? [...state.entries()].filter(([key, value]) => key.startsWith('confirmed-disassembly:')
                && value.status === 'asserted' && value.evidence.at(-1)?.turn === index - 2) : [];
            const resolvedReassembly = priorDisassembly.length === 2 && priorDisassembly.every(([, value]) => has(turns[index - 1].content, value.scope));
            if (resolvedReassembly) {
                for (const [, prior] of priorDisassembly) {
                    state.set(`confirmed-reassembly:${fold(prior.scope)}`, fact('service', 'reassembly', index, clause, {
                        scope: prior.scope, evidence: [prior.evidence[0], { turn: index, quote: clause }],
                    }));
                }
                captured = true;
            }
            for (const [category, pattern] of [['service', SERVICES], ['access', ACCESS], ['care', CARE]] as const) {
                for (const matched of clause.matchAll(pattern)) {
                    if (category === 'service' && /^reassembly$/i.test(matched[0]) && resolvedReassembly) continue;
                    if (category === 'access' && /\bflights?\b/i.test(matched[0]) && !/\bstairs\b/i.test(matched[0])
                        && (!/\b(?:pickup|pick-up|origin|delivery|destination|drop[- ]?off|stairs?|staircase|elevator|floor|access)\b/i.test(clause + ' ' + question)
                            || /\b(?:airport|airline|airplane|plane|fly|flying)\b/i.test(clause))) continue;
                    if (category === 'service' && selfPacking && /\bpacking\b/i.test(matched[0])) continue;
                    if (category === 'service' && /^(?:storage|donation)$/i.test(matched[0]) && /\bstop\b/i.test(clause)) continue;
                    if (category === 'service' && !/\b(?:need|want|request|please|add|include|help|support|assistance|remove|cancel|skip|no|without|not|maybe|might|may)\b/i.test(clause)
                        && !/\b(?:services?|help|packing|unpacking|loading)\b/i.test(question)) continue;
                    // A single turn can describe both buildings. Bind each
                    // access fact to its own source clause, not the whole turn.
                    const accessParts = category === 'access' ? buildingDetailParts(clause) : [];
                    const accessPart = accessParts.find(part => matched.index >= part.index && matched.index < part.index + part.text.length);
                    const hasInventorySibling = accessParts.some(part => part !== accessPart && [...state.values()].some(item =>
                        item.category === 'inventory' && item.evidence.some(source => source.turn === index && source.quote === clause)
                        && has(part.text, item.value)));
                    const localAccess = (accessParts.filter(part => [...part.text.matchAll(ACCESS)].length).length > 1 || hasInventorySibling) && accessPart
                        ? accessPart.text : clause;
                    // Ignore only an unfinished modal fragment followed by a
                    // fresh declarative restart. Never erase a completed hedge
                    // such as "might be", "might need" or "not sure".
                    const context = category === 'access' ? localAccess.replace(
                        /^(?:one|I|we|there)\s+(?:might|may|could)\s*[,—-]?\s*(?:(?:uh|um|sorry)[,\s]+)*(?=there(?:['’]s|\s+(?:is|are))\b)/i, '') : clause;
                    // A conjunct such as "and there are stairs" can retain the
                    // endpoint from this sentence. A direct building anaphor
                    // can also use the immediately preceding building clause.
                    // Explicit local labels always take priority.
                    const sentencePrefix = turn.content.slice(0, clauseStart).split(/[.!?;]/).at(-1) ?? '';
                    const inheritedLocation = category === 'access' && /^there(?:['’]s|\s+(?:is|are))\b/i.test(clause)
                        ? buildingLocationFor(sentencePrefix) : 'unspecified';
                    const anaphorApplies = category === 'access' && buildingAnaphor && buildingLocationHint(clause) === null;
                    const localLocation = category === 'access' ? anaphorApplies ? buildingAnaphor.location
                        : accessLocationFor(clause, matched.index, question) : location;
                    const factLocation = localLocation !== 'unspecified' ? localLocation : inheritedLocation;
                    const currentStatus = category === 'access' && /\b(?:not sure|unsure)\b/i.test(context)
                        ? 'unknown' : statusFor(context, context.indexOf(matched[0]));
                    if (category === 'service' && /^reassembly$/i.test(matched[0]) && currentStatus === 'removed') {
                        const targets = [...clause.matchAll(ITEMS)].map(item => item[0]);
                        for (const [key, prior] of state) {
                            if (key.startsWith('confirmed-reassembly:') && (!targets.length
                                || targets.some(target => has(prior.scope, target) || has(target, prior.scope)))) {
                                state.set(key, { ...prior, status: 'removed', evidence: [prior.evidence[0], { turn: index, quote: clause }] });
                            }
                        }
                    }
                    if (category === 'service' && /^(?:disassembl|tak(?:e|ing) apart)/i.test(matched[0])) {
                        const tail = clause.slice(matched.index + matched[0].length);
                        const targets = [...tail.matchAll(ITEMS)].map(item => item[0]);
                        if (targets.length && !/\b(?:if|example|someone|friend|or)\b/i.test(clause)) {
                            for (const target of targets) {
                                state.set(`confirmed-disassembly:${fold(target)}`, fact('service', matched[0], index, clause,
                                    { status: currentStatus, scope: target, location }));
                            }
                            captured = true;
                            continue;
                        }
                    }
                    if (category === 'service' && /^disassembl/i.test(matched[0]) && currentStatus === 'removed') {
                        const targets = [...clause.matchAll(ITEMS)].map(item => item[0]);
                        for (const [key, prior] of state) {
                            if (key.startsWith('confirmed-disassembly:') && (!targets.length
                                || targets.some(target => has(prior.scope, target) || has(target, prior.scope)))) state.delete(key);
                        }
                    }
                    const identity = category === 'service' && /^packing\b/i.test(matched[0]) ? 'packing'
                        : category === 'access' && /\bflights?\b/i.test(matched[0]) ? 'stair'
                        : fold(matched[0]).replace(category === 'access' ? /^no\s+/ : /$^/, '').replace(/s$/, '');
                    const key = `${category}:${factLocation}:${fold(scope)}:${identity}`;
                    const flights = category === 'access' && /^(?:stairs?|staircase)$/i.test(matched[0])
                        ? context.slice(0, context.indexOf(matched[0])).match(new RegExp(`(${NUM}\\s+flights?\\s+of\\s+)$`, 'i'))?.[0] ?? '' : '';
                    const value = category === 'access' && /\b(?:must|require|required|reserve|reserved|reservation|only|before|after|between)\b/i.test(context)
                        && context.length <= 360 ? clean(context) : flights + matched[0];
                    const accessQuote = inheritedLocation !== 'unspecified' && location === 'unspecified' && localLocation === 'unspecified'
                        ? sentencePrefix + clause : clause;
                    const next = fact(category, value, index, accessQuote, { status: currentStatus, location: factLocation, scope });
                    if (anaphorApplies) next.evidence = [{ turn: index, quote: buildingAnaphor.quote }, { turn: index, quote: clause }];
                    if (category === 'access') state.set(key, next); else put(key, next);
                    captured = true;
                }
            }
            if (!/\b(?:phone|email|callback|call me|contact me)\b/i.test(clause)) {
                for (const [category, pattern] of [['timing', TIMING], ['property', PROPERTY]] as const) {
                    const matches = [...clause.matchAll(pattern)];
                    const specific = matches.filter(match => !matches.some(other => other !== match && other.index <= match.index
                        && other.index + other[0].length >= match.index + match[0].length && other[0].length > match[0].length));
                    for (const matched of specific) {
                        // 'Reassembly ... at the house' refers to service
                        // location, not a new third property in the brief.
                        if (category === 'property' && pairedReassembly && /^(?:house|home)$/i.test(matched[0])) continue;
                        // "2 or 3 bedroom house" does not assert three
                        // bedrooms; keep the ambiguity visible for review.
                        if (category === 'property' && new RegExp(`${NUM}\\s+or\\s*$`, 'i').test(clause.slice(0, matched.index))) {
                            state.set('property-uncertainty', fact('question', clean(clause), index, clause, { status: 'unknown' }));
                            captured = true; continue;
                        }
                        if (category === 'property' && [...state.values()].some(item => item.category === 'inventory'
                            && item.evidence.some(source => source.turn === index && source.quote === clause)
                            && [...clause.matchAll(new RegExp(escape(item.value), 'gi'))].some(span =>
                                matched.index >= span.index && matched.index + matched[0].length <= span.index + span[0].length))) continue;
                        // The modal verb "may" is not a month. A bare May
                        // needs calendar syntax or an actual date-answer form.
                        if (category === 'timing' && /^may$/i.test(matched[0])
                            && !/\b(?:in|by|around|for|during|this|next)\s*$/i.test(clause.slice(0, matched.index))
                            && !/^may[.!\s]*$/i.test(clause)) continue;
                        const propertyParts = category === 'property' ? buildingDetailParts(clause) : [];
                        const propertyPart = propertyParts.find(part => matched.index >= part.index && matched.index < part.index + part.text.length);
                        const propertyContext = propertyParts.filter(part => [...part.text.matchAll(PROPERTY)].length).length > 1 && propertyPart
                            ? propertyPart.text : clause;
                        const pairedLocation = category === 'property' ? pairedPropertyLocation(clause, specific, matched.index) : 'unspecified';
                        if (pairedLocation !== 'unspecified' && status === 'asserted') {
                            state.delete('property-uncertainty');
                            // A later explicit pair locates an earlier partial
                            // nominal ("apartment"). Remove only compatible,
                            // unlocated property facts in the same scope.
                            for (const [oldKey, old] of state) {
                                if (old.category === 'property' && old.location === 'unspecified'
                                    && fold(old.scope) === fold(scope) && has(fold(matched[0]), fold(old.value))) state.delete(oldKey);
                            }
                        }
                        const propertyAnaphor = category === 'property' && buildingAnaphor && buildingLocationHint(propertyContext) === null;
                        const factLocation = category === 'property'
                            ? pairedLocation !== 'unspecified' ? pairedLocation : propertyAnaphor ? buildingAnaphor.location
                                : buildingLocationFor(propertyContext, question) : location;
                        const key = category === 'timing' ? category : `${category}:${factLocation}:${fold(scope)}`;
                        let value = matched[0], quote = clause;
                        if (category === 'property') {
                            const unit = turn.content.slice(clauseStart + matched.index + matched[0].length)
                                .match(/^\s*,?\s*(?:unit|apt\.?|apartment|suite|#)\s+[\p{L}\p{N}-]+\b/iu)?.[0];
                            if (unit) { value += unit; quote = turn.content.slice(clauseStart + matched.index, clauseStart + matched.index + value.length); }
                        } else {
                            // Retain an explicit same-utterance date qualifier
                            // as one exact source span. Never join disconnected
                            // statements or borrow a later caller's date.
                            const dateAt = clauseStart + matched.index;
                            const tail = turn.content.slice(dateAt + matched[0].length);
                            const flexibility = tail.match(/^(?:\s+would work)?\s*,?\s*(?:and|but)\s+(?:(?:the |our |my )?(?:move )?date\s+is\s+(?:not\s+)?flexible|(?:not\s+)?flexible\s+on\s+(?:the |our |my )?(?:move )?date)\b/i)?.[0];
                            if (flexibility) { value += flexibility; quote = turn.content.slice(dateAt, dateAt + value.length); }
                        }
                        if (category === 'timing') {
                            const previousDate = state.get('timing')?.value.match(TIMING)?.[0];
                            // A changed window starts a fresh timing plan. Repeating
                            // the same window does not erase later preferences.
                            if (previousDate && fold(previousDate) !== fold(matched[0])) {
                                state.delete('timingFlexibility'); state.delete('timingPreference');
                            }
                            if (/\bflexible\b/i.test(value)) state.delete('timingFlexibility');
                        }
                        put(key, fact(category, value, index, quote, { status: statusFor(clause, matched.index), location: factLocation, scope,
                            ...(propertyAnaphor ? { evidence: [{ turn: index, quote: buildingAnaphor.quote }, { turn: index, quote }] } : {}) }));
                        captured = true;
                    }
                }
            }
            const timingContext = turn.content.slice(0, clauseStart).split(/[.!?;]/).at(-1)?.trim() || question;
            for (const preference of timingPreferences(clause, timingContext, state.get('timing')?.status === 'asserted')) {
                const base = state.get('timing');
                const alreadyInline = base?.evidence.some(source => source.turn === index)
                    && fold(base.value).includes(fold(preference.value));
                // Preserve the older exact inline representation until a later
                // correction replaces it. Do not display two opposing qualifiers.
                if (!alreadyInline && preference.category === 'timingFlexibility' && base && /\bflexible\b/i.test(base.value)) {
                    const date = base.value.match(TIMING)?.[0];
                    if (date) state.set('timing', { ...base, value: date });
                }
                if (!alreadyInline) state.set(preference.category, fact(preference.category, preference.value, index, clause, { status: preference.status }));
                captured = true;
            }
            if (!captured && /\b(?:move|moving|item|furniture|inventory|packing|unpacking|access|origin|destination|pickup|delivery|stop|stairs|elevator|have|need|want|correction|actually|not sure|don't know|do not know)\b/i.test(clause)
                && !identity.name && !identity.phone && !identity.email
                && !cityStops.some(stop => has(clause, stop.city))
                && !/\b(?:phone|email|contact|callback|name|call me|goodbye|thanks|thank you)\b/i.test(clause)) addUnknown(clause, index);
            const buildingFacts = [...state.values()].filter(value => (value.category === 'property' || value.category === 'access')
                && value.status !== 'removed' && value.evidence.some(source => source.turn === index && source.quote === clause));
            const buildingRoles = new Set(buildingFacts.map(value => value.location));
            if (buildingRoles.size === 1 && !buildingRoles.has('unspecified')) {
                previousBuildingClause = { location: buildingFacts[0].location, quote: clause };
            }
        }
    }

    const routeFacts: EvanCaptureFact[] = [];
    const routeSource = (value: string) => {
        for (let index = routeEvidence.length - 1; index >= 0; index--) {
            const source = routeEvidence[index];
            const literal = source.quote.match(new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'iu'))?.[0];
            if (literal) return { ...source, value: literal };
        }
        return null;
    };
    for (const [index, stop] of cityStops.entries()) {
        const location = stop.kind === 'Origin' ? 'origin' : stop.kind === 'Destination' ? 'destination' : 'additional';
        if ([...addressRoutes.values()].some(value => value.status !== 'removed' && value.location === location
            && (!value.route?.city || fold(value.route.city) === fold(stop.city)))) continue;
        const source = routeSource(stop.city);
        if (!source) continue;
        const purposeSource = stop.label ? routeSource(stop.label) : null;
        routeFacts.push(fact('route', source.value, source.turn, source.quote, { location,
            scope: location === 'additional' ? source.value : '',
            evidence: [source, ...(purposeSource && purposeSource.turn !== source.turn ? [purposeSource] : [])].map(({ turn, quote }) => ({ turn, quote })),
            route: { city: source.value, address: '', purpose: purposeSource?.value ?? '', order: index <= 7 ? index : null } }));
    }
    const possibleStops = buildEvanMovePlan(routeInput).possibleStops;
    for (const stop of possibleStops) {
        const source = routeSource(stop.city);
        if (source && !routeFacts.some(value => fold(value.route?.city ?? '') === fold(stop.city))) routeFacts.push(fact('route', source.value, source.turn, source.quote, {
            status: 'tentative', location: 'additional', scope: source.value,
            route: { city: source.value, address: '', purpose: '', order: null } }));
    }
    const currentState = [...state.entries()].filter(([key]) => !handlingOwners.has(key)
        || state.get(handlingOwners.get(key)!)?.status === 'asserted')
        .filter(([key]) => !unknownCountOwners.has(key) || state.get(unknownCountOwners.get(key)!)?.status === 'asserted'
            && !state.get(unknownCountOwners.get(key)!)?.quantity).map(([, value]) => value);
    return validateEvanCapture({ facts: [...currentState, ...routeFacts, ...addressRoutes.values()] }, turns, revision);
}
