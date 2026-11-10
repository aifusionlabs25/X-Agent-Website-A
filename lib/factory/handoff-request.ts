/** A deliberately narrow local request signal, never a semantic field mapper.
 * The returned span is original visitor evidence, not a tool invocation,
 * accepted fact, approval or permission for external action. Ambiguous wording
 * returns null and stays in the retained transcript for owner review. */
export type HandoffRequestSpan={start:number;end:number;evidence:string};

const requestPrefix=String.raw`^(?:(?:uh|um|okay|ok|yes|yeah|yep|yup|sure|alright|all right)[, ]+)?(?:(?:please\s+)|(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)|(?:i(?:['’]d| would)\s+like\s+you\s+to\s+)|(?:i\s+(?:want|need)\s+you\s+to\s+))?`;
const requestStart=new RegExp(requestPrefix+String.raw`(?:prepare|create|draft)\s+(?:(?:a|an|the|my|our|this|that|these|those)\s+)?(?:(?:unsent|not sent|local|short|concise|human[ -]review|owner[ -]review|draft|review-ready)\s+){0,4}(?:brief|summary|review note|handoff(?: note)?|note|information|details)\b`,'i');
const updateStart=new RegExp(requestPrefix+String.raw`(?:update|revise|amend|correct)\s+(?:the|my|our|this|that)\s+(?:(?:existing|earlier|previous|saved|current|local|unsent|human[ -]review|owner[ -]review)\s+){0,3}(?:handoff(?: note)?|brief|summary|review note|note)\b`,'i');
const internalScope=/\b(?:unsent|not sent|local|human[ -]review|owner[ -]review)\b|\bfor\s+(?:(?:a|the)\s+)?(?:human|owner)(?:[ -]review|\s+to\s+review)\b/i;
const conditional=/\b(?:if|unless|once)\b|\b(?:when|after)\s+(?:i|we|you)\b/i;
const negatedPreparation=/\b(?:do not|don['’]t|never|not to|stop|cancel)\s+(?:(?:actually|please)\s+)*(?:prepare|create|draft|preparing|creating|drafting|update|updating|revise|revising|amend|amending|correct|correcting)\b/i;
const conflictingDelivery=/\b(?:and|then|also)\s+(?:please\s+)?(?:send|email|submit|book|deliver)\b/i;

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

export function requestedHandoffSpan(raw:string,context:{hasSuccessfulHandoff?:boolean}={}):HandoffRequestSpan|null {
    if(typeof raw!=='string'||!raw.trim()||raw.length>8000)return null;
    const parts=sentences(raw);
    // A later explicit retraction in this same finalized turn is ambiguous;
    // retain it for review rather than manufacture affirmative request state.
    if(parts.some(p=>!p.quoted&&negatedPreparation.test(raw.slice(p.start,p.end))))return null;
    for(const part of parts) {
        if(part.quoted)continue;
        const text=raw.slice(part.start,part.end),leading=text.length-text.trimStart().length;
        const evidence=text.trim();
        // A definite update can inherit local scope only from a retained
        // successful preparation, never from the visitor's claim that one exists.
        const initial=requestStart.test(evidence)&&internalScope.test(evidence);
        const update=context.hasSuccessfulHandoff===true&&updateStart.test(evidence);
        if((!initial&&!update)
            ||conditional.test(evidence)||conflictingDelivery.test(evidence))continue;
        const prefix=raw.slice(0,part.start).trimEnd();
        // A colon or an explicit quote marker can introduce narrated commands
        // on a new line without literal quote characters.
        if(/[:：]$/.test(prefix)||/\b(?:quote|he said|she said|they said|i said|it says|it said)[.!?]?$/i.test(prefix))continue;
        const start=part.start+leading,end=start+evidence.length;
        return {start,end,evidence:raw.slice(start,end)};
    }
    return null;
}
