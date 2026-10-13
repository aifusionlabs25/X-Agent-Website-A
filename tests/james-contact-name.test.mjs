import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTurn,emptyIntake,sha,view} from '../lib/james-canary/state.ts';

const question="That’s okay—we’ll note it as uncertain: you think something about your license was mentioned, but you don’t remember the details. You don’t need to reconstruct it tonight. To make sure the firm has a reliable way to follow up through its intake process, may I get your full name and a good callback number?";
const reply="Yeah, it's Michael Carter and my cell is 602-555-0138.";
const currentQuestion="I hear you—that word can definitely be alarming. I’ll note that the paperwork may have referenced a license suspension, but you’re not sure of the details. Before we wrap up, what’s your full name and a good number where the firm can reach you?";
const currentReply="Right, it's Michael Carter. My cell is 602-555-0138.";
let sequence=0;
function session(candidate=true){return {id:'offline-contact-name',browserId:'offline',clientLabel:'offline',createdAt:'2026-10-12T00:00:00Z',revision:0,stateHash:'offline',
    personaId:candidate?'016e2c66-166b-43bd-8ebf-70b56c46575c':'8a991c93-0c95-42c5-8c22-a67428946eb8',config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},
    ...(candidate?{websiteClosing:{policy:'JAMES-CLOSE-001',runtimeOwned:true}}:{}),receipts:[]};}
function say(s,role,content){return applyTurn(s,{id:'name-contact-'+(++sequence),role,content});}
function row(s,key){return view(s).intakeBrief.sections.flatMap(section=>section.rows).find(row=>row.key===key);}
function replay(answer=reply,prior=question,candidate=true){return say(say(session(candidate),'persona',prior),'user',answer);}

test('exact successful-demo combined name/cell reply projects a visitor-grounded unverified name and phone',()=>{
    const s=replay(),name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'phone').value,'602-555-0138');
    assert.equal(row(s,'name').confirmed,false);assert.equal(row(s,'phone').confirmed,false);
    assert.equal(name.evidence,'Michael Carter');assert.equal(name.sourceHash,sha(reply));
    assert.equal(name.turnId,s.turns.at(-1).id);
    assert.deepEqual(name.questionBinding,{text:question,hash:sha(question),intent:'identity'});
    assert.ok(s.turns.some(turn=>turn.content===reply),'raw visitor reply stays intact');
    assert.ok(s.intake.history.some(f=>f.field==='uncertainties'&&f.turnId===name.turnId),'old extraction evidence stays in private history');
    assert.ok(!s.intake.facts.some(f=>f.turnId===name.turnId&&['material_facts','uncertainties'].includes(f.field)),'pure contact reply is not a case uncertainty');
});

for(const text of ["Yeah, it’s Michael Carter and my cell is 602-555-0138.","It is Michael Carter and my phone number is 602-555-0138.","Michael Carter, my callback number is 602-555-0138."]){
    test('combined personal-contact wording: '+text,()=>assert.equal(row(replay(text),'name').value,'Michael Carter'));
}

test('combined name capture preserves existing email and case facts',()=>{
    let s=say(session(),'user','I was arrested earlier. My email is avery.sample@example.test.');
    const before=s.intake.facts.filter(f=>f.field!=='visitor_preferred_identifier'),email=s.intake.emailCandidate;
    s=say(s,'persona',question);s=say(s,'user',reply);
    for(const fact of before)assert.ok(s.intake.facts.some(f=>f.id===fact.id));
    assert.deepEqual(s.intake.emailCandidate,email);assert.equal(row(s,'name').value,'Michael Carter');
});

test('genuine replacement supersedes only the active name and retains historical evidence',()=>{
    let s=say(session(),'user','My name is Avery Stone.');const old=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    s=say(s,'persona',question);s=say(s,'user',reply);
    const names=s.intake.facts.filter(f=>f.field==='visitor_preferred_identifier');
    assert.equal(names.length,1);assert.equal(names[0].value,'Michael Carter');assert.equal(names[0].supersedes,old.id);
    assert.ok(s.intake.history.some(f=>f.id===old.id));
});

test('repeating an unchanged verified name with a phone does not downgrade its confirmation',()=>{
    let s=say(session(),'user','My name is Michael Carter.');
    s=say(s,'persona','Is your name Michael Carter, correct?');s=say(s,'user','Yes.');
    assert.equal(row(s,'name').confirmed,true);
    s=say(s,'persona',question);s=say(s,'user',reply);
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'name').confirmed,true);
});

test('legacy James does not acquire the candidate-only combined-contact repair',()=>{
    const s=replay(reply,question,false);assert.equal(row(s,'name').value,'Not yet provided');assert.equal(row(s,'phone').value,'602-555-0138');
});

for(const [prior,text] of [
    ['What happened today?',reply],
    ['What is the other driver’s full name and phone number?',reply],
    ['What is your full name and where did this happen?',reply],
    [question,'My email is michael.carter@example.test.'],
    [question,"His name is Michael Carter and my cell is 602-555-0138."],
    [question,'He said, "it’s Michael Carter and my cell is 602-555-0138."'],
    [question,'If it was Michael Carter and my cell was 602-555-0138, would that work?'],
    [question,'I would rather not provide my name. My cell is 602-555-0138.'],
]){
    test('no guessed name from ambiguous or non-identity reply: '+text,()=>assert.equal(row(replay(text,prior),'name').sourceIds.length,0));
}

test('James naming a caller followed by generic agreement cannot invent the visitor name',()=>{
    let s=say(session(),'persona','Thanks, Michael Carter, cell 602-555-0138.');s=say(s,'user','Yes.');
    assert.equal(row(s,'name').sourceIds.length,0);
});

for(const text of ['Unknown and my cell is 602-555-0138.','Not Sure and my cell is 602-555-0138.',"Yeah, it is Unknown and my cell is 602-555-0138."]){
    test('uncertain identity never becomes a capitalized name: '+text,()=>{
        const s=replay(text);assert.equal(row(s,'name').sourceIds.length,0);
        assert.equal(row(s,'phone').value,'602-555-0138');
        assert.ok(s.intake.facts.some(f=>['material_facts','uncertainties'].includes(f.field)),'unresolved identity evidence is not discarded');
    });
}

test('exact second live-test name and separate cell sentence survive callback-relative where wording',()=>{
    const s=replay(currentReply,currentQuestion),name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'phone').value,'602-555-0138');
    assert.equal(row(s,'name').confirmed,false);assert.equal(row(s,'phone').confirmed,false);
    assert.equal(name.evidence,'Michael Carter');assert.equal(name.sourceHash,sha(currentReply));
    assert.equal(name.turnId,s.turns.at(-1).id);
    assert.deepEqual(name.questionBinding,{text:currentQuestion,hash:sha(currentQuestion),intent:'identity'});
    assert.equal(s.turns.at(-1).content,currentReply);
    assert.ok(!s.intake.facts.some(f=>f.turnId===name.turnId&&['material_facts','uncertainties'].includes(f.field)),
        'the pure name/cell reply is not a case fact or unanswered case detail');
});

for(const text of [
    "Right, it's Michael Carter and my cell is 602-555-0138.",
    "Right, it's Michael Carter. My cell is 602-555-0138.",
    "Right, it’s Michael Carter. My cell is 602-555-0138.",
    "Yeah, it's Michael Carter and my cell is 602-555-0138.",
    'Michael Carter, my callback number is 602-555-0138.',
]){
    test('normal name/contact answer after callback-relative where: '+text,()=>{
        const s=replay(text,currentQuestion),name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
        assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'phone').value,'602-555-0138');
        assert.equal(name.evidence,'Michael Carter');assert.equal(name.sourceHash,sha(text));
        assert.equal(row(s,'name').confirmed,false);
    });
}

for(const text of ["Right, it's Michael Carter.","Yeah, it's Michael Carter.",'Well, Michael Carter.',
    'Michael Carter.',"My name is Michael Carter.",'This is Michael Carter.']){
    test('name-only direct answer needs no phone in the same utterance: '+text,()=>{
        const s=replay(text,'What is your full name?');
        assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'name').confirmed,false);
        const name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
        assert.equal(name.evidence,'Michael Carter');assert.equal(name.sourceHash,sha(text));
    });
}

test('source-bound name clause preserves independent case and cell facts after it',()=>{
    const text="Right, it's Michael Carter. I was arrested earlier. My cell is 602-555-0138.";
    const s=replay(text,currentQuestion),name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'phone').value,'602-555-0138');
    assert.match(row(s,'reason').value,/arrested earlier/i);
    assert.equal(name.evidence,'Michael Carter');assert.equal(name.sourceHash,sha(text));
    assert.ok(s.intake.facts.some(f=>f.field==='visitor_reported_reason'&&text.includes(f.evidence)));
    assert.equal(s.turns.at(-1).content,text);
});

test('source-bound name clause preserves a separately spoken email without deriving identity from it',()=>{
    const text="Right, it's Michael Carter. My email is avery.sample@example.test.";
    const s=replay(text,currentQuestion),name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'email').value,'avery.sample@example.test');
    assert.equal(name.evidence,'Michael Carter');assert.equal(name.sourceHash,sha(text));
    assert.equal(s.intake.emailCandidate.value,'avery.sample@example.test');assert.equal(row(s,'email').confirmed,false);
});

test('earlier incident-location statement does not contaminate the final personal-name question',()=>{
    const prior='You said where the incident happened was Mesa. Before we wrap up, what is your full name?';
    const text="Right, it's Michael Carter.",s=replay(text,prior);
    assert.equal(row(s,'name').value,'Michael Carter');
    assert.equal(row(s,'location'),undefined,'a persona-only location statement is not visitor evidence');
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').questionBinding.text,prior);
});

test('the exact new live reply does not change the canonical legacy intake',()=>{
    const s=replay(currentReply,currentQuestion,false);
    assert.equal(row(s,'name').value,'Not yet provided');assert.equal(row(s,'phone').value,'602-555-0138');
});

for(const [prior,text] of [
    ['What is the other driver’s full name?',"Right, it's Michael Carter."],
    ['What is your full name? What is the other driver’s full name?',"Right, it's Michael Carter."],
    ['What is your full name and the other driver’s full name?',"Right, it's Michael Carter."],
    ['What is your full name and which city did this happen in?',"Right, it's Michael Carter."],
    ['What is your full name and where did this happen?',currentReply],
    [currentQuestion,"Right, it's Michael Carter or Avery Stone."],
    [currentQuestion,'Right, he said his name is Michael Carter.'],
    [currentQuestion,'Right, I would rather not provide my name.'],
    [currentQuestion,'Right.'],
]){
    test('personal-name clause does not guess identity in ambiguous context: '+prior+' / '+text,()=>{
        assert.equal(row(replay(text,prior),'name').sourceIds.length,0);
    });
}

for(const text of ["Right, it's Unknown. My cell is 602-555-0138.","Right, it's Not Sure. My cell is 602-555-0138."]){
    test('uncertain standalone identity retains unresolved evidence: '+text,()=>{
        const s=replay(text,currentQuestion);
        assert.equal(row(s,'name').sourceIds.length,0);assert.equal(row(s,'phone').value,'602-555-0138');
        assert.ok(s.intake.facts.some(f=>['material_facts','uncertainties'].includes(f.field)));
    });
}

for(const text of ['My name is Michael Carter. My name is Avery Stone.',
    "Right, it's Michael Carter and my name is Avery Stone."]){
    test('the first name clause does not overwrite a later explicit name in the same visitor turn: '+text,()=>{
        const s=replay(text,'What is your full name?'),name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
        assert.equal(row(s,'name').value,'Avery Stone');assert.equal(row(s,'name').confirmed,false);
        assert.equal(name.evidence,'Avery Stone');assert.equal(name.sourceHash,sha(text));
        assert.equal(s.turns.at(-1).content,text);
    });
}

test('a combined visitor and spouse-name question stays ambiguous rather than assigning the first answer',()=>{
    const s=replay("Right, it's Michael Carter.",'What is your full name and your husband’s full name?');
    assert.equal(row(s,'name').sourceIds.length,0);
});

test('repairing a reported third-party name restores the prior visitor identity and preserves private history',()=>{
    let s=say(session(),'user','My name is Michael Carter.');
    const old=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    s=say(s,'persona','What is the other driver’s full name?');s=say(s,'user','His name is Avery Stone.');
    assert.equal(row(s,'name').value,'Michael Carter');
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').id,old.id);
    assert.ok(s.intake.history.some(f=>f.evidence==='Avery Stone'),'rejected third-party extraction remains private evidence');
    assert.equal(s.turns.at(-1).content,'His name is Avery Stone.');
});

for(const text of ['Understood.','Thanks.','Thank You.','Go Ahead.','Continue.','Goodbye.']){
    test('normal conversation-control speech never becomes a visitor name: '+text,()=>{
        const s=replay(text,'What is your full name?');
        assert.equal(row(s,'name').sourceIds.length,0);
        assert.ok(!s.intake.facts.some(f=>f.field==='visitor_preferred_identifier'));
        assert.equal(s.turns.at(-1).content,text);
    });
}
