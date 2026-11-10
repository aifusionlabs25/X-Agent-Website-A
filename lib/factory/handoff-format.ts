import { digest,proposalIssues,type Field,type Proposal,type Turn } from './handoff.ts';

export type FormatBinding={resolved_index:number;field_id:string;visitor_message_id:string;
    rule:'PRESERVE_FULL_VERBATIM_EVIDENCE';original_value:string;
    evidence_start:number;evidence_end:number;value_start:number;value_end:number;source_sha256:string};

/** Provider-only format adaptation, never factual acceptance. A provider can
 * supply a short verbatim value inside a longer, exact evidence quote. Keep the
 * entire quote as the proposed value: narrowing the evidence could erase a
 * negation, condition or uncertainty. Preserve the original value and its exact
 * source offsets. Unknown/ambiguous sources, paraphrases and malformed rows do
 * not qualify. The unchanged strict verifier still rejects stale facts and
 * invalid lifecycle states after this mechanical adaptation. */
export function preserveQuotedValue(input:unknown,turns:Turn[],fields:Field[]) {
    const proposals=structuredClone(input),bindings:FormatBinding[]=[];
    if(!Array.isArray(proposals)||!proposals.length||proposals.length>24)return {proposals,bindings};
    for(const issue of proposalIssues(proposals,turns,fields)) {
        if(issue.index<0||!issue.problems.includes('VALUE_MUST_EQUAL_EXACT_EVIDENCE')
            ||issue.problems.some(p=>!['VALUE_MUST_EQUAL_EXACT_EVIDENCE','LATER_EXPLICIT_CORRECTION_REQUIRES_CURRENT_EVIDENCE'].includes(p)))continue;
        const p=proposals[issue.index] as Proposal;
        if(typeof p.value!=='string'||!p.value.trim())continue;
        const offset=p.evidence.indexOf(p.value);
        if(offset<0||offset!==p.evidence.lastIndexOf(p.value))continue;
        const source=turns.find(t=>t.role==='user'&&t.id===p.visitor_message_id)!;
        const start=source.content.indexOf(p.evidence);
        if(start<0||start!==source.content.lastIndexOf(p.evidence))continue;
        bindings.push({resolved_index:issue.index,field_id:p.field_id,visitor_message_id:source.id,
            rule:'PRESERVE_FULL_VERBATIM_EVIDENCE',original_value:p.value,
            evidence_start:start,evidence_end:start+p.evidence.length,
            value_start:start+offset,value_end:start+offset+p.value.length,source_sha256:digest(source)});
        p.value=p.evidence;
    }
    return {proposals,bindings};
}
