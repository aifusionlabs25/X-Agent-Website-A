import {digest,proposalIssues,type Field,type Proposal,type Turn} from './handoff.ts';
import {contradictingCorrection} from './handoff-corrections.ts';

export type CurrentFactSelection={
    resolved_index:number;original:Proposal;source_sha256:string;evidence_start:number;evidence_end:number;
    removed_span:{start:number;end:number;text:string};
    retained_spans:Array<{start:number;end:number;proposal:Proposal}>;
    correction_proposal_index:number;correction_proposal:Proposal;correction_turn:Turn;correction_turn_sha256:string;
    equivalent_correction_proposal_indices?:number[];
    rule:'EXACT_POSITIVE_COUNT_PARTITION';
};

const frames=/\b(?:(?:(?:we|i|they)[ \t]+have|(?:our|the)[ \t]+team[ \t]+has|there[ \t]+are)[ \t]+)?(\d+)[ \t]+([\p{L}]+)\b/giu;
const quoted=/["“”`]|(?:^|[\s([{])['‘]/u;
// These scopes can govern a later sentence. A narrow projection should decline
// narrated or hypothetical source material, rather than detach its frame.
const narrated=/\b(?:said|says|told|quoted|wrote|asked|imagine|suppose|pretend|hypothetical)\b|\b(?:for example|the example|an example)\b/i;

/** Prove a direct same-unit numeric contrast, in addition to the existing guard.
 * The guard also recognizes multiword negations, which alone do not establish
 * a replacement count. This helper only inspects source text; it rewrites none. */
function explicitActor(text:string):string|null {
    const person=/\b(we|i|they)[ \t]+(?:have|are)[ \t]*$/i.exec(text);
    if(person)return person[1].toLowerCase();
    const team=/\b(our|my|their)[ \t]+team[ \t]+(?:has|is)[ \t]*$/i.exec(text);
    return team?({our:'we',my:'i',their:'they'} as Record<string,string>)[team[1].toLowerCase()]:null;
}
function directNumericContrast(correction:Turn,number:string,unit:string,actor:string|null):boolean {
    for(const match of correction.content.matchAll(/\bnot\s+(\d+)\s*(?=[.!?;,]|$)/gi)) {
        if(match[1]!==number)continue;
        const clause=correction.content.slice(0,match.index).split(/[;.!?]/).at(-1)||'';
        const counts=[...clause.matchAll(/(?<![\w.])\d+(?!\w|\.\d)/g)];
        if(counts.length!==1||counts[0][0]===number)continue;
        const replacementActor=explicitActor(clause.slice(0,counts[0].index));
        if(actor&&replacementActor&&actor!==replacementActor)continue;
        const following=clause.slice(counts[0].index!+counts[0][0].length);
        const subject=/^\s+([\p{L}]+)\b/u.exec(following);
        if(subject?.[1].toLowerCase()===unit.toLowerCase())return true;
    }
    return false;
}

/** Partition one uniquely proved, positive count assertion. Every retained
 * fragment remains an exact source span in its original field; the supplied
 * correction stays in its own field. No sentence is dropped merely because it
 * contains the count: relative clauses such as "that handle requests by email"
 * remain represented. Audit spans cover even whitespace-only residuals, which
 * cannot themselves be strict proposals. Ambiguous scopes fail closed. */
export function projectCurrentFact(original:Proposal,input:unknown,turns:Turn[],fields:Field[],resolvedIndex:number):
    {proposals:Proposal[];binding:CurrentFactSelection}|null {
    if(!Array.isArray(input)||!input.length||input.length>24)return null;
    const originalIssues=proposalIssues([original],turns,fields);
    if(originalIssues.length!==1||originalIssues[0].problems.length!==1
        ||originalIssues[0].problems[0]!=='LATER_EXPLICIT_CORRECTION_REQUIRES_CURRENT_EVIDENCE')return null;
    const sources=turns.filter(t=>t.role==='user'&&t.id===original.visitor_message_id);
    if(sources.length!==1)return null;
    const source=sources[0],start=source.content.indexOf(original.evidence),end=start+original.evidence.length;
    if(start<0||start!==source.content.lastIndexOf(original.evidence)||quoted.test(source.content)||narrated.test(source.content))return null;
    const correction=contradictingCorrection(turns,source.id,original.evidence);
    if(!correction)return null;
    const issues=proposalIssues(input,turns,fields);
    const witnesses=input.map((p:Proposal,index:number)=>({p,index})).filter(({p,index})=>
        !issues.some(issue=>issue.index===index)&&p?.visitor_message_id===correction.id
        &&p.evidence===correction.content&&p.value===correction.content);
    // One exact source assertion may legitimately be supplied under several
    // configured fields. Those are not competing factual witnesses. Preserve
    // every mapping and record all witness indices; duplicate rows in the same
    // field remain ambiguous and invalid siblings still fail atomic validation.
    if(!witnesses.length||new Set(witnesses.map(w=>w.p.field_id)).size!==witnesses.length)return null;
    const eligible:Array<{start:number;end:number}>=[],sourceFrames=[...source.content.matchAll(frames)];
    for(const frame of sourceFrames) {
        const frameStart=frame.index!,frameEnd=frameStart+frame[0].length;
        // A substring following "if", "not", "said:", or a comma is not a
        // sentence assertion just because the provider quote starts there.
        const prefix=source.content.slice(0,frameStart);
        if(prefix.trim()&&!/(?:^|[.!?][ \t\r\n]+)(?:(?:uh|um)[, \t]+)?$/i.test(prefix))continue;
        if(/\.{2,}[ \t\r\n]*$/.test(prefix))continue;
        if(sourceFrames.filter(other=>other[1]===frame[1]&&other[2].toLowerCase()===frame[2].toLowerCase()).length!==1)continue;
        const after=source.content.slice(frameEnd),terminal=/^[ \t]*(?:[.!](?=\s|$)|$)/.exec(after);
        const relative=/^[ \t]+(?:that|who)[ \t]+\p{L}/iu.test(after);
        // A bare subject count may precede a positive work predicate. Remove
        // only the contradicted count; retain the predicate as an exact span.
        const direct=/^\d/.test(frame[0])&&/^[ \t]+(?:handle|process|manage|review|answer|receive|prepare)[ \t]+\p{L}/iu.test(after);
        if(!terminal&&!relative&&!direct)continue;
        // A question or another count inside the relative clause can change
        // the scope of the assertion; leave such cases to owner review.
        const sentenceTail=after.split(/[.!]/,1)[0];
        if((relative||direct)&&(/[?]|\d/.test(sentenceTail)))continue;
        if(direct&&/\b(?:if|unless|maybe|might|only|except|not|never)\b/i.test(sentenceTail))continue;
        const removeEnd=terminal?frameEnd+terminal[0].length:frameEnd;
        if(frameStart<start||removeEnd>end)continue;
        if(contradictingCorrection(turns,source.id,frame[0])?.id!==correction.id
            ||!directNumericContrast(correction,frame[1],frame[2],explicitActor(frame[0].slice(0,frame[0].indexOf(frame[1])))))continue;
        eligible.push({start:frameStart,end:removeEnd});
    }
    if(eligible.length!==1)return null;
    const removed=eligible[0],retained:CurrentFactSelection['retained_spans']=[];
    for(const [a,b] of [[start,removed.start],[removed.end,end]]) {
        if(a===b)continue;
        const text=source.content.slice(a,b);
        retained.push({start:a,end:b,proposal:{...original,evidence:text,value:text}});
    }
    const proposals=retained.filter(span=>span.proposal.evidence.trim()).map(span=>span.proposal);
    if(proposals.length&&proposalIssues(proposals,turns,fields).length)return null;
    const witness=witnesses.find(w=>w.p.field_id===original.field_id)||witnesses[0];
    return {proposals,binding:{resolved_index:resolvedIndex,original:structuredClone(original),source_sha256:digest(source),
        evidence_start:start,evidence_end:end,removed_span:{...removed,text:source.content.slice(removed.start,removed.end)},
        retained_spans:structuredClone(retained),correction_proposal_index:witness.index,
        correction_proposal:structuredClone(witness.p),correction_turn:structuredClone(correction),correction_turn_sha256:digest(correction),
        ...(witnesses.length>1?{equivalent_correction_proposal_indices:witnesses.map(w=>w.index)}:{}),
        rule:'EXACT_POSITIVE_COUNT_PARTITION'}};
}
