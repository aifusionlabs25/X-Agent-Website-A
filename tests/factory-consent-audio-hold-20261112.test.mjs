import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {appendTurn,assertProposal,digest} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {handoffOutputGate,appendHandoffOutputEvidence} from '../lib/factory/handoff-output-gate.ts';

const fixtureUrl=new URL('./fixtures/factory-consent-audio-hold-20261112.json',import.meta.url);
const bytes=fs.readFileSync(fixtureUrl),saved=JSON.parse(bytes),original=saved.original_initial_attempt;
const initialRequest=saved.turns.find(t=>t.id===original.through_visitor_turn_id);
const initialIndex=saved.turns.findIndex(t=>t.id===initialRequest.id);
const sha=b=>createHash('sha256').update(b).digest('hex');
function replayInitial({earlyReply=false,gateOptions={}}={}) {
 const s={id:saved.local_session_id,version:1,package_sha256:saved.package_sha256,persona_id:saved.persona_id,
  launch_label:saved.launch_label,status:'ACTIVE',provider_session_id:saved.provider_session_id,
  turns:[],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,
  provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]};
 const events=[],media=[],notices=[];
 const g=handoffOutputGate({localSessionId:s.id,providerSessionId:()=>s.provider_session_id,
  output:m=>media.push(m),notice:n=>notices.push(n),report:e=>events.push(e),...gateOptions});
 g.committed(structuredClone(s));
 for(const turn of saved.turns.slice(0,initialIndex+1)) {
  if(turn.role==='user'){g.speechStarted();g.visitor(turn);}else g.persona();
  appendTurn(s,turn);g.committed(structuredClone(s));
 }
 g.handoffStarted(s.provider_session_id,original.tool_call_id);
 if(earlyReply)g.persona();
 const result=recordProviderHandoffAttempt(s,original.original_proposals,saved.fields,'offline-initial',{
  local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:original.tool_call_id});
 g.committed(structuredClone(s));
 return {s,g,events,media,notices,result};
}
function clock() {
 const timers=new Map(),scheduled=[];
 return {timers,scheduled,
  schedule:(fn,ms)=>{const key={};timers.set(key,fn);scheduled.push({key,fn,ms});return key;},
  cancel:key=>timers.delete(key),
  expire:()=>{const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks)callback();}};
}
function throughSavedUpdate(x) {
 const remaining=saved.turns.slice(initialIndex+1),correction=remaining.find(t=>t.role==='user');
 const update=remaining.find(t=>t.role==='user'&&t.id!==correction.id);
 for(const turn of remaining) {
  if(turn.role==='user'){x.g.speechStarted();x.g.visitor(turn);}else x.g.persona();
  appendTurn(x.s,turn);x.g.committed(structuredClone(x.s));
  if(turn.id===update.id)break;
 }
 return {correction,update};
}

test('retained baseline records success without request binding and the observed audio hold without changing originals',()=>{
 assert.equal(original.result.accepted,true);assert.equal(original.request_turn_id,null);
 assert.equal(saved.baseline_offline_reconstruction.accepted,true);
 assert.equal(saved.baseline_offline_reconstruction.gate_accepted,false);
 assert.equal(saved.baseline_offline_reconstruction.gate_settled,false);
 const events=saved.original_output_events,start=events.findIndex(e=>e.phase==='WAITING_RECEIPT');
 const end=events.findIndex((e,i)=>i>start&&!e.muted);
 assert.ok(start>=0&&end>start);assert.equal(events[end].phase,'EXIT_REPLY');
 assert.ok(events.slice(start,end).every(e=>e.muted));
 assert.equal(Date.parse(events[end].at)-Date.parse(events[start].at),64112);
 assert.deepEqual(saved.original_failure_speech_events,[]);
 assert.equal(saved.source_references.length,4);
 assert.ok(saved.source_references.every(r=>/^[a-f0-9]{64}$/.test(r.sha256)));
 assert.equal(sha(fs.readFileSync(fixtureUrl)),sha(bytes));
});

test('saved compound consent binds the exact preceding offer and accepted preparation settles the same current audio turn',()=>{
 const before=digest(saved),{s,g,result,media,events}=replayInitial();
 assert.equal(result.accepted,true);
 assert.equal(s.handoff_requests.length,1);
 const request=s.handoff_requests[0],offer=saved.turns[initialIndex-1];
 assert.equal(request.visitor_message_id,initialRequest.id);
 assert.equal(request.offer_turn_id,offer.id);assert.equal(request.offer_evidence,offer.content);
 assert.equal(initialRequest.content.slice(request.start,request.end),request.evidence);
 assert.equal(s.handoff_binding_attempts[0].request_turn_id,initialRequest.id);
 assert.equal(g.snapshot().accepted,true);assert.equal(g.snapshot().settled,true);
 assert.equal(events.at(-1).phase,'VERIFIED_RECEIPT');assert.equal(media.at(-1),false);
 assert.equal(result.accepted_proposal_count,original.result.accepted_proposal_count);
 for(const {id,...proposal} of s.proposals)assertProposal(proposal,s.turns,saved.fields);
 assert.deepEqual(s.turns,saved.turns.slice(0,initialIndex+1));
 assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
 assert.equal(digest(saved),before);assert.deepEqual(fs.readFileSync(fixtureUrl),bytes);
});

test('an early reply still cannot expose its tail merely because repaired consent produces an accepted receipt',()=>{
 const {s,g,result,media}=replayInitial({earlyReply:true});
 assert.equal(result.accepted,true);assert.equal(g.snapshot().settled,true);
 assert.equal(g.snapshot().accepted,true);assert.equal(media.at(-1),true);
 assert.equal(s.handoff_binding_attempts.length,1);assert.equal(s.approved,false);
});

test('saved correction and update with no new tool result never acquire preparation success from the first receipt',()=>{
 const x=replayInitial(),{s,g}=x,{correction,update}=throughSavedUpdate(x);
 assert.equal(s.handoff_binding_attempts.length,1,'no automatic handoff retry or invented update');
 assert.equal(s.handoff_requests.at(-1).visitor_message_id,update.id);
 assert.equal(s.handoff_requests.at(-1).status,'REQUESTED_NOT_MAPPED');
 assert.equal(g.snapshot().accepted,false);
 const stale=s.proposals.find(p=>p.visitor_message_id===saved.turns[1].id);
 assert.ok(stale);assert.throws(()=>assertProposal(stale,s.turns,saved.fields),/exact persisted visitor span/);
 assert.ok(s.turns.some(t=>t.id===correction.id&&t.content===correction.content));
 assert.equal(s.proposals.length,original.result.accepted_proposal_count);
 assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});

test('saved missing update result reaches one unverified recovery, never deadline-based unmute or invented failure/success',()=>{
 const c=clock(),recoveries=[];
 const x=replayInitial({gateOptions:{schedule:c.schedule,cancel:c.cancel,recoverUnverified:id=>recoveries.push(id)}});
 const {update}=throughSavedUpdate(x),before=structuredClone(x.s);
 assert.equal(c.scheduled.at(-1).ms,18000);assert.equal(c.timers.size,1);
 x.g.persona();c.expire();
 assert.deepEqual(recoveries,[update.id]);assert.equal(x.g.snapshot().outcome_unverified,true);
 assert.equal(x.events.at(-1).phase,'UNVERIFIED_OUTCOME');assert.equal(x.media.at(-1),true);
 assert.equal(x.g.snapshot().accepted,false);
 assert.deepEqual(x.s,before,'media recovery cannot alter the domain receipt or exact evidence');
 assert.equal(x.s.handoff_requests.at(-1).status,'REQUESTED_NOT_MAPPED');
 x.g.persona();x.g.committed(structuredClone(x.s));c.expire();
 assert.equal(recoveries.length,1);assert.equal(x.events.filter(e=>e.phase==='UNVERIFIED_OUTCOME').length,1);
 const next={id:'user::ordinary-after-timeout',role:'user',content:'What does a human review involve?'};
 x.g.speechStarted();x.g.visitor(next);appendTurn(x.s,next);x.g.committed(structuredClone(x.s));x.g.persona();
 assert.equal(x.media.at(-1),false,'a timed-out old request cannot hold every later ordinary answer');
 const newRequest={id:'user::new-review-request',role:'user',content:'Please prepare a local human-review note.'};
 x.g.speechStarted();x.g.visitor(newRequest);appendTurn(x.s,newRequest);x.g.committed(structuredClone(x.s));
 assert.equal(x.media.at(-1),true,'a new explicit request still requires its own outcome');
 assert.equal(x.s.handoff_binding_attempts.length,1);x.g.dispose();
});

test('unverified deadline requires the exact latest persisted active visitor and cannot use changed or foreign state',()=>{
 for(const mutation of ['not-persisted','closed','foreign-local','foreign-provider','changed-text','later-persisted']) {
  const c=clock(),recoveries=[],x=replayInitial({gateOptions:{schedule:c.schedule,cancel:c.cancel,recoverUnverified:id=>recoveries.push(id)}});
  const turn={id:'user::current-request',role:'user',content:'Please prepare a local brief.'};
  x.g.speechStarted();x.g.visitor(turn);
  if(mutation!=='not-persisted')appendTurn(x.s,turn);
  const state=structuredClone(x.s);
  if(mutation==='closed')state.status='CLOSED';
  if(mutation==='foreign-local')state.id='different-local';
  if(mutation==='foreign-provider')state.provider_session_id='different-provider';
  if(mutation==='changed-text')state.turns.at(-1).content='A different request.';
  if(mutation==='later-persisted')appendTurn(state,{id:'user::later',role:'user',content:'Let me clarify something.'});
  x.g.committed(state);c.expire();
  assert.deepEqual(recoveries,[],mutation);assert.equal(x.media.at(-1),true,mutation);
  assert.equal(x.g.snapshot().accepted,false,mutation);x.g.dispose();
 }
});

test('new speech, a different visitor turn, exit and disposal invalidate the old timeout callback',()=>{
 for(const action of ['speech','visitor','exit','dispose']) {
  const c=clock(),recoveries=[],x=replayInitial({gateOptions:{schedule:c.schedule,cancel:c.cancel,recoverUnverified:id=>recoveries.push(id)}});
  throughSavedUpdate(x);const delayed=c.scheduled.at(-1).fn;
  if(action==='speech')x.g.speechStarted();
  if(action==='visitor')x.g.visitor({id:'user::different-turn',role:'user',content:'I have another question.'});
  if(action==='exit')x.g.visitor({id:'user::exit-now',role:'user',content:'Thanks, goodbye.'});
  if(action==='dispose')x.g.dispose();
  delayed();assert.deepEqual(recoveries,[],action);
  assert.equal(x.events.some(e=>e.phase==='UNVERIFIED_OUTCOME'),false,action);
  if(action==='exit')assert.equal(x.media.at(-1),false);
  x.g.dispose();
 }
});

test('a current accepted receipt cancels its deadline and recovers an early acknowledgment at most once',()=>{
 const c=clock(),accepted=[],unverified=[];
 const x=replayInitial({earlyReply:true,gateOptions:{schedule:c.schedule,cancel:c.cancel,
  recoverAccepted:(tool,id)=>accepted.push({tool,id}),recoverUnverified:id=>unverified.push(id)}});
 assert.equal(x.g.snapshot().accepted,true);assert.equal(c.timers.size,0);
 assert.deepEqual(accepted,[{tool:original.tool_call_id,id:initialRequest.id}]);
 for(const {fn} of c.scheduled)fn();
 x.g.committed(structuredClone(x.s));x.g.persona();c.expire();
 assert.equal(accepted.length,1);assert.deepEqual(unverified,[]);
 assert.equal(x.media.at(-1),true,'only the separate correlated recovery may enable speech');
 x.g.dispose();
});

test('unverified media telemetry cannot fabricate an unmuted event or refer to a nonexistent visitor',()=>{
 const c=clock(),x=replayInitial({gateOptions:{schedule:c.schedule,cancel:c.cancel,recoverUnverified:()=>{}}});
 throughSavedUpdate(x);c.expire();
 const event=x.events.find(e=>e.phase==='UNVERIFIED_OUTCOME');assert.ok(event);
 const receipt={...event,local_session_id:x.s.id,provider_session_id:x.s.provider_session_id,launch_label:x.s.launch_label};
 assert.throws(()=>appendHandoffOutputEvidence(x.s,receipt),/retained guarded handoff context/);
 const held=x.events.filter(e=>e.visitor_message_id===event.visitor_message_id
  &&['WAITING_RECEIPT','EARLY_REPLY_HELD'].includes(e.phase)&&e.muted&&Date.parse(e.at)<=Date.parse(event.at));
 assert.ok(held.length);
 for(const prior of held)appendHandoffOutputEvidence(x.s,{...prior,local_session_id:x.s.id,
  provider_session_id:x.s.provider_session_id,launch_label:x.s.launch_label});
 const before=structuredClone(x.s);appendHandoffOutputEvidence(x.s,receipt);appendHandoffOutputEvidence(x.s,receipt);
 assert.equal(x.s.handoff_output_events.length,held.length+1);
 assert.throws(()=>appendHandoffOutputEvidence(x.s,{...receipt,event_id:'11111111-1111-4111-8111-111111111111',muted:false}));
 assert.throws(()=>appendHandoffOutputEvidence(x.s,{...receipt,event_id:'22222222-2222-4222-8222-222222222222',visitor_message_id:'user::missing'}));
 assert.deepEqual(x.s.proposals,before.proposals);assert.deepEqual(x.s.handoff_requests,before.handoff_requests);
 assert.equal(x.s.approved,false);assert.equal(x.s.provider_release_verified,false);x.g.dispose();
});
