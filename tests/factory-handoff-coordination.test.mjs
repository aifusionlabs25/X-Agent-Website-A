import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {appendTurn,assertProposal,digest} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {includeProvenCorrections} from '../lib/factory/handoff-correction-evidence.ts';
import {handoffOutputGate,appendHandoffOutputEvidence} from '../lib/factory/handoff-output-gate.ts';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/factory-handoff-coordination-20261110.json',import.meta.url),'utf8'));
const fields=[{id:'context',label:'Business context'},{id:'other',label:'Other'}];
const u=(id,content)=>({id,role:'user',content});
const proposal=(turn,field_id='context')=>({field_id,visitor_message_id:turn.id,evidence:turn.content,value:turn.content});
const fresh=()=>({id:'local',version:1,package_sha256:'fictional',persona_id:'persona',launch_label:'label',status:'ACTIVE',provider_session_id:'provider',
 turns:[],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,
 approved:false,submission_status:'UNSUBMITTED',external_actions:[]});
const identity={local_session_id:'local',provider_session_id:'provider',tool_call_id:'tool'};
const request=u('request','Please prepare this information for human review.');
function saved(){const s=fresh();for(const t of fixture.turns)appendTurn(s,t);return s;}
function assertCoverage(binding,source) {
 const spans=[{start:binding.removed_span.start,end:binding.removed_span.end,text:binding.removed_span.text},
  ...binding.retained_spans.map(s=>({start:s.start,end:s.end,text:s.proposal.evidence}))].sort((a,b)=>a.start-b.start);
 let cursor=binding.evidence_start;
 for(const span of spans){assert.equal(span.start,cursor);assert.equal(source.content.slice(span.start,span.end),span.text);cursor=span.end;}
 assert.equal(cursor,binding.evidence_end);assert.equal(spans.map(s=>s.text).join(''),binding.original.evidence);
}
test('saved stale provider arguments gain a proven correction with full original/source audit, not a rewritten quote',()=>{
 const s=saved(),before=structuredClone(fixture),turns=structuredClone(s.turns);
 const result=recordProviderHandoffAttempt(s,fixture.original_proposals,fixture.fields,'r',identity);
 assert.equal(result.accepted,true);assert.equal(result.owner_approved,false);
 const a=s.handoff_binding_attempts[0];assert.deepEqual(a.original_proposals,fixture.original_proposals);
 assert.deepEqual(a.resolved_proposals,fixture.original_proposals);assert.equal(a.correction_evidence_bindings.length,1);
 const correction=fixture.turns.at(-1);assert.ok(s.proposals.some(p=>p.visitor_message_id===correction.id&&p.evidence===correction.content));
 assert.match(correction.content,/4 staff/);assert.match(correction.content,/supplier portal/);assert.match(correction.content,/don't know/);
 const selection=a.current_fact_selections[0];assertCoverage(selection,fixture.turns[1]);
 assert.equal(selection.removed_span.text,'6 staff');
 for(const {id,...p} of s.proposals)assertProposal(p,s.turns,fixture.fields);
 assert.deepEqual(s.turns,turns);assert.deepEqual(fixture,before);
 assert.equal(a.through_visitor_turn_id,correction.id);assert.equal(a.input_sha256,digest(fixture.original_proposals));
 assert.deepEqual(s.external_actions,[]);assert.equal(s.approved,false);
});
test('independent positive-count wording retains every unrelated source span and uncertainty',()=>{
 for(const [text,fix] of [
  ['At Ridge Supply we use email. 9 operators process incoming orders. We record them in a ledger.','Actually, 7 operators process those orders, not 9. Portal access is unknown.'],
  ['Our team has 12 staff. Files arrive through email.','Correction: we have 8 staff, not 12. We also use an unnamed portal.'],
  ['Um, 3 reviewers review requests. We require human sign-off.','One correction: 2 reviewers review those requests, not 3. Its API is unknown.']
 ]) {
  const s=fresh(),old=u('old',text),correction=u('fix',fix);[old,request,correction].forEach(t=>appendTurn(s,t));
  const r=recordProviderHandoffAttempt(s,[proposal(old)],fields,'r',identity);assert.equal(r.accepted,true,text);
  assertCoverage(s.handoff_binding_attempts[0].current_fact_selections[0],old);
  for(const {id,...p} of s.proposals)assertProposal(p,s.turns,fields);
  assert.ok(s.proposals.some(p=>p.evidence===fix));assert.deepEqual(s.turns,[old,request,correction]);
 }
});
test('ambiguous fields, malformed corrections, paraphrases, qualifiers and invalid siblings never gain acceptance',()=>{
 const old=u('old','We have 6 staff. Email is used.'),fix=u('fix','Correction: we have 4 staff, not 6.');
 const turns=[old,request,fix];
 for(const input of [
  [proposal(old),proposal(old,'other')],
  [proposal(old),{...proposal(fix),value:'four staff'}],
  [{...proposal(old),field_id:'unknown'}],
  [{...proposal(old),evidence:'There are six staff.',value:'There are six staff.'}],
 ])assert.equal(includeProvenCorrections(input,turns,fields).bindings.length,0);
 for(const content of ['If we have 6 staff, email is used.','We have at least 6 staff.','My manager said: We have 6 staff.','6 staff handle orders if approved.']) {
  const source=u('old',content);assert.equal(includeProvenCorrections([proposal(source)],[source,request,fix],fields).bindings.length,0);
 }
 const s=fresh();turns.forEach(t=>appendTurn(s,t));
 const r=recordProviderHandoffAttempt(s,[proposal(old),{...proposal(fix),field_id:'unknown'}],fields,'bad',identity);
 assert.equal(r.accepted,false);assert.equal(s.proposals.length,0);assert.deepEqual(s.turns,turns);
});
test('repeated tool identity is idempotent; a consumed request never receives an automatic retry',()=>{
 const s=saved(),r=recordProviderHandoffAttempt(s,fixture.original_proposals,fixture.fields,'r',identity),before=structuredClone(s);
 assert.deepEqual(recordProviderHandoffAttempt(s,fixture.original_proposals,fixture.fields,'duplicate',identity),r);assert.deepEqual(s,before);
 assert.throws(()=>recordProviderHandoffAttempt(s,fixture.original_proposals,fixture.fields,'new',{...identity,tool_call_id:'new'}),/do not retry/);
});
function gate(s=fresh()) {
 const media=[],notices=[],events=[];let n=0;
 const g=handoffOutputGate({localSessionId:'local',providerSessionId:()=> 'provider',output:m=>media.push(m),notice:t=>notices.push(t),
 report:e=>events.push(e),id:()=>`11111111-1111-4111-8111-${String(++n).padStart(12,'0')}`,now:()=> '2026-11-10T10:00:00Z'});
 g.committed(s);return {g,media,notices,events};
}
function acceptedState(s,through=request) {
 const first=u('fact','We want draft quotes.');if(!s.turns.some(t=>t.id===first.id))appendTurn(s,first);
 if(!s.turns.some(t=>t.id===request.id))appendTurn(s,request);
 if(!s.turns.some(t=>t.id===through.id))appendTurn(s,through);
 recordProviderHandoffAttempt(s,[proposal(first)],fields,'r',identity);return s;
}
test('premature success reply remains muted even after a late verified receipt; source transcript is unchanged',()=>{
 const s=fresh(),{g,media,notices}=gate(s);g.speechStarted();g.visitor(request);appendTurn(s,request);g.committed(s);
 g.persona();assert.equal(media.at(-1),true);
 const reply={id:'p',role:'persona',content:"I've prepared it."};appendTurn(s,reply);
 acceptedState(s); // final visitor now fact, so stale through-turn receipt must not release this request
 g.committed(s);assert.equal(media.at(-1),true);
 assert.deepEqual(s.turns.find(t=>t.id==='p'),reply);
 const s2=fresh(),x=gate(s2);x.g.visitor(request);appendTurn(s2,request);acceptedState(s2); // receipt before reply, with fact appended later: mismatch stays blocked
 x.g.committed(s2);assert.equal(x.media.at(-1),true);
 assert.ok(notices.some(t=>t.includes('held')));
});
test('only a current session-bound accepted server outcome releases a not-yet-started handoff reply',()=>{
 const s=fresh(),fact=u('fact','We want draft quotes.');appendTurn(s,fact);const {g,media}=gate(s);
 g.speechStarted();g.visitor(request);appendTurn(s,request);
 recordProviderHandoffAttempt(s,[proposal(fact)],fields,'r',identity);
 g.committed({...s,id:'another'});assert.equal(media.at(-1),true);
 g.committed(s);assert.equal(media.at(-1),false);g.persona();assert.equal(media.at(-1),false);
 g.speechStarted();g.committed(s);assert.equal(media.at(-1),true,'late duplicate receipt cannot unmute during new speech');
});
test('late valid receipt does not expose an already-started acknowledgment tail',()=>{
 const s=fresh(),fact=u('fact','We want draft quotes.');appendTurn(s,fact);const {g,media,events}=gate(s);
 g.visitor(request);appendTurn(s,request);g.committed(s);g.persona();
 recordProviderHandoffAttempt(s,[proposal(fact)],fields,'r',identity);g.committed(s);
 assert.equal(g.snapshot().accepted,true);assert.equal(media.at(-1),true);
 assert.equal(events.at(-1).phase,'VERIFIED_RECEIPT');assert.equal(events.at(-1).muted,true);
});
test('foreign, legacy, stale or externally acting receipts never release handoff output',()=>{
 for(const mode of ['foreign-call','legacy','stale-turn','changed-turn','unbound-request','external-action','rejected']) {
  const s=fresh(),fact=u('fact','We want draft quotes.');appendTurn(s,fact);const {g,media}=gate(s);
  g.visitor(request);appendTurn(s,request);recordProviderHandoffAttempt(s,[proposal(fact)],fields,'r',identity);
  const a=s.handoff_binding_attempts[0];
  if(mode==='foreign-call')a.provider_session_id='another';
  if(mode==='legacy')delete a.through_visitor_turn_id;
  if(mode==='stale-turn')a.through_visitor_turn_id='old';
  if(mode==='changed-turn')s.turns.find(t=>t.id===request.id).content='Different request.';
  if(mode==='unbound-request')s.handoff_requests=[];
  if(mode==='external-action')a.result.external_actions=['SENT'];
  if(mode==='rejected')a.result.accepted=false;
  g.committed(s);assert.equal(media.at(-1),true,mode);
 }
});
test('a newly spoken correction cannot be released by the previous successful receipt',()=>{
 const s=fresh(),fact=u('fact','We have 6 staff. Email is used.');appendTurn(s,fact);const {g,media}=gate(s);
 g.visitor(request);appendTurn(s,request);recordProviderHandoffAttempt(s,[proposal(fact)],fields,'r',identity);g.committed(s);
 assert.equal(media.at(-1),false);
 const correction=u('correction','Correction: we have 4 staff, not 6. Portal access is unknown.');
 g.speechStarted();g.visitor(correction);appendTurn(s,correction);g.committed(s);g.persona();
 assert.equal(media.at(-1),true);assert.equal(g.snapshot().accepted,false);
 assert.equal(s.handoff_binding_attempts.length,1,'the output gate never retries preparation');
});
test('rejected or absent receipt stays held; exit still gets one normal close path and ordinary discovery stays audible',()=>{
 const s=fresh(),{g,media}=gate(s);g.speechStarted();g.visitor(u('ordinary','What services are available?'));assert.equal(media.at(-1),false);
 g.visitor(request);appendTurn(s,request);recordProviderHandoffAttempt(s,[],fields,'bad',identity);g.committed(s);assert.equal(media.at(-1),true);
 g.visitor(u('exit','Thanks, Olivia. Goodbye.'));assert.equal(media.at(-1),false);g.persona();assert.equal(media.at(-1),false);
 assert.equal(g.snapshot().exiting,true);assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});
test('retained correction and stale arguments coordinate to an accepted current receipt, with early speech still held',()=>{
 const s=fresh(),{g,media}=gate(s);
 for(const t of fixture.turns){if(t.role==='user')g.visitor(t);else g.persona();appendTurn(s,t);g.committed(s);}
 g.persona();const r=recordProviderHandoffAttempt(s,fixture.original_proposals,fixture.fields,'r',identity);g.committed(s);
 assert.equal(r.accepted,true);assert.equal(g.snapshot().accepted,true);assert.equal(media.at(-1),true);
 g.visitor(u('bye','Thanks, Olivia. Goodbye.'));assert.equal(media.at(-1),false);
});
test('output telemetry is immutable session evidence and cannot grant approval or provider release',()=>{
 const s=fresh(),{g,events}=gate(s);g.visitor(request);appendTurn(s,request);
 const e={...events.at(-1),local_session_id:s.id,provider_session_id:s.provider_session_id,launch_label:s.launch_label};
 appendHandoffOutputEvidence(s,e);appendHandoffOutputEvidence(s,e);assert.equal(s.handoff_output_events.length,1);
 assert.throws(()=>appendHandoffOutputEvidence(s,{...e,muted:false}),/immutable/);
 assert.throws(()=>appendHandoffOutputEvidence(s,{...e,provider_session_id:'another'}));
 assert.equal(s.approved,false);assert.equal(s.provider_release_verified,false);
});
