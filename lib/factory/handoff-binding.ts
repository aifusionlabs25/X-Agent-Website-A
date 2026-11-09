import { digest,proposalIssues,recordHandoffAttempt,type Field,type Handoff,type Proposal,type ReferenceBinding } from './handoff.ts';
import { projectSpeechFragments,type FragmentBinding } from './handoff-fragments.ts';
import { selectCurrentProposals } from './handoff-current.ts';

export type HandoffToolIdentity={local_session_id:string;provider_session_id:string;tool_call_id:string};

/** A provider may copy an exact quote but pair it with the preceding user ID.
 * Resolve only that mechanical mismatch against this session's committed turns.
 * No text normalization, invented combined source or archived lookup. A separate
 * audited selection can omit an explicitly superseded same-field proposal.
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
    const requestTurnId=state.handoff_requests?.at(-1)?.visitor_message_id??null;
    if(requestTurnId&&attempts.some(a=>a.request_turn_id===requestTurnId))
        throw new Error('This visitor request already has a retained preparation attempt; do not retry it');
    if(attempts.length>=24)throw new Error('Handoff binding evidence bound reached');
    const original=structuredClone(input??null);let resolved=structuredClone(original);
    const bindings:ReferenceBinding[]=[],fragmentBindings:FragmentBinding[]=[];
    if(Array.isArray(resolved)&&resolved.length>0&&resolved.length<=24) {
        const issues=proposalIssues(resolved,state.turns,fields);
        const projections=new Map<number,Proposal[]>();
        for(const issue of issues) {
            // Assistant IDs, invalid fields/schema/values and missing evidence
            // never gain an alternate source. Already-valid references stay untouched.
            if(issue.index<0||issue.problems.length!==1)continue;
            const p=resolved[issue.index] as Proposal;
            const unknownNativeReference=issue.problems[0]==='UNKNOWN_VISITOR_MESSAGE'
                && /^user::[a-f0-9-]{36}$/i.test(p.visitor_message_id)
                && !state.turns.some(t=>t.id===p.visitor_message_id);
            if(issue.problems[0]!=='EVIDENCE_NOT_EXACT_SPAN_OF_REFERENCED_MESSAGE'&&!unknownNativeReference)continue;
            const matches=state.turns.filter(t=>t.role==='user'&&t.content.includes(p.evidence));
            if(matches.length===0) {
                if(unknownNativeReference)continue; // Unknown IDs require one existing exact span, never fragment reconstruction.
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
    const selection=selectCurrentProposals(resolved,state.turns,fields);
    const candidate=proposalIssues(selection.selected,state.turns,fields).length?original:selection.selected;
    const result=recordHandoffAttempt(state,candidate,fields,requestId);
    if(!result.accepted&&state.quarantined_proposals?.at(-1)?.request_id===requestId)
        state.quarantined_proposals[state.quarantined_proposals.length-1].proposals=structuredClone(original);
    if(result.accepted&&bindings.length)result.reference_bindings=structuredClone(bindings);
    if(result.accepted&&fragmentBindings.length)result.fragment_bindings=structuredClone(fragmentBindings);
    if(result.accepted&&selection.superseded.length) {
        result.superseded_proposals=structuredClone(selection.superseded);
        result.instruction+=' Earlier contradicted proposals were excluded in favor of exact supplied corrections. Only the selected current proposals await owner review; the original history remains retained.';
    }
    const attempt={request_id:requestId,...identity,request_turn_id:requestTurnId,input_sha256:inputHash,local_turns_sha256:digest(state.turns),
        original_proposals:original,resolved_proposals:resolved,selected_proposals:structuredClone(selection.selected),
        superseded_proposals:selection.superseded,bindings,fragment_bindings:fragmentBindings,applied:result.accepted,result:structuredClone(result)};
    state.handoff_binding_attempts=[...attempts,attempt];
    state.receipts.push({at:new Date().toISOString(),kind:'HANDOFF_REFERENCE_BINDING',sha256:digest(attempt)});
    return result;
}
