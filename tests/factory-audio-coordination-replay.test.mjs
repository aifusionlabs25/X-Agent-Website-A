import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {liveTranscript} from '../lib/factory/live-transcript.ts';
import {submitHandoff,toolEvidenceCallbacks} from '../lib/factory/handoff-context.ts';
const root=process.env.AUDIO_SOURCE_ROOT||path.resolve(import.meta.dirname,'..');
const speech=await import(pathToFileURL(path.join(root,'lib/factory/handoff-failure-speech.ts')));
const gate=await import(pathToFileURL(path.join(root,'lib/factory/handoff-output-gate.ts')));
const saved=JSON.parse(fs.readFileSync(new URL('./fixtures/factory-audio-coordination-20261115.json',import.meta.url)));
const ts=createRequire(import.meta.url)('typescript');
const source=fs.readFileSync(path.join(root,'components/factory/FactoryPilot.tsx'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const flush=async()=>{for(let i=0;i<150;i++)await Promise.resolve();};
const children=node=>[node,...[node?.props?.children].flat(Infinity).filter(x=>x&&typeof x==='object').flatMap(children)];
const text=node=>[node?.props?.children].flat(Infinity).filter(x=>typeof x==='string').join('');
const event=(id,content='',endOfSpeech=false)=>({id,role:'persona',content,endOfSpeech});

// Real component handlers, gate, recovery, arbiter, transcript transport and
// telemetry validators; only React rendering, SDK/server and timers are fake.
async function fixture({reject=false,brokenSink=false,bound=false}={}) {
 const retained=structuredClone(bound?saved.repaired_initial_state:saved.initial_state),attempt=structuredClone(reject?saved.failure_attempt:retained.handoff_binding_attempts[0]);
 if(reject)retained.turns=structuredClone(saved.failure_turns);
 const visitor=retained.turns.at(-1),prior=retained.turns.slice(0,-1);
 let state={...retained,turns:prior,handoff_binding_attempts:[],proposals:reject?retained.proposals:[]};
 const slots=[],listeners=new Map(),handlers=new Map(),talks=[],actions=[],errors=[],timers=new Map(),sink=[];
 let cursor=0,view,cleanup,pendingReceipt,holdReceipt=false,closed=0,interrupted=0;
 let muted=false;const video={get muted(){return muted;},set muted(value){muted=brokenSink?true:value;sink.push(muted);}};
 const hook=init=>{const i=cursor++;if(!(i in slots))slots[i]=init();return i;};
 const react={useState(initial){const i=hook(()=>initial);return[slots[i],value=>slots[i]=value];},useRef(initial){return slots[hook(()=>({current:initial}))];},useEffect(fn){const i=hook(()=>({fn}));if(slots[i].fn){const effect=slots[i].fn;delete slots[i].fn;Promise.resolve().then(()=>cleanup=effect());}}};
 const sdk={addListener:(name,fn)=>listeners.set(name,fn),registerToolCallHandler:(name,h)=>handlers.set(name,h),
  streamToVideoElement:async()=>listeners.get('SESSION_READY')(state.provider_session_id),addContext:()=>{},
  interruptPersona:()=>{interrupted++;},createTalkMessageStream:id=>({streamMessageChunk:async message=>talks.push({id,message})}),
  stopStreaming:async()=>{closed++;},muteInputAudio:()=>{},unmuteInputAudio:()=>{}};
 const schedule=fn=>{const id={};timers.set(id,fn);return id;},cancel=id=>timers.delete(id);
 const mocks={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  '@anam-ai/js-sdk':{createClient:()=>sdk,AnamEvent:Object.fromEntries(['SESSION_READY','MESSAGE_STREAM_EVENT_RECEIVED','USER_SPEECH_STARTED','MESSAGE_HISTORY_UPDATED','CONNECTION_CLOSED'].map(k=>[k,k]))},
  '@/lib/factory/live-transcript':{liveTranscript,submitTypedTurn:()=>assert.fail('No new conversation')},
  '@/lib/factory/sdk-close':{sdkCloseTracker:()=>({close:async()=>sdk.stopStreaming(),snapshot:()=>({})})},
  '@/lib/factory/handoff-context':{collectionReferenceContext:()=>'',submitHandoff,toolEvidenceCallbacks,closedSessionStatus:()=>'',handoffRequestStatus:()=>null},
  '@/lib/factory/turn-effects':{committedTurnEffects:()=>{}},
  '@/lib/factory/context-send':{contextSendTracker:()=>({send:()=>{}})},
  '@/lib/factory/handoff-output-gate':{handoffOutputGate:options=>gate.handoffOutputGate({...options,schedule,cancel})},
  '@/lib/factory/handoff-failure-speech':{...speech,handoffFailureSpeech:options=>speech.handoffFailureSpeech({...options,schedule,cancel})},
  '@/lib/factory/exit-receipt':{exitReceipt:()=>({}),exitReplyObserver:()=>({observe:()=>{},receipt:()=>({})})},
  '@/lib/factory/handoff-corrections':{contradictingCorrection:()=>false},
  '@/lib/anam/farewell-close-coordinator':{createFarewellCloseCoordinator:()=>({dispose:()=>{},arm:()=>{},completeFarewell:()=>{}})},'./pilot.module.css':{default:{}}};
 const fetch=async(url,options)=>{
  assert.equal(url,'/api/factory/pilot');
  if(!options?.method)return{ok:true,json:async()=>({manifest:{name:'Fixture',configured_fields:[],package_sha256:'fictional'},state:null,history:[]})};
  const data=JSON.parse(options.body);actions.push(data.action);
  if(data.action==='handoff_output_receipt'&&data.receipt.phase==='UNVERIFIED_OUTCOME'&&holdReceipt)await new Promise(resolve=>pendingReceipt=resolve);
  if(data.action==='turn'&&!state.turns.some(t=>t.id===data.turn.id))state.turns.push(data.turn);
  if(data.action==='provider_handoff'){state.handoff_binding_attempts.push(attempt);if(!reject)state.proposals=retained.proposals;}
  if(data.action==='handoff_output_receipt')gate.appendHandoffOutputEvidence(state,data.receipt);
  if(data.action==='handoff_failure_speech_receipt')speech.appendFailureSpeechEvidence(state,data.receipt);
  if(data.action==='closing')state.status='CLOSING_PENDING';
  if(data.action==='reconcile')state.status='CLOSED';
  state.version++;
  return{ok:true,json:async()=>({state:structuredClone(state),...(data.action==='start'?{sessionToken:'fictional'}:{}),...(data.action==='provider_handoff'?{toolResult:attempt.result}:{})})};
 };
 const exports={};runInNewContext(compiled,{exports,require:name=>{assert.ok(name in mocks,name);return mocks[name];},fetch,crypto:{randomUUID},document:{getElementById:()=>video},console:{...console,error:x=>errors.push(x)},Promise});
 const render=()=>{cursor=0;return view=exports.default();};render();await flush();render();
 children(view).find(n=>n.type==='button'&&text(n)==='Start private conversation').props.onClick();await flush();
 const stream=e=>listeners.get('MESSAGE_STREAM_EVENT_RECEIVED')(e);
 listeners.get('USER_SPEECH_STARTED')();
 stream({...visitor,endOfSpeech:true});await flush();
 stream(event('persona::'+visitor.id.slice(6),'I will prepare'));
 return {state:()=>state,video,sink,talks,actions,timers,errors,visitor,attempt,stream,
  async tool({delay=false}={}){holdReceipt=delay;const p={sessionId:state.provider_session_id,toolCallId:attempt.tool_call_id,userActionCorrelationId:visitor.id.slice(6),arguments:{proposals:attempt.original_proposals}};await handlers.get('factory_handoff').onStart(p);await flush();},
  release(){assert.ok(pendingReceipt);pendingReceipt();},
  endNative(){stream(event('persona::'+visitor.id.slice(6),'',true));},
  recovery(textOverride){const talk=talks.at(-1);assert.ok(talk);stream(event(`persona::external::${talk.id}::${state.provider_session_id}`,textOverride??talk.message,true));},
  userSpeech(){listeners.get('USER_SPEECH_STARTED')();},
  get closed(){return closed;},get interrupted(){return interrupted;},cleanup:()=>cleanup()};
}

test('saved unbound accepted receipt gets one truthful explanation after persistence, without waiting indefinitely',async()=>{
 const x=await fixture();await x.tool({delay:true});assert.equal(x.video.muted,true);assert.equal(x.talks.length,0);
 x.release();await flush();x.endNative();await flush();
 assert.equal(x.talks.length,1,'an accepted save without request binding must not strand the muted reply');
 assert.equal(x.talks[0].message,speech.unverifiedSpeechText);assert.equal(x.video.muted,true);
 x.recovery();await flush();assert.equal(x.video.muted,false);
 assert.equal(x.state().handoff_failure_speech_events.find(e=>e.phase==='RECOVERY_OUTPUT_ALLOWED').detail,'MEDIA_UNMUTED_NOT_ACOUSTIC_PROOF');
 assert.equal(x.state().handoff_requests,undefined);assert.equal(x.state().approved,false);
 assert.equal(x.state().handoff_binding_attempts[0].request_turn_id,null);
 assert.equal(x.actions.filter(a=>a==='provider_handoff').length,1);assert.equal(x.closed,0);
 x.userSpeech();assert.equal(x.video.muted,true);x.recovery();assert.equal(x.video.muted,true,'late canceled speech cannot reopen output');x.cleanup();
});

test('saved failure explanation reaches the real sink despite concurrent held gate telemetry',async()=>{
 const x=await fixture({reject:true});await x.tool();x.endNative();await flush();assert.equal(x.talks[0].message,speech.failureSpeechText);
 x.recovery();await flush();assert.equal(x.video.muted,false);assert.equal(x.state().handoff_output_events.at(-1).muted,true);
 assert.ok(x.state().handoff_failure_speech_events.some(e=>e.phase==='RECOVERY_OUTPUT_ALLOWED'));
 assert.equal(x.state().approved,false);assert.equal(x.actions.filter(a=>a==='provider_handoff').length,1);x.cleanup();
});

test('actual sink unable to unmute closes once, never reports output success or retries',async()=>{
 const x=await fixture({reject:true,brokenSink:true});await x.tool();x.endNative();await flush();x.recovery();await flush();
 assert.equal(x.closed,1);assert.equal(x.video.muted,true);
 assert.ok(x.state().handoff_failure_speech_events.some(e=>e.phase==='BLOCKED'&&e.detail==='RECOVERY_OUTPUT_NOT_ALLOWED'));
 assert.equal(x.state().handoff_failure_speech_events.some(e=>e.phase==='RECOVERY_OUTPUT_ALLOWED'),false);
 assert.equal(x.talks.length,1);assert.equal(x.actions.filter(a=>a==='start').length,1);x.cleanup();
});

test('recovery text cannot create applied-output telemetry with a foreign identity or wrong detail',()=>{
 const s=structuredClone(saved.initial_state);s.handoff_binding_attempts=[saved.failure_attempt];s.turns=structuredClone(saved.failure_turns);
 const visitor=s.turns.at(-1).id,base={event_id:randomUUID(),at:new Date().toISOString(),tool_call_id:saved.failure_attempt.tool_call_id,visitor_message_id:visitor,native_reply_id:'persona::'+visitor.slice(6),recovery_reply_id:'persona::factory-failure-'+randomUUID(),phase:'RECOVERY_OUTPUT_ALLOWED',detail:'MEDIA_UNMUTED_NOT_ACOUSTIC_PROOF',local_session_id:s.id,provider_session_id:s.provider_session_id,launch_label:s.launch_label};
 assert.throws(()=>speech.appendFailureSpeechEvidence(s,base));
 assert.throws(()=>speech.appendFailureSpeechEvidence(s,{...base,observed_reply_id:base.recovery_reply_id+'::foreign'}));
});


test('saved initial receipt bound to preceding consent speaks once on the current continuation',async()=>{
 const x=await fixture({bound:true});await x.tool();x.endNative();await flush();
 assert.equal(x.talks.length,1);assert.equal(x.talks[0].message,speech.acceptedSpeechText);
 assert.notEqual(x.attempt.request_turn_id,x.visitor.id);assert.equal(x.attempt.through_visitor_turn_id,x.visitor.id);
 x.recovery();await flush();assert.equal(x.video.muted,false);
 assert.ok(x.state().handoff_failure_speech_events.some(e=>e.outcome==='ACCEPTED'&&e.phase==='RECOVERY_OUTPUT_ALLOWED'));
 assert.equal(x.state().approved,false);assert.equal(x.actions.filter(a=>a==='provider_handoff').length,1);x.cleanup();
});
