import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyIntake,applyTurn,view} from '../lib/james-canary/state.ts';
import {cancelWebsiteClose} from '../lib/james-canary/closing.ts';
import {CLOSE_FALLBACK_MS,freshRuntimeCloseAttempt,runtimeCloseSignal,runtimeDepartureToArm} from '../lib/james-canary/runtime-close.ts';
import {readFileSync} from 'node:fs';

let serial=0;
const base=()=>({id:'candidate-offline',browserId:'test',clientLabel:'candidate-offline',createdAt:'2026-10-03T00:00:00Z',
    revision:0,stateHash:'test',personaId:'016e2c66-166b-43bd-8ebf-70b56c46575c',config:{},state:'ACTIVE',turns:[],
    intake:emptyIntake(),intakeBrief:{version:2},websiteClosing:{policy:'JAMES-CLOSE-001',runtimeOwned:true},receipts:[]});
const turn=(s,content,role='user')=>applyTurn(s,{id:'turn-'+(++serial),role,content});

test('candidate closes on whole-turn courtesy only after the immediately preceding finalized farewell',()=>{
    let s=turn(base(),'Thanks.');assert.equal(s.state,'ACTIVE');
    s=turn(s,'Here is the answer to your question.','persona');s=turn(s,'Thank you.');assert.equal(s.state,'ACTIVE');
    s=turn(s,'Thanks, Alex. Take care.','persona');const farewellId=s.turns.at(-1).id;
    s=turn(s,'Thanks.');assert.equal(s.state,'CLOSING_PENDING');
    assert.equal(s.websiteClosing.farewellTurnId,farewellId);
    assert.equal(s.websiteClosing.departureTurnId,s.turns.at(-1).id);
    assert.equal(view(s).websiteClosing.reason,'VISITOR_DEPARTURE');
    assert.equal(view(s).websiteClosing.departureKind,'CONTEXTUAL_ACK');
});
test('candidate courtesy never turns added information or a nonterminal farewell into departure',()=>{
    for(const [farewell,reply] of [
        ['Take care. Anything else?','Thanks.'],['Take care.','Thanks, but wait.'],
        ['Take care.','Thank you, my number changed.'],['Take care.','Thanks, is that all?'],
    ]){
        let s=turn(base(),farewell,'persona');s=turn(s,reply);
        assert.equal(s.state,'ACTIVE',reply);assert.equal(s.websiteClosing.departureTurnId,undefined,reply);
    }
});
test('candidate contextual wrap-up is bound to James’s immediately preceding closing question',()=>{
    const wrap="No, that's everything. Thanks for your help.";
    let s=turn(base(),wrap);
    assert.equal(s.state,'ACTIVE','the same words without closing context do not end the session');
    s=turn(base(),'Here is the answer to your question.','persona');
    s=turn(s,wrap);
    assert.equal(s.state,'ACTIVE','an ordinary answer is not a closing invitation');

    s=turn(base(),'Before we wrap up, is there anything else you want to make sure I have?','persona');
    const prompt=s;
    for(const continuing of ['Okay, thanks','Thanks — and what about my license?',
        "No, that's everything, but what about my license?", "No, that's everything. I have one correction."]){
        const active=turn(prompt,continuing);
        assert.equal(active.state,'ACTIVE',continuing);
        assert.equal(active.websiteClosing.departureTurnId,undefined,continuing);
    }
    s=turn(prompt,wrap);
    assert.equal(s.state,'CLOSING_PENDING');
    assert.equal(s.websiteClosing.departureKind,'CONTEXTUAL_ACK');
    assert.equal(s.websiteClosing.farewellTurnId,undefined,'James still owes one natural final response');
    s=turn(s,'I have the information you shared captured. Take care.','persona');
    assert.equal(s.websiteClosing.farewellTurnId,s.turns.at(-1).id);

    let concise=turn(base(),'Is there anything else you want to make sure I have?','persona');
    concise=turn(concise,"Nope, that's everything.");
    assert.equal(concise.state,'CLOSING_PENDING');
});
test('candidate closes on brief courtesy after a real farewell, including the observed extended well-wish',()=>{
    for(const [farewell,courtesy] of [
        ['Have a good day.','Cheers.'],
        ["You're welcome. Take care, and I hope your neck starts feeling better soon.",'Thanks.'],
    ]){
        let s=turn(base(),farewell,'persona');s=turn(s,courtesy);
        assert.equal(s.state,'CLOSING_PENDING',farewell);
        assert.equal(s.websiteClosing.departureKind,'CONTEXTUAL_ACK',farewell);
    }
    for(const courtesy of ['Cheers.','Thanks.']){
        let s=turn(base(),'Here is the answer to your question.','persona');s=turn(s,courtesy);
        assert.equal(s.state,'ACTIVE',courtesy);
    }
    let mixed=turn(base(),'Take care, but I need your callback number.','persona');
    mixed=turn(mixed,'Thanks.');assert.equal(mixed.state,'ACTIVE');
});
test('candidate accepts a clear wrap-up after a post-farewell idle check-in, not a new request',()=>{
    const idle='It looks like you have been quiet for a moment. Are you still there?';
    let s=turn(base(),'Take care.','persona');s=turn(s,idle,'persona');
    const context=s;
    s=turn(context,"Yeah, I'm here. That's everything. Thanks for your help.");
    assert.equal(s.state,'CLOSING_PENDING');
    assert.equal(s.websiteClosing.departureKind,'CONTEXTUAL_ACK');
    for(const continuation of [
        "Yeah, I'm here. That's everything, but what about my license?",
        "Yeah, I'm here. Actually, I need to correct the accident date.",
        "Yeah, I'm here. That's everything about the bill; I also visited urgent care.",
    ])assert.equal(turn(context,continuation).state,'ACTIVE',continuation);
    let noFarewell=turn(base(),idle,'persona');
    noFarewell=turn(noFarewell,"Yeah, I'm here. That's everything. Thanks for your help.");
    assert.equal(noFarewell.state,'ACTIVE','an idle check-in alone does not authorize closing');
});
test('candidate recognizes you-too goodbye as departure without admitting a trailing question or case fact',()=>{
    let s=turn(base(),'You too. Bye.');
    assert.equal(s.state,'CLOSING_PENDING');
    assert.equal(s.websiteClosing.departureKind,'EXPLICIT_GOODBYE');
    for(const text of ['You too. Bye, but what about my license?',
        'You too. Bye, I need to correct my phone number.',
        'I said you too, bye as an example.'])assert.equal(turn(base(),text).state,'ACTIVE',text);
});
test('candidate assembles the latest interrupted-call closing fragments without admitting continuing speech',()=>{
    // The provider recorded two interrupted James turns here. The browser saves
    // finalized turns only, leaving these visitor turns adjacent in the session.
    let s=turn(base(),'Are you dealing with any ongoing pain, missed work, or repair costs right now?','persona');
    s=turn(s,"Some soreness for a few days. I haven't missed work. The car has visible damage.");
    s=turn(s,"I guess what the usual yes that's it");
    s=turn(s,"No, that's everything.");
    assert.equal(s.state,'ACTIVE','one fragment without a completed closing question is not enough');
    s=turn(s,'Thanks for your help.');
    assert.equal(s.state,'CLOSING_PENDING','the adjacent finalized visitor fragments jointly express departure');
    assert.equal(s.websiteClosing.departureKind,'CONTEXTUAL_ACK');
    assert.equal(s.websiteClosing.departureTurnId,s.turns.at(-1).id);
    assert.equal(s.websiteClosing.farewellTurnId,undefined,'the final James response is still owed');
    s=turn(s,'I have the information you shared captured. Take care.','persona');
    assert.equal(s.websiteClosing.farewellTurnId,s.turns.at(-1).id);

    for(const continuation of ['Thanks — and what about my license?',
        'Actually, I need to correct the accident date.', 'My court date is tomorrow.',
        'Okay, thanks, but I have another question.']){
        let active=turn(base(),"No, that's everything.");
        active=turn(active,continuation);
        assert.equal(active.state,'ACTIVE',continuation);
        assert.equal(active.websiteClosing.departureTurnId,undefined,continuation);
    }
    let separated=turn(base(),"No, that's everything.");
    separated=turn(separated,'Here is the answer to your question.','persona');
    separated=turn(separated,'Thanks for your help.');
    assert.equal(separated.state,'ACTIVE','only adjacent visitor fragments may combine');
    assert.equal(turn(base(),'Thanks for your help.').state,'ACTIVE','courtesy alone is not departure');
});
test('candidate acknowledgment uses one prior farewell, and new speech cancels pending close',()=>{
    let s=turn(base(),'Thank you. Take care.','persona');s=turn(s,'You too.');
    const farewellId=s.websiteClosing.farewellTurnId;
    assert.equal(s.state,'CLOSING_PENDING');
    cancelWebsiteClose(s);assert.equal(s.state,'ACTIVE');
    s=turn(s,'Actually, I have one more detail.');assert.equal(s.state,'ACTIVE');
    assert.equal(s.websiteClosing.farewellTurnId,undefined);
    assert.equal(s.websiteClosing.departureKind,undefined);
    assert.equal(s.turns.filter(t=>t.id===farewellId).length,1);
});
test('an explicit goodbye has its own recorded origin, not a courtesy origin',()=>{
    const s=turn(base(),'Goodbye.');
    assert.equal(s.state,'CLOSING_PENDING');
    assert.equal(s.websiteClosing.departureKind,'EXPLICIT_GOODBYE');
});
test('answered-question goodbye closes without admitting mixed case facts or questions',()=>{
    const ended=turn(base(),'Thanks, that answers my question. Goodbye.');
    assert.equal(ended.state,'CLOSING_PENDING');
    assert.equal(ended.websiteClosing.departureKind,'EXPLICIT_GOODBYE');
    for(const text of ['My court date is tomorrow. Goodbye.','Thanks, that answers my question. Goodbye, but when is my hearing?',
        'If that answers my question, goodbye.','I said “Goodbye.” as an example.']){
        const s=turn(base(),text);
        assert.equal(s.state,'ACTIVE',text);
    }
});
test('candidate courtesy waits for its existing bounded fallback and never closes during visitor speech',()=>{
    const attempt={departureTurnId:'visitor-courtesy',farewellTurnId:'prior-farewell',startedAt:1000};
    const input={now:1000+CLOSE_FALLBACK_MS-1,visitorSpeaking:false,personaSpeaking:false,audioRunning:false,lastSoundAt:0,quietSince:null};
    assert.equal(runtimeCloseSignal(attempt,input),null);
    assert.equal(runtimeCloseSignal(attempt,{...input,now:1000+CLOSE_FALLBACK_MS,visitorSpeaking:true}),null);
    assert.equal(runtimeCloseSignal(attempt,{...input,now:1000+CLOSE_FALLBACK_MS}),'BOUNDED_FALLBACK');
    const client=readFileSync(new URL('../components/james/JamesCanary.tsx',import.meta.url),'utf8');
    assert.match(client,/freshRuntimeCloseAttempt\(departureTurnId,performance\.now\(\),latest\.current\?\.websiteClosing\?\.farewellTurnId\)/);
    assert.match(client,/event\.id!==runtimeAttempt\.current\.farewellTurnId/);
});
test('finalized wrap-up then explicit goodbye rearms one bounded close despite stale speech timing',()=>{
    let s=turn(base(),'Is there anything else you want to make sure I have?','persona');
    s=turn(s,"No, that's everything. Thanks for your help.");
    assert.equal(s.state,'CLOSING_PENDING');
    s=turn(s,'I am glad I could help. Take care.','persona');
    cancelWebsiteClose(s);
    s=turn(s,'Goodbye.');
    const goodbye=s.turns.at(-1);
    assert.equal(runtimeDepartureToArm(goodbye,s.websiteClosing),goodbye.id);
    assert.equal(runtimeDepartureToArm(s.turns.at(-2),s.websiteClosing),null);
    const attempt=freshRuntimeCloseAttempt(goodbye.id,1000);
    assert.equal(attempt.farewellTurnId,undefined,'the earlier farewell cannot contaminate the new goodbye attempt');
    assert.equal(runtimeCloseSignal(attempt,{now:1000+CLOSE_FALLBACK_MS,visitorSpeaking:false,
        personaSpeaking:true,audioRunning:false,lastSoundAt:0,quietSince:null}),'BOUNDED_FALLBACK');
    const client=readFileSync(new URL('../components/james/JamesCanary.tsx',import.meta.url),'utf8');
    assert.match(client,/runtimeDepartureToArm\(turn,s\.websiteClosing\)/);
    assert.match(client,/runtimeAttempt\.current=freshRuntimeCloseAttempt\(departureTurnId/);
    assert.match(client,/runtimeAttempt\.current=null;[\s\S]*?function scheduleClose/);
    assert.match(client,/if\(event\.endOfSpeech===true && !event\.interrupted\)\{\s*if\(event\.role==='user'\)visitorSpeaking\.current=false/);
    assert.doesNotMatch(client,/turnEpoch===closeEpoch\.current&&!visitorSpeaking\.current/);
});
