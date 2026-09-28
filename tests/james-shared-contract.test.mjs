import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyIntake,applyTurn,ingest,intentStates,questionIntent,readiness,conversationGuidance,brief,endIntent,sha} from '../lib/james-canary/state.ts';
const base=()=>({state:'ACTIVE',turns:[],intake:emptyIntake()});
const add=(s,content,role='user')=>applyTurn(s,{id:String(s.turns.length),content,role});
const answer=(question,text)=>add(add(base(),question,'persona'),text);

test('retained employment trace: field, topic, resolved intent and guidance share one contract',()=>{
 let s=add(base(),"Hi, I'm James with Knowles Law Firm. How can I help today?",'persona');
 s=add(s," Hi James, I'm calling because I was laid off last week.");
 assert.equal(readiness(s.intake).checks.reason_matter,true);
 assert.notEqual(conversationGuidance(s).next_question_intent,'reason_matter');
 s=add(s,' And my former employer is refusing to pay me for my last two weeks of work.');
 s=add(s,'What documents do you have that show the unpaid wages or the lay-off notice?','persona');
 s=add(s,' I have my final pay stub and the termination email. I also have my timesheets.');
 assert.equal(intentStates(s.intake).paperwork,'ANSWERED');
 assert.equal(s.intake.facts.filter(f=>f.topic==='paperwork').every(f=>f.field==='known_documents_as_reported'),true);
 assert.ok(!readiness(s.intake).missingIntents.some(k=>['allegations','opposing_contact','filing_status','contractor_contact'].includes(k)));
 assert.deepEqual(conversationGuidance(JSON.parse(JSON.stringify(s))),conversationGuidance(s));
 for(const f of s.intake.facts){const t=s.turns.find(t=>t.id===f.turnId);assert.ok(t.content.includes(f.evidence));assert.equal(f.sourceHash,sha(t.content));}
});

test('document-email questions never select primary contact email',()=>{
 for(const q of ['What was the date the termination email was sent?','Do you know when the email was sent or received?','When did that message arrive?'])assert.equal(questionIntent(q),'timing_urgency');
 for(const q of ['Do you have the email or any written notice?','What paperwork do you have?'])assert.equal(questionIntent(q),'paperwork');
 for(const q of ['What is your email address?','What email address would you like to use?','Would you like to provide an email for this intake, or leave email out?'])assert.equal(questionIntent(q),'primary_email');
 const s=answer('What was the date the termination email was sent?',' September 25th, I think.');
 assert.equal(s.intake.emailCandidate,undefined);assert.equal(intentStates(s.intake).primary_email,'UNANSWERED');
 assert.ok(s.intake.facts.filter(f=>f.field==='relevant_dates_events').every(f=>f.status==='NEEDS_CLARIFICATION'));
});

test('short negative answer binds to actual question, not correction parsing or contact email',()=>{
 for(const text of ['No, just that phrase.','There was no other explanation.','Nothing beyond that.','Only that wording.']){
  const q='Did the email include any other wording or explanation?';const s=answer(q,text),f=s.intake.facts[0];
  assert.equal(f.answerState,'EXPLICIT_NONE',text);assert.equal(f.topic,'core_facts');assert.equal(f.questionBinding.hash,sha(q));
  assert.equal(f.status,'VISITOR_REPORTED');assert.equal(f.value,text.slice(0,-1));assert.notEqual(conversationGuidance(s).next_question_intent,'core_facts');
 }
});

test('unknown, none, declined and unanswered remain distinguishable after reload',()=>{
 for(const [text,state] of [['I cannot recall.','UNKNOWN'],['No.','EXPLICIT_NONE'],['I would rather not answer.','DECLINED'],['Yes.','ANSWERED']]){
  const s=answer('What paperwork do you have?',text);
  assert.equal(intentStates(s.intake).paperwork,state);assert.ok(!conversationGuidance(s).next_question?.includes('paperwork'));
  assert.equal(intentStates(JSON.parse(JSON.stringify(s.intake))).paperwork,state);
 }
 assert.equal(intentStates(emptyIntake()).paperwork,'UNANSWERED');
 assert.equal(answer('What is your phone number?','Yes.').intake.facts.length,0);
 for(const q of ['What is your phone number?','What is your email address?']){
  const s=answer(q,'No.');assert.ok(s.intake.facts.every(f=>f.field==='uncertainties'));assert.doesNotThrow(()=>brief(s.intake));
 }
});

test('one unsuccessful clarification retains uncertainty and cannot be selected again',()=>{
 let s=answer('What paperwork do you have?','I think there might be a document.');
 assert.equal(intentStates(s.intake).paperwork,'NEEDS_CLARIFICATION');
 s=add(s,'Could you clarify which documents you have?','persona');s=add(s,'Okay.');
 assert.equal(s.intake.questionAttempts.paperwork,2);assert.equal(intentStates(s.intake).paperwork,'UNKNOWN');
 assert.ok(s.intake.facts.some(f=>f.answerState==='UNKNOWN'&&f.evidence==='Okay.'));
 assert.notEqual(conversationGuidance(s).next_question_intent,'paperwork');
});

test('different first-party contact reasons work through general inquiry without specialty vocabulary',()=>{
 for(const text of ['I am calling because my employer stopped paying my wages.','I am contacting you because my club expelled me without explanation.','I am here because an organization withheld my deposit.']){
  const s=answer('How can I help today?',text);assert.equal(readiness(s.intake).checks.reason_matter,true,text);
  assert.match(readiness(s.intake).practiceScope,/UNVERIFIED/);assert.notEqual(conversationGuidance(s).next_question_intent,'reason_matter');
 }
 for(const text of ['Hello?','Okay.','Thanks.'])assert.equal(answer('What brings you to the firm?',text).intake.facts.length,0);
});

test('factual answer remains distinct from an unrelated volunteered field',()=>{
 const s=answer('What happened when you last contacted the contractor?','My kitchen is unusable.');
 assert.equal(intentStates(s.intake).contractor_contact,'UNANSWERED');
 const c=answer('What paperwork do you have?','My phone number is 480-555-0136.');
 assert.equal(intentStates(c.intake).paperwork,'UNANSWERED');
 const b=answer('What happened when you last contacted the contractor?','Only the cabinets were removed, nothing was installed. I have a text message agreement and proof of the bank transfer.');
 assert.equal(intentStates(b.intake).contractor_contact,'UNANSWERED');
 const d=answer('How can I help today?','I would rather not give an email.');
 assert.equal(intentStates(d.intake).reason_matter,'UNANSWERED');assert.equal(intentStates(d.intake).primary_email,'DECLINED');
});

test('retained compound exit closes independently of readiness; narrated farewell does not',()=>{
 for(const text of ['Understood. Keeping it quiet. Goodbye.','I do not have the paperwork. Goodbye.','Thanks, James. Goodbye.']){
  assert.equal(endIntent(text),true);const s=add(base(),text);assert.equal(s.state,'CLOSING_PENDING');assert.equal(readiness(s.intake).ready,false);
  assert.equal(add(s,'Have a good day.','persona').state,'CLOSING_PENDING');
  assert.throws(()=>add(s,'Another fact'),/not accepting/);
 }
 for(const text of ['My ex said goodbye yesterday.','The letter says "Goodbye."','He said goodbye. I need help.'])assert.equal(endIntent(text),false);
});

test('brief omits conversational filler while preserving meaningful negatives',()=>{
 let s=answer('What paperwork do you have?','No.');s=add(s,'Right. Okay. Thanks.');
 assert.match(JSON.stringify(brief(s.intake)),/No/);assert.doesNotMatch(JSON.stringify(brief(s.intake)),/Right|Okay|Thanks/);
});
