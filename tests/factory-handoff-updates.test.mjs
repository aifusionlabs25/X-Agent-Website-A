import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendTurn,digest,recordHandoffAttempt,decide,approve} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {handoffRequestContext} from '../lib/factory/handoff-context.ts';
const evidence=new URL('../../HERMES_X_FACTORY/verification/olivia-owner-voice-qa-20261108-v0.1/review/saved-session-response.json',import.meta.url);
const bytes=readFileSync(evidence),saved=JSON.parse(bytes).body;
const fields=[{id:'context',label:'Business context'},{id:'rules',label:'Restrictions'}];
const fresh=()=>({id:'local',version:1,status:'ACTIVE',provider_session_id:'provider',launch_label:'fictional',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
 provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]});
const turn=(id,content)=>({id,role:'user',content});
const proposal=(t,field_id='context',evidence=t.content)=>({field_id,visitor_message_id:t.id,evidence,value:evidence});
const identity=(s,tool_call_id)=>({local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id});
function retainedReplay(){
 const source=saved.state,s=fresh();Object.assign(s,{id:source.id,provider_session_id:source.provider_session_id,launch_label:source.launch_label});
 for(const t of source.turns){
  if(t.id===source.visitor_exit.visitor_message_id)break;
  appendTurn(s,t);
  if(t.id==='user::f9414ad8-f04f-4fcf-8591-1a69902c396e')recordProviderHandoffAttempt(s,source.handoff_binding_attempts[0].original_proposals,saved.manifest.configured_fields,'first',identity(s,'first'));
 }
 return s;
}
test('retained run: new request exposes exact correction and uncertainty; simulated update replaces only six staff',()=>{
 const s=retainedReplay(),originalTurns=structuredClone(s.turns),originalAttempt=structuredClone(s.handoff_binding_attempts[0]);
 const request=s.turns.find(t=>t.id===saved.state.handoff_requests[0].visitor_message_id);
 const correction=s.turns.find(t=>t.content==='One correction, we have 4 staff, not 6.');
 const portal=s.turns.find(t=>t.content.startsWith('We use a supplier portal,'));
 const before=s.proposals.filter(p=>p.value!=='We have 6 staff.');
 const context=handoffRequestContext(s,request);assert.match(context,/new explicit visitor request/);assert.ok(context.includes(correction.id)&&context.includes(portal.id));
 const r=recordProviderHandoffAttempt(s,[proposal(correction,'field_79a7766c1a75986cfcdd6b58'),proposal(portal,'field_bd7bb66666cf498e4a67ad45')],saved.manifest.configured_fields,'update',identity(s,'update'));
 assert.equal(r.accepted,true);assert.equal(s.proposals.length,5);assert.ok(!s.proposals.some(p=>p.value==='We have 6 staff.'));
 assert.ok(s.proposals.some(p=>p.value===correction.content)&&s.proposals.some(p=>p.value===portal.content));
 for(const p of before)assert.deepEqual(s.proposals.find(x=>x.id===p.id),p);
 assert.equal(s.superseded_mappings.length,1);assert.equal(s.superseded_mappings[0].proposal.value,'We have 6 staff.');
 assert.deepEqual(s.superseded_mappings[0].correction_turn,correction);assert.equal(s.superseded_mappings[0].correction_turn_sha256,digest(correction));
 assert.deepEqual(s.handoff_binding_attempts[0],originalAttempt);assert.deepEqual(s.turns,originalTurns);
 assert.equal(s.handoff_binding_attempts[1].request_turn_id,request.id);assert.equal(s.approved,false);assert.equal(s.evidence_reviewed,false);
 assert.deepEqual(s.external_actions,[]);assert.equal(s.submission_status,'UNSUBMITTED');assert.deepEqual(readFileSync(evidence),bytes);
});
test('a new tool ID cannot repeat a consumed request; same immutable ID returns only its original receipt',()=>{
 const s=fresh(),t=turn('a','We have 10 people.'),request=turn('r','Please prepare a brief for human review.');appendTurn(s,t);appendTurn(s,request);
 const p=[proposal(t)],r=recordProviderHandoffAttempt(s,p,fields,'first',identity(s,'tool-1')),before=structuredClone(s);
 assert.deepEqual(recordProviderHandoffAttempt(s,p,fields,'duplicate',identity(s,'tool-1')),r);assert.deepEqual(s,before);
 assert.throws(()=>recordProviderHandoffAttempt(s,p,fields,'repeat',identity(s,'tool-2')),/already has/);assert.deepEqual(s,before);
});
test('replacement requires exact complete correction and same field; unrelated same-field facts remain',()=>{
 const s=fresh(),old=turn('a','Our team has 10 people.'),other=turn('b','Our office is in Reno.'),fix=turn('c','Actually, our team has 8 people, not 10.');
 appendTurn(s,old);appendTurn(s,other);recordHandoffAttempt(s,[proposal(old),proposal(other)],fields,'old');appendTurn(s,fix);
 recordHandoffAttempt(s,[proposal(fix)],fields,'fix');assert.equal(s.proposals.length,2);assert.ok(s.proposals.some(p=>p.value===other.content));
 assert.equal(s.superseded_mappings[0].proposal.value,old.content);assert.equal(s.superseded_mappings[0].replacement_proposal_id,digest(proposal(fix)));
});
test('mixed invalid update is atomic and retains the original proposals and correction evidence',()=>{
 const s=fresh(),old=turn('a','We have 10 people.'),fix=turn('b','Correction: we have 8 people, not 10.');appendTurn(s,old);recordHandoffAttempt(s,[proposal(old)],fields,'a');appendTurn(s,fix);
 const p=structuredClone(s.proposals),turns=structuredClone(s.turns);
 const r=recordHandoffAttempt(s,[proposal(fix),{...proposal(fix),value:'Paraphrased replacement'}],fields,'bad');
 assert.equal(r.accepted,false);assert.deepEqual(s.proposals,p);assert.equal(s.superseded_mappings,undefined);assert.deepEqual(s.turns,turns);
});
test('a mismatched field or partial correction cannot retire an unrelated prior mapping',()=>{
 for(const input of ['wrong-field','partial']){
  const s=fresh(),old=turn('a','We have 10 people.'),fix=turn('b','Correction: we have 8 people, not 10.');appendTurn(s,old);recordHandoffAttempt(s,[proposal(old)],fields,'a');appendTurn(s,fix);
  const replacement=input==='wrong-field'?proposal(fix,'rules'):proposal(fix,'context','we have 8 people');
  assert.equal(recordHandoffAttempt(s,[replacement],fields,'b').accepted,true);assert.ok(s.proposals.some(p=>p.value===old.content));assert.equal(s.superseded_mappings,undefined);
 }
});
test('compound original does not lose sibling facts through whole-note replacement',()=>{
 for(const text of ['We have 10 people and use a shared inbox.','We have 10 people, 2 branches.','We have 10 people. Our shop is in Reno.','We have 10 people (2 branches).','We have 10 people working 2 shifts.']){
  const s=fresh(),old=turn('a',text),fix=turn('b','Correction: we have 8 people, not 10.');appendTurn(s,old);recordHandoffAttempt(s,[proposal(old)],fields,'a');appendTurn(s,fix);
  recordHandoffAttempt(s,[proposal(fix)],fields,'b');assert.ok(s.proposals.some(p=>p.value===old.content));assert.equal(s.superseded_mappings,undefined);
  s.provider_transcript_verified=true;assert.throws(()=>decide(s,digest(proposal(old)),'ACCEPT',fields),/exact persisted/);
 }
});
test('previous owner decision stays historical and never becomes approval of the replacement',()=>{
 const s=fresh(),old=turn('a','We have 10 people.'),fix=turn('b','Correction: we have 8 people, not 10.');appendTurn(s,old);recordHandoffAttempt(s,[proposal(old)],fields,'a');
 s.provider_transcript_verified=true;decide(s,digest(proposal(old)),'ACCEPT',fields);const decision=structuredClone(s.decisions[0]);appendTurn(s,fix);
 s.status='CLOSED';s.provider_release_verified=true;s.provider_transcript_verified=true;s.evidence_reviewed=true;assert.throws(()=>approve(s));
 recordHandoffAttempt(s,[proposal(fix)],fields,'b');assert.deepEqual(s.superseded_mappings[0].prior_decision,decision);assert.deepEqual(s.decisions,[decision]);
 assert.equal(s.evidence_reviewed,false);assert.throws(()=>approve(s));assert.equal(s.approved,false);
 const reloaded=JSON.parse(JSON.stringify(s));assert.deepEqual(reloaded,s);assert.equal(reloaded.superseded_mappings[0].proposal.value,old.content);
});
test('an accepted current replacement must receive its own explicit offline owner decision before export',()=>{
 const s=fresh(),a=turn('a','We have 10 people.'),b=turn('b','Correction: we have 8 people, not 10.');appendTurn(s,a);recordHandoffAttempt(s,[proposal(a)],fields,'a');appendTurn(s,b);recordHandoffAttempt(s,[proposal(b)],fields,'b');
 s.status='CLOSED';s.provider_release_verified=true;s.provider_transcript_verified=true;assert.throws(()=>approve(s));
 decide(s,digest(proposal(b)),'ACCEPT',fields);s.evidence_reviewed=true;approve(s);
 const exported=JSON.parse(JSON.stringify({handoff:s}));assert.equal(exported.handoff.proposals[0].value,b.content);assert.equal(exported.handoff.superseded_mappings[0].proposal.value,a.content);
 assert.equal(exported.handoff.submission_status,'UNSUBMITTED');assert.deepEqual(exported.handoff.external_actions,[]);
});
