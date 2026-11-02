import { digest,proposalIssues,type Field,type Proposal,type Turn } from './handoff.ts';
import { contradictingCorrection } from './handoff-corrections.ts';

export type SupersededProposal = {
    resolved_index:number;replacement_resolved_index:number;field_id:string;
    original:Proposal;replacement:Proposal;correction_turn_id:string;correction_turn_sha256:string;
};

/** Selection, not evidence repair. Only remove a stale mapping when this SAME
 * tool batch supplies exactly one valid whole correction for the SAME field.
 * Missing/ambiguous/invalid replacements leave the strict rejection in place.
 * Original words and discarded proposals remain available in the binding audit.
 */
export function selectCurrentProposals(input:unknown,turns:Turn[],fields:Field[]) {
    const superseded:SupersededProposal[]=[];
    if(!Array.isArray(input)||!input.length||input.length>24)return {selected:input,superseded};
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
        if(candidates.length!==1)continue;
        const replacement=candidates[0];
        superseded.push({resolved_index:issue.index,replacement_resolved_index:replacement.index,
            field_id:original.field_id,original:structuredClone(original),replacement:structuredClone(replacement.p),
            correction_turn_id:correction.id,correction_turn_sha256:digest(correction)});
    }
    return {selected:input.filter((_,index)=>!superseded.some(s=>s.resolved_index===index)),superseded};
}
