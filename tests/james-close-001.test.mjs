import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyIntake,applyTurn,view,receipt,CURRENT_JAMES_PERSONA_ID} from '../lib/james-canary/state.ts';
import {confirmBrief} from '../lib/james-canary/structured-brief.ts';
import {isFinalFarewell,playbackAllowsClose,cancelWebsiteClose,enqueueClosingMutation} from '../lib/james-canary/closing.ts';
const base=()=>({id:'17e1b181-d4fa-42eb-8209-cad30ef97880',browserId:'browser',clientLabel:'fictional-close-test',createdAt:new Date().toISOString(),revision:0,stateHash:'initial',personaId:CURRENT_JAMES_PERSONA_ID,config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},websiteClosing:{policy:'JAMES-CLOSE-001'},receipts:[]});
let serial=0;
const turn=(s,content,role='user')=>receipt(s,applyTurn(s,{id:String(++serial),role,content}),{test:content});
function complete(){
 let s=base();
 for(const [q,a] of [
  ['What happened?','My landlord shut off my water.'],['When did this happen?','September 30th.'],
  ['Where did this happen?','Phoenix.'],['What are you hoping the attorney can help you with?','I want help understanding my options.'],
  ['What is your full name?',"It's Avery Sample."],['Your name is Avery Sample. Is that correct?','Yes.'],
  ['What is your callback phone number?','480-555-0194.'],['Your callback number is four eight zero, five five five, zero one nine four. Is that correct?','Yes.'],
  ['What is your email address?','avery at example.test'],['Your email is avery at example dot test. Is that correct?','Yes.'],
 ]){s=turn(s,q,'persona');s=turn(s,a);}return s;
}
const recap=s=>turn(turn(s,'Your landlord shut off your water in Phoenix on September 30th. Is that accurate?','persona'),'Yes, that is correct.');
const wrap=s=>turn(turn(s,'Before we wrap up, is there anything else you want to make sure I have?','persona'),"No, that's everything.");
test('natural factual recap and completeness permit one farewell without hangup permission',()=>{
 let s=wrap(recap(complete()));assert.equal(s.state,'ACTIVE');
 assert.ok(s.websiteClosing.recap);assert.ok(s.websiteClosing.complete);
 s=turn(s,'Thank you for walking me through everything. Take care.','persona');
 assert.equal(s.state,'CLOSING_PENDING');assert.equal(s.websiteClosing.reason,'COMPLETED_INTAKE');
 assert.equal(s.providerRelease,undefined);assert.equal(s.demoEmail,undefined);
 assert.equal(s.turns.some(t=>/may I end|okay if I end/.test(t.content)),false);
});
test('brief confirmation is not itself closing or email consent; nothing else is not sufficient either',()=>{
 let s=complete();s=confirmBrief(s,view(s).intakeBrief.hash);
 assert.equal(s.state,'ACTIVE');assert.equal(s.websiteClosing.farewellTurnId,undefined);
 s=turn(s,'Thank you. Take care.','persona');assert.equal(s.state,'ACTIVE');
 let other=wrap(complete());other=turn(other,'Thank you. Take care.','persona');assert.equal(other.state,'ACTIVE');
});
test('UI brief review can replace spoken recap, but never individual contact verification',()=>{
 let s=complete();s=confirmBrief(s,view(s).intakeBrief.hash);s=wrap(s);
 s=turn(s,'Thank you. Take care.','persona');assert.equal(s.state,'CLOSING_PENDING');
 let incomplete=base();incomplete=turn(incomplete,'My landlord shut off my water.');incomplete=recap(incomplete);incomplete=wrap(incomplete);
 incomplete=turn(incomplete,'Thank you. Take care.','persona');assert.equal(incomplete.state,'ACTIVE');
});
test('wait, correction, new fact and question cancel pending farewell and remain accepted evidence',()=>{
 for(const interruption of ['Wait, not yet.','Actually, it was October 1st, not September 30th.','I also have messages from my landlord.','What is the office number?']){
  let s=turn(wrap(recap(complete())),'Thank you. Take care.','persona');assert.equal(s.state,'CLOSING_PENDING');
  s=turn(s,interruption);assert.equal(s.state,'ACTIVE');assert.equal(s.websiteClosing.farewellTurnId,undefined);assert.equal(s.turns.at(-1).content,interruption);
  s=turn(s,'Of course. Take your time.','persona');assert.equal(s.state,'ACTIVE');
 }
});
test('explicit visitor departure permits limited intake, but spoken goodbye alone cannot close it',()=>{
 for(const ending of ['Thanks, James. Goodbye.','I need to go.','Please end the call.']){
  let s=turn(base(),ending);assert.equal(s.state,'ACTIVE');
  s=turn(s,'Thank you for your time. Take care.','persona');assert.equal(s.state,'CLOSING_PENDING');assert.equal(s.websiteClosing.reason,'VISITOR_DEPARTURE');
 }
 assert.equal(turn(base(),'Take care.','persona').state,'ACTIVE');
 for(const text of ["That's all, thanks.","No, nothing else.","We're done."]){
  const s=turn(turn(base(),text),'Thank you. Take care.','persona');assert.equal(s.state,'ACTIVE',text);
 }
});
test('no question, quoted example or conditional farewell is a close command',()=>{
 for(const text of ['Is it okay if I end the call?','If you are done, take care.','He said "Goodbye."','Take care. Anything else?','Please say goodbye.'])assert.equal(isFinalFarewell(text),false,text);
 assert.equal(isFinalFarewell('Thanks, Avery. Take care.'),true);
});
test('completed recap may follow completeness, without forcing another completeness ritual',()=>{
 let s=complete();s=confirmBrief(s,view(s).intakeBrief.hash);s=wrap(s);s=recap(s);
 s=turn(s,'Thank you. Take care.','persona');assert.equal(s.state,'CLOSING_PENDING');
});
test('exact owner legal-pad example accepts no-corrections without losing completeness',()=>{
 let s=wrap(complete());
 s=turn(s,'Take a moment to look over the legal pad. Is anything missing or incorrect?','persona');
 s=turn(s,'No, it looks right.');
 assert.ok(s.websiteClosing.complete);assert.ok(s.websiteClosing.recap);
 s=turn(s,'Thanks for walking me through everything, Avery. Take care.','persona');assert.equal(s.state,'CLOSING_PENDING');
 let negative=wrap(complete());negative=turn(negative,'Your landlord shut off water in Phoenix on September 30th. Is that correct?','persona');negative=turn(negative,'No.');
 negative=turn(negative,'Take care.','persona');assert.equal(negative.state,'ACTIVE');
 let needsCorrection=wrap(complete());needsCorrection=turn(needsCorrection,'Take a moment to look over the legal pad. Is anything missing or incorrect?','persona');
 needsCorrection=turn(needsCorrection,'Yes.');needsCorrection=turn(needsCorrection,'Take care.','persona');assert.equal(needsCorrection.state,'ACTIVE');
});
test('a failed begin-close can be retried, but failed finalized-turn persistence remains blocking',async()=>{
 const queue={current:Promise.resolve()};let attempts=0;
 await assert.rejects(enqueueClosingMutation(queue,async()=>{attempts++;throw Error('temporary close failure');}),/temporary/);
 await enqueueClosingMutation(queue,async()=>{attempts++;});assert.equal(attempts,2);
 const failed={current:Promise.reject(Error('turn persistence failed'))};
 await assert.rejects(enqueueClosingMutation(failed,async()=>{attempts++;}),/turn persistence/);
 await assert.rejects(failed.current,/turn persistence/);assert.equal(attempts,2);
});
test('duplicate finalized farewell event is idempotent and never creates another farewell',()=>{
 const before=wrap(recap(complete()));const farewell={id:'exact-final-farewell',role:'persona',content:'Thank you. Take care.'};
 const once=applyTurn(before,farewell),twice=applyTurn(once,farewell);
 assert.equal(twice,once);assert.equal(twice.turns.filter(t=>t.id===farewell.id).length,1);
 assert.equal(twice.websiteClosing.farewellTurnId,farewell.id);assert.equal(twice.state,'CLOSING_PENDING');
});
test('speech cancellation during in-flight begin-close is serialized before correction, never a CAS race',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const queue={current:Promise.resolve()},events=[];let revision=0;
 const begin=enqueueClosingMutation(queue,async()=>{const read=revision;events.push('begin-read');await gate;assert.equal(revision,read);revision++;events.push('begin-saved');});
 await Promise.resolve();
 const cancelled=queue.current.then(async()=>{const read=revision;events.push('cancel-read');assert.equal(revision,read);revision++;events.push('cancel-saved');});queue.current=cancelled;
 queue.current=queue.current.then(async()=>{events.push('correction-saved');revision++;});
 release();await begin;await queue.current;
 assert.deepEqual(events,['begin-read','begin-saved','cancel-read','cancel-saved','correction-saved']);assert.equal(revision,3);
});
test('raw speech cancels the transport candidate, without claiming provider closure or discarding facts',()=>{
 let s=turn(wrap(recap(complete())),'Take care.','persona');const facts=structuredClone(s.intake.facts);
 cancelWebsiteClose(s);assert.equal(s.state,'ACTIVE');assert.equal(s.websiteClosing.farewellTurnId,undefined);assert.deepEqual(s.intake.facts,facts);
});
test('audio drain requires this turn audible, two seconds measured quiet, no speech or newer interruption',()=>{
 const input={now:10000,finalizedAt:7000,turnStartedAt:5000,lastSoundAt:7500,quietSince:7800,running:true,personaSpeaking:false,visitorSpeaking:false,epoch:2,expectedEpoch:2};
 assert.equal(playbackAllowsClose(input),true);
 for(const patch of [{lastSoundAt:0},{lastSoundAt:4000},{quietSince:null},{quietSince:9000},{finalizedAt:9500},{running:false},{personaSpeaking:true},{visitorSpeaking:true},{epoch:3}])assert.equal(playbackAllowsClose({...input,...patch}),false,JSON.stringify(patch));
});
