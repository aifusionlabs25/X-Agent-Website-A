import type {Handoff} from './handoff';
import {contradictingCorrection} from './handoff-corrections.ts';

export const failureSpeechText="I couldn't prepare the handoff. Your original conversation is saved for owner review. Nothing has been sent.";
export const unverifiedSpeechText="I can't verify that the handoff is up to date. Your conversation is saved for owner review. Nothing has been sent.";
export const acceptedSpeechText="The selected details are retained as proposals for owner review. Nothing has been approved or sent.";
export type FailureSpeechPhase='REQUESTED'|'INTERRUPT_INVOKED'|'NATIVE_REPLY_ENDED'|'TALK_INVOKED'|'TALK_RETURNED'
    |'RECOVERY_TEXT_STARTED'|'RECOVERY_TEXT_ENDED'|'CANCELED'|'BLOCKED';
export type FailureSpeechEvent={event_id:string;at:string;tool_call_id:string|null;visitor_message_id:string;
    native_reply_id:string;recovery_reply_id:string;phase:FailureSpeechPhase;detail:string;outcome?:'UNVERIFIED'|'ACCEPTED'};
export type FailureSpeechReceipt=FailureSpeechEvent & {local_session_id:string;provider_session_id:string;launch_label:string};
type SpeechEvent={id:string;role:string;content:string;endOfSpeech:boolean;interrupted?:boolean};
type Timer=ReturnType<typeof setTimeout>;

/** A bounded inability-to-verify explanation is not a rejected business result.
 * Require retained current-turn context; never manufacture consent or a tool. */
export function hasUnverifiedHandoffContext(state:Handoff,visitor:string) {
    const turn=state.turns.find(t=>t.role==='user'&&t.id===visitor);
    if(!turn)return false;
    const request=state.handoff_requests?.find(r=>r.visitor_message_id===visitor
        &&r.source==='HOST_PERSISTED_VISITOR_REQUEST'&&r.status==='REQUESTED_NOT_MAPPED'
        &&Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=turn.content.length
        &&turn.content.slice(r.start,r.end)===r.evidence);
    const correction=state.proposals.some(p=>contradictingCorrection(state.turns,p.visitor_message_id,p.evidence)?.id===visitor);
    const unbound=state.handoff_binding_attempts?.some(a=>a.local_session_id===state.id
        &&a.provider_session_id===state.provider_session_id&&a.through_visitor_turn_id===visitor
        &&(!a.request_turn_id||!state.handoff_requests?.some(r=>r.visitor_message_id===a.request_turn_id)));
    return Boolean(request||correction||unbound);
}

function acceptedAttempt(state:Handoff,tool:string,visitor:string,checkCurrentFacts:boolean) {
    const a=state.handoff_binding_attempts?.find(a=>a.tool_call_id===tool);
    return Boolean(a&&a.local_session_id===state.id&&a.provider_session_id===state.provider_session_id
        &&a.through_visitor_turn_id===visitor&&a.request_turn_id===visitor
        &&state.handoff_requests?.some(r=>r.visitor_message_id===visitor)
        &&a.applied===true&&a.result.accepted===true&&a.result.status==='PENDING_OWNER_REVIEW'
        &&a.result.accepted_proposal_count>0&&a.result.owner_approved===false
        &&a.result.submission_status==='UNSUBMITTED'&&a.result.external_actions.length===0
        &&(!checkCurrentFacts||state.proposals.length>0&&!state.proposals.some(p=>contradictingCorrection(state.turns,p.visitor_message_id,p.evidence))));
}

/** One media owner: saving a gate receipt must not re-mute an authorized,
 * separately correlated failure explanation. RELEASE restores the gate. */
export function handoffAudioOutput(apply:(muted:boolean)=>void) {
    let gateHeld=false,recovery:'HOLD'|'ALLOW'|'RELEASE'='RELEASE';
    const update=()=>apply(recovery==='HOLD'||recovery==='RELEASE'&&gateHeld);
    return {gate:(held:boolean)=>{gateHeld=held;update();},
        recovery:(mode:'HOLD'|'ALLOW'|'RELEASE')=>{recovery=mode;update();}};
}

/** One fixed direct-speech response to an exact outcome: rejected preparation,
 * accepted selected proposals, or captured inability to verify a guarded turn.
 * No model rewrite, handoff retry, success authority from a timeout, timer-based
 * unmute or acoustic-delivery claim.
 * Native speech remains held until its own text end; only the separately
 * correlated expected recovery text may enable output. Provider correlation and
 * real media transition still require live verification. */
export function handoffFailureSpeech(options:{
    localSessionId:string;providerSessionId:()=>string|null;
    interrupt:()=>void;speak:(correlationId:string,text:string)=>Promise<void>;
    output:(mode:'HOLD'|'ALLOW'|'RELEASE')=>void;notice:(text:string)=>void;
    report:(event:FailureSpeechEvent)=>void;id?:()=>string;now?:()=>string;
    schedule?:typeof setTimeout;cancel?:typeof clearTimeout;timeoutMs?:number;
}) {
    const starts=new Map<string,{provider:string;correlation:string}>(),attempted=new Set<string>();
    const ended=new Set<string>(),recoveryIds=new Set<string>(),heldReplyIds=new Set<string>();
    const schedule=options.schedule||setTimeout,cancel=options.cancel||clearTimeout;
    let timer:Timer|null=null,disposed=false;
    type Active={tool:string|null;visitor:string;native:string;reply:string;correlation:string;text:string;submitted:boolean;
        outcome?:'UNVERIFIED'|'ACCEPTED';expected:string;
        stage:'WAIT_NATIVE'|'SENDING'|'SPEAKING'|'TEXT_ENDED'|'BLOCKED';};
    let active:Active|null=null;
    const clear=()=>{if(timer!==null){cancel(timer);timer=null;}};
    function emit(a:Active,phase:FailureSpeechPhase,detail='') {
        options.report({event_id:(options.id||(()=>crypto.randomUUID()))(),at:(options.now||(()=>new Date().toISOString()))(),
            tool_call_id:a.tool,visitor_message_id:a.visitor,native_reply_id:a.native,recovery_reply_id:a.reply,phase,detail,
            ...(a.outcome?{outcome:a.outcome}:{})});
    }
    function block(a:Active,reason:string) {
        if(active!==a||a.stage==='BLOCKED')return;clear();a.stage='BLOCKED';options.output('HOLD');
        options.notice((a.outcome==='UNVERIFIED'?'Preparation remains unverified. ':a.outcome==='ACCEPTED'?'Selected proposals remain saved for owner review. ':'Preparation failed. ')
            +'The spoken explanation could not be verified. Nothing has been sent. You can continue or say goodbye.');
        emit(a,'BLOCKED',reason);
    }
    function deadline(a:Active) {clear();timer=schedule(()=>block(a,'EXPECTED_SPEECH_EVENT_TIMEOUT'),options.timeoutMs??10000);}
    function speak(a:Active) {
        if(active!==a||disposed||a.stage!=='WAIT_NATIVE')return;
        clear();a.stage='SENDING';a.submitted=true;emit(a,'TALK_INVOKED');deadline(a);
        try {void options.speak(a.correlation,a.expected).then(()=>{
            if(active===a&&!disposed&&a.stage!=='BLOCKED')emit(a,'TALK_RETURNED','SDK_SUBMISSION_ONLY');
        }).catch(()=>block(a,'TALK_SUBMISSION_FAILED'));}catch{block(a,'TALK_SUBMISSION_FAILED');}
    }
    function stop(reason:string) {
        const a=active;if(!a)return;clear();active=null;
        // Cancel a queued/direct recovery once. Never use this return as proof
        // that native buffers are drained. New visitor/exit control takes over.
        if(a.submitted)try{options.interrupt();}catch{/* visible notice and evidence remain */}
        options.output('RELEASE');emit(a,'CANCELED',reason);
    }
    function begin(tool:string|null,visitor:string,expected:string,outcome?:'UNVERIFIED'|'ACCEPTED') {
        attempted.add('visitor:'+visitor);if(tool)attempted.add(tool);
        const correlation='factory-failure-'+(options.id||(()=>crypto.randomUUID()))();
        const next:Active={tool,visitor,native:'persona::'+visitor.slice(6),correlation,reply:'persona::'+correlation,
            text:'',submitted:false,stage:'WAIT_NATIVE',expected,...(outcome?{outcome}:{})};
        recoveryIds.add(next.reply);heldReplyIds.add(next.native);active=next;options.output('HOLD');emit(next,'REQUESTED');
        if(ended.has(next.native)){emit(next,'NATIVE_REPLY_ENDED','PREVIOUSLY_OBSERVED_TEXT_END');speak(next);}
        else {deadline(next);emit(next,'INTERRUPT_INVOKED');try{options.interrupt();}catch{block(next,'INTERRUPT_FAILED');}}
        return true;
    }
    return {
        toolStarted(provider:string,tool:string,correlation?:string) {
            if(disposed||provider!==options.providerSessionId()||starts.has(tool)||starts.size>=24
                ||!/^\w[\w-]{0,199}$/.test(tool)||!correlation||!/^[\w-]{1,200}$/.test(correlation))return;
            starts.set(tool,{provider,correlation});
        },
        rejected(state:Handoff,tool:string,visitor:string) {
            if(disposed||active||attempted.has(tool)||attempted.has('visitor:'+visitor)||state.status!=='ACTIVE'||state.id!==options.localSessionId
                ||state.provider_session_id!==options.providerSessionId())return false;
            const start=starts.get(tool),a=state.handoff_binding_attempts?.at(-1);
            if(!start||start.provider!==state.provider_session_id||visitor!=='user::'+start.correlation
                ||state.turns.filter(t=>t.role==='user').at(-1)?.id!==visitor
                ||!a||a.tool_call_id!==tool||a.local_session_id!==state.id||a.provider_session_id!==state.provider_session_id
                ||a.through_visitor_turn_id!==visitor||a.applied!==false||a.result.accepted!==false
                ||a.result.status!=='UNMAPPED_OWNER_REVIEW'||a.result.accepted_proposal_count!==0
                ||a.result.owner_approved!==false||a.result.submission_status!=='UNSUBMITTED'||a.result.external_actions.length)return false;
            return begin(tool,visitor,failureSpeechText);
        },
        accepted(state:Handoff,tool:string,visitor:string) {
            const start=starts.get(tool);
            if(disposed||active||attempted.has(tool)||attempted.has('visitor:'+visitor)
                ||state.status!=='ACTIVE'||state.id!==options.localSessionId||state.provider_session_id!==options.providerSessionId()
                ||state.approved||state.submission_status!=='UNSUBMITTED'||state.external_actions.length
                ||!start||start.provider!==state.provider_session_id||visitor!=='user::'+start.correlation
                ||state.turns.filter(t=>t.role==='user').at(-1)?.id!==visitor||!acceptedAttempt(state,tool,visitor,true))return false;
            return begin(tool,visitor,acceptedSpeechText,'ACCEPTED');
        },
        unverified(state:Handoff,visitor:string) {
            if(disposed||active||attempted.has('visitor:'+visitor)||state.status!=='ACTIVE'||state.id!==options.localSessionId
                ||!state.provider_session_id||state.provider_session_id!==options.providerSessionId()
                ||state.approved||state.submission_status!=='UNSUBMITTED'||state.external_actions.length
                ||!/^user::[\w-]{1,200}$/.test(visitor)||state.turns.filter(t=>t.role==='user').at(-1)?.id!==visitor
                ||!hasUnverifiedHandoffContext(state,visitor)
                ||!state.handoff_output_events?.some(e=>e.phase==='UNVERIFIED_OUTCOME'&&e.visitor_message_id===visitor
                    &&e.local_session_id===state.id&&e.provider_session_id===state.provider_session_id
                    &&e.launch_label===state.launch_label&&e.muted===true&&e.tool_call_id===null))return false;
            // A terminal receipt may arrive while the captured timeout is
            // queued for persistence. That observation stays historical; it
            // cannot make a now-known result sound unknown.
            const a=state.handoff_binding_attempts?.at(-1),start=a?starts.get(a.tool_call_id):null;
            if(a&&a.local_session_id===state.id&&a.provider_session_id===state.provider_session_id&&a.through_visitor_turn_id===visitor) {
                if(acceptedAttempt(state,a.tool_call_id,visitor,true))return false;
                const bound=a.request_turn_id===visitor&&state.handoff_requests?.some(r=>r.visitor_message_id===visitor);
                if(a.applied===false&&a.result.accepted===false&&a.result.status==='UNMAPPED_OWNER_REVIEW'
                    &&a.result.accepted_proposal_count===0&&a.result.owner_approved===false
                    &&a.result.submission_status==='UNSUBMITTED'&&!a.result.external_actions.length
                    &&(bound||start?.provider===state.provider_session_id&&visitor==='user::'+start.correlation))return false;
            }
            return begin(null,visitor,unverifiedSpeechText,'UNVERIFIED');
        },
        stream(event:SpeechEvent) {
            if(event.role!=='persona')return;
            if(event.endOfSpeech&&ended.size<200)ended.add(event.id);
            const a=active;if(!a||disposed||a.stage==='BLOCKED')return;
            if(event.id===a.native) {
                // Do not replay or expose the original reply, even after the
                // direct response begins. A later native chunk fails closed.
                if(a.stage!=='WAIT_NATIVE'){if(event.content||!event.endOfSpeech)block(a,'LATE_NATIVE_REPLY');return;}
                if(event.endOfSpeech){emit(a,'NATIVE_REPLY_ENDED',event.interrupted?'INTERRUPTED_TEXT_END':'TEXT_END');speak(a);}
                return;
            }
            if(event.id!==a.reply){if(event.content.trim())block(a,'UNEXPECTED_PERSONA_CORRELATION');return;}
            if(a.stage!=='SENDING'&&a.stage!=='SPEAKING')return;
            const candidate=a.text+event.content;
            if(event.interrupted||!a.expected.startsWith(candidate)||event.endOfSpeech&&candidate!==a.expected) {
                block(a,'UNEXPECTED_RECOVERY_TEXT');return;
            }
            a.text=candidate;
            if(a.text&&a.stage==='SENDING') {a.stage='SPEAKING';options.output('ALLOW');emit(a,'RECOVERY_TEXT_STARTED','CORRELATED_TEXT_NOT_ACOUSTIC_PROOF');}
            if(event.endOfSpeech){clear();a.stage='TEXT_ENDED';emit(a,'RECOVERY_TEXT_ENDED','TEXT_COMPLETION_NOT_AUDIO_DRAIN');}
        },
        cancel:stop,
        dispose(){stop('DISPOSE');disposed=true;},
        isRecoveryReply:(id:string)=>recoveryIds.has(id),
        isHeldOrRecoveryReply:(id:string)=>heldReplyIds.has(id)||recoveryIds.has(id),
        snapshot:()=>active?{tool_call_id:active.tool,reply_id:active.reply,stage:active.stage}:null,
    };
}
export type HandoffFailureSpeech=ReturnType<typeof handoffFailureSpeech>;

/** Recovery telemetry is not action authority or proof of heard audio. */
export function appendFailureSpeechEvidence(state:Handoff,event:FailureSpeechReceipt) {
    const keys=['event_id','at','tool_call_id','visitor_message_id','native_reply_id','recovery_reply_id','phase','detail','local_session_id','provider_session_id','launch_label'];
    const phases:FailureSpeechPhase[]=['REQUESTED','INTERRUPT_INVOKED','NATIVE_REPLY_ENDED','TALK_INVOKED','TALK_RETURNED','RECOVERY_TEXT_STARTED','RECOVERY_TEXT_ENDED','CANCELED','BLOCKED'];
    const unverified=event?.outcome==='UNVERIFIED',accepted=event?.outcome==='ACCEPTED';
    if(unverified||accepted)keys.push('outcome');
    const a=state.handoff_binding_attempts?.find(a=>a.tool_call_id===event?.tool_call_id);
    if(!event||Object.keys(event).sort().join()!==keys.sort().join()||event.local_session_id!==state.id
        ||!state.provider_session_id||event.provider_session_id!==state.provider_session_id||event.launch_label!==state.launch_label
        ||!/^[-a-f0-9]{36}$/.test(event.event_id)||!Number.isFinite(Date.parse(event.at))||!phases.includes(event.phase)
        ||typeof event.detail!=='string'||event.detail.length>100||!/^user::[\w-]{1,200}$/.test(event.visitor_message_id)
        ||event.native_reply_id!=='persona::'+event.visitor_message_id.slice(6)
        ||!/^persona::factory-failure-[-a-f0-9]{36}$/.test(event.recovery_reply_id))
        throw new Error(unverified||accepted?'Failure speech evidence requires exact session and reply identities':'Failure speech evidence requires an exact rejected attempt');
    const rows=state.handoff_failure_speech_events||[],same=rows.filter(r=>unverified
        ?r.outcome==='UNVERIFIED'&&r.visitor_message_id===event.visitor_message_id:r.tool_call_id===event.tool_call_id);
    const prior=rows.find(r=>r.event_id===event.event_id);
    if(prior){if(JSON.stringify(prior)!==JSON.stringify(event))throw new Error('Failure speech evidence is immutable');return;}
    if(unverified) {
        // This is a captured inability-to-verify disposition, never a fabricated
        // rejected tool receipt. Gate evidence must already be persisted. Later
        // phases retain that snapshot even if a late receipt/new turn arrives.
        const gate=state.handoff_output_events?.find(e=>e.phase==='UNVERIFIED_OUTCOME'
            &&e.visitor_message_id===event.visitor_message_id&&e.local_session_id===state.id
            &&e.provider_session_id===state.provider_session_id&&e.launch_label===state.launch_label
            &&e.muted===true&&e.tool_call_id===null&&Date.parse(e.at)<=Date.parse(event.at));
        if(event.tool_call_id!==null||!state.turns.some(t=>t.role==='user'&&t.id===event.visitor_message_id)
            ||event.phase==='REQUESTED'&&!gate)
            throw new Error('Unverified speech evidence requires the exact retained gate disposition');
    } else if(accepted) {
        if(typeof event.tool_call_id!=='string'||!acceptedAttempt(state,event.tool_call_id,event.visitor_message_id,false))
            throw new Error('Accepted speech evidence requires an exact accepted attempt');
        if(event.phase==='REQUESTED'&&!state.handoff_output_events?.some(e=>e.muted===true
            &&(e.phase==='VERIFIED_RECEIPT'&&e.tool_call_id===event.tool_call_id||e.phase==='UNVERIFIED_OUTCOME'&&e.tool_call_id===null)
            &&e.visitor_message_id===event.visitor_message_id
            &&e.local_session_id===state.id&&e.provider_session_id===state.provider_session_id
            &&e.launch_label===state.launch_label&&Date.parse(e.at)<=Date.parse(event.at)))
            throw new Error('Accepted speech evidence requires the exact retained held-success disposition');
    } else if(typeof event.tool_call_id!=='string'||!a||a.local_session_id!==state.id
        ||a.provider_session_id!==state.provider_session_id||a.through_visitor_turn_id!==event.visitor_message_id
        ||a.applied!==false||a.result.accepted!==false||a.result.status!=='UNMAPPED_OWNER_REVIEW'
        ||a.result.accepted_proposal_count!==0||a.result.owner_approved!==false||a.result.submission_status!=='UNSUBMITTED'||a.result.external_actions.length)
        throw new Error('Failure speech evidence requires an exact rejected attempt');
    if(rows.length>=256||same.some(r=>r.recovery_reply_id!==event.recovery_reply_id||r.visitor_message_id!==event.visitor_message_id)
        ||rows.some(r=>r.recovery_reply_id===event.recovery_reply_id&&(r.tool_call_id!==event.tool_call_id||r.visitor_message_id!==event.visitor_message_id||r.outcome!==event.outcome))
        ||rows.some(r=>r.visitor_message_id===event.visitor_message_id&&r.outcome!==event.outcome)
        ||same.some(r=>r.outcome!==event.outcome)
        ||event.phase==='REQUESTED'&&same.length||event.phase!=='REQUESTED'&&!same.some(r=>r.phase==='REQUESTED')
        ||same.some(r=>r.phase===event.phase))throw new Error('Failure speech phase or identity conflict');
    const has=(phase:FailureSpeechPhase)=>same.some(r=>r.phase===phase);
    if(has('CANCELED')||has('BLOCKED')&&event.phase!=='CANCELED'
        ||event.phase==='INTERRUPT_INVOKED'&&has('NATIVE_REPLY_ENDED')
        ||event.phase==='TALK_INVOKED'&&!has('NATIVE_REPLY_ENDED')
        ||['TALK_RETURNED','RECOVERY_TEXT_STARTED'].includes(event.phase)&&!has('TALK_INVOKED')
        ||event.phase==='RECOVERY_TEXT_ENDED'&&!has('RECOVERY_TEXT_STARTED'))
        throw new Error('Failure speech phase order is not supported by prior evidence');
    state.handoff_failure_speech_events=[...rows,structuredClone(event)];
}
