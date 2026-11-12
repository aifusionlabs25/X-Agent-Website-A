import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {appendTurn} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {handoffOutputGate} from '../lib/factory/handoff-output-gate.ts';
import {submitHandoff} from '../lib/factory/handoff-context.ts';
import {requestedHandoffSpan} from '../lib/factory/handoff-request.ts';
const u=(id,content)=>({id,role:'user',content});
const fact=u('fact','We use a shared inbox.');
const fields=[{id:'tools',label:'Tools'}];
const proposal={field_id:'tools',visitor_message_id:fact.id,value:fact.content,evidence:fact.content};
function setup(){
 const s={id:'local',version:1,package_sha256:'fictional',persona_id:'persona',launch_label:'launch',status:'ACTIVE',provider_session_id:'provider',
 turns:[],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,provider_transcript_verified:false,
 evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]};
 appendTurn(s,fact);const events=[],media=[];
 const g=handoffOutputGate({localSessionId:s.id,providerSessionId:()=>s.provider_session_id,output:m=>media.push(m),notice:()=>{},report:e=>events.push(e)});
 g.committed(structuredClone(s));return {s,g,events,media};
}
function accept(s){return recordProviderHandoffAttempt(s,[proposal],fields,'request',{
 local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:'tool'});}

test('unrecognized input still holds when a handoff tool starts, without manufacturing consent',()=>{
 const {s,g,media,events}=setup(),turn=u('ambiguous','That might help.');
 g.visitor(turn);appendTurn(s,turn);g.committed(s);assert.equal(media.at(-1),false);
 g.handoffStarted('foreign','tool');assert.equal(media.at(-1),false);
 g.handoffStarted('provider','tool');assert.equal(media.at(-1),true);assert.equal(events.at(-1).tool_call_id,null);
 assert.equal(s.handoff_requests,undefined);assert.equal(accept(s).accepted,true);
 assert.equal(s.handoff_binding_attempts[0].request_turn_id,null);
 g.committed(s);assert.equal(media.at(-1),true,'unbound accepted outcome cannot release output');
 g.visitor(u('next','What does an assessment cover?'));assert.equal(media.at(-1),false);
 assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});

test('server-recognized current request upgrades a browser miss, with no early-tail release',()=>{
 for(const early of [false,true]){
  const {s,g,media,events}=setup();
  // Browser has not committed the immediately preceding offer yet.
  const offer={id:'offer',role:'persona',content:'Would you like me to prepare a local brief?'};
  appendTurn(s,offer);const turn=u('yes','Yes, please.');g.visitor(turn);
  assert.equal(g.snapshot().guarded,false);if(early)g.persona();
  appendTurn(s,turn);g.committed(s);assert.equal(g.snapshot().guarded,true);assert.equal(media.at(-1),true);
  assert.equal(accept(s).accepted,true);g.committed(s);
  assert.equal(g.snapshot().accepted,true);assert.equal(media.at(-1),early);
  assert.equal(events.at(-1).phase,'VERIFIED_RECEIPT');
 }
});

test('tool-start before delayed committed recognition retains whether output already began',()=>{
 for(const early of [false,true]){
  const {s,g,media}=setup();
  appendTurn(s,{id:'offer',role:'persona',content:'Shall I draft an unsent brief?'});
  const turn=u('answer','Please do.');g.visitor(turn);if(early)g.persona();
  g.handoffStarted('provider','tool');assert.equal(media.at(-1),true);
  appendTurn(s,turn);accept(s);g.committed(s);
  assert.equal(g.snapshot().accepted,true);assert.equal(media.at(-1),early);
 }
});

test('persona/tool before finalized visitor text cannot be forgotten by classification',()=>{
 for(const toolFirst of [false,true]){
  const {s,g,media}=setup();g.speechStarted();
  if(toolFirst)g.handoffStarted('provider','tool');g.persona();
  const turn=u('request','Please prepare a local brief.');g.visitor(turn);appendTurn(s,turn);g.committed(s);
  accept(s);g.committed(s);assert.equal(g.snapshot().accepted,true);assert.equal(media.at(-1),true);
  g.speechStarted();const next=u('next','What services are available?');g.visitor(next);
  assert.equal(media.at(-1),false,'old response flag must not poison the next ordinary reply');
 }
});

test('tool fallback and late recognition cannot reopen exit or accept foreign state',()=>{
 const {s,g,media}=setup();g.visitor(u('unknown','That sounds useful.'));g.handoffStarted('provider','tool');
 const turn=u('request','Please prepare an unsent brief.');appendTurn(s,turn);accept(s);
 g.committed({...s,id:'other'});assert.equal(media.at(-1),true);
 g.committed(s);assert.equal(g.snapshot().accepted,false,'different visitor request remains foreign');
 g.visitor(u('bye','Thanks, goodbye.'));g.handoffStarted('provider','tool');g.committed(s);g.persona();
 assert.equal(media.at(-1),false);assert.equal(g.snapshot().exiting,true);
});

test('new polite request forms cannot override a same-turn retraction',()=>{
 for(const text of ['Please update your handoff. Actually, do not go ahead and update it.',
  'Please draft a local brief. Never go ahead and prepare it.',
  "Go ahead and revise the handoff. Don't please go ahead and revise it."])
  assert.equal(requestedHandoffSpan(text),null);
});

test('a new tool call on a settled turn cannot reuse the old receipt or restart preparation',()=>{
 const {s,g,media}=setup(),turn=u('request','Please update the handoff.');
 g.visitor(turn);appendTurn(s,turn);g.handoffStarted('provider','tool');accept(s);g.committed(s);
 assert.equal(g.snapshot().accepted,true);assert.equal(media.at(-1),false);
 g.handoffStarted('provider','tool');assert.equal(media.at(-1),false,'duplicate start preserves settled outcome');
 g.handoffStarted('provider','second-tool');assert.equal(media.at(-1),true);assert.equal(g.snapshot().accepted,false);
 assert.throws(()=>recordProviderHandoffAttempt(s,[proposal],fields,'second',{
  local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:'second-tool'}),/do not retry/);
 g.committed(s);assert.equal(media.at(-1),true,'earlier accepted receipt belongs to a different call');
 assert.equal(s.handoff_binding_attempts.length,1);
});

test('installed SDK tool-start holds output before asynchronous storage, with one result and no retry',async()=>{
 const require=createRequire(import.meta.url);
 const {ToolCallManager}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/ToolCallManager.js');
 const {PublicEventEmitter}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/PublicEventEmitter.js');
 const {InternalEventEmitter}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/InternalEventEmitter.js');
 const {InternalEvent}=require('../node_modules/@anam-ai/js-sdk/dist/main/types/index.js');
 const {s,g,media}=setup(),turn=u('request','Could you update your existing handoff?');
 g.visitor(turn);appendTurn(s,turn);g.committed(s);
 const inside=new InternalEventEmitter(),manager=new ToolCallManager(new PublicEventEmitter(),inside),results=[];
 manager.setActiveSession('provider');inside.addListener(InternalEvent.TOOL_CALL_RESULT_READY,r=>results.push(r));
 let release,calls=0;const binding=new Promise(r=>release=r);
 manager.registerHandler('factory_handoff',{onStart:async p=>{
  g.handoffStarted(p.sessionId,p.toolCallId);await binding;
  return submitHandoff(p.arguments.proposals,async input=>{
   calls++;const result=recordProviderHandoffAttempt(s,input,fields,'sdk',{local_session_id:s.id,provider_session_id:p.sessionId,tool_call_id:p.toolCallId});
   g.committed(s);return result;
  });
 }});
 const running=manager.processToolCallStartedEvent({session_id:'provider',tool_call_id:'sdk-call',tool_name:'factory_handoff',tool_type:'client',arguments:{proposals:[proposal]},timestamp:new Date().toISOString()});
 assert.equal(media.at(-1),true);assert.equal(calls,0);g.persona();release();await running;
 assert.equal(calls,1);assert.equal(results.length,1);assert.equal(JSON.parse(results[0].result).accepted,true);
 assert.equal(media.at(-1),true,'late receipt must not expose the early reply tail');
});
