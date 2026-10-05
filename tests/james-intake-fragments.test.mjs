import assert from 'node:assert/strict';
import test from 'node:test';
import {applyTurn,emptyIntake,receipt,sha,CURRENT_JAMES_PERSONA_ID} from '../lib/james-canary/state.ts';
import {buildStructuredBrief} from '../lib/james-canary/structured-brief.ts';

// Synthetic regression fixtures, not a private caller transcript.
const compound='Could you tell me the date and location of the incident, and whether you already have an attorney? Also, may I have your full name and a good phone number?';
const base=()=>({id:'synthetic-fragments',browserId:'browser',clientLabel:'offline-test',createdAt:'2026-10-02T00:00:00Z',revision:0,stateHash:'initial',personaId:CURRENT_JAMES_PERSONA_ID,config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},receipts:[]});
let serial=0;
const turn=(s,content,role='user')=>receipt(s,applyTurn(s,{id:String(++serial),role,content}),{test:content});
const rows=s=>buildStructuredBrief(s.intake).sections.flatMap(section=>section.rows);
const row=(s,key)=>rows(s).find(item=>item.key===key);
const fact=(s,field)=>s.intake.facts.findLast(item=>item.field===field);

test('fragmented explicit name, phone, timing and location keep their own slots after a compound question',()=>{
    let s=turn(base(),compound,'persona');
    s=turn(s,'Tonight in Mosa, no attorney.');
    assert.equal(row(s,'location').value,'Mosa');
    assert.equal(row(s,'incident_date').value,'Tonight');
    assert.match(row(s,'facts').value,/no attorney/i);
    s=turn(s,'name is Rowanelle.');
    assert.equal(row(s,'name').value,'Rowanelle');
    assert.equal(row(s,'name').confirmed,false);
    assert.equal(row(s,'location').value,'Mosa');
    s=turn(s,'phones 480 555 0172');
    assert.equal(row(s,'phone').value,'480-555-0172');
    assert.equal(row(s,'phone').confirmed,false);
    assert.ok(!s.intake.facts.some(item=>item.value==='s'));
    s=turn(s,'Could you share when and where the DUI occurred, and what help you need?','persona');
    s=turn(s,"Tonight in Mesa, I just, I need to know the next steps.");
    assert.equal(row(s,'location').value,'Mesa');
    assert.equal(row(s,'name').value,'Rowanelle'); // Never guess an ASR correction.
    assert.ok(s.intake.history.some(item=>item.field==='event_location'&&item.value==='Mosa'));
    assert.match(row(s,'outcome').value,/need to know the next steps/);
});

test('explicit name markers own the name field and never also become a location',()=>{
    for(const answer of ['name is Avery Stone.','My name is Avery Stone.','My full name is Avery Stone.',
        'Full name’s Avery Stone.','My full name’s Avery Stone.',"name's Avery Stone.","My full name's Avery Stone."]) {
        const s=turn(turn(base(),compound,'persona'),answer);
        assert.equal(row(s,'name').value,'Avery Stone',answer);
        assert.equal(row(s,'location'),undefined,answer);
        assert.equal(row(s,'name').confirmed,false);
    }
    const s=turn(turn(base(),'Where did it happen?','persona'),'My name is Avery Stone.');
    assert.equal(row(s,'name').value,'Avery Stone');
    assert.equal(row(s,'location'),undefined);
});

test('a bare response to conflicting name and place questions is not guessed into either slot',()=>{
    for(const answer of ['Mesa.',"It's Mesa."]) {
        const ambiguous=turn(turn(base(),compound,'persona'),answer);
        assert.equal(row(ambiguous,'name').value,'Not yet provided');
        assert.equal(row(ambiguous,'location'),undefined);
    }
    const specific=turn(turn(base(),'Where did it happen?','persona'),'Mesa.');
    assert.equal(row(specific,'location').value,'Mesa');
    assert.equal(row(specific,'name').value,'Not yet provided');
});

test('multiple explicit facts survive one user event and retain exact source-span provenance',()=>{
    const content='Tonight in Mesa, no attorney, my name is Avery Stone, my phone is 480-555-0172.';
    const s=turn(turn(base(),compound,'persona'),content);
    assert.equal(row(s,'name').value,'Avery Stone');
    assert.equal(row(s,'phone').value,'480-555-0172');
    assert.equal(row(s,'location').value,'Mesa');
    assert.equal(row(s,'incident_date').value,'Tonight');
    assert.match(row(s,'facts').value,/no attorney/i);
    for(const item of s.intake.facts) {
        assert.ok(content.includes(item.evidence),item.evidence);
        assert.equal(item.sourceHash,sha(content));
        assert.notEqual(item.status,'VISITOR_CONFIRMED');
    }
});

test('contracted explicit name and phone markers preserve all siblings in one event',()=>{
    const content='Full name’s Avery Stone, Phone’s 480 555 0172, tonight in Mesa, no attorney.';
    const s=turn(turn(base(),compound,'persona'),content);
    assert.equal(row(s,'name').value,'Avery Stone');
    assert.equal(row(s,'phone').value,'480-555-0172');
    assert.equal(row(s,'location').value,'Mesa');
    assert.equal(row(s,'incident_date').value,'tonight');
    assert.match(row(s,'facts').value,/no attorney/i);
    assert.ok(!s.intake.facts.some(item=>/^[’']?s$/.test(item.value)));
    for(const item of s.intake.facts) {
        assert.ok(content.includes(item.evidence),item.evidence);
        assert.equal(item.sourceHash,sha(content));
        assert.notEqual(item.status,'VISITOR_CONFIRMED');
    }
});

test('a one-word substantive residue does not erase explicit timing and location',()=>{
    const s=turn(base(),'DUI tonight in Mesa.');
    assert.equal(row(s,'location').value,'Mesa');
    assert.equal(row(s,'incident_date').value,'tonight');
    assert.equal(row(s,'reason').value,'DUI');
});

test('uncertain timing and place stay unconfirmed; non-location replies cannot fill location',()=>{
    const uncertain=turn(base(),'I think it was tonight in Mesa.');
    assert.equal(fact(uncertain,'event_location').status,'NEEDS_CLARIFICATION');
    assert.equal(fact(uncertain,'relevant_dates_events').status,'NEEDS_CLARIFICATION');
    for(const answer of ['No attorney.','I do not know.','Tonight.','Not in Mesa.','My phone is 480-555-0172.','I decline to provide my name.']) {
        const s=turn(turn(base(),'Where did it happen?','persona'),answer);
        assert.equal(row(s,'location'),undefined,answer);
        assert.equal(row(s,'name').value,answer.includes('decline')?'Visitor declined':'Not yet provided',answer);
    }
    assert.equal(row(turn(base(),'Not tonight.'),'incident_date'),undefined);
});

test('whole recap agreement cannot confirm a phone even when no name was successfully extracted',()=>{
    let s=turn(base(),'My phone is 480-555-0172.');
    s=turn(s,'Here is what I have: your name is Rowanelle, phone 480-555-0172, and the incident was tonight in Mesa. Is that correct?','persona');
    s=turn(s,'Yes.');
    assert.equal(row(s,'phone').confirmed,false);
    s=turn(s,'Your callback number is four eight zero, five five five, zero one seven two. Is that correct?','persona');
    s=turn(s,'Yes.');
    assert.equal(row(s,'phone').confirmed,true);
});
