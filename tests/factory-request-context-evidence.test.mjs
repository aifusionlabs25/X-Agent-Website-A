import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {appendTurn} from '../lib/factory/handoff.ts';
import {requestedHandoffSpan} from '../lib/factory/handoff-request.ts';
import {committedTurnEffects} from '../lib/factory/turn-effects.ts';
import {handoffRequestContext} from '../lib/factory/handoff-context.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {contextSendTracker,contextAssurance} from '../lib/factory/context-send.ts';
import {appendContextSendEvidence} from '../lib/factory/context-send-evidence.ts';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/factory-request-context-20261110.json',import.meta.url),'utf8'));
const fresh=()=>({id:'local',version:1,package_sha256:'fictional',persona_id:'persona',launch_label:'fixture',
 status:'ACTIVE',provider_session_id:'provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
 provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,
 submission_status:'UNSUBMITTED',external_actions:[]});
const say=(s,id,content)=>{const t={id,role:'user',content};appendTurn(s,t);return t;};
const accepted=()=>({request_id:'r',tool_call_id:'tool',local_session_id:'local',provider_session_id:'provider',
 request_turn_id:null,applied:true,result:{accepted:true},original_proposals:[],resolved_proposals:[],bindings:[]});

test('retained run now records both requests and reconstructs refreshed exact correction references',()=>{
 const s=fresh(),sent=[];let sequence=0;
 const tracker=contextSendTracker({send:()=>{},report:e=>appendContextSendEvidence(s,bound(e)),
  id:()=>`11111111-1111-4111-8111-${String(++sequence).padStart(12,'0')}`,now:()=>at});
 for(const [index,turn] of fixture.turns.entries()) {
  appendTurn(s,turn);
  committedTurnEffects(s,turn,{context:(payload,kind)=>{
   sent.push({turn:turn.id,payload,kind});tracker.send(kind,turn.id,payload);
  },contextFailure:assert.fail,armClose:assert.fail,finalReply:assert.fail});
  if(index===4) {
   const result=recordProviderHandoffAttempt(s,fixture.original_proposals,fixture.fields,'request-fixture',
    {local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:'tool-fixture'});
   assert.equal(result.accepted,true);
   assert.equal(s.handoff_binding_attempts[0].request_turn_id,turn.id);
   s.tool_events=[{tool_call_id:'tool-fixture',tool_name:'factory_handoff',phase:'SDK_COMPLETED',result:JSON.stringify(result),exposure:'SDK_EVENT_NOT_PROOF_OF_MODEL_CONSUMPTION'}];
  }
 }
 assert.equal(s.handoff_requests.length,2);
 const context=sent.find(e=>e.turn===fixture.turns[8].id&&e.kind==='HANDOFF_REQUEST');assert.ok(context);
 assert.match(context.payload,/new explicit visitor request to update/);
 assert.match(context.payload,/Use factory_handoff once in this response/);
 const refs=JSON.parse(context.payload.split('Reference data: ')[1]);
 assert.equal(refs.truncated,false);
 assert.ok(refs.references.some(r=>r.visitor_message_id===fixture.turns[6].id&&r.evidence===fixture.turns[6].content&&r.value===r.evidence));
 assert.ok(refs.references.some(r=>r.evidence.includes('A person must approve every quote')));
 assert.deepEqual(s.turns,fixture.turns);assert.equal(s.handoff_binding_attempts.length,1);
 assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
 const reloaded=JSON.parse(JSON.stringify(s));
 const recorded=reloaded.context_send_events.filter(e=>e.visitor_message_id===fixture.turns[8].id&&e.kind==='HANDOFF_REQUEST');
 assert.deepEqual(recorded.map(e=>e.phase),['INVOKED','RETURNED']);
 assert.equal(recorded[0].payload,context.payload);assert.equal(recorded[0].assurance,contextAssurance);
 assert.equal(tracker.snapshot().report_failures,0);
});

test('independent initial information/detail wording preserves exact source offsets and requires local review scope',()=>{
 for(const text of ['Please prepare these details for owner review.','Could you draft that information for a human to review?','Yeah, please prepare that information for a human review.']) {
  const raw='Some background.\n  '+text+' Do not send anything.';
  const r=requestedHandoffSpan(raw);assert.ok(r,text);assert.equal(raw.slice(r.start,r.end),text);
 }
 for(const text of ['Prepare this information.','Create those details for my website.','Draft information about your services.'])assert.equal(requestedHandoffSpan(text),null);
});

test('named handoff requests do not assert a prior save; generic updates inherit scope from recorded success',()=>{
 for(const text of ['Please update the existing handoff with my correction.','Could you revise the saved summary, keeping the other details?','Amend our earlier review note with the unknown access requirement.','Yeah, please correct that handoff note.']) {
  if(/handoff/.test(text))assert.ok(requestedHandoffSpan(text));
  else assert.equal(requestedHandoffSpan(text),null);
  const r=requestedHandoffSpan(text,{hasSuccessfulHandoff:true});assert.ok(r,text);assert.equal(text.slice(r.start,r.end),text);
 }
 const s=fresh();s.handoff_binding_attempts=[accepted()];
 const t=say(s,'u','Please update the existing handoff with those corrections.');
 assert.match(handoffRequestContext(s,t),/new explicit visitor request/);
});

test('update wording cannot create authority from quotation, negation, conditional, unrelated task or delivery',()=>{
 for(const text of ['Do not update the existing handoff.',"Please don't revise the saved summary.",'Please update the existing handoff. Actually, cancel updating it.',
  'Please update the existing handoff if we proceed.','Please revise the saved summary after I confirm.',
  '"Please update the existing handoff."','My manager said:\nUpdate the existing handoff.','She said. Update the existing handoff.',
  'Please update the existing handoff and send it.','Revise the saved summary, then email it.',
  'Can you explain how you update the existing handoff?','Update the customer record.','The existing handoff is wrong.','Yes.'])
  assert.equal(requestedHandoffSpan(text,{hasSuccessfulHandoff:true}),null,text);
});

test('failed/unknown histories never become update retry authority',()=>{
 for(const mode of ['failed','undefined-binding','quarantined','sdk-failure','mixed-failure']) {
  const s=fresh(),a=accepted();s.handoff_binding_attempts=[a];
  if(mode==='failed'){a.applied=false;a.result.accepted=false;}
  if(mode==='undefined-binding')delete a.request_turn_id;
  if(mode==='quarantined')s.quarantined_proposals=[{reason:'unknown'}];
  if(mode==='sdk-failure')s.tool_events=[{tool_call_id:'tool',tool_name:'factory_handoff',phase:'SDK_FAILED'}];
  if(mode==='mixed-failure')s.handoff_binding_attempts.push({...accepted(),applied:false,result:{accepted:false}});
  const t=say(s,'new','Please update the existing handoff with the correction.');
  const context=handoffRequestContext(s,t);
  assert.ok(context===null||!context.includes('Use factory_handoff once in this response'),mode);
  assert.equal(s.handoff_binding_attempts.length,mode==='mixed-failure'?2:1);
 }
});

const uuid='11111111-1111-4111-8111-111111111111';
const at='2026-11-10T22:00:00.000Z';
const event=()=>({attempt_id:uuid,method:'addContext',kind:'VISITOR_REFERENCE',visitor_message_id:'u',payload:'Exact context data',phase:'INVOKED',at});
const bound=e=>({...e,local_session_id:'local',provider_session_id:'provider',launch_label:'fixture'});

test('tracker records actual SDK invocation/return, not transmission or ingestion, with no retry',()=>{
 let calls=0;const observed=[];
 // A no-op models the pinned SDK returning while a channel is not open.
 const tracker=contextSendTracker({send:()=>{calls++;},report:e=>observed.push(e),id:()=>uuid,now:()=>at});
 tracker.send('VISITOR_REFERENCE','u','Exact context data');
 assert.equal(calls,1);assert.deepEqual(observed.map(e=>e.phase),['INVOKED','RETURNED']);
 assert.equal(tracker.snapshot().assurance,contextAssurance);
 assert.ok(!JSON.stringify(tracker.snapshot()).includes('DELIVERED'));
});

test('SDK throw and telemetry rejection preserve evidence limits without retrying or masking the SDK error',async()=>{
 let calls=0;const tracker=contextSendTracker({send:()=>{calls++;throw Error('SDK unavailable');},report:()=>Promise.reject(Error('store unavailable')),id:()=>uuid,now:()=>at});
 assert.throws(()=>tracker.send('VISITOR_REFERENCE','u','Exact context data'),/SDK unavailable/);
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls,1);assert.equal(tracker.snapshot().report_failures,2);
 assert.deepEqual(tracker.snapshot().events.map(e=>e.phase),['INVOKED','THREW']);
 assert.ok(!JSON.stringify(tracker.snapshot()).includes('store unavailable'));
});

test('server retains exact payload and hashes; telemetry changes no business state or release',()=>{
 const s=fresh();say(s,'u','We have four operators.');const before=structuredClone(s);
 appendContextSendEvidence(s,bound(event()));appendContextSendEvidence(s,bound({...event(),phase:'RETURNED'}));
 assert.equal(s.context_send_events[0].payload,'Exact context data');
 assert.equal(s.context_send_events[0].payload_sha256,createHash('sha256').update('Exact context data').digest('hex'));
 assert.equal(s.context_send_events[0].source_turn_sha256,createHash('sha256').update(JSON.stringify(s.turns[0])).digest('hex'));
 const {context_send_events,...rest}=s;assert.equal(context_send_events.length,2);assert.deepEqual(rest,before);
 appendContextSendEvidence(s,bound(event()));assert.equal(s.context_send_events.length,2);
 assert.throws(()=>appendContextSendEvidence(s,bound({...event(),payload:'altered'})),/immutable/);
});

test('server rejects mismatched sessions, forged assurance, missing turns and invalid event order',()=>{
 const s=fresh();say(s,'u','A visitor statement.');
 for(const delta of [{local_session_id:'other'},{provider_session_id:'other'},{launch_label:'other'},
  {assurance:'DELIVERED'},{visitor_message_id:'missing'},{kind:'OTHER'},{phase:'DELIVERED'},{at:'invalid'},{payload:'x'.repeat(40001)}])
  assert.throws(()=>appendContextSendEvidence(s,{...bound(event()),...delta}));
 assert.throws(()=>appendContextSendEvidence(s,bound({...event(),phase:'RETURNED'})),/one invocation/);
 appendContextSendEvidence(s,bound(event()));
 assert.throws(()=>appendContextSendEvidence(s,bound({...event(),phase:'RETURNED',payload:'changed'})),/identity/);
 appendContextSendEvidence(s,bound({...event(),phase:'THREW'}));
 assert.throws(()=>appendContextSendEvidence(s,bound({...event(),phase:'RETURNED'})),/one invocation/);
});

test('late evidence cannot reopen a closed session; collection context requires no visitor ID',()=>{
 const s=fresh();s.status='CLOSED';s.provider_release_verified=true;
 const e=bound({...event(),kind:'COLLECTION',visitor_message_id:null});appendContextSendEvidence(s,e);
 assert.equal(s.status,'CLOSED');assert.equal(s.provider_release_verified,true);
 assert.equal(s.context_send_events[0].source_turn_sha256,null);
 assert.throws(()=>appendContextSendEvidence(s,{...e,visitor_message_id:'u'}),/persisted visitor/);
});

test('exit cleanup remains independent of failed context telemetry',()=>{
 const s=fresh(),t=say(s,'exit','Thanks, goodbye.');let armed=0,failures=0,calls=0;
 committedTurnEffects(s,t,{armClose:()=>armed++,finalReply:assert.fail,
  context:()=>{calls++;throw Error('context unavailable');},contextFailure:()=>failures++});
 assert.equal(armed,1);assert.equal(calls,2);assert.equal(failures,2);assert.equal(s.status,'CLOSING_PENDING');
});
