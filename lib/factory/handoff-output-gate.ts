import type {Handoff,Turn} from './handoff';
import {requestedHandoffSpan} from './handoff-request.ts';
import {clearExit} from './visitor-exit.ts';
import {contradictingCorrection} from './handoff-corrections.ts';

export type HandoffOutputEvent={event_id:string;at:string;visitor_message_id:string|null;muted:boolean;
    phase:'LISTENING'|'WAITING_RECEIPT'|'EARLY_REPLY_HELD'|'VERIFIED_RECEIPT'|'FAILED_RECEIPT'|'ORDINARY_REPLY'|'EXIT_REPLY';
    tool_call_id:string|null};
export type HandoffOutputReceipt=HandoffOutputEvent & {local_session_id:string;provider_session_id:string;launch_label:string};

/** Native generation is not host-controlled. Hold the media output from user
 * speech start, classify the finalized input before releasing it, and require
 * a current server receipt for handoff acknowledgment. A reply that began too
 * early stays held for its entire turn; a late receipt cannot expose its tail.
 * Original transcript remains intact. This is not acoustic-delivery proof. */
export function handoffOutputGate(options:{localSessionId:string;providerSessionId:()=>string|null;
    output:(muted:boolean)=>void;notice:(text:string)=>void;report:(event:HandoffOutputEvent)=>void;
    recoverFailure?:(toolCallId:string,visitorMessageId:string)=>void;
    id?:()=>string;now?:()=>string}) {
    let state:Handoff|null=null,turn:Turn|null=null,requestId:string|null=null;
    let guarded=false,earlyReply=false,accepted=false,settled=false,exiting=false,listening=false,phase:HandoffOutputEvent['phase']|null=null;
    let replyStarted=false,toolPending=false,activeToolId:string|null=null;
    const seen=new Set<string>(),startedTools=new Set<string>();
    function emit(next:HandoffOutputEvent['phase'],muted:boolean,tool:string|null=null) {
        options.output(muted);
        if(next===phase)return;
        phase=next;
        options.report({event_id:(options.id||(()=>crypto.randomUUID()))(),at:(options.now||(()=>new Date().toISOString()))(),
            visitor_message_id:turn?.id??null,phase:next,muted,tool_call_id:tool});
    }
    function verified() {
        if(!guarded||!state||!turn||exiting||listening)return;
        const a=state.handoff_binding_attempts?.at(-1);
        if(!a||a.through_visitor_turn_id!==turn.id
            ||activeToolId!==null&&a.tool_call_id!==activeToolId
            ||a.local_session_id!==state.id||a.provider_session_id!==state.provider_session_id
            ||!state.turns.some(t=>t.id===turn!.id&&t.role==='user'&&t.content===turn!.content))return;
        const requestBound=requestId!==null&&a.request_turn_id===requestId
            &&state.handoff_requests?.at(-1)?.visitor_message_id===requestId;
        // Rejection is terminal tool evidence, not preparation authority. A
        // matching active tool may fail even when no visitor request was
        // recognized. Do not turn that failure into endless waiting, nor let
        // an unbound accepted outcome acquire consent through this path.
        const failed=a.applied===false&&a.result.accepted===false&&a.result.status==='UNMAPPED_OWNER_REVIEW'
            &&a.result.accepted_proposal_count===0&&a.result.owner_approved===false
            &&a.result.submission_status==='UNSUBMITTED'&&a.result.external_actions.length===0
            &&(requestBound||activeToolId===a.tool_call_id);
        const valid=requestBound&&a.applied===true&&a.result.accepted===true&&a.result.status==='PENDING_OWNER_REVIEW'
            &&a.result.owner_approved===false&&a.result.submission_status==='UNSUBMITTED'
            &&a.result.external_actions.length===0&&a.result.accepted_proposal_count>0
            &&state.proposals.length>0&&!state.proposals.some(p=>contradictingCorrection(state!.turns,p.visitor_message_id,p.evidence));
        if(!valid&&!failed)return;
        const firstSettlement=!settled||accepted!==valid;
        accepted=valid;
        settled=true;toolPending=false;
        if(firstSettlement)options.notice(valid?'Selected details are retained for owner review. Nothing has been sent or approved.'
            :'Preparation failed. Original evidence remains available for owner review. Nothing has been sent. You can continue asking questions or say goodbye.');
        // A reply that already began remains held: a late receipt cannot make
        // its tail safe. When the receipt precedes speech, the next native
        // response can report the terminal outcome. This is sequencing, not
        // proof of model wording or acoustic delivery.
        emit(valid?'VERIFIED_RECEIPT':'FAILED_RECEIPT',earlyReply,a.tool_call_id);
        if(firstSettlement&&failed&&earlyReply)options.recoverFailure?.(a.tool_call_id,turn.id);
    }
    function hold() {
        guarded=true;earlyReply=earlyReply||replyStarted;
        options.notice('Handoff acknowledgment is held until preparation is verified. You can continue or say goodbye.');
        emit(earlyReply?'EARLY_REPLY_HELD':'WAITING_RECEIPT',true);
    }
    return {
        speechStarted() {if(exiting)return;listening=true;replyStarted=false;toolPending=false;activeToolId=null;emit('LISTENING',true);},
        visitor(next:Turn) {
            if(next.role!=='user'||seen.has(next.id))return;
            // A reply/tool can arrive before finalized visitor text. Do not
            // forget that early output when classifying that same utterance.
            replyStarted=listening&&replyStarted;toolPending=listening&&toolPending;
            if(!toolPending)activeToolId=null;
            seen.add(next.id);turn=next;earlyReply=replyStarted;accepted=false;settled=false;listening=false;
            if(clearExit(next.content)){exiting=true;guarded=false;emit('EXIT_REPLY',false);return;}
            const successful=Boolean(state?.handoff_binding_attempts?.some(a=>a.applied&&a.result.accepted&&a.request_turn_id!==undefined));
            // The browser may receive this turn before or after persistence.
            // In either order use its immediate preceding committed turn.
            const index=state?.turns.findIndex(t=>t.id===next.id)??-1;
            const precedingTurn=index>=0?state?.turns[index-1]:state?.turns.at(-1);
            const request=requestedHandoffSpan(next.content,{hasSuccessfulHandoff:successful,precedingTurn});
            const prior=state?.handoff_requests?.at(-1);
            const attempt=state?.handoff_binding_attempts?.at(-1);
            // A rejection is a completed attempt, not an invitation to retry or
            // hold all future conversation. Foreign/unbound outcomes never settle it.
            const unresolved=Boolean(prior&&(!attempt||attempt.request_turn_id!==prior.visitor_message_id
                ||attempt.local_session_id!==state?.id||attempt.provider_session_id!==state?.provider_session_id));
            const turns=index>=0?state!.turns:[...(state?.turns||[]),next];
            const correction=Boolean(state?.proposals.some(p=>contradictingCorrection(turns,p.visitor_message_id,p.evidence)?.id===next.id));
            guarded=Boolean(request||unresolved||correction||toolPending);
            requestId=request?next.id:prior?.visitor_message_id??null;
            if(guarded)hold();
            else {options.notice('');emit('ORDINARY_REPLY',false);}
        },
        persona() {
            replyStarted=true;
            if(!guarded||exiting)return;
            // Keep an unsafe/early reply muted, but never overwrite a terminal
            // failure notice with the misleading "still waiting" state.
            if(!accepted&&!settled){earlyReply=true;emit('EARLY_REPLY_HELD',true);}
        },
        handoffStarted(providerSessionId:string,toolCallId:string) {
            if(exiting||!providerSessionId||providerSessionId!==options.providerSessionId()
                ||typeof toolCallId!=='string'||!/^\w[\w-]{0,199}$/.test(toolCallId)||activeToolId===toolCallId||startedTools.has(toolCallId))return;
            // Tool activity is a second safety signal, never visitor consent.
            // Keep the tool ID absent until its persisted attempt can bind it.
            // A new call cannot reuse an earlier call's success on this turn.
            // A delayed duplicate start belongs to its original turn, even
            // after speechStarted() has cleared the active-tool pointer.
            startedTools.add(toolCallId);
            activeToolId=toolCallId;toolPending=true;accepted=false;settled=false;hold();
        },
        committed(next:Handoff) {
            if(next.id!==options.localSessionId||!next.provider_session_id||next.provider_session_id!==options.providerSessionId())return;
            state=next;
            const request=next.handoff_requests?.at(-1);
            if(!exiting&&!listening&&turn&&request?.visitor_message_id===turn.id
                &&next.turns.some(t=>t.id===turn!.id&&t.role==='user'&&t.content===turn!.content)
                &&(!guarded||requestId!==turn.id)) {
                requestId=turn.id;hold();
            }
            verified();
        },
        snapshot:()=>({guarded,early_reply_held:earlyReply,accepted,settled,exiting,phase,visitor_message_id:turn?.id??null}),
    };
}
export type HandoffOutputGate=ReturnType<typeof handoffOutputGate>;

/** Telemetry never authorizes preparation, approval, speech or release. */
export function appendHandoffOutputEvidence(state:Handoff,event:HandoffOutputReceipt) {
    const keys=['event_id','at','visitor_message_id','muted','phase','tool_call_id','local_session_id','provider_session_id','launch_label'];
    if(!event||Object.keys(event).sort().join()!==keys.sort().join()
        ||event.local_session_id!==state.id||event.provider_session_id!==state.provider_session_id||!state.provider_session_id
        ||event.launch_label!==state.launch_label||typeof event.muted!=='boolean'
        ||!/^[-a-f0-9]{36}$/.test(event.event_id)||!Number.isFinite(Date.parse(event.at))
        ||!['LISTENING','WAITING_RECEIPT','EARLY_REPLY_HELD','VERIFIED_RECEIPT','FAILED_RECEIPT','ORDINARY_REPLY','EXIT_REPLY'].includes(event.phase)
        ||event.visitor_message_id!==null&&!state.turns.some(t=>t.role==='user'&&t.id===event.visitor_message_id)
        ||event.tool_call_id!==null&&!state.handoff_binding_attempts?.some(a=>a.tool_call_id===event.tool_call_id))
        throw new Error('Handoff output evidence requires exact session and source binding');
    const rows=state.handoff_output_events||[],prior=rows.find(e=>e.event_id===event.event_id);
    if(prior){if(JSON.stringify(prior)!==JSON.stringify(event))throw new Error('Output evidence is immutable');return;}
    if(rows.length>=256)throw new Error('Handoff output evidence bound reached');
    state.handoff_output_events=[...rows,structuredClone(event)];
}
