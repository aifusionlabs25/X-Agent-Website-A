import { applyEvanRouteTurn, buildEvanMovePlan } from './evan-move-planner.ts';
import type { MovePlanStop } from './evan-move-planner.ts';
import { buildEvanPlannerContact } from './evan-planner-contact.ts';
import { evanContactOffer, extractEvanContactIdentity, extractEvanContactIntent } from './evan-contact-identity.ts';
import { EvanCaptureValidationError, validateEvanCapture } from './evan-capture.ts';
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
const SERVICES = /\b(?:full[- ]service packing|full packing|packing(?:\s+(?:help|support|assistance))?|unpacking|labor[- ]only|loading(?:\s+help)?|unloading(?:\s+help)?|disassembl(?:e|y|ing)|reassembly|storage|donation|commercial move|office move|senior move|long[- ]distance|out of state)\b/gi;
const ACCESS = /\b(?:narrow driveway|no stairs?|stairs?|staircase|no elevator|elevator|loading (?:bay|dock)|loading window|gate code|gated|parking|move[- ]in hours|permitted hours|facility hours|HOA|(?:ground|first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)) floor)\b/gi;
const CARE = /\b(?:walker|wheelchair|mobility|elderly|senior|stress(?:ed|ful)?|chaotic|finish time|time sensitive|urgent|multiple destinations?|several stops?|fragile)\b/gi;
const PROPERTY = /\b(?:(?:one|two|three|four|five|six|\d+)[ -](?:bedrooms?|beds?)(?:\s+(?:apartment|condo|home|house|townhouse|townhome))?|studio(?: apartment)?|single[- ]family home|apartment|condo|townhouse|townhome|house|office|commercial space)\b/gi;
const TIMING = /\b(?:(?:early|mid[- ]?|late|beginning of|middle of|end of|(?:first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th) week (?:of|in))\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{1,2}(?:st|nd|rd|th)?)?\b|\b(?:next|this) (?:week|month|weekend)\b|\b(?:within (?:the next )?\d+ days?|less than \d+ days?|(?:one|two|three|four|five|six|seven|eight|nine|ten) weeks?|mid[- ]month|(?:the )?middle of (?:(?:this|next|the) )?month)\b/gi;
const ADDRESS = /\b\d{1,6}\s+[\p{L}\p{N}.'’ -]{1,70}?\s+(?:Street|St|Road|Rd|Lane|Ln|Drive|Dr|Avenue|Ave|Way|Court|Ct|Boulevard|Blvd|Place|Pl|Circle|Cir)(?:\s+(?:apt|unit|suite|#)\s*[\p{L}\p{N}-]+)?\b/giu;

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
        const count = segment.match(QUANTITY);
        const prefix = count?.[0] ?? '';
        const rest = segment.slice(prefix.length);
        const pieces = rest.split(/\s+and\s+/i);
        pieces[0] = prefix + pieces[0];
        // An explicitly declared, unpunctuated list may introduce each next
        // item with a fresh count. Range prefixes above stay indivisible.
        return pieces.flatMap(piece => {
            const leading = piece.match(QUANTITY)?.[0] ?? '';
            const separated = piece.slice(leading.length).split(new RegExp(`(?<!\\babout|\\baround|\\broughly|\\bapproximately)\\s+(?=(?:(?:about|around|roughly|approximately)\\s+)?${NUM}\\s+)(?!$)`, 'i'));
            separated[0] = leading + separated[0];
            return separated;
        });
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
    return match(text) !== 'unspecified' ? match(text) : match(question);
}

function scopeFor(text: string): string {
    const addresses = [...text.matchAll(ADDRESS)];
    if (addresses.length === 1) return addresses[0][0];
    return text.match(/\b(?:in|from|at)\s+(?:the\s+)?(bedroom|living room|dining room|garage|basement|attic|kitchen|den|study|workshop)\b/i)?.[1] ?? '';
}

// Property answers often depend on "moving from" / "moving to" in the
// immediately preceding question. Keep that context local to property facts.
function propertyLocationFor(text: string, question: string): EvanCaptureFact['location'] {
    const resolve = (source: string): EvanCaptureFact['location'] => {
        const origin = /\b(?:origin|pick[ -]?up|mov(?:e|ing)\s+(?:from|out\s+of)|current\s+(?:home|house|apartment))\b|^\s*(?:from|out\s+of)\b/i.test(source);
        const destination = /\b(?:destination|delivery|drop[- ]?off|mov(?:e|ing)\s+(?:in)?to|new\s+(?:home|house|apartment))\b|^\s*(?:in)?to\b/i.test(source);
        return origin && destination ? 'unspecified' : origin ? 'origin' : destination ? 'destination' : locationFor(source);
    };
    const explicit = resolve(text);
    return explicit !== 'unspecified' ? explicit : resolve(question);
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
        const properties = [...part.text.matchAll(PROPERTY)].filter(detail => {
            // A property noun can be part of an object name (office partitions,
            // doll house). Only classify the whole nominal as a building, or
            // use explicit building grammar; do not require a known item noun.
            const remainder = clean(part.text.slice(0, detail.index) + ' ' + part.text.slice(detail.index + detail[0].length))
                .replace(/\s*\bat\s+(?:the\s+)?(?:origin|pick[ -]?up|destination|delivery|drop[- ]?off)$/i, '').trim();
            return !remainder || new RegExp(`^${COUNT}$`, 'i').test(remainder)
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
    return text.split(/(?<=[.!?;])\s+|\s+but\s+|,\s*(?=(?:then\s+)?(?:storage|donation|finish|end|destination|origin)\b)|,?\s+and\s+(?=(?:i|we|there|finish|end|change|update|correct|remove|delete|keep|include|add|the (?:origin|destination)|at (?:the )?(?:origin|destination))\b)/i)
        // Separate explicit sequential street stops without detaching a shared
        // tentative/negative prefix and accidentally confirming its sibling.
        .flatMap(value => statusFor(value) === 'asserted' && [...value.matchAll(ADDRESS)].length > 1
            ? value.split(/,\s*(?=then\s+(?:at|to)\b)/i) : [value])
        .map(value => value.trim()).filter(Boolean);
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

/** Recompute the bounded session snapshot locally. Every value and qualifier is
 * backed by a contiguous original visitor span and revalidated at the boundary. */
export function buildDeterministicEvanCapture(turns: EvanCaptureTurn[], revision: number): EvanCaptureRecord {
    if (!Array.isArray(turns) || turns.length > 400 || turns.some(turn => !turn || !['user', 'agent'].includes(turn.role)
        || typeof turn.content !== 'string' || !turn.content.trim() || turn.content.length > 2_000)
        || turns.reduce((size, turn) => size + turn.content.length, 0) > 80_000) throw new EvanCaptureValidationError();
    const state = new Map<string, EvanCaptureFact>();
    const inventoryAliases = new Map<string, string>();
    const handlingOwners = new Map<string, string>();
    const unknownCountOwners = new Map<string, string>();
    const contactEvidence = new Map<string, EvanCaptureFact>();
    let previousQuestion = '', offeredContact = false;
    let cityStops: MovePlanStop[] = [];
    const addressRoutes = new Map<string, EvanCaptureFact>();
    const routeEvidence: Array<{ turn: number; quote: string }> = [];
    const routeInput: EvanCaptureTurn[] = [];
    let previousContact = buildEvanPlannerContact([]);
    const put = (key: string, next: EvanCaptureFact) => {
        const old = state.get(key);
        if (old && old.value !== next.value && !['name', 'phone', 'email', 'timing', 'property', 'packing', 'contactPreference', 'callbackWindow'].includes(next.category)) {
            next = { ...next, value: old.value, evidence: [...old.evidence.slice(0, 1), ...next.evidence].slice(-8) };
        }
        state.set(key, next);
    };
    const addUnknown = (text: string, turn: number) => {
        // Keep a source excerpt visible for review instead of calling an
        // unsupported meaningful statement a successfully understood fact.
        const value = clean(text).slice(0, 360);
        // Identical unresolved statements are one current uncertainty, not one
        // fact per repetition. Keep the latest exact wording and provenance.
        if (value) state.set(`unknown:${fold(clean(text))}`, fact('question', value, turn, text, { status: 'unknown' }));
    };

    for (const [index, turn] of turns.entries()) {
        if (turn.role === 'agent') { previousQuestion = turn.content; offeredContact = false; continue; }
        const question = previousQuestion;
        previousQuestion = '';
        const identity = extractEvanContactIdentity(turn.content, question, offeredContact);
        offeredContact = evanContactOffer(turn.content);
        for (const category of ['name', 'phone', 'email'] as const) {
            const candidate = identity[category];
            if (candidate) contactEvidence.set(`${category}:${fold(candidate.value)}`, fact(category, candidate.value, index, candidate.quote));
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

        const quotedRanges = untrustedQuoteRanges(turn.content);
        let clauseOffset = 0;
        let pendingInventoryMention: { value: string; quote: string } | null = null;
        let pendingRouteUncertainty = false;
        let handlingFocus: EvanCaptureFact | null = null;
        for (const clause of clausesFor(turn.content)) {
            const clauseStart = turn.content.indexOf(clause, clauseOffset);
            clauseOffset = clauseStart + clause.length;
            if (quotedRanges.some(([start, end]) => clauseStart >= start && clauseStart < end)) { handlingFocus = null; continue; }
            const hypothetical = /^\s*(?:what if|suppose|hypothetically|for example|imagine|if\s+(?:i|we)\s+(?:had|bought|owned|were|could|(?:do\s+)?have))\b/i.test(clause)
                || /\b(?:sample|example)\b.*\b(?:not my|not our|only|form)\b/i.test(clause);
            const asking = /\?\s*$/.test(clause) || /^(?:do you|does mullins|can you|could you|would you|how|what|is there|are there)\b/i.test(clause);
            if (hypothetical) { handlingFocus = null; addUnknown(clause, index); continue; }
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

            const inventoryQuestion = /\b(?:what|which|list|describe|anything|anything else|how many|how much)\b.*\b(?:items|furniture|inventory|move list|moving|taking|comes|coming|boxes|pieces)\b/i.test(question);
            const sameTurnInventory = [...state.values()].some(value => value.category === 'inventory'
                && value.evidence.some(source => source.turn === index));
            const continuationCue = (inventoryQuestion || sameTurnInventory || /\bto add[.!?]*$/i.test(clause))
                ? clause.match(/^there(?:['’]s|\s+(?:is|are))(?:\s+also)?\s+/i) : null;
            const removeAction = clause.match(/^(?:(?:actually|correction)[, ]+)?(?:please\s+)?take\s+(?:(?:the|that)\s+)?(.+?)\s+(?:off|out of)\s+(?:the |my |our )?(?:move list|inventory|list|move)[.!?]*$/i);
            const restoreAction = clause.match(/^(?:(?:actually|correction)[, ]+)?(?:please\s+)?put\s+(?:(?:the|that)\s+)?(.+?)\s+back(?:\s+on\s+(?:the |my |our )?(?:move list|inventory|list|move))?(?:\s+after all)?[.!?]*$/i);
            const countAction = clause.match(new RegExp(`^(?:(?:actually|correction)[, ]+)?(?:please\\s+)?(?:change|update|correct)\\s+(?:the\\s+)?(.+?)\\s+to\\s+(${COUNT})[.!?]*$`, 'i'));
            const actionObject = removeAction?.[1] ?? restoreAction?.[1] ?? countAction?.[1] ?? '';
            const inventoryCue = clause.match(/\b(?:items|inventory|furniture|move list)(?:\s+(?:includes?|are|is|consists of)\b|\s*:)\s*/i)
                ?? clause.match(/\b(?:I|we)(?:['’](?:m|re|ll)|\s+(?:am|are|will|might|may|could))?\s+(?:(?:only|definitely|just|also)\s+)*(?:(?:do(?:\s+not)?|don['’]t)\s+)?(?:(?:only|definitely|just|also)\s+)*(?:have|own|need to move|want to move|moving|move|taking|take|bringing|bring)\s+(?!from\b|(?:in)?to\b|out\s+of\b)/i)
                ?? clause.match(/^(?:(?:actually|correction)[, ]+)?(?:(?:please|maybe|possibly|perhaps)\s+)?(?:add(?: back)?|include|keep|remove|exclude|delete|skip|reinstate|make that)\s+(?:the\s+)?/i)
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
                || /\b(?:I|we)(?:['’]m|\s+am|['’]re|\s+are)\s+(?:an?\s+)?[^.!?]{0,50}\b(?:maker|builder|seller|dealer|designer|repairer)\b/i.test(clause);
            let list = actionObject || routeInventory || (inventoryCue ? clause.slice((inventoryCue.index ?? 0) + inventoryCue[0].length)
                : inventoryQuestion && !/\b(?:has|is|are|please|careful|broken|cracked)\b/i.test(clause)
                    && !/^(?:I|we|my|our|it|they|he|she|you|yes|no|thanks|thank you)\b/i.test(clause) ? clause : '');
            if (/^[‘“"']/.test(list)) list = list.match(/^[‘“"']([\s\S]*?)[’”"'](?=$|[\s.,;!?])/)?.[1] ?? list;
            const declaredSuffix = !list && clause.match(/^\s*(.+?)\s+(?:(?:is|are)\s+(?:(?:definitely|still)\s+)?coming|(?:is|are) on (?:the |our |my )?move list)\b/i);
            if (declaredSuffix) list = declaredSuffix[1];
            // A schedule, route, or property answer is not an owned object,
            // even when introduced by the otherwise valid "I'm moving" cue.
            if (list && (/^(?:(?:in|on|by|at|around|during)\s+)?(?:(?:(?:early|late)\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)|(?:next|this)\s+(?:week|month|weekend|year)|tomorrow|today)\b/i.test(list)
                || /^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(list))) list = '';
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
                    let itemScope = scopeFor(piece) || scope;
                    let itemLocation = locationFor(piece, question) !== 'unspecified' ? locationFor(piece, question) : location;
                    let normalized = itemIdentity(item.value);
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
            for (const [category, pattern] of [['service', SERVICES], ['access', ACCESS], ['care', CARE]] as const) {
                for (const matched of clause.matchAll(pattern)) {
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
                    const context = category === 'access' ? localAccess : clause;
                    const localLocation = locationFor(context);
                    // A conjunct such as "and there are stairs" can retain the
                    // endpoint from this sentence, but never a previous sentence
                    // or another turn. Explicit local labels always take priority.
                    const sentencePrefix = turn.content.slice(0, clauseStart).split(/[.!?;]/).at(-1) ?? '';
                    const inheritedLocation = category === 'access' && /^there(?:['’]s|\s+(?:is|are))\b/i.test(clause)
                        ? locationFor(sentencePrefix) : 'unspecified';
                    const factLocation = category === 'access' && localLocation !== 'unspecified' ? localLocation
                        : location !== 'unspecified' ? location : inheritedLocation;
                    const currentStatus = statusFor(context, context.indexOf(matched[0]));
                    const identity = category === 'service' && /^packing\b/i.test(matched[0]) ? 'packing'
                        : fold(matched[0]).replace(category === 'access' ? /^no\s+/ : /$^/, '').replace(/s$/, '');
                    const key = `${category}:${factLocation}:${fold(scope)}:${identity}`;
                    const flights = category === 'access' && /^(?:stairs?|staircase)$/i.test(matched[0])
                        ? context.slice(0, context.indexOf(matched[0])).match(new RegExp(`(${NUM}\\s+flights?\\s+of\\s+)$`, 'i'))?.[0] ?? '' : '';
                    const value = category === 'access' && /\b(?:must|require|required|reserve|reserved|reservation|only|before|after|between)\b/i.test(context)
                        && context.length <= 360 ? clean(context) : flights + matched[0];
                    const accessQuote = inheritedLocation !== 'unspecified' && location === 'unspecified' && localLocation === 'unspecified'
                        ? sentencePrefix + clause : clause;
                    const next = fact(category, value, index, accessQuote, { status: currentStatus, location: factLocation, scope });
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
                        const factLocation = category === 'property' ? propertyLocationFor(propertyContext, question) : location;
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
                        put(key, fact(category, value, index, quote, { status: statusFor(clause, matched.index), location: factLocation, scope }));
                        captured = true;
                    }
                }
            }
            if (!captured && /\b(?:move|moving|item|furniture|inventory|packing|unpacking|access|origin|destination|pickup|delivery|stop|stairs|elevator|have|need|want|correction|actually|not sure|don't know|do not know)\b/i.test(clause)
                && !identity.name && !identity.phone && !identity.email
                && !cityStops.some(stop => has(clause, stop.city))
                && !/\b(?:phone|email|contact|callback|name|call me|goodbye|thanks|thank you)\b/i.test(clause)) addUnknown(clause, index);
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
