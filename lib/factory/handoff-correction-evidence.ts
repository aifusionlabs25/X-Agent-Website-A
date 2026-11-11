import {digest,proposalIssues,type Field,type Proposal,type Turn} from './handoff.ts';
import {contradictingCorrection} from './handoff-corrections.ts';
import {projectCurrentFact} from './handoff-current-spans.ts';

export type CorrectionEvidenceBinding={original_index:number;field_id:string;correction_turn:Turn;
    correction_turn_sha256:string;proposal:Proposal;rule:'PROVEN_SAME_FIELD_COUNT_CORRECTION'};

/** Supply a missing exact correction only when the existing partition proof
 * establishes one unambiguous same-field count replacement. Never classify a
 * new field, rewrite a quote, repair a malformed sibling, or invent facts.
 * The full correction (including uncertainty) remains a separate proposal;
 * residual source spans and strict atomic validation still follow. */
export function includeProvenCorrections(input:unknown,turns:Turn[],fields:Field[]) {
    const bindings:CorrectionEvidenceBinding[]=[];
    if(!Array.isArray(input)||!input.length||input.length>24)return {proposals:input,bindings};
    const issues=proposalIssues(input,turns,fields);
    const stale=issues.filter(i=>i.problems.length===1&&i.problems[0]==='LATER_EXPLICIT_CORRECTION_REQUIRES_CURRENT_EVIDENCE');
    const proposals:Proposal[]=[...input];
    for(const issue of stale) {
        const original=input[issue.index] as Proposal;
        const correction=contradictingCorrection(turns,original.visitor_message_id,original.evidence);
        if(!correction||input.some(p=>p?.visitor_message_id===correction.id))continue;
        // Different field interpretations cannot be resolved mechanically.
        const related=stale.filter(i=>contradictingCorrection(turns,input[i.index].visitor_message_id,input[i.index].evidence)?.id===correction.id);
        if(new Set(related.map(i=>input[i.index].field_id)).size!==1)continue;
        if(bindings.some(b=>b.correction_turn.id===correction.id)||proposals.length>=24)continue;
        const proposal:Proposal={field_id:original.field_id,visitor_message_id:correction.id,evidence:correction.content,value:correction.content};
        if(proposalIssues([proposal],turns,fields).length)continue;
        const candidate=[...proposals,proposal];
        if(!projectCurrentFact(original,candidate,turns,fields,issue.index))continue;
        proposals.push(proposal);
        bindings.push({original_index:issue.index,field_id:original.field_id,correction_turn:structuredClone(correction),
            correction_turn_sha256:digest(correction),proposal:structuredClone(proposal),rule:'PROVEN_SAME_FIELD_COUNT_CORRECTION'});
    }
    return {proposals,bindings};
}
