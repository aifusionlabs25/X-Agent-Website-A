import { digest,proposalIssues,recordHandoffAttempt,type Field,type Handoff,type Proposal,type ReferenceBinding } from './handoff.ts';
import { projectSpeechFragments,type FragmentBinding } from './handoff-fragments.ts';
import { selectCurrentProposals } from './handoff-current.ts';
import { preserveQuotedValue } from './handoff-format.ts';
import { projectCurrentFact,type CurrentFactSelection } from './handoff-current-spans.ts';
import {includeProvenCorrections} from './handoff-correction-evidence.ts';

export type HandoffToolIdentity={local_session_id:string;provider_session_id:string;tool_call_id:string};

/** A provider may copy an exact quote but pair it with the preceding user ID.
 * Resolve only that mechanical mismatch against this session's committed turns.
 * No text normalization, invented combined source or archived lookup. A separate
 * audited format adaptation preserves a full quote when its value was only an
 * exact excerpt. Selection can omit an explicitly superseded same-field proposal.
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
    const original=structuredClone(input??null);let resolved:unknown=structuredClone(original);
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
    const format=preserveQuotedValue(resolved,state.turns,fields);
    resolved=format.proposals;
    // Validate the complete derived batch atomically. Diagnostics refer to these
    // selected rows; quarantine and the audit retain the unchanged raw payload.
    // Never fall back to raw input that could bypass a derived correction guard.
    // Only a current, explicit, unconsumed local-review request permits host
    // completion of a mechanically proved correction. Legacy/unbound calls
    // retain their original strict missing-witness behavior.
    const correctionEvidence=requestTurnId!==null
        ?includeProvenCorrections(resolved,state.turns,fields):{proposals:resolved,bindings:[]};
    const selection=selectCurrentProposals(correctionEvidence.proposals,state.turns,fields);
    const priorSelections:Array<{proposal_id:string;binding:CurrentFactSelection;proposals:Proposal[]}>=[];
    let candidate=selection.selected;
    if(Array.isArray(candidate)) {
        candidate=[...candidate];
        state.proposals.forEach(({id,...raw},index)=>{
            const projection=projectCurrentFact(raw,correctionEvidence.proposals,state.turns,fields,index);
            if(!projection) {
                const atomic=selectCurrentProposals([raw,...candidate as Proposal[]],state.turns,fields);
                if(atomic.superseded.some(row=>row.resolved_index===0))return;
                // An unsupported/ambiguous stored correction must keep this
                // provider update blocked, not leave stale active rows behind
                // a successful preparation receipt.
                if(proposalIssues([raw],state.turns,fields).some(issue=>issue.problems.includes('LATER_EXPLICIT_CORRECTION_REQUIRES_CURRENT_EVIDENCE'))
                    &&!(candidate as unknown[]).some(row=>digest(row)===digest(raw)))
                    (candidate as Proposal[]).push(raw);
                return;
            }
            priorSelections.push({proposal_id:id,...projection});
        });
        for(const partition of priorSelections)for(const p of partition.proposals)
            if(!(candidate as unknown[]).some(row=>digest(row)===digest(p)))(candidate as Proposal[]).push(p);
    }
    // Stage validation and every archive change together. Invalid siblings or
    // evidence bounds cannot retire a prior mapping, lose a detail or transfer
    // its owner decision. Historical rejected attempts are never rerun.
    const staged=structuredClone(state);
    const result=recordHandoffAttempt(staged,candidate,fields,requestId);
    const retired=priorSelections;
    if(result.accepted&&retired.length) {
        // The legacy atomic replacement may already have archived a one-line
        // quote. Enrich only an entry created in this staged call; never replace
        // a historical archive or omit the one-to-many residual provenance.
        const historicalArchiveCount=state.superseded_mappings?.length||0;
        const retainedArchives=(staged.superseded_mappings||[]).filter((row,index)=>
            index<historicalArchiveCount||!retired.some(item=>item.proposal_id===row.proposal.id));
        if(retainedArchives.length+retired.length>200)throw new Error('Superseded mapping evidence bound reached');
        const archives=retired.map(row=>({
            proposal:structuredClone(state.proposals.find(p=>p.id===row.proposal_id)!),
            replacement_proposal_id:digest(row.binding.correction_proposal),
            retained_proposal_ids:row.proposals.map(p=>digest(p)),
            correction_turn:structuredClone(row.binding.correction_turn),
            correction_turn_sha256:row.binding.correction_turn_sha256,
            prior_decision:structuredClone(state.decisions.find(d=>d.proposal_id===row.proposal_id)||null),
            current_fact_selection:structuredClone(row.binding)}));
        staged.superseded_mappings=[...retainedArchives,...archives];
        staged.proposals=staged.proposals.filter(p=>!retired.some(row=>row.proposal_id===p.id));
    }
    Object.assign(state,staged);
    if(!result.accepted&&state.quarantined_proposals?.at(-1)?.request_id===requestId)
        state.quarantined_proposals[state.quarantined_proposals.length-1].proposals=structuredClone(original);
    if(result.accepted&&bindings.length)result.reference_bindings=structuredClone(bindings);
    if(result.accepted&&fragmentBindings.length)result.fragment_bindings=structuredClone(fragmentBindings);
    if(result.accepted&&format.bindings.length)result.format_bindings=structuredClone(format.bindings);
    if(result.accepted&&correctionEvidence.bindings.length)result.correction_evidence_bindings=structuredClone(correctionEvidence.bindings);
    if(result.accepted&&selection.current_fact_selections.length)result.current_fact_selections=structuredClone(selection.current_fact_selections);
    if(result.accepted&&retired.length)result.prior_current_fact_selections=structuredClone(retired.map(row=>row.binding));
    if(result.accepted&&(selection.current_fact_selections.length||retired.length))
        result.instruction+=' Only explicitly corrected count assertions were removed. Their other exact details remain separate proposals, and the supplied correction keeps its original field. All original quotes and owner decisions remain historical evidence; no new proposal is owner-approved.';
    if(result.accepted&&selection.superseded.length) {
        result.superseded_proposals=structuredClone(selection.superseded);
        result.instruction+=' Earlier contradicted proposals were excluded in favor of exact supplied corrections. Only the selected current proposals await owner review; the original history remains retained.';
    }
    const attempt={request_id:requestId,...identity,request_turn_id:requestTurnId,input_sha256:inputHash,local_turns_sha256:digest(state.turns),
        through_visitor_turn_id:state.turns.filter(t=>t.role==='user').at(-1)?.id??null,
        correction_evidence_bindings:correctionEvidence.bindings,
        original_proposals:original,resolved_proposals:resolved,selected_proposals:structuredClone(candidate),
        current_fact_selections:selection.current_fact_selections,prior_current_fact_selections:priorSelections.map(row=>row.binding),
        superseded_proposals:selection.superseded,bindings,fragment_bindings:fragmentBindings,format_bindings:format.bindings,
        applied:result.accepted,result:structuredClone(result)};
    state.handoff_binding_attempts=[...attempts,attempt];
    state.receipts.push({at:new Date().toISOString(),kind:'HANDOFF_REFERENCE_BINDING',sha256:digest(attempt)});
    return result;
}
