import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';

const require=createRequire(import.meta.url),ts=require('typescript');
const filename=new URL('../components/factory/FactoryPilot.tsx',import.meta.url);
const source=readFileSync(filename,'utf8');
// Execute the actual component's queue and handlers. SDK/media controllers and
// the server are simulated; this is no browser, microphone or delivery proof.
const compiled=ts.transpileModule(source,{fileName:filename.pathname,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
const children=node=>[node,...(Array.isArray(node?.props?.children)?node.props.children:[node?.props?.children]).flatMap(n=>n&&typeof n==='object'?children(n):[])];
const label=node=>[node?.props?.children].flat(Infinity).filter(x=>typeof x==='string').join('');

async function fixture(){
 const slots=[],listeners=new Map(),handlers=new Map(),calls=[],actions=[],recoveries=[];let cursor=0,cleanup,view,gateOptions,releasePending;
 let state={id:'local',version:1,status:'ACTIVE',provider_session_id:'provider',package_sha256:'fictional',persona_id:'persona',launch_label:'launch',turns:[{id:'user::old',role:'user',content:'Please prepare a local note.'}],proposals:[],decisions:[],receipts:[],processed:[],approved:false,evidence_reviewed:false,provider_release_verified:false,provider_transcript_verified:false,submission_status:'UNSUBMITTED',external_actions:[]};
 const manifest={name:'Fictional',configured_fields:[],package_sha256:'fictional'};
 const hook=init=>{const index=cursor++;if(!(index in slots))slots[index]=init();return index;};
 const react={useState(initial){const i=hook(()=>initial);return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){return slots[hook(()=>({current:initial}))];},useEffect(fn){const i=hook(()=>({effect:fn}));if(slots[i].effect){const effect=slots[i].effect;delete slots[i].effect;Promise.resolve().then(()=>{cleanup=effect();});}}};
 const sdk={addListener:(event,fn)=>listeners.set(event,fn),registerToolCallHandler:(name,handler)=>handlers.set(name,handler),streamToVideoElement:async()=>{listeners.get('SESSION_READY')('provider');},addContext:()=>{},sendUserMessage:message=>calls.push(['typed',message]),interruptPersona:()=>calls.push(['interrupt']),createTalkMessageStream:()=>({streamMessageChunk:async()=>{}}),stopStreaming:async()=>{},muteInputAudio:()=>{},unmuteInputAudio:()=>{}};
 const recovery={accepted:(s,t,v)=>{recoveries.push(['accepted',t,v]);return true;},unverified:(s,v)=>{recoveries.push(['unverified',v]);return true;},rejected:()=>{recoveries.push(['rejected']);return true;},cancel:r=>calls.push(['cancel',r]),dispose:()=>calls.push(['dispose']),stream:()=>{},toolStarted:()=>{},isHeldOrRecoveryReply:()=>false};
 const mocks={
  react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  '@anam-ai/js-sdk':{createClient:()=>sdk,AnamEvent:Object.fromEntries(['SESSION_READY','MESSAGE_STREAM_EVENT_RECEIVED','USER_SPEECH_STARTED','MESSAGE_HISTORY_UPDATED','CONNECTION_CLOSED'].map(k=>[k,k]))},
  '@/lib/factory/live-transcript':{liveTranscript:()=>({stream:()=>[],history:()=>[],drafts:()=>[],trace:()=>[]}),submitTypedTurn:async(t,save,send)=>{await save(t);send(t);}},
  '@/lib/factory/sdk-close':{sdkCloseTracker:()=>({close:async()=>{},snapshot:()=>({})})},
  '@/lib/factory/handoff-context':{collectionReferenceContext:()=>'',submitHandoff:()=>{},closedSessionStatus:()=>'',toolEvidenceCallbacks:()=>({}),handoffRequestStatus:()=>null},
  '@/lib/factory/turn-effects':{committedTurnEffects:()=>{}},
  '@/lib/factory/context-send':{contextSendTracker:()=>({send:()=>{}})},
  '@/lib/factory/handoff-output-gate':{handoffOutputGate:options=>{gateOptions=options;return {committed:()=>{},visitor:()=>{},speechStarted:()=>{},persona:()=>{},handoffStarted:()=>{},dispose:()=>{}};}},
  '@/lib/factory/handoff-failure-speech':{handoffFailureSpeech:()=>recovery,handoffAudioOutput:()=>({gate:()=>{},recovery:()=>{}})},
  '@/lib/factory/exit-receipt':{exitReceipt:()=>({}),exitReplyObserver:()=>({observe:()=>{},receipt:()=>({})})},
  '@/lib/factory/handoff-corrections':{contradictingCorrection:()=>false},
  '@/lib/anam/farewell-close-coordinator':{createFarewellCloseCoordinator:()=>({dispose:()=>{},arm:()=>{},completeFarewell:()=>{}})},
  './pilot.module.css':{default:{}},
 };
 const exports={};
 const fetch=async(url,options)=>{
  assert.equal(url,'/api/factory/pilot');
  if(!options?.method)return {ok:true,json:async()=>({manifest,state:null,history:[]})};
  const data=JSON.parse(options.body);actions.push(data.action);
  if(data.action==='handoff_output_receipt')await new Promise(resolve=>{releasePending=resolve;});
  if(data.action==='turn')state={...state,turns:[...state.turns,data.turn]};
  if(data.action==='closing')state={...state,status:'CLOSING_PENDING'};
  state={...state,version:state.version+1};
  return {ok:true,json:async()=>({state:structuredClone(state),...(data.action==='start'?{sessionToken:'fictional-only'}:{})})};
 };
 runInNewContext(compiled,{exports,require:name=>{assert.ok(name in mocks,`Unexpected module ${name}`);return mocks[name];},fetch,crypto:{randomUUID},document:{getElementById:()=>({muted:false})},console,Promise});
 const render=()=>{cursor=0;return view=exports.default();};
 render();await flush();render();
 children(view).find(n=>n.type==='button'&&label(n)==='Start private conversation').props.onClick();await flush();render();
 assert.equal(actions.filter(a=>a==='start').length,1);assert.ok(gateOptions);
 return {calls,actions,recoveries,gateOptions,render,view:()=>view,release:()=>{assert.ok(releasePending);releasePending();},
  async type(){children(view).find(n=>n.type==='input'&&n.props.id==='visitor-input').props.onChange({target:{value:'A different question.'}});render();children(view).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});},
  speech:()=>listeners.get('USER_SPEECH_STARTED')(),exit:()=>handlers.get('factory_end_session').onStart({userActionCorrelationId:'new-exit'}),
  finish:()=>children(view).find(n=>n.type==='button'&&label(n)==='Finish conversation').props.onClick(),unmount:()=>cleanup(),
 };
}

test('actual component queues accepted/unknown speech behind its output receipt',async()=>{
 for(const kind of ['accepted','unverified']){const x=await fixture();
  x.gateOptions.report({visitor_message_id:'user::old',phase:kind==='accepted'?'VERIFIED_RECEIPT':'UNVERIFIED_OUTCOME'});
  if(kind==='accepted')x.gateOptions.recoverAccepted('tool-old','user::old');else x.gateOptions.recoverUnverified('user::old');
  await flush();assert.deepEqual(x.recoveries,[],kind);assert.equal(x.actions.at(-1),'handoff_output_receipt');
  x.release();await flush();assert.equal(x.recoveries.length,1,kind);assert.equal(x.recoveries[0][0],kind);
 }
});

test('actual component invalidates queued prior-turn recovery for typed input, speech, exit, finish and unmount',async()=>{
 for(const kind of ['accepted','unverified'])for(const cancel of ['type','speech','exit','finish','unmount']){
  const x=await fixture();x.gateOptions.report({visitor_message_id:'user::old',phase:kind==='accepted'?'VERIFIED_RECEIPT':'UNVERIFIED_OUTCOME'});
  if(kind==='accepted')x.gateOptions.recoverAccepted('tool-old','user::old');else x.gateOptions.recoverUnverified('user::old');
  await flush();assert.deepEqual(x.recoveries,[]);
  const pending=x[cancel]();x.release();await flush();if(pending)await pending;
  assert.deepEqual(x.recoveries,[],`${kind}/${cancel}`);
  assert.equal(x.actions.filter(a=>a==='start').length,1);assert.equal(x.actions.includes('provider_handoff'),false);
  if(cancel==='type')assert.ok(x.calls.some(row=>row[0]==='typed'&&row[1]==='A different question.'));
 }
});
