import test from 'node:test';
import assert from 'node:assert/strict';
import {clearExit,closingCourtesy} from '../lib/factory/visitor-exit.ts';
import {appendTurn,appendSdkCloseEvidence,approve} from '../lib/factory/handoff.ts';

const fresh=()=>({id:'offline-exit',version:1,package_sha256:'package',persona_id:'persona',launch_label:'offline:exit',
    status:'ACTIVE',provider_session_id:'synthetic-provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
    provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,
    submission_status:'UNSUBMITTED',external_actions:[]});

test('retained natural endings enter closing without depending on assistant farewell words',()=>{
    for(const content of [
        'That answers it. Have a good day.',"Thanks, that's all I needed. Goodbye.",
        'Thanks for the explanation; goodbye.',"That's sufficient for now. Take care.",
        "Thanks. We're done now.",
    ]){
        const s=fresh(),turn={id:'ending',role:'user',content};
        assert.equal(clearExit(content),true,content);appendTurn(s,turn);
        assert.equal(s.status,'CLOSING_PENDING');assert.equal(s.visitor_exit.evidence,content);
        assert.deepEqual(s.turns,[turn]);
    }
});

test('independently worded completion modifiers and direct terminal clauses',()=>{
    for(const content of [
        "We are finished here.","I'm done for today.","That's all we wanted for now.",
        "That is all I need. Thank you.","I've got the information I need; have a nice evening.",
        "The inventory issue is the priority, and goodbye.","Our branch uses paper forms. Take care!",
        "I will check the account myself, so have a great night.",
    ])assert.equal(clearExit(content),true,content);
});

test('facts before final exit are retained verbatim, but cannot be added after closing',()=>{
    for(const content of [
        'My email is alex.chen@example.test. Goodbye,',
        'The amount was $1,250, not $1,500. Goodbye.',
        'The appointment is 11/12. Thanks for your help. Have a good day.',
        'Could you explain the fee? Goodbye.',
    ]){
        const s=fresh(),turn={id:'combined',role:'user',content};appendTurn(s,turn);
        assert.equal(s.status,'CLOSING_PENDING',content);assert.equal(s.turns[0].content,content);
        assert.equal(closingCourtesy(content),false);
        assert.throws(()=>appendTurn(s,{id:'late',role:'user',content:'One more detail: the account changed.'}));
        assert.equal(s.turns.length,1);
    }
});

test('quoted or reported farewells never count as the visitor ending the call',()=>{
    for(const content of [
        'The visitor said, goodbye.','My colleague wrote: Goodbye.',
        'The subject reads. Goodbye.','The note says, "Goodbye."',
        "The text is 'goodbye.'",'The title is “Goodbye.”','My customer said goodbye and left.',
        'Please say. Goodbye.','Repeat after me: thank you. Goodbye.',
        'For example: That answers it. Have a good day.',
        'My supplier said: thanks. Goodbye.','The message reads: we are done. Goodbye.',
        'We can discuss the word, goodbye.','The subject line is the phrase. Goodbye.',
    ])assert.equal(clearExit(content),false,content);
});

test('negated and conditional departures retain their scope across punctuation',()=>{
    for(const content of [
        "Don't close. Goodbye.",'Do not end the call; have a good day.',
        "I'm not saying goodbye. Have a nice evening.",'No goodbye, thank you.',
        'Keep the conversation going. Goodbye.','Stay on the line. Take care.',
        'If I say goodbye, have a good day.','When I finish, goodbye.',
        'Suppose the conversation ends. Goodbye.','Imagine I am leaving; goodbye.',
        'Before we end, goodbye.','Goodbye, but not yet.',
        'Do not. Goodbye.','I wonder whether I should say it, and goodbye.',
    ])assert.equal(clearExit(content),false,content);
});

test('unrelated uncertainty or declined contact does not negate a distinct direct exit',()=>{
    for(const content of [
        "I don't know the system name. Goodbye.","I do not want an email. Have a good day.",
        "I have no number to give you. Take care.",
        'The label is ‘unknown’. Goodbye.',
    ])assert.equal(clearExit(content),true,content);
});

test('conditional workflow facts do not veto an independent final goodbye',()=>{
    for(const content of [
        'If the integration is unavailable, we can use spreadsheets. Goodbye.',
        'When we get an order, we enter it manually. Thanks. Goodbye.',
        'After we receive a form, a person checks the fields. Take care.',
        'Unless the scan is legible, we ask for a new copy. Have a nice evening.',
        'Before we finish processing, the supervisor checks it. Goodbye.',
        'I am unsure whether the connector is available. Goodbye.',
    ])assert.equal(clearExit(content),true,content);
    for(const content of [
        'If the connector is unavailable, and goodbye.',
        'When I finish the conversation, goodbye.',
        'If I say goodbye. Have a good day.',
    ])assert.equal(clearExit(content),false,content);
});

test('task completion and substantive follow-ups are not conversation completion',()=>{
    for(const content of [
        'We are done with the document.','That is all we have on the shelf.',
        'I am all set for the meeting.','Goodbye. Can you answer one more question?',
        'Thanks, please send the file.','Is goodbye the command?',"That's all I need for the contract, but what about pricing?",
    ])assert.equal(clearExit(content),false,content);
});

test('incomplete intake does not prevent exit or invent a completed handoff',()=>{
    const s=fresh();appendTurn(s,{id:'v1',role:'user',content:'I only have a moment. Goodbye.'});
    assert.equal(s.status,'CLOSING_PENDING');assert.equal(s.proposals.length,0);
    assert.equal(s.handoff_requests,undefined);assert.equal(s.provider_release_verified,false);
    assert.equal(s.approved,false);assert.equal(s.submission_status,'UNSUBMITTED');
});

test('exit detection preserves one original receipt across duplicate and trailing courtesy turns',()=>{
    const s=fresh(),turn={id:'v1',role:'user',content:"That's all we needed. Goodbye."};
    appendTurn(s,turn);appendTurn(s,turn);appendTurn(s,{id:'v2',role:'user',content:'Thanks.'});
    assert.equal(s.receipts.filter(r=>r.kind==='VISITOR_EXIT_REQUESTED').length,1);
    assert.equal(s.visitor_exit.visitor_message_id,'v1');assert.equal(s.closing_after_turn_id,'v1');
    appendTurn(s,{id:'a1',role:'persona',content:'Have a pleasant afternoon.'});
    assert.equal(s.status,'CLOSING_PENDING');assert.equal(s.provider_release_verified,false);
});

test('SDK evidence never manufactures provider release or CLOSED',()=>{
    const s=fresh();appendTurn(s,{id:'v1',role:'user',content:'All set. Goodbye.'});
    const event={at:'2026-11-01T19:00:00Z',invocation_id:'12345678-1234-1234-1234-123456789abc',
        launch_label:s.launch_label,local_session_id:s.id,provider_session_id:s.provider_session_id,
        method:'stopStreaming',phase:'INVOKED',reason:'VISITOR_EXIT'};
    appendSdkCloseEvidence(s,event);appendSdkCloseEvidence(s,event);
    appendSdkCloseEvidence(s,{...event,at:'2026-11-01T19:00:01Z',phase:'RESOLVED'});
    assert.equal(s.sdk_close_events.length,2);assert.equal(s.status,'CLOSING_PENDING');
    assert.equal(s.provider_release_verified,false);assert.throws(()=>approve(s));
});
