import { createHash } from 'node:crypto';

export const PERSONA_ID = 'ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d';
export const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export type Turn = { id: string; role: 'user' | 'persona'; content: string };
export type Field = 'visitor_preferred_identifier' | 'primary_phone' | 'primary_email' | 'alternate_email'
    | 'visitor_reported_reason' | 'material_facts' | 'event_location' | 'relevant_dates_events'
    | 'known_documents_as_reported' | 'symptoms_treatment' | 'insurance_details' | 'client_questions'
    | 'uncertainties' | 'requested_outcome' | 'requested_next_step' | 'client_reported_urgency';
export type Fact = { id: string; field: Field; value: string; turnId: string; sourceHash: string;
    evidence: string; status: 'VISITOR_REPORTED' | 'VISITOR_CONFIRMED' | 'NEEDS_CLARIFICATION' | 'DEFERRED_TO_FIRM' | 'UNRESOLVED' | 'ANSWERED'; supersedes?: string; topic?: string;
    interpretedFrom?: { turnId: string; sourceHash: string; evidence: string } };
export type Intake = {
    facts: Fact[]; history: Fact[]; declined: string[];
    emailCandidate?: { value: string; evidence: string; turnId: string; sourceHash: string; field: 'primary_email' | 'alternate_email' };
    handoff: 'NOT_REQUESTED' | 'HANDOFF_REQUESTED' | 'PREPARED';
};
export type Session = {
    id: string; browserId: string; clientLabel: string; createdAt: string; revision: number; stateHash: string;
    personaId: string; config: { promptHash: string; configHash: string; voiceId: string; voiceName: string };
    providerId?: string; state: 'LAUNCHING' | 'ACTIVE' | 'CLOSING_PENDING' | 'CLOSING' | 'CLOSED';
    turns: Turn[]; intake: Intake; receipts: { revision: number; previousHash: string; stateHash: string; eventHash: string; at: string }[];
    providerRelease?: { endTime: string; transcriptHash: string; verifiedAt: string }; closedAt?: string;
    ownerTest?: { grantId: string; expiresAt: number };
    email?: { status: 'RESERVED' | 'SENT' | 'FAILED_OR_UNKNOWN'; snapshotHash: string; subject: string; bodyHash: string; reservedAt: string; messageId?: string; error?: string };
};
export function emptyIntake(): Intake { return { facts: [], history: [], declined: [], handoff: 'NOT_REQUESTED' }; }
export function endIntent(text: string): boolean {
    return /^\s*(?:(?:(?:thanks|thank you)(?:\s+for\s+your\s+help)?[,!.\s]*(?:james[,!.\s]*)?)?(?:goodbye|bye|have a (?:good|great|nice) (?:day|evening|night))|(?:that(?:'s|’s| is) all[,!.\s]*(?:thanks|thank you))|(?:i(?:'m|’m| am) all set[,!.\s]*(?:thanks|thank you))|(?:okay[,!.\s]+)?we(?:'re|’re| are) done)[.!\s]*$/i.test(text);
}
const filler = /^(?:(?:okay|ok|yes|yeah|yep|no|sure|go ahead|that['’]s right|that is right|thanks|thank you|hi(?:[,!\s]+james)?|hello(?:[,!\s]+james)?|hey(?:[,!\s]+james)?)[,.!\s]*)+$/i;
const matterWords = /\b(?:arrest\w*|jail|criminal|DUI|charged|charge|protective order|restraining order|collision|accident|fender bender|injur\w*|lawsuit|sued|evict\w*|summons|complaint|notice|dispute|served|business partner|landlord|tenant|contractor|unfinished work)\b/i;
export function spokenPhone(digits:string):string {
    if(!/^\d{10}$/.test(digits))throw new Error('Canonical ten-digit phone required');
    const names=['zero','one','two','three','four','five','six','seven','eight','nine'];
    return [digits.slice(0,3),digits.slice(3,6),digits.slice(6)].map(group=>[...group].map(d=>names[Number(d)]).join(' ')).join(', ');
}
const norm = (s: string) => s.toLowerCase().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').trim();
const single = new Set<Field>(['visitor_preferred_identifier', 'primary_phone', 'primary_email', 'alternate_email']);
function emailValue(text: string): string | null {
    const value = text.trim().replace(/^([a-z])\s+([a-z]{2,})(?=\s+at\s+)/i,'$1.$2').replace(/\s+(?:dot|period)\s+/gi, '.').replace(/\s+at\s+/gi, '@');
    return /^[\w.+-]{1,64}@[\w.-]+\.[a-z]{2,}$/i.test(value) ? value : null;
}
function requestHandoff(text: string, prior: string): boolean {
    if (/\b(?:do not|don['’]t|not yet)\b/i.test(text)) return false;
    return /\b(?:please|yes|want|like|can you|could you)\b.*\b(?:prepare|send|share|handoff|pass)\b.*\b(?:firm|summary|information|intake|attorney)\b/i.test(text)
        || (/^\s*(?:yes|sure|please|go ahead)(?:[,\s]+please)?[,.!\s]*$/i.test(text)
            && !/\b(?:cannot|can['’]t|not able|unable)\b/i.test(prior)
            && (/\?/.test(prior)||/\bif you['’]d like\b/i.test(prior))
            && /\b(?:prepare|send|share)\b.*\b(?:summary|firm|intake)\b/i.test(prior));
}

/** Conservative port of local source-span notes; no model-supplied fact mutations. */
export function ingest(intake: Intake, turn: Turn, previousAssistant = ''): Intake {
    const next: Intake = structuredClone(intake);
    const text = turn.content;
    const sourceHash = sha(text);
    const add = (field: Field, value: string, evidence = value, status: Fact['status'] = 'VISITOR_REPORTED', target?: Fact) => {
        value = value.trim().replace(/[.!?]$/, '').trim();
        if (!value || !text.includes(evidence)) throw new Error('Evidence span is not grounded');
        const topic=questionIntent(previousAssistant);
        if (next.facts.some(f => f.field === field && norm(f.value) === norm(value)
            && (field!=='uncertainties'||f.topic===(topic||undefined)))) return;
        const prior = target || (single.has(field) ? next.facts.find(f => f.field === field) : undefined);
        if (prior) next.facts = next.facts.filter(f => f.id !== prior.id);
        const fact: Fact = { id: sha(`${turn.id}:${field}:${value}`).slice(0,24), field, value, evidence,
            turnId: turn.id, sourceHash, status, ...(prior ? { supersedes: prior.id } : {}) };
        if(topic && !['primary_email','primary_phone','identity'].includes(topic))fact.topic=topic;
        next.facts.push(fact); next.history.push(fact);
    };
    if (next.emailCandidate && /^(?:yes(?:[, ]+(?:that is|that['’]s|that email is|that email['’]s)\s+(?:right|correct))?|yeah|yep|correct|(?:that is|that['’]s|that email is|that email['’]s)\s+(?:right|correct))[.!\s]*$/i.test(text.trim())) {
        const candidate = next.emailCandidate;
        const readback = previousAssistant.replace(/\s+(?:dot|period)\s+/gi,'.').replace(/\s+at\s+/gi,'@');
        if (/\?/.test(readback) && /correct|right|confirm|address/i.test(readback) && readback.toLowerCase().includes(candidate.value.toLowerCase())) {
            // Candidate retains its original source; this event adds confirmation provenance.
            const prior = next.facts.find(f => f.field === candidate.field);
            const fact: Fact = { id: sha(`${turn.id}:confirm:${candidate.value}`).slice(0,24), field: candidate.field,
                value: candidate.value, evidence: text, turnId: turn.id, sourceHash,
                interpretedFrom:{turnId:candidate.turnId,sourceHash:candidate.sourceHash,evidence:candidate.evidence},
                status: 'VISITOR_CONFIRMED', ...(prior ? { supersedes: prior.id } : {}) };
            next.facts = next.facts.filter(f => f.field !== candidate.field); next.facts.push(fact); next.history.push(fact);
            delete next.emailCandidate;
        }
        return next;
    }
    if (requestHandoff(text, previousAssistant)) {
        next.handoff = 'HANDOFF_REQUESTED'; add('requested_next_step', text, text);
    }
    if (endIntent(text) || filler.test(text.trim())) return next;
    // A contextual unknown is evidence of an unanswered gap, never a guessed fact.
    if (/^(?:I (?:do not|don['’]t) know|I['’]m not sure|I am not sure)[.!\s]*$/i.test(text.trim())) {
        const topic=questionIntent(previousAssistant);
        add('uncertainties',text,text,'NEEDS_CLARIFICATION');
        const fact=next.facts.find(f=>f.turnId===turn.id&&f.field==='uncertainties');if(fact)fact.topic=topic||undefined;
        return next;
    }
    // Sentence boundaries do not split email local parts/domains.
    const clauses = (text.match(/[^.!?]+(?:[.!?](?!\s|$)[^.!?]+)*(?:[.!?](?=\s|$)|$)/g) || [text]).flatMap(clause=>
        /\bI (?:want|need|would like)\b|\bI['’]d like\b/i.test(clause)?[clause]:clause.split(/[,;:]\s*(?=(?:and\s+)?(?:should|can|could|would|what|when|where|why|how|do|does|is|are)\b)/i));
    for (const raw of clauses) {
        const clause = raw.trim(); if (!clause || filler.test(clause) || endIntent(clause)) continue;
        if (requestHandoff(clause, previousAssistant)) continue;
        let remaining = clause;
        for (const [field, label] of [['primary_phone','phone'],['primary_email','email'],['visitor_preferred_identifier','name']] as const) {
            const decline=new RegExp(`\\b(?:I\\s+)?(?:decline|rather not|do not want to|don't want to|no)\\b[^.!?]{0,50}\\b${label}\\b`, 'i').exec(remaining);
            if (decline) {
                if (!next.declined.includes(field)) next.declined.push(field);
                // ASR can join a substantive statement and a contact decline.
                // Remove only the exact decline span, never its sibling facts.
                remaining=remaining.replace(decline[0],'').replace(/\b(?:and|but)\s*[,.;!?]*$/i,'').replace(/^[,;.\s]+|[,;.\s]+$/g,'');
            }
        }
        if (!remaining) continue;
        // Brief answers to a specific contact question retain their original span.
        const answer=clause.replace(/^(?:(?:um|uh|erm|well|sure|okay|yes)[,.! ]+)*(?:(?:it['’]s|it is)\s+)?/i,'').replace(/[.!?]$/,'').trim();
        if (/\?/.test(previousAssistant)&&/\bname\b/i.test(previousAssistant)&&/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(answer)) {
            add('visitor_preferred_identifier',answer,answer);continue;
        }
        const name = /\b(?:[Mm]y name is|[Tt]his is|I am|I'm|I’m)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[,.;!]|$)/.exec(clause);
        const nameAnswer = /\bname\b.*\?/i.test(previousAssistant) && /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}[.!]?$/.test(clause);
        if (name || nameAnswer) {
            const v = name ? name[1] : clause.replace(/[.!]$/,''); add('visitor_preferred_identifier',v,v);
            remaining = remaining.replace(name ? name[0] : clause,'').replace(/^[,;\s]+/,'');
        }
        const phone = /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/.exec(remaining);
        if (phone && (/\b(?:my|phone|number|reach me|call me)\b/i.test(remaining) || /phone|number/i.test(previousAssistant))) {
            const digits = phone[0].replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
            add('primary_phone', digits, phone[0]);
            remaining = remaining.replace(phone[0],'').replace(/^(?:and\s+)?(?:my\s+)?(?:phone(?: number)?|number)\s*(?:is|:)?\s*/i,'').trim();
        }
        // Contact extraction may leave only sentence punctuation. It is not an
        // uncertain email answer even when the preceding question offered email.
        if (!remaining || /^[\s,.!?;:]+$/.test(remaining)) continue;
        // Removing an exact contact span must not manufacture a new evidence span.
        // Pure conversational residue is not a fact. Preserve any other disconnected
        // residue with its ORIGINAL clause for review instead of rejecting the turn.
        if ((name || phone) && /^(?:[\s,.!?;:\-]+|oh\b|yeah\b|yes\b|okay\b|hi\b|james\b)+$/i.test(remaining)) continue;
        if (/@|\b(?:email|e-mail|at .* dot)\b/i.test(remaining) || /email.*\?/i.test(previousAssistant)) {
            const match = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\b[a-z]\s+)?[a-z0-9]+(?:(?:\.|\s+(?:dot|period)\s+)[a-z0-9]+)*\s+at\s+[a-z0-9]+(?:(?:\.|\s+(?:dot|period)\s+)[a-z0-9]+)+/i.exec(remaining);
            if (match && (/\b(?:my|email|address)\b/i.test(remaining) || /email.*\?/i.test(previousAssistant) || norm(remaining)===norm(match[0]))) {
                const candidate = emailValue(match[0]);
                if (candidate && !next.facts.some(f=>['primary_email','alternate_email'].includes(f.field)&&norm(f.value)===norm(candidate))) next.emailCandidate = { value: candidate, evidence: match[0], turnId: turn.id, sourceHash,
                    field: /alternate|other email/i.test(remaining) ? 'alternate_email' : 'primary_email' };
                remaining = remaining.replace(match[0],'').replace(/^(?:and\s+)?(?:my\s+)?(?:primary |alternate )?(?:email(?: address)?|address)\s*(?:is|:)?\s*/i,'').trim();
            } else if (/\b(?:my email|email address)\b/i.test(remaining)) {
                add('uncertainties', remaining, remaining, 'NEEDS_CLARIFICATION'); continue;
            }
        }
        remaining = remaining.replace(/^[,;\s]+|[,;\s]+$/g,'');
        if (!remaining || /^[.!]+$/.test(remaining) || filler.test(remaining)) continue;
        if (!text.includes(remaining)) { add('uncertainties',clause,clause,'NEEDS_CLARIFICATION'); continue; }
        if (/^(?:actually|correction|no[,!])/i.test(remaining)) {
            const explicit = /\b([A-Za-z][A-Za-z'-]*)\s*,?\s+not\s+([A-Za-z][A-Za-z'-]*)\b/i.exec(remaining);
            const implicit = /^(?:actually|correction)[,!:\s-]+it was\s+([A-Z][A-Za-z'-]*)[.!]?$/i.exec(remaining);
            const targets = next.facts.filter(f => explicit ? norm(f.value)===norm(explicit[2]) : f.field==='event_location');
            const value = explicit?.[1] || implicit?.[1];
            if (value && targets.length===1) add(targets[0].field,value,value,'VISITOR_REPORTED',targets[0]);
            else add('uncertainties',remaining,remaining,'NEEDS_CLARIFICATION');
            continue;
        }
        if (/\b(?:call(?:back| me)?|get back|follow.?up|respond)\b/i.test(remaining)
            && /\b(?:will|when|can|could|would|please|want|like)\b/i.test(remaining)) {
            add('requested_next_step',/\btoday|same.day\b/i.test(remaining)?'same-day callback requested':remaining,remaining);
            add('client_questions',remaining,remaining,'DEFERRED_TO_FIRM');continue;
        }
        if (/^(?:(?:and|also|but)\s+)?(?:will|can|could|would|should|is|are|do|does|what|when|where|why|how)\b/i.test(remaining)) {
            add('client_questions',remaining,remaining,/should I|what.*(?:file|do)|can I.*(?:drive|sue)|lawyer|attorney|legal|court|deadline/i.test(remaining)?'DEFERRED_TO_FIRM':'UNRESOLVED'); continue;
        }
        if (/\b(?:afraid|worried|concerned|unsure|(?:don['’]t|do not) (?:know|understand))[^.!?]{0,160}\b(?:say|saying|talk|communicat\w*|evict\w*|supposed to do|what to do|conditions|order|can or can['’]?t)\b/i.test(remaining)) {
            add('client_questions',remaining,remaining,'DEFERRED_TO_FIRM');continue;
        }
        if (/\b(?:I (?:want|need|would like)|I['’]d like)\s+(?:to |help|the firm|an attorney|a lawyer|my (?:money|\$[\d,]+)|a refund)/i.test(remaining)
            || /\b(?:getting|want|like|recover)\b[^.!?]{0,100}\b(?:money|dollars|deposit)\b[^.!?]{0,30}\bback\b/i.test(remaining)
            || (questionIntent(previousAssistant)==='requested_outcome' && /refund|money back|finish|complet|understand|review|explain|help|consider/i.test(remaining))
            || (/outcome|hoping|would you like.*(?:firm|understand)|help (?:you )?with/i.test(previousAssistant) && /understand|review|explain|help|consider/i.test(remaining))) {
            add('requested_outcome',remaining);
            if (/\b(?:charged|can or can['’]?t|court|conditions|supposed to do)\b/i.test(remaining))add('client_questions',remaining,remaining,'DEFERRED_TO_FIRM');
            continue;
        }
        const uncertain = /\b(?:not sure|I think|might|maybe|unsure|unclear)\b/i.test(remaining);
        const place = /\b(?:in|at|near)\s+([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})\b/.exec(remaining);
        const time = /\b(?:on\s+)?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|(?:this|last|next)\s+(?:morning|afternoon|evening|night|week|month|year)|in\s+(?:\d+|one|two|three|four|five|six|seven)\s+(?:days?|weeks?|months?)|today|yesterday|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.exec(remaining);
        const parts = [place,time].filter((m): m is RegExpExecArray => Boolean(m)).sort((a,b)=>a.index-b.index);
        const residues: string[]=[]; let cursor=0;
        for (const m of parts) { const v=remaining.slice(cursor,m.index).replace(/^[ ,.;!?]+|[ ,.;!?]+$/g,''); if(v)residues.push(v); cursor=m.index+m[0].length; }
        const tail=remaining.slice(cursor).replace(/^[ ,.;!?]+|[ ,.;!?]+$/g,''); if(tail)residues.push(tail);
        if (parts.length && residues.every(r=>r.split(/\s+/).length>=2)) {
            if(place)add('event_location',place[1]); if(time)add('relevant_dates_events',time[1]);
            remaining=residues.join(' ');
            for(const r of residues) classify(r,uncertain);
        } else classify(remaining,uncertain);
    }
    return next;

    function classify(value: string, uncertain: boolean) {
        if(filler.test(value.trim()))return;
        if (/\b(?:unusable|uninhabitable|urgent|urgency|no running water|unsafe to use)\b/i.test(value))
            add('client_reported_urgency',value,value,uncertain?'NEEDS_CLARIFICATION':'VISITOR_REPORTED');
        // A matter requires a reported issue, never simply the first non-contact utterance.
        if(!uncertain && matterWords.test(value) && !next.facts.some(f=>f.field==='visitor_reported_reason'))
            add('visitor_reported_reason',value);
        const field: Field = uncertain ? 'uncertainties'
            : /\b(?:pain|sore|hospital|doctor|treatment|injur\w*)\b/i.test(value) ? 'symptoms_treatment'
            : /\b(?:insur\w*|adjuster|voicemail)\b/i.test(value) ? 'insurance_details'
            : /\b(?:paperwork|police report|citation|summons|complaint|document|exhibits|agreement|contract|receipt|bank transfer|text message)\b/i.test(value) ? 'known_documents_as_reported'
            : /\b(?:date|court|hearing|deadline|days|timing unknown|no known deadline)\b/i.test(value) ? 'relevant_dates_events'
            : 'material_facts';
        add(field,value,value,uncertain?'NEEDS_CLARIFICATION':'VISITOR_REPORTED');
    }
}

export function readiness(intake: Intake) {
    const has=(...fields: Field[])=>intake.facts.some(f=>fields.includes(f.field)&&f.status!=='NEEDS_CLARIFICATION');
    const supplied=(f: Field)=>has(f)||intake.declined.includes(f);
    const unknown=(topic:string)=>intake.facts.some(f=>f.field==='uncertainties'&&f.topic===topic);
    const profile=matterProfile(intake);
    const matter=intake.facts.filter(f=>!['client_questions','requested_next_step','requested_outcome'].includes(f.field)).map(f=>f.value).join(' ');
    const covered=(topic:string,pattern:RegExp)=>pattern.test(matter)||unknown(topic)
        ||intake.facts.some(f=>f.topic===topic&&!['client_questions','requested_next_step','requested_outcome'].includes(f.field));
    const depth:Record<string,boolean>=profile==='CRIMINAL_DUI'?{
        reported_charge_order:covered('reported_charge_order',/\b(?:charged with|charge is|DUI|restraining order|protective order)\b/i),
        event_context:covered('event_context',/\b(?:arrest\w*|released|got out of jail|police stop|stopped by)\b/i),
        timing_urgency:has('relevant_dates_events')||unknown('timing_urgency'),
        conditions:covered('conditions',/\b(?:conditions|restrictions|stay away|no.contact|license taken)\b/i),
        paperwork:has('known_documents_as_reported')||unknown('paperwork'),
    }:profile==='PERSONAL_INJURY'?{
        event_context:covered('event_context',/\b(?:collision|accident|fender bender|fell|fall)\b/i),
        timing_location:(has('relevant_dates_events')&&has('event_location'))||unknown('timing_location'),
        injury_treatment:has('symptoms_treatment')||unknown('injury_treatment'),
        insurance_context:has('insurance_details')||unknown('insurance_context'),
    }: /\bcontractor|unfinished work\b/i.test(matter)?{
        agreement_payment:covered('agreement_payment',/\b(?:paid|payment|deposit|bank transfer|agreement)\b/i),
        work_condition:covered('work_condition',/\b(?:unfinished|unusable|torn|apart|completed|not finished|work done)\b/i),
        timing_urgency:has('relevant_dates_events')||unknown('timing_urgency'),
        contractor_contact:covered('contractor_contact',/\b(?:not answering|won['’]t answer|called|contacted|refund request|asked.*refund|texted|not responded)\b/i),
        paperwork:has('known_documents_as_reported')||unknown('paperwork'),
        client_urgency:has('client_reported_urgency')||unknown('client_urgency')||covered('client_urgency',/\b(?:not urgent|no urgency|no immediate concern)\b/i),
    }:{
        paperwork:has('known_documents_as_reported')||unknown('paperwork'),
        allegations:covered('allegations',/\b(?:alleges?|claims?|demands?|requires?|accuses?|says I|says that|seeks?)\b/i),
        receipt_context:covered('receipt_context',/\b(?:received|served|delivered|arrived|handed|mailed)\b/i),
        timing_location:(has('relevant_dates_events')&&has('event_location'))||unknown('timing_location'),
        opposing_contact:covered('opposing_contact',/\b(?:other party|opposing|partner|landlord|tenant)\b.*\b(?:called|email\w*|wrote|said|contact\w*|message\w*)\b/i),
        filing_status:covered('filing_status',/\b(?:filed|filing|hearing|court date|no hearing)\b/i),
    };
    const checks:Record<string,boolean>={
        reason_matter:intake.facts.some(f=>f.field==='visitor_reported_reason'&&matterWords.test(f.value)&&!filler.test(f.value)),
        ...depth,
        identity:supplied('visitor_preferred_identifier'),
        contact_path:has('primary_phone','primary_email')||(intake.declined.includes('primary_phone')&&intake.declined.includes('primary_email')),
        requested_outcome:has('requested_outcome')||unknown('requested_outcome'),
        questions_preserved:intake.facts.filter(f=>f.field==='client_questions').every(f=>['ANSWERED','DEFERRED_TO_FIRM','UNRESOLVED'].includes(f.status)),
    };
    const missingIntents=Object.keys(checks).filter(key=>!checks[key]);
    const missing=missingIntents.map(key=>INTAKE_QUESTIONS[key].label);
    return {ready:!missing.length,status:missing.length?'INTAKE_INCOMPLETE':'HANDOFF_READY',matterProfile:profile,
        practiceScope:profile==='UNVERIFIED_CIVIL_OR_OTHER'?'UNVERIFIED — do not imply the firm handles this matter':'AREA_ONLY — representation and acceptance not confirmed',missing,missingIntents,checks};
}

export function matterProfile(intake:Intake) {
    const text=intake.facts.filter(f=>['visitor_reported_reason','material_facts','known_documents_as_reported'].includes(f.field)).map(f=>f.value).join(' ');
    if(/\b(?:DUI|criminal|arrest\w*|jail|charged|restraining order|protective order)\b/i.test(text))return 'CRIMINAL_DUI';
    if(/\b(?:collision|accident|fender bender|personal injury|slip and fall)\b/i.test(text))return 'PERSONAL_INJURY';
    return 'UNVERIFIED_CIVIL_OR_OTHER';
}

const INTAKE_QUESTIONS:Record<string,{label:string;question:string}>={
    agreement_payment:{label:'Agreement / payment',question:'What was agreed and what payment was made, if any?'},
    work_condition:{label:'Work completed / current condition',question:'What work was completed and what condition is it in now?'},
    contractor_contact:{label:'Last contractor contact / refund request',question:'What happened when you last contacted the contractor, including any refund request?'},
    client_urgency:{label:'Client-reported urgency (or unknown)',question:'Is there a practical urgency or immediate concern you want included?'},
    event_context:{label:'Event / arrest context',question:'What happened during the incident or arrest?'},
    timing_location:{label:'Incident or receipt timing / location (or unknown)',question:'When and where did this happen? Unknown is fine.'},
    injury_treatment:{label:'Injury / treatment (or unknown)',question:'Were there any injuries or treatment, including none that you know of?'},
    insurance_context:{label:'Insurance / contact context (or unknown)',question:'Has an insurer or adjuster contacted you about this incident?'},
    allegations:{label:'Visitor-reported allegations / requirements',question:'What does the notice or document say it alleges or requires?'},
    receipt_context:{label:'How the document was received',question:'How did you receive the document?'},
    opposing_contact:{label:'Opposing-party communication (or unknown)',question:'Has the other party communicated with you about this?'},
    filing_status:{label:'Filing / hearing status (or unknown)',question:'Do you know whether anything has been filed or a hearing scheduled?'},
    reason_matter:{label:'Reason / matter',question:'What brings you to the firm?'},
    core_facts:{label:'Core factual context',question:'What additional detail would help explain what happened?'},
    timing_urgency:{label:'Timing / urgency (or explicitly unknown)',question:'What timing is relevant, or is it unknown?'},
    identity:{label:'Name (or declined)',question:'What name would you like associated with this intake?'},
    contact_path:{label:'Usable contact path (or declined)',question:'What is the best phone number or email for this intake?'},
    requested_outcome:{label:'Requested outcome',question:'What would you like the firm to consider?'},
    questions_preserved:{label:'Client question disposition',question:'Which question still needs human consideration?'},
    reported_charge_order:{label:'Reported charge/order type (or unknown)',question:'What charge or type of order does your paperwork mention, if you know?'},
    paperwork:{label:'Paperwork available (or unknown)',question:'What paperwork do you have, if any?'},
    conditions:{label:'Restrictions/conditions of concern (or unknown)',question:'Are there restrictions or conditions you are unsure about? Unknown is fine.'},
};
export function questionIntent(text:string):string|null {
    if(!text.includes('?'))return null;
    for(const [intent,pattern] of [
        ['requested_outcome',/refund|money back|recover.*money|finish.*work|outcome|hoping|would you like.*(?:firm|consider)|help (?:you )?with/i],
        ['agreement_payment',/agreed|agreement.*payment|deposit|how much|amount/i],['work_condition',/what work|condition.*\bnow\b/i],
        ['contractor_contact',/last.*contractor|contractor.*contact|refund request/i],['client_urgency',/practical urgency|immediate concern/i],
        ['timing_location',/when and where/i],['injury_treatment',/injur|treatment/i],['insurance_context',/insurer|adjuster|insurance/i],
        ['allegations',/alleg|requires|notice.*say|document.*say/i],['receipt_context',/how.*receiv/i],
        ['opposing_contact',/other party.*communicat|opposing.*contact/i],['filing_status',/filed|hearing scheduled/i],
        ['event_context',/incident or arrest/i],
        ['conditions',/conditions|restrictions|stay away/i],['reported_charge_order',/charge|type of order/i],['paperwork',/paperwork|documents/i],
        ['primary_email',/email/i],['primary_phone',/phone|number/i],['identity',/\bname\b/i],
        ['requested_outcome',/outcome|hoping|would you like.*(?:firm|consider)|help (?:you )?with/i],
        ['timing_urgency',/timing|when|date|hearing/i],['core_facts',/what happened|additional detail/i],
    ] as const)if(pattern.test(text))return intent;
    return null;
}
export function conversationGuidance(session:Session) {
    const intake=session.intake,ready=readiness(intake),pending=intake.emailCandidate;
    const asked=session.turns.filter(t=>t.role==='persona').map(t=>questionIntent(t.content)).filter(Boolean);
    const lastVisitor=session.turns.findLast(t=>t.role==='user');
    const hesitation=Boolean(lastVisitor&&/\b(?:not sure|do not know|don['’]t know|I guess)\b/i.test(lastVisitor.content));
    const completed=[...new Set([...intake.facts.filter(f=>f.status!=='NEEDS_CLARIFICATION').map(f=>f.field),...intake.declined,...Object.keys(ready.checks).filter(k=>ready.checks[k])])];
    const emailOpen=!completed.includes('primary_email');
    let intent=ready.missingIntents.find(key=>!asked.includes(key))||(ready.ready?'correctable_summary':'review_unknowns');
    let next=INTAKE_QUESTIONS[intent]?.question||null;
    if(pending){intent='confirm_primary_email';next=`I heard ${pending.value}. Is that correct?`;}
    else if(!ready.missingIntents.length&&emailOpen&&!asked.includes('primary_email')) {
        intent='primary_email';next="What's the best email address to associate with this intake?";
    }
    else if(ready.ready&&emailOpen){
        intent='email_still_open';next=null;
        const lastAssistant=session.turns.findLast(t=>t.role==='persona');
        if(asked.filter(v=>v==='primary_email').length===1&&questionIntent(lastAssistant?.content||'')!=='primary_email'){
            intent='primary_email';next='Would you like to provide an email for this intake, or leave email out?';
        }
    }
    const choices=intake.facts.filter(f=>['client_questions','known_documents_as_reported','material_facts','visitor_reported_reason'].includes(f.field)).slice(-3).map(f=>({value:f.value,source_turn_id:f.turnId}));
    const repeated=asked.includes(intent);
    if((repeated||hesitation)&&!pending&&ready.missingIntents.includes(intent))next='Do not repeat the broad question. Briefly synthesize supplied facts, then use one specific source-bound clarification if needed. Explicit unknown/decline is acceptable; do not infer the answer.';
    return {stage:ready.ready&&!emailOpen?'READY_FOR_CORRECTABLE_SUMMARY':'INTAKE_INCOMPLETE',completion_language_allowed:ready.ready&&!emailOpen&&!next,
        contact_open_items:emailOpen?['primary_email']:[],
        one_job_per_turn:true,email_open_instruction:'An unanswered email question stays OPEN. If it was just asked, address the visitor’s intervening information without closing; return to the missing contact detail later, once, and respect decline. Never ask contact and close in the same reply.',
        known_evidence_do_not_reask:intake.facts.map(f=>({field:f.field,value:f.field==='primary_phone'?spokenPhone(f.value):f.value,status:f.status})),
        practice_scope:ready.practiceScope,matter_profile:ready.matterProfile,
        handoff_truth:{state:intake.handoff,external_action_authorized:false,
            allowed_statement:intake.handoff==='NOT_REQUESTED'?'No handoff has been requested. A callback-timing question is deferred to the firm, not consent or a callback commitment.':'The visitor requested a handoff. Nothing has been sent; no firm review or callback is confirmed.',
            forbidden_promises:['I will pass this on','the firm will review it','someone will call','it will be sent']},
        phone_speech:intake.facts.filter(f=>f.field==='primary_phone').map(f=>({source_turn_id:f.turnId,spoken:spokenPhone(f.value)})),
        next_question_intent:intent,next_question:next,completed_intents_do_not_reask:completed,
        previously_asked_intents:[...new Set(asked)],previous_question_intent:asked.at(-1)||null,
        hesitation_recovery:hesitation,grounded_choice_evidence:choices,max_questions_per_reply:1,repeat_question_after_tool:false,
        response_pattern:'Brief acknowledgment, useful synthesis, at most one high-value missing question. Use the matter-specific gaps for 2–4 useful factual questions when needed, never re-ask answered questions or demand invented answers. Ask each gap once; explicit unknown is valid. Do not say that is all I need, offer closure, or claim completion while completion_language_allowed is false. Only a clear visitor goodbye overrides this. Read phone_speech.spoken verbatim using individual digit words, never a numeric value. Do not promise handoff, firm review or callback.',
        date_authority:{reported_timing_only:intake.facts.filter(f=>f.field==='relevant_dates_events').map(f=>({value:f.value,source_turn_id:f.turnId})),calendar_conversion_allowed:false,missing_exact_date:'Unknown; never calculate or invent it.'}};
}
export function brief(intake: Intake) {
    const sections: {title:string;items:{label:string;text:string}[]}[]=[];
    const add=(title:string,fields:Field[])=>{
        const facts=intake.facts.filter(f=>fields.includes(f.field));
        if(facts.length)sections.push({title,items:facts.map(f=>({label:f.field==='client_questions'?f.status:
            f.field==='visitor_preferred_identifier'?'Name':f.field==='primary_phone'?'Phone':f.field==='primary_email'?'Email':
            f.field==='alternate_email'?'Alternate email':f.field==='event_location'?'Reported location':'',
            text:f.value.replace(/^(?:okay|well|yeah)[,!]?\s+/i,'').replace(/^I got\s+/i,'')}))});
    };
    add('CLIENT',['visitor_preferred_identifier','primary_phone','primary_email','alternate_email']);
    add('MATTER',['visitor_reported_reason']);
    if(sections.some(s=>s.title==='MATTER')&&matterProfile(intake)==='UNVERIFIED_CIVIL_OR_OTHER')sections.find(s=>s.title==='MATTER')!.items.push({label:'Practice scope',text:'UNVERIFIED — firm handling of this matter is not confirmed.'});
    add('KEY FACTS',['material_facts']);
    add('TIMING / URGENCY',['relevant_dates_events','event_location','client_reported_urgency']); add('DOCUMENTS',['known_documents_as_reported']);
    add('SYMPTOMS / TREATMENT',['symptoms_treatment']); add('INSURANCE',['insurance_details']);
    add('CLIENT QUESTIONS',['client_questions']); add('UNCERTAINTIES',['uncertainties']);
    add('REQUESTED OUTCOME',['requested_outcome']); add('REQUESTED NEXT STEP',['requested_next_step']);
    const open=readiness(intake).missing.map(text=>({label:'Not provided',text}));
    if(intake.emailCandidate)open.push({label:'Confirm email',text:intake.emailCandidate.value});
    else if(!intake.facts.some(f=>f.field==='primary_email')&&!intake.declined.includes('primary_email'))open.push({label:'OPEN',text:'Primary email — not answered; optional, decline respected.'});
    if(open.length)sections.push({title:'OPEN ITEMS',items:open});
    sections.push({title:'HANDOFF STATUS',items:[{label:intake.handoff,text:'Not sent. No firm review, response or follow-up is confirmed.'}]});
    return sections;
}
export function applyTurn(session: Session, turn: Turn): Session {
    const existing=session.turns.find(t=>t.id===turn.id);
    if(existing) { if(JSON.stringify(existing)!==JSON.stringify(turn))throw new Error('Finalized evidence changed'); return session; }
    if(session.state!=='ACTIVE' && !(session.state==='CLOSING_PENDING'&&turn.role==='persona'))throw new Error('Session is not accepting turns');
    if(session.turns.length>=160 || turn.content.length>4000 || !turn.content.trim())throw new Error('Turn limit exceeded');
    const next=structuredClone(session);
    if(turn.role==='user') {
        const prior=next.turns.slice().reverse().find(t=>t.role==='persona')?.content||'';
        next.intake=ingest(next.intake,turn,prior);
        if(endIntent(turn.content))next.state='CLOSING_PENDING';
    }
    next.turns.push(turn); return next;
}
export function receipt(previous: Session, next: Session, event: unknown): Session {
    next.revision=previous.revision+1;
    const stateHash=sha(JSON.stringify({...next,stateHash:undefined,receipts:undefined}));
    next.stateHash=stateHash;
    next.receipts.push({revision:next.revision,previousHash:previous.stateHash,stateHash,eventHash:sha(JSON.stringify(event)),at:new Date().toISOString()});
    return next;
}
export function view(session: Session) {
    return { id:session.id,providerId:session.providerId,state:session.state,revision:session.revision,stateHash:session.stateHash,
        config:session.config,personaId:session.personaId,brief:brief(session.intake).map(section=>session.email?.status==='SENT'&&section.title==='HANDOFF STATUS'?{
            title:section.title,items:[{label:'OWNER TEST EMAIL SENT',text:'Sent to the authorized test mailbox only. Nothing sent to Knowles; no firm review or follow-up confirmed.'}]}:section),readiness:readiness(session.intake),
        acceptedVisitorTurns:session.turns.filter(t=>t.role==='user').length,providerRelease:session.providerRelease,
        handoff:session.intake.handoff,email_status:session.email?.status||'INACTIVE_NOT_SENT',
        email_receipt:session.email?.messageId||null,owner_test:Boolean(session.ownerTest),
        external_actions:session.email?.status==='SENT'?[{type:'OWNER_TEST_EMAIL',recipient:'aifusionlabs@gmail.com',receipt:session.email.messageId}]:[] };
}
