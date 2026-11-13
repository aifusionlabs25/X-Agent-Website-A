/** A deliberately narrow local request signal, never a semantic field mapper.
 * The returned span is original visitor evidence, not a tool invocation,
 * accepted fact, approval or permission for external action. Ambiguous wording
 * returns null and stays in the retained transcript for owner review. */
export type HandoffRequestSpan={start:number;end:number;evidence:string;offer_turn_id?:string;offer_evidence?:string};
export type HandoffRequestContext={hasSuccessfulHandoff?:boolean;
    precedingTurn?:{id:string;role:'user'|'persona';content:string}};

// Match conversational lead-ins without stripping them from the evidence.
// Bounded filler tokens cannot swallow a negation, condition or narrator.
const requestPrefix=String.raw`^(?:(?:uh|um|okay|ok|yes|yeah|yep|yup|sure|alright|all right|so|well|you know)[, ]+){0,8}(?:(?:please\s+)|(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)|(?:i(?:['’]d| would)\s+like\s+you\s+to\s+)|(?:i\s+(?:want|need)\s+you\s+to\s+))?(?:go ahead and\s+)?`;
const requestStart=new RegExp(requestPrefix+String.raw`(?:prepare|create|draft)\s+(?:(?:a|an|the|my|our|this|that|these|those)\s+)?(?:(?:unsent|not sent|local|short|concise|human[ -]review|owner[ -]review|draft|review-ready)\s+){0,4}(?:brief|summary|review note|handoff(?: note)?|note|information|details)\b`,'i');
const updatePrefix=String.raw`(?:update|revise|amend|correct)\s+(?:the|my|our|your|this|that)\s+(?:(?:existing|earlier|previous|saved|current|local|unsent|human[ -]review|owner[ -]review)\s+){0,3}`;
const updateStart=new RegExp(requestPrefix+updatePrefix+String.raw`(?:handoff(?: note)?|brief|summary|review note|note)\b`,'i');
const handoffUpdateStart=new RegExp(requestPrefix+updatePrefix+String.raw`handoff(?: note)?\b`,'i');
const internalScope=/\b(?:unsent|not sent|local|human[ -]review|owner[ -]review)\b|\bfor\s+(?:(?:a|the)\s+)?(?:human|owner)(?:[ -]review|\s+to\s+review)\b/i;
const conditional=/\b(?:if|unless|once)\b|\b(?:when|after)\s+(?:i|we|you)\b/i;
const negatedPreparation=/\b(?:do not|don['’]t|never|not to|stop|cancel)\s+(?:(?:actually|please)\s+)*(?:go ahead and\s+)?(?:prepare|create|draft|preparing|creating|drafting|update|updating|revise|revising|amend|amending|correct|correcting)\b/i;
const conflictingDelivery=/\b(?:and|then|also)\s+(?:please\s+)?(?:send|email|submit|book|deliver)\b/i;
const externalActionRequest=new RegExp(requestPrefix+String.raw`(?:send|email|submit|book|deliver|call|phone|text|notify|contact|schedule)\b`,'i');

/** Returns sentence spans outside quotation/code delimiters. Apostrophes in
 * contractions are ordinary text; raw punctuation and all offsets are kept. */
function sentences(raw:string) {
    const spans:Array<{start:number;end:number;quoted:boolean}>=[];
    let start=0,quote:string|null=null,quoted=false;
    const pairs:Record<string,string>={'"':'"','“':'”','‘':'’','`':'`'};
    for(let i=0;i<raw.length;i++) {
        const c=raw[i];
        if(quote&&c===quote){quote=null;quoted=true;}
        else if(!quote&&(pairs[c]||(c==="'"&&!/[\p{L}\p{N}]/u.test(raw[i-1]||'')))) {
            quote=pairs[c]||"'";quoted=true;
        }
        if(/[.!?\n]/.test(c)) {
            spans.push({start,end:i+1,quoted});start=i+1;quoted=Boolean(quote);
        }
    }
    if(start<raw.length)spans.push({start,end:raw.length,quoted:quoted||Boolean(quote)});
    return spans;
}

/** Keep the affirmative clause separate from accompanying facts or a request
 * for a status explanation. A continuation must not turn a qualified, revoked
 * or external-action answer into unconditional local preparation consent. */
function affirmativeSpan(raw:string):{start:number;end:number;evidence:string}|null {
    const first=sentences(raw)[0];
    if(!first||first.quoted)return null;
    const text=raw.slice(first.start,first.end);
    const separator=/\s*(?:;|,?\s+\b(?:and|but)\b)\s*/i.exec(text);
    const clause=(separator?text.slice(0,separator.index):text).trim();
    const affirmative=/^(?:(?:uh|um|well)[, ]+){0,3}(?:(?:yes|yeah|yep|yup|sure|okay|ok|absolutely|certainly)(?:[, ]+(?:i(?:['’]d| would)(?: like that)?|i do|please|go ahead|please do|please go ahead)){0,2}|please do|go ahead|(?:yes[, ]+)?(?:please\s+)?prepare (?:that|the) update)[.!]?$/i;
    if(!affirmative.test(clause))return null;
    const start=first.start+text.length-text.trimStart().length,end=start+clause.length;
    const remaining=raw.slice(end);
    for(const part of sentences(remaining)) {
        if(part.quoted)continue;
        const continuation=remaining.slice(part.start,part.end).replace(/^[\s,;.!?]+/,'')
            .replace(/^(?:(?:and|but|then|also|actually|uh|um|please|well|so)[,\s]+){0,8}/i,'').trim();
        const noRestriction=/^no\s+(?:emails?|calls?|messages?|texts?|external actions?|sending|booking)\b/i.test(continuation);
        if(/^no\b/i.test(continuation)&&!noRestriction
            ||/^(?:not\b|maybe\b|perhaps\b|possibly\b|wait\b|hold on\b|never mind\b|forget it\b|(?:only\s+)?(?:if|unless|once|after|provided(?:\s+that)?|providing(?:\s+that)?|as long as|subject to)\b|when\s+(?:i|we|you)\b)/i.test(continuation)
            ||externalActionRequest.test(continuation)||conflictingDelivery.test(continuation)
            ||/\b(?:i|we)\s+(?:(?:do not|don['’]t)\s+(?:want|authorize|agree|consent)|(?:have\s+)?changed\s+(?:my|our)\s+mind)\b/i.test(continuation))return null;
    }
    return {start,end,evidence:raw.slice(start,end)};
}

/** A contextual answer is consent only to the immediately preceding single local
 * preparation question. No remembered offer across an intervening turn, no
 * contact confirmation, delivery, conditional, quoted or multi-choice offer.
 * The offer is retained as context, never as visitor factual evidence. */
function contextualConsent(raw:string,context:HandoffRequestContext):HandoffRequestSpan|null {
    const offer=context.precedingTurn;
    if(!offer||offer.role!=='persona'||!offer.id||offer.content.length>8000)return null;
    const answer=affirmativeSpan(raw);
    if(!answer)return null;
    const questions=sentences(offer.content).filter(p=>offer.content.slice(p.start,p.end).trim().endsWith('?'));
    if(questions.length!==1)return null;
    const q=questions[0],question=offer.content.slice(q.start,q.end).trim();
    const prefix=offer.content.slice(0,q.start).trimEnd();
    if(/[:：]$/.test(prefix)||/\b(?:quote|he said|she said|they said|i said|it says|it said)[.!?]?$/i.test(prefix))return null;
    if(q.quoted||offer.content.slice(q.end).trim()||conditional.test(question)||conflictingDelivery.test(question)
        ||/\bor\b|\b(?:said|says|quote|asked)\b/i.test(question))return null;
    const match=/^(?:would you like me to|do you want me to|shall i|may i|can i)\s+((?:prepare|create|draft|update|revise)\s+.+)\?$/i.exec(question);
    if(!match)return null;
    const action=match[1];
    const scoped=requestStart.test(action)&&internalScope.test(action)
        ||context.hasSuccessfulHandoff===true&&updateStart.test(action);
    const referential=context.hasSuccessfulHandoff===true&&/^prepare (?:that|the) update$/i.test(action);
    if(!scoped&&!referential)return null;
    if(/prepare (?:that|the) update/i.test(answer.evidence)&&!/(?:updat|revis)/i.test(action))return null;
    return {...answer,offer_turn_id:offer.id,offer_evidence:offer.content};
}

export function requestedHandoffSpan(raw:string,context:HandoffRequestContext={}):HandoffRequestSpan|null {
    if(typeof raw!=='string'||!raw.trim()||raw.length>8000)return null;
    const parts=sentences(raw);
    // A later explicit retraction in this same finalized turn is ambiguous;
    // retain it for review rather than manufacture affirmative request state.
    if(parts.some(p=>!p.quoted&&negatedPreparation.test(raw.slice(p.start,p.end))))return null;
    for(const part of parts) {
        if(part.quoted)continue;
        const text=raw.slice(part.start,part.end),leading=text.length-text.trimStart().length;
        const evidence=text.trim();
        // This application's handoff is a local review artifact. A direct
        // request to update it is a request even before its first preparation;
        // "existing" is not proof of a prior save. Generic briefs/notes still
        // need explicit local scope or a retained successful preparation.
        const initial=requestStart.test(evidence)&&internalScope.test(evidence);
        const update=updateStart.test(evidence)&&(context.hasSuccessfulHandoff===true
            ||internalScope.test(evidence)||handoffUpdateStart.test(evidence));
        if((!initial&&!update)
            ||conditional.test(evidence)||conflictingDelivery.test(evidence))continue;
        const prefix=raw.slice(0,part.start).trimEnd();
        // A colon or an explicit quote marker can introduce narrated commands
        // on a new line without literal quote characters.
        if(/[:：]$/.test(prefix)||/\b(?:quote|he said|she said|they said|i said|it says|it said)[.!?]?$/i.test(prefix))continue;
        const start=part.start+leading,end=start+evidence.length;
        return {start,end,evidence:raw.slice(start,end)};
    }
    return contextualConsent(raw,context);
}
