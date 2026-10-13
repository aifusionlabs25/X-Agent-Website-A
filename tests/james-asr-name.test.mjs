import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTurn,emptyIntake,sha,view} from '../lib/james-canary/state.ts';

const actualQuestion='I can’t promise a specific person or callback time. I can record your name, phone number, and email so the firm can evaluate the intake and follow up through its approved process. May I start with your full name? ';
const actualReply='uh yeah michael carter my number is 602-555-0138 and my email is michael.carter@email.com';
let sequence=0;
function base(candidate=true){return {id:'offline-asr-name',browserId:'offline',clientLabel:'offline',createdAt:'2026-10-13T00:00:00Z',revision:0,stateHash:'offline',
    personaId:candidate?'016e2c66-166b-43bd-8ebf-70b56c46575c':'8a991c93-0c95-42c5-8c22-a67428946eb8',config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},
    ...(candidate?{websiteClosing:{policy:'JAMES-CLOSE-001',runtimeOwned:true}}:{}),receipts:[]};}
function say(s,role,content){return applyTurn(s,{id:'asr-name-'+(++sequence),role,content});}
function row(s,key){return view(s).intakeBrief.sections.flatMap(section=>section.rows).find(value=>value.key===key);}
function replay(content,question=actualQuestion,candidate=true){return say(say(base(candidate),'persona',question),'user',content);}
function assertReportedName(s,expected,text){
    const fact=s.intake.facts.findLast(f=>f.field==='visitor_preferred_identifier');
    assert.equal(row(s,'name').value,expected,'name follows the actual visitor span, not inferred capitalization');
    assert.equal(row(s,'name').confirmed,false);
    assert.equal(fact.value,expected);assert.equal(fact.evidence,expected);
    assert.equal(fact.status,'VISITOR_REPORTED');assert.equal(fact.sourceHash,sha(text));
    assert.equal(fact.turnId,s.turns.at(-1).id);assert.equal(s.turns.at(-1).content,text);
    assert.ok(text.includes(fact.evidence));assert.ok(s.intake.history.some(f=>f.id===fact.id));
}

test('actual 82021dcf lowercase unpunctuated name plus both contacts projects all three independent fields',()=>{
    const s=replay(actualReply);assertReportedName(s,'michael carter',actualReply);
    assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,'michael.carter@email.com');
    assert.equal(row(s,'phone').confirmed,false);assert.equal(row(s,'email').confirmed,false);
    const name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    assert.deepEqual(name.questionBinding,{text:actualQuestion,hash:sha(actualQuestion),intent:'identity'});
    assert.ok(!s.intake.facts.some(f=>f.turnId===name.turnId&&['material_facts','uncertainties'].includes(f.field)),
        'an entirely name/contact reply is not projected as malformed case evidence');
});

const names=['rob','avery stone','MORGAN HALE','aNa-María O’Neill',"mary anne o'neill",'josé maría del río','Νίκος Παπαδόπουλος'];
for(const name of names){
    for(const format of [name,'uh yeah '+name,'right it is '+name]){
        test('case-independent standalone source name: '+format,()=>assertReportedName(replay(format),name,format));
    }
}

for(const [name,suffix,expectedContacts] of [
    ['avery stone','my number is 602-555-0138',{phone:'602-555-0138'}],
    ['MORGAN HALE','my cell is 602-555-0138',{phone:'602-555-0138'}],
    ['aNa-María O’Neill','my phone number is 602-555-0138',{phone:'602-555-0138'}],
    ['rob','my email is avery.sample@example.test',{email:'avery.sample@example.test'}],
    ['josé maría del río','my number is 602-555-0138 and my email is avery.sample@example.test',{phone:'602-555-0138',email:'avery.sample@example.test'}],
    ["mary anne o'neill",'my email is avery.sample@example.test and my phone is 602-555-0138',{phone:'602-555-0138',email:'avery.sample@example.test'}],
]){
    const text='uh yeah '+name+' '+suffix;
    test('personal-contact markers bound the name without punctuation: '+text,()=>{
        const s=replay(text);assertReportedName(s,name,text);
        for(const [key,value]of Object.entries(expectedContacts)){assert.equal(row(s,key).value,value);assert.equal(row(s,key).confirmed,false);}
    });
}

test('case-independent name extraction preserves independent visitor case facts after personal contacts',()=>{
    const text='uh yeah avery stone my number is 602-555-0138 and my email is avery.sample@example.test and I was arrested earlier.';
    const s=replay(text);assertReportedName(s,'avery stone',text);
    assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,'avery.sample@example.test');
    assert.match(row(s,'reason').value,/arrested earlier/i);
    assert.ok(s.intake.facts.some(f=>f.field==='visitor_reported_reason'&&text.includes(f.evidence)));
});

test('lowercase name correction supersedes the old identifier without erasing source history',()=>{
    let s=replay('uh yeah avery stone');const old=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    s=say(s,'persona','What is your full name?');s=say(s,'user','my name is jordan blake');
    assertReportedName(s,'jordan blake','my name is jordan blake');
    assert.equal(s.intake.facts.filter(f=>f.field==='visitor_preferred_identifier').length,1);
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').supersedes,old.id);
    assert.ok(s.intake.history.some(f=>f.id===old.id));
});

test('repeating a verified name in lowercase preserves the original verified evidence',()=>{
    let s=say(base(),'user','My name is Avery Stone.');
    s=say(s,'persona','Is your name Avery Stone, correct?');s=say(s,'user','Yes.');
    const old=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');assert.equal(row(s,'name').confirmed,true);
    s=say(s,'persona',actualQuestion);s=say(s,'user','uh yeah avery stone my number is 602-555-0138');
    assert.equal(row(s,'name').value,'Avery Stone');assert.equal(row(s,'name').confirmed,true);
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').id,old.id);
    assert.equal(row(s,'phone').value,'602-555-0138');
});

test('canonical legacy James remains unchanged for the actual lowercase contact reply',()=>{
    const s=replay(actualReply,actualQuestion,false);
    assert.equal(row(s,'name').sourceIds.length,0);assert.equal(row(s,'phone').value,'602-555-0138');
    assert.equal(row(s,'email').value,'michael.carter@email.com');
});

for(const [question,text]of [
    [actualQuestion,'understood'],[actualQuestion,'thanks'],[actualQuestion,'thank you'],[actualQuestion,'go ahead'],
    [actualQuestion,'unknown my number is 602-555-0138'],[actualQuestion,'not sure my number is 602-555-0138'],
    [actualQuestion,'i decline'],[actualQuestion,'i would rather not say'],[actualQuestion,'no name my number is 602-555-0138'],
    [actualQuestion,'i was arrested earlier'],[actualQuestion,'the police arrested me'],[actualQuestion,'what paperwork should i bring?'],
    [actualQuestion,'my email is michael.carter@email.com'],[actualQuestion,'his name is avery stone'],
    [actualQuestion,'rob or amy'],[actualQuestion,'avery stone or jordan blake'],
    [actualQuestion,'one two three four five'],
    ['What happened today?','uh yeah avery stone my number is 602-555-0138'],
    ['What is the other driver’s full name?','uh yeah avery stone'],
    ['What is your full name and your husband’s full name?','uh yeah avery stone'],
    ['What is your full name and where did this happen?','uh yeah mesa my number is 602-555-0138'],
]){
    test('case-insensitive parsing does not guess a name from nonidentity speech: '+question+' / '+text,()=>{
        const s=replay(text,question);
        assert.equal(row(s,'name').sourceIds.length,0);
        assert.ok(!s.intake.facts.some(f=>f.field==='visitor_preferred_identifier'));
    });
}

for(const [text,name]of [["I'm Avery Stone.",'Avery Stone'],["i'm avery stone",'avery stone'],
    ['i’m avery stone','avery stone'],['i am avery stone','avery stone']]){
    test('self-identification marker is not included in the saved source name: '+text,()=>{
        assertReportedName(replay(text,'What is your full name?'),name,text);
    });
}

for(const text of ["i'm not sure",'i’m in mesa',"i'm worried"]){
    test('self-identification grammar does not turn uncertainty or case state into a name: '+text,()=>{
        const s=replay(text,'What is your full name?');
        assert.equal(row(s,'name').sourceIds.length,0);
        assert.ok(!s.intake.facts.some(f=>f.field==='visitor_preferred_identifier'));
    });
}
