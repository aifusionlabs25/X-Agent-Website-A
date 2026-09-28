import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyIntake,ingest,readiness,questionIntent,conversationGuidance,contractorCommunication} from '../lib/james-canary/state.ts';
const t=(id,content)=>({id,role:'user',content});
const start=()=>ingest(emptyIntake(),t('first','A contractor left my kitchen torn apart after taking a $4,000 deposit. I want my $4,000 back.'));
test('retained past-refund question is communication, not desired remedy',()=>{
 for(const q of ['What happened when you last contacted the contractor, including any refund request?','Did you send a refund request to the contractor after the work was left incomplete?','What did you say when you last reached out—did you ask for the money back?'])assert.equal(questionIntent(q),'contractor_contact');
 assert.equal(questionIntent('Would you like the contractor to finish the work or refund your money?'),'requested_outcome');
});
test('exact retained failure resolves contact independently of refund outcome and prior wording',()=>{
 const raw='I last texted him yesterday asking for a refund. He has not answered my calls. My kitchen is unusable and this is urgent.';
 for(const prior of ['', 'Did you send a refund request to the contractor after the work was left incomplete?','What outcome do you want?']){
  const s=ingest(start(),t('contact',raw),prior);
  assert.equal(readiness(s).checks.contractor_contact,true);
  assert.deepEqual(s.facts.filter(f=>f.field==='requested_outcome').map(f=>f.value),['I want my $4,000 back']);
  const facts=s.facts.filter(f=>f.field==='contractor_contact');assert.equal(facts.length,2);
  assert.deepEqual(facts.map(f=>f.communicationAct),['REFUND_REQUEST_REPORTED','NO_RESPONSE_REPORTED']);
  assert.ok(facts.every(f=>raw.includes(f.evidence)&&f.sourceHash&&f.turnId==='contact'));
  const g=conversationGuidance({intake:s,turns:[t('contact',raw)]});assert.equal(g.contractor_contact.resolved,true);
  assert.notEqual(g.next_question_intent,'contractor_contact');assert.ok(g.completed_intents_do_not_reask.includes('contractor_contact'));
 }
});
test('communication relations support paraphrases, direction, negation and explanations',()=>{
 for(const [text,act] of [
  ['I emailed the builder to request reimbursement.','REFUND_REQUEST_REPORTED'],
  ['I spoke with him on Monday.','CONTACT_REPORTED'],
  ['He explained that the supplier was late.','EXPLANATION_REPORTED'],
  ['They never reply to my messages.','NO_RESPONSE_REPORTED'],
  ['He is ignoring me.','NO_RESPONSE_REPORTED'],
  ['I have not contacted him yet.','NOT_CONTACTED'],
  ['I asked him to return my deposit.','REFUND_REQUEST_REPORTED'],
 ]){
  const s=ingest(start(),t('p',text));const f=s.facts.find(f=>f.field==='contractor_contact');
  assert.ok(f,text);assert.equal(f.communicationAct,act,text);assert.equal(readiness(s).checks.contractor_contact,true);
 }
});
test('desired refund, planned contact, questions and unrelated parties do not invent completed communication',()=>{
 for(const text of ['I want my $4,000 back.','I will call him tomorrow.','Should I email him?','The insurance adjuster called me.','My contractor took a deposit.'])assert.equal(contractorCommunication(text,start(),''),null,text);
 assert.equal(contractorCommunication('He said the parts were delayed.',emptyIntake(),''),null);
});
test('readiness consumes typed state and explicit unknown, not matching words in unrelated fields',()=>{
 const s=start();s.facts.push({id:'old',field:'material_facts',value:'I texted the contractor for a refund',status:'VISITOR_REPORTED'});
 assert.equal(readiness(s).checks.contractor_contact,false);
 s.facts.push({id:'typed',field:'contractor_contact',value:'An alternative phrasing with provenance',status:'VISITOR_REPORTED',communicationAct:'CONTACT_REPORTED'});
 assert.equal(readiness(s).checks.contractor_contact,true);
 const unknown=ingest(start(),t('unknown','I do not know.'),'What happened when you last contacted the contractor?');
 assert.equal(readiness(unknown).checks.contractor_contact,true);
});
test('contact and completed greeting cannot restart conversation after reload',()=>{
 const before={intake:emptyIntake(),turns:[]};assert.equal(conversationGuidance(before).greeting_allowed,true);
 const ongoing={intake:start(),turns:[{id:'g',role:'persona',content:'Hi, I am James.'},t('1','A contractor took my deposit.')]};
 const g=conversationGuidance(ongoing);assert.equal(g.greeting_allowed,false);assert.match(g.conversation_continuity,/never reintroduce/i);
 assert.deepEqual(conversationGuidance(JSON.parse(JSON.stringify(ongoing))),g);
});
