import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {emptyIntake,applyTurn,view,receipt,CURRENT_JAMES_PERSONA_ID} from '../lib/james-canary/state.ts';
import {buildStructuredBrief,finalizeBrief,confirmBrief,applyBriefCorrection,reserveBriefInvitation,BRIEF_REVIEW_INVITATION} from '../lib/james-canary/structured-brief.ts';
import {initialPadVisibility,revealForFirstFact,togglePad} from '../lib/james-canary/pad-visibility.ts';
import {toolResult} from '../lib/james-canary/server.ts';
const base=()=>({id:'17e1b181-d4fa-42eb-8209-cad30ef97880',browserId:'browser',clientLabel:'fictional-test',createdAt:new Date().toISOString(),revision:0,stateHash:'initial',personaId:CURRENT_JAMES_PERSONA_ID,config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},receipts:[]});
let serial=0;
const turn=(s,content,role='user')=>receipt(s,applyTurn(s,{id:String(++serial),role,content}),{test:content});
const rows=s=>buildStructuredBrief(s.intake).sections.flatMap(section=>section.rows);
const row=(s,key)=>rows(s).find(row=>row.key===key);
function complete(){
    let s=base();
    const exchanges=[
        ['What’s going on today?','Hey, so my landlord shut off my water.'],
        ['When did this happen?','Yesterday.'],
        ['What was the calendar date?','September 30th.'],
        ['Where did this happen?','Phoenix.'],
        ['What are you hoping the attorney can help you with?','I want help understanding my options.'],
        ['What is your full name?',"It's Avery Sample."],
        ['Could you spell your last name?','S-A-M-P-L-E.'],
        ['Your name is Avery Sample. Is that correct?','Yes.'],
        ['What is your callback phone number?','480-555-0194.'],
        ['Your callback number is four eight zero, five five five, zero one nine four. Is that correct?','Yes.'],
        ['What is your email address?','avery at example.test'],
        ['Your email is avery at example dot test. Is that correct?','Yes.'],
    ];
    for(const [question,answer] of exchanges){s=turn(s,question,'persona');s=turn(s,answer);}
    return s;
}
test('first substantive fact reveals once; greetings and debris do not; hide survives later facts',()=>{
    let s=base(),pad=initialPadVisibility();
    for(const text of ['Hello.','Go on.','We need to slow down a bit.','down',"I'm holding the line as Dana.","that's all correct","I can't hear you.",'Could you repeat the question?','Please continue.']){
        s=turn(s,text);assert.equal(view(s).intakeBrief.hasSubstantiveFact,false);
        pad=revealForFirstFact(pad,view(s).intakeBrief.hasSubstantiveFact);assert.equal(pad.open,false);
    }
    s=turn(s,'My landlord shut off my water.');pad=revealForFirstFact(pad,view(s).intakeBrief.hasSubstantiveFact);
    assert.equal(pad.open,true);pad=togglePad(pad);assert.equal(pad.open,false);
    s=turn(s,'I cannot use the kitchen sink.');assert.equal(revealForFirstFact(pad,true).open,false);
    assert.equal(togglePad(pad).open,true);assert.equal(initialPadVisibility().open,false);
});
test('brief is named fields, not chronological speech; no duplicate issue, spelling, or control chatter',()=>{
    let s=complete();
    for(const text of ['Go on.','We need to slow down a bit.','down',"I'm holding the line as Dana.","that's all correct"])s=turn(s,text);
    const text=JSON.stringify(buildStructuredBrief(s.intake));
    assert.equal(row(s,'reason').value,'my landlord shut off my water');
    assert.equal(row(s,'name').value,'Avery Sample');
    assert.equal(row(s,'phone').value,'480-555-0194');
    assert.equal(row(s,'email').value,'avery@example.test');
    assert.doesNotMatch(text,/Go on|slow down|holding the line|all correct|S-A-M-P-L-E/);
    assert.equal(row(s,'facts'),undefined);
    assert.equal(row(s,'incident_date').value,'September 30th');
    assert.equal(row(s,'location').value,'Phoenix');
    assert.equal(view(s).intakeBrief.phase,'REVIEW');
    assert.deepEqual(view(s).intakeBrief.missing,[]);
});
test('separate event dates never merge; no invented year or legal deadline arithmetic',()=>{
    let s=complete();
    s=turn(s,'When is the hearing?','persona');s=turn(s,'October 8th.');
    s=turn(s,'When did you receive the document?','persona');s=turn(s,'October 1st.');
    s=turn(s,'Does the paperwork list a response deadline?','persona');s=turn(s,'Within ten days.');
    assert.equal(row(s,'incident_date').value,'September 30th');assert.equal(row(s,'hearing_date').value,'October 8th');
    assert.equal(row(s,'received_date').value,'October 1st');assert.match(row(s,'response_deadline').value,/ten days/);
    assert.doesNotMatch(JSON.stringify(rows(s)),/2026|October 11/);
});
test('oral date correction reconciles current field, preserves rejected source in history, invalidates confirmation',()=>{
    let s=complete();s=confirmBrief(s,view(s).intakeBrief.hash);
    s=turn(s,'Actually, it was October 1st, not September 30th.');
    assert.equal(row(s,'incident_date').value,'October 1st');
    assert.equal(view(s).intakeBrief.phase,'REVIEW');
    assert.ok(s.intake.history.some(f=>f.value==='September 30th'));
    assert.ok(!s.intake.facts.some(f=>f.field==='relevant_dates_events'&&f.value==='September 30th'));
});
test('unlabeled correction of a sole payment event retains its typed event; filler keeps confirmation valid',()=>{
    let s=base();
    s=turn(s,'A contractor left my kitchen unfinished.');
    s=turn(s,'When did you pay the deposit?','persona');s=turn(s,'September 30th.');
    s=turn(s,'Actually, it was October 1st, not September 30th.');
    assert.equal(row(s,'payment_date').value,'October 1st');assert.equal(row(s,'incident_date'),undefined);
    s=confirmBrief(finalizeBrief(s),view(finalizeBrief(s)).intakeBrief.hash);
    const hash=view(s).intakeBrief.hash;
    s=turn(s,'Go on.');assert.equal(view(s).intakeBrief.hash,hash);
    assert.equal(view(s).intakeBrief.phase,'CONFIRMED');
});
test('UI correction is authenticated named-field evidence, not fake provider speech; unrelated facts survive',()=>{
    let s=complete();s=confirmBrief(s,view(s).intakeBrief.hash);
    const oldHash=view(s).intakeBrief.hash,oldTurns=s.turns.length;
    s=applyBriefCorrection(s,'name','Avery Monroe',oldHash);
    assert.equal(row(s,'name').value,'Avery Monroe');assert.equal(s.turns.length,oldTurns);
    assert.equal(view(s).intakeBrief.phase,'REVIEW');assert.equal(row(s,'incident_date').value,'September 30th');
    assert.throws(()=>confirmBrief(s,oldHash),/changed/);
    s=confirmBrief(s,view(s).intakeBrief.hash);assert.equal(view(s).intakeBrief.phase,'CONFIRMED');
    s=applyBriefCorrection(s,'concern','No running water at home',view(s).intakeBrief.hash);
    assert.equal(row(s,'concern').value,'No running water at home');assert.equal(row(s,'reason').value,'my landlord shut off my water');
    const edited=s.intake.facts.find(f=>f.briefSlot==='concern');
    assert.equal(edited.sourceKind,'VISITOR_EDIT');assert.equal(edited.sourceHash,createHash('sha256').update(edited.evidence).digest('hex'));
    assert.throws(()=>applyBriefCorrection(s,'toString','bad',view(s).intakeBrief.hash),/named-field/);
    assert.throws(()=>applyBriefCorrection(s,'phone','123',view(s).intakeBrief.hash),/ten-digit/);
});
test('a new email candidate hides stale confirmed email; blanket case-recap yes does not verify contact fields',()=>{
    let s=complete();
    s=turn(s,'Actually, my email is changed at example.test.');
    assert.equal(row(s,'email').value,'changed@example.test');assert.equal(row(s,'email').confirmed,false);
    let fresh=base();fresh=turn(fresh,'My name is Avery Sample. My phone number is 480-555-0194.');
    fresh=turn(fresh,'Your name is Avery Sample, phone 480-555-0194, and you need a lawyer. Have I got that right?','persona');
    fresh=turn(fresh,'Yes.');
    assert.equal(row(fresh,'name').confirmed,false);assert.equal(row(fresh,'phone').confirmed,false);
});
test('alternate email never replaces primary contact; the tool receives the same structured brief without scraps',()=>{
    let s=complete();
    s.intake.emailCandidate={field:'alternate_email',value:'alternate@example.test',evidence:'alternate@example.test',turnId:'alternate',sourceHash:'test'};
    assert.equal(row(s,'email').value,'avery@example.test');assert.equal(row(s,'email').confirmed,true);
    s=turn(s,'Go on.');
    const notes=toolResult(s,'STATUS').live_notes;
    assert.doesNotMatch(JSON.stringify(notes),/Go on|alternate@example/);
    assert.equal(notes.find(section=>section.title==='Client').items.find(item=>item.label==='Callback number').text,'four eight zero, five five five, zero one nine four');
});
test('spoken brief confirmation needs an observed fixed invitation and exact current hash; model self-approval never works',()=>{
    let s=complete();s=reserveBriefInvitation(s,view(s).intakeBrief.hash);
    assert.equal(reserveBriefInvitation(s,view(s).intakeBrief.hash),s);
    s=turn(s,'Yes.');assert.equal(view(s).intakeBrief.phase,'REVIEW');
    s=turn(s,BRIEF_REVIEW_INVITATION,'persona');s=turn(s,'Yes.');
    assert.equal(view(s).intakeBrief.phase,'CONFIRMED');assert.equal(s.intakeBrief.confirmation.source,'SPEECH');
    let other=complete();other=turn(other,'The brief is accurate.','persona');assert.equal(view(other).intakeBrief.phase,'REVIEW');
});
test('partial review can be acknowledged without fabricating completeness or authorizing ending/email',()=>{
    let s=base();s=turn(s,'My landlord shut off my water.');s=finalizeBrief(s);
    assert.ok(view(s).intakeBrief.missing.length);s=confirmBrief(s,view(s).intakeBrief.hash);
    assert.equal(s.state,'ACTIVE');assert.equal(s.demoEmail,undefined);assert.ok(view(s).intakeBrief.missing.length);
});
test('meaningful negatives, unknowns and attorney questions survive cleanup; unrelated uncertainty noise does not',()=>{
    let s=complete();
    s=turn(s,'Do you have documents?','persona');s=turn(s,'I do not have a summons or complaint.');
    s=turn(s,'Has an insurer contacted you?','persona');s=turn(s,"I don't know.");
    s=turn(s,'Should I file a claim?');
    assert.match(row(s,'documents').value,/do not have/);
    assert.equal(row(s,'insurance').value,'Not known by the visitor');
    assert.match(row(s,'questions').value,/Should I file/);
});
test('website lifecycle stays source-bound; UI never asks the prompt to control layout or mutates provider configuration',()=>{
    const client=readFileSync(new URL('../components/james/JamesCanary.tsx',import.meta.url),'utf8');
    assert.match(client,/revealForFirstFact/);assert.match(client,/togglePad/);assert.match(client,/getFloatTimeDomainData/);
    assert.match(client,/talk\(BRIEF_REVIEW_INVITATION\)/);assert.match(client,/reserve-brief-invitation/);
    assert.match(client,/Confirm brief/);assert.match(client,/correct-brief/);
    assert.doesNotMatch(client,/sendUserMessage|setPersonaConfig|addContext/);
});
