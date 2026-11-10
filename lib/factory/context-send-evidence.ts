import {createHash} from 'node:crypto';
import type {Handoff} from './handoff';
import {contextAssurance,type ContextSendReceipt} from './context-send.ts';

/** Untrusted client telemetry is session-bound and immutable, but never grants
 * request, mapping, acceptance, delivery or provider-release authority. */
export function appendContextSendEvidence(state:Handoff,event:ContextSendReceipt) {
    const keys=['attempt_id','method','kind','visitor_message_id','payload','phase','at',
        'local_session_id','provider_session_id','launch_label'];
    if(!event||Object.keys(event).sort().join()!==keys.sort().join()
        ||event.local_session_id!==state.id||event.provider_session_id!==state.provider_session_id
        ||!state.provider_session_id||event.launch_label!==state.launch_label
        ||!['ACTIVE','CLOSING_PENDING','CLOSED'].includes(state.status)
        ||event.method!=='addContext'||!['COLLECTION','VISITOR_REFERENCE','HANDOFF_REQUEST','VISITOR_EXIT'].includes(event.kind)
        ||!['INVOKED','RETURNED','THREW'].includes(event.phase)
        ||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(event.attempt_id||'')
        ||typeof event.at!=='string'||!Number.isFinite(Date.parse(event.at))
        ||typeof event.payload!=='string'||!event.payload.trim()||event.payload.length>40000)
        throw new Error('Context evidence requires exact session binding and bounded SDK-call metadata');
    const turn=state.turns.find(t=>t.id===event.visitor_message_id&&t.role==='user');
    if(event.kind==='COLLECTION'?event.visitor_message_id!==null:!turn)
        throw new Error('Context evidence requires its persisted visitor turn');
    const record={...event,payload_sha256:createHash('sha256').update(event.payload).digest('hex'),
        source_turn_sha256:turn?createHash('sha256').update(JSON.stringify(turn)).digest('hex'):null,
        assurance:contextAssurance};
    const rows=state.context_send_events||[],same=rows.filter(e=>e.attempt_id===event.attempt_id);
    const duplicate=same.find(e=>e.phase===event.phase);
    if(duplicate){if(Object.entries(record).some(([k,v])=>Reflect.get(duplicate,k)!==v))throw new Error('Context evidence is immutable');return;}
    if(rows.length>=512)throw new Error('Context evidence bound reached');
    if(same.some(e=>e.kind!==event.kind||e.visitor_message_id!==event.visitor_message_id
        ||e.payload!==event.payload||Date.parse(e.at)>Date.parse(event.at)))throw new Error('Context attempt identity or order changed');
    if(event.phase==='INVOKED'?same.length:!same.some(e=>e.phase==='INVOKED')||same.some(e=>e.phase!=='INVOKED'))
        throw new Error('Context evidence requires one invocation and one observed outcome');
    state.context_send_events=[...rows,record];
}
