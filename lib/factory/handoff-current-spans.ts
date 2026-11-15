import {digest,proposalIssues,type Field,type Proposal,type Turn} from './handoff.ts';
import {contradictingCorrection,exactCorrectionWitness} from './handoff-corrections.ts';
import {countPattern,countTokens,countValue,countView} from './handoff-counts.ts';

export type CurrentFactSelection={
    resolved_index:number;original:Proposal;source_sha256:string;evidence_start:number;evidence_end:number;
    removed_span:{start:number;end:number;text:string};
    retained_spans:Array<{start:number;end:number;proposal:Proposal}>;
    correction_proposal_index:number;correction_proposal:Proposal;correction_turn:Turn;correction_turn_sha256:string;
    equivalent_correction_proposal_indices?:number[];
    rule:'EXACT_POSITIVE_COUNT_PARTITION';
};

// Keep the complete possessive subject/verb in the removable assertion. A
// bare count found after an unrecognized subject cannot safely lose that
// subject or its scope. Speech commonly realizes present possession as
// "we got", "we have got" or "we've got"; their actor and scope checks are
// identical to "we have", and the retained evidence is never normalized.
const possession=`(?:have(?:[ \\t]+got)?|got)`;
const personPossession=`(?:(?:we|i|they)[ \\t]+${possession}|(?:we|i|they)['’]ve[ \\t]+got)`;
const frames=new RegExp(`\\b(?:(?:${personPossession}|(?:our|the)[ \\t]+team[ \\t]+has|there[ \\t]+are|has)[ \\t]+)?(${countPattern})[ \\t]+([\\p{L}]+)\\b`,'giu');
const quoted=/["“”`]|(?:^|[\s([{])['‘]/u;
// These scopes can govern a later sentence. A narrow projection should decline
// narrated or hypothetical source material, rather than detach its frame.
const narrated=/\b(?:said|says|told|quoted|wrote|asked|imagine|suppose|pretend|hypothetical)\b|\b(?:for example|the example|an example)\b/i;

/** Prove a direct same-unit numeric contrast, in addition to the existing guard.
 * The guard also recognizes multiword negations, which alone do not establish
 * a replacement count. This helper only inspects source text; it rewrites none. */
function explicitActor(text:string):string|null {
    const person=/\b(we|i|they)(?:[ \t]+(?:have(?:[ \t]+got)?|got|are)|['’]ve[ \t]+got)[ \t]*$/i.exec(text);
    if(person)return person[1].toLowerCase();
    const team=/\b(our|my|their)[ \t]+team[ \t]+(?:has|is)[ \t]*$/i.exec(text);
    return team?({our:'we',my:'i',their:'they'} as Record<string,string>)[team[1].toLowerCase()]:null;
}
function directNumericContrast(correction:Turn,number:string,unit:string,actor:string|null):boolean {
    const content=countView(correction.content);
    for(const match of content.matchAll(/\bnot\s+(\d+)\s*(?=[.!?;,]|$)/gi)) {
        if(match[1]!==number)continue;
        const clause=content.slice(0,match.index).split(/[;.!?]/).at(-1)||'';
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

/** A business-subject "has" assertion may begin after its raw subject. Keep
 * that subject as an exact residual; reject qualifiers/narration rather than
 * infer their scope. The general count/actor checks still apply afterward. */
function businessSubjectPrefix(prefix:string,frame:string):boolean {
    if(!/^has[ \t]/i.test(frame)||/[?:：,;()\n]/.test(prefix))return false;
    if(/\b(?:if|unless|not|no|never|only|might|may|could|should|would|perhaps|maybe|think|guess|said|told|was|were|previously|formerly|temporarily|sometimes|occasionally|except|and|or|but|with|for)\b/i.test(prefix))return false;
    const subject=prefix.split(/[.!]/).at(-1)?.trim()||'';
    return /^(?:our|my|their|the|a|an)[ \t]+[\p{L}][\p{L} '\u2019-]{0,100}$/iu.test(subject);
}
function businessSubjectActor(prefix:string,frame:string):string|null {
    if(!businessSubjectPrefix(prefix,frame))return null;
    const subject=prefix.split(/[.!]/).at(-1)?.trim().toLowerCase()||'';
    if(subject.startsWith('our '))return 'we';
    if(subject.startsWith('my '))return 'i';
    if(subject.startsWith('their '))return 'they';
    // A named/indefinite subject is not automatically the caller or a third
    // party. An explicitly different actor needs review, not a guessed match.
    return 'unspecified-business-subject';
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
        &&p.value===p.evidence&&exactCorrectionWitness(source,correction,original.evidence,p.evidence));
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
        if(prefix.trim()&&!/(?:^|[.!?][ \t\r\n]+)(?:(?:uh|um)[, \t]+)?$/i.test(prefix)
            &&!businessSubjectPrefix(prefix,frame[0]))continue;
        if(/\.{2,}[ \t\r\n]*$/.test(prefix))continue;
        if(sourceFrames.filter(other=>countValue(other[1])===countValue(frame[1])&&other[2].toLowerCase()===frame[2].toLowerCase()).length!==1)continue;
        const after=source.content.slice(frameEnd),terminal=/^[ \t]*(?:[.!](?=\s|$)|$)/.exec(after);
        const relative=/^[ \t]+(?:that|who)[ \t]+\p{L}/iu.test(after);
        // A bare subject count may precede a positive work predicate. Remove
        // only the contradicted count; retain the predicate as an exact span.
        // A bare count subject may have an adverb before its work predicate.
        // Keep that whole predicate verbatim, without a business-verb phrase
        // list. Structural/conditional/modal prefixes do not prove this shape.
        const predicate=/^[ \t]+(?:(\p{L}+ly)[ \t]+)?(\p{L}+)[ \t]+\p{L}/iu.exec(after);
        const nonPredicate=/^(?:and|or|but|that|who|which|where|when|while|if|unless|with|without|for|in|at|on|under|over|before|after|during|until|except|including|since|to|from|by|through|between|within|outside|beside|around|beyond|is|are|was|were|have|has|had|may|might|can|could|should|would|must|not|no|never|only|formerly|previously|temporarily|sometimes|occasionally)$/i;
        const direct=countTokens(frame[0])[0]?.start===0&&Boolean(predicate)
            &&!nonPredicate.test(predicate![2])&&!(predicate![1]&&nonPredicate.test(predicate![1]));
        // The same exact partition applies to an unqualified positive work
        // participle ("We have 6 staff handling requests"). The complete work
        // clause stays in its original field with its original source offsets.
        const participle=/^[ \t]+\p{L}+ing[ \t]+\p{L}/iu.test(after);
        if(!terminal&&!relative&&!direct&&!participle)continue;
        // A question or another count inside the relative clause can change
        // the scope of the assertion; leave such cases to owner review.
        const sentenceTail=after.split(/[.!]/,1)[0];
        if((relative||direct||participle)&&(/[?]/.test(sentenceTail)||countTokens(sentenceTail).length))continue;
        if((direct||participle)&&/\b(?:if|unless|maybe|might|only|except|not|never)\b/i.test(sentenceTail))continue;
        if(participle&&/\b(?:formerly|previously|temporarily|sometimes|occasionally|until)\b/i.test(sentenceTail))continue;
        const removeEnd=terminal?frameEnd+terminal[0].length:frameEnd;
        if(frameStart<start||removeEnd>end)continue;
        const actor=explicitActor(frame[0].slice(0,frame[0].indexOf(frame[1])))??businessSubjectActor(prefix,frame[0]);
        if(contradictingCorrection(turns,source.id,frame[0])?.id!==correction.id
            ||!directNumericContrast(correction,countValue(frame[1])!,frame[2],actor))continue;
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
