import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTurn,emptyIntake} from '../lib/james-canary/state.ts';
import {CLOSE_FALLBACK_MS,CLOSE_QUIET_MS,explicitRuntimeDeparture,freshRuntimeCloseAttempt,runtimeCloseSignal,runtimeDepartureToArm} from '../lib/james-canary/runtime-close.ts';

let serial=0;
const base=()=>({id:'courteous-offline',browserId:'offline',clientLabel:'courteous-offline',createdAt:'2026-10-13T00:00:00Z',
    revision:0,stateHash:'offline',personaId:'016e2c66-166b-43bd-8ebf-70b56c46575c',config:{},state:'ACTIVE',turns:[],
    intake:emptyIntake(),intakeBrief:{version:2},websiteClosing:{policy:'JAMES-CLOSE-001',runtimeOwned:true},receipts:[]});
const say=(state,content,role='user')=>applyTurn(state,{id:'courteous-'+(++serial),role,content});
const observed=[
    ['Thanks, I feel better having it out of my head. Goodbye.',
        'You’re welcome, Michael. Take care, and I hope the next steps bring you some clarity.'],
    ['No, that’s it. I feel a lot better now. Thank you. Seriously. Goodbye.',
        'You’re very welcome, Michael. I’ve captured your information and concerns about your license. Take care.'],
];
for(const [reply,farewell]of observed){
    test('captured courteous goodbye arms candidate departure and its existing bounded timer: '+reply,()=>{
        assert.equal(explicitRuntimeDeparture(reply),true);
        let state=say(base(),'Before I close, is there anything else you want to make sure the firm has?','persona');
        state=say(state,reply);const departure=state.turns.at(-1);
        assert.equal(state.state,'CLOSING_PENDING');assert.equal(state.websiteClosing.departureKind,'EXPLICIT_GOODBYE');
        assert.equal(state.websiteClosing.reason,'VISITOR_DEPARTURE');assert.equal(state.websiteClosing.departureTurnId,departure.id);
        assert.equal(runtimeDepartureToArm(departure,state.websiteClosing),departure.id);
        const attempt=freshRuntimeCloseAttempt(departure.id,1000);
        state=say(state,farewell,'persona');
        if(state.websiteClosing.farewellTurnId){attempt.farewellTurnId=state.websiteClosing.farewellTurnId;attempt.finalizedAt=7000;}
        const noPlayback={now:1000+CLOSE_FALLBACK_MS-1,visitorSpeaking:false,personaSpeaking:false,audioRunning:false,lastSoundAt:0,quietSince:null};
        assert.equal(runtimeCloseSignal(attempt,noPlayback),null);
        assert.equal(runtimeCloseSignal(attempt,{...noPlayback,now:1000+CLOSE_FALLBACK_MS}),'BOUNDED_FALLBACK');
        assert.equal(runtimeCloseSignal(attempt,{...noPlayback,now:1000+CLOSE_FALLBACK_MS,visitorSpeaking:true}),null);
        assert.equal(state.state,'CLOSING_PENDING');assert.equal(state.turns.find(turn=>turn.id===departure.id).content,reply);
        assert.equal(state.providerRelease,undefined,'text recognition must not fabricate provider closure');
    });
}
test('recognized captured Take care still uses measured quiet completion before the existing fallback',()=>{
    let state=say(base(),observed[1][0]);const departure=state.turns.at(-1);
    state=say(state,observed[1][1],'persona');assert.equal(state.websiteClosing.farewellTurnId,state.turns.at(-1).id);
    const attempt={...freshRuntimeCloseAttempt(departure.id,1000),farewellTurnId:state.websiteClosing.farewellTurnId,finalizedAt:7000};
    const quiet={now:7000+CLOSE_QUIET_MS,visitorSpeaking:false,personaSpeaking:false,audioRunning:true,lastSoundAt:6900,quietSince:7000};
    assert.equal(runtimeCloseSignal(attempt,quiet),'AUDIO_QUIET');
    assert.equal(runtimeCloseSignal(attempt,{...quiet,personaSpeaking:true}),null);
});
for(const reply of [
    'Thank you for listening. I feel much better now. Goodbye.',
    'Okay. Nothing else. Thanks for your help. Goodbye, James.',
    'Thanks. That helped. Goodbye.',
    'No, that is everything. I am feeling better now. Thank you. Goodbye.',
])test('bounded non-actionable courteous prefix can accompany an independent goodbye: '+reply,()=>{
    assert.equal(explicitRuntimeDeparture(reply),true);assert.equal(say(base(),reply).state,'CLOSING_PENDING');
});
for(const reply of [
    'Thanks, I feel better having it out of my head.',
    'No, that’s it. I feel a lot better now. Thank you. Seriously.',
    'Thanks. I feel better. Goodbye, but when is my hearing?',
    'Thanks. I feel better. Goodbye. Actually, I have another question.',
    'Thanks. I feel better. Can you call me? Goodbye.',
    'If I feel better, goodbye.',
    'If I feel better. Goodbye.',
    'Thanks. Unless the firm calls me. Goodbye.',
    'Thanks. Do not hang up. Goodbye.',
    'Thanks. I am not finished. Goodbye.',
    'Thanks. My court date is tomorrow. Goodbye.',
    'Thanks. I feel pain in my neck. Goodbye.',
    'Thanks. My number changed to 602-555-0138. Goodbye.',
    'No, that’s it, except I have another detail. Goodbye.',
    'Thanks, I feel better having it out of my head. I received a new citation. Goodbye.',
    'Thanks. The officer said "Goodbye."',
    'Thanks. I said “Goodbye.” as an example.',
    '"Thanks. I feel better. Goodbye."',
    "'Thanks. I feel better. Goodbye.'",
    'Thanks. I feel better. He said goodbye.',
    'Thanks. I feel better. Goodbye maybe.',
    'Goodbye. Thanks. I have another question.',
    'Thanks, I feel better having it out of my head goodbye',
    ('Thanks. '.repeat(10))+'Goodbye.',
])test('quoted, conditional, negative, new-information or continuing speech never gains courteous departure: '+reply,()=>{
    assert.equal(explicitRuntimeDeparture(reply),false);
    const state=say(base(),reply);assert.equal(state.state,'ACTIVE');assert.equal(state.websiteClosing.departureTurnId,undefined);
});
test('fresh continuing visitor speech cancels a courteous departure without losing either raw turn',()=>{
    let state=say(base(),observed[0][0]);assert.equal(state.state,'CLOSING_PENDING');
    const original=state.turns.at(-1);
    state=say(state,'Actually, I need to correct one detail.');assert.equal(state.state,'ACTIVE');
    assert.equal(state.websiteClosing.departureTurnId,undefined);assert.equal(state.websiteClosing.farewellTurnId,undefined);
    assert.deepEqual(state.turns.find(turn=>turn.id===original.id),original);
});
