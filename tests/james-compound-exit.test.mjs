import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyIntake,applyTurn,intentStates,readiness,conversationGuidance,endIntent,sha} from '../lib/james-canary/state.ts';

const base=()=>({state:'ACTIVE',turns:[],intake:emptyIntake()});
const add=(s,content,role='user')=>applyTurn(s,{id:`turn-${s.turns.length}`,role,content});
const values=(s,field)=>s.intake.facts.filter(f=>f.field===field).map(f=>f.value);
const nameQuestion='What name would you like associated with this intake?';
function sourceIntegrity(s) {
 for(const fact of s.intake.history) {
  const turn=s.turns.find(t=>t.id===fact.turnId);
  assert.ok(turn,`Missing source turn for ${fact.field}`);
  assert.ok(turn.content.includes(fact.evidence),`Evidence not an original span: ${fact.evidence}`);
  assert.equal(fact.sourceHash,sha(turn.content));
  if(fact.questionBinding)assert.equal(fact.questionBinding.hash,sha(fact.questionBinding.text));
  if(fact.interpretedFrom) {
   const original=s.turns.find(t=>t.id===fact.interpretedFrom.turnId);
   assert.ok(original.content.includes(fact.interpretedFrom.evidence));
   assert.equal(fact.interpretedFrom.sourceHash,sha(original.content));
  }
 }
}

test('coordinated documents, third-party negative and outcome never resolve caller identity',()=>{
 const examples=[
  'I have my final pay stub and timesheets; they gave no other explanation; I want help recovering my unpaid wages.',
  'I have my timesheets, and they gave no other explanation, but I want help recovering my unpaid wages.',
  'They gave no other explanation, but I have my final pay stub and I want help recovering my unpaid wages.',
  'I want help recovering my unpaid wages; I have my final pay stub, and they gave no other explanation.',
 ];
 for(const text of examples) {
  const s=add(add(base(),nameQuestion,'persona'),text),states=intentStates(s.intake);
  assert.equal(states.identity,'UNANSWERED',text);
  assert.equal(states.paperwork,'ANSWERED',text);
  assert.equal(states.requested_outcome,'ANSWERED',text);
  assert.ok(s.intake.facts.some(f=>/no other explanation/i.test(f.evidence)),text);
  assert.ok(!s.intake.facts.some(f=>f.topic==='identity'),text);
  sourceIntegrity(s);
 }
});

test('name and independent coordinated facts coexist as separately grounded fields',()=>{
 for(const text of [
  'My name is Jordan Blake; I have my timesheets; they gave no other explanation; I want help recovering my unpaid wages.',
  'My name is Robin Taylor, and I have my final pay stub, but they gave no other explanation, and I want help recovering my unpaid wages.',
 ]) {
  const s=add(add(base(),nameQuestion,'persona'),text),states=intentStates(s.intake);
  assert.equal(values(s,'visitor_preferred_identifier').length,1);
  assert.equal(states.identity,'ANSWERED');assert.equal(states.paperwork,'ANSWERED');assert.equal(states.requested_outcome,'ANSWERED');
  const identity=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
  assert.ok(!/explanation|timesheets|unpaid/i.test(identity.evidence));
  assert.ok(!['identity','paperwork','requested_outcome'].includes(conversationGuidance(s).next_question_intent));
  sourceIntegrity(s);
 }
});

test('independent facts do not inherit unrelated non-contact question categories',()=>{
 const s=add(add(base(),'What paperwork do you have?','persona'),'My employer withheld my wages; I want help recovering the payment.');
 assert.equal(intentStates(s.intake).paperwork,'UNANSWERED');
 assert.equal(intentStates(s.intake).requested_outcome,'ANSWERED');
 assert.ok(s.intake.facts.some(f=>f.field==='material_facts'&&/withheld my wages/.test(f.evidence)));
 assert.ok(!s.intake.facts.some(f=>f.topic==='paperwork'));sourceIntegrity(s);
});

test('source-bound email confirmation preserves following documents and outcome',()=>{
 for(const text of [
  'Yes, that is correct; I also have my timesheets; I want help recovering unpaid wages.',
  'Yes, that is correct, and I also have my final pay stub, and I want help recovering unpaid wages.',
 ]) {
  let s=add(add(base(),'What email address would you like to use?','persona'),'r.blake@example.com');
  assert.equal(s.intake.emailCandidate.value,'r.blake@example.com');
  s=add(s,'I heard r.blake@example.com. Is that correct?','persona');s=add(s,text);
  assert.deepEqual(values(s,'primary_email'),['r.blake@example.com']);
  assert.equal(s.intake.emailCandidate,undefined);
  assert.equal(intentStates(s.intake).paperwork,'ANSWERED');
  assert.equal(intentStates(s.intake).requested_outcome,'ANSWERED');
  const email=s.intake.facts.find(f=>f.field==='primary_email');
  assert.equal(email.status,'VISITOR_CONFIRMED');
  assert.ok(!/timesheets|pay stub|recovering/i.test(email.evidence));
  assert.equal(email.interpretedFrom.evidence,'r.blake@example.com');
  sourceIntegrity(s);
 }
});

test('unknown and negative answer spans survive boundary punctuation without consuming siblings',()=>{
 for(const [text,expected] of [["I don't know; I have my timesheets.",'UNKNOWN'],['No; I have my timesheets.','EXPLICIT_NONE']]) {
  const s=add(add(base(),'What is your phone number?','persona'),text);
  assert.equal(intentStates(s.intake).primary_phone,expected);
  assert.equal(intentStates(s.intake).paperwork,'ANSWERED');
  assert.equal(values(s,'primary_phone').length,0);sourceIntegrity(s);
 }
 const s=add(add(base(),nameQuestion,'persona'),'There was no other explanation; I have my timesheets.');
 assert.equal(intentStates(s.intake).identity,'UNANSWERED');sourceIntegrity(s);
});

test('handoff consent and supplied contact siblings are both processed without sending',()=>{
 for(const text of [
  'Please prepare the summary for the firm; my name is Riley Morgan; my phone number is 602-555-0142.',
  'My name is Riley Morgan, and my phone number is 602-555-0142, and please prepare the summary for the firm.',
 ]) {
  const s=add(base(),text);
  assert.equal(s.intake.handoff,'HANDOFF_REQUESTED');
  assert.deepEqual(values(s,'visitor_preferred_identifier'),['Riley Morgan']);
  assert.deepEqual(values(s,'primary_phone'),['6025550142']);
  assert.equal(s.email,undefined);assert.equal(s.state,'ACTIVE');
  sourceIntegrity(s);
 }
});

test('terminal comma goodbye preserves earlier facts and leaves incomplete intake incomplete',()=>{
 for(const text of [
  'I have my final pay stub. Goodbye,',
  'I have my timesheets; goodbye,',
  'I have my final pay stub, and goodbye,',
 ]) {
  const s=add(add(base(),'What paperwork do you have?','persona'),text);
  assert.equal(endIntent(text),true,text);assert.equal(s.state,'CLOSING_PENDING');
  assert.equal(intentStates(s.intake).paperwork,'ANSWERED');
  assert.equal(readiness(s.intake).ready,false);
  assert.equal(s.intake.handoff,'NOT_REQUESTED');assert.equal(s.providerRelease,undefined);
  assert.equal(s.turns.at(-1).content,text);
  sourceIntegrity(s);
  assert.throws(()=>add(s,'Here is another fact.'),/not accepting/);
  const farewell=add(s,'Have a great day.','persona');
  assert.equal(farewell.state,'CLOSING_PENDING');assert.equal(farewell.providerRelease,undefined);
 }
});

test('direct punctuation variants close but quoted, narrated, negated and nonterminal farewells do not',()=>{
 for(const text of ['Goodbye,','Goodbye;','Thanks, James, goodbye,','Thanks, James. Goodbye,'])assert.equal(endIntent(text),true,text);
 for(const text of [
  'The email says "Thanks. Goodbye."',
  'The email says “Thanks. Goodbye.”',
  'The employer said, "goodbye".',
  'He told me, goodbye,',
  'I am not saying goodbye,',
  "Don't say goodbye,",
  'Before we say goodbye, I have another question.',
  'Goodbye is what my boss said.',
  'He said goodbye. I need help.',
 ]) {
  assert.equal(endIntent(text),false,text);
  assert.equal(add(base(),text).state,'ACTIVE',text);
 }
});
