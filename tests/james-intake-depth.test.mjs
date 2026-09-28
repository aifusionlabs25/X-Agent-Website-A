import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyIntake,ingest,readiness,brief,spokenPhone,conversationGuidance} from '../lib/james-canary/state.ts';
import {toolResult} from '../lib/james-canary/server.ts';
const add=(s,text,prior='')=>ingest(s,{id:String(s.history.length)+text,role:'user',content:text},prior);
const contact=s=>add(s,'My name is Morgan Hale. My phone number is 480-555-0199. I decline email. I want help understanding my options.');
test('greetings and filler never become matter or satisfy reason, including sentence mixtures',()=>{
    for(const text of ['hello','hi','okay','thanks','Hello, James. Okay. Thanks.']) {
        const s=add(emptyIntake(),text);assert.equal(s.facts.length,0);assert.equal(readiness(s).checks.reason_matter,false);
        assert.ok(!brief(s).some(section=>section.title==='MATTER'));
    }
    const s=add(emptyIntake(),'Hello. My former business partner sued me.');
    assert.equal(s.facts.find(f=>f.field==='visitor_reported_reason').value,'My former business partner sued me');
});
test('generic facts and contact cannot satisfy personal-injury depth',()=>{
    let s=contact(add(emptyIntake(),'I was in a collision. The police gave me a report.'));
    assert.equal(readiness(s).ready,false);
    assert.deepEqual(readiness(s).missingIntents,['timing_location','injury_treatment','insurance_context']);
    s=add(s,'It happened this morning in Tempe.');
    s=add(s,'My neck hurts and I saw a doctor.');
    s=add(s,'An insurance adjuster called.');
    assert.equal(readiness(s).ready,true);
});
test('explicit unknown answers cover only their matter-aware gap and retain evidence',()=>{
    let s=contact(add(emptyIntake(),'I was arrested for DUI. I have a citation.'));
    for(const prior of ['What timing is relevant, or is it unknown?','Are there restrictions or conditions you are unsure about? Unknown is fine.'])s=add(s,'I do not know.',prior);
    assert.equal(readiness(s).ready,true);
    assert.ok(s.facts.some(f=>f.topic==='conditions'&&f.status==='NEEDS_CLARIFICATION'));
});
test('unverified civil intake needs distinct context and never implies practice acceptance',()=>{
    let s=contact(add(emptyIntake(),'My former business partner sued me. I received a complaint yesterday in Tempe.'));
    assert.equal(readiness(s).ready,false);
    assert.match(readiness(s).practiceScope,/UNVERIFIED/);
    s=add(s,'The complaint alleges unpaid invoices. My former partner emailed a demand. No hearing has been scheduled.');
    assert.equal(readiness(s).ready,true);
    assert.match(JSON.stringify(brief(s)),/UNVERIFIED/);
});
test('callback timing is deferred and is not handoff consent, outcome or a commitment',()=>{
    const s=add(emptyIntake(),'Will someone call me today?');
    assert.equal(s.handoff,'NOT_REQUESTED');
    assert.equal(s.facts.find(f=>f.field==='requested_next_step').value,'same-day callback requested');
    assert.equal(s.facts.find(f=>f.field==='client_questions').status,'DEFERRED_TO_FIRM');
    assert.equal(s.facts.find(f=>f.field==='requested_outcome'),undefined);
    const result=toolResult({intake:s,turns:[],state:'ACTIVE',config:{},revision:1},'REQUEST_HANDOFF');
    assert.equal(result.handoff_request_state,'NOT_REQUESTED');assert.equal(result.sent,false);
    assert.equal(result.conversation_guidance.handoff_truth.external_action_authorized,false);
    assert.equal(add(s,'Please prepare the summary for the firm.').handoff,'HANDOFF_REQUESTED');
});
test('phone canonical storage and deterministic speech have separate representations',()=>{
    const s=add(emptyIntake(),'My phone number is 480-555-0199.');
    assert.equal(s.facts[0].value,'4805550199');
    assert.equal(spokenPhone(s.facts[0].value),'four eight zero, five five five, zero one nine nine');
    assert.throws(()=>spokenPhone('480555'),/Canonical/);
    const g=conversationGuidance({intake:s,turns:[]});
    assert.equal(g.phone_speech[0].spoken,spokenPhone('4805550199'));
    assert.deepEqual(g,conversationGuidance(JSON.parse(JSON.stringify({intake:s,turns:[]}))));
});
test('legal question never counts as factual insurance context or authorizes advice',()=>{
    let s=contact(add(emptyIntake(),'I had a collision this morning in Tempe. No injuries.'));
    s=add(s,'Should I call the insurer first?');
    assert.equal(readiness(s).checks.insurance_context,false);
    assert.equal(s.facts.find(f=>f.field==='client_questions').status,'DEFERRED_TO_FIRM');
});
