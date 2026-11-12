import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {appendTurn,digest} from '../lib/factory/handoff.ts';
import {handoffOutputGate,appendHandoffOutputEvidence} from '../lib/factory/handoff-output-gate.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {submitHandoff} from '../lib/factory/handoff-context.ts';
const saved=JSON.parse(fs.readFileSync(new URL('./fixtures/factory-handoff-dual-reference-20261112.json',import.meta.url),'utf8'));
const user=(id,content)=>({id,role:'user',content});
function fresh(){return {id:'local',version:1,package_sha256:'fictional',persona_id:'persona',launch_label:'launch',status:'ACTIVE',provider_session_id:'provider',
 turns:[],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,
 approved:false,submission_status:'UNSUBMITTED',external_actions:[]};}
function gate(s){const events=[],media=[],notices=[];
 const g=handoffOutputGate({localSessionId:s.id,providerSessionId:()=>s.provider_session_id,
  output:m=>media.push(m),notice:n=>notices.push(n),report:e=>events.push(e)});
 g.committed(structuredClone(s));return {g,events,media,notices};}
function savedFailure(){
 const s={...fresh(),id:saved.local_session_id,provider_session_id:saved.provider_session_id,launch_label:saved.launch_label,
  turns:structuredClone(saved.turns_before_attempt.slice(0,-1))};
 const x=gate(s),turn=saved.turns_before_attempt.at(-1);
 x.g.speechStarted();x.g.visitor(turn);appendTurn(s,turn);x.g.committed(structuredClone(s));
 x.g.persona();x.g.handoffStarted(s.provider_session_id,saved.original_attempt.tool_call_id);
 // Replay the captured rejected receipt. Never rerun or alter the historical attempt.
 s.handoff_binding_attempts=[structuredClone(saved.original_attempt)];x.g.committed(structuredClone(s));return {s,...x};
}

test('saved failed tool settles without invented consent; early reply remains held and ordinary audio recovers',()=>{
 const original=digest(saved),{s,g,events,media,notices}=savedFailure();
 assert.equal(events.at(-1).phase,'FAILED_RECEIPT');assert.equal(media.at(-1),true);
 assert.equal(g.snapshot().settled,true);assert.equal(g.snapshot().accepted,false);
 assert.match(notices.at(-1),/Preparation failed.*Nothing has been sent/);
 assert.equal(s.handoff_requests,undefined);assert.equal(s.proposals.length,0);
 g.persona();g.committed(structuredClone(s));assert.equal(events.at(-1).phase,'FAILED_RECEIPT');assert.equal(media.at(-1),true,'do not expose held reply tail');
 const next=user('followup','Can you still explain the options?');g.speechStarted();g.visitor(next);appendTurn(s,next);g.committed(structuredClone(s));g.persona();
 assert.equal(events.at(-1).phase,'ORDINARY_REPLY');assert.equal(media.at(-1),false);
 g.handoffStarted(s.provider_session_id,saved.original_attempt.tool_call_id);g.committed(structuredClone(s));
 assert.equal(media.at(-1),false,'late duplicate of old call cannot mute the new turn');
 assert.equal(s.handoff_binding_attempts.length,1);assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);assert.equal(digest(saved),original);
});

test('receipt-before-speech rejection allows the native response without authorizing a handoff',()=>{
 for(const text of ['That sounds useful.','Let me explain our setup first.','Please prepare a local brief.']){
  const s=fresh(),x=gate(s),turn=user('question',text);x.g.visitor(turn);appendTurn(s,turn);x.g.committed(structuredClone(s));
  x.g.handoffStarted(s.provider_session_id,'tool');
  const result=recordProviderHandoffAttempt(s,[],[],'save',{local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:'tool'});
  assert.equal(result.accepted,false);x.g.committed(structuredClone(s));x.g.persona();
  assert.equal(x.events.at(-1).phase,'FAILED_RECEIPT');assert.equal(x.media.at(-1),false);assert.equal(x.g.snapshot().accepted,false);
  assert.equal(s.proposals.length,0);assert.equal(s.approved,false);
 }
});

test('foreign, stale, unknown and unbound accepted outcomes cannot use the failure recovery path',()=>{
 for(const mutation of ['other-session','other-provider','other-tool','other-turn','different-evidence','unknown','accepted','external-action']){
  const s={...fresh(),turns:[user('turn','That might be useful.')]},x=gate(s);x.g.visitor(s.turns[0]);x.g.handoffStarted(s.provider_session_id,'tool');
  recordProviderHandoffAttempt(s,[],[],'save',{local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:'tool'});
  const receipt=structuredClone(s),a=receipt.handoff_binding_attempts[0];
  if(mutation==='other-session')a.local_session_id='different';
  if(mutation==='other-provider')a.provider_session_id='different';
  if(mutation==='other-tool')a.tool_call_id='different';
  if(mutation==='other-turn')a.through_visitor_turn_id='different';
  if(mutation==='different-evidence')receipt.turns[0].content='changed';
  if(mutation==='unknown')a.result.status='UNKNOWN';
  if(mutation==='accepted'){a.applied=true;a.result.accepted=true;a.result.status='PENDING_OWNER_REVIEW';a.result.accepted_proposal_count=1;}
  if(mutation==='external-action')a.result.external_actions=['sent'];
  x.g.committed(receipt);assert.equal(x.g.snapshot().settled,false,mutation);assert.equal(x.media.at(-1),true,mutation);
 }
});

test('failed receipt without request binding needs an observed exact tool start',()=>{
 const {s}=savedFailure(),x=gate(s),turn=s.turns.at(-1);x.g.visitor(turn);x.g.persona();x.g.committed(s);
 assert.equal(x.g.snapshot().settled,false);assert.equal(x.events.at(-1).phase,'ORDINARY_REPLY');
 x.g.handoffStarted(s.provider_session_id,saved.original_attempt.tool_call_id);x.g.committed(s);
 assert.equal(x.g.snapshot().settled,true);assert.equal(x.events.at(-1).phase,'FAILED_RECEIPT');
});

test('a duplicate old start cannot remute a new turn even if the old result arrived late',()=>{
 const s=fresh(),x=gate(s);const old=user('old','That could work.');x.g.visitor(old);appendTurn(s,old);x.g.committed(structuredClone(s));
 x.g.handoffStarted(s.provider_session_id,'tool');
 const next=user('next','What information do you use?');x.g.speechStarted();x.g.visitor(next);appendTurn(s,next);x.g.committed(s);
 assert.equal(x.media.at(-1),false);x.g.handoffStarted(s.provider_session_id,'tool');assert.equal(x.media.at(-1),false);
});

test('exit has priority over failure settlement and delayed tool events',()=>{
 const {s,g,media}=savedFailure();g.visitor(user('bye','Thank you. Goodbye.'));
 g.handoffStarted(s.provider_session_id,'late-tool');g.committed(s);g.persona();
 assert.equal(g.snapshot().phase,'EXIT_REPLY');assert.equal(media.at(-1),false);assert.equal(g.snapshot().exiting,true);
 assert.equal(s.provider_release_verified,false,'gate cannot certify provider release');
});

test('failure recovery telemetry remains immutable and grants no approval, consent or provider release',()=>{
 const {s,events}=savedFailure(),event=events.at(-1),receipt={...event,local_session_id:s.id,provider_session_id:s.provider_session_id,launch_label:s.launch_label};
 appendHandoffOutputEvidence(s,receipt);appendHandoffOutputEvidence(s,receipt);assert.equal(s.handoff_output_events.length,1);
 assert.throws(()=>appendHandoffOutputEvidence(s,{...receipt,muted:!receipt.muted}),/immutable/);
 assert.throws(()=>appendHandoffOutputEvidence(s,{...receipt,tool_call_id:'other-tool'}),/exact session/);
 assert.equal(s.approved,false);assert.equal(s.provider_release_verified,false);assert.equal(s.handoff_requests,undefined);
});

test('installed SDK rejected-result sequence settles once and does not retry preparation',async()=>{
 const require=createRequire(import.meta.url),{ToolCallManager}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/ToolCallManager.js');
 const {PublicEventEmitter}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/PublicEventEmitter.js');
 const {InternalEventEmitter}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/InternalEventEmitter.js');
 const {InternalEvent}=require('../node_modules/@anam-ai/js-sdk/dist/main/types/index.js');
 const s=fresh(),x=gate(s),turn=user('turn','Here is more context.');x.g.visitor(turn);appendTurn(s,turn);x.g.committed(structuredClone(s));x.g.persona();
 const inside=new InternalEventEmitter(),manager=new ToolCallManager(new PublicEventEmitter(),inside),results=[];let calls=0;
 manager.setActiveSession(s.provider_session_id);inside.addListener(InternalEvent.TOOL_CALL_RESULT_READY,r=>results.push(r));
 manager.registerHandler('factory_handoff',{onStart:async p=>{
  x.g.handoffStarted(p.sessionId,p.toolCallId);
  return submitHandoff(p.arguments.proposals,async input=>{calls++;
   const result=recordProviderHandoffAttempt(s,input,[],'save',{local_session_id:s.id,provider_session_id:p.sessionId,tool_call_id:p.toolCallId});
   x.g.committed(structuredClone(s));return result;
  });
 }});
 await manager.processToolCallStartedEvent({session_id:s.provider_session_id,tool_call_id:'sdk-call',tool_name:'factory_handoff',tool_type:'client',arguments:{proposals:[]},timestamp:new Date().toISOString()});
 assert.equal(calls,1);assert.equal(results.length,1);assert.equal(JSON.parse(results[0].result).accepted,false);
 assert.equal(x.events.at(-1).phase,'FAILED_RECEIPT');assert.equal(x.media.at(-1),true);
 x.g.speechStarted();x.g.visitor(user('next','What happens during an assessment?'));x.g.persona();assert.equal(x.media.at(-1),false);
 assert.equal(calls,1);assert.equal(s.proposals.length,0);assert.deepEqual(s.external_actions,[]);
});
