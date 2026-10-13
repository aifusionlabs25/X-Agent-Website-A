import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTurn,emptyIntake,sha,view} from '../lib/james-canary/state.ts';

let sequence=0;
function base(){return {id:'offline-name-context',browserId:'offline',clientLabel:'offline',createdAt:'2026-10-13T00:00:00Z',revision:0,stateHash:'offline',personaId:'016e2c66-166b-43bd-8ebf-70b56c46575c',config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},websiteClosing:{policy:'JAMES-CLOSE-001',runtimeOwned:true},receipts:[]};}
function say(s,role,content){return applyTurn(s,{id:'context-'+(++sequence),role,content});}
function replay(question,text){return say(say(base(),'persona',question),'user',text);}
function row(s,key){return view(s).intakeBrief.sections.flatMap(section=>section.rows).find(value=>value.key===key);}
function assertName(s,name,text){
    assert.equal(row(s,'name').value,name);assert.equal(row(s,'name').confirmed,false);
    const fact=s.intake.facts.findLast(f=>f.field==='visitor_preferred_identifier');
    assert.equal(fact.evidence,name);assert.equal(fact.sourceHash,sha(text));assert.equal(fact.turnId,s.turns.at(-1).id);
    assert.equal(fact.status,'VISITOR_REPORTED');assert.ok(s.intake.history.some(f=>f.id===fact.id));
    assert.equal(s.turns.at(-1).content,text);
}

const actual=[
    ['9a55652d','I’m sorry you’re in a hurry. I can give general information, but not legal advice. I’ll record that there were field tests and possibly a breath test, and that you’re unsure. What’s the best callback number and email address for the firm to use for follow-up? ','Michael Carter, 602-555-0138.','Michael Carter'],
    ['05a14722','That’s still very early in the process. Do you have an email address and phone number where the firm can send or share the relevant next-step information? ','Michael Carter, 602-555-0138. Michael.Carter at email.com.','Michael Carter'],
    ['cad17a06','Got it. For a general orientation, an arrest can lead to both criminal charges and a separate MVD license action, often with different time frames. I can’t advise on your specific deadlines. I’m capturing field tests as confirmed and a breath test as uncertain. What’s the best callback number for the firm? ','Michael Carter. And please just have the firm call me. I feel a lot better having said this out loud. Thank you for your time. Goodbye.','Michael Carter'],
    ['a8b5273d','Got it. I can’t predict your specific outcome, but I can explain the usual Arizona steps after a DUI arrest and what the firm can do. Do you want the general process first, or your contact info so the firm can follow up? ','contact first michael carter 602-555-0138 emails michael.carter@email.com','michael carter'],
    ['5f97f21f','Understood. I can give you general information after capturing a name and reliable callback number. Usually, a DUI arrest may trigger a separate administrative license process in addition to the criminal case, but I can\'t apply that to your specific papers or deadline. What name and number should the firm use to follow up? ','Michael Carter 602-555-0138 please I just need the next step whatever you can say','Michael Carter'],
];
for(const [id,question,text,name]of actual){
    test('actual '+id+' recognizes visitor identity in a personal contact-intake answer',()=>{
        let s=say(base(),'persona',question);
        if(id==='cad17a06')s=say(s,'user','602-555-0138.');
        s=say(s,'user',text);assertName(s,name,text);
        assert.equal(row(s,'phone').value,'602-555-0138');
        if(/email\.com/.test(text))assert.equal(row(s,'email').value,'michael.carter@email.com');
        if(id==='a8b5273d')assert.ok(!s.intake.facts.some(f=>f.turnId===s.turns.at(-1).id&&['material_facts','uncertainties'].includes(f.field)));
    });
}

for(const question of ['What is your first and last name and a callback number?','May I get a full name and a callback number?','What name and number should the firm use to follow up?','What is your full name? And what number can the firm use?','Would you prefer general information first, or your contact details for follow-up?']){
    test('personal intake context is not tied to one question wording: '+question,()=>{
        const text='aNa-María O’Neill 602-555-0138';const s=replay(question,text);assertName(s,'aNa-María O’Neill',text);
        assert.equal(row(s,'phone').value,'602-555-0138');
    });
}

for(const text of ['my name is michael carter my number is 602-555-0138','My name is avery stone. I was arrested earlier.','My full name is JORDAN BLAKE.','You can call me José del Río.']){
    test('explicit own identity does not depend on a prior name question: '+text,()=>{
        const name=text.includes('michael')?'michael carter':text.includes('avery')?'avery stone':text.includes('JORDAN')?'JORDAN BLAKE':'José del Río';
        const s=replay('Understood.',text);assertName(s,name,text);
        if(text.includes('arrested'))assert.match(row(s,'reason').value,/arrested earlier/i);
    });
}

test('short personal contact-list answer preserves a sibling case report and independent email',()=>{
    const text='avery stone 602-555-0138 email is avery@example.test. I was arrested earlier.';
    const s=replay('What callback number and email can the firm use to follow up?',text);
    assertName(s,'avery stone',text);assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,'avery@example.test');
    assert.match(row(s,'reason').value,/arrested earlier/i);
});

for(const [question,text]of [
    ['What’s the best callback number for the firm?','Field tests.'],
    ['What’s the best callback number for the firm?','Breath maybe.'],
    ['What’s the best callback number for the firm?','No thanks.'],
    ['What’s the best callback number for the firm?','Exactly.'],
    ['What’s the best callback number for the firm?','Got it.'],
    ['What’s the best callback number for the firm?','Sounds good.'],
    ['What’s the best callback number for the firm?',"Yes, it's right."],
    ['What’s the best callback number for the firm?',"It's right."],
    ['What’s the best callback number for the firm?',"That's accurate."],
    ['What’s the best callback number for the firm?','Accurate.'],
    ['What’s the best callback number for the firm?','License suspended.'],
    ['Your contact info first, or general information?','Contact first.'],
    ['Your contact info first, or general information?','contact first 602-555-0138 emails avery@example.test'],
    ['What happened with your license?','Michael Carter 602-555-0138'],
    ['What is the other driver’s phone number?','Michael Carter 602-555-0138'],
    ['What is the officer’s contact information?','avery stone 602-555-0138'],
    ['What is your spouse’s callback number?','Michael Carter 602-555-0138'],
    ['What is your spouse’s full name?','Michael Carter.'],
    ['What name for the officer should the firm use?','Michael Carter.'],
    ['What phone number for the officer should the firm use?','Michael Carter 602-555-0138'],
    ['What is your employer’s contact information?','Michael Carter 602-555-0138'],
    ['What is your phone number and the other driver’s name?','Michael Carter 602-555-0138'],
    ['What is your name and where did this happen?','Mesa 602-555-0138'],
    ['What’s the best callback number for the firm?','michael.carter@email.com'],
    ['What’s the best callback number for the firm?','michael carter at email dot com'],
    ['What’s the best callback number for the firm?','602-555-0138 michael.carter@email.com'],
    ['What’s the best callback number for the firm?','unknown 602-555-0138'],
    ['What’s the best callback number for the firm?','His name is Michael Carter, 602-555-0138.'],
    ['What’s the best callback number for the firm?','If my name were Michael Carter, 602-555-0138, would that work?'],
    ['What’s the best callback number for the firm?','My name is not Michael Carter.'],
    ['What’s the best callback number for the firm?','Michael Carter or Avery Stone 602-555-0138'],
    ['Understood.','They said "my name is Michael Carter".'],
    ['Understood.',"I'm calling."],
    ['Understood.',"I'm having trouble."],
    ['What callback number can the firm use?',"I'm tired."],
    ['What callback number can the firm use?',"I am feeling better now."],
    ['What callback number can the firm use?',"I'm having trouble."],
    ['What callback number can the firm use?','This is difficult.'],
    ['What callback number can the firm use?','hypothetically michael carter 602-555-0138'],
    ['What callback number can the firm use?','suppose michael carter 602-555-0138'],
    ['What’s the best callback number for the firm?','Please have Michael Carter call me.'],
]){
    test('broader personal-contact context cannot invent an identity: '+text,()=>{
        const s=replay(question,text);assert.equal(row(s,'name').sourceIds.length,0);
        assert.ok(!s.intake.facts.some(f=>f.field==='visitor_preferred_identifier'));
    });
}

test('persona-only reported identity never becomes the visitor’s name',()=>{
    const s=say(base(),'persona','Michael Carter, 602-555-0138.');assert.equal(row(s,'name').sourceIds.length,0);
});

test('existing capitalized self-introduction remains supported without a prior name question',()=>{
    const text='I’m Avery Stone.';const s=replay('Understood.',text);assertName(s,'Avery Stone',text);
});

test('unchanged confirmed name remains confirmed after a personal callback answer',()=>{
    let s=say(base(),'user','My name is Avery Stone.');s=say(s,'persona','Is your name Avery Stone correct?');s=say(s,'user','Yes.');
    const fact=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');assert.equal(row(s,'name').confirmed,true);
    s=say(s,'persona','What callback number can the firm use?');s=say(s,'user','avery stone 602-555-0138');
    assert.equal(row(s,'name').value,'Avery Stone');assert.equal(row(s,'name').confirmed,true);
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').id,fact.id);
});

test('actual isolated Quick dialog control is not projected as a location and raw turn is retained',()=>{
    const text='Quick.';const s=replay('I hear you—let’s slow it down and get a clear picture of where things stand. Did the officer arrest you and take you to the station, or were you released at the scene with a citation?',text);
    assert.equal(s.intake.facts.length,0);assert.equal(s.turns.at(-1).content,text);
});

for(const text of ['Michael Carter, 602-555-0138. Michael.Carter at email.com.',"Sorry. Sorry. Yes, that's right. And emails michael.carter at email.com.", 'Email is michael.carter at email.com.']){
    test('captured pure contact answer is not also filed as a document: '+text,()=>{
        const s=replay('Do you have an email address and phone number where the firm can send or share next-step information?',text);
        assert.equal(row(s,'email').value,'michael.carter@email.com');
        assert.ok(!s.intake.facts.some(f=>f.turnId===s.turns.at(-1).id&&f.field==='known_documents_as_reported'));
        assert.equal(s.turns.at(-1).content,text);
    });
}

test('contact-only cleanup retains earlier and same-turn actual paperwork evidence',()=>{
    let s=say(base(),'user','I received paperwork.');const original=s.intake.facts.find(f=>f.field==='known_documents_as_reported');
    s=say(s,'persona','What is your callback number and email address?');
    s=say(s,'user','avery stone 602-555-0138 email is avery@example.test. They gave me a citation.');
    assert.equal(row(s,'name').value,'avery stone');assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,'avery@example.test');
    assert.ok(s.intake.facts.some(f=>f.id===original.id));assert.match(row(s,'documents').value,/citation|paperwork/i);
    assert.ok(s.intake.facts.some(f=>f.evidence.includes('citation')));
});

test('actual 5f97 contact confirmation cannot replace the earlier visitor name with right',()=>{
    const [,,text]=actual.find(([id])=>id==='5f97f21f');
    let s=replay(actual.find(([id])=>id==='5f97f21f')[1],text);const name=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    s=say(s,'persona','Noted. Just to make sure the firm reaches you, is that 602-555-0138? Also, would you like to share the email address you want associated with the intake? ');
    for(const reply of ["Yes, that's right.",'Yep.',"Sorry. Sorry. Yes, that's right. And emails michael.carter at email.com."])s=say(s,'user',reply);
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').id,name.id);
    assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,'michael.carter@email.com');
});

test('a changed phone in a complete contact-choice reply supersedes the old single phone with history retained',()=>{
    let s=say(base(),'user','My phone number is 480-555-0199.');const old=s.intake.facts.find(f=>f.field==='primary_phone');
    s=say(s,'persona','Would you prefer the general process first, or your contact info for follow-up?');
    const text='contact first michael carter 602-555-0138 emails michael.carter@email.com';s=say(s,'user',text);
    assert.equal(s.intake.facts.filter(f=>f.field==='primary_phone').length,1);assert.equal(row(s,'phone').value,'602-555-0138');
    const fact=s.intake.facts.find(f=>f.field==='primary_phone');assert.equal(fact.supersedes,old.id);assert.equal(fact.evidence,'602-555-0138');
    assert.equal(fact.sourceHash,sha(text));assert.equal(fact.status,'VISITOR_REPORTED');assert.ok(s.intake.history.some(f=>f.id===old.id));
});

test('an unchanged confirmed phone in a contact-choice reply keeps its original confirmation and evidence',()=>{
    let s=say(base(),'user','My phone number is 602-555-0138.');s=say(s,'persona','Is 602-555-0138 correct?');s=say(s,'user','Yes.');
    const old=s.intake.facts.find(f=>f.field==='primary_phone');assert.equal(old.status,'VISITOR_CONFIRMED');
    s=say(s,'persona','Would you prefer the general process first, or your contact info for follow-up?');
    s=say(s,'user','contact first michael carter 602-555-0138 emails michael.carter@email.com');
    assert.equal(s.intake.facts.filter(f=>f.field==='primary_phone').length,1);assert.equal(row(s,'phone').confirmed,true);
    assert.equal(s.intake.facts.find(f=>f.field==='primary_phone').id,old.id);
    assert.ok(!s.intake.facts.some(f=>f.turnId===s.turns.at(-1).id&&['material_facts','uncertainties','known_documents_as_reported'].includes(f.field)));
});

test('bare accurate to an existing-name check cannot become a replacement name',()=>{
    let s=say(base(),'user','My name is Michael Carter.');const old=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    s=say(s,'persona','Is your name Michael Carter accurate?');s=say(s,'user','Accurate.');
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').id,old.id);
});

test('control-name rejection preserves a genuine targeted name confirmation',()=>{
    let s=say(base(),'user','My name is Michael Carter.');
    s=say(s,'persona','Is your name Michael Carter correct?');s=say(s,'user','Correct.');
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'name').confirmed,true);
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').status,'VISITOR_CONFIRMED');
});
