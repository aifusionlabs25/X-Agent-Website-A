import type {Handoff} from './handoff';

export const failureSpeechText="I couldn't prepare the handoff. Your original conversation is saved for owner review. Nothing has been sent.";
export type FailureSpeechPhase='REQUESTED'|'INTERRUPT_INVOKED'|'NATIVE_REPLY_ENDED'|'TALK_INVOKED'|'TALK_RETURNED'
    |'RECOVERY_TEXT_STARTED'|'RECOVERY_TEXT_ENDED'|'CANCELED'|'BLOCKED';
export type FailureSpeechEvent={event_id:string;at:string;tool_call_id:string;visitor_message_id:string;
    native_reply_id:string;recovery_reply_id:string;phase:FailureSpeechPhase;detail:string};
export type FailureSpeechReceipt=FailureSpeechEvent & {local_session_id:string;provider_session_id:string;launch_label:string};
type SpeechEvent={id:string;role:string;content:string;endOfSpeech:boolean;interrupted?:boolean};
type Timer=ReturnType<typeof setTimeout>;

/** One media owner: saving a gate receipt must not re-mute an authorized,
 * separately correlated failure explanation. RELEASE restores the gate. */
export function handoffAudioOutput(apply:(muted:boolean)=>void) {
    let gateHeld=false,recovery:'HOLD'|'ALLOW'|'RELEASE'='RELEASE';
    const update=()=>apply(recovery==='HOLD'||recovery==='RELEASE'&&gateHeld);
    return {gate:(held:boolean)=>{gateHeld=held;update();},
        recovery:(mode:'HOLD'|'ALLOW'|'RELEASE')=>{recovery=mode;update();}};
}

/** One fixed direct-speech response to a committed rejection. No model rewrite,
 * handoff retry, success authority, timer-based unmute or acoustic-delivery claim.
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
    type Active={tool:string;visitor:string;native:string;reply:string;correlation:string;text:string;submitted:boolean;
        stage:'WAIT_NATIVE'|'SENDING'|'SPEAKING'|'TEXT_ENDED'|'BLOCKED';};
    let active:Active|null=null;
    const clear=()=>{if(timer!==null){cancel(timer);timer=null;}};
    function emit(a:Active,phase:FailureSpeechPhase,detail='') {
        options.report({event_id:(options.id||(()=>crypto.randomUUID()))(),at:(options.now||(()=>new Date().toISOString()))(),
            tool_call_id:a.tool,visitor_message_id:a.visitor,native_reply_id:a.native,recovery_reply_id:a.reply,phase,detail});
    }
    function block(a:Active,reason:string) {
        if(active!==a||a.stage==='BLOCKED')return;clear();a.stage='BLOCKED';options.output('HOLD');
        options.notice('Preparation failed. The spoken explanation could not be verified. Nothing has been sent. You can continue or say goodbye.');
        emit(a,'BLOCKED',reason);
    }
    function deadline(a:Active) {clear();timer=schedule(()=>block(a,'EXPECTED_SPEECH_EVENT_TIMEOUT'),options.timeoutMs??10000);}
    function speak(a:Active) {
        if(active!==a||disposed||a.stage!=='WAIT_NATIVE')return;
        clear();a.stage='SENDING';a.submitted=true;emit(a,'TALK_INVOKED');deadline(a);
        try {void options.speak(a.correlation,failureSpeechText).then(()=>{
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
    return {
        toolStarted(provider:string,tool:string,correlation?:string) {
            if(disposed||provider!==options.providerSessionId()||starts.has(tool)||starts.size>=24
                ||!/^\w[\w-]{0,199}$/.test(tool)||!correlation||!/^[\w-]{1,200}$/.test(correlation))return;
            starts.set(tool,{provider,correlation});
        },
        rejected(state:Handoff,tool:string,visitor:string) {
            if(disposed||active||attempted.has(tool)||state.status!=='ACTIVE'||state.id!==options.localSessionId
                ||state.provider_session_id!==options.providerSessionId())return false;
            const start=starts.get(tool),a=state.handoff_binding_attempts?.at(-1);
            if(!start||start.provider!==state.provider_session_id||visitor!=='user::'+start.correlation
                ||state.turns.filter(t=>t.role==='user').at(-1)?.id!==visitor
                ||!a||a.tool_call_id!==tool||a.local_session_id!==state.id||a.provider_session_id!==state.provider_session_id
                ||a.through_visitor_turn_id!==visitor||a.applied!==false||a.result.accepted!==false
                ||a.result.status!=='UNMAPPED_OWNER_REVIEW'||a.result.accepted_proposal_count!==0
                ||a.result.owner_approved!==false||a.result.submission_status!=='UNSUBMITTED'||a.result.external_actions.length)return false;
            attempted.add(tool);const correlation='factory-failure-'+(options.id||(()=>crypto.randomUUID()))();
            const next:Active={tool,visitor,native:'persona::'+start.correlation,correlation,reply:'persona::'+correlation,text:'',submitted:false,stage:'WAIT_NATIVE'};
            recoveryIds.add(next.reply);heldReplyIds.add(next.native);active=next;options.output('HOLD');emit(next,'REQUESTED');
            if(ended.has(next.native)){emit(next,'NATIVE_REPLY_ENDED','PREVIOUSLY_OBSERVED_TEXT_END');speak(next);}
            else {deadline(next);emit(next,'INTERRUPT_INVOKED');try{options.interrupt();}catch{block(next,'INTERRUPT_FAILED');}}
            return true;
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
            if(event.interrupted||!failureSpeechText.startsWith(candidate)||event.endOfSpeech&&candidate!==failureSpeechText) {
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
    const a=state.handoff_binding_attempts?.find(a=>a.tool_call_id===event?.tool_call_id);
    if(!event||Object.keys(event).sort().join()!==keys.sort().join()||event.local_session_id!==state.id
        ||!state.provider_session_id||event.provider_session_id!==state.provider_session_id||event.launch_label!==state.launch_label
        ||!/^[-a-f0-9]{36}$/.test(event.event_id)||!Number.isFinite(Date.parse(event.at))||!phases.includes(event.phase)
        ||typeof event.detail!=='string'||event.detail.length>100||!/^user::[\w-]{1,200}$/.test(event.visitor_message_id)
        ||event.native_reply_id!=='persona::'+event.visitor_message_id.slice(6)
        ||!/^persona::factory-failure-[-a-f0-9]{36}$/.test(event.recovery_reply_id)
        ||!a||a.local_session_id!==state.id||a.provider_session_id!==state.provider_session_id||a.through_visitor_turn_id!==event.visitor_message_id
        ||a.applied!==false||a.result.accepted!==false||a.result.status!=='UNMAPPED_OWNER_REVIEW'
        ||a.result.accepted_proposal_count!==0||a.result.owner_approved!==false||a.result.submission_status!=='UNSUBMITTED'||a.result.external_actions.length)
        throw new Error('Failure speech evidence requires an exact rejected attempt');
    const rows=state.handoff_failure_speech_events||[],same=rows.filter(r=>r.tool_call_id===event.tool_call_id);
    const prior=rows.find(r=>r.event_id===event.event_id);
    if(prior){if(JSON.stringify(prior)!==JSON.stringify(event))throw new Error('Failure speech evidence is immutable');return;}
    if(rows.length>=256||same.some(r=>r.recovery_reply_id!==event.recovery_reply_id||r.visitor_message_id!==event.visitor_message_id)
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
