import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {appendTurn,assertProposal,digest} from '../lib/factory/handoff.ts';
import {requestedHandoffSpan} from '../lib/factory/handoff-request.ts';
import {handoffRequestContext} from '../lib/factory/handoff-context.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {handoffOutputGate} from '../lib/factory/handoff-output-gate.ts';

// Offline input copied only from fictional turns, original proposals and field
// IDs/labels in HERMES_X_FACTORY/verification/
// olivia-consent-merge-output-replacement-voice-qa-20261112-v0.1/review/hosted-response-body.txt.
// No saved receipt, session configuration or provider credential is replayed.
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/factory-handoff-request-safeguard-20261112.json',import.meta.url),'utf8'));
const request=fixture.turns[7];
const requestSentence='So, okay, well, uh, you know, can you go ahead and update your existing handoff with all that and all the details for me?';
const fresh=()=>({id:'offline-request',version:1,package_sha256:'fictional',persona_id:'offline',launch_label:'offline',
 status:'ACTIVE',provider_session_id:'offline-provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
 provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,
 submission_status:'UNSUBMITTED',external_actions:[]});
const user=(id,content)=>({id,role:'user',content});
function attempt(state,input=fixture.original_proposals,fields=fixture.fields,tool='offline-tool') {
 return recordProviderHandoffAttempt(state,input,fields,tool,{
  local_session_id:state.id,provider_session_id:state.provider_session_id,tool_call_id:tool});
}
function gate(state) {
 const events=[],media=[];let sequence=0;
 const g=handoffOutputGate({localSessionId:state.id,providerSessionId:()=>state.provider_session_id,
  output:muted=>media.push(muted),notice:()=>{},report:event=>events.push(event),
  id:()=>`11111111-1111-4111-8111-${String(++sequence).padStart(12,'0')}`,now:()=> '2026-11-12T12:00:00.000Z'});
 g.committed(state);return {g,events,media};
}
function beforeRequest() {
 const state=fresh(),output=gate(state);
 for(const turn of fixture.turns.slice(0,7)) {
  if(turn.role==='user'){output.g.speechStarted();output.g.visitor(turn);}else output.g.persona();
  appendTurn(state,turn);output.g.committed(state);
 }
 assert.equal(state.handoff_requests?.length??0,0);
 assert.equal(state.handoff_binding_attempts?.length??0,0);
 assert.deepEqual(state.proposals,[]);
 return {state,...output};
}
function assertUnsubmitted(state) {
 assert.equal(state.approved,false);
 assert.equal(state.submission_status,'UNSUBMITTED');
 assert.deepEqual(state.external_actions,[]);
 assert.equal(state.provider_release_verified,false);
}

test('saved conversational request preserves its exact sentence after the human-review restriction',()=>{
 assert.equal(request.content,'No, absolutely. Everything has to have a human review before it gets to anywhere. '+requestSentence);
 const start=request.content.indexOf(requestSentence);
 assert.ok(start>0);
 assert.deepEqual(requestedHandoffSpan(request.content),{start,end:request.content.length,evidence:requestSentence});
 assert.equal(request.content.slice(start),requestSentence);
 assert.equal(requestedHandoffSpan(request.content.slice(0,start)),null,'the restriction alone is not a preparation request');
});

test('server append records the first request after a correction without inventing an earlier handoff',()=>{
 const {state}=beforeRequest(),before=digest(fixture);
 appendTurn(state,request);
 assert.equal(state.handoff_requests?.length,1);
 const row=state.handoff_requests[0];
 assert.equal(row.visitor_message_id,request.id);
 assert.equal(row.evidence,requestSentence);
 assert.equal(request.content.slice(row.start,row.end),requestSentence);
 assert.equal(row.offer_turn_id,undefined,'this is explicit intent, not consent inferred from a prior offer');
 assert.deepEqual(state.proposals,[]);
 assert.equal(state.handoff_binding_attempts?.length??0,0);
 const context=handoffRequestContext(state,request);
 assert.match(context,/Use factory_handoff once in this response/);
 assert.doesNotMatch(context,/earlier successful preparation/);
 const references=JSON.parse(context.split('Reference data: ')[1]).references;
 for(const source of [fixture.turns[5],request]) {
  assert.ok(references.some(ref=>ref.visitor_message_id===source.id&&ref.evidence===source.content&&ref.value===source.content));
 }
 assert.deepEqual(state.turns,fixture.turns.slice(0,8));
 assert.equal(digest(fixture),before);
 assertUnsubmitted(state);
});

test('saved first preparation waits before or after persistence, then releases only its bound current receipt',()=>{
 for(const persistedFirst of [false,true]) {
  const {state,g,events,media}=beforeRequest(),before=digest(fixture);
  g.speechStarted();
  if(persistedFirst){appendTurn(state,request);g.committed(state);}
  g.visitor(request);
  if(!persistedFirst){appendTurn(state,request);g.committed(state);}
  assert.equal(g.snapshot().phase,'WAITING_RECEIPT');
  assert.equal(g.snapshot().accepted,false);
  assert.equal(events.at(-1).visitor_message_id,request.id);
  assert.equal(media.at(-1),true);
  assert.equal(state.handoff_binding_attempts?.length??0,0,'request recognition never calls the tool');

  const result=attempt(state);
  assert.equal(result.accepted,true);
  const bound=state.handoff_binding_attempts[0];
  assert.equal(bound.request_turn_id,request.id);
  assert.equal(bound.through_visitor_turn_id,request.id);
  assert.deepEqual(bound.original_proposals,fixture.original_proposals);
  assert.equal(bound.input_sha256,digest(fixture.original_proposals));
  assert.ok(bound.bindings.some(binding=>binding.to_message_id===request.id),'saved wrong source references are repaired by exact-source binding');
  assert.equal(media.at(-1),true,'a result without a committed-state callback cannot release output');
  g.committed({...state,id:'foreign-session'});
  assert.equal(media.at(-1),true);
  g.committed(state);
  assert.equal(g.snapshot().phase,'VERIFIED_RECEIPT');
  assert.equal(g.snapshot().accepted,true);
  assert.equal(events.at(-1).tool_call_id,'offline-tool');
  assert.equal(media.at(-1),false);
  g.persona();appendTurn(state,fixture.turns[8]);g.committed(state);
  assert.equal(media.at(-1),false);
  assert.ok(state.proposals.some(proposal=>proposal.evidence.includes('4 staff, not 6')));
  assert.ok(state.proposals.some(proposal=>proposal.evidence.includes('human review')&&proposal.visitor_message_id===request.id));
  for(const {id,...proposal} of state.proposals){void id;assertProposal(proposal,state.turns,fixture.fields);}
  assert.deepEqual(state.turns,fixture.turns.slice(0,9));
  assert.equal(digest(fixture),before);
  assertUnsubmitted(state);
 }
});

test('a saved acknowledgment that starts before the receipt remains held after verification',()=>{
 const {state,g,events,media}=beforeRequest();
 g.speechStarted();g.visitor(request);appendTurn(state,request);g.committed(state);
 assert.equal(g.snapshot().phase,'WAITING_RECEIPT');
 g.persona();appendTurn(state,fixture.turns[8]);g.committed(state);
 assert.equal(g.snapshot().phase,'EARLY_REPLY_HELD');
 assert.equal(media.at(-1),true);
 assert.equal(attempt(state).accepted,true);
 g.committed(state);
 assert.equal(g.snapshot().accepted,true);
 assert.equal(g.snapshot().early_reply_held,true);
 assert.equal(events.at(-1).phase,'VERIFIED_RECEIPT');
 assert.equal(events.at(-1).muted,true);
 assert.equal(media.at(-1),true);
 g.persona();assert.equal(media.at(-1),true,'a late receipt must not expose the acknowledgment tail');
 assert.deepEqual(state.turns,fixture.turns.slice(0,9));
 assert.equal(state.handoff_binding_attempts.length,1);
 assertUnsubmitted(state);
});

test('independent explicit handoff updates tolerate conversational fillers without prior preparation',()=>{
 for(const evidence of [
  'Update your existing handoff with the corrected shift count.',
  'Could you please update your existing handoff with those restrictions?',
  'Okay, well, um, can you go ahead and revise the existing handoff with the new details?',
  'So, you know, please go ahead and update your existing handoff for me.',
  'Well, uh, would you please go ahead and amend our current handoff with that uncertainty?',
  'Please update the existing handoff with my correction.',
 ]) {
  const raw=`We are still discussing the workflow.\n  ${evidence}  `,start=raw.indexOf(evidence);
  assert.deepEqual(requestedHandoffSpan(raw),{start,end:start+evidence.length,evidence},evidence);
  const state=fresh();appendTurn(state,user('independent',raw));
  assert.equal(state.handoff_requests?.length,1,evidence);
  assert.deepEqual(state.proposals,[]);
  assert.equal(state.handoff_binding_attempts?.length??0,0);
  assertUnsubmitted(state);
 }
});

test('generic summary and brief updates still need successful history or explicit local scope',()=>{
 for(const evidence of [
  'Please update your existing summary with the revised number.',
  'Could you go ahead and revise the saved brief with that detail?',
  'Please amend our earlier review note with that uncertainty.',
 ]) {
  assert.equal(requestedHandoffSpan(evidence),null,evidence);
  assert.deepEqual(requestedHandoffSpan(evidence,{hasSuccessfulHandoff:true}),{start:0,end:evidence.length,evidence},evidence);
 }
 for(const evidence of [
  'Please update your existing summary for human review.',
  'Could you go ahead and revise the local brief with that detail?',
  'Please amend our unsent review note with that uncertainty.',
 ]) assert.deepEqual(requestedHandoffSpan(evidence),{start:0,end:evidence.length,evidence},evidence);
});

test('fillers and the handoff noun cannot override quotation, narration, conditions, negation or external delivery',()=>{
 const command='So, okay, well, uh, can you go ahead and update your existing handoff?';
 for(const raw of [
  `"${command}"`,
  `“${command}”`,
  `\`${command}\``,
  `My manager wrote:\n${command}`,
  `They said. ${command}`,
  'My colleague asked you to update your existing handoff.',
  'Can you explain how you update your existing handoff?',
  'If we proceed, can you go ahead and update your existing handoff?',
  'Could you update your existing handoff if the supervisor agrees?',
  'Please update your existing handoff after I confirm.',
  'No, do not update your existing handoff.',
  "Okay, please don't update your existing handoff.",
  'Please update your existing handoff. Actually, cancel updating it.',
  'Please update your existing handoff and send it to our supplier.',
  'Could you go ahead and update your existing handoff, then email it?',
  'Please update your existing handoff and then submit it.',
  'Can you go ahead and send your existing handoff to the team?',
  'Please email your existing handoff.',
  'Our existing handoff is incorrect.',
  'Everything needs human review before it goes anywhere.',
  'Please update the customer record.',
 ]) {
  for(const context of [{},{hasSuccessfulHandoff:true}])assert.equal(requestedHandoffSpan(raw,context),null,raw);
  const state=fresh();appendTurn(state,user('negative',raw));
  assert.equal(state.handoff_requests?.length??0,0,raw);
  assertUnsubmitted(state);
 }
});

test('recognizing a new explicit handoff request does not authorize retrying a failed preparation',()=>{
 const state=fresh(),fact=user('fact','Our team uses a shared inbox.'),fields=[{id:'context',label:'Context'}];
 appendTurn(state,fact);appendTurn(state,user('first','Please prepare a local brief.'));
 const rejected=attempt(state,[{field_id:'context',visitor_message_id:fact.id,evidence:fact.content,value:'invented paraphrase'}],fields,'failed-tool');
 assert.equal(rejected.accepted,false);
 const next=user('new-request','Okay, please go ahead and update your existing handoff with my details.');
 appendTurn(state,next);
 assert.equal(state.handoff_requests.at(-1).visitor_message_id,next.id);
 const context=handoffRequestContext(state,next);
 assert.match(context,/Do not automatically repeat the tool call/);
 assert.doesNotMatch(context,/Use factory_handoff once in this response/);
 assert.equal(state.handoff_binding_attempts.length,1);
 assert.deepEqual(state.proposals,[]);
 assertUnsubmitted(state);
});
