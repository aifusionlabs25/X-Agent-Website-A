import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendTurn,assertProposal,digest,decide} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {selectCurrentProposals} from '../lib/factory/handoff-current.ts';
import {requestedHandoffSpan} from '../lib/factory/handoff-request.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/factory-saved-merge-20261115.json',import.meta.url),'utf8'));
const fields=fixture.manifest.configured_fields;
const fresh=()=>({...fixture.identity,status:'ACTIVE',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
    provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,
    submission_status:'UNSUBMITTED',external_actions:[]});
const apply=(s,input,id)=>recordProviderHandoffAttempt(s,input,fields,id,
    {local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:id});
const proposal=(t,evidence=t.content)=>({field_id:fields[0].id,visitor_message_id:t.id,evidence,value:evidence});
function appendThrough(s,id) {
    const last=fixture.turns.findIndex(t=>t.id===id);
    for(const t of fixture.turns.slice(s.turns.length,last+1))appendTurn(s,structuredClone(t));
}
function firstReceipt() {
    const s=fresh(),attempt=fixture.attempts[0];appendThrough(s,attempt.through_visitor_turn_id);
    assert.equal(digest(s.turns),attempt.local_turns_sha256);
    assert.equal(apply(s,structuredClone(attempt.original_proposals),attempt.tool_call_id).accepted,true);
    assert.equal(s.handoff_binding_attempts[0].request_turn_id,'user::e080111b-d5d6-49f3-b4bf-80959a850b1f');
    assert.deepEqual(s.proposals,fixture.expected_original_proposals);
    return s;
}
function auditPartition(a,s) {
    const p=a.current_fact_selection,source=s.turns.find(t=>t.id===p.original.visitor_message_id);
    assert.equal(p.source_sha256,digest(source));
    assert.equal(p.correction_turn_sha256,digest(p.correction_turn));
    let cursor=p.evidence_start;
    for(const span of [p.removed_span,...p.retained_spans].sort((a,b)=>a.start-b.start)) {
        assert.equal(span.start,cursor);cursor=span.end;
        assert.equal(source.content.slice(span.start,span.end),span.text??span.proposal.evidence);
    }
    assert.equal(cursor,p.evidence_end);
    for(const span of p.retained_spans) {
        assert.equal(span.proposal.value,span.proposal.evidence);
        assert.equal(span.proposal.field_id,p.original.field_id);
        assertProposal(span.proposal,s.turns,fields);
    }
}

test('saved live amendment replaces only the count and preserves other details, both receipts and raw history',()=>{
    const s=firstReceipt(),old=structuredClone(s.proposals[0]),other=structuredClone(s.proposals.slice(1));
    const originalAttempt=structuredClone(s.handoff_binding_attempts[0]),originalReceipts=structuredClone(s.receipts);
    // Owner decisions are simulated in memory only, to test non-transfer.
    s.provider_transcript_verified=true;decide(s,old.id,'ACCEPT',fields);
    const oldDecision=structuredClone(s.decisions[0]);
    const next=fixture.attempts[1];appendThrough(s,next.through_visitor_turn_id);
    assert.equal(digest(s.turns),next.local_turns_sha256);
    const raw=structuredClone(next.original_proposals),original=JSON.stringify(raw),turns=JSON.stringify(s.turns);
    const result=apply(s,raw,next.tool_call_id);
    assert.equal(result.accepted,true);assert.equal(result.status,'PENDING_OWNER_REVIEW');
    assert.equal(s.handoff_binding_attempts.at(-1).request_turn_id,next.through_visitor_turn_id);
    assert.equal(JSON.stringify(raw),original);assert.equal(JSON.stringify(s.turns),turns);
    assert.deepEqual(s.handoff_binding_attempts[0],originalAttempt);
    for(const receipt of originalReceipts)assert.ok(s.receipts.some(r=>JSON.stringify(r)===JSON.stringify(receipt)));
    assert.equal(s.receipts.filter(r=>r.kind==='HANDOFF_REFERENCE_BINDING').length,2);
    for(const p of other)assert.ok(s.proposals.some(q=>JSON.stringify(q)===JSON.stringify(p)));
    for(const p of raw)assert.ok(s.proposals.some(q=>q.evidence===p.evidence&&q.field_id===p.field_id));
    assert.ok(!s.proposals.some(p=>p.id===old.id));
    assert.ok(s.proposals.some(p=>p.evidence==="We're a plumbing supply business. "));
    assert.ok(s.proposals.some(p=>p.evidence===' handling quote requests by email and we track them in Excel.'));
    assert.equal(s.superseded_mappings.length,1);
    const archived=s.superseded_mappings[0];assert.deepEqual(archived.proposal,old);
    assert.deepEqual(archived.prior_decision,oldDecision);auditPartition(archived,s);
    assert.equal(archived.current_fact_selection.removed_span.text,'We got 6 staff');
    for(const {id,...p} of s.proposals){assert.equal(id,digest(p));assertProposal(p,s.turns,fields);}
    assert.ok(!s.decisions.some(d=>s.proposals.some(p=>p.id===d.proposal_id&&raw.some(r=>r.evidence===p.evidence))));
    assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);assert.equal(s.submission_status,'UNSUBMITTED');
    const after=JSON.stringify(s);assert.deepEqual(apply(s,raw,next.tool_call_id),result);assert.equal(JSON.stringify(s),after);
});

test('possessive counts retain exact offsets across actors, contractions and digit/word forms',()=>{
    for(const [oldText,correction] of [
        ['We got six staff handling requests.','Correction: we have four staff, not six.'],
        ["We've got eight analysts reviewing invoices.",'Correction: we have three analysts, not eight.'],
        ['We have got 11 coordinators sorting returns.','Correction: we have nine coordinators, not eleven.'],
        ['They’ve got seven operators checking requests.','Correction: they have five operators, not seven.'],
        ['I got 14 assistants preparing forms.','Correction: I have six assistants, not fourteen.'],
    ]) {
        const s=fresh(),old={id:'source',role:'user',content:oldText},now={id:'correction',role:'user',content:correction};
        appendTurn(s,old);appendTurn(s,now);
        const selected=selectCurrentProposals([proposal(old),proposal(now)],s.turns,fields);
        assert.equal(selected.current_fact_selections.length,1,oldText);
        assert.ok(!selected.selected.some(p=>p.evidence===oldText));
        assert.ok(selected.selected.some(p=>p.evidence===correction));
        for(const p of selected.selected)assertProposal(p,s.turns,fields);
    }
});

test('uncertain, temporal, narrated, negated, mixed-actor or qualified counts stay blocked instead of losing context',()=>{
    for(const text of [
        'If we got 6 staff handling requests, we could help.',
        'We only got 6 staff handling requests.',
        'Yesterday we got 6 staff handling requests.',
        'We got 6 staff handling requests temporarily.',
        'We previously got 6 staff handling requests.',
        'We got 6 staff from the other branch.',
        'We got 6 staff handling 3 request types.',
        'We never got 6 staff handling requests.',
        'They said we got 6 staff handling requests.',
        '"We got 6 staff handling requests."',
        'We got 6 staff handling requests if the contract closes.',
    ]) {
        const turns=[{id:'old',role:'user',content:text},{id:'new',role:'user',content:'Correction: we have four staff, not six.'}];
        const result=selectCurrentProposals(turns.map(t=>proposal(t)),turns,fields);
        assert.equal(result.current_fact_selections.length,0,text);
        assert.ok(result.selected.some(p=>p.evidence===text));
    }
    for(const [source,correction] of [
        ['We got 6 staff handling requests.','Correction: they have four staff, not six.'],
        ['They got 6 staff handling requests.','Correction: we have four staff, not six.'],
        ["We've got 6 staff handling requests.","Correction: they've got four staff, not six."],
        ['We got 6 staff handling requests.','Correction: we have four offices, not six.'],
    ]) {
        const turns=[{id:'old',role:'user',content:source},{id:'new',role:'user',content:correction}];
        assert.equal(selectCurrentProposals(turns.map(t=>proposal(t)),turns,fields).current_fact_selections.length,0,correction);
    }
});

test('punctuated scope continuations bind one exact local request without normalizing words or borrowing later consent',()=>{
    for(const raw of [
        'Yes, please prepare those details. as an unsent brief for human review.',
        'Please draft this. for the owner to review.',
        'Can you prepare that! as a local summary.',
        '  Please create these details. as a human-review note.  ',
    ]) {
        const span=requestedHandoffSpan(raw);assert.ok(span,raw);
        assert.equal(span.evidence,raw.slice(span.start,span.end));
        assert.equal(span.evidence,raw.trim());
    }
    for(const raw of [
        'Please prepare those details. as an unsent brief if I approve.',
        'Prepare those details. As an unsent brief for human review, if I agree later.',
        'Prepare those details. As an unsent brief for human review, maybe tomorrow.',
        'Prepare those details. As an unsent brief for human review, according to what she said.',
        'Please prepare those details. as an unsent brief. Only if I agree.',
        'Please prepare those details. as an unsent brief. Then email it.',
        'Please prepare those details. as an unsent brief and send it.',
        'Please prepare those details. as an unsent brief. Actually, do not prepare it.',
        'Please prepare those details. as an unsent brief. Wait.',
        'Please prepare those details. as an unsent brief. Maybe.',
        'Please prepare those details. as an unsent brief. No.',
        'Please prepare those details. as an unsent brief. Not until I approve.',
        'Please prepare those details. as an unsent brief. I changed my mind.',
        'Please prepare those details. "as an unsent brief."',
        '"Please prepare those details." as an unsent brief.',
        'They said: Please prepare those details. as an unsent brief.',
        'Please prepare those details. This is an unsent brief.',
        'Please prepare that parcel. as an unsent brief.',
        'Please prepare those details. Pricing is unknown. as an unsent brief.',
    ]) assert.equal(requestedHandoffSpan(raw),null,raw);
    assert.equal(requestedHandoffSpan('Please prepare those details.'),null);
    assert.equal(requestedHandoffSpan('as an unsent brief for human review.',{precedingTurn:{id:'prior',role:'user',content:'Please prepare those details.'}}),null);
    assert.equal(requestedHandoffSpan('Please update the same brief and keep the other details.'),null);
    assert.ok(requestedHandoffSpan('Please update the same brief and keep the other details.',{hasSuccessfulHandoff:true}));
});

test('the same saved correction with an invalid sibling is rejected atomically without retiring stored details',()=>{
    for(const invalid of ['unknown-field','invented-value','unknown-source','cropped-correction']) {
        const s=firstReceipt(),before=structuredClone(s.proposals),next=fixture.attempts[1];appendThrough(s,next.through_visitor_turn_id);
        const input=structuredClone(next.original_proposals);
        if(invalid==='unknown-field')input.push({...input[1],field_id:'unconfigured'});
        if(invalid==='invented-value')input[0].value='four employees';
        if(invalid==='unknown-source')input[0].visitor_message_id='other-session';
        if(invalid==='cropped-correction')input[0].value=input[0].evidence='4 staff';
        assert.equal(apply(s,input,'invalid-'+invalid).accepted,false,invalid);
        assert.deepEqual(s.proposals,before);assert.equal(s.superseded_mappings?.length||0,0);
        assert.deepEqual(s.handoff_binding_attempts.at(-1).original_proposals,input);
        assert.equal(s.approved,false);
    }
});
