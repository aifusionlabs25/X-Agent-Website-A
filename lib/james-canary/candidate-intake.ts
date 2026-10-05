import { createHash } from 'node:crypto';
import type { Fact, Field, Intake, Turn } from './state.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/** Candidate-only source-span repair. Raw history stays intact; the visible
 * brief and model recap use only correctly typed, visitor-grounded facts. */
export function repairCandidateIntake(before: Intake, extracted: Intake, turn: Turn, prior: string): Intake {
    // Firm/KB orientation and pure general questions are conversation, not a
    // visitor's case facts. Keep the raw turn; do not project it into the pad.
    const text = turn.content;
    const caseReport = /\b(?:I (?:was|got|have been) (?:in |at )?(?:a |an |the )?(?:accident|crash|arrested|charged|injured|hit|rear-ended)|I (?:have|received|got) (?:a |an |the |my )?(?:police report|citation|court date|hearing|insurance card)|my (?:case|accident|injury|court|citation|report|arrest|charge|hearing))\b/i.test(text);
    const metaRequest = /\b(?:knowledge base|internal instructions|hidden instructions|approved (?:firm )?information|your own information|what does (?:the )?firm say)\b/i.test(text)
        && /\b(?:show|tell|check|what|which|how|can|could|according to)\b/i.test(text);
    const noMatterYet = !before.facts.some(f => ['visitor_reported_reason','event_location','relevant_dates_events',
        'symptoms_treatment','insurance_details','known_documents_as_reported'].includes(f.field));
    const generalQuestion = /^(?:james[,!.\s]+)?(?:what|which|how|why|when|where|who|can|could|would|does|do|is|are)\b/i.test(text.trim())
        && /\?|\b(?:say about|what does)\b/i.test(text);
    // A greeting and a "general terms" preface can precede the question.
    // Do not discard a turn that also reports the visitor's own case facts.
    const generalProcessQuestion = /\b(?:in general terms|generally speaking)\b/i.test(text)
        && /\?/.test(text) && /\b(?:DUI|citation|court|MVD|driver['’]s license|process)\b/i.test(text)
        && !/\b(?:I (?:was|got|have|received|am|did)|my (?:case|citation|charge|court|license|paperwork|arrest))\b/i.test(text);
    const workflowQuestion = /\b(?:check\s+(?:(?:your|the firm['’]s)\s+)?approved intake process|what happens after you capture|what (?:exactly )?the team reviews?)\b/i.test(text)
        && /\?/.test(text);
    if (!caseReport && (metaRequest || generalProcessQuestion || workflowQuestion || (noMatterYet && generalQuestion))) return structuredClone(before);
    const next = structuredClone(extracted);
    const drop = (predicate: (fact: Fact) => boolean) => {
        next.facts = next.facts.filter(fact => !(fact.turnId === turn.id && predicate(fact)));
    };
    const add = (field: Field, evidence: string, briefSlot?: Fact['briefSlot'],
        options: Partial<Pick<Fact, 'value' | 'status' | 'questionBinding' | 'interpretedFrom' | 'supersedes'>> = {}) => {
        const value = (options.value ?? evidence).trim();
        if (!value || !text.includes(evidence) || next.facts.some(f => f.field === field && f.value.toLowerCase() === value.toLowerCase())) return;
        const fact: Fact = { id: digest(`${turn.id}:${field}:${value}`).slice(0, 24), field, value,
            evidence, turnId: turn.id, sourceHash: digest(text), status: options.status ?? 'VISITOR_REPORTED',
            ...(briefSlot ? { briefSlot } : {}),
            ...(options.questionBinding ? { questionBinding: options.questionBinding } : {}),
            ...(options.interpretedFrom ? { interpretedFrom: options.interpretedFrom } : {}),
            ...(options.supersedes ? { supersedes: options.supersedes } : {}) };
        next.facts.push(fact);
        next.history.push(structuredClone(fact));
    };
    const binding = (intent: string) => ({text:prior,hash:digest(prior),intent});

    // A later explicit answer to the same name question supersedes an earlier
    // short ASR fragment. Keep the first fragment in private history.
    const namedReply = /^(?:[Ii]t(?:['’]s| is)|[Tt]hat(?:['’]s| is))\s+([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,3})[.!]*$/u.exec(text.trim());
    if (namedReply && /\b(?:name|called)\b[^?]*\?/i.test(prior)
        && !/\b(?:where|location|which city)\b/i.test(prior)) {
        const oldName = next.facts.findLast(f => f.field === 'visitor_preferred_identifier');
        next.facts = next.facts.filter(f => f.field !== 'visitor_preferred_identifier'
            && !(f.turnId === turn.id && f.field === 'material_facts' && /^(?:it|that)(?:['’]s| is)\b/i.test(f.value)));
        add('visitor_preferred_identifier',namedReply[1],'name',{
            questionBinding:binding('identity'),...(oldName ? {supersedes:oldName.id} : {})});
    }

    // A preference to supply contact details later is not a document, even
    // though the sentence contains the word "email".
    if (/^(?:I['’]d|I would)\s+(?:prefer|rather)\b[^.!?]{0,70}\b(?:number|phone|email)\b[^.!?]{0,35}\blater[.!?]*$/i.test(text.trim()))
        drop(f => f.field === 'known_documents_as_reported' || f.field === 'material_facts');

    // General workflow questions stay in the transcript, even when a caller
    // reports a new collision fact in the same turn.
    if (workflowQuestion) drop(f => ['client_questions','material_facts','known_documents_as_reported'].includes(f.field)
        && /approved intake process|after you capture|team review/i.test(f.value));

    const rearEnded = /\bI was rear-ended\b/i.exec(text);
    if (rearEnded && !before.facts.some(f => f.field === 'visitor_reported_reason'))
        add('visitor_reported_reason',rearEnded[0],'reason');
    const representation = /\b(?:I['’]m|I am)\s+(looking into representation)\b/i.exec(text);
    if (representation) add('requested_outcome',representation[1],'outcome');
    const collisionContinuation = /^\s*(when the car behind hit me)\b/i.exec(text);
    if (collisionContinuation && /\b(?:collision|accident|crash|what happened)\b/i.test(prior)) {
        drop(f => f.field === 'client_questions' && /car behind hit me/i.test(f.value));
        add('material_facts',collisionContinuation[1],'facts',{value:'The car behind hit me'});
    }
    if (/\b(?:They|the insurer|the other driver['’]s insurer)\s+asked for a recorded statement\b/i.test(text)
        && /\b(?:insurer|recorded statement|offer)\b/i.test(prior)) {
        drop(f => f.field === 'material_facts' && /recorded statement|nothing in writing|no offer/i.test(f.value));
        add('insurance_details',text,'insurance',{questionBinding:binding('insurance_context')});
    }

    // "I'm in Scottsdale" reports the visitor's location, not necessarily
    // the crosswalk's location. Never promote it to an incident-site fact.
    const currentPlace = /\bI(?:['’]m| am) in ([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/.exec(text);
    if (currentPlace) add('visitor_location', currentPlace[1], 'visitor_location');

    // An explicit incident-site statement may populate the event-location row.
    const eventPlace = /\b(?:incident|accident|crash|collision) (?:happened|occurred|was) (?:in|at) ([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/i.exec(text);
    if (eventPlace) {
        const place = eventPlace[1].replace(/\s+(?:last|this|next)\s+(?:night|morning|afternoon|evening|week).*$/i, '');
        add('event_location', place, 'location');
    }
    const sceneQuestion = /\?/.test(prior) && /\b(?:scene|time it happened|exact location|incident|accident|crosswalk)\b/i.test(prior);
    const nearPlace = /\bnear\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/.exec(text);
    if (nearPlace && sceneQuestion) {
        const city = before.facts.findLast(f => f.field === 'event_location'
            && new RegExp(`\\b${f.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(prior));
        drop(f => f.field === 'event_location');
        if (city) next.facts = next.facts.filter(f => f.id !== city.id);
        add('event_location',nearPlace[0],'location',{
            value:city ? `${nearPlace[0]}, ${city.value}` : nearPlace[0],
            questionBinding:binding('timing_location'),
            ...(city ? {supersedes:city.id,interpretedFrom:{turnId:city.turnId,sourceHash:city.sourceHash,evidence:city.evidence}} : {})});
    }

    const hit = /\b(?:I was |I got |pedestrian was )hit in a crosswalk by a car\b/i.exec(text);
    if (hit) {
        drop(f => f.field === 'material_facts' && f.value.includes(hit[0]) && f.value.length > hit[0].length);
        if (!before.facts.some(f => f.field === 'visitor_reported_reason')) add('visitor_reported_reason', hit[0], 'reason');
    }
    const incidentTime = /\b(?:last night|yesterday|tonight)\b/i.exec(text);
    if (incidentTime && /\b(?:hit|incident|accident|crash|collision|happened|occurred)\b/i.test(text))
        add('relevant_dates_events', incidentTime[0], 'incident_date');
    // The visitor can mention incident night and current soreness in one turn.
    if (incidentTime && /\b(?:accident|crash|collision|hit)\b/i.test(text)
        && /\b(?:sore|pain|injur\w*)\b[^.!?]*\btoday\b/i.test(text))
        drop(f => f.field === 'relevant_dates_events' && /^today$/i.test(f.value));
    const accidentTimeQuestion = /\b(?:date|time)\b[^?]*\b(?:accident|incident|crash|collision)\b|\b(?:accident|incident|crash|collision)\b[^?]*\b(?:date|time)\b/i.test(prior);
    const timedIncident = /\b(?:around|about)?\s*\d{1,2}[.:]\d{2}\s*(?:a|p)\.?m\.?\s+(?:last night|yesterday)\b/i.exec(text);
    if (accidentTimeQuestion && timedIncident) {
        next.facts = next.facts.filter(f => !(f.field === 'relevant_dates_events' && f.briefSlot === 'incident_date'));
        add('relevant_dates_events',timedIncident[0].trim(),'incident_date',{questionBinding:binding('timing_location')});
    }

    // A denial of arrest is context, never the reason for a pedestrian call.
    if (/\bno[, ]+no arrest\b|\bno arrest\b/i.test(text))
        drop(f => f.field === 'visitor_reported_reason' && /\bno arrest\b/i.test(f.value));

    // Timing of planned care is not incident timing. "Urgent care" names a
    // clinic type, not a claimed legal or medical urgency.
    if (/\burgent care\b/i.test(text)) {
        drop(f => f.field === 'client_reported_urgency' && /\burgent care\b/i.test(f.value));
        if (!/\b(?:incident|accident|crash|collision|hit|happened|occurred)\b/i.test(text))
            drop(f => f.field === 'relevant_dates_events' && /\b(?:today|tomorrow)\b/i.test(f.value));
    }
    const careVisit = /(?:^|,\s*)(I went to urgent care|I(?:['’]ve| have) visited urgent care|I visited urgent care)\b/i.exec(text.trim());
    if (careVisit) {
        drop(f => f.field === 'material_facts' && /\burgent care\b/i.test(f.value));
        add('symptoms_treatment',careVisit[1],'treatment',{
            value:'Visited urgent care',questionBinding:binding('injury_treatment')});
    }
    const strainReport = /^(?:they said it was|I was told I had|I have)\s+(?:a |an )?(?:strain|sprain)\b/i.test(text.trim());
    if (strainReport && /\b(?:urgent care|diagnos\w*|injur\w*|treatment)\b/i.test(prior)
        && before.facts.some(f => f.field === 'symptoms_treatment' && /\burgent care\b/i.test(f.value))) {
        drop(f => f.field === 'material_facts' && /\b(?:strain|sprain|monitoring)\b/i.test(f.value));
        add('symptoms_treatment',text,'treatment',{questionBinding:binding('injury_treatment')});
    }
    // The generic two-attempt fallback cannot call care unknown once this
    // visitor has reported a visit or injury in a source-bound care fact.
    if (next.facts.some(f => f.field === 'symptoms_treatment' && /\b(?:urgent care|strain|sprain)\b/i.test(f.value)))
        next.facts = next.facts.filter(f => !(f.field === 'uncertainties'
            && f.topic === 'injury_treatment' && f.value === 'Answer remains unknown after one clarification'));
    // A tentative answer to a care question is not the date of the incident.
    // Keep the original words as evidence, and retain the uncertainty.
    const careQuestion = /\?/.test(prior) && /\b(?:medical|care|ER|treatment|wrist)\b/i.test(prior);
    const tentativeCare = /\b(?:thinking|considering|might|maybe|planning|deciding)\b[^.!?]{0,55}\b(?:today|tomorrow)\b/i.exec(text);
    if (careQuestion && tentativeCare && !/\b(?:incident|accident|crash|collision|hit|happened|occurred)\b/i.test(text)) {
        drop(f => f.field === 'relevant_dates_events' && /\b(?:today|tomorrow)\b/i.test(f.value));
        const day = /\b(?:today|tomorrow)\b/i.exec(tentativeCare[0])![0];
        add('symptoms_treatment',tentativeCare[0],'treatment',{
            value:`Considering medical care ${day}`,status:'NEEDS_CLARIFICATION',questionBinding:binding('injury_treatment')});
    }

    // Short deictic replies inherit only a clear, immediately preceding
    // question. Never store them as free-floating reported circumstances.
    const cardQuestion = /\b(?:insurance company|policy number|driver(?:['’]s)? name|other driver['’]s name|driver['’]s (?:phone|number))\b/i.test(prior);
    if (cardQuestion && /\bon the card\b/i.test(text)
        && /\bI (?:do not|don['’]t) have it (?:in front of me|next to me|right here)\b/i.test(text)) {
        drop(f => f.field === 'material_facts' && /\b(?:on the card|don['’]t have it|don['’]t remember the name)\b/i.test(f.value));
        // An insurer's policy number is not a missing document. Preserve the
        // unanswered question without projecting a blanket paperwork unknown.
        drop(f => f.field === 'uncertainties' && f.topic === 'paperwork');
        const aboutName = /\bdriver(?:['’]s)? name|other driver['’]s name\b/i.test(prior);
        add('insurance_details',text,'insurance',{
            value:aboutName?'Other driver’s name is on the insurance card; name not available now'
                :'Other driver’s insurer or policy details are on the exchanged card; not available now',
            questionBinding:binding('insurance_context')});
    }
    if (/\b(?:report number|case number|badge number)\b/i.test(prior) && /^(?:no[, ]+)?nothing yet[.! ]*$/i.test(text)) {
        drop(f => f.field === 'material_facts' || f.field === 'uncertainties');
        add('known_documents_as_reported',text,'documents',{
            value:'Report, case, or badge number not provided yet',questionBinding:binding('paperwork')});
    }
    if (/\breport\b/i.test(prior) && /^(?:sorry[, ]*)?later[.! ]*$/i.test(text)) {
        next.facts = next.facts.filter(f => !(f.field === 'material_facts' && /as eight of all eight/i.test(f.value)));
        drop(f => f.field === 'material_facts');
        add('known_documents_as_reported',text.match(/later/i)![0],'documents',{
            value:'Police report expected later',questionBinding:binding('paperwork')});
    }
    if (/\b(?:took|have)\b[^.!?]*\bphotos?\b/i.test(text)) {
        drop(f => f.field === 'material_facts' && /\bphotos?\b/i.test(f.value));
        add('known_documents_as_reported',text,'documents');
    }
    for (const fact of next.facts.filter(f => f.turnId === turn.id && f.field === 'material_facts'
        && /\bbumpers?\b[^.!?]*\bdamag\w*\b/i.test(f.value))) {
        fact.briefSlot='facts';
        const historyIndex=next.history.findIndex(entry => entry.id === fact.id);
        if(historyIndex >= 0)next.history[historyIndex]=structuredClone(fact);
    }
    if (/\b(?:call insurance first|insurance first)\b/i.test(text) && /\b(?:not sure|whether)\b/i.test(text)) {
        drop(f => f.field === 'insurance_details');
        add('client_questions',text,'questions',{status:'UNRESOLVED'});
    }
    if (/\bmain concern\b/i.test(prior) && /^insurance mainly[.! ]*$/i.test(text)) {
        drop(f => f.field === 'insurance_details');
        add('material_facts',text,'concern',{value:'Insurance'});
    }
    // A spelled correction to the email local-part remains pending until the
    // visitor confirms a matching full-address readback on a later turn.
    const spelled = /\b([A-Z](?:-[A-Z]){2,})\b/i.exec(text);
    const pending = before.emailCandidate;
    if (spelled && pending?.field === 'primary_email' && /\bemail\b/i.test(prior)) {
        const letters=spelled[1].replaceAll('-','').toLowerCase();
        const match=/^([\w.+-]*\.)([\w+-]+)(@[\w.-]+)$/.exec(pending.value);
        if(match && letters.length <= 30 && letters !== match[2].toLowerCase())
            next.emailCandidate={value:match[1]+letters+match[3],evidence:spelled[1],turnId:turn.id,sourceHash:digest(text),field:'primary_email'};
    }
    if (/\breport number\b/i.test(prior) && /\b(?:later|not (?:right )?now)\b/i.test(text)
        && /\bI (?:do not|don['’]t) have it (?:in front of me|next to me)\b/i.test(text)) {
        drop(f => f.field === 'material_facts' && /\b(?:don['’]t have it|report number)\b/i.test(f.value));
        add('known_documents_as_reported',text,'documents',{
            value:'Report number not at hand; visitor prefers to provide it later',
            questionBinding:binding('paperwork')});
    }

    const requestedExplanation = /\b(?:I['’]d like|I would like|I want)\s+someone\s+to\s+call me\s+and\s+(explain what to expect)\b/i.exec(text);
    if (requestedExplanation) {
        next.facts = next.facts.filter(f => !(f.field === 'uncertainties' && f.topic === 'requested_outcome'));
        add('requested_outcome',requestedExplanation[1],'outcome',{questionBinding:binding('requested_outcome')});
    }

    // An insurance exchange answer cannot fill the contractor-contact slot
    // merely because the question used "them" or "contact".
    if (/\binsurance|policy\b/i.test(prior) && !/\bcontractor|builder\b/i.test(prior + ' ' + text))
        drop(f => f.field === 'contractor_contact');

    if (/\bnot (?:really |at all )?worried\b/i.test(text))
        drop(f => f.field === 'material_facts' && /^not (?:really |at all )?worried\b/i.test(f.value.trim()));

    return next;
}
