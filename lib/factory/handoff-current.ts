import { digest,proposalIssues,type Field,type Proposal,type Turn } from './handoff.ts';
import { contradictingCorrection } from './handoff-corrections.ts';
import { projectCurrentFact,type CurrentFactSelection } from './handoff-current-spans.ts';

export type SupersededProposal = {
    resolved_index:number;replacement_resolved_index:number;field_id:string;
    original:Proposal;replacement:Proposal;correction_turn_id:string;correction_turn_sha256:string;
};

/** Whole-note replacement is safe only for an atomic note. Compound quotes need
 * exact residual spans; their unrelated details must not disappear even when a
 * replacement happens to use the same field. No guessed/cross-field remapping.
 */
export function selectCurrentProposals(input:unknown,turns:Turn[],fields:Field[]) {
    const superseded:SupersededProposal[]=[],current_fact_selections:CurrentFactSelection[]=[];
    if(!Array.isArray(input)||!input.length||input.length>24)return {selected:input,superseded,current_fact_selections};
    const residuals=new Map<number,Proposal[]>();
    const issues=proposalIssues(input,turns,fields);
    for(const issue of issues) {
        if(issue.index<0||issue.problems.length!==1||issue.problems[0]!=='LATER_EXPLICIT_CORRECTION_REQUIRES_CURRENT_EVIDENCE')continue;
        const original=input[issue.index] as Proposal;
        const correction=contradictingCorrection(turns,original.visitor_message_id,original.evidence);
        if(!correction)continue;
        const candidates=input.map((p:Proposal,index:number)=>({p,index})).filter(({p,index})=>
            index!==issue.index&&!issues.some(i=>i.index===index)
            &&p.field_id===original.field_id&&p.visitor_message_id===correction.id
            &&p.evidence===correction.content&&p.value===correction.content);
        const projection=projectCurrentFact(original,input,turns,fields,issue.index);
        if(projection?.proposals.length) {
            current_fact_selections.push(projection.binding);residuals.set(issue.index,projection.proposals);
            continue;
        }
        const atomic=original.evidence.split(/[.!?;\n]+/).filter(s=>s.trim()).length===1
            &&!(/[,;:()\n]|\b(?:and|but|also|plus|with|that|who|which|where|when|while|if|unless|because|near|for|in|at|on|under|over|before|after|during|until|without|except|including|since|to|from|by|through|between|within|outside|beside|around|beyond|only|currently|formerly)\b/i.test(original.evidence))
            &&(original.evidence.match(/\b\d+\b/g)||[]).length<=1
            &&(!/\d/.test(original.evidence)||Boolean(projection));
        if(candidates.length===1&&atomic) {
            const replacement=candidates[0];
            superseded.push({resolved_index:issue.index,replacement_resolved_index:replacement.index,
                field_id:original.field_id,original:structuredClone(original),replacement:structuredClone(replacement.p),
                correction_turn_id:correction.id,correction_turn_sha256:digest(correction)});
            continue;
        }
        if(!projection)continue;
        current_fact_selections.push(projection.binding);residuals.set(issue.index,projection.proposals);
    }
    return {selected:input.flatMap((p,index)=>superseded.some(s=>s.resolved_index===index)?[]:residuals.get(index)??[p]),
        superseded,current_fact_selections};
}
