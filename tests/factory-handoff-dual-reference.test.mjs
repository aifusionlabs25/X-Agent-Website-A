import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendTurn,assertProposal,proposalIssues,recordHandoffAttempt,digest} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {contradictingCorrection} from '../lib/factory/handoff-corrections.ts';
import {seal,unseal} from '../lib/factory/store.ts';

const captured=JSON.parse(readFileSync(new URL('./fixtures/factory-handoff-dual-reference-20261112.json',import.meta.url),'utf8'));
const fields=[{id:'constraints',label:'Additional constraints'}];
const fresh=()=>({id:'local',version:1,package_sha256:'offline',persona_id:'persona',launch_label:'offline:dual',status:'ACTIVE',
    provider_session_id:'provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,
    provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]});
const u=(id,content)=>({id,role:'user',content});
const p=(id,evidence,value)=>({field_id:'constraints',visitor_message_id:id,evidence,value});
function setup(text='Only reviewed drafts may leave the office.') {
    const s=fresh();appendTurn(s,u('earlier','We use spreadsheets.'));appendTurn(s,u('source',text));return s;
}
function apply(s,raw,allowed=fields,call='offline-call') {
    return recordProviderHandoffAttempt(s,raw,allowed,'offline-'+call,{local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:call});
}
function checkAudit(s,raw,index=0) {
    const attempt=s.handoff_binding_attempts.at(-1),binding=attempt.bindings.find(b=>b.index===index);
    const format=attempt.format_bindings.find(b=>b.resolved_index===index),source=s.turns.find(t=>t.id===binding.to_message_id);
    assert.equal(source.role,'user');assert.equal(binding.from_message_id,raw[index].visitor_message_id);
    assert.equal(binding.source_sha256,digest(source));assert.equal(source.content.slice(binding.start,binding.end),raw[index].evidence);
    assert.equal(format.visitor_message_id,source.id);assert.equal(format.original_value,raw[index].value);
    assert.equal(format.source_sha256,digest(source));assert.equal(source.content.slice(format.evidence_start,format.evidence_end),raw[index].evidence);
    assert.equal(source.content.slice(format.value_start,format.value_end),raw[index].value);
    assert.equal(attempt.resolved_proposals[index].value,raw[index].evidence);
    assert.equal(attempt.resolved_proposals[index].evidence,raw[index].evidence);
    assertProposal(attempt.resolved_proposals[index],s.turns,allowedFields(s));
    assert.deepEqual(attempt.original_proposals,raw);assert.equal(attempt.input_sha256,digest(raw));
}
const allowedFields=s=>s.id===captured.local_session_id?captured.fields:fields;
function replay() {
    const s=fresh();s.id=captured.local_session_id;s.provider_session_id=captured.provider_session_id;s.launch_label=captured.launch_label;
    for(const turn of captured.turns_before_attempt)appendTurn(s,turn);return s;
}

test('captured correction row composes unique source and exact excerpt proofs, with original rejection retained',()=>{
    const original=JSON.stringify(captured),s=replay(),turns=JSON.stringify(s.turns),raw=[structuredClone(captured.original_attempt.original_proposals[6])];
    assert.deepEqual(proposalIssues(raw,s.turns,captured.fields)[0].problems,['EVIDENCE_NOT_EXACT_SPAN_OF_REFERENCED_MESSAGE','VALUE_MUST_EQUAL_EXACT_EVIDENCE']);
    const strict=recordHandoffAttempt(structuredClone(s),raw,captured.fields,'strict-before');assert.equal(strict.accepted,false);
    const result=apply(s,raw,captured.fields);assert.equal(result.accepted,true);assert.equal(s.proposals.length,1);
    checkAudit(s,raw);assert.equal(s.proposals[0].visitor_message_id,captured.original_attempt.through_visitor_turn_id);
    assert.equal(s.proposals[0].value,captured.turns_before_attempt.at(-1).content);
    assert.equal(JSON.stringify(s.turns),turns);assert.equal(JSON.stringify(captured),original);
    assert.equal(s.handoff_requests,undefined);assert.equal(s.handoff_binding_attempts[0].request_turn_id,null);
    assert.equal(s.approved,false);assert.deepEqual(s.decisions,[]);assert.deepEqual(s.external_actions,[]);
    const key='fictional-dual-reference-key-at-least-32-characters';assert.deepEqual(unseal(seal(s,key),key),s);
});

test('full captured batch repairs the reference and partitions only the superseded count with complete coverage',()=>{
    const original=JSON.stringify(captured),s=replay(),turns=JSON.stringify(s.turns),raw=structuredClone(captured.original_attempt.original_proposals);
    const result=apply(s,raw,captured.fields),attempt=s.handoff_binding_attempts[0];
    assert.equal(result.accepted,true);assert.equal(s.proposals.length,9);assert.equal(attempt.applied,true);
    checkAudit(s,raw,6);assert.equal(attempt.bindings.length,1);assert.equal(attempt.format_bindings.length,7);
    assert.deepEqual(result.issues,[]);assert.deepEqual(attempt.current_fact_selections.map(b=>b.resolved_index),[0,3]);
    assert.equal(attempt.resolved_proposals[6].evidence,s.turns.at(-1).content);
    // Full earlier quotes remain audit data. Only the proven count frame is
    // removed; both residual spans retain their exact field and source identity.
    for(const b of attempt.current_fact_selections) {
        const source=s.turns.find(t=>t.id===b.original.visitor_message_id);
        assert.equal(b.removed_span.text,'We have 6 staff');assert.equal(b.source_sha256,digest(source));
        const spans=[{...b.removed_span,text:b.removed_span.text},...b.retained_spans.map(row=>({...row,text:row.proposal.evidence}))].sort((a,b)=>a.start-b.start);
        let cursor=b.evidence_start;
        for(const span of spans){assert.equal(span.start,cursor);assert.equal(source.content.slice(span.start,span.end),span.text);cursor=span.end;}
        assert.equal(cursor,b.evidence_end);assert.equal(spans.map(span=>span.text).join(''),b.original.evidence);
        for(const row of b.retained_spans){assert.equal(row.proposal.field_id,b.original.field_id);assert.equal(row.proposal.visitor_message_id,source.id);}
    }
    assert.deepEqual(attempt.original_proposals,raw);assert.equal(s.quarantined_proposals,undefined);
    assert.ok(attempt.resolved_proposals[0].value.includes('We have 6 staff'));
    assert.ok(attempt.resolved_proposals[0].value.includes('Sometimes requests get missed'));
    assert.ok(s.proposals.every(p=>!p.value.includes('We have 6 staff')));
    assert.ok(s.proposals.some(p=>p.value.includes('handling quote requests by email and they copy the details into Excel')));
    assert.ok(s.proposals.some(p=>p.value.includes('Sometimes requests get missed')));
    assert.ok(s.proposals.some(p=>p.value.includes('person reviewing every quote')));
    assert.ok(s.proposals.some(p=>p.value.includes('Budget and timing are still unknown')));
    assert.ok(s.proposals.some(p=>p.value.includes('4 staff')&&p.value.includes("don't know whether it has an API")));
    for(const {id,...proposal} of s.proposals){assert.equal(id,digest(proposal));assertProposal(proposal,s.turns,captured.fields);}
    assert.equal(s.handoff_requests,undefined);assert.equal(s.approved,false);assert.deepEqual(s.decisions,[]);
    assert.equal(JSON.stringify(s.turns),turns);assert.equal(JSON.stringify(captured),original);
});

test('direct same-unit numeric sentences block stale counts without requiring a correction marker',()=>{
    for(const [oldCount,newCount,unit] of [[11,7,'operators'],[5,3,'stations'],[9,4,'staff']]) {
        const before=u('before',`We have ${oldCount} ${unit} handling orders. The portal is unchanged.`);
        const correction=u('after',`Yes, there is another detail. ${newCount} ${unit} handle those orders, not ${oldCount}. The API is unknown.`);
        const turns=[before,correction],snapshot=JSON.stringify(turns);
        assert.equal(contradictingCorrection(turns,before.id,before.content),correction);
        assert.equal(contradictingCorrection(turns,before.id,'The portal is unchanged.'),null);
        assert.equal(contradictingCorrection(turns,before.id,`We have ${oldCount} locations.`),null);
        assert.equal(JSON.stringify(turns),snapshot);
    }
    for(const text of ['Maybe. 4 staff handle orders, not 6.','If needed. 4 staff handle orders, not 6.',
        'Please ignore this. 4 staff handle orders, not 6.','The report reads. 4 staff handle orders, not 6.',
        'The document states: 4 staff handle orders, not 6.','"4 staff handle orders, not 6."',
        'Could it be 4 staff, not 6?','4 locations handle orders, not 6.','4 staff and 3 staff, not 6.']) {
        const turns=[u('before','We have 6 staff handling orders.'),u('after',text)];
        assert.equal(contradictingCorrection(turns,'before',turns[0].content),null,text);
    }
});

test('unseen compound restrictions and uncertainties preserve the whole source after a wrong reference',()=>{
    for(const [quote,value] of [
        ['Do not contact the customer; only prepare a draft.','contact the customer'],
        ['The portal might support exports, but nobody has confirmed that.','support exports'],
        ['Our reference is café–72. Human approval is still required.','café–72'],
        ['We use three stations; the replacement order has not been approved.','replacement order'],
    ]) {
        const s=setup('Background. '+quote+' End.'),raw=[p('earlier',quote,value)],original=JSON.stringify(raw);
        const result=apply(s,raw);assert.equal(result.accepted,true,quote);checkAudit(s,raw);
        assert.equal(s.proposals[0].value,quote);assert.equal(JSON.stringify(raw),original);
        assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
    }
});

test('combined errors never select ambiguous sources, occurrences, values or unknown non-native identities',()=>{
    const quote='Only reviewed drafts may leave the office.',short='reviewed drafts';
    for(const mode of ['two-sources','two-occurrences','repeated-value','unknown','assistant','foreign']) {
        const s=setup(mode==='two-occurrences'?quote+' '+quote:quote);
        let raw=p('earlier',quote,short);
        if(mode==='two-sources')appendTurn(s,u('duplicate',quote));
        if(mode==='repeated-value'){s.turns[1].content='Review drafts and retain drafts.';raw=p('earlier',s.turns[1].content,'drafts');}
        if(mode==='unknown')raw.visitor_message_id='missing';
        if(mode==='assistant'){appendTurn(s,{id:'persona',role:'persona',content:quote});raw.visitor_message_id='persona';}
        if(mode==='foreign')raw.visitor_message_id='another-session-user';
        const result=apply(s,[raw]);assert.equal(result.accepted,false,mode);assert.equal(s.proposals.length,0);
        assert.deepEqual(s.handoff_binding_attempts[0].bindings,[]);assert.deepEqual(s.handoff_binding_attempts[0].format_bindings,[]);
        assert.deepEqual(s.quarantined_proposals[0].proposals,[raw]);
    }
});

test('paraphrases, invented fields and malformed values cannot piggyback on exact source resolution',()=>{
    const quote='Only reviewed drafts may leave the office.',valid=p('earlier',quote,'reviewed drafts');
    for(const row of [{...valid,value:'approved drafts'},{...valid,value:'REVIEWED drafts'},{...valid,value:''},{...valid,value:null},
        {...valid,field_id:'invented'},{...valid,extra:true},{...valid,evidence:quote+' Send now.'},{...valid,evidence:''}]) {
        const s=setup(quote),result=apply(s,[row]);assert.equal(result.accepted,false,JSON.stringify(row));
        assert.equal(s.proposals.length,0);assert.deepEqual(s.handoff_binding_attempts[0].bindings,[]);
        assert.deepEqual(s.handoff_binding_attempts[0].format_bindings,[]);assert.deepEqual(s.quarantined_proposals[0].proposals,[row]);
    }
});

test('dual-error composition does not reconstruct fragmented evidence or partially accept an invalid sibling',()=>{
    const s=setup('We retain drafts.');appendTurn(s,u('source2','They need approval.'));
    const raw=[p('earlier','We retain drafts. They need approval.','retain drafts')],result=apply(s,raw);
    assert.equal(result.accepted,false);assert.deepEqual(s.handoff_binding_attempts[0].fragment_bindings,[]);
    const mixed=setup(),rows=[p('earlier',mixed.turns[1].content,'reviewed drafts'),p('earlier','Invented exact words.','exact words')];
    assert.equal(apply(mixed,rows).accepted,false);assert.equal(mixed.proposals.length,0);
    assert.equal(mixed.handoff_binding_attempts[0].bindings.length,1);assert.equal(mixed.handoff_binding_attempts[0].format_bindings.length,1);
    assert.deepEqual(mixed.quarantined_proposals[0].proposals,rows);
});

test('manual validation remains strict and historical failed tool identity is never retried',()=>{
    const s=replay(),raw=captured.original_attempt.original_proposals;
    s.handoff_binding_attempts=[structuredClone(captured.original_attempt)];
    const before=JSON.stringify(s),result=apply(s,raw,captured.fields,captured.original_attempt.tool_call_id);
    assert.deepEqual(result,captured.original_attempt.result);assert.equal(result.accepted,false);assert.equal(JSON.stringify(s),before);
    const row=raw[6];assert.throws(()=>assertProposal(row,s.turns,captured.fields));
    const manual=recordHandoffAttempt(structuredClone(s),[row],captured.fields,'manual-only');assert.equal(manual.accepted,false);
    const freshState=setup(),input=[p('earlier',freshState.turns[1].content,'reviewed drafts')];
    const first=apply(freshState,input),saved=JSON.stringify(freshState);assert.equal(first.accepted,true);
    assert.deepEqual(apply(freshState,input),first);assert.equal(JSON.stringify(freshState),saved);
    assert.throws(()=>apply(freshState,[{...input[0],value:input[0].evidence}]),/immutable/);
});
