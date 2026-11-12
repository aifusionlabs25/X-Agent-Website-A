import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {handoffFailureSpeech,handoffAudioOutput,appendFailureSpeechEvidence,failureSpeechText} from '../lib/factory/handoff-failure-speech.ts';
import {handoffOutputGate} from '../lib/factory/handoff-output-gate.ts';
import {appendTurn} from '../lib/factory/handoff.ts';
import {committedTurnEffects} from '../lib/factory/turn-effects.ts';
import {createFarewellCloseCoordinator} from '../lib/anam/farewell-close-coordinator.ts';

// These checks simulate text events and media-control callbacks. They do not
// establish acoustic delivery, provider buffer drainage, or any live setting.
const fixtureUrl=new URL('./fixtures/factory-handoff-dual-reference-20261112.json',import.meta.url);
const originalBytes=fs.readFileSync(fixtureUrl),saved=JSON.parse(originalBytes);
const tool=saved.original_attempt.tool_call_id,visitor=saved.original_attempt.through_visitor_turn_id;
const correlation=visitor.slice(6),native='persona::'+correlation;
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
const persona=(id,content='',endOfSpeech=false,extra={})=>({id,role:'persona',content,endOfSpeech,...extra});
function state(){return {
 id:saved.local_session_id,version:1,package_sha256:'fictional',persona_id:'persona',launch_label:saved.launch_label,
 status:'ACTIVE',provider_session_id:saved.provider_session_id,turns:structuredClone(saved.turns_before_attempt),
 proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,provider_transcript_verified:false,
 evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[],
 handoff_binding_attempts:[structuredClone(saved.original_attempt)],
};}
function setup(overrides={}){
 const s=state(),events=[],media=[],notices=[],talks=[],order=[],timers=new Map();let count=0,interrupts=0,tick=0;
 const h=handoffFailureSpeech({localSessionId:s.id,providerSessionId:()=>s.provider_session_id,
  id:()=>uuid(++count),now:()=>new Date(Date.UTC(2026,10,12,0,0,tick++)).toISOString(),
  interrupt:()=>{interrupts++;order.push('interrupt');},
  speak:async(c,text)=>{talks.push({correlationId:c,text});order.push('talk');},
  output:mode=>{media.push(mode);order.push(mode);},notice:n=>notices.push(n),report:e=>events.push(e),
  schedule:callback=>{const key={};timers.set(key,callback);return key;},cancel:key=>timers.delete(key),...overrides});
 const register=()=>h.toolStarted(s.provider_session_id,tool,correlation);
 const begin=()=>{register();return h.rejected(s,tool,visitor);};
 const endNative=()=>h.stream(persona(native,'',true,{interrupted:true}));
 const expire=()=>{const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks)callback();};
 return {s,h,events,media,notices,talks,order,timers,register,begin,endNative,expire,get interrupts(){return interrupts;}};
}

test('saved rejection interrupts the early native reply once and only the exact recovery text enables output',async()=>{
 const x=setup(),before=JSON.stringify(x.s);
 x.h.stream(persona(native,'I have prepared your brief.'));
 assert.equal(x.begin(),true);assert.equal(x.interrupts,1);assert.deepEqual(x.talks,[]);assert.equal(x.media.at(-1),'HOLD');
 assert.equal(x.h.rejected(x.s,tool,visitor),false);assert.equal(x.interrupts,1);
 x.h.stream(persona(native,'This native tail must stay muted.'));
 x.h.stream(persona('persona::unrelated','',true));assert.equal(x.talks.length,0);
 x.endNative();assert.equal(x.talks.length,1);assert.equal(x.talks[0].text,failureSpeechText);
 assert.equal(x.media.at(-1),'HOLD','SDK submission alone never grants audible output');
 await flush();assert.equal(x.events.at(-1).phase,'TALK_RETURNED');assert.equal(x.events.at(-1).detail,'SDK_SUBMISSION_ONLY');
 assert.equal(x.media.includes('ALLOW'),false);
 const reply='persona::'+x.talks[0].correlationId;
 assert.equal(x.h.isRecoveryReply(reply),true);assert.equal(x.h.isRecoveryReply(native),false);
 x.h.stream(persona(reply,'',false));assert.equal(x.media.includes('ALLOW'),false);
 const prefix="I couldn't prepare the handoff.";
 x.h.stream(persona(reply,prefix));assert.equal(x.media.at(-1),'ALLOW');
 x.h.stream(persona(reply,failureSpeechText.slice(prefix.length),true));
 assert.equal(x.events.at(-1).phase,'RECOVERY_TEXT_ENDED');assert.equal(x.events.at(-1).detail,'TEXT_COMPLETION_NOT_AUDIO_DRAIN');
 assert.equal(x.timers.size,0);assert.equal(x.media.at(-1),'ALLOW','text completion must not truncate the last audible word');
 x.endNative();x.h.stream(persona(reply,'',true));x.expire();
 assert.equal(x.talks.length,1);assert.equal(x.events.filter(e=>e.phase==='RECOVERY_TEXT_ENDED').length,1);
 assert.equal(JSON.stringify(x.s),before,'recovery must not mutate the rejected handoff or grant approval');
 assert.deepEqual(fs.readFileSync(fixtureUrl),originalBytes,'saved evidence remains byte-for-byte unchanged');
});

test('an already observed native end permits direct speech without another interrupt or a timer-based unmute',async()=>{
 const x=setup();x.h.stream(persona(native,'An earlier completed reply.',true));assert.equal(x.begin(),true);
 assert.equal(x.interrupts,0);assert.equal(x.talks.length,1);assert.deepEqual(x.media,['HOLD']);
 assert.equal(x.events.find(e=>e.phase==='NATIVE_REPLY_ENDED').detail,'PREVIOUSLY_OBSERVED_TEXT_END');
 await flush();assert.equal(x.media.includes('ALLOW'),false);
});

test('missing, stale, foreign, malformed and successful handoffs cannot invoke failure speech',()=>{
 const cases={
  'missing tool registration':x=>{},
  'missing correlation':x=>x.h.toolStarted(x.s.provider_session_id,tool),
  'wrong correlation':x=>x.h.toolStarted(x.s.provider_session_id,tool,'another-turn'),
  'foreign tool provider':x=>x.h.toolStarted('other-provider',tool,correlation),
  'invalid correlation':x=>x.h.toolStarted(x.s.provider_session_id,tool,'invalid::correlation'),
  'foreign local session':x=>{x.register();x.s.id='another-local';},
  'inactive session':x=>{x.register();x.s.status='CLOSED';},
  'later visitor':x=>{x.register();x.s.turns.push({id:'user::later',role:'user',content:'A later question.'});},
  'foreign attempt local':x=>{x.register();x.s.handoff_binding_attempts[0].local_session_id='another-local';},
  'foreign attempt provider':x=>{x.register();x.s.handoff_binding_attempts[0].provider_session_id='another-provider';},
  'wrong tool':x=>{x.register();x.s.handoff_binding_attempts[0].tool_call_id='another-tool';},
  'wrong visitor':x=>{x.register();x.s.handoff_binding_attempts[0].through_visitor_turn_id='user::another';},
  'successful receipt':x=>{x.register();const a=x.s.handoff_binding_attempts[0];a.applied=true;a.result.accepted=true;},
  'ambiguous receipt':x=>{x.register();x.s.handoff_binding_attempts[0].result.status='UNKNOWN';},
  'external action':x=>{x.register();x.s.handoff_binding_attempts[0].result.external_actions=['sent'];},
  'owner approval':x=>{x.register();x.s.handoff_binding_attempts[0].result.owner_approved=true;},
 };
 for(const [label,prepare] of Object.entries(cases)){
  const x=setup();prepare(x);assert.equal(x.h.rejected(x.s,tool,visitor),false,label);
  x.endNative();x.expire();assert.deepEqual(x.talks,[],label);assert.deepEqual(x.media,[],label);assert.equal(x.interrupts,0,label);
 }
});

test('native-end timeout fails closed, retains a visible failure notice and never retries',()=>{
 const x=setup();x.begin();x.expire();assert.equal(x.events.at(-1).detail,'EXPECTED_SPEECH_EVENT_TIMEOUT');
 assert.equal(x.media.at(-1),'HOLD');assert.match(x.notices.at(-1),/spoken explanation could not be verified/);
 x.endNative();x.expire();assert.equal(x.talks.length,0);assert.equal(x.h.rejected(x.s,tool,visitor),false);
 assert.equal(x.interrupts,1);assert.equal(x.events.filter(e=>e.phase==='BLOCKED').length,1);
});

test('pending speech submission cannot unmute after its event timeout or delayed promise resolution',async()=>{
 let resolve;const x=setup({speak:()=>new Promise(r=>{resolve=r;})});x.begin();x.endNative();
 x.expire();resolve();await flush();
 x.h.stream(persona(x.h.snapshot().reply_id,failureSpeechText,true));
 assert.equal(x.media.includes('ALLOW'),false);assert.equal(x.events.some(e=>e.phase==='TALK_RETURNED'),false);
 assert.equal(x.h.rejected(x.s,tool,visitor),false);assert.equal(x.events.filter(e=>e.phase==='TALK_INVOKED').length,1);
});

test('new visitor speech, exit and disposal prevent a queued recovery after cancellation',async()=>{
 for(const reason of ['NEW_VISITOR_SPEECH','VISITOR_EXIT','DISPOSE']){
  const x=setup();x.begin();
  if(reason==='DISPOSE')x.h.dispose();else x.h.cancel(reason);
  x.endNative();x.expire();await flush();
  assert.equal(x.talks.length,0,reason);assert.equal(x.media.includes('ALLOW'),false,reason);
  assert.equal(x.media.at(-1),'RELEASE',reason);assert.equal(x.events.at(-1).detail,reason);
  x.h.cancel(reason);x.h.dispose();assert.equal(x.events.filter(e=>e.phase==='CANCELED').length,1,reason);
  assert.equal(x.h.rejected(x.s,tool,visitor),false,reason+' cannot retry the canceled tool');
 }
});

test('cancellation interrupts an in-flight direct reply once and its delayed completion cannot re-enable audio',async()=>{
 for(const reason of ['NEW_VISITOR_SPEECH','VISITOR_EXIT','DISPOSE']){
  let resolve;const x=setup({speak:()=>new Promise(r=>{resolve=r;})});x.begin();x.endNative();
  const reply=x.h.snapshot().reply_id;
  if(reason==='DISPOSE')x.h.dispose();else x.h.cancel(reason);
  assert.equal(x.interrupts,2,reason+' stops native reply and direct speech separately');
  resolve();await flush();x.h.stream(persona(reply,failureSpeechText,true));x.expire();
  assert.equal(x.media.includes('ALLOW'),false);assert.equal(x.media.at(-1),'RELEASE');
  x.h.cancel(reason);assert.equal(x.interrupts,2);assert.equal(x.events.filter(e=>e.phase==='TALK_RETURNED').length,0);
 }
});

test('foreign correlations, changed wording, truncated endings and interrupted direct replies fail closed',()=>{
 const cases={
  'foreign reply':x=>persona('persona::foreign','A handoff was prepared.'),
  'altered wording':x=>persona(x.h.snapshot().reply_id,'Your handoff was prepared.'),
  'truncated ending':x=>persona(x.h.snapshot().reply_id,"I couldn't prepare",true),
  'interrupted recovery':x=>persona(x.h.snapshot().reply_id,failureSpeechText,true,{interrupted:true}),
  'late native tail':x=>persona(native,'This was the original reply tail.'),
 };
 for(const [label,event] of Object.entries(cases)){
  const x=setup();x.begin();x.endNative();x.h.stream(event(x));
  assert.equal(x.events.at(-1).phase,'BLOCKED',label);assert.equal(x.media.includes('ALLOW'),false,label);
  x.h.stream(persona(x.h.snapshot().reply_id,failureSpeechText,true));assert.equal(x.media.at(-1),'HOLD',label);
  x.expire();assert.equal(x.talks.length,1,label);assert.equal(x.h.rejected(x.s,tool,visitor),false,label);
 }
});

test('an exact prefix cannot authorize a later mismatching fragment',()=>{
 const x=setup();x.begin();x.endNative();const reply=x.h.snapshot().reply_id;
 x.h.stream(persona(reply,"I couldn't prepare the handoff."));assert.equal(x.media.at(-1),'ALLOW');
 x.h.stream(persona(reply,' But it was sent anyway.',true));assert.equal(x.media.at(-1),'HOLD');
 assert.equal(x.events.at(-1).detail,'UNEXPECTED_RECOVERY_TEXT');assert.equal(x.events.some(e=>e.phase==='RECOVERY_TEXT_ENDED'),false);
});

test('interrupt and direct speech failures remain muted without a hidden retry',async()=>{
 for(const failure of ['interrupt','synchronous talk','asynchronous talk']){
  const overrides=failure==='interrupt'?{interrupt:()=>{throw new Error('offline interrupt failure');}}:
   {speak:failure==='synchronous talk'?()=>{throw new Error('offline talk failure');}:async()=>{throw new Error('offline talk failure');}};
  const x=setup(overrides);x.begin();x.endNative();await flush();
  assert.equal(x.events.at(-1).phase,'BLOCKED',failure);assert.equal(x.media.includes('ALLOW'),false,failure);
  assert.equal(x.h.rejected(x.s,tool,visitor),false,failure);assert.equal(x.events.filter(e=>e.phase==='TALK_INVOKED').length,failure==='interrupt'?0:1);
 }
});

test('installed SDK direct speech sends exactly the fixed text on the existing session transport',async()=>{
 const require=createRequire(import.meta.url),{TalkMessageStream}=require('../node_modules/@anam-ai/js-sdk/dist/main/types/TalkMessageStream.js');
 const {InternalEventEmitter}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/InternalEventEmitter.js');
 const messages=[],emitter=new InternalEventEmitter(),signalling={sendTalkMessage:async message=>{messages.push(message);}};
 const x=setup({speak:async(c,text)=>{const stream=new TalkMessageStream(c,emitter,signalling);await stream.streamMessageChunk(text,true);}});
 x.begin();assert.equal(messages.length,0);x.endNative();await flush();
 assert.equal(messages.length,1);assert.deepEqual(messages[0],{
  content:failureSpeechText,startOfSpeech:true,endOfSpeech:true,correlationId:x.h.snapshot().reply_id.slice(9),
 });
 assert.equal(x.media.includes('ALLOW'),false,'transport completion is not acoustic or correlation proof');
 assert.equal(x.events.at(-1).detail,'SDK_SUBMISSION_ONLY');
 assert.equal(messages[0].voiceId,undefined,'same active-session talk API receives no voice/persona override');
});

test('correlated recovery receipts are immutable, session-bound and confer no handoff or provider authority',async()=>{
 const x=setup(),before=createHash('sha256').update(JSON.stringify(x.s.handoff_binding_attempts)).digest('hex');
 x.begin();x.endNative();await flush();const reply=x.h.snapshot().reply_id;
 x.h.stream(persona(reply,failureSpeechText,true));
 const receipts=x.events.map(e=>({...e,local_session_id:x.s.id,provider_session_id:x.s.provider_session_id,launch_label:x.s.launch_label}));
 for(const receipt of receipts)appendFailureSpeechEvidence(x.s,receipt);
 const last=receipts.at(-1);appendFailureSpeechEvidence(x.s,last);
 assert.equal(x.s.handoff_failure_speech_events.length,receipts.length);
 assert.throws(()=>appendFailureSpeechEvidence(x.s,{...last,detail:'changed'}),/immutable/);
 for(const [field,value] of Object.entries({local_session_id:'other',provider_session_id:'other',launch_label:'other',tool_call_id:'other',visitor_message_id:'user::other',native_reply_id:'persona::other'})){
  assert.throws(()=>appendFailureSpeechEvidence(x.s,{...last,event_id:uuid(900),[field]:value}),/exact rejected attempt/,field);
 }
 assert.throws(()=>appendFailureSpeechEvidence(x.s,{...last,event_id:uuid(901),recovery_reply_id:'persona::factory-failure-'+uuid(902)}),/identity conflict/);
 assert.throws(()=>appendFailureSpeechEvidence(state(),last),/phase or identity conflict/,'completion cannot be imported without requested evidence');
 assert.throws(()=>appendFailureSpeechEvidence(x.s,{...last,event_id:uuid(903),phase:'SENT'}),/exact rejected attempt/);
 const originalDetail=x.s.handoff_failure_speech_events[0].detail;receipts[0].detail='mutated after append';
 assert.equal(x.s.handoff_failure_speech_events[0].detail,originalDetail,'persisted receipt must own an immutable clone');
 assert.equal(x.s.approved,false);assert.equal(x.s.provider_release_verified,false);assert.equal(x.s.provider_transcript_verified,false);
 assert.equal(x.s.handoff_requests,undefined);assert.deepEqual(x.s.proposals,[]);assert.deepEqual(x.s.external_actions,[]);
 assert.equal(x.s.submission_status,'UNSUBMITTED');assert.equal(x.s.status,'ACTIVE');
 assert.equal(createHash('sha256').update(JSON.stringify(x.s.handoff_binding_attempts)).digest('hex'),before);
});

test('audio arbiter holds unsafe output, preserves correlated speech across receipt saves and restores the latest gate',()=>{
 const muted=[],audio=handoffAudioOutput(value=>muted.push(value));
 audio.gate(false);assert.equal(muted.at(-1),false);
 audio.recovery('HOLD');audio.gate(false);audio.gate(false);assert.equal(muted.at(-1),true,'ordinary gate cannot expose held native audio');
 audio.recovery('ALLOW');assert.equal(muted.at(-1),false);
 for(let i=0;i<3;i++)audio.gate(true);
 assert.equal(muted.at(-1),false,'persisting failure evidence must not remute the verified correlated explanation');
 audio.recovery('RELEASE');assert.equal(muted.at(-1),true,'release honors the latest gate rather than an old unmuted value');
 audio.recovery('HOLD');audio.gate(false);assert.equal(muted.at(-1),true);
 audio.recovery('RELEASE');assert.equal(muted.at(-1),false,'a new ordinary/exit turn retakes control');
});

test('canceling direct speech returns audio control to the current ordinary or exit gate',()=>{
 for(const gateHeld of [true,false]){
  const muted=[],audio=handoffAudioOutput(value=>muted.push(value)),x=setup({output:audio.recovery});
  audio.gate(true);x.begin();x.endNative();
  x.h.stream(persona(x.h.snapshot().reply_id,"I couldn't prepare the handoff."));
  assert.equal(muted.at(-1),false);audio.gate(gateHeld);assert.equal(muted.at(-1),false);
  x.h.cancel(gateHeld?'NEW_VISITOR_SPEECH':'VISITOR_EXIT');assert.equal(muted.at(-1),gateHeld);
  audio.gate(!gateHeld);assert.equal(muted.at(-1),!gateHeld,'canceled recovery cannot keep overriding future turn controls');
 }
});

function gateWithRecovery({early=true,mutate=()=>{}}={}){
 const muted=[],notices=[],callbacks=[],audio=handoffAudioOutput(value=>muted.push(value));
 const x=setup({output:audio.recovery,notice:value=>notices.push(value)});
 const g=handoffOutputGate({localSessionId:x.s.id,providerSessionId:()=>x.s.provider_session_id,
  output:audio.gate,notice:value=>notices.push(value),report:()=>{},recoverFailure:(call,id)=>{
   callbacks.push({call,id});x.h.rejected(x.s,call,id);
  }});
 const pending=structuredClone(x.s);pending.turns.pop();delete pending.handoff_binding_attempts;g.committed(pending);
 const turn=x.s.turns.at(-1);g.speechStarted();g.visitor(turn);pending.turns.push(structuredClone(turn));g.committed(pending);
 if(early){g.persona();x.h.stream(persona(native,'A native reply started before the result.'));}
 x.register();g.handoffStarted(x.s.provider_session_id,tool);mutate(x.s);g.committed(structuredClone(x.s));
 return {...x,g,muted,notices,callbacks};
}

test('output gate invokes recovery only once for the exact rejected early reply and cannot overwrite its blocked notice',()=>{
 const x=gateWithRecovery();assert.deepEqual(x.callbacks,[{call:tool,id:visitor}]);assert.equal(x.talks.length,0);
 x.expire();const blockedNotice=x.notices.at(-1);assert.match(blockedNotice,/spoken explanation could not be verified/);
 for(let i=0;i<3;i++){x.g.committed(structuredClone(x.s));x.g.persona();}
 assert.equal(x.notices.at(-1),blockedNotice,'saved telemetry cannot replace recovery failure with the generic receipt notice');
 assert.equal(x.callbacks.length,1);assert.equal(x.talks.length,0);assert.equal(x.muted.at(-1),true);
 for(const options of [
  {early:false},
  {mutate:s=>{s.handoff_binding_attempts[0].provider_session_id='foreign';}},
  {mutate:s=>{s.handoff_binding_attempts[0].tool_call_id='foreign';}},
  {mutate:s=>{s.handoff_binding_attempts[0].through_visitor_turn_id='user::foreign';}},
  {mutate:s=>{s.handoff_binding_attempts[0].applied=true;s.handoff_binding_attempts[0].result.accepted=true;}},
 ]){
  const other=gateWithRecovery(options);assert.equal(other.callbacks.length,0);assert.equal(other.talks.length,0);
 }
});

test('saving recovery telemetry through the committed gate cannot mute the fixed explanation',()=>{
 const x=gateWithRecovery();x.endNative();const reply=x.h.snapshot().reply_id;
 x.h.stream(persona(reply,"I couldn't prepare the handoff."));assert.equal(x.muted.at(-1),false);
 for(let i=0;i<3;i++)x.g.committed(structuredClone(x.s));
 assert.equal(x.muted.at(-1),false);assert.equal(x.callbacks.length,1);assert.equal(x.talks.length,1);
 x.h.stream(persona(reply,failureSpeechText.slice("I couldn't prepare the handoff.".length),true));
 x.g.committed(structuredClone(x.s));assert.equal(x.muted.at(-1),false,'final spoken words remain available after text end');
 x.h.cancel('VISITOR_EXIT');x.g.visitor({id:'user::exit',role:'user',content:'Thanks, goodbye.'});
 assert.equal(x.muted.at(-1),false);assert.equal(x.s.provider_release_verified,false,'audio recovery cannot certify closure');
});

test('telemetry rejects completion or SDK return without their actual prerequisite stages',()=>{
 for(const phase of ['RECOVERY_TEXT_ENDED','TALK_RETURNED']){
  const x=setup();x.begin();
  const requested={...x.events.find(e=>e.phase==='REQUESTED'),local_session_id:x.s.id,
   provider_session_id:x.s.provider_session_id,launch_label:x.s.launch_label};
  appendFailureSpeechEvidence(x.s,requested);
  assert.throws(()=>appendFailureSpeechEvidence(x.s,{...requested,event_id:uuid(950),phase}),/phase|stage|order|prerequisite/i,phase);
  assert.equal(x.s.handoff_failure_speech_events.length,1,'malformed telemetry must remain unpersisted');
 }
});

test('text completion and blocked mismatches do not waive cancellation of submitted audio',()=>{
 for(const ending of ['complete text','blocked mismatch']){
  const x=setup();x.begin();x.endNative();const reply=x.h.snapshot().reply_id;
  x.h.stream(persona(reply,ending==='complete text'?failureSpeechText:'A mismatching response.',true));
  assert.equal(x.interrupts,1,'initial interrupt only before cancellation');
  assert.equal(x.talks.length,1);
  x.h.cancel('NEW_VISITOR_SPEECH');assert.equal(x.interrupts,2,ending+' is not proof of drained audio');
  x.h.cancel('VISITOR_EXIT');x.h.dispose();assert.equal(x.interrupts,2,'submitted speech is interrupted only once at cancellation');
  assert.equal(x.media.at(-1),'RELEASE');assert.equal(x.events.filter(e=>e.phase==='CANCELED').length,1);
 }
});

test('late native and recovery history after visitor goodbye stays retained without completing the new farewell',()=>{
 const x=setup(),originalTurns=structuredClone(x.s.turns),originalAttempt=structuredClone(x.s.handoff_binding_attempts);
 let tick=0,stops=0,completions=0;const timers=new Map();
 const close=createFarewellCloseCoordinator({stopStreaming:()=>{stops++;},
  schedule:(fn,ms)=>{const key={};timers.set(key,{fn,at:tick+ms});return key;},cancel:key=>timers.delete(key)});
 const advance=ms=>{tick+=ms;for(const [key,t] of [...timers])if(t.at<=tick){timers.delete(key);t.fn();}};
 const commit=turn=>{
  appendTurn(x.s,turn);
  committedTurnEffects(x.s,turn,{armClose:close.arm,finalReply:()=>{
   if(!x.h.isHeldOrRecoveryReply(turn.id)&&close.completeFarewell())completions++;
  },context:()=>{},contextFailure:assert.fail});
 };
 x.begin();const recoveryId=x.h.snapshot().reply_id;x.endNative();x.h.cancel('VISITOR_EXIT');
 const bye={id:'user::actual-exit',role:'user',content:'Thanks, that is all. Goodbye.'};commit(bye);
 assert.equal(x.s.status,'CLOSING_PENDING');assert.equal(completions,0);
 for(const turn of [
  {id:native,role:'persona',content:'This is the delayed native response before your goodbye.'},
  {id:recoveryId,role:'persona',content:failureSpeechText},
 ]){
  assert.equal(x.h.isHeldOrRecoveryReply(turn.id),true,'held IDs survive cancellation');
  x.h.stream({...turn,endOfSpeech:true});commit(turn);
 }
 advance(2500);assert.equal(completions,0);assert.equal(stops,0,'delayed pre-exit finalization cannot schedule early SDK close');
 const farewell={id:'persona::actual-exit',role:'persona',content:'Goodbye, take care.'};
 assert.equal(x.h.isHeldOrRecoveryReply(farewell.id),false);commit(farewell);commit(farewell);
 assert.equal(completions,1,'duplicate history cannot complete the farewell twice');
 advance(2500);advance(12000);assert.equal(stops,1);
 assert.deepEqual(x.s.turns.slice(0,originalTurns.length),originalTurns);
 assert.deepEqual(x.s.handoff_binding_attempts,originalAttempt);
 assert.equal(x.s.turns.find(t=>t.id===native).content,'This is the delayed native response before your goodbye.');
 assert.equal(x.s.turns.find(t=>t.id===recoveryId).content,failureSpeechText);
 assert.equal(x.s.turns.filter(t=>t.id===farewell.id).length,1);
 assert.equal(x.s.provider_release_verified,false,'mock SDK invocation cannot certify provider release');
 assert.equal(x.s.status,'CLOSING_PENDING','CLOSED still requires verified provider release');
});
