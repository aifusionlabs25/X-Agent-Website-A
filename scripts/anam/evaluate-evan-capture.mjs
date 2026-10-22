import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EVAN_CAPTURE_INSTRUCTIONS, EVAN_CAPTURE_SCHEMA, currentEvanCaptureFacts,
    projectEvanCaptureContact, projectEvanCaptureIntake, projectEvanCapturePlan,
    validateEvanCapture,
} from '../../lib/anam/evan-capture.ts';
import { extractEvanCapture } from '../../lib/anam/evan-capture-service.ts';
import { buildEvanEmailBundle } from '../../lib/anam/evan-agentmail-templates.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE = path.join(ROOT, 'tests/fixtures/evan-capture-varied-transcripts.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const fold = value => String(value ?? '').normalize('NFC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const digits = value => String(value).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const metric = (passed, total, needsReview = 0) => ({ passed, total, needsReview,
    lowerBound: total ? passed / total : null, upperBound: total ? (passed + needsReview) / total : null });

// Small, domain-general comparison vocabulary, never an extraction vocabulary.
// Unrecognized paraphrases remain needsReview rather than being presumed correct.
const ALIASES = new Map(Object.entries({
    couch: 'sofa', settee: 'sofa', couches: 'sofa', sofas: 'sofa',
    nightstands: 'nightstand', cartons: 'box', carton: 'box', boxes: 'box',
    ottomans: 'ottoman', chairs: 'chair', tables: 'table', lamps: 'lamp',
    bookshelves: 'bookshelf', shelves: 'shelf', crates: 'crate', records: 'record',
    approximately: 'about', roughly: 'about', around: 'about', approximate: 'about',
    packing: 'pack', packs: 'pack', packed: 'pack', assistance: 'help', support: 'help',
    ourselves: 'self', myself: 'self', yourself: 'provider', yourselves: 'provider', customer: 'self',
    we: 'self', i: 'self', my: 'self', our: 'self', you: 'provider', your: 'provider',
    they: 'thirdparty', their: 'thirdparty', themselves: 'thirdparty',
    everything: 'all', entire: 'all', weekdays: 'weekday', afternoons: 'afternoon',
    mornings: 'morning', evenings: 'evening', tuesdays: 'tuesday',
}));
// Articles and courtesy words may be ignored. Prepositions, conjunctions,
// modality, tense and pronouns can change ownership, scope or certainty.
// Keeping them intentionally trades more manual review for less false credit.
const STOP = new Set('a an the please'.split(' '));
function lexeme(word) {
    if (ALIASES.has(word)) return ALIASES.get(word);
    // Limited morphology for comparison, not a furniture lexicon. Personal
    // names and email addresses use the exact matcher and bypass these rules.
    if (/[^aeiou]ies$/.test(word)) return word.slice(0, -3) + 'y';
    if (/(?:ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && /s$/.test(word) && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
    return word;
}
function tokens(value) {
    return fold(value).replace(/bedside tables?/g, 'nightstand').replace(/self[- ]packing/g, 'self pack')
        .match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu)?.map(lexeme)
        .filter(word => !STOP.has(word)) ?? [];
}
function relation(expected, actual, { exact = false } = {}) {
    if (fold(expected) === fold(actual)) return 'pass';
    if (exact) return 'fail';
    const wantedSequence = tokens(expected), actualSequence = tokens(actual);
    const wanted = new Set(wantedSequence), got = new Set(actualSequence);
    if (!wanted.size) return 'needsReview';
    const roles = set => ['self', 'provider', 'thirdparty'].filter(role => set.has(role));
    const expectedRoles = roles(wanted), actualRoles = roles(got);
    if (expectedRoles.length && actualRoles.length && expectedRoles.join(',') !== actualRoles.join(',')) return 'needsReview';
    const hits = [...wanted].filter(word => got.has(word)).length;
    // Negation is never discarded as a stop word. Extra negation changes meaning.
    const negative = set => [...set].some(word => /^(?:no|not|never|without|neither|nor|cannot|dont|cant|wont)$|n't$/.test(word));
    if (negative(wanted) !== negative(got)) return hits ? 'needsReview' : 'fail';
    if (hits === wanted.size) {
        // The same word set can reverse responsibility or attach a negation to
        // another object. Only an ordered token subsequence earns automatic
        // coverage; reordered paraphrases require semantic adjudication.
        let cursor = 0;
        for (const word of actualSequence) if (word === wantedSequence[cursor]) cursor++;
        return cursor === wantedSequence.length ? 'pass' : 'needsReview';
    }
    return hits ? 'needsReview' : 'fail';
}
const NUMBER_WORDS = Object.fromEntries('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ').map((word, index) => [word, index]));
Object.assign(NUMBER_WORDS, { thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 });
function numberText(value) {
    return fold(value).replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -]+(one|two|three|four|five|six|seven|eight|nine)\b/g,
        (_, tens, ones) => String(NUMBER_WORDS[tens] + NUMBER_WORDS[ones]))
        .replace(/\b(?:a\s+)?pair(?:\s+of)?\b/g, '2').replace(/\b(?:a\s+)?dozen\b/g, '12')
        .replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, word => String(NUMBER_WORDS[word]));
}
export function quantityOf(fact) {
    const literal = fold(fact.quantity);
    // Without a designated quantity, only a leading quantity is eligible. Later
    // dimensions, drawer counts, and container contents are not safe fallbacks.
    const text = numberText(literal || fact.value);
    const eligible = literal || /^(?:(?:about|around|roughly|approximately|at least|at most|no more than|between)\s+)?\d|^(?:a|an|single)\s/.test(text);
    if (!eligible) return { kind: 'unspecified' };
    const numbers = text.match(/\b\d+(?:\.\d+)?\b/g)?.map(Number) ?? [];
    if (!numbers.length && /^(?:a|an|single)\b/.test(text)) return { kind: 'exact', value: 1 };
    if (!numbers.length) return { kind: 'unparsed', literal };
    if (/\b(?:between|to|through)\b|\d\s*[-–]\s*\d/.test(text) && numbers.length > 1) return { kind: 'range', min: numbers[0], max: numbers[1] };
    if (/\b(?:at least|no fewer than|minimum)\b/.test(text)) return { kind: 'at-least', min: numbers[0] };
    if (/\b(?:at most|no more than|maximum|up to)\b/.test(text)) return { kind: 'at-most', max: numbers[0] };
    if (/\b(?:about|around|roughly|approximately|approximate)\b/.test(text)) return { kind: 'approximate', value: numbers[0] };
    return { kind: 'exact', value: numbers[0] };
}

const CONTACT = { displayName: 'name', phone: 'phone', email: 'email', proposedEmail: 'email', contactPreference: 'contactPreference', callbackWindow: 'callbackWindow' };
function categories(field) {
    const clean = field.replace(/^uncertain\./, '').replace(/^contact\./, '');
    if (CONTACT[clean]) return [CONTACT[clean]];
    if (clean.startsWith('inventory')) return ['inventory', 'specialty'];
    if (clean.startsWith('route')) return ['route'];
    if (clean.startsWith('packing.requestedScope')) return ['packing', 'service'];
    if (clean.startsWith('packing')) return ['packing'];
    if (clean.startsWith('services')) return ['service'];
    if (clean.startsWith('communication')) return ['contactPreference'];
    if (clean === 'uncertain') return [];
    return [clean.split('.')[0]];
}
function locationOf(field) {
    return /(?:^|\.)origin$/.test(field) ? 'origin' : /(?:^|\.)destination$/.test(field) ? 'destination'
        : field.includes('additionalStop') ? 'additional' : null;
}
function sameField(atom, fact) {
    return (atom.field === 'uncertain' || categories(atom.field).includes(fact.category))
        && (!atom.location || atom.location === fact.location);
}
function expectedAtoms(expectations) {
    const atoms = [];
    const add = atom => atoms.push({ id: `expected-${atoms.length + 1}`, ...atom });
    for (const [field, spec] of Object.entries(expectations.contact ?? {})) add({ field: `contact.${field}`, ...spec, kind: typeof spec.value === 'boolean' ? 'contactBoolean' : 'fact', status: 'asserted' });
    for (const [index, spec] of (expectations.inventory ?? []).entries()) {
        const entity = `inventory-${index}`;
        add({ field: 'inventory', value: spec.item, acceptedValues: spec.acceptedValues, sourceTurns: spec.sourceTurns, kind: 'fact', status: 'asserted', entity });
        add({ field: 'inventory.quantity', value: spec.item, sourceTurns: spec.sourceTurns, kind: 'quantity', quantity: spec.quantity, status: 'asserted', entity });
        for (const value of spec.qualifiers ?? []) add({ field: 'inventory', value, item: spec.item, sourceTurns: spec.sourceTurns, kind: 'qualifier', status: 'asserted', entity });
    }
    for (const [index, spec] of (expectations.route ?? []).entries()) {
        const location = spec.kind === 'Origin' ? 'origin' : spec.kind === 'Destination' ? 'destination' : 'additional';
        add({ field: 'route', value: spec.address ? `${spec.address} ${spec.city}` : spec.city, purpose: spec.purpose, sourceTurns: spec.sourceTurns, kind: 'fact', status: 'asserted', location, entity: `route-${index}` });
        if (spec.purpose) add({ field: 'route', value: spec.purpose, sourceTurns: spec.sourceTurns, kind: 'qualifier', status: 'asserted', location, entity: `route-${index}` });
    }
    for (const spec of expectations.details ?? []) for (const value of String(spec.value).split(/;\s*/)) add({ ...spec, value, kind: 'fact', status: 'asserted', location: locationOf(spec.field) });
    for (const [index, spec] of (expectations.uncertain ?? []).entries()) {
        const entity = `uncertain-${index}`;
        add({ ...spec, kind: 'fact', status: 'uncertain', location: locationOf(spec.field), entity });
        if (spec.quantity) add({ ...spec, kind: 'quantity', status: 'uncertain', location: locationOf(spec.field), entity });
    }
    return atoms;
}
function textMatch(atom, fact) {
    const values = [atom.value, ...(atom.acceptedValues ?? [])];
    if (atom.field === 'contact.phone') return values.some(value => digits(value) === digits(fact.value)) ? 'pass' : 'fail';
    if (['contact.email', 'contact.proposedEmail', 'contact.displayName'].includes(atom.field)) return values.some(value => relation(value, fact.value, { exact: true }) === 'pass') ? 'pass' : 'fail';
    const candidateText = fact.category === 'route' && fact.route ? [fact.value, fact.route.city, fact.route.address, fact.route.purpose].filter(Boolean).join(' ') : fact.value;
    const results = values.map(value => relation(value, candidateText));
    return results.includes('pass') ? 'pass' : results.includes('needsReview') ? 'needsReview' : 'fail';
}
function structuralGrounding(fact, turns) {
    return Boolean(fact.evidence?.length) && fact.evidence.every(evidence => Number.isInteger(evidence.turn)
        && turns[evidence.turn]?.role === 'user' && evidence.quote && fold(turns[evidence.turn].content).includes(fold(evidence.quote)));
}
function exclusionMatch(spec, fact) {
    if (!sameField({ ...spec, location: locationOf(spec.field) }, fact)) return 'fail';
    if (spec.field.startsWith('uncertain') || spec.field === 'uncertain') {
        if (!['tentative', 'unknown'].includes(fact.status)) return 'fail';
    } else if (fact.status !== 'asserted') return 'fail';
    if (spec.field === 'timing.exactDate') return /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/i.test(fact.value) ? 'pass' : 'fail';
    if (spec.value === undefined) return 'pass';
    if (spec.field.endsWith('inventory.quantity') || spec.field === 'inventory.quantity') {
        const forbidden = quantityOf({ quantity: spec.value, value: spec.value }), actual = quantityOf(fact);
        if (!['unparsed', 'unspecified'].includes(forbidden.kind) && !['unparsed', 'unspecified'].includes(actual.kind)
            && JSON.stringify(forbidden) !== JSON.stringify(actual)) return 'fail';
    }
    const value = `${fact.quantity} ${fact.value}`;
    if (spec.field === 'contact.phone') return digits(spec.value) === digits(fact.value) ? 'pass' : 'fail';
    if (spec.field === 'contact.email' || spec.field === 'contact.displayName') return fold(spec.value) === fold(fact.value) ? 'pass' : 'fail';
    return [spec.value, ...(spec.acceptedValues ?? [])].map(expected => relation(numberText(expected), numberText(value))).reduce((best, result) => result === 'pass' || best === 'pass' ? 'pass' : result === 'needsReview' || best === 'needsReview' ? 'needsReview' : 'fail', 'fail');
}

export function scoreCapture(expectations, record, turns) {
    const facts = currentEvanCaptureFacts(record).filter(fact => fact.status !== 'removed');
    const contact = projectEvanCaptureContact(record);
    const atoms = expectedAtoms(expectations), matches = [], consumed = new Set(), entities = new Map();
    for (const atom of atoms) {
        if (atom.kind === 'contactBoolean') {
            const actual = contact[atom.field.slice('contact.'.length)];
            matches.push({ ...atom, outcome: actual === atom.value ? 'pass' : 'fail', actual });
            continue;
        }
        let candidates = facts.map((fact, index) => ({ fact, index })).filter(({ fact }) => sameField(atom, fact)
            && (atom.status === 'uncertain' ? ['tentative', 'unknown'].includes(fact.status) : fact.status === 'asserted'));
        if (atom.kind === 'quantity' || atom.kind === 'qualifier') {
            const bound = entities.get(atom.entity);
            candidates = bound === undefined ? [] : candidates.filter(candidate => candidate.index === bound);
        } else if (atom.entity) candidates = candidates.filter(candidate => !consumed.has(candidate.index));
        let best = null;
        for (const candidate of candidates) {
            let outcome;
            if (atom.kind === 'quantity') outcome = JSON.stringify(quantityOf(candidate.fact)) === JSON.stringify(atom.quantity) ? 'pass' : quantityOf(candidate.fact).kind === 'unparsed' ? 'needsReview' : 'fail';
            else outcome = textMatch(atom, candidate.fact);
            if (outcome === 'pass' && !structuralGrounding(candidate.fact, turns)) outcome = 'fail';
            if (outcome === 'pass' && atom.sourceTurns?.length && !candidate.fact.evidence.some(evidence => atom.sourceTurns.includes(evidence.turn))) outcome = 'needsReview';
            if (!best || ({ fail: 0, needsReview: 1, pass: 2 })[outcome] > ({ fail: 0, needsReview: 1, pass: 2 })[best.outcome]) best = { ...candidate, outcome };
        }
        if (best && best.outcome !== 'fail' && atom.entity && atom.kind === 'fact') { consumed.add(best.index); entities.set(atom.entity, best.index); }
        matches.push({ ...atom, outcome: best?.outcome ?? 'fail', factIndex: best?.index, actual: best?.fact });
    }
    const exclusions = [];
    for (const kind of ['absent', 'removed']) for (const spec of expectations[kind] ?? []) {
        if (spec.field === 'contact.hiddenFields') {
            exclusions.push({ kind, ...spec, outcome: contact.hiddenFields.includes(spec.value) ? 'fail' : 'pass', violations: [], uncertain: [] });
            continue;
        }
        const results = facts.map((fact, index) => ({ index, relation: exclusionMatch(spec, fact) }));
        const violations = results.filter(result => result.relation === 'pass').map(result => result.index);
        const uncertain = results.filter(result => result.relation === 'needsReview').map(result => result.index);
        exclusions.push({ kind, ...spec, outcome: violations.length ? 'fail' : uncertain.length ? 'needsReview' : 'pass', violations, uncertain });
    }
    for (const field of ['inventory', 'route']) if (Array.isArray(expectations[field]) && !expectations[field].length) {
        const violations = facts.flatMap((fact, index) => fact.status === 'asserted' && categories(field).includes(fact.category) ? [index] : []);
        exclusions.push({ kind: 'empty', field, outcome: violations.length ? 'fail' : 'pass', violations, uncertain: [] });
    }
    if (expectations.route?.length > 1) {
        const stops = projectEvanCapturePlan(record).stops;
        const orderResults = expectations.route.map((stop, index) => {
            const actual = stops[index];
            return !actual || actual.kind !== stop.kind ? 'fail' : relation(`${stop.address ?? ''} ${stop.city}`.trim(), [actual.city, actual.address, actual.displayAddress].filter(Boolean).join(' '));
        });
        matches.push({ id: 'route-order', field: 'route.order', kind: 'routeOrder', value: expectations.route.map(stop => `${stop.kind}: ${stop.address ?? stop.city}`),
            actual: stops.map(stop => `${stop.kind}: ${stop.address ?? stop.city}`), outcome: stops.length !== expectations.route.length || orderResults.includes('fail') ? 'fail' : orderResults.includes('needsReview') ? 'needsReview' : 'pass' });
    }
    const emitted = facts.map((fact, index) => {
        const validEvidence = structuralGrounding(fact, turns);
        const forbidden = exclusions.some(exclusion => exclusion.violations.includes(index));
        const supports = matches.filter(match => match.outcome === 'pass' && match.factIndex === index);
        const supported = supports.length > 0;
        const conflict = matches.some(match => match.factIndex === index && match.kind === 'quantity' && match.outcome === 'fail');
        const coveredTokens = new Set(supports.flatMap(match => tokens(numberText([match.value, ...(match.acceptedValues ?? []),
            match.quantity ? Object.values(match.quantity).join(' ') : ''].join(' ')))));
        const contentText = [fact.value, fact.scope, fact.route?.city, fact.route?.address, fact.route?.purpose].filter(Boolean).join(' ');
        const contentCovered = ['name', 'phone', 'email'].includes(fact.category) || tokens(numberText(contentText)).every(token => coveredTokens.has(token));
        const fullySupported = supported && contentCovered;
        return { fact, validEvidence, outcome: !validEvidence || forbidden || conflict ? 'fail' : fullySupported ? 'pass' : 'needsReview',
            reason: !validEvidence ? 'Invalid user evidence' : forbidden ? 'Forbidden or removed current fact' : conflict ? 'Quantity conflicts with oracle' : fullySupported ? 'Matched expected semantic atoms with user evidence' : 'Extra or ambiguous fact requires semantic adjudication; quote containment alone is insufficient' };
    });
    const correctionChecks = exclusions.filter(exclusion => exclusion.kind === 'removed').map(exclusion => {
        const domain = exclusion.field.replace(/^uncertain\./, '').split('.')[0];
        const related = matches.filter(match => match.field.split('.')[0] === domain);
        return { ...exclusion, outcome: exclusion.outcome === 'fail' || related.some(match => match.outcome === 'fail') ? 'fail'
            : exclusion.outcome === 'needsReview' || related.some(match => match.outcome === 'needsReview') ? 'needsReview' : 'pass' };
    });
    const tally = entries => metric(entries.filter(entry => entry.outcome === 'pass').length, entries.length, entries.filter(entry => entry.outcome === 'needsReview').length);
    return { facts, matches, exclusions, emitted,
        recall: tally(matches), precision: tally(emitted),
        quoteGrounding: metric(emitted.filter(entry => entry.validEvidence).length, emitted.length),
        semanticGrounding: tally(emitted), quantity: tally(matches.filter(match => match.kind === 'quantity')),
        correctionChecks, corrections: tally(correctionChecks),
        negativeControls: tally(exclusions),
        failureCount: [...matches, ...exclusions, ...emitted].filter(entry => entry.outcome === 'fail').length,
        needsReviewCount: [...matches, ...exclusions, ...emitted].filter(entry => entry.outcome === 'needsReview').length };
}

export function parityFor(record, turns) {
    const plan = projectEvanCapturePlan(record), intake = projectEvanCaptureIntake(record), contact = projectEvanCaptureContact(record);
    const bundle = buildEvanEmailBundle({ displayName: 'Synthetic Evaluation', verifiedEmail: 'capture.evaluation@example.test',
        externalSessionId: 'synthetic-capture-evaluation', sessionStartedAt: '2026-10-21T12:00:00Z', sessionEndedAt: '2026-10-21T12:02:00Z',
        turns, handoffStatus: 'rehearsal', captureRecord: record });
    return scoreProjectionParity(record, { plan, contact, intake, visitorText: bundle.visitor.text,
        salesText: bundle.sales.text, adminText: bundle.admin.text });
}

function literalContains(actual, expected) {
    const text = fold(actual), needle = fold(expected);
    if (!needle) return false;
    let offset = text.indexOf(needle);
    while (offset >= 0) {
        if ((!/^[\p{L}\p{N}]/u.test(needle) || !/[\p{L}\p{N}]/u.test(text[offset - 1] ?? ''))
            && (!/[\p{L}\p{N}]$/u.test(needle) || !/[\p{L}\p{N}]/u.test(text[offset + needle.length] ?? ''))) return true;
        offset = text.indexOf(needle, offset + 1);
    }
    return false;
}

function parityLabels(fact) {
    // Independent accepted renderings; a count must remain attached to its own
    // item, not merely occur elsewhere in the consumer's full text.
    const counted = fact.quantity ? [`${fact.quantity} ${fact.value}`, `${fact.value} (quantity: ${fact.quantity})`] : [fact.value];
    const location = { origin: 'Origin', destination: 'Destination', additional: 'Additional stop' }[fact.location];
    const certainty = fact.status === 'tentative' ? 'Possible: ' : fact.status === 'unknown' ? 'To confirm: ' : '';
    return counted.map(label => `${certainty}${location ? `${location}: ` : ''}${label}${fact.scope ? ` [Scope: ${fact.scope}]` : ''}`);
}

/** Exposed for offline projection mutation tests; never an extraction adapter. */
export function scoreProjectionParity(record, projections) {
    const { plan, intake, contact } = projections;
    const checks = [], omissions = [], active = currentEvanCaptureFacts(record).filter(fact => fact.status !== 'removed');
    const add = (fact, consumer, actual, expected = parityLabels(fact)) => {
        const units = (Array.isArray(actual) ? actual : [actual]).filter(value => typeof value === 'string');
        const passed = expected.some(label => units.some(unit => literalContains(unit, label)));
        const ambiguous = !passed && expected.some(label => units.some(unit => relation(label, unit) !== 'fail'));
        checks.push({ category: fact.category, status: fact.status, value: fact.value, quantity: fact.quantity, scope: fact.scope ?? '',
            location: fact.location, expected, consumer, outcome: passed ? 'pass' : ambiguous ? 'needsReview' : 'fail' });
    };
    const omit = (fact, consumer, reason) => omissions.push({ category: fact.category, status: fact.status, consumer, reason });
    const email = (fact, labels = parityLabels(fact)) => {
        for (const audience of ['visitor', 'sales', 'admin']) add(fact, `${audience}.text`, projections[`${audience}Text`], labels);
    };
    for (const fact of active) {
        if (['tentative', 'unknown'].includes(fact.status)) {
            add(fact, 'planner.uncertainties', plan.uncertainties);
            add(fact, 'intake.unknowns', intake.unknowns);
            email(fact);
            continue;
        }
        const contactField = { name: 'displayName', phone: 'phone', email: 'email', contactPreference: 'contactPreference', callbackWindow: 'callbackWindow' }[fact.category];
        if (contactField) {
            const actual = contact[contactField];
            checks.push({ category: fact.category, status: fact.status, value: fact.value, expected: [fact.value], consumer: 'planner.contact',
                outcome: fact.category === 'phone' ? digits(actual) === digits(fact.value) ? 'pass' : 'fail' : fold(actual) === fold(fact.value) ? 'pass' : 'fail' });
        }
        if (['name', 'phone', 'email'].includes(fact.category)) {
            for (const consumer of ['intake', 'visitor.text', 'sales.text', 'admin.text']) omit(fact, consumer, 'Contact privacy/delivery policy is verified by dedicated tests, not literal summary parity.');
            continue;
        }
        if (fact.category === 'route') {
            const kind = { origin: 'Origin', destination: 'Destination', additional: 'Additional stop' }[fact.location];
            if (!kind) {
                for (const consumer of ['planner', 'intake', 'visitor.text', 'sales.text', 'admin.text']) omit(fact, consumer, 'Route has no established endpoint role; this representation is not projected as a confirmed stop.');
                continue;
            }
            const route = fact.route ?? { city: '', address: '', purpose: '', order: null };
            const city = route.city || fact.value;
            const stop = plan.stops.find(stop => stop.kind === kind && fold(stop.city) === fold(city)
                && (!route.address || fold(stop.address) === fold(route.address))
                && (!route.purpose || fold(stop.label ?? stop.purpose) === fold(route.purpose)));
            checks.push({ category: 'route', status: fact.status, value: fact.value, consumer: 'planner.route',
                expected: { kind, city, address: route.address, purpose: route.purpose }, outcome: stop ? 'pass' : 'fail' });
            const details = [route.address, route.purpose].filter(Boolean).join('; ');
            const routeLabel = details ? `${city} (${details})` : city;
            add(fact, 'intake.route', intake.originDestination, [routeLabel]);
            email(fact, [routeLabel]);
            if (fact.scope) omit(fact, 'route.scope', 'Route projection uses city/address/purpose; separate scope association is not measured here.');
            continue;
        }
        const planner = { inventory: plan.inventoryItems, specialty: plan.specialtyItems, service: plan.services, access: plan.accessFactors,
            care: plan.carePriorities, timing: [plan.timing], property: [plan.propertyScope], packing: [plan.packingPlan] }[fact.category];
        const intakeValues = { inventory: intake.inventory, specialty: intake.inventory, service: intake.services, access: intake.access,
            care: intake.customerCare, timing: intake.timing, property: intake.propertyScope, packing: intake.packingPlan,
            question: intake.quoteRequests, contactPreference: intake.contactPreferences, callbackWindow: intake.contactPreferences }[fact.category];
        if (planner) add(fact, 'planner', planner);
        else if (!contactField) omit(fact, 'planner', 'Planner has no dedicated visitor-question field.');
        if (intakeValues) add(fact, 'intake', intakeValues);
        else omit(fact, 'intake', 'No declared intake projection; manual policy review required.');
        email(fact);
    }
    return { metric: metric(checks.filter(check => check.outcome === 'pass').length, checks.length, checks.filter(check => check.outcome === 'needsReview').length), checks,
        coverage: { policyVersion: 'entity-local-text-v2', complete: false, currentFacts: active.length,
            checkedPairs: checks.length, omittedPairs: omissions.length, omissions,
            unmeasured: ['HTML/rendered browser output', 'Removed-fact resurrection and unintended extra output', 'Email contact privacy and delivery authority', 'Route visit-order parity beyond the corpus oracle', 'Session/revision races and source evidence display'] },
        projections,
        limitations: ['Full entity labels bind literal quantities, scope, endpoint labels and uncertainty; ambiguous paraphrases require review.',
            'Coverage is explicitly partial: 100% of checked pairs is not 100% of all projection semantics.',
            'Removed-fact resurrection, contact delivery policy, HTML rendering, route order and revision races require dedicated tests.'] };
}

function fingerprint(record) {
    return hash(JSON.stringify(currentEvanCaptureFacts(record).map(({ category, value, status, location, quantity, route, scope }) => ({ category, value: fold(value), status, location, quantity: numberText(quantity), route: route ?? null, scope: fold(scope) }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))));
}
function scoreSelfTests() {
    const turns = [{ role: 'user', content: 'My phone is 602-555-0199. We are moving two sofas.' }];
    const facts = [{ category: 'phone', value: '602-555-0199', quantity: '', location: 'unspecified', status: 'asserted', evidence: [{ turn: 0, quote: turns[0].content }] },
        { category: 'inventory', value: 'sofas', quantity: 'two', location: 'unspecified', status: 'asserted', evidence: [{ turn: 0, quote: turns[0].content }] }];
    const expected = { contact: { phone: { value: '6025550199', sourceTurns: [0] } }, inventory: [{ item: 'couch', quantity: { kind: 'exact', value: 2 }, sourceTurns: [0] }] };
    if (EVAN_CAPTURE_SCHEMA.properties.facts.items.required.includes('route')) for (const fact of facts) fact.route = null;
    if (EVAN_CAPTURE_SCHEMA.properties.facts.items.required.includes('scope')) for (const fact of facts) fact.scope = '';
    const record = validateEvanCapture({ facts }, turns, 1);
    assert.equal(scoreCapture(expected, record, turns).recall.lowerBound, 1);
    assert.equal(scoreCapture(expected, { ...record, facts: [] }, turns).recall.lowerBound, 0);
    const wrongCount = { ...record, facts: [facts[0], { ...facts[1], quantity: 'one' }] };
    assert.ok(scoreCapture(expected, wrongCount, turns).quantity.lowerBound < 1);
    const excluded = scoreCapture({ absent: [{ field: 'contact.phone' }] }, record, turns);
    assert.equal(excluded.negativeControls.lowerBound, 0);
    const extra = scoreCapture({}, record, turns);
    assert.equal(extra.precision.needsReview, 2);
    assert.equal(extra.precision.lowerBound, 0);
    assert.deepEqual(quantityOf({ value: 'boxes', quantity: 'between twelve and sixteen' }), { kind: 'range', min: 12, max: 16 });
    assert.deepEqual(quantityOf({ value: 'dresser with six drawers', quantity: '' }), { kind: 'unspecified' });
    const correction = scoreCapture({ inventory: expected.inventory, removed: [{ field: 'inventory.quantity', value: '3 sofas', sourceTurns: [0] }] }, record, turns);
    assert.equal(correction.corrections.lowerBound, 1);
    const agentEvidence = scoreCapture(expected, record, [{ ...turns[0], role: 'agent' }]);
    assert.equal(agentEvidence.quoteGrounding.lowerBound, 0);
    const overlyBroad = scoreCapture({ inventory: expected.inventory }, { ...record, facts: [{ ...facts[1], value: 'sofas and a piano' }] }, turns);
    assert.equal(overlyBroad.precision.needsReview, 1, 'A supported word cannot certify an unsupported compound fact');
    const tentative = scoreCapture({ inventory: expected.inventory }, { ...record, facts: [{ ...facts[1], status: 'tentative' }] }, turns);
    assert.equal(tentative.recall.lowerBound, 0, 'A tentative fact cannot satisfy asserted scope');
    const responsibilityTurn = [{ role: 'user', content: 'You pack the books? No, we pack the books.' }];
    const wrongResponsibility = scoreCapture({ details: [{ field: 'packing.responsibility', value: 'we pack the books', sourceTurns: [0] }] },
        { ...record, facts: [{ ...facts[1], category: 'packing', value: 'You pack the books', quantity: '', evidence: [{ turn: 0, quote: responsibilityTurn[0].content }] }] }, responsibilityTurn);
    assert.ok(wrongResponsibility.recall.lowerBound !== 1 && wrongResponsibility.semanticGrounding.lowerBound !== 1, 'Responsibility-bearing pronouns must not be discarded');
    return { passed: 13, purpose: 'Scorer checks only; never evidence of model capture quality.' };
}

function projectionSelfTests() {
    const turns = [{ role: 'user', content: 'My name is Aria Example. My phone is 602-555-0198. We are taking one wicker chaise.' }];
    const facts = [['name', 'Aria Example', ''], ['phone', '602-555-0198', ''], ['inventory', 'wicker chaise', 'one']]
        .map(([category, value, quantity]) => ({ category, value, quantity, status: 'asserted', location: 'unspecified',
            evidence: [{ turn: 0, quote: turns[0].content }],
            ...(EVAN_CAPTURE_SCHEMA.properties.facts.items.required.includes('scope') ? { scope: '' } : {}),
            ...(EVAN_CAPTURE_SCHEMA.properties.facts.items.required.includes('route') ? { route: null } : {}) }));
    const record = validateEvanCapture({ facts }, turns, 1);
    const parity = parityFor(record, turns);
    const selected = parity.checks.filter(check => check.category === 'inventory');
    assert.ok(selected.some(check => check.consumer === 'visitor.text'));
    assert.ok(selected.some(check => check.consumer === 'sales.text'));
    assert.ok(selected.every(check => check.outcome === 'pass'), 'A supplied shared record must reach planner, intake, and email projections');
    assert.equal(parity.projections.contact.displayName, 'Aria Example');
    return { passed: 4, purpose: 'Hand-authored record projection wiring only; no prediction or extractor accuracy is tested.' };
}

function validateCorpus(corpus) {
    assert.equal(corpus.schemaVersion, 1);
    const ids = new Set();
    for (const item of corpus.cases) {
        assert.ok(!ids.has(item.id), 'Duplicate fixture ID'); ids.add(item.id);
        assert.ok(['development', 'holdout'].includes(item.split));
        assert.ok(item.turns.every(turn => ['user', 'agent'].includes(turn.role) && typeof turn.content === 'string' && turn.content.trim()));
        const walk = (value, lastTurn) => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value.sourceTurns)) {
                assert.ok(value.sourceTurns.every(index => Number.isInteger(index) && index >= 0 && index <= lastTurn), 'Invalid evidence index');
                assert.ok(value.sourceTurns.some(index => item.turns[index].role === 'user'), 'Expected evidence needs a user turn');
            }
            if (value.kind === 'exact') assert.ok(Number.isInteger(value.value) && value.value > 0);
            if (value.kind === 'range') assert.ok(Number.isFinite(value.min) && Number.isFinite(value.max) && value.min <= value.max);
            Object.values(value).forEach(child => walk(child, lastTurn));
        };
        walk(item.expectations, item.turns.length - 1);
        for (const checkpoint of item.checkpoints ?? []) {
            assert.ok(Number.isInteger(checkpoint.afterTurn) && checkpoint.afterTurn >= 0 && checkpoint.afterTurn < item.turns.length);
            walk(checkpoint.expectations, checkpoint.afterTurn);
        }
    }
    return { cases: corpus.cases.length, splits: corpus.cases.reduce((counts, item) => ({ ...counts, [item.split]: (counts[item.split] ?? 0) + 1 }), {}),
        checkpoints: corpus.cases.reduce((count, item) => count + (item.checkpoints?.length ?? 0), 0), status: 'valid' };
}

function parseArgs(args) {
    const options = { split: 'development', repeat: 1, limit: Infinity, live: false, output: null, help: false };
    for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        if (flag === '--live') options.live = true;
        else if (flag === '--local') options.local = true;
        else if (flag === '--help' || flag === '-h') options.help = true;
        else if (['--split', '--limit', '--repeat', '--output'].includes(flag)) {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
            options[flag.slice(2)] = ['--limit', '--repeat'].includes(flag) ? Number(value) : value;
        } else throw new Error(`Unknown flag: ${flag}`);
    }
    if (options.live && options.local) throw new Error('Choose local capture or cloud evaluation, never both');
    if (!['development', 'holdout', 'all'].includes(options.split)) throw new Error('Split must be development, holdout, or all');
    if (options.limit !== Infinity && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error('Limit must be a positive integer');
    if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 10) throw new Error('Repeat must be an integer from 1 to 10');
    return options;
}
function safeOutputPath(requested) {
    const resolved = path.resolve(ROOT, requested), relative = path.relative(ROOT, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must be a new file inside this worktree');
    if (existsSync(resolved)) throw new Error('Output already exists; use a new report filename to preserve prior evidence');
    if (!/\.json$/i.test(resolved)) throw new Error('Output must have a .json extension');
    return resolved;
}
function provenance(corpusBytes) {
    const files = [
        'lib/anam/evan-capture.ts', 'lib/anam/evan-capture-service.ts', 'lib/anam/evan-capture-client.ts',
        'lib/anam/evan-deterministic-capture.ts', 'lib/anam/evan-contact-identity.ts',
        'lib/anam/evan-transcript-accumulator.ts', 'lib/anam/evan-agentmail.ts', 'lib/anam/evan-agentmail-templates.ts',
        'lib/anam/evan-move-planner.ts', 'lib/anam/evan-planner-contact.ts', 'lib/anam/session-spine.ts',
        'components/AnamPlayer.tsx', 'components/evan/EvanMovePlanner.tsx', 'app/api/anam/evan/capture/route.ts',
        'scripts/anam/evaluate-evan-capture.mjs', 'tests/evan-capture-scorer-review.test.mjs',
    ];
    let commit = null, trackedDiffHash = null;
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        trackedDiffHash = hash(execFileSync('git', ['diff', 'HEAD', '--binary'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 })); } catch { /* Report missing provenance explicitly, never fabricate it. */ }
    return { commit, trackedDiffHash, corpusSha256: hash(corpusBytes), instructionSha256: hash(EVAN_CAPTURE_INSTRUCTIONS), schemaSha256: hash(JSON.stringify(EVAN_CAPTURE_SCHEMA)),
        sourceSha256: Object.fromEntries(files.map(file => [file, hash(readFileSync(path.join(ROOT, file)))])), node: process.version };
}
function aggregate(runs, key) {
    return runs.reduce((result, run) => {
        const value = key === 'parity' ? run.parity?.metric : run.score?.[key];
        if (value) { result.passed += value.passed; result.total += value.total; result.needsReview += value.needsReview; }
        return result;
    }, { passed: 0, total: 0, needsReview: 0 });
}

export async function main(args = process.argv.slice(2)) {
    const options = parseArgs(args);
    if (options.help) {
        console.log('Usage: node --experimental-strip-types scripts/anam/evaluate-evan-capture.mjs [--split development|holdout|all] [--limit N] [--repeat N] [--output new/worktree/report.json] [--local | --live]');
        console.log('Default: offline empty-provider negative control. --local executes the real deterministic capture with network forbidden. No .env files are loaded. --live requires explicit cloud engine, enabled rehearsal capture, model and API key; it makes paid provider requests.');
        return;
    }
    const output = options.output ? safeOutputPath(options.output) : null;
    const bytes = readFileSync(FIXTURE), corpus = JSON.parse(bytes), selected = corpus.cases.filter(item => options.split === 'all' || item.split === options.split).slice(0, options.limit);
    const corpusValidation = validateCorpus(corpus), scorerTests = scoreSelfTests(), projectionTests = projectionSelfTests();
    const runProvenance = provenance(bytes), providerRequests = [], runs = [];
    const mode = options.live ? 'live' : options.local ? 'local-deterministic' : 'offline-scorer-baseline';
    const env = options.live ? process.env : options.local
        ? { EVAN_CAPTURE_ENABLED: 'true', EVAN_CAPTURE_ENGINE: 'local', VERCEL_ENV: 'development' }
        : { EVAN_CAPTURE_ENABLED: 'true', EVAN_CAPTURE_ENGINE: 'cloud', EVAN_CAPTURE_MODEL: 'offline-empty-stub', OPENAI_API_KEY: 'offline-placeholder', VERCEL_ENV: 'development' };
    if (options.live && (env.EVAN_CAPTURE_ENABLED !== 'true' || env.EVAN_CAPTURE_ENGINE !== 'cloud' || !env.EVAN_CAPTURE_MODEL || !env.OPENAI_API_KEY || env.VERCEL_ENV === 'production')) throw new Error('Live evaluation requires explicit cloud engine, rehearsal capture, model, and API key; production is prohibited');
    const fetchImpl = async (url, request) => {
        if (options.local) throw new Error('Network forbidden in local deterministic capture');
        const body = JSON.parse(request.body);
        providerRequests.push({ model: body.model, systemPromptSha256: hash(body.messages[0].content), responseSchemaSha256: hash(JSON.stringify(body.response_format)), temperature: body.temperature, maxCompletionTokens: body.max_completion_tokens });
        if (options.live) return fetch(url, request);
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"facts":[]}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const plannedCalls = selected.reduce((count, item) => count + ((item.checkpoints?.length ?? 0) + 1) * options.repeat, 0);
    console.log(JSON.stringify({ mode, split: options.split, cases: selected.length, repeat: options.repeat, plannedCalls, actualNetworkCallsAuthorized: options.live }));
    for (const item of selected) {
        const checkpoints = [...(item.checkpoints ?? []), { afterTurn: item.turns.length - 1, expectations: item.expectations, final: true }];
        for (const checkpoint of checkpoints) for (let repeat = 1; repeat <= options.repeat; repeat++) {
            const turns = item.turns.slice(0, checkpoint.afterTurn + 1), started = Date.now();
            const run = { caseId: item.id, split: item.split, category: item.category, metamorphicGroup: item.metamorphicGroup ?? null, afterTurn: checkpoint.afterTurn, final: Boolean(checkpoint.final), repeat };
            try {
                const record = await extractEvanCapture({ turns, revision: turns.length }, { env, fetchImpl });
                run.record = record; run.recordFingerprint = fingerprint(record);
                run.score = scoreCapture(checkpoint.expectations, record, turns);
                run.parity = parityFor(record, turns);
                run.outcome = run.score.failureCount || run.parity.metric.passed + run.parity.metric.needsReview < run.parity.metric.total ? 'fail'
                    : run.score.needsReviewCount || run.parity.metric.needsReview ? 'needsReview' : 'pass';
            } catch (error) {
                run.outcome = 'error'; run.error = error?.code ?? error?.name ?? 'EvaluationError';
                // Preserve recall denominator on provider/validation errors.
                run.score = scoreCapture(checkpoint.expectations, { ...validateEvanCapture({ facts: [] }, [], 0),
                    revision: turns.length, sourceTurnCount: turns.length }, turns);
            }
            run.elapsedMs = Date.now() - started; runs.push(run);
            console.log(JSON.stringify({ caseId: run.caseId, afterTurn: run.afterTurn, final: run.final, repeat, outcome: run.outcome, failures: run.score?.failureCount ?? null, needsReview: run.score?.needsReviewCount ?? null, elapsedMs: run.elapsedMs }));
        }
    }
    const metrics = Object.fromEntries(['recall', 'precision', 'quoteGrounding', 'semanticGrounding', 'quantity', 'corrections', 'negativeControls', 'parity'].map(key => { const value = aggregate(runs, key); return [key, metric(value.passed, value.total, value.needsReview)]; }));
    const stability = selected.map(item => {
        const repeated = runs.filter(run => run.caseId === item.id && run.final), hashes = repeated.filter(run => run.recordFingerprint).map(run => run.recordFingerprint);
        return { caseId: item.id, attempts: repeated.length, successful: hashes.length,
            strictAgreement: repeated.length < 2 || hashes.length !== repeated.length ? null : new Set(hashes).size === 1,
            limitation: 'Lexical normalized record agreement, not a semantic equivalence judgment; an empty stable result is not correctness.' };
    });
    const groups = [...new Set(selected.map(item => item.metamorphicGroup).filter(Boolean))].map(group => {
        const members = selected.filter(item => item.metamorphicGroup === group), relevant = runs.filter(run => run.final && run.repeat === 1 && run.metamorphicGroup === group);
        return { group, cases: members.map(item => item.id), complete: members.length === corpus.cases.filter(item => item.metamorphicGroup === group).length,
            recordAgreement: relevant.length > 1 && relevant.every(run => run.recordFingerprint) ? new Set(relevant.map(run => run.recordFingerprint)).size === 1 : null,
            allExpectedAtomsMatched: relevant.length > 1 && relevant.every(run => run.score.recall.lowerBound === 1),
            needsReview: true, reason: 'Cross-phrase lexical disagreement requires semantic review; agreement without recall is insufficient.' };
    });
    const domainNames = [...new Set(runs.flatMap(run => run.score.matches.map(match => match.field.split('.')[0])))];
    const byDomain = Object.fromEntries(domainNames.map(domain => {
        const matches = runs.flatMap(run => run.score.matches.filter(match => match.field.split('.')[0] === domain));
        return [domain, { recall: metric(matches.filter(match => match.outcome === 'pass').length, matches.length, matches.filter(match => match.outcome === 'needsReview').length) }];
    }));
    const byCategory = Object.fromEntries([...new Set(selected.map(item => item.category))].map(category => {
        const categoryRuns = runs.filter(run => run.category === category);
        return [category, Object.fromEntries(['recall', 'precision', 'quantity', 'corrections', 'parity'].map(key => {
            const value = aggregate(categoryRuns, key); return [key, metric(value.passed, value.total, value.needsReview)];
        }))];
    }));
    const finalRecall = runs.filter(run => run.final && run.score.recall.total).map(run => run.score.recall.lowerBound);
    const parityCoverage = { complete: false, policyVersion: 'entity-local-text-v2',
        checkedPairs: runs.reduce((count, run) => count + (run.parity?.coverage.checkedPairs ?? 0), 0),
        omittedPairs: runs.reduce((count, run) => count + (run.parity?.coverage.omittedPairs ?? 0), 0),
        limitation: 'The parity percentage covers declared entity-local text checks only, not all consumer behavior. Inspect each run\'s omissions and unmeasured dimensions.' };
    const sourcesChanged = Object.entries(runProvenance.sourceSha256).filter(([file, expected]) => hash(readFileSync(path.join(ROOT, file))) !== expected).map(([file]) => file);
    const report = { reportVersion: 3, scorerVersion: 'ordered-entity-v2', generatedAt: new Date().toISOString(), mode,
        qualityClaimAllowed: false, requiresHumanAdjudication: true,
        automatedAssertionsClear: Boolean(options.live || options.local) && !sourcesChanged.length && runs.every(run => run.outcome === 'pass'),
        options: { ...options, limit: Number.isFinite(options.limit) ? options.limit : null, output }, corpusId: corpus.corpusId,
        provenance: { ...runProvenance, sourcesChangedDuringRun: sourcesChanged }, model: env.EVAN_CAPTURE_MODEL ?? null, engine: env.EVAN_CAPTURE_ENGINE, providerRequests, corpusValidation, scorerTests, projectionTests,
        summary: { cases: selected.length, checkpointsAndRepeats: runs.length, errors: runs.filter(run => run.outcome === 'error').length,
            failedRuns: runs.filter(run => run.outcome === 'fail').length, reviewRuns: runs.filter(run => run.outcome === 'needsReview').length, metrics, parityCoverage },
        byDomain, byCategory, macroFinalCaseRecall: finalRecall.length ? finalRecall.reduce((sum, value) => sum + value, 0) / finalRecall.length : null,
        stability, metamorphicGroups: groups,
        limitations: [options.local ? 'Local mode evaluates the actual deterministic implementation, not a model. This is bounded corpus evidence, not unrestricted language coverage.' : 'Default offline mode deliberately returns no provider facts; its scores are a negative-control baseline, not model performance.',
            'Conservative ordered-token/alias comparator: relational words are retained; reordered valid paraphrases may require human semantic adjudication. This is not an entailment proof.',
            'Quote grounding validates role/span only; semanticGrounding uses matched oracle atoms and is not a general entailment proof.',
            'Projection parity is explicitly partial; quantity/scope/state labels are checked per entity, but omissions, extra output, HTML, delivery/privacy policies and races need separate review.',
            'No revision-race, same-ID partial/final arbitration, rendered browser, transport delivery, or live voice claim is supported.',
            'Holdout exposure and implementation freeze are procedural and must be recorded by the operator.',
            'Thresholds and hard-gate decisions require reviewing failures and needsReview entries; this report does not promote a candidate.'], runs };
    if (output) { mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }
    console.log(JSON.stringify({ mode: report.mode, qualityClaimAllowed: report.qualityClaimAllowed, summary: report.summary, output }, null, 2));
    if ((options.live || options.local) && runs.some(run => run.outcome !== 'pass')) process.exitCode = 1;
    return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(`Evaluation stopped: ${error.message}`); process.exitCode = 1; });
}
