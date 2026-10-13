import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTurn,emptyIntake,sha,view} from '../lib/james-canary/state.ts';

const successfulQuestion='I’m sorry you’re dealing with this tonight. Your intake gives the firm the facts, timing, and your license concern so it can evaluate the inquiry and follow up through its normal process. I can’t give legal advice or promise a specific callback time, but I’ll make sure the license issue stands out. May I get your full name and a reliable phone number first? ';
const failedQuestion='Thanks, that helps. I’m sorry—being processed and released after field and breath tests is stressful. Your concern about the license and getting this logged makes sense. I’ll keep this brief. What’s your full name, the best callback number, and the best email address? ';
const latestQuestion='That’s helpful, and it’s okay if the details are fuzzy right now. Can I get your name and a good callback number so the firm can follow up on that paperwork? ';
const failedReply='Michael Carter 602-555-0138 and michaelcarter@email.com';
const latestReply='Sure. Michael Carter, 602-555-0138. And email is michael.carter at email.com.';
let sequence=0;
function base(candidate=true){return {id:'offline-contact-list',browserId:'offline',clientLabel:'offline',createdAt:'2026-10-13T00:00:00Z',revision:0,stateHash:'offline',
    personaId:candidate?'016e2c66-166b-43bd-8ebf-70b56c46575c':'8a991c93-0c95-42c5-8c22-a67428946eb8',config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},
    ...(candidate?{websiteClosing:{policy:'JAMES-CLOSE-001',runtimeOwned:true}}:{}),receipts:[]};}
function say(s,role,content){return applyTurn(s,{id:'contact-list-'+(++sequence),role,content});}
function row(s,key){return view(s).intakeBrief.sections.flatMap(section=>section.rows).find(value=>value.key===key);}
function replay(text,question=failedQuestion,candidate=true){return say(say(base(candidate),'persona',question),'user',text);}
function assertName(s,name,text){
    assert.equal(row(s,'name').value,name);assert.equal(row(s,'name').confirmed,false);
    const fact=s.intake.facts.findLast(f=>f.field==='visitor_preferred_identifier');
    assert.equal(fact.value,name);assert.equal(fact.evidence,name);assert.equal(fact.sourceHash,sha(text));
    assert.equal(fact.turnId,s.turns.at(-1).id);assert.equal(fact.status,'VISITOR_REPORTED');
    assert.ok(s.intake.history.some(f=>f.id===fact.id));assert.equal(s.turns.at(-1).content,text);
}

test('successful 9318906a separate name answer remains stable through later phone and email replies',()=>{
    let s=replay('Yeah, Michael Carter.',successfulQuestion);assertName(s,'Michael Carter','Yeah, Michael Carter.');
    s=say(s,'user','602-555-0138 and email to if you need it.');s=say(s,'user','michael.carter@email.com.');
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'phone').value,'602-555-0138');
    assert.equal(row(s,'email').value,'michael.carter@email.com');assert.equal(row(s,'name').confirmed,false);
});

for(const [label,question,text,email]of [['failed313863f8',failedQuestion,failedReply,'michaelcarter@email.com'],
    ['latest74208b68',latestQuestion,latestReply,'michael.carter@email.com']]){
    test('actual '+label+' direct visitor contact list projects the complete independent name',()=>{
        const s=replay(text,question);assertName(s,'Michael Carter',text);
        assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,email);
        assert.equal(row(s,'phone').confirmed,false);assert.equal(row(s,'email').confirmed,false);
        const name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
        assert.deepEqual(name.questionBinding,{text:question,hash:sha(question),intent:'identity'});
        assert.ok(!s.intake.facts.some(f=>f.turnId===name.turnId&&['material_facts','uncertainties'].includes(f.field)),
            'complete source contact lists do not produce case residue');
    });
}

for(const [name,list,email]of [
    ['avery stone','avery stone 602-555-0138 avery@example.test','avery@example.test'],
    ['MORGAN HALE','MORGAN HALE, 6025550138, morgan@example.test','morgan@example.test'],
    ['aNa-María O’Neill','aNa-María O’Neill; (602) 555-0138; ana@example.test','ana@example.test'],
    ["mary anne o'neill","mary anne o'neill 602 555 0138 and mary@example.test",'mary@example.test'],
    ['josé maría del río','josé maría del río 602.555.0138 and jose@example.test','jose@example.test'],
    ['rob','sure rob 602-555-0138 email is rob at example dot test','rob@example.test'],
    ['Νίκος Παπαδόπουλος','Νίκος Παπαδόπουλος 602-555-0138 email nikos@example.test','nikos@example.test'],
    ['jordan blake','jordan blake phone is 602-555-0138 email address is jordan@example.test','jordan@example.test'],
]){
    test('bounded varied source name before known contact values: '+list,()=>{
        const s=replay(list);assertName(s,name,list);
        assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,email);
    });
}

for(const [name,text,key,value]of [
    ['avery stone','avery stone 602-555-0138','phone','602-555-0138'],
    ['avery stone','avery stone avery@example.test','email','avery@example.test'],
    ['avery stone','avery stone email is avery at example dot test','email','avery@example.test'],
]){
    test('one-contact list still has an independent caller name: '+text,()=>{
        const s=replay(text);assertName(s,name,text);assert.equal(row(s,key).value,value);
    });
}

test('contact-list name extraction preserves independent case facts after the contact list',()=>{
    const text='avery stone 602-555-0138 and avery@example.test. I was arrested earlier.';
    const s=replay(text);assertName(s,'avery stone',text);
    assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,'avery@example.test');
    assert.match(row(s,'reason').value,/arrested earlier/i);
    assert.ok(s.intake.facts.some(f=>f.field==='visitor_reported_reason'&&text.includes(f.evidence)));
});

test('a changed name in a contact list supersedes only the active identifier and preserves history',()=>{
    let s=say(base(),'user','My name is Avery Stone.');const old=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    s=say(s,'persona',failedQuestion);const text='jordan blake 602-555-0138 and jordan@example.test';s=say(s,'user',text);
    assertName(s,'jordan blake',text);
    assert.equal(s.intake.facts.filter(f=>f.field==='visitor_preferred_identifier').length,1);
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').supersedes,old.id);
    assert.ok(s.intake.history.some(f=>f.id===old.id));
});

test('contact-list repeat cannot downgrade an unchanged verified identifier',()=>{
    let s=say(base(),'user','My name is Avery Stone.');s=say(s,'persona','Is your name Avery Stone correct?');s=say(s,'user','Yes.');
    const old=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');assert.equal(row(s,'name').confirmed,true);
    s=say(s,'persona',failedQuestion);s=say(s,'user','avery stone 602-555-0138 and avery@example.test');
    assert.equal(row(s,'name').value,'Avery Stone');assert.equal(row(s,'name').confirmed,true);
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').id,old.id);
});

for(const [question,text]of [
    [failedQuestion,'michael.carter@email.com'],[failedQuestion,'michaelcarter@email.com'],
    [failedQuestion,'michael.carter at email.com'],[failedQuestion,'michael carter at email dot com'],
    [failedQuestion,'email is michael.carter at email.com'],[failedQuestion,'602-555-0138 michael.carter@email.com'],
    [failedQuestion,'Sure. 602-555-0138. And email is michael.carter at email.com.'],
    [failedQuestion,'unknown 602-555-0138 and unknown@example.test'],
    [failedQuestion,'not sure 602-555-0138 and avery@example.test'],
    [failedQuestion,'i decline 602-555-0138'],[failedQuestion,'i would rather not say 602-555-0138'],
    [failedQuestion,'His name is Avery Stone, 602-555-0138.'],
    [failedQuestion,'If my name were avery stone, 602-555-0138, would that work?'],
    [failedQuestion,'avery stone or jordan blake 602-555-0138'],
    [failedQuestion,'avery stone / jordan blake, 602-555-0138'],
    [failedQuestion,'i was arrested earlier 602-555-0138'],
    ['What happened with your license?','license suspended 602-555-0138'],
    ['What is the other driver’s full name and phone number?','avery stone 602-555-0138'],
    ['What is your full name and your husband’s full name?','avery stone 602-555-0138'],
    ['What is your full name and where did this happen?','mesa 602-555-0138'],
]){
    test('no visitor identity invented from contact-only or ambiguous speech: '+text,()=>{
        const s=replay(text,question);assert.equal(row(s,'name').sourceIds.length,0);
        assert.ok(!s.intake.facts.some(f=>f.field==='visitor_preferred_identifier'));
    });
}

test('canonical legacy James remains unchanged for the exact previously failed contact list',()=>{
    const s=replay(failedReply,failedQuestion,false);
    assert.equal(row(s,'name').sourceIds.length,0);assert.equal(row(s,'phone').value,'602-555-0138');
    assert.equal(row(s,'email').value,'michaelcarter@email.com');
});

for(const text of ['avery stone 602-555-0138 and avery at example dot test',
    'avery stone 6025550138 avery at example.test']){
    test('an independent known phone prevents a bare spoken-email list from being mistaken for email-only speech: '+text,()=>{
        const s=replay(text);assertName(s,'avery stone',text);
        assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,'avery@example.test');
    });
}

test('a bare phone plus spoken email still has no independent visitor-name span',()=>{
    const s=replay('602-555-0138 and avery at example dot test');
    assert.equal(row(s,'name').sourceIds.length,0);
    assert.ok(!s.intake.facts.some(f=>f.field==='visitor_preferred_identifier'));
});

for(const text of ['michael 6025550138 at email dot com','avery 602-555-0138 at example dot test']){
    test('digits inside a space-separated spoken email local part do not invent an independent name: '+text,()=>{
        const s=replay(text);
        assert.equal(row(s,'name').sourceIds.length,0);
        assert.ok(!s.intake.facts.some(f=>f.field==='visitor_preferred_identifier'));
    });
}
