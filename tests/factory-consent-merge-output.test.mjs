import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {appendTurn,assertProposal,digest} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {requestedHandoffSpan} from '../lib/factory/handoff-request.ts';
import {handoffOutputGate} from '../lib/factory/handoff-output-gate.ts';
import {handoffRequestContext} from '../lib/factory/handoff-context.ts';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/factory-consent-merge-output-20261110.json',import.meta.url),'utf8'));
const fresh=()=>({id:'offline',version:1,package_sha256:'fictional',persona_id:'offline',launch_label:'offline',status:'ACTIVE',provider_session_id:'offline-provider',
 turns:[],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]});
const u=(id,content)=>({id,role:'user',content});
const a=(id,content)=>({id,role:'persona',content});
const fields=[{id:'context',label:'Context'},{id:'tools',label:'Tools'},{id:'scope',label:'Scope'}];
const p=(t,field_id='context')=>({field_id,visitor_message_id:t.id,evidence:t.content,value:t.content});
function attempt(s,input,allowed=fields,id='tool') {
 return recordProviderHandoffAttempt(s,input,allowed,id,{local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:id});
}
function gate(s){const media=[],events=[],notices=[];const g=handoffOutputGate({localSessionId:s.id,providerSessionId:()=>s.provider_session_id,
 output:m=>media.push(m),notice:n=>notices.push(n),report:e=>events.push(e)});g.committed(s);return {g,media,events,notices};}
function replay(){
 const s=fresh(),results=[],snapshots=[],x=gate(s);
 for(const t of fixture.turns){
  if(t.role==='user'){x.g.speechStarted();x.g.visitor(t);}else x.g.persona();
  appendTurn(s,t);x.g.committed(s);
  const old=fixture.attempts.find(row=>row.through_visitor_turn_id===t.id);
  if(old){results.push(attempt(s,old.original_proposals,fixture.fields,old.tool_call_id));x.g.committed(s);snapshots.push(structuredClone(s));}
 }
 return {s,results,snapshots,...x};
}
test('saved consent binds both local offers, without turning assistant suggestions into facts',()=>{
 const {s,snapshots}=replay();
 assert.deepEqual(s.handoff_requests?.map(r=>r.visitor_message_id),fixture.attempts.map(a=>a.through_visitor_turn_id));
 for(const row of s.handoff_requests){
  const i=s.turns.findIndex(t=>t.id===row.visitor_message_id),offer=s.turns[i-1];
  assert.equal(row.offer_turn_id,offer.id);assert.equal(row.offer_evidence,offer.content);
  assert.equal(s.turns[i].content.slice(row.start,row.end),row.evidence);
 }
 assert.match(handoffRequestContext({...snapshots[1],handoff_binding_attempts:snapshots[1].handoff_binding_attempts.slice(0,1)},fixture.turns[11]),/new explicit visitor request/);
 assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});
test('saved update accepts the identical correction across fields and preserves every unrelated old span',()=>{
 const before=digest(fixture),{s,results}=replay();
 assert.equal(results[0].accepted,true);assert.equal(results[1].accepted,true);
 assert.equal(s.superseded_mappings.length,4);
 for(const archived of s.superseded_mappings){
  const b=archived.current_fact_selection,parts=[{start:b.removed_span.start,end:b.removed_span.end,text:b.removed_span.text},
   ...b.retained_spans.map(r=>({start:r.start,end:r.end,text:r.proposal.evidence}))].sort((x,y)=>x.start-y.start);
  assert.equal(parts.map(r=>r.text).join(''),archived.proposal.evidence);
  let cursor=b.evidence_start;for(const span of parts){assert.equal(span.start,cursor);cursor=span.end;}assert.equal(cursor,b.evidence_end);
  assert.equal(b.removed_span.text,'6 staff');
  for(const r of b.retained_spans.filter(r=>r.proposal.evidence.trim()))assert.ok(s.proposals.some(q=>digest(r.proposal)===q.id));
 }
 for(const {id,...q} of s.proposals){void id;assertProposal(q,s.turns,fixture.fields);}
 assert.ok(s.proposals.some(q=>q.evidence.includes('4 staff')&&q.evidence.includes("don't know whether it has an API")));
 assert.ok(s.proposals.some(q=>q.evidence==='We use Outlook.'));
 assert.deepEqual(s.turns,fixture.turns);assert.equal(digest(fixture),before);
 assert.deepEqual(s.handoff_binding_attempts.map(a=>a.original_proposals),fixture.attempts.map(a=>a.original_proposals));
 assert.equal(s.approved,false);assert.equal(s.submission_status,'UNSUBMITTED');
});
test('saved output sequence recognizes receipts and does not mute the readback question for an old correction',()=>{
 const {events,s,results}=replay();assert.ok(results.every(r=>r.accepted));
 assert.equal(events.filter(e=>e.phase==='VERIFIED_RECEIPT').length,2);
 const readback=fixture.turns[9];assert.ok(events.some(e=>e.visitor_message_id===readback.id&&e.phase==='ORDINARY_REPLY'&&!e.muted));
 assert.equal(events.filter(e=>e.phase==='EXIT_REPLY').length,1);assert.equal(s.status,'CLOSING_PENDING');
 assert.equal(s.provider_release_verified,false,'offline replay never fabricates provider release');
});
test('independent affirmative forms require the immediately preceding unambiguous local offer',()=>{
 const offer=a('offer','Would you like me to draft a summary for owner review?');
 for(const text of ['Yes, please.','Sure.','Please do.','Go ahead.','Yes, go ahead.']){
  const s=fresh();appendTurn(s,offer);appendTurn(s,u('answer',text));
  assert.equal(s.handoff_requests.length,1,text);assert.equal(s.handoff_requests[0].offer_turn_id,'offer');
 }
 for(const content of ['Is your email correct?','Would you like me to send this to the team?',
  'Would you like me to prepare a local brief and email it?',
  'Would you like me to draft an owner-review summary? What is your phone number?',
  'Is the local brief correct?','My colleague said: Would you like me to prepare a local brief?',
  'He said. Would you like me to prepare a local brief?',
  '"Would you like me to prepare a local brief?"',
  'Would you like me to prepare a local brief or explain pricing?',
  'Would you like me to prepare a local brief if the manager agrees?']){
  assert.equal(requestedHandoffSpan('Yes, please.',{precedingTurn:a('offer',content)}),null,content);
 }
 for(const text of ['No.','Not yet.','Yes, but not now.','Yes, send it.','He said yes.','"Yes, please."','If we proceed, yes.'])
  assert.equal(requestedHandoffSpan(text,{precedingTurn:offer}),null,text);
 const s=fresh();appendTurn(s,offer);appendTurn(s,u('aside','What about pricing?'));appendTurn(s,u('yes','Yes.'));
 assert.equal(s.handoff_requests,undefined,'old offers cannot be reused across an intervening visitor turn');
});
test('contextual consent works on either side of persistence, without reusing the older accepted receipt',()=>{
 const s=fresh(),fact=u('fact','We use a shared inbox.'),offer=a('offer','Shall I prepare a local brief?'),yes=u('yes','Yes.');
 appendTurn(s,fact);appendTurn(s,offer);const x=gate(s);
 appendTurn(s,yes);x.g.committed(s);x.g.visitor(yes);
 assert.equal(x.events.at(-1).phase,'WAITING_RECEIPT');assert.equal(x.media.at(-1),true);
 attempt(s,[p(fact)]);x.g.committed(s);assert.equal(x.events.at(-1).phase,'VERIFIED_RECEIPT');assert.equal(x.media.at(-1),false);
 const before=structuredClone(s);assert.deepEqual(attempt(s,[p(fact)]),s.handoff_binding_attempts[0].result);assert.deepEqual(s,before);
 assert.throws(()=>attempt(s,[p(fact)],fields,'another-tool'),/do not retry/);
});
test('equivalent full corrections in multiple fields do not erase old details or transfer owner approval',()=>{
 for(const [oldText,fixText] of [
  ['At Pine Supply we use email. 9 operators process requests. Quotes need human approval.','Actually, 7 operators process requests, not 9. Integration access is unknown.'],
  ['Our team has 12 staff. We keep paper records.','Correction: we have 8 staff, not 12. The portal is optional.']]){
  const s=fresh(),old=u('old',oldText),fix=u('fix',fixText);appendTurn(s,old);attempt(s,[p(old),p(old,'scope')]);
  const oldIds=s.proposals.map(q=>q.id);s.decisions=oldIds.map(proposal_id=>({proposal_id,decision:'ACCEPT',at:'offline'}));
  appendTurn(s,fix);const result=attempt(s,[p(fix),p(fix,'tools')],fields,'update');assert.equal(result.accepted,true);
  assert.equal(s.superseded_mappings.length,2);assert.ok(s.superseded_mappings.every(r=>r.prior_decision.decision==='ACCEPT'));
  assert.ok(s.proposals.every(q=>!s.decisions.some(d=>d.proposal_id===q.id)));
  for(const {id,...q} of s.proposals){void id;assertProposal(q,s.turns,fields);}
  assert.deepEqual(s.turns,[old,fix]);
 }
});
test('invalid correction sibling still blocks the entire update without retiring prior facts',()=>{
 const s=fresh(),old=u('old','We have 6 staff. We use email.'),fix=u('fix','Correction: we have 4 staff, not 6.');
 appendTurn(s,old);attempt(s,[p(old)]);appendTurn(s,fix);const before=structuredClone(s.proposals);
 const result=attempt(s,[p(fix),{...p(fix,'tools'),value:'four staff'}],fields,'bad');
 assert.equal(result.accepted,false);assert.deepEqual(s.proposals,before);assert.equal(s.superseded_mappings,undefined);
});
test('verified rejection settles waiting, holds unsafe speech, and permits the next ordinary reply without retry',()=>{
 const s=fresh(),x=gate(s),request=u('request','Please prepare a local brief.');
 x.g.visitor(request);appendTurn(s,request);attempt(s,[]);x.g.committed(s);
 assert.equal(x.events.at(-1).phase,'FAILED_RECEIPT');assert.equal(x.media.at(-1),true);
 assert.match(x.notices.at(-1),/could not be verified/);x.g.persona();assert.equal(x.events.at(-1).phase,'FAILED_RECEIPT');
 const next=u('question','Can I continue asking questions?');x.g.speechStarted();x.g.visitor(next);appendTurn(s,next);x.g.committed(s);
 assert.equal(x.events.at(-1).phase,'ORDINARY_REPLY');assert.equal(x.media.at(-1),false);
 assert.equal(s.handoff_binding_attempts.length,1);assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});
