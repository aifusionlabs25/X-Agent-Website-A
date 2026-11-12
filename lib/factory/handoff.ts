import { contradictingCorrection } from './handoff-corrections.ts';
import type { SupersededProposal } from './handoff-current';
/** Generic evidence boundary. Streamed speech is NOT certified by this verifier. */
import { createHash } from 'node:crypto';
import type { SdkCloseReceipt } from './sdk-close';
import type { ContextSendReceipt,contextAssurance } from './context-send';
import type { FragmentBinding } from './handoff-fragments';
import type { FormatBinding } from './handoff-format';
import type { CurrentFactSelection } from './handoff-current-spans';
import type {CorrectionEvidenceBinding} from './handoff-correction-evidence';
import type {HandoffOutputReceipt} from './handoff-output-gate';
import type {FailureSpeechReceipt} from './handoff-failure-speech';
import { reconcileTranscript,type ProviderTranscript,type Reconciliation } from './transcript-reconciliation.ts';
import { clearExit,closingCourtesy } from './visitor-exit.ts';
import { requestedHandoffSpan } from './handoff-request.ts';
export { clearExit } from './visitor-exit.ts';
export type Field = {id:string; label:string};
export type Turn = {id:string; role:'user'|'persona'; content:string};
export type Proposal = {field_id:string; visitor_message_id:string; evidence:string; value:string};
export type ReferenceBinding = {index:number;from_message_id:string;to_message_id:string;start:number;end:number;source_sha256:string};
export type Decision = {proposal_id:string; decision:'ACCEPT'|'REJECT'; at:string};
export type SupersededMapping = {proposal:Proposal & {id:string};replacement_proposal_id:string;
    correction_turn:Turn;correction_turn_sha256:string;prior_decision:Decision|null;
    retained_proposal_ids?:string[];current_fact_selection?:CurrentFactSelection};
export type HandoffResult = {
    status:'PENDING_OWNER_REVIEW'|'UNMAPPED_OWNER_REVIEW'; accepted:boolean;
    accepted_proposal_count:number; owner_approved:false; submission_status:'UNSUBMITTED'; external_actions:never[];
    reason?:string; issues:Array<{index:number;field_id:string|null;problems:string[]}>;
    reference_bindings?:ReferenceBinding[];
    fragment_bindings?:FragmentBinding[];
    format_bindings?:FormatBinding[];
    superseded_proposals?:SupersededProposal[];
    current_fact_selections?:CurrentFactSelection[];
    prior_current_fact_selections?:CurrentFactSelection[];
    correction_evidence_bindings?:CorrectionEvidenceBinding[];
    visitor_message:string; instruction:string;
};
export type Handoff = {
    id:string; version:number; package_sha256:string; persona_id:string; launch_label:string;
    status:'RESERVED'|'TOKEN_READY'|'ACTIVE'|'CLOSING_PENDING'|'CLOSED'; provider_session_id:string|null;
    turns:Turn[]; proposals:Array<Proposal & {id:string}>; decisions:Decision[];
    superseded_mappings?:SupersededMapping[];
    receipts:Array<{at:string; kind:string; sha256:string}>; processed:string[];
    provider_release_verified:boolean; provider_transcript_verified:boolean;
    provider_evidence?:unknown;
    transcript_reconciliations?:Reconciliation[];
    tool_events?:Array<{tool_call_id:string;tool_name:string;phase:string;result:unknown;exposure:string}>;
    handoff_requests?:Array<{visitor_message_id:string;evidence:string;start:number;end:number;offer_turn_id?:string;offer_evidence?:string;
        source:'HOST_PERSISTED_VISITOR_REQUEST';status:'REQUESTED_NOT_MAPPED'}>;
    visitor_exit?:{visitor_message_id:string;evidence:string;source:'HOST_PERSISTED_VISITOR_EXIT'};
    closing_after_turn_id?:string;
    sdk_close_events?:Array<SdkCloseReceipt & {assurance:'CLIENT_INSTRUMENTATION_NOT_PROVIDER_RELEASE'}>;
    context_send_events?:Array<ContextSendReceipt & {payload_sha256:string;source_turn_sha256:string|null;assurance:typeof contextAssurance}>;
    handoff_output_events?:HandoffOutputReceipt[];
    handoff_failure_speech_events?:FailureSpeechReceipt[];
    quarantined_proposals?:Array<{request_id:string;proposals:unknown;reason:string}>;
    handoff_binding_attempts?:Array<{request_id:string;tool_call_id:string;local_session_id:string;provider_session_id:string;
        request_turn_id?:string|null;
        through_visitor_turn_id?:string|null;
        correction_evidence_bindings?:CorrectionEvidenceBinding[];
        input_sha256:string;local_turns_sha256:string;original_proposals:unknown;resolved_proposals:unknown;
        selected_proposals?:unknown;superseded_proposals?:SupersededProposal[];
        current_fact_selections?:CurrentFactSelection[];prior_current_fact_selections?:CurrentFactSelection[];
        bindings:ReferenceBinding[];fragment_bindings?:FragmentBinding[];format_bindings?:FormatBinding[];applied:boolean;result:HandoffResult}>;
    evidence_reviewed:boolean; approved:boolean; submission_status:'UNSUBMITTED'; external_actions:never[];
};
export const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function appendSdkCloseEvidence(state:Handoff,event:SdkCloseReceipt) {
    const keys=['at','invocation_id','launch_label','local_session_id','method','phase','provider_session_id','reason'];
    if(!event||Object.keys(event).sort().join()!==keys.sort().join()
        ||event.local_session_id!==state.id||event.launch_label!==state.launch_label
        ||event.provider_session_id!==state.provider_session_id||event.method!=='stopStreaming'
        ||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(event.invocation_id||'')
        ||!['VISITOR_EXIT','OWNER_FINISH','UNMOUNT','BIND_FAILED'].includes(event.reason)
        ||!['INVOKED','RESOLVED','REJECTED'].includes(event.phase)
        ||typeof event.at!=='string'||!Number.isFinite(Date.parse(event.at))
        ||!['TOKEN_READY','ACTIVE','CLOSING_PENDING','CLOSED'].includes(state.status))
        throw new Error('SDK close receipt must bind the exact local/provider session and supported method');
    const rows=state.sdk_close_events||[],same=rows.filter(e=>e.invocation_id===event.invocation_id);
    const duplicate=same.find(e=>e.phase===event.phase);
    const record={...event,assurance:'CLIENT_INSTRUMENTATION_NOT_PROVIDER_RELEASE' as const};
    if(duplicate){if(Object.entries(record).some(([k,v])=>Reflect.get(duplicate,k)!==v))throw new Error('SDK close evidence is immutable');return;}
    if(rows.length>=16)throw new Error('SDK close evidence bound reached');
    if(same.some(e=>e.reason!==event.reason||e.method!==event.method))throw new Error('SDK close invocation binding changed');
    if(event.phase==='INVOKED'&&same.length||event.phase!=='INVOKED'&&(!same.some(e=>e.phase==='INVOKED')||same.some(e=>e.phase!=='INVOKED')))
        throw new Error('SDK close phases must preserve one invocation and its actual result');
    if(same.some(e=>Date.parse(e.at)>Date.parse(event.at)))throw new Error('SDK close event order changed');
    state.sdk_close_events=[...rows,record];
    // No status, provider-release, transcript, fact or approval mutation here.
}
export function assertProposal(p:Proposal, turns:Turn[], fields:Field[]) {
    if (!p || Object.keys(p).sort().join() !== ['evidence','field_id','value','visitor_message_id'].sort().join()
        || !fields.some(f=>f.id===p.field_id) || typeof p.evidence!=='string' || !p.evidence.trim()
        || contradictingCorrection(turns,p.visitor_message_id,p.evidence)
        || p.evidence.length>4000 || typeof p.value!=='string' || p.value!==p.evidence
        || !turns.some(t=>t.role==='user' && t.id===p.visitor_message_id && t.content.includes(p.evidence))) {
        throw new Error('Mapping requires a known field and an exact persisted visitor span; value must remain verbatim');
    }
}
export function appendTurn(state:Handoff, turn:Turn) {
    if (!['ACTIVE','CLOSING_PENDING'].includes(state.status)) throw new Error('Conversation is not accepting turns');
    if (!turn || !['user','persona'].includes(turn.role) || typeof turn.id!=='string' || !/^[\w:.-]{1,200}$/.test(turn.id) || turn.id.startsWith('provider-capture:')
        || typeof turn.content!=='string' || !turn.content.trim() || turn.content.length>8000 || state.turns.length>=200) throw new Error('Invalid finalized turn');
    const previous = state.turns.find(t=>t.id===turn.id);
    if (previous) { if (JSON.stringify(previous)!==JSON.stringify(turn)) throw new Error('Finalized evidence is immutable'); return; }
    // Native speech may finalize one goodbye as several courtesy fragments.
    // Retain those verbatim, without reopening intake for new substantive turns.
    if (state.status==='CLOSING_PENDING' && turn.role==='user' && !closingCourtesy(turn.content)) throw new Error('Visitor exit has begun');
    state.turns.push({...turn});
    state.approved=false; state.evidence_reviewed=false; state.provider_transcript_verified=false;
    if(turn.role==='user') {
        const request=requestedHandoffSpan(turn.content,{precedingTurn:state.turns.at(-2),hasSuccessfulHandoff:Boolean(state.handoff_binding_attempts?.some(a=>
            a.applied===true&&a.result.accepted===true&&a.request_turn_id!==undefined))});
        if(request) {
            const row={visitor_message_id:turn.id,...request,source:'HOST_PERSISTED_VISITOR_REQUEST' as const,status:'REQUESTED_NOT_MAPPED' as const};
            state.handoff_requests=[...(state.handoff_requests||[]),row];
            state.receipts.push({at:new Date().toISOString(),kind:'HANDOFF_REQUESTED',sha256:digest(row)});
            // This is neither a provider tool call nor a prepared/mapped brief.
        }
        if(clearExit(turn.content)) {
            beginClosing(state);
            if(!state.visitor_exit) {
                state.visitor_exit={visitor_message_id:turn.id,evidence:turn.content,source:'HOST_PERSISTED_VISITOR_EXIT'};
                state.receipts.push({at:new Date().toISOString(),kind:'VISITOR_EXIT_REQUESTED',sha256:digest(state.visitor_exit)});
            }
        }
    }
}
export function beginClosing(state:Handoff) {
    if(!['ACTIVE','CLOSING_PENDING'].includes(state.status))throw new Error('Session cannot begin closing');
    if(state.status==='ACTIVE')state.closing_after_turn_id=state.turns.at(-1)?.id;
    state.status='CLOSING_PENDING';
}

/** Called only after server-side provider/persona/launch authentication. This
 * adds provenance and missed provider evidence, never rewrites original turns
 * or grants provider release, session closure or owner approval. */
export function reconcileVisitorEvidence(state:Handoff,transcript:ProviderTranscript) {
    if(!state.provider_session_id)throw new Error('Bound provider session required');
    const previous=(state.provider_evidence as {transcript?:ProviderTranscript}|undefined)?.transcript;
    const receipt=reconcileTranscript({provider_session_id:state.provider_session_id,turns:state.turns,transcript,previous_transcript:previous});
    const history=state.transcript_reconciliations||[];
    const duplicate=history.some(r=>digest(r)===digest(receipt));
    if(!duplicate&&history.length>=24)throw new Error('Transcript reconciliation evidence bound reached');
    const additions:Turn[]=[];
    // Never append a combined visitor turn already covered by exact local
    // spans. Provider-only whole turns and missing assistant records are kept.
    if(receipt.reason!=='INVALID_TRANSCRIPT')transcript.messages.forEach((p,i)=>{
        if(!p.message.trim())return;
        const missing=p.role==='user'?receipt.verified&&receipt.provider_only_message_indices.includes(i)
            :!state.turns.some(t=>t.role===p.role&&t.content===p.message);
        if(!missing)return;
        const turn={id:'provider-capture:'+i+':'+digest(p).slice(0,12),role:p.role,content:p.message};
        const prior=state.turns.find(t=>t.id===turn.id);
        if(prior){if(digest(prior)!==digest(turn))throw new Error('Provider capture identity conflict');return;}
        additions.push(turn);
    });
    if(state.turns.length+additions.length>200)throw new Error('Finalized evidence bound reached');
    if(!duplicate)state.transcript_reconciliations=[...history,receipt];
    state.provider_transcript_verified=receipt.verified;
    state.turns.push(...additions);
    if(!receipt.verified||additions.length){state.evidence_reviewed=false;state.approved=false;}
    return receipt;
}
export function propose(state:Handoff, proposals:Proposal[], fields:Field[]) {
    if (!['ACTIVE','CLOSED'].includes(state.status)
        && !(state.status==='CLOSING_PENDING'&&state.handoff_requests?.length)) throw new Error('Handoff proposals are not available during closure without a retained request');
    if (!Array.isArray(proposals) || proposals.length===0 || proposals.length>24) throw new Error('A nonempty bounded set of exact proposals is required');
    for (const p of proposals) assertProposal(p,state.turns,fields);
    // Replace only a validated same-field correction, never the whole field.
    // Keep every original quote, source, decision and correction in the archive.
    // Compound older quotes remain flagged for owner review: silently removing
    // one would also discard independent facts that have not been remapped.
    const replacements:SupersededMapping[]=[];
    for(const prior of state.proposals) {
        const correction=contradictingCorrection(state.turns,prior.visitor_message_id,prior.evidence);
        if(!correction||prior.evidence.split(/[.!?;\n]+/).filter(s=>s.trim()).length!==1
            ||/[,;:()\n]|\b(?:and|but|also|plus|with)\b/i.test(prior.evidence)
            ||(prior.evidence.match(/\b\d+\b/g)||[]).length>1)continue;
        const candidates=proposals.filter(p=>p.field_id===prior.field_id&&p.visitor_message_id===correction.id
            &&p.evidence===correction.content&&p.value===correction.content);
        const unique=[...new Map(candidates.map(p=>[digest(p),p])).values()];
        if(unique.length!==1)continue;
        replacements.push({proposal:structuredClone(prior),replacement_proposal_id:digest(unique[0]),
            correction_turn:structuredClone(correction),correction_turn_sha256:digest(correction),
            prior_decision:structuredClone(state.decisions.find(d=>d.proposal_id===prior.id)||null)});
    }
    if((state.superseded_mappings?.length||0)+replacements.length>200)throw new Error('Superseded mapping evidence bound reached');
    if(replacements.length) {
        state.superseded_mappings=[...(state.superseded_mappings||[]),...replacements];
        state.proposals=state.proposals.filter(p=>!replacements.some(r=>r.proposal.id===p.id));
    }
    for (const p of proposals) { const id=digest(p); if (!state.proposals.some(v=>v.id===id)) state.proposals.push({...p,id}); }
    state.approved=false; state.evidence_reviewed=false;
}

/** Diagnostics never repair a quote, choose another turn or relax assertProposal. */
export function proposalIssues(input:unknown, turns:Turn[], fields:Field[]):HandoffResult['issues'] {
    if(!Array.isArray(input)||input.length===0||input.length>24)
        return [{index:-1,field_id:null,problems:['NONEMPTY_BOUNDED_PROPOSALS_REQUIRED']}];
    return input.flatMap((item,index)=>{
        const p=item as Proposal,problems:string[]=[];
        if(!p||typeof p!=='object'||Object.keys(p).sort().join()!==['evidence','field_id','value','visitor_message_id'].sort().join())
            return [{index,field_id:null,problems:['EXACT_PROPOSAL_SCHEMA_REQUIRED']}];
        if(!fields.some(f=>f.id===p.field_id))problems.push('UNKNOWN_FIELD');
        const turn=turns.find(t=>t.role==='user'&&t.id===p.visitor_message_id);
        if(!turn)problems.push('UNKNOWN_VISITOR_MESSAGE');
        if(typeof p.evidence!=='string'||!p.evidence.trim()||p.evidence.length>4000)problems.push('INVALID_EVIDENCE_SPAN');
        else if(turn&&!turn.content.includes(p.evidence))problems.push('EVIDENCE_NOT_EXACT_SPAN_OF_REFERENCED_MESSAGE');
        if(typeof p.evidence==='string'&&turn&&contradictingCorrection(turns,p.visitor_message_id,p.evidence))problems.push('LATER_EXPLICIT_CORRECTION_REQUIRES_CURRENT_EVIDENCE');
        if(typeof p.value!=='string'||p.value!==p.evidence)problems.push('VALUE_MUST_EQUAL_EXACT_EVIDENCE');
        return problems.length?[{index,field_id:typeof p.field_id==='string'?p.field_id:null,problems}]:[];
    });
}

/** Runs inside the existing atomic store commit. No business-success inference
 * follows from an SDK 'completed' event, and mixed invalid batches stay atomic. */
export function recordHandoffAttempt(state:Handoff,input:unknown,fields:Field[],requestId:string):HandoffResult {
    try {
        propose(state,input as Proposal[],fields);
        return {status:'PENDING_OWNER_REVIEW',accepted:true,accepted_proposal_count:(input as Proposal[]).length,
            owner_approved:false,submission_status:'UNSUBMITTED',external_actions:[],issues:[],
            visitor_message:'The selected information is retained as proposals for owner review. Nothing has been sent or approved.',
            instruction:'Report only that selected proposals are retained pending owner review. Do not claim every fact was captured, a complete brief is approved, delivery occurred or anyone will follow up.'};
    } catch(error) {
        state.quarantined_proposals??=[];
        if(state.quarantined_proposals.length>=24)throw new Error('Proposal review bound reached');
        const reason=error instanceof Error?error.message:'Proposal validation failed';
        state.quarantined_proposals.push({request_id:requestId,proposals:input??null,reason});
        state.evidence_reviewed=false;state.approved=false;
        return {status:'UNMAPPED_OWNER_REVIEW',accepted:false,accepted_proposal_count:0,
            owner_approved:false,submission_status:'UNSUBMITTED',external_actions:[],reason,
            issues:proposalIssues(input,state.turns,fields),
            visitor_message:'I have your request, but I could not prepare a valid handoff. Your original conversation is retained for owner review. Nothing has been sent.',
            instruction:'This preparation attempt failed. Tell the visitor using visitor_message. Do not say a brief is prepared or ready, or that the information was mapped. Do not retry automatically or ask the visitor to repeat the entire intake.'};
    }
}

export function appendToolEvidence(state:Handoff,event:NonNullable<Handoff['tool_events']>[number],providerSessionId:string) {
    if(!state.provider_session_id||providerSessionId!==state.provider_session_id||!/^[\w-]{1,200}$/.test(event.tool_call_id||'')
        ||!['factory_handoff','factory_end_session'].includes(event.tool_name)
        ||!['SDK_COMPLETED','SDK_FAILED'].includes(event.phase)||event.exposure!=='SDK_EVENT_NOT_PROOF_OF_MODEL_CONSUMPTION')
        throw new Error('Tool receipt session/name binding mismatch');
    const rows=state.tool_events||[],prior=rows.find(x=>x.tool_call_id===event.tool_call_id);
    if(prior){
        if(prior.tool_name!==event.tool_name||prior.phase!==event.phase||digest(prior.result)!==digest(event.result))
            throw new Error('Tool result evidence is immutable');
        return;
    }
    if(rows.length>=100)throw new Error('Tool evidence bound reached');
    state.tool_events=[...rows,event];
}
export function decide(state:Handoff, id:string, decision:'ACCEPT'|'REJECT', fields:Field[]) {
    const p=state.proposals.find(x=>x.id===id);
    if (!p || !['ACCEPT','REJECT'].includes(decision)) throw new Error('Unknown proposal/decision');
    if (!state.provider_transcript_verified) throw new Error('Provider transcript must be reconciled before owner mapping');
    if (decision==='ACCEPT') { const {id:_,...raw}=p; void _; assertProposal(raw,state.turns,fields); }
    if (state.decisions.some(x=>x.proposal_id===id)) throw new Error('Owner decision already recorded');
    state.decisions.push({proposal_id:id,decision,at:new Date().toISOString()}); state.approved=false;
}
export function approve(state:Handoff) {
    if (state.status!=='CLOSED' || !state.provider_release_verified || !state.provider_transcript_verified
        || !state.evidence_reviewed || !state.turns.some(t=>t.role==='user')
        || state.proposals.some(p=>!state.decisions.some(d=>d.proposal_id===p.id)
            ||state.decisions.some(d=>d.proposal_id===p.id&&d.decision==='ACCEPT')&&contradictingCorrection(state.turns,p.visitor_message_id,p.evidence))) throw new Error('Close, reconcile and review all original evidence/proposals before approval');
    state.approved=true;
}
