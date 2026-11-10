import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preserveQuotedValue} from '../lib/factory/handoff-format.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {appendTurn,assertProposal,recordHandoffAttempt,proposalIssues,digest,approve} from '../lib/factory/handoff.ts';
import {seal,unseal} from '../lib/factory/store.ts';

const saved=JSON.parse(readFileSync(new URL('./fixtures/factory-handoff-format-20261109.json',import.meta.url),'utf8'));
const fields=[{id:'request',label:'Requested next step'},{id:'constraint',label:'Additional constraints'}];
const u=(id,content)=>({id,role:'user',content});
const p=(id,evidence,value=evidence,field_id='request')=>({field_id,visitor_message_id:id,evidence,value});
const fresh=()=>({id:'local',version:1,package_sha256:'offline-fixture',persona_id:'persona',launch_label:'fixture:format',
    status:'ACTIVE',provider_session_id:'provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
    provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,
    submission_status:'UNSUBMITTED',external_actions:[]});
function setup(content='Please prepare an unsent draft summary for owner review.') {
    const s=fresh();appendTurn(s,u('source',content));return s;
}
function apply(s,input,call='format-call',allowed=fields) {
    return recordProviderHandoffAttempt(s,input,allowed,'request-'+call,{
        local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:call});
}
function replay() {
    const s=fresh();s.id=saved.captured_local_session_id;s.provider_session_id=saved.captured_provider_session_id;
    for(const turn of saved.turns_before_attempt)appendTurn(s,turn);
    return s;
}
function assertPendingOnly(s,result) {
    assert.equal(result.owner_approved,false);assert.equal(result.submission_status,'UNSUBMITTED');
    assert.deepEqual(result.external_actions,[]);assert.equal(s.approved,false);assert.equal(s.evidence_reviewed,false);
    assert.equal(s.provider_release_verified,false);assert.equal(s.provider_transcript_verified,false);
    assert.equal(s.submission_status,'UNSUBMITTED');assert.deepEqual(s.decisions,[]);assert.deepEqual(s.external_actions,[]);
    assert.throws(()=>approve(s));
}
function assertFormatProvenance(binding,raw,derived,turns) {
    const source=turns.find(t=>t.id===binding.visitor_message_id);
    assert.ok(source);assert.equal(source.role,'user');assert.equal(binding.rule,'PRESERVE_FULL_VERBATIM_EVIDENCE');
    assert.equal(binding.field_id,raw.field_id);assert.equal(binding.original_value,raw.value);
    assert.equal(binding.source_sha256,digest(source));
    assert.equal(source.content.slice(binding.evidence_start,binding.evidence_end),raw.evidence);
    assert.equal(source.content.slice(binding.value_start,binding.value_end),raw.value);
    assert.ok(binding.evidence_start<=binding.value_start);assert.ok(binding.value_end<=binding.evidence_end);
    assert.equal(derived.evidence,raw.evidence);assert.equal(derived.value,raw.evidence);
    assert.equal(derived.visitor_message_id,source.id);
}

test('saved six-row replay repairs format and sources, then retains current facts with complete partition audit',()=>{
    const fixtureBefore=JSON.stringify(saved),s=replay(),turnsBefore=JSON.stringify(s.turns),raw=structuredClone(saved.original_proposals);
    assert.equal(s.turns.length,6);assert.equal(digest(s.turns),saved.turns_sha256);
    assert.deepEqual(saved.captured_result.issues.filter(i=>i.problems.includes('VALUE_MUST_EQUAL_EXACT_EVIDENCE')).map(i=>i.index),[1,4]);
    const result=apply(s,raw,saved.tool_call_id,saved.fields),attempt=s.handoff_binding_attempts[0];
    assert.equal(result.accepted,true);assert.equal(result.status,'PENDING_OWNER_REVIEW');assert.equal(result.accepted_proposal_count,10);
    assert.equal(s.proposals.length,10);assert.equal(attempt.applied,true);
    assert.deepEqual(attempt.format_bindings.map(b=>b.resolved_index),[1,4]);
    for(const b of attempt.format_bindings)assertFormatProvenance(b,raw[b.resolved_index],attempt.resolved_proposals[b.resolved_index],s.turns);
    assert.deepEqual(attempt.bindings.map(b=>b.index),[5]);
    const source=s.turns.at(-1),binding=attempt.bindings[0];
    assert.equal(binding.from_message_id,raw[5].visitor_message_id);assert.equal(binding.to_message_id,source.id);
    assert.equal(binding.source_sha256,digest(source));assert.equal(source.content.slice(binding.start,binding.end),raw[5].evidence);
    assert.equal(attempt.resolved_proposals[5].visitor_message_id,source.id);
    assert.equal(attempt.resolved_proposals.length,6);assert.deepEqual(attempt.superseded_proposals,[]);
    assert.equal(attempt.selected_proposals.length,10);
    assert.deepEqual(attempt.current_fact_selections.map(row=>row.resolved_index),[0,1,3,4]);
    assert.deepEqual(result.issues,[]);
    for(const {id,...row} of s.proposals){assert.equal(id,digest(row));assertProposal(row,s.turns,saved.fields);}
    assert.ok(s.proposals.some(row=>row.value.includes('that handle quote requests arriving by email.')));
    assert.ok(!s.proposals.some(row=>row.value.includes('We have 6 staff')));
    for(const index of [0,1,3,4])assert.ok(attempt.resolved_proposals[index].evidence.includes('We have 6 staff'));
    assert.deepEqual(attempt.original_proposals,raw);assert.equal(attempt.input_sha256,digest(raw));
    assert.equal(attempt.local_turns_sha256,saved.turns_sha256);assert.equal(s.quarantined_proposals,undefined);
    assert.deepEqual(raw,saved.original_proposals);assert.equal(JSON.stringify(s.turns),turnsBefore);assert.equal(JSON.stringify(saved),fixtureBefore);
    assert.deepEqual(result.format_bindings,attempt.format_bindings);assert.deepEqual(result.reference_bindings,attempt.bindings);
    assert.match(result.visitor_message,/proposals for owner review/);assert.match(result.instruction,/no new proposal is owner-approved/);
    assertPendingOnly(s,result);
    assert.equal(s.receipts.filter(r=>r.kind==='HANDOFF_REFERENCE_BINDING').length,1);
    assert.equal(s.receipts.find(r=>r.kind==='HANDOFF_REFERENCE_BINDING').sha256,digest(attempt));
    const key='offline-format-test-key-with-more-than-32-characters';assert.deepEqual(unseal(seal(s,key),key),s);
});

test('independent exact excerpts preserve complete evidence, punctuation, whitespace and auditable source offsets',()=>{
    for(const [evidence,value] of [
        ['Could you draft a summary for a person to assess?','draft a summary'],
        ['We need a concise account of the current constraints.','current constraints'],
        ['  Please   retain café ☕ drafts.\nHuman review is required.  ','café ☕'],
        ['Our reference is “north–42”; keep the text unchanged.','“north–42”'],
        ['Keep this unsent — perhaps we can review it later.','we can review it'],
    ]) {
        const s=setup('Background. '+evidence+' End of context.'),raw=[p('source',evidence,value)],before=JSON.stringify(raw),turns=JSON.stringify(s.turns);
        const result=apply(s,raw);assert.equal(result.accepted,true,evidence);assert.equal(result.status,'PENDING_OWNER_REVIEW');
        assert.equal(s.proposals.length,1);assert.equal(result.format_bindings.length,1);
        assertFormatProvenance(result.format_bindings[0],raw[0],s.proposals[0],s.turns);
        assert.equal(result.format_bindings[0].evidence_start,'Background. '.length);
        const {id,...proposal}=s.proposals[0];assert.equal(id,digest(proposal));assertProposal(proposal,s.turns,fields);
        assert.equal(JSON.stringify(raw),before);assert.equal(JSON.stringify(s.turns),turns);assertPendingOnly(s,result);
    }
});

test('negation, uncertainty and conditions surrounding a short value remain part of every proposed value',()=>{
    for(const [evidence,value] of [
        ['Do not send customer emails automatically.','send customer emails'],
        ['I do not know whether the supplier portal supports an API.','supports an API'],
        ['Only if the owner approves should the draft go to a customer.','the draft go to a customer'],
        ['We might use a CRM later; for now we only use email.','use a CRM'],
        ['A person must approve every quote before anything is sent.','anything is sent'],
    ]) {
        const s=setup(evidence),raw=[p('source',evidence,value,'constraint')],result=apply(s,raw);
        assert.equal(result.accepted,true,evidence);assert.equal(s.proposals[0].value,evidence);assert.equal(s.proposals[0].evidence,evidence);
        assert.equal(result.format_bindings[0].original_value,value);assertPendingOnly(s,result);
    }
});

test('full valid six-row constructed batches succeed with exact constraints and independent source binding intact',()=>{
    for(const shortValues of [false,true]) {
        const s=replay(),raw=structuredClone(saved.original_proposals),before=JSON.stringify(saved);
        const safeSpans=new Map([
            [0,'They copy details into a spreadsheet, but we sometimes miss requests.'],
            [1,'We want help collecting request details and preparing draft quotes.'],
            [3,'I, I uh have a plumbing supply business called Copper Mesa Supply.'],
            [4,'A person must approve every quote before anything goes to the customer though.'],
        ]);
        for(const [index,evidence] of safeSpans){raw[index].evidence=evidence;raw[index].value=evidence;}
        if(shortValues){raw[1].value='preparing draft quotes';raw[4].value='anything goes to the customer';}
        const original=JSON.stringify(raw),result=apply(s,raw,'constructed-'+shortValues,saved.fields);
        assert.equal(result.accepted,true);assert.equal(result.accepted_proposal_count,6);assert.equal(s.proposals.length,6);
        assert.deepEqual(result.issues,[]);assert.deepEqual(result.reference_bindings.map(b=>b.index),[5]);
        assert.equal(result.format_bindings?.length||0,shortValues?2:0);
        for(const {id,...proposal} of s.proposals){assert.equal(id,digest(proposal));assertProposal(proposal,s.turns,saved.fields);}
        assert.ok(s.proposals[4].value.startsWith('A person must approve every quote'));
        assert.equal(s.proposals[5].value,s.turns.at(-1).content);assert.ok(s.proposals[5].value.includes("I don't know"));
        assert.equal(JSON.stringify(raw),original);assert.equal(JSON.stringify(saved),before);assertPendingOnly(s,result);
    }
});

test('already equal values stay unchanged with no fabricated format audit, including a repeated exact quote',()=>{
    const evidence='Keep the draft unsent.',s=setup(evidence+' '+evidence);appendTurn(s,u('other',evidence));
    const raw=[p('source',evidence)],adapted=preserveQuotedValue(raw,s.turns,fields);
    assert.deepEqual(adapted.proposals,raw);assert.deepEqual(adapted.bindings,[]);
    const result=apply(s,raw);assert.equal(result.accepted,true);assert.equal(result.format_bindings,undefined);
    assert.deepEqual(s.handoff_binding_attempts[0].format_bindings,[]);assert.equal(s.proposals[0].visitor_message_id,'source');
});

test('ambiguous short values and repeated evidence occurrences reject instead of selecting an offset',()=>{
    for(const [content,evidence,value] of [
        ['Retain drafts; review drafts.','Retain drafts; review drafts.','drafts'],
        ['aaaa','aaaa','aa'],
        ['Keep the draft unsent. Keep the draft unsent.','Keep the draft unsent.','draft'],
    ]) {
        const s=setup(content),raw=[p('source',evidence,value)],result=apply(s,raw);
        assert.equal(result.accepted,false);assert.equal(s.proposals.length,0);
        assert.deepEqual(s.handoff_binding_attempts[0].format_bindings,[]);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);
        assert.ok(result.issues.some(i=>i.problems.includes('VALUE_MUST_EQUAL_EXACT_EVIDENCE')));
    }
});

test('format adaptation cannot rescue an unknown, assistant or wrong source, invalid field/schema, or paraphrase',()=>{
    const evidence='Please retain unsent drafts for human review.',valid=p('source',evidence,'unsent drafts');
    const invalid=[
        {...valid,visitor_message_id:'missing'},
        {...valid,visitor_message_id:'user::11111111-1111-4111-8111-111111111111'},
        {...valid,visitor_message_id:'assistant'}, {...valid,visitor_message_id:'other'},
        {...valid,field_id:'invented'}, {...valid,extra:true}, {...valid,evidence:'Please keep unsent drafts for human review.'},
        {...valid,value:'drafts that are unsent'}, {...valid,value:'UNSENT drafts'}, {...valid,value:'  unsent drafts  '},
        {...valid,value:'unsent  drafts'}, {...valid,value:''}, {...valid,value:' '}, {...valid,value:null},
        {...valid,evidence:''}, {...valid,evidence:'x'.repeat(4001)},null,
    ];
    for(const row of invalid) {
        const s=setup(evidence);appendTurn(s,u('other','Our portal capabilities are unknown.'));
        appendTurn(s,{id:'assistant',role:'persona',content:evidence});
        const raw=[row],result=apply(s,raw);assert.equal(result.accepted,false,JSON.stringify(row));assert.equal(s.proposals.length,0);
        assert.deepEqual(s.handoff_binding_attempts[0].format_bindings,[]);assert.deepEqual(s.handoff_binding_attempts[0].bindings,[]);
        assert.deepEqual(s.handoff_binding_attempts[0].original_proposals,raw);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);
        assertPendingOnly(s,result);
    }
    for(const raw of [[],{},null,Array(25).fill(valid)]) {
        const s=setup(evidence),result=apply(s,raw);assert.equal(result.accepted,false);assert.equal(s.proposals.length,0);
        assert.deepEqual(s.handoff_binding_attempts[0].format_bindings,[]);
    }
});

test('one valid format adaptation never partially accepts a batch with an invalid sibling',()=>{
    const s=setup(),evidence=s.turns[0].content,raw=[p('source',evidence,'unsent draft'),p('source',evidence,'Send it immediately.','constraint')];
    const historic={request_id:'historic',proposals:[{evidence:'Prior rejected input.'}],reason:'retained'};
    s.quarantined_proposals=[structuredClone(historic)];const result=apply(s,raw),attempt=s.handoff_binding_attempts[0];
    assert.equal(result.accepted,false);assert.equal(s.proposals.length,0);assert.equal(attempt.applied,false);
    assert.equal(attempt.format_bindings.length,1);assert.equal(result.format_bindings,undefined);
    assert.deepEqual(attempt.original_proposals,raw);assert.deepEqual(s.quarantined_proposals,[historic,{request_id:'request-format-call',proposals:raw,reason:result.reason}]);
    assert.match(result.instruction,/Do not retry/);assertPendingOnly(s,result);
});

test('format audit indexes the resolved row after an earlier exact speech-fragment projection expands',()=>{
    const s=fresh();appendTurn(s,u('user::a','We use email.'));appendTurn(s,u('user::b','We use a spreadsheet.'));
    appendTurn(s,u('source','Do not send drafts without owner review.'));
    const raw=[p('user::a','We use email. We use a spreadsheet.'),p('source',s.turns[2].content,'send drafts','constraint')];
    const before=JSON.stringify(raw),result=apply(s,raw),attempt=s.handoff_binding_attempts[0];
    assert.equal(result.accepted,true);assert.equal(s.proposals.length,3);assert.equal(result.fragment_bindings[0].index,0);
    assert.equal(result.format_bindings[0].resolved_index,2);
    assertFormatProvenance(result.format_bindings[0],raw[1],attempt.resolved_proposals[2],s.turns);
    assert.deepEqual(s.proposals.map(row=>row.value),s.turns.map(turn=>turn.content));
    assert.equal(JSON.stringify(raw),before);assert.deepEqual(attempt.original_proposals,raw);assertPendingOnly(s,result);
});

test('format repair cannot bypass lifecycle restrictions and failed duplicate calls never re-execute',()=>{
    for(const status of ['RESERVED','TOKEN_READY','CLOSING_PENDING']) {
        const s=setup('Drafts stay local until reviewed.'),raw=[p('source',s.turns[0].content,'stay local')];s.status=status;
        const result=apply(s,raw);assert.equal(result.accepted,false,status);assert.equal(s.proposals.length,0);
        assert.equal(s.handoff_binding_attempts[0].format_bindings.length,1);assert.equal(s.handoff_binding_attempts[0].applied,false);
        assert.deepEqual(s.quarantined_proposals[0].proposals,raw);assertPendingOnly(s,result);
        s.status='ACTIVE';const before=JSON.stringify(s);assert.deepEqual(apply(s,raw),result);assert.equal(JSON.stringify(s),before);
    }
});

test('call identity, immutable receipts and retained visitor requests prohibit changed input or automatic retries',()=>{
    const s=setup(),raw=[p('source',s.turns[0].content,'unsent draft')],result=apply(s,raw),before=JSON.stringify(s);
    assert.equal(result.accepted,true);assert.equal(s.handoff_requests.length,1);
    assert.deepEqual(apply(s,raw),result);assert.equal(JSON.stringify(s),before);
    assert.throws(()=>apply(s,[p('source',s.turns[0].content)]),/immutable/);assert.equal(JSON.stringify(s),before);
    assert.throws(()=>apply(s,raw,'second-call'),/do not retry/);assert.equal(JSON.stringify(s),before);
    for(const identity of [
        {local_session_id:'other',provider_session_id:'provider',tool_call_id:'foreign'},
        {local_session_id:'local',provider_session_id:'other',tool_call_id:'foreign'},
        {local_session_id:'local',provider_session_id:'provider',tool_call_id:'invalid/id'},
    ])assert.throws(()=>recordProviderHandoffAttempt(s,raw,fields,'foreign',identity),/exact local and provider session/);
    assert.equal(JSON.stringify(s),before);assert.equal(s.handoff_binding_attempts.length,1);
    assert.equal(s.receipts.filter(r=>r.kind==='HANDOFF_REFERENCE_BINDING').length,1);
    raw[0].value='Caller changed the input';result.format_bindings[0].original_value='Caller changed the result';result.accepted=false;
    assert.equal(JSON.stringify(s),before);
    const failed=setup(),bad=[p('source',failed.turns[0].content,'missing excerpt')],rejection=apply(failed,bad);
    assert.equal(rejection.accepted,false);appendTurn(failed,u('later','The missing excerpt is here.'));
    const retained=JSON.stringify(failed);assert.deepEqual(apply(failed,bad),rejection);assert.equal(JSON.stringify(failed),retained);
    assert.throws(()=>apply(failed,bad,'retry-failed'),/do not retry/);assert.equal(JSON.stringify(failed),retained);
});

test('manual verifier still rejects a short value even when provider format adaptation can preserve the full quote',()=>{
    const s=setup(),raw=[p('source',s.turns[0].content,'unsent draft')],before=JSON.stringify(raw);
    assert.throws(()=>assertProposal(raw[0],s.turns,fields),/value must remain verbatim/);
    assert.deepEqual(proposalIssues(raw,s.turns,fields).map(i=>i.problems),[['VALUE_MUST_EQUAL_EXACT_EVIDENCE']]);
    const manual=recordHandoffAttempt(s,raw,fields,'manual');assert.equal(manual.accepted,false);assert.equal(s.proposals.length,0);
    assert.equal(s.handoff_binding_attempts,undefined);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);
    const provider=apply(s,raw);assert.equal(provider.accepted,true);assert.equal(provider.format_bindings.length,1);
    assert.equal(JSON.stringify(raw),before);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);assertPendingOnly(s,provider);
});
