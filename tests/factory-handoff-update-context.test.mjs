import test from 'node:test';
import assert from 'node:assert/strict';
import {appendTurn,digest} from '../lib/factory/handoff.ts';
import {handoffRequestContext,handoffSourceReferences} from '../lib/factory/handoff-context.ts';

const fresh=()=>({id:'offline-local',version:1,package_sha256:'fictional-package',persona_id:'fictional-persona',launch_label:'offline-fixture',
    status:'ACTIVE',provider_session_id:'offline-provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
    provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,
    submission_status:'UNSUBMITTED',external_actions:[]});
const say=(state,id,content)=>{const t={id,role:'user',content};appendTurn(state,t);return t;};
const accepted=(request_turn_id=null)=>({request_id:'offline-request',tool_call_id:'offline-tool',
    local_session_id:'offline-local',provider_session_id:'offline-provider',request_turn_id,
    input_sha256:'offline-hash',local_turns_sha256:'offline-turns',original_proposals:[],resolved_proposals:[],bindings:[],applied:true,
    result:{status:'PENDING_OWNER_REVIEW',accepted:true,accepted_proposal_count:1,owner_approved:false,submission_status:'UNSUBMITTED',external_actions:[],issues:[],visitor_message:'Pending owner review.',instruction:'Nothing sent.'}});

test('first exact request provides paired references without claiming preparation or changing state',()=>{
    const s=fresh();say(s,'context','Quotes arrive through a shared inbox.');
    const t=say(s,'request','Please prepare a brief for human review.'),before=digest(s),context=handoffRequestContext(s,t);
    assert.match(context,/Use factory_handoff once in this response/);
    assert.match(context,/No receipt means mapping remains pending/);
    assert.match(context,/Reference data:/);
    assert.ok(context.includes(JSON.stringify(handoffSourceReferences(s.turns))));
    assert.equal(digest(s),before);
});

test('new explicit request after successful contextual preparation refreshes correction and unknown references',()=>{
    const s=fresh();say(s,'initial','We have eight coordinators.');
    s.handoff_binding_attempts=[accepted(null)];
    s.proposals=[{id:'prior',field_id:'context',visitor_message_id:'initial',evidence:'We have eight coordinators.',value:'We have eight coordinators.'}];
    s.tool_events=[{tool_call_id:'offline-tool',tool_name:'factory_handoff',phase:'SDK_COMPLETED',result:'saved',exposure:'SDK_EVENT_NOT_PROOF_OF_MODEL_CONSUMPTION'}];
    say(s,'correction','One correction: we have five coordinators, not eight.');
    say(s,'unknown','Access to the dispatch portal is unconfirmed.');
    const t=say(s,'update','Please prepare a brief for human review with the correction and the open question.'),before=digest(s);
    const context=handoffRequestContext(s,t);
    assert.match(context,/new explicit visitor request to update/);
    assert.match(context,/not an automatic retry/);
    assert.match(context,/Use factory_handoff once in this response/);
    assert.ok(context.includes(JSON.stringify(handoffSourceReferences(s.turns))));
    assert.match(context,/five coordinators, not eight/);assert.match(context,/unconfirmed/);
    assert.equal(digest(s),before);assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});

test('same request cannot receive another preparation instruction after a successful attempt',()=>{
    const s=fresh(),t=say(s,'request','Please prepare a local review note.');
    s.handoff_binding_attempts=[accepted(t.id)];
    const context=handoffRequestContext(s,t);
    assert.match(context,/Do not automatically repeat/);
    assert.doesNotMatch(context,/Use factory_handoff once in this response|Reference data:/);
});

test('later explicit request after an earlier request-bound success is eligible, older request is not replayed',()=>{
    const s=fresh(),first=say(s,'first-request','Please create a summary for owner review.');
    s.handoff_binding_attempts=[accepted(first.id)];
    say(s,'more','Keep the supplier response time unknown.');
    const latest=say(s,'next-request','Could you draft a local brief including the missing timing?');
    assert.equal(handoffRequestContext(s,first),null);
    assert.match(handoffRequestContext(s,latest),/new explicit visitor request to update/);
});

test('correction alone or an unpersisted request does not create preparation authority',()=>{
    const s=fresh();s.handoff_binding_attempts=[accepted(null)];
    const t=say(s,'correction','Correction: three operators, not two.');
    assert.equal(handoffRequestContext(s,t),null);
    s.handoff_requests=[{visitor_message_id:'missing',evidence:'Please draft a local brief.',start:0,end:27,source:'HOST_PERSISTED_VISITOR_REQUEST',status:'REQUESTED_NOT_MAPPED'}];
    assert.equal(handoffRequestContext(s,{id:'missing',role:'user',content:'Please draft a local brief.'}),null);
});

test('failed, unknown, legacy, manual and unbound SDK outcomes stay blocked even with another request',()=>{
    for(const mode of ['failed','quarantine','legacy','sdk-failed','sdk-unbound','manual','proposals-only','unknown-request']){
        const s=fresh();s.handoff_binding_attempts=[accepted(null)];
        const a=s.handoff_binding_attempts[0];
        if(mode==='failed'){a.applied=false;a.result.accepted=false;a.result.status='UNMAPPED_OWNER_REVIEW';}
        if(mode==='quarantine')s.quarantined_proposals=[{request_id:'bad',proposals:[],reason:'Bad evidence'}];
        if(mode==='legacy')delete a.request_turn_id;
        if(mode==='sdk-failed'||mode==='sdk-unbound')s.tool_events=[{tool_call_id:mode==='sdk-unbound'?'unknown':'offline-tool',tool_name:'factory_handoff',phase:mode==='sdk-failed'?'SDK_FAILED':'SDK_COMPLETED',result:'unknown',exposure:'SDK_EVENT_NOT_PROOF_OF_MODEL_CONSUMPTION'}];
        if(mode==='manual')s.receipts.push({kind:'handoff',at:'2026-01-01T00:00:00Z',sha256:'manual'});
        if(mode==='proposals-only'){s.handoff_binding_attempts=[];s.proposals=[{id:'unbound'}];}
        if(mode==='unknown-request')a.request_turn_id='not-retained';
        const t=say(s,'new-request','Please prepare an unsent summary.');
        const before=digest(s),context=handoffRequestContext(s,t);
        assert.match(context,/Do not automatically repeat/,mode);
        assert.doesNotMatch(context,/Reference data:|Use factory_handoff once in this response/,mode);
        assert.equal(digest(s),before,mode);
    }
});
