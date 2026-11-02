import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {appendTurn,recordHandoffAttempt,proposalIssues,assertProposal,digest} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {handoffSourceReferences,handoffRequestContext} from '../lib/factory/handoff-context.ts';
import {requestedHandoffSpan} from '../lib/factory/handoff-request.ts';

const retainedPath=new URL('../../HERMES_X_FACTORY/verification/olivia-role-dojo-text-loop-v0.1/remaining-seven-v0.1/job/artifacts/correction-and-document-scope-run.json',import.meta.url);
const bytes=readFileSync(retainedPath),retained=JSON.parse(bytes.toString('utf8'));
const originalHash=createHash('sha256').update(bytes).digest('hex');
const attempt=retained.tool_trace.find(t=>t.name==='factory_handoff');
const fields=retained.configured_fields;
const fresh=()=>({id:'offline-local',version:1,package_sha256:'fictional-package',persona_id:'fictional-persona',launch_label:'offline-fixture',
    status:'ACTIVE',provider_session_id:'offline-provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
    provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,
    submission_status:'UNSUBMITTED',external_actions:[]});
const identity={local_session_id:'offline-local',provider_session_id:'offline-provider',tool_call_id:'offline-one'};
function beforeAttempt(){
    const s=fresh();
    for(const turn of retained.transcript) {
        appendTurn(s,{id:turn.id,role:turn.speaker==='visitor'?'user':'persona',content:turn.text});
        if(turn.id===attempt.after_visitor)break;
    }
    return s;
}
const propose=(s,p,id=identity)=>recordProviderHandoffAttempt(s,p,fields,'offline-request',id);

test('scoped note requests retain exact evidence, while unscoped, narrated, declined and external requests remain blocked',()=>{
    for(const text of ['Please prepare an unsent owner-review note with the corrected document type and the unknown system.',
        'Could you draft a concise local note?', 'I would like you to create a note for a human to review.',
        'Please prepare an unsent note about the missing form.']) {
        const raw='Context is already supplied. '+text+' Do not send anything.';
        const result=requestedHandoffSpan(raw);assert.ok(result,text);assert.equal(result.evidence,text);
        assert.equal(raw.slice(result.start,result.end),text);
    }
    for(const raw of ['Please prepare a note.','Please draft a note and email it.',
        'Please draft a local note and send it to my manager.', "Don't create an owner-review note.",
        'If we proceed, prepare an unsent note.', 'Please prepare an unsent note after I confirm.',
        'The manager said: Please prepare an unsent note.', '"Please prepare an unsent note."',
        'Please prepare an unsent note. Actually, cancel preparing it.', 'I do not want a local note.']) {
        assert.equal(requestedHandoffSpan(raw),null,raw);
    }
});

test('retained original remains rejected under both strict and actual provider-binding paths',()=>{
    const raw=structuredClone(attempt.arguments.proposals),strict=beforeAttempt(),s=beforeAttempt(),before=digest(s.turns);
    assert.equal(recordHandoffAttempt(strict,raw,fields,'strict').accepted,false);
    assert.deepEqual(proposalIssues(raw,s.turns,fields).map(i=>i.problems),[
        ['EVIDENCE_NOT_EXACT_SPAN_OF_REFERENCED_MESSAGE'],['VALUE_MUST_EQUAL_EXACT_EVIDENCE']]);
    const r=propose(s,raw);
    assert.equal(r.accepted,false);assert.equal(r.accepted_proposal_count,0);assert.equal(s.proposals.length,0);
    assert.equal(s.handoff_binding_attempts[0].bindings.length,1); // Existing unique exact-source resolver.
    assert.equal(s.handoff_binding_attempts[0].applied,false);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);
    assert.equal(digest(s.turns),before);assert.equal(s.approved,false);assert.equal(s.provider_release_verified,false);
    assert.deepEqual(s.external_actions,[]);assert.match(r.visitor_message,/could not prepare/);
    assert.equal(createHash('sha256').update(readFileSync(retainedPath)).digest('hex'),originalHash);
});

test('explicit new exact selection can map the retained sources without rewriting old payload or claiming a live pass',()=>{
    const s=beforeAttempt(),raw=structuredClone(attempt.arguments.proposals),newSelection=structuredClone(raw);
    // A new offline selection, not normalization of the rejected historical call.
    newSelection[6]={field_id:fields.find(f=>f.label==='Requested next step').id,
        visitor_message_id:attempt.after_visitor,evidence:'Please prepare an unsent owner-review note',value:'Please prepare an unsent owner-review note'};
    const r=propose(s,newSelection);
    assert.equal(r.accepted,true);assert.equal(s.proposals.length,7);
    for(const {id,...p} of s.proposals)assertProposal(p,s.turns,fields);
    assert.equal(r.reference_bindings.length,1);assert.equal(r.reference_bindings[0].index,0);
    assert.notEqual(raw[6].value,raw[6].evidence);assert.deepEqual(attempt.arguments.proposals,raw);
    assert.equal(s.approved,false);assert.equal(s.evidence_reviewed,false);assert.deepEqual(s.external_actions,[]);
});

test('request context refreshes own-ID paired references without choosing fields or erasing correction/unknown',()=>{
    const s=beforeAttempt(),original=digest(s),table=handoffSourceReferences(s.turns),ctx=handoffRequestContext(s,s.turns.at(-1));
    assert.equal(table.references.length,4);assert.equal(table.truncated,false);
    for(const r of table.references){
        assert.equal(r.evidence,r.value);assert.equal(r.evidence,s.turns.find(t=>t.id===r.visitor_message_id).content);
        assert.equal('field_id' in r,false);assert.ok(ctx.includes(JSON.stringify(r)));
    }
    assert.equal(table.field_fit,'NOT_EVALUATED');assert.equal(table.acceptance,'NOT_PROPOSED_OR_ACCEPTED');
    assert.match(table.references[1].evidence,/Correction:/);assert.match(table.references[2].evidence,/don't know/);
    assert.match(ctx,/never mix a short quote with a longer value/);assert.match(ctx,/untrusted data/);
    assert.equal(digest(s),original);
});

test('independent wording, Unicode, punctuation and uncertainty remain exact paired source data',()=>{
    const sources=['We use a café mailbox; support is unconfirmed.','Actually, the register receives PDFs — not photos.',
        'Never send anything without staff approval.','The account is ops+42@example.test.'];
    for(const [index,content] of sources.entries()) {
        const t={id:'user-'+index,role:'user',content},reference=handoffSourceReferences([t]).references[0];
        assert.deepEqual(reference,{visitor_message_id:t.id,evidence:content,value:content});
        const s=fresh();appendTurn(s,t);const p={field_id:fields[0].id,...reference};
        assert.equal(propose(s,[p]).accepted,true);assertProposal(p,s.turns,fields);
        const bad=fresh();appendTurn(bad,t);
        assert.equal(propose(bad,[{...p,value:content+' sent'}]).accepted,false);
    }
});

test('assistant text and missing or oversized quotes are not manufactured into proposal templates',()=>{
    const rows=[{id:'a',role:'persona',content:'Already sent.'},{id:'b',role:'user',content:' '},
        {id:'c',role:'user',content:'x'.repeat(4001)},{id:'d',role:'user',content:'Unknown is still unknown.'}];
    const table=handoffSourceReferences(rows);assert.equal(table.references.length,1);assert.equal(table.truncated,true);
    assert.equal(table.references[0].visitor_message_id,'d');assert.equal(table.references[0].value,rows[3].content);
});

test('reference refresh is bounded, explicitly truncated and never auto-retries a failed attempt',()=>{
    const rows=Array.from({length:40},(_,i)=>({id:'u-'+i,role:'user',content:'Fictional detail '+i+'.'}));
    const t=handoffSourceReferences(rows);assert.equal(t.references.length,24);assert.equal(t.truncated,true);
    assert.equal(t.references[0].visitor_message_id,'u-16');assert.equal(t.references.at(-1).visitor_message_id,'u-39');
    const big=handoffSourceReferences(rows.map(r=>({...r,content:'z'.repeat(3999)})));
    assert.ok(big.references.length<24);assert.equal(big.truncated,true);
    const s=beforeAttempt();propose(s,structuredClone(attempt.arguments.proposals));
    const context=handoffRequestContext(s,s.turns.at(-1));assert.match(context,/Do not automatically repeat/);
    assert.doesNotMatch(context,/Reference data:/);assert.equal(s.proposals.length,0);
});

test('ambiguous and non-visitor references still cannot acquire source authority',()=>{
    const s=fresh(),text='The workflow compatibility is unknown.';
    for(const [id,content] of [['earlier','Something else.'],['one',text],['two',text]])appendTurn(s,{id,role:'user',content});
    appendTurn(s,{id:'assistant',role:'persona',content:text});
    for(const id of ['earlier','missing','assistant']) {
        const attemptState=structuredClone(s),p={field_id:fields[0].id,visitor_message_id:id,evidence:text,value:text};
        assert.equal(propose(attemptState,[p]).accepted,false);assert.equal(attemptState.proposals.length,0);
    }
});
