import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {sdkCloseTracker} from '../lib/factory/sdk-close.ts';
import {appendSdkCloseEvidence} from '../lib/factory/handoff.ts';

const source=process.env.AUDIO_SOURCE_ROOT||path.resolve(import.meta.dirname,'..');
const {handoffFailureSpeech,appendFailureSpeechEvidence,failureSpeechText}=await import(pathToFileURL(path.join(source,'lib/factory/handoff-failure-speech.ts')));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/factory-handoff-dual-reference-20261112.json',import.meta.url)));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function harness(){
 const s={id:fixture.local_session_id,launch_label:fixture.launch_label,status:'ACTIVE',provider_session_id:fixture.provider_session_id,
  turns:structuredClone(fixture.turns_before_attempt),handoff_binding_attempts:[structuredClone(fixture.original_attempt)],
  proposals:[],approved:false,submission_status:'UNSUBMITTED',external_actions:[]};
 const a=s.handoff_binding_attempts[0],visitor=a.through_visitor_turn_id,events=[],output=[],faults=[],timers=new Map();let n=0,correlation;
 const h=handoffFailureSpeech({localSessionId:s.id,providerSessionId:()=>s.provider_session_id,id:()=>uuid(++n),
  now:()=>new Date(Date.UTC(2026,10,14,23,40,n)).toISOString(),interrupt:()=>{},speak:async(c)=>{correlation=c;},
  output:m=>output.push(m),notice:()=>{},report:e=>events.push(e),failed:r=>faults.push(r),
  schedule:f=>{const id={};timers.set(id,f);return id;},cancel:id=>timers.delete(id)});
 h.toolStarted(s.provider_session_id,a.tool_call_id,visitor.slice(6));assert.equal(h.rejected(s,a.tool_call_id,visitor),true);
 h.stream({id:'persona::'+visitor.slice(6),role:'persona',content:'',endOfSpeech:true});
 return {s,h,events,output,faults,timers,canonical:'persona::'+correlation,
  external:`persona::external::${correlation}::${s.provider_session_id}`};
}
const speech=(id,content,endOfSpeech=false)=>({id,role:'persona',content,endOfSpeech});

test('the retained unverified recovery ID and exact words replay without the original correlation block',()=>{
 const replay=JSON.parse(fs.readFileSync(new URL('./fixtures/factory-saved-recovery-replay-20261114.json',import.meta.url)));
 const s=replay.state,request=replay.request,actual=replay.actual_recovery_turn,events=[],media=[];let n=0;
 const h=handoffFailureSpeech({localSessionId:s.id,providerSessionId:()=>s.provider_session_id,
  id:()=>n++===0?request.recovery_reply_id.slice('persona::factory-failure-'.length):uuid(n),
  now:()=>request.at,interrupt:()=>{},speak:async()=>{},output:m=>media.push(m),notice:()=>{},report:e=>events.push(e)});
 assert.equal(h.unverified(s,request.visitor_message_id),true);
 h.stream(speech(request.native_reply_id,'',true));h.stream(speech(actual.id,actual.content,true));
 assert.equal(replay.original_block.detail,'UNEXPECTED_PERSONA_CORRELATION');
 assert.equal(media.at(-1),'ALLOW');assert.equal(events.at(-1).phase,'RECOVERY_TEXT_ENDED');
 assert.equal(events.at(-1).observed_reply_id,actual.id);
 for(const event of events)appendFailureSpeechEvidence(s,{...event,local_session_id:s.id,provider_session_id:s.provider_session_id,launch_label:s.launch_label});
 h.dispose();
});

test('Anam external direct-speech ID is recognized only for this exact correlation and provider session',()=>{
 const x=harness();assert.equal(x.h.isHeldOrRecoveryReply(x.external),true);
 x.h.stream(speech(x.external,failureSpeechText,true));
 assert.equal(x.output.at(-1),'ALLOW');assert.equal(x.events.at(-1).phase,'RECOVERY_TEXT_ENDED');
 assert.equal(x.events.at(-1).observed_reply_id,x.external);assert.deepEqual(x.faults,[]);
 for(const e of x.events)appendFailureSpeechEvidence(x.s,{...e,local_session_id:x.s.id,provider_session_id:x.s.provider_session_id,launch_label:x.s.launch_label});
 assert.equal(x.s.handoff_failure_speech_events.at(-1).observed_reply_id,x.external);
 assert.equal(x.s.approved,false);assert.deepEqual(x.s.external_actions,[]);
});

test('foreign sessions, extra suffixes and mixed reply identities fail closed without a retry',()=>{
 for(const mutate of [x=>x.external+'::extra',x=>x.external.replace(x.s.provider_session_id,'other-session'),x=>x.external.replace('factory-failure-','another-')]){
  const x=harness();x.h.stream(speech(mutate(x),failureSpeechText,true));
  assert.equal(x.output.at(-1),'HOLD');assert.equal(x.events.at(-1).phase,'BLOCKED');assert.equal(x.faults.length,1);
  x.h.stream(speech(x.external,failureSpeechText,true));assert.equal(x.faults.length,1);
 }
 const x=harness(),prefix=failureSpeechText.slice(0,20);x.h.stream(speech(x.external,prefix));
 x.h.stream(speech(x.canonical,failureSpeechText.slice(prefix.length),true));
 assert.equal(x.output.at(-1),'HOLD');assert.equal(x.events.at(-1).detail,'RECOVERY_REPLY_ID_CHANGED');
});

test('timeout reports one terminal recovery fault, never opens native output or retries',()=>{
 const x=harness();for(const f of [...x.timers.values()])f();
 assert.deepEqual(x.faults,['EXPECTED_SPEECH_EVENT_TIMEOUT']);assert.equal(x.output.at(-1),'HOLD');
 x.h.stream(speech(x.external,failureSpeechText,true));assert.equal(x.faults.length,1);
});

test('observed reply evidence cannot cross provider sessions or change after text starts',()=>{
 const x=harness();x.h.stream(speech(x.external,failureSpeechText,true));
 const receipts=x.events.map(e=>({...e,local_session_id:x.s.id,provider_session_id:x.s.provider_session_id,launch_label:x.s.launch_label}));
 for(const e of receipts)appendFailureSpeechEvidence(x.s,e);
 const last=receipts.at(-1);
 assert.throws(()=>appendFailureSpeechEvidence(x.s,{...last,event_id:uuid(999),observed_reply_id:x.external+'x'}));
 assert.throws(()=>appendFailureSpeechEvidence(x.s,{...last,event_id:uuid(998),observed_reply_id:x.canonical}));
});

test('changing the bound provider during recovery fails closed',()=>{
 const x=harness();x.s.provider_session_id='changed-provider';x.h.stream(speech(x.external,failureSpeechText,true));
 assert.equal(x.output.at(-1),'HOLD');assert.deepEqual(x.faults,['PROVIDER_SESSION_CHANGED']);
});

// Execute the actual component stop function with a mocked SDK and storage.
// A stalled storage write must not delay SDK cleanup or expose held native audio.
function stopHarness({sdkReject=false}={}){
 const require=createRequire(import.meta.url),ts=require('typescript');
 const code=fs.readFileSync(path.join(source,'components/factory/FactoryPilot.tsx'),'utf8');
 const file=ts.createSourceFile('FactoryPilot.tsx',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let node;
 const find=n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='stop')node=n;ts.forEachChild(n,find);};find(file);assert.ok(node);
 const fn=ts.transpileModule(node.getText(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const order=[],events=[];let resolveStore,resolveSdk;
 const tracker=sdkCloseTracker({id:()=>uuid(901),stop:()=>{order.push('sdk');return sdkReject?Promise.reject(Error('stop failed')):new Promise(r=>{resolveSdk=r;});},report:e=>events.push(e)});
 const context={stopping:{current:false},client:{current:{}},farewell:{current:{dispose:()=>order.push('farewell-dispose')}},speechGeneration:{current:0},
  outputGate:{current:{dispose:()=>order.push('gate-release')}},failureSpeech:{current:{cancel:()=>order.push('recovery-release')}},
  current:{current:{status:'ACTIVE'}},setStatus:()=>{},setError:()=>order.push('storage-error'),
  post:()=>{order.push('closing-store');return new Promise(r=>{resolveStore=r;});},closer:{current:tracker},reconcile:async()=>order.push('reconcile')};
 const stop=new Function(...Object.keys(context),fn+';return stop;')(...Object.values(context));
 return {stop,order,events,tracker,resolveStore:()=>resolveStore(),resolveSdk:()=>resolveSdk()};
}
test('actual page failure-close invokes SDK while storage is stalled and holds audio until SDK stops',async()=>{
 const x=stopHarness(),pending=x.stop('RECOVERY_FAILED');await Promise.resolve();await Promise.resolve();
 assert.ok(x.order.includes('sdk'));assert.equal(x.order.includes('gate-release'),false);assert.equal(x.order.includes('recovery-release'),false);
 await x.stop('OWNER_FINISH');assert.equal(x.tracker.snapshot().invocations,1);
 x.resolveSdk();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.ok(x.order.includes('recovery-release'));assert.equal(x.order.includes('reconcile'),false);
 x.resolveStore();await pending;assert.equal(x.order.at(-1),'reconcile');
 assert.equal(x.events[0].reason,'RECOVERY_FAILED');
 const state={id:'local',launch_label:'fixture',provider_session_id:'provider',status:'ACTIVE',provider_release_verified:false,approved:false};
 for(const event of x.events)appendSdkCloseEvidence(state,{...event,local_session_id:'local',launch_label:'fixture',provider_session_id:'provider'});
 assert.equal(state.provider_release_verified,false);assert.equal(state.status,'ACTIVE');assert.equal(state.approved,false);
});
test('a failed actual SDK close never releases held native audio or invents reconciliation',async()=>{
 const x=stopHarness({sdkReject:true});await assert.rejects(x.stop('RECOVERY_FAILED'),/stop failed/);
 assert.equal(x.order.includes('gate-release'),false);assert.equal(x.order.includes('recovery-release'),false);assert.equal(x.order.includes('reconcile'),false);
 assert.equal(x.tracker.snapshot().invocations,1);x.resolveStore();
});
