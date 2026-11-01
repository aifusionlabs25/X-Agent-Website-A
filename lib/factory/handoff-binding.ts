import { digest,proposalIssues,recordHandoffAttempt,type Field,type Handoff,type Proposal,type ReferenceBinding } from './handoff.ts';
import { projectSpeechFragments,type FragmentBinding } from './handoff-fragments.ts';

export type HandoffToolIdentity={local_session_id:string;provider_session_id:string;tool_call_id:string};

/** A provider may copy an exact quote but pair it with the preceding user ID.
 * Resolve only that mechanical mismatch against this session's committed turns.
 * No text normalization, invented combined source, archived lookup or semantic choice.
 * Manual owner mappings continue to use the strict recordHandoffAttempt path. */
export function recordProviderHandoffAttempt(state:Handoff,input:unknown,fields:Field[],requestId:string,identity:HandoffToolIdentity) {
    if(!identity||identity.local_session_id!==state.id||!state.provider_session_id
        ||identity.provider_session_id!==state.provider_session_id||typeof identity.tool_call_id!=='string'||!/^[\w-]{1,200}$/.test(identity.tool_call_id))
        throw new Error('Handoff tool must bind the exact local and provider session');
    const inputHash=digest(input??null),attempts=state.handoff_binding_attempts||[];
    const prior=attempts.find(a=>a.tool_call_id===identity.tool_call_id);
    if(prior) {
        if(prior.local_session_id!==identity.local_session_id||prior.provider_session_id!==identity.provider_session_id
            ||prior.input_sha256!==inputHash)throw new Error('Handoff tool input is immutable');
        return structuredClone(prior.result); // Return the same committed outcome, never retry resolution.
    }
    if(attempts.length>=24)throw new Error('Handoff binding evidence bound reached');
    const original=structuredClone(input??null);let resolved=structuredClone(original);
    const bindings:ReferenceBinding[]=[],fragmentBindings:FragmentBinding[]=[];
    if(Array.isArray(resolved)&&resolved.length>0&&resolved.length<=24) {
        const issues=proposalIssues(resolved,state.turns,fields);
        const projections=new Map<number,Proposal[]>();
        for(const issue of issues) {
            // Unknown/assistant IDs, invalid fields/schema/values and missing evidence
            // never gain an alternate source. Already-valid references stay untouched.
            if(issue.index<0||issue.problems.length!==1||issue.problems[0]!=='EVIDENCE_NOT_EXACT_SPAN_OF_REFERENCED_MESSAGE')continue;
            const p=resolved[issue.index] as Proposal;
            const matches=state.turns.filter(t=>t.role==='user'&&t.content.includes(p.evidence));
            if(matches.length===0) {
                const projection=projectSpeechFragments(p,state.turns,issue.index);
                if(projection){projections.set(issue.index,projection.proposals);fragmentBindings.push(projection.binding);}
                continue;
            }
            if(matches.length!==1)continue;
            const source=matches[0],start=source.content.indexOf(p.evidence);
            if(start!==source.content.lastIndexOf(p.evidence))continue; // No ambiguous occurrence selection.
            bindings.push({index:issue.index,from_message_id:p.visitor_message_id,to_message_id:source.id,
                start,end:start+p.evidence.length,source_sha256:digest(source)});
            p.visitor_message_id=source.id;
        }
        resolved=resolved.flatMap((p,index)=>projections.get(index)||[p]);
    }
    // Preserve atomic rejection and its raw payload if any candidate still fails.
    // The unchanged strict verifier also checks lifecycle and every resolved row.
    const candidate=proposalIssues(resolved,state.turns,fields).length?original:resolved;
    const result=recordHandoffAttempt(state,candidate,fields,requestId);
    if(!result.accepted&&state.quarantined_proposals?.at(-1)?.request_id===requestId)
        state.quarantined_proposals[state.quarantined_proposals.length-1].proposals=structuredClone(original);
    if(result.accepted&&bindings.length)result.reference_bindings=structuredClone(bindings);
    if(result.accepted&&fragmentBindings.length)result.fragment_bindings=structuredClone(fragmentBindings);
    const attempt={request_id:requestId,...identity,input_sha256:inputHash,local_turns_sha256:digest(state.turns),
        original_proposals:original,resolved_proposals:resolved,bindings,fragment_bindings:fragmentBindings,applied:result.accepted,result:structuredClone(result)};
    state.handoff_binding_attempts=[...attempts,attempt];
    state.receipts.push({at:new Date().toISOString(),kind:'HANDOFF_REFERENCE_BINDING',sha256:digest(attempt)});
    return result;
}
