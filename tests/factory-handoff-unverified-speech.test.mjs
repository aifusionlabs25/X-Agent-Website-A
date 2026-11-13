import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffFailureSpeech,appendFailureSpeechEvidence,unverifiedSpeechText,acceptedSpeechText,hasUnverifiedHandoffContext} from '../lib/factory/handoff-failure-speech.ts';

// Simulated event sequencing only: these checks do not prove audible output,
// provider buffer drainage, or any change to a live persona.
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const visitor='user::current',native='persona::current',tool='tool-current';
const persona=(id,content='',endOfSpeech=false,extra={})=>({id,role:'persona',content,endOfSpeech,...extra});
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function state(){const content='Please prepare a local owner-review note.';return {
 id:'local',version:1,package_sha256:'fictional',persona_id:'persona',launch_label:'launch',status:'ACTIVE',provider_session_id:'provider',
 turns:[{id:visitor,role:'user',content}],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,
 provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[],
 handoff_requests:[{visitor_message_id:visitor,evidence:content,start:0,end:content.length,source:'HOST_PERSISTED_VISITOR_REQUEST',status:'REQUESTED_NOT_MAPPED'}],
 handoff_output_events:[{event_id:uuid(900),at:'2026-11-12T23:00:00Z',visitor_message_id:visitor,phase:'UNVERIFIED_OUTCOME',muted:true,
  tool_call_id:null,local_session_id:'local',provider_session_id:'provider',launch_label:'launch'}],
};}
function acceptedState(){const s=state();s.proposals=[{id:'p',field_id:'context',visitor_message_id:visitor,evidence:s.turns[0].content,value:s.turns[0].content}];
 s.handoff_binding_attempts=[{tool_call_id:tool,local_session_id:s.id,provider_session_id:s.provider_session_id,through_visitor_turn_id:visitor,
  request_turn_id:visitor,applied:true,result:{accepted:true,status:'PENDING_OWNER_REVIEW',accepted_proposal_count:1,owner_approved:false,submission_status:'UNSUBMITTED',external_actions:[]}}];
 s.handoff_output_events[0]={...s.handoff_output_events[0],phase:'VERIFIED_RECEIPT',tool_call_id:tool};return s;}
function setup(s=state(),overrides={}){const events=[],media=[],notices=[],talks=[],timers=new Map();let i=0,interrupts=0;
 const h=handoffFailureSpeech({localSessionId:'local',providerSessionId:()=>'provider',id:()=>uuid(++i),now:()=>`2026-11-12T23:00:${String(i+1).padStart(2,'0')}Z`,
 interrupt:()=>{interrupts++;},speak:async(c,text)=>{talks.push({c,text});},output:m=>media.push(m),notice:n=>notices.push(n),report:e=>events.push(e),
 schedule:cb=>{const key={};timers.set(key,cb);return key;},cancel:key=>timers.delete(key),...overrides});
 return {s,h,events,media,notices,talks,timers,get interrupts(){return interrupts;},end:()=>h.stream(persona(native,'',true,{interrupted:true})),
 expire(){const pending=[...timers.values()];timers.clear();pending.forEach(f=>f());},
 receipt(e){return {...e,local_session_id:s.id,provider_session_id:s.provider_session_id,launch_label:s.launch_label};}};
}

test('no-attempt outcome speaks one truthful uncertainty only after native end and exact correlated text',async()=>{
 const x=setup(),before=JSON.stringify(x.s);x.h.stream(persona(native,'I have prepared everything.'));
 assert.equal(x.h.unverified(x.s,visitor),true);assert.equal(x.interrupts,1);assert.deepEqual(x.talks,[]);assert.equal(x.media.at(-1),'HOLD');
 assert.equal(x.h.unverified(x.s,visitor),false);x.h.stream(persona('persona::other','',true));assert.equal(x.talks.length,0);
 x.end();assert.equal(x.talks.length,1);assert.equal(x.talks[0].text,unverifiedSpeechText);await flush();
 assert.equal(x.media.includes('ALLOW'),false,'submission alone cannot unmute');
 const reply=x.h.snapshot().reply_id;x.h.stream(persona(reply,"I can't verify that the handoff is up to date."));
 assert.equal(x.media.at(-1),'ALLOW');x.h.stream(persona(reply,unverifiedSpeechText.slice("I can't verify that the handoff is up to date.".length),true));
 assert.equal(x.events.at(-1).phase,'RECOVERY_TEXT_ENDED');assert.equal(x.events.at(-1).detail,'TEXT_COMPLETION_NOT_AUDIO_DRAIN');
 assert.ok(x.events.every(e=>e.tool_call_id===null&&e.outcome==='UNVERIFIED'));assert.equal(JSON.stringify(x.s),before);
 assert.equal(x.s.handoff_binding_attempts,undefined);assert.deepEqual(x.s.external_actions,[]);
});

test('unverified eligibility requires exact active latest visitor and a persisted guarded context, not arbitrary silence',()=>{
 const cases={
  'no persisted gate':s=>{s.handoff_output_events=[];},'no context':s=>{s.handoff_requests=[];},
  'wrong gate visitor':s=>{s.handoff_output_events[0].visitor_message_id='user::foreign';},
  'foreign local':s=>{s.id='elsewhere';},'foreign provider':s=>{s.provider_session_id='elsewhere';},
  'inactive':s=>{s.status='CLOSED';},'later visitor':s=>{s.turns.push({id:'user::later',role:'user',content:'A different question.'});},
  'malformed request span':s=>{s.handoff_requests[0].end=1;},'approved':s=>{s.approved=true;},
  'external action':s=>{s.external_actions=['sent'];},'missing source turn':s=>{s.turns=[];},
 };
 for(const [label,change] of Object.entries(cases)){const x=setup();change(x.s);assert.equal(x.h.unverified(x.s,visitor),false,label);assert.equal(x.interrupts,0,label);assert.deepEqual(x.events,[],label);}
});

test('a retained correction or an unbound attempt supplies context without inventing a new request',()=>{
 for(const kind of ['correction','unbound accepted attempt']){const x=setup();x.s.handoff_requests=[];
  if(kind==='correction'){
   x.s.turns=[{id:'user::earlier',role:'user',content:'Nine clerks handle orders.'},{id:visitor,role:'user',content:'Actually, 5 clerks handle orders, not 9.'}];
   x.s.turns[0].content='9 clerks handle orders.';
   x.s.proposals=[{id:'p',field_id:'context',visitor_message_id:'user::earlier',evidence:x.s.turns[0].content,value:x.s.turns[0].content}];
  }else{x.s.handoff_binding_attempts=acceptedState().handoff_binding_attempts;x.s.handoff_binding_attempts[0].request_turn_id=null;}
  assert.equal(hasUnverifiedHandoffContext(x.s,visitor),true,kind);assert.equal(x.h.unverified(x.s,visitor),true,kind);
  assert.deepEqual(x.s.handoff_requests,[],kind);assert.equal(x.s.approved,false);
 }
});

test('a terminal receipt arriving after the timeout observation prevents an inaccurate uncertainty explanation',()=>{
 for(const kind of ['accepted','rejected']){const x=setup(acceptedState());x.s.handoff_output_events[0]={...x.s.handoff_output_events[0],phase:'UNVERIFIED_OUTCOME',tool_call_id:null};
  if(kind==='rejected'){const a=x.s.handoff_binding_attempts[0];a.applied=false;a.result={...a.result,accepted:false,status:'UNMAPPED_OWNER_REVIEW',accepted_proposal_count:0};}
  assert.equal(x.h.unverified(x.s,visitor),false,kind);assert.deepEqual(x.events,[],kind);assert.deepEqual(x.talks,[],kind);
 }
});

test('late genuine accepted receipt after unknown disposition resolves once with accepted speech and exact tool correlation',()=>{
 const x=setup(acceptedState());x.s.handoff_output_events[0]={...x.s.handoff_output_events[0],phase:'UNVERIFIED_OUTCOME',tool_call_id:null};
 x.h.toolStarted('provider',tool,'current');assert.equal(x.h.unverified(x.s,visitor),false);
 assert.equal(x.h.accepted(x.s,tool,visitor),true);assert.equal(x.events[0].outcome,'ACCEPTED');
 for(const e of x.events)appendFailureSpeechEvidence(x.s,x.receipt(e));
 x.end();assert.equal(x.talks.length,1);assert.equal(x.talks[0].text,acceptedSpeechText);
 assert.equal(x.h.accepted(x.s,tool,visitor),false);assert.equal(x.h.unverified(x.s,visitor),false);
 assert.equal(x.s.handoff_failure_speech_events[0].outcome,'ACCEPTED');assert.equal(x.s.handoff_binding_attempts.length,1);
});

test('timeouts and mismatched late native output never release the held native tail or retry',()=>{
 for(const kind of ['native end absent','late native tail','wrong recovery text']){const x=setup();x.h.unverified(x.s,visitor);
  if(kind==='native end absent')x.expire();else{x.end();x.h.stream(kind==='late native tail'?persona(native,'Success tail.'):persona(x.h.snapshot().reply_id,'Everything has been sent.',true));}
  assert.equal(x.events.at(-1).phase,'BLOCKED',kind);assert.equal(x.media.at(-1),'HOLD',kind);
  x.end();x.expire();assert.equal(x.h.unverified(x.s,visitor),false,kind);assert.equal(x.media.includes('ALLOW'),false,kind);
  assert.equal(x.talks.length,kind==='native end absent'?0:1,kind);
 }
});

test('new speech, exit and close cancel unverified recovery once and reject delayed events',async()=>{
 for(const reason of ['VISITOR_SPEECH','VISITOR_EXIT','SESSION_CLOSE','DISPOSE']){const x=setup();x.h.unverified(x.s,visitor);x.end();const reply=x.h.snapshot().reply_id;
  if(reason==='DISPOSE')x.h.dispose();else x.h.cancel(reason);await flush();x.h.stream(persona(reply,unverifiedSpeechText,true));x.expire();
  assert.equal(x.media.includes('ALLOW'),false,reason);assert.equal(x.media.at(-1),'RELEASE',reason);assert.equal(x.interrupts,2,reason);
  assert.equal(x.h.unverified(x.s,visitor),false,reason);assert.equal(x.events.filter(e=>e.phase==='CANCELED').length,1,reason);
 }
});

test('late accepted receipt can produce one scoped acknowledgment without replaying early native speech',async()=>{
 const x=setup(acceptedState()),before=JSON.stringify(x.s);x.h.toolStarted('provider',tool,'current');x.h.stream(persona(native,'Everything is delivered.'));
 assert.equal(x.h.accepted(x.s,tool,visitor),true);assert.equal(x.interrupts,1);x.end();await flush();
 assert.equal(x.talks[0].text,acceptedSpeechText);assert.equal(x.media.includes('ALLOW'),false);
 x.h.stream(persona(x.h.snapshot().reply_id,acceptedSpeechText,true));assert.equal(x.media.at(-1),'ALLOW');
 assert.ok(x.events.every(e=>e.outcome==='ACCEPTED'&&e.tool_call_id===tool));assert.equal(x.h.accepted(x.s,tool,visitor),false);
 assert.equal(JSON.stringify(x.s),before);assert.equal(x.s.approved,false);
});

test('accepted speech cannot borrow null request, foreign tool, wrong correlation or contradicted proposals',()=>{
 for(const kind of ['null request','missing request','wrong correlation','foreign tool','contradiction']){const x=setup(acceptedState());
  x.h.toolStarted('provider',tool,kind==='wrong correlation'?'wrong':'current');
  if(kind==='null request')x.s.handoff_binding_attempts[0].request_turn_id=null;
  if(kind==='missing request')x.s.handoff_requests=[];
  if(kind==='foreign tool')x.s.handoff_binding_attempts[0].tool_call_id='other';
  if(kind==='contradiction'){x.s.turns.unshift({id:'user::earlier',role:'user',content:'9 clerks handle orders.'});x.s.turns.at(-1).content='Actually, 5 clerks handle orders, not 9.';
   x.s.proposals=[{id:'p',field_id:'context',visitor_message_id:'user::earlier',evidence:x.s.turns[0].content,value:x.s.turns[0].content}];}
  assert.equal(x.h.accepted(x.s,tool,visitor),false,kind);assert.equal(x.interrupts,0,kind);
 }
});

test('unverified telemetry requires captured disposition, preserves kind, and survives later state without becoming rejection',()=>{
 const x=setup();x.h.unverified(x.s,visitor);const requested=x.receipt(x.events[0]),without=structuredClone(x.s);without.handoff_output_events=[];
 assert.throws(()=>appendFailureSpeechEvidence(without,requested),/gate disposition/);
 appendFailureSpeechEvidence(x.s,requested);appendFailureSpeechEvidence(x.s,requested);assert.equal(x.s.handoff_failure_speech_events.length,1);
 assert.throws(()=>appendFailureSpeechEvidence(x.s,{...requested,tool_call_id:tool}),/immutable/);
 appendFailureSpeechEvidence(x.s,x.receipt(x.events[1]));
 x.s.handoff_requests=[];x.s.turns.push({id:'user::later',role:'user',content:'Goodbye.'});x.s.status='CLOSING_PENDING';
 x.h.cancel('VISITOR_EXIT');appendFailureSpeechEvidence(x.s,x.receipt(x.events.at(-1)));
 assert.equal(x.s.handoff_failure_speech_events.at(-1).phase,'CANCELED');assert.equal(x.s.handoff_binding_attempts,undefined);
 const bad={...requested,event_id:uuid(800),outcome:undefined};delete bad.outcome;
 assert.throws(()=>appendFailureSpeechEvidence(x.s,bad),/rejected attempt/);
});

test('accepted telemetry requires actual accepted receipt and prior held-success gate observation',()=>{
 const x=setup(acceptedState());x.h.toolStarted('provider',tool,'current');x.h.accepted(x.s,tool,visitor);const event=x.receipt(x.events[0]);
 const without=structuredClone(x.s);without.handoff_output_events=[];assert.throws(()=>appendFailureSpeechEvidence(without,event),/held-success disposition/);
 appendFailureSpeechEvidence(x.s,event);appendFailureSpeechEvidence(x.s,x.receipt(x.events[1]));
 x.end();for(const e of x.events.slice(2))appendFailureSpeechEvidence(x.s,x.receipt(e));
 assert.equal(x.s.handoff_failure_speech_events[0].outcome,'ACCEPTED');assert.equal(x.s.handoff_binding_attempts.length,1);
 assert.equal(x.s.approved,false);assert.deepEqual(x.s.external_actions,[]);
});
