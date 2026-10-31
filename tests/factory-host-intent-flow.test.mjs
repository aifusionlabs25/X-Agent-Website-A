import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendTurn,beginClosing,recordHandoffAttempt,reconcileVisitorEvidence,approve,appendSdkCloseEvidence} from '../lib/factory/handoff.ts';
import {committedTurnEffects} from '../lib/factory/turn-effects.ts';
import {handoffRequestStatus,collectionReferenceContext,handoffRequestContext} from '../lib/factory/handoff-context.ts';
import {sdkCloseTracker} from '../lib/factory/sdk-close.ts';
import {liveTranscript} from '../lib/factory/live-transcript.ts';
import {createFarewellCloseCoordinator} from '../lib/anam/farewell-close-coordinator.ts';

const retained=JSON.parse(readFileSync(new URL('./fixtures/factory-owner-led-missing-tools.json',import.meta.url),'utf8'));
const fresh=()=>({id:'local',version:1,package_sha256:'fixture',persona_id:'persona',launch_label:'fixture:launch',status:'ACTIVE',
    provider_session_id:'provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,
    provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]});
const user=(id,content)=>({id,role:'user',content});
const persona=(id,content)=>({id,role:'persona',content});
function timers() {
    let tick=0,next=0;const pending=new Map();
    return {schedule(fn,ms){const id=++next;pending.set(id,{fn,at:tick+ms});return id;},cancel(id){pending.delete(id);},
        advance(ms){tick+=ms;for(const [id,t] of [...pending])if(t.at<=tick){pending.delete(id);t.fn();}},size:()=>pending.size};
}
function harness({failContext=false}={}) {
    const s=fresh(),clock=timers(),contexts=[],errors=[];let calls=0;
    const tracker=sdkCloseTracker({id:()=> '11111111-1111-4111-8111-111111111111',stop:async()=>{calls++;},
        report:e=>appendSdkCloseEvidence(s,{...e,local_session_id:s.id,provider_session_id:s.provider_session_id,launch_label:s.launch_label})});
    const close=createFarewellCloseCoordinator({stopStreaming:()=>tracker.close('VISITOR_EXIT'),schedule:clock.schedule,cancel:clock.cancel});
    const effects={armClose:close.arm,finalReply:close.completeFarewell,context:text=>{if(failContext)throw Error('context lost');contexts.push(text);},contextFailure:e=>errors.push(e.message)};
    return {s,clock,contexts,errors,tracker,close,effects,calls:()=>calls,commit(t){appendTurn(s,t);committedTurnEffects(s,t,effects);}};
}

test('retained run now retains the exact handoff request and compound goodbye without inventing provider calls',()=>{
    const s=fresh();s.provider_session_id=retained.provider_session_id;
    for(const t of retained.original_turns)appendTurn(s,t);
    assert.deepEqual(s.turns,retained.original_turns);
    assert.equal(s.handoff_requests.length,1);const r=s.handoff_requests[0];
    const turn=s.turns.find(t=>t.id===r.visitor_message_id);
    assert.equal(turn.content.slice(r.start,r.end),r.evidence);assert.equal(r.status,'REQUESTED_NOT_MAPPED');
    assert.equal(s.status,'CLOSING_PENDING');assert.equal(s.visitor_exit.evidence,"That's all. Goodbye.");
    assert.equal(s.proposals.length,0);assert.equal(s.tool_events,undefined);
    assert.deepEqual(retained.actual_tool_names,['factory_knowledge_a6f9de88eba9']);
    assert.match(handoffRequestStatus(s),/mapping is still pending/);assert.doesNotMatch(handoffRequestStatus(s),/brief is ready/);
    assert.equal(reconcileVisitorEvidence(s,retained.provider_transcript).verified,true);
    assert.equal(s.provider_release_verified,false);assert.equal(s.status,'CLOSING_PENDING');assert.throws(()=>approve(s));
});

test('request survives reload and duplicate finalized events without approval, mappings or action authority',()=>{
    const s=fresh(),t=user('u:request','Could you draft an unsent summary for owner review? Do not send anything.');
    appendTurn(s,t);const saved=JSON.stringify(s);appendTurn(s,t);assert.equal(JSON.stringify(s),saved);
    const reloaded=JSON.parse(saved);assert.equal(reloaded.handoff_requests.length,1);
    assert.equal(reloaded.receipts.filter(r=>r.kind==='HANDOFF_REQUESTED').length,1);
    assert.equal(reloaded.approved,false);assert.equal(reloaded.submission_status,'UNSUBMITTED');assert.deepEqual(reloaded.external_actions,[]);
    assert.throws(()=>appendTurn(s,{...t,content:'Please send it.'}),/immutable/);
});

test('neither a spoken promise nor quoted or callback-only words manufactures a request',()=>{
    const s=fresh();appendTurn(s,persona('p:promise','I will prepare that brief now.'));
    for(const [i,text] of ['Will someone call me today?','She said: please prepare an unsent brief.','Do not prepare anything.'].entries())appendTurn(s,user('u:'+i,text));
    assert.equal(s.handoff_requests,undefined);assert.equal(s.proposals.length,0);assert.equal(handoffRequestStatus(s),null);
});

test('explicit request gets committed-state context with available tool; context never asserts mapped success',()=>{
    const h=harness(),t=user('u:request','Please create a local brief for human review.');h.commit(t);
    assert.match(collectionReferenceContext([]),/factory_handoff/);
    assert.equal(h.contexts.length,2);assert.match(h.contexts[1],/HANDOFF_REQUESTED.*does not mean prepared or mapped/);
    assert.match(h.contexts[1],/Use factory_handoff once/);assert.match(h.contexts[1],/No receipt means mapping remains pending/);
    assert.ok(h.contexts[1].includes(JSON.stringify(h.s.handoff_requests[0])));
    assert.equal(h.calls(),0);assert.equal(h.s.proposals.length,0);
});

test('repeat requests do not automatically retry a retained attempt; rejected proposals are not shown as awaiting decision',()=>{
    const s=fresh(),t=user('u:request','Please prepare an unsent brief.');appendTurn(s,t);
    const p={field_id:'request',visitor_message_id:t.id,evidence:t.content,value:t.content};
    recordHandoffAttempt(s,[p],[{id:'request',label:'Request'}],'first');
    assert.match(handoffRequestContext(s,t),/Do not automatically repeat/);
    assert.doesNotMatch(handoffRequestContext(s,t),/Use factory_handoff once/);
    s.decisions=[{proposal_id:s.proposals[0].id,decision:'REJECT',at:'fixture'}];
    assert.match(handoffRequestStatus(s),/all proposed mappings were declined/);
    assert.doesNotMatch(handoffRequestStatus(s),/await owner review/);
    s.decisions[0].decision='ACCEPT';assert.match(handoffRequestStatus(s),/Final handoff approval is pending/);
    s.approved=true;assert.match(handoffRequestStatus(s),/Owner-approved/);
    const failed=fresh();appendTurn(failed,t);recordHandoffAttempt(failed,[],[], 'invalid');
    assert.match(handoffRequestContext(failed,t),/Do not automatically repeat/);assert.match(handoffRequestStatus(failed),/mapping is still pending/);
});

test('late mapped result for an already retained request can complete during closing without relaxing exact evidence',()=>{
    const s=fresh(),t=user('u:request','Please prepare an unsent brief. We use a shared inbox.');appendTurn(s,t);
    appendTurn(s,user('u:bye','Thanks. That is all. Goodbye.'));
    const p={field_id:'workflow',visitor_message_id:t.id,evidence:'We use a shared inbox.',value:'We use a shared inbox.'};
    const fields=[{id:'workflow',label:'Current workflow'}];
    assert.equal(recordHandoffAttempt(s,[],fields,'empty').accepted,false);
    assert.equal(recordHandoffAttempt(s,[{...p,value:'Automated inbox'}],fields,'wrong').accepted,false);
    assert.equal(s.proposals.length,0);
    const accepted=recordHandoffAttempt(s,[p],fields,'valid');assert.equal(accepted.accepted,true);assert.equal(s.status,'CLOSING_PENDING');
    assert.match(handoffRequestStatus(s),/selected proposals await owner review/);assert.equal(s.approved,false);assert.equal(s.provider_release_verified,false);
    const noRequest=fresh();appendTurn(noRequest,{...t,content:'We use a shared inbox.'});appendTurn(noRequest,user('u:bye','Goodbye.'));
    assert.equal(recordHandoffAttempt(noRequest,[p],fields,'no-request').accepted,false);assert.equal(noRequest.proposals.length,0);
});

test('terminal follow-on fragments are retained once; new intake and altered evidence stay rejected',()=>{
    const s=fresh();const a=user('u:exit',"That's all."),b=user('u:more','Thanks, Dana. Goodbye.');appendTurn(s,a);appendTurn(s,b);
    const saved=JSON.stringify(s);appendTurn(s,b);assert.equal(JSON.stringify(s),saved);
    assert.equal(s.visitor_exit.visitor_message_id,a.id);assert.equal(s.closing_after_turn_id,a.id);
    assert.throws(()=>appendTurn(s,user('u:new','My account number is different.')),/exit has begun/);
    assert.throws(()=>appendTurn(s,{...a,content:"That's all except one more thing."}),/immutable/);
});

test('complete finalized reply, not last chunk or farewell wording, drains once then invokes supported SDK',async()=>{
    const h=harness(),transcript=liveTranscript();h.commit(user('u:exit',"That's all. Goodbye."));
    const first={id:'p:final',role:'persona',content:'Have a great ',endOfSpeech:false};
    assert.deepEqual(transcript.stream(first),[]);h.clock.advance(2000);assert.equal(h.calls(),0);
    assert.deepEqual(transcript.stream({...first,content:'day.',endOfSpeech:true}),[]);assert.equal(h.calls(),0);
    const finalized=transcript.history([persona('p:final','Have a great day.')]);assert.equal(finalized.length,1);h.commit(finalized[0]);
    h.clock.advance(2499);await Promise.resolve();assert.equal(h.calls(),0);
    h.clock.advance(1);await h.tracker.close('OWNER_FINISH');assert.equal(h.calls(),1);
    assert.equal(h.tracker.snapshot().events[0].reason,'VISITOR_EXIT');assert.equal(h.s.status,'CLOSING_PENDING');
    assert.equal(h.s.provider_release_verified,false);assert.throws(()=>approve(h.s));
    assert.equal(JSON.parse(JSON.stringify(h.s)).sdk_close_events.length,2);
});

test('optional context exceptions cannot strand committed exit or turn it into a handoff',async()=>{
    const h=harness({failContext:true});h.commit(user('u:bye','Okay, thank you. We are done.'));
    assert.ok(h.errors.length);assert.equal(h.s.status,'CLOSING_PENDING');h.commit(persona('p:end','You are welcome.'));
    h.clock.advance(2500);await h.tracker.close('VISITOR_EXIT');assert.equal(h.calls(),1);assert.equal(h.s.handoff_requests,undefined);
});

test('no-final-reply fail-safe releases once without claiming farewell or provider release',async()=>{
    const h=harness();h.commit(user('u:bye','Goodbye,'));h.clock.advance(12000);await h.tracker.close('VISITOR_EXIT');
    assert.equal(h.calls(),1);assert.equal(h.s.status,'CLOSING_PENDING');assert.equal(h.s.provider_release_verified,false);
    h.clock.advance(60000);await h.tracker.close('UNMOUNT');assert.equal(h.calls(),1);
});

test('a delayed pre-exit assistant callback cannot complete farewell; repeated arm cannot reset drain',async()=>{
    const h=harness(),old=persona('p:old','What should we discuss?');h.commit(old);h.commit(user('u:bye','Goodbye.'));
    committedTurnEffects(h.s,old,h.effects);h.clock.advance(2500);await Promise.resolve();assert.equal(h.calls(),0);
    h.commit(persona('p:new','Take care.'));committedTurnEffects(h.s,old,h.effects);
    h.clock.advance(2500);await h.tracker.close('VISITOR_EXIT');assert.equal(h.calls(),1);assert.equal(h.clock.size(),0);
});

test('provider tool can still begin closing with an immutable reply anchor',()=>{
    const s=fresh();appendTurn(s,user('u:exit','I need to leave now.'));beginClosing(s);
    assert.equal(s.closing_after_turn_id,'u:exit');appendTurn(s,persona('p:last','Take care.'));beginClosing(s);
    assert.equal(s.closing_after_turn_id,'u:exit');let completed=0;
    committedTurnEffects(s,s.turns[1],{armClose(){},finalReply(){completed++;},context(){},contextFailure:assert.fail});assert.equal(completed,1);
});

test('host effects refuse uncommitted or changed turns',()=>{
    const h=harness();assert.throws(()=>committedTurnEffects(h.s,user('fake','Goodbye.'),h.effects),/Committed exact/);
    h.commit(user('u:hello','Hello.'));assert.throws(()=>committedTurnEffects(h.s,user('u:hello','Goodbye.'),h.effects),/Committed exact/);
    assert.equal(h.clock.size(),0);assert.equal(h.s.status,'ACTIVE');
});
