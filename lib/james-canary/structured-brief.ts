import { createHash } from 'node:crypto';
import type { Fact, Field, Intake, Session, Turn } from './state.ts';
export { BRIEF_REVIEW_INVITATION } from './pad-visibility.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceHash = (value: string) => createHash('sha256').update(value).digest('hex');
const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}@]+/gu, ' ').trim();
const clean = (value: string) => value.trim().replace(/^(?:(?:hey|okay|ok|well|yeah|yes|so|um|uh)[,!.\s]+)+/i, '').replace(/[.!;,\s]+$/, '');
const agreement = /^(?:yes|yeah|yep|correct|that(?:['’]s| is) (?:right|correct)|yes[, ]+that(?:['’]s| is) (?:right|correct))[,!.\s]*$/i;
const noise = /^(?:go on|go ahead|down|slow down|we need to slow down(?: a bit)?|(?:please )?(?:speak|talk|go) (?:slower|more slowly)|(?:that(?:['’]s| is)|it(?:['’]s| is)) all correct|(?:I(?:['’]m| am) )?holding the line(?: as \w+)?|can you hear me|I can hear you|hello|hi|hey|thanks|thank you|sure|okay|ok|right|yes|no|bye|goodbye)[,!? .]*$/i;
const callControl = /^(?:(?:sorry[, ]+)?I (?:can(?:not|'t|’t)|don(?:'t|’t)) hear you|(?:can|could|would) you (?:please )?(?:repeat (?:that|the question)|say that again|slow down)|(?:please )?(?:repeat that|say that again|continue|keep going)|are you still there|(?:one|a) moment|(?:let(?:'s|’s)|we need to) slow down(?: a bit)?)[,!? .]*$/i;

export const BRIEF_SLOTS = {
    name: { label: 'Full name', section: 'Client', field: 'visitor_preferred_identifier' },
    phone: { label: 'Callback number', section: 'Client', field: 'primary_phone' },
    email: { label: 'Email', section: 'Client', field: 'primary_email' },
    reason: { label: 'Reason for contacting', section: 'Matter', field: 'visitor_reported_reason' },
    facts: { label: 'Reported circumstances', section: 'Matter', field: 'material_facts' },
    concern: { label: 'Principal concern', section: 'Matter', field: 'material_facts' },
    outcome: { label: 'Requested help', section: 'Matter', field: 'requested_outcome' },
    location: { label: 'Reported location', section: 'Timing & location', field: 'event_location' },
    incident_date: { label: 'Incident / matter timing', section: 'Timing & location', field: 'relevant_dates_events' },
    payment_date: { label: 'Payment date', section: 'Timing & location', field: 'relevant_dates_events' },
    hearing_date: { label: 'Hearing / court appearance', section: 'Timing & location', field: 'relevant_dates_events' },
    response_deadline: { label: 'Reported response deadline', section: 'Timing & location', field: 'relevant_dates_events' },
    document_date: { label: 'Document date', section: 'Timing & location', field: 'relevant_dates_events' },
    received_date: { label: 'Date received', section: 'Timing & location', field: 'relevant_dates_events' },
    urgency: { label: 'Reported urgency', section: 'Timing & location', field: 'client_reported_urgency' },
    documents: { label: 'Documents / evidence', section: 'Additional context', field: 'known_documents_as_reported' },
    treatment: { label: 'Injury / care reported', section: 'Additional context', field: 'symptoms_treatment' },
    insurance: { label: 'Insurance contact', section: 'Additional context', field: 'insurance_details' },
    communication: { label: 'Other-party communication', section: 'Additional context', field: 'contractor_contact' },
    questions: { label: 'Questions for attorney review', section: 'Additional context', field: 'client_questions' },
} as const;
export type BriefSlot = keyof typeof BRIEF_SLOTS;
export type BriefRow = { key: BriefSlot; label: string; value: string; sourceIds: string[]; confirmed: boolean };
export type BriefSection = { title: string; rows: BriefRow[] };
export type BriefSnapshot = { hash: string; sections: BriefSection[]; missing: string[]; sourceIds: string[] };
export type BriefWorkflow = {
    version: 2;
    finalized?: BriefSnapshot & { at: string };
    confirmation?: { hash: string; at: string; source: 'BUTTON' | 'SPEECH'; turnId?: string };
    invitation?: { hash: string; at: string; status: 'RESERVED' | 'OBSERVED' };
};

/** Control acknowledgments never become facts. A short negative/unknown answer
 * to a factual question remains useful evidence, not conversational debris. */
export function isBriefNoise(text: string, prior = '') {
    if (/^(?:no|yes)[.!?\s]*$/i.test(text) && /\?/.test(prior)
        && /injur|insurance|documents?|paperwork|deadline|court|hearing|contacted|received/i.test(prior)) return false;
    return noise.test(text.trim()) || callControl.test(text.trim()) || agreement.test(text.trim());
}
function dateSlot(fact: Fact): BriefSlot {
    if (fact.briefSlot && (fact.briefSlot.endsWith('_date') || fact.briefSlot === 'response_deadline')) return fact.briefSlot;
    const context = (fact.questionBinding?.text || '') + ' ' + fact.evidence;
    if (/\b(?:respond|response|reply|deadline|due)\b/i.test(context)) return 'response_deadline';
    if (/\b(?:hearing|court (?:date|appearance)|appear in court)\b/i.test(context)) return 'hearing_date';
    if (/\b(?:receiv\w*|served|delivered)\b/i.test(context)) return 'received_date';
    if (/\b(?:dated|document date|letter date|date on)\b/i.test(context)) return 'document_date';
    if (/\b(?:payment|deposit|paid)\b/i.test(context)) return 'payment_date';
    return 'incident_date';
}
function slotFor(fact: Fact): BriefSlot | null {
    if (fact.briefSlot && Object.hasOwn(BRIEF_SLOTS, fact.briefSlot)) return fact.briefSlot;
    const direct: Partial<Record<Field, BriefSlot>> = {
        visitor_preferred_identifier: 'name', primary_phone: 'phone', primary_email: 'email',
        visitor_reported_reason: 'reason', event_location: 'location', requested_outcome: 'outcome',
        client_reported_urgency: 'urgency', known_documents_as_reported: 'documents',
        symptoms_treatment: 'treatment', insurance_details: 'insurance', contractor_contact: 'communication',
        client_questions: 'questions',
    };
    if (direct[fact.field]) return direct[fact.field]!;
    if (fact.field === 'relevant_dates_events') return dateSlot(fact);
    if (fact.field === 'uncertainties') {
        const binding: Record<string, BriefSlot> = { timing_urgency: 'incident_date', timing_location: 'incident_date',
            injury_treatment: 'treatment', insurance_context: 'insurance', paperwork: 'documents',
            requested_outcome: 'outcome', client_urgency: 'urgency', contractor_contact: 'communication' };
        return binding[fact.topic || ''] || null;
    }
    if (fact.field !== 'material_facts') return null;
    if (/\b(?:worried|concerned|concern|afraid)\b/i.test(fact.value)) return 'concern';
    // There is deliberately no "all other utterances" slot.
    if (/\b(?:happened|shut off|water|paid|payment|deposit|stopped|arrest\w*|released|charged|told|said|says|fell|fall|hit|hurt|injur\w*|pain|work|lease|rent|order|notice|support|schedule|custody|damage|court|police|lost|unable|cannot|can't|do not have|don't have)\b/i.test(fact.value)
        || fact.questionBinding?.intent === 'core_facts') return 'facts';
    return null;
}
function displayValue(fact: Fact) {
    if (fact.answerState === 'UNKNOWN') return 'Not known by the visitor';
    if (fact.answerState === 'DECLINED') return 'Visitor declined';
    const value = clean(fact.value);
    if (fact.status === 'NEEDS_CLARIFICATION' && !/^Not known/.test(value)) return value + ' (unconfirmed)';
    if (fact.field === 'primary_phone' && /^\d{10}$/.test(value)) return value.slice(0,3) + '-' + value.slice(3,6) + '-' + value.slice(6);
    return value;
}

/** Deterministic projection, also used in finalization. Raw utterances remain
 * private evidence; only supported, named slots become the visitor's brief. */
export function buildStructuredBrief(intake: Intake): BriefSnapshot {
    const groups = new Map<BriefSlot, Fact[]>();
    for (const fact of intake.facts) {
        if (isBriefNoise(fact.value, fact.questionBinding?.text || '')
            && !fact.answerState?.match(/EXPLICIT_NONE|UNKNOWN|DECLINED/)) continue;
        const slot = slotFor(fact);
        if (!slot || !clean(fact.value)) continue;
        const list = groups.get(slot) || [];
        if (!list.some(old => normalize(displayValue(old)) === normalize(displayValue(fact)))) list.push(fact);
        groups.set(slot, list);
    }
    if (intake.emailCandidate?.field === 'primary_email') {
        // A newer unconfirmed address must replace the old address on screen,
        // never silently fall back to the previously confirmed one.
        const candidate = intake.emailCandidate;
        groups.set('email', [{ id: 'candidate:' + candidate.turnId, field: 'primary_email', value: candidate.value,
            evidence: candidate.evidence, turnId: candidate.turnId, sourceHash: candidate.sourceHash, status: 'VISITOR_REPORTED' }]);
    }
    const sections: BriefSection[] = [];
    const single = new Set<BriefSlot>(['name','phone','email','reason','outcome','location','incident_date','payment_date','hearing_date','response_deadline','document_date','received_date']);
    for (const [key, definition] of Object.entries(BRIEF_SLOTS) as [BriefSlot, typeof BRIEF_SLOTS[BriefSlot]][]) {
        let facts = groups.get(key) || [];
        if (single.has(key) && facts.length) {
            // Exact date clarification replaces relative wording only within
            // the same typed event slot. Never calculate a calendar date.
            const explicit = facts.filter(f => /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i.test(f.value));
            const latest = facts.at(-1)!;
            facts = [(key.endsWith('date') && explicit.length && !['UNKNOWN','DECLINED'].includes(latest.answerState || '') ? explicit : facts).at(-1)!];
        }
        if (key === 'facts') {
            const reason = groups.get('reason')?.at(-1);
            facts = facts.filter(f => !reason || !normalize(reason.value).includes(normalize(f.value)));
            facts = facts.filter(f => ![...groups.entries()].some(([otherKey, values]) =>
                otherKey !== 'facts' && values.some(other => normalize(other.value) === normalize(f.value))));
        }
        if (!facts.length && !['name','phone','email'].includes(key)) continue;
        const declined = intake.declined.includes(definition.field);
        const value = facts.length ? facts.map(displayValue).join('; ') : declined ? 'Visitor declined' : 'Not yet provided';
        const row: BriefRow = { key, label: definition.label, value, sourceIds: facts.map(f => f.id),
            confirmed: facts.length > 0 && facts.every(f => f.status === 'VISITOR_CONFIRMED') && !(key === 'email' && intake.emailCandidate?.field === 'primary_email') };
        let section = sections.find(s => s.title === definition.section);
        if (!section) { section = { title: definition.section, rows: [] }; sections.push(section); }
        section.rows.push(row);
    }
    const rows = sections.flatMap(s => s.rows);
    const missing: string[] = [];
    for (const key of ['reason','outcome','location','incident_date'] as BriefSlot[]) {
        if (!rows.some(row => (row.key === key || (key === 'incident_date' && row.key === 'payment_date')) && row.sourceIds.length)) missing.push(BRIEF_SLOTS[key].label);
    }
    for (const key of ['name','phone','email'] as const) {
        if (!intake.declined.includes(BRIEF_SLOTS[key].field) && !rows.some(row => row.key === key && row.confirmed)) missing.push(BRIEF_SLOTS[key].label + ' verification');
    }
    return { hash: hash({sections, missing}), sections, missing, sourceIds: rows.flatMap(row => row.sourceIds) };
}
export function hasSubstantiveBriefFact(intake: Intake) {
    return buildStructuredBrief(intake).sections.some(section => section.rows.some(row => row.sourceIds.length));
}

function putFact(intake: Intake, turn: Turn, field: Field, value: string, evidence: string,
    options: Partial<Fact> = {}, target?: Fact) {
    const prior = target || (['visitor_preferred_identifier','primary_phone','primary_email'].includes(field) ? intake.facts.findLast(f => f.field === field) : undefined);
    const fact: Fact = { id: hash([turn.id, field, value, options.briefSlot]).slice(0,24), field, value, evidence,
        turnId: turn.id, sourceHash: sourceHash(turn.content), status: 'VISITOR_REPORTED',
        ...(prior ? { supersedes: prior.id } : {}), ...options };
    if (prior) intake.facts = intake.facts.filter(f => f.id !== prior.id);
    intake.facts.push(fact); intake.history.push(structuredClone(fact));
    return fact;
}
function phoneDigits(text: string) {
    const words: Record<string,string> = {zero:'0',oh:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9'};
    const value = text.replace(/\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi, word => words[word.toLowerCase()]).replace(/\D/g,'');
    return value.length === 11 && value.startsWith('1') ? value.slice(1) : value;
}
/** Repair named slots conservatively without changing the legacy canary's
 * extraction policy. Every derived value keeps its source and correction chain. */
export function reconcileStructuredTurn(before: Intake, extracted: Intake, turn: Turn, prior: string): Intake {
    const next = structuredClone(extracted), text = turn.content.trim();
    if (isBriefNoise(text, prior)) {
        next.facts = next.facts.filter(f => f.turnId !== turn.id || f.status === 'VISITOR_CONFIRMED');
        next.history = next.history.filter(f => f.turnId !== turn.id || f.status === 'VISITOR_CONFIRMED');
    }
    const name = before.facts.findLast(f => f.field === 'visitor_preferred_identifier');
    const spelling = /^(?:(?:it(?:['’]s| is)|that(?:['’]s| is))\s+)?([A-Z](?:[\s-]+[A-Z]){1,30})[.! ]*$/i.exec(text);
    if (spelling && name && /\b(?:spell|spelling|last name|surname)\b/i.test(prior)) {
        const letters = spelling[1].replace(/[\s-]/g, '');
        const surname = letters[0].toUpperCase() + letters.slice(1).toLowerCase();
        const first = name.value.split(/\s+/).slice(0, -1).join(' ') || name.value;
        next.facts = next.facts.filter(f => f.turnId !== turn.id && f.field !== 'visitor_preferred_identifier');
        putFact(next, turn, 'visitor_preferred_identifier', first + ' ' + surname, spelling[1],
            { interpretedFrom: {turnId:name.turnId, sourceHash:name.sourceHash, evidence:name.evidence} }, name);
    }
    const namedAnswer = /^(?:it(?:['’]s| is)|that(?:['’]s| is))\s+([\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+){0,3})[.!]*$/u.exec(text);
    if (namedAnswer && /\b(?:name|called)\b[^?]*\?/i.test(prior) && !spelling) {
        next.facts = next.facts.filter(f => f.turnId !== turn.id);
        putFact(next, turn, 'visitor_preferred_identifier', namedAnswer[1], namedAnswer[1]);
    }
    const correctedName = /^(?:actually[, ]+|no[, ]+|correction[: ,]+)?(?:my (?:full )?name is|it(?:['’]s| is))\s+([\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+){0,3}?)(?:[, ]+not\s+([\p{L}'’ -]+))?[.!]*$/iu.exec(text);
    if (correctedName && name && /\b(?:actually|correction|not)\b/i.test(text)
        && (/\bmy (?:full )?name\b/i.test(text) || /\bname\b/i.test(prior) || (correctedName[2] && normalize(name.value).includes(normalize(correctedName[2]))))) {
        next.facts = next.facts.filter(f => f.turnId !== turn.id);
        const surnameOnly = !correctedName[1].includes(' ') && name.value.includes(' ')
            && /\b(?:last name|surname)\b/i.test(prior);
        const value = surnameOnly ? name.value.split(/\s+/).slice(0,-1).join(' ') + ' ' + correctedName[1] : correctedName[1];
        putFact(next, turn, 'visitor_preferred_identifier', value, correctedName[1],
            surnameOnly ? {interpretedFrom:{turnId:name.turnId,sourceHash:name.sourceHash,evidence:name.evidence}} : {}, name);
    }
    const email = /[\w.+-]+(?:\s+at\s+|@)[\w.-]+(?:\s+dot\s+|\.)(?:[a-z]{2,})\b/i.exec(text);
    if (email && (/\b(?:email|address)\b/i.test(prior + ' ' + text) || /^\s*[\w.+-]+\s+at\s+/i.test(text))) {
        const value = email[0].replace(/\s+at\s+/i,'@').replace(/\s+dot\s+/gi,'.').toLowerCase();
        if (!next.facts.some(f => f.field === 'primary_email' && f.value.toLowerCase() === value && f.status === 'VISITOR_CONFIRMED')) {
            next.emailCandidate = {value, evidence:email[0], turnId:turn.id, sourceHash:sourceHash(turn.content), field:'primary_email'};
        }
        next.facts = next.facts.filter(f => !(f.turnId === turn.id && ['material_facts','uncertainties'].includes(f.field) && f.evidence.includes(email[0])));
    }
    if (agreement.test(text) && /\?/.test(prior) && /\b(?:correct|right|confirm)\b/i.test(prior)) {
        for (const field of ['visitor_preferred_identifier','primary_phone'] as const) {
            const fact = before.facts.findLast(f => f.field === field);
            if (!fact || fact.status === 'VISITOR_CONFIRMED') continue;
            const matches = field === 'primary_phone' ? phoneDigits(prior) === fact.value
                : normalize(prior).includes(normalize(fact.value)) && prior.length < 180 && !/\d{3}|@/.test(prior);
            // Whole-recap agreement is not a field confirmation.
            const otherContact = field === 'primary_phone' ? name && normalize(prior).includes(normalize(name.value)) : /\b(?:phone|number|callback|email)\b/i.test(prior);
            if (matches && !otherContact && !/\b(?:recap|brief|summary|everything|all of that|have I got that right)\b/i.test(prior)) {
                putFact(next, turn, field, fact.value, text, {status:'VISITOR_CONFIRMED',
                    interpretedFrom:{turnId:fact.turnId,sourceHash:fact.sourceHash,evidence:fact.evidence}}, fact);
            }
        }
    }
    // Factual answers to "where?" can be a city or street address without "in".
    if (/\b(?:where|location|address of|which city)\b[^?]*\?/i.test(prior)
        && !/\b(?:email|send|documents|upload)\b/i.test(prior)
        && !isBriefNoise(text, prior) && /^(?:in |at )?(?:[\p{L}][\p{L} .'-]{2,60}|\d{1,6} [\p{L}\p{N} .'-]{3,90})[.!]*$/u.test(text)) {
        next.facts = next.facts.filter(f => !(f.turnId === turn.id && f.field === 'material_facts'));
        putFact(next, turn, 'event_location', clean(text).replace(/^(?:in|at)\s+/i,''), text);
    }
    // Retain the assistant question as provenance for typed event timing.
    for (const fact of next.facts.filter(f => f.turnId === turn.id && f.field === 'relevant_dates_events')) {
        fact.questionBinding = {text:prior,hash:sourceHash(prior),intent:'timing_urgency'};
        const index=turn.content.indexOf(fact.evidence);
        if(index>=0){
            const prefix=turn.content.slice(0,index).split(/[.!?]/).at(-1)||'';
            const suffix=turn.content.slice(index+fact.evidence.length).split(/[.!?]/)[0]||'';
            fact.briefSlot=dateSlot({...fact,evidence:prefix+fact.evidence+suffix});
        }
        const historyIndex = next.history.findIndex(entry => entry.id === fact.id);
        if(historyIndex >= 0)next.history[historyIndex] = structuredClone(fact);
    }
    const dates = [...text.matchAll(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/gi)];
    const positiveDates = dates.filter(match => !/\bnot(?: on)?\s*$/i.test(text.slice(0,match.index)));
    if (positiveDates.length === 1 && /\b(?:actually|correction|not)\b/i.test(text)) {
        const draft: Fact = {id:'date-context',field:'relevant_dates_events',value:positiveDates[0][0],evidence:text,turnId:turn.id,sourceHash:sourceHash(text),status:'VISITOR_REPORTED',questionBinding:{text:prior,hash:sourceHash(prior),intent:'timing_urgency'}};
        const slots = new Set(before.facts.filter(f => f.field === 'relevant_dates_events').map(dateSlot));
        let slot = dateSlot(draft);
        // A bare correction can clarify the only known event, but must not
        // silently relabel a payment/hearing date as incident timing.
        if (slot === 'incident_date' && slots.size === 1
            && !/\b(?:incident|happened|accident|shut off|occurred)\b/i.test(prior + ' ' + text)) {
            slot = [...slots][0];
        }
        // An unlabeled correction with multiple event dates is ambiguous.
        if (slot !== 'incident_date' || slots.size <= 1) {
            const targets = before.facts.filter(f => f.field === 'relevant_dates_events' && dateSlot(f) === slot);
            next.facts = next.facts.filter(f => !targets.some(old => old.id === f.id)
                && !(f.turnId === turn.id && ['relevant_dates_events','uncertainties'].includes(f.field)));
            putFact(next,turn,'relevant_dates_events',positiveDates[0][0],positiveDates[0][0],
                {briefSlot:slot,questionBinding:draft.questionBinding},targets.at(-1));
        }
    }
    return next;
}

export function finalizeBrief(session: Session, now = new Date().toISOString()): Session {
    if (!session.intakeBrief || session.demoEmail?.deliveries) throw new Error('Structured brief is unavailable or already emailed');
    const snapshot = buildStructuredBrief(session.intake);
    if (!hasSubstantiveBriefFact(session.intake)) throw new Error('No substantive intake information to review');
    const next = structuredClone(session);
    next.intakeBrief!.finalized = {...snapshot, at:now};
    if (next.intakeBrief!.confirmation?.hash !== snapshot.hash) delete next.intakeBrief!.confirmation;
    return next;
}
export function syncBriefWorkflow(session: Session) {
    if (!session.intakeBrief) return;
    const current = buildStructuredBrief(session.intake), workflow = session.intakeBrief;
    if (workflow.finalized && workflow.finalized.hash !== current.hash) {
        workflow.finalized = {...current, at:new Date().toISOString()};
        delete workflow.confirmation;
    }
    if (!workflow.finalized && !current.missing.length && hasSubstantiveBriefFact(session.intake)) {
        workflow.finalized = {...current, at:new Date().toISOString()};
    }
}
export function confirmBrief(session: Session, snapshotHash: unknown, source: 'BUTTON' | 'SPEECH' = 'BUTTON', turnId?: string): Session {
    const current = session.intakeBrief?.finalized;
    if (!current || snapshotHash !== current.hash || current.hash !== buildStructuredBrief(session.intake).hash) throw new Error('Brief changed; review the current version before confirming');
    if (session.demoEmail?.deliveries || session.state === 'LAUNCHING') throw new Error('Brief confirmation is unavailable');
    const next = structuredClone(session);
    next.intakeBrief!.confirmation = {hash:current.hash, at:new Date().toISOString(), source, ...(turnId ? {turnId} : {})};
    return next;
}
export function reserveBriefInvitation(session: Session, snapshotHash: unknown): Session {
    if (session.state !== 'ACTIVE' || !session.intakeBrief?.finalized || snapshotHash !== session.intakeBrief.finalized.hash) throw new Error('Current active brief required');
    if (session.intakeBrief.invitation) return session; // Exactly one attempt per call, never a loop.
    const next = structuredClone(session);
    next.intakeBrief!.invitation = {hash:String(snapshotHash),at:new Date().toISOString(),status:'RESERVED'};
    return next;
}
export function applyBriefCorrection(session: Session, slot: unknown, value: unknown, snapshotHash: unknown): Session {
    if (typeof slot !== 'string' || !Object.hasOwn(BRIEF_SLOTS,slot) || typeof value !== 'string' || !value.trim()
        || value.length > 1000 || /[\u0000-\u001f]/.test(value)) throw new Error('Valid named-field correction required');
    if (!session.intakeBrief?.finalized || snapshotHash !== session.intakeBrief.finalized.hash
        || snapshotHash !== buildStructuredBrief(session.intake).hash || session.demoEmail?.deliveries
        || !['ACTIVE','CLOSED'].includes(session.state)) throw new Error('Review the current brief before applying a correction');
    const key = slot as BriefSlot, field = BRIEF_SLOTS[key].field;
    let corrected = value.trim();
    if (key === 'phone') { corrected = phoneDigits(corrected); if (!/^\d{10}$/.test(corrected)) throw new Error('A complete ten-digit callback number is required'); }
    if (key === 'email') { corrected = corrected.toLowerCase(); if (!/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/.test(corrected)) throw new Error('A complete email address is required'); }
    const next = structuredClone(session);
    const targets = next.intake.facts.filter(f => slotFor(f) === key);
    next.intake.facts = next.intake.facts.filter(f => !targets.includes(f));
    const editTurn: Turn = {id:'visitor-edit:' + hash([session.id,session.revision,key,corrected]).slice(0,24),role:'user',content:corrected};
    putFact(next.intake, editTurn, field, corrected, corrected,
        {briefSlot:key,sourceKind:'VISITOR_EDIT',status:'VISITOR_CONFIRMED'}, targets.at(-1));
    if (key === 'email') delete next.intake.emailCandidate;
    next.intake.declined = next.intake.declined.filter(f => f !== field);
    // Form edits have their own authenticated receipt. They are NOT injected
    // into provider speech history or claimed to be transcript utterances.
    return finalizeBrief(next);
}
export function structuredBriefView(session: Session) {
    if (!session.intakeBrief) return null;
    const current = buildStructuredBrief(session.intake), workflow = session.intakeBrief;
    return { ...current, phase: workflow.confirmation?.hash === current.hash ? 'CONFIRMED' as const
        : workflow.finalized ? 'REVIEW' as const : 'COLLECTING' as const,
        hasSubstantiveFact:hasSubstantiveBriefFact(session.intake),
        editableSlots:Object.entries(BRIEF_SLOTS).map(([key, definition]) => ({key:key as BriefSlot,label:definition.label})),
        invitationReserved:Boolean(workflow.invitation), finalizedAt:workflow.finalized?.at || null,
        confirmedAt:workflow.confirmation?.hash === current.hash ? workflow.confirmation.at : null };
}
