import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendTurn,assertProposal,decide,digest,approve} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {requestedHandoffSpan} from '../lib/factory/handoff-request.ts';
import {contradictingCorrection,exactCorrectionWitness} from '../lib/factory/handoff-corrections.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/factory-amend-accepted-20261114.json',import.meta.url),'utf8'));
const user=(id,content)=>({id,role:'user',content});
const fields=[{id:'work',label:'Current workflow'},{id:'goal',label:'Goal'},{id:'limits',label:'Unknowns and restrictions'}];
const proposal=(turn,field_id='work',evidence=turn.content)=>({field_id,visitor_message_id:turn.id,evidence,value:evidence});
const fresh=()=>({id:'synthetic-amendment',version:1,package_sha256:'synthetic-package',persona_id:'synthetic-persona',
    launch_label:'fixture:amendment',status:'ACTIVE',provider_session_id:'synthetic-provider',turns:[],proposals:[],
    decisions:[],receipts:[],processed:[],provider_release_verified:false,provider_transcript_verified:false,
    evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]});
const apply=(s,input,id='update',configured=fields)=>recordProviderHandoffAttempt(s,input,configured,id,
    {local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:id});
function auditArchive(archive,turns,configured) {
    const proof=archive.current_fact_selection,source=turns.find(t=>t.id===archive.proposal.visitor_message_id);
    assert.equal(proof.source_sha256,digest(source));
    const pieces=[proof.removed_span,...proof.retained_spans].sort((a,b)=>a.start-b.start);
    let cursor=proof.evidence_start;
    for(const piece of pieces){assert.equal(piece.start,cursor);cursor=piece.end;}
    assert.equal(cursor,proof.evidence_end);
    assert.equal(source.content.slice(proof.removed_span.start,proof.removed_span.end),proof.removed_span.text);
    for(const piece of proof.retained_spans){
        assert.equal(source.content.slice(piece.start,piece.end),piece.proposal.evidence);
        assert.equal(piece.proposal.evidence,piece.proposal.value);
        assert.equal(piece.proposal.field_id,archive.proposal.field_id);
        assert.equal(piece.proposal.visitor_message_id,archive.proposal.visitor_message_id);
        assertProposal(piece.proposal,turns,configured);
    }
    assert.equal(proof.correction_turn_sha256,digest(proof.correction_turn));
    assert.equal(proof.correction_proposal.value,proof.correction_proposal.evidence);
    assert.ok(proof.correction_turn.content.includes(proof.correction_proposal.evidence));
}
function capturedInitial() {
    const s=structuredClone(fixture.initial_state),turn=fixture.turns[0],call=fixture.handoff_calls[0];
    appendTurn(s,user(turn.id,turn.raw_text));
    const first=apply(s,JSON.parse(call.arguments_json).proposals,call.call_id,fixture.fields);
    assert.equal(first.accepted,true);
    return s;
}

test('captured accepted brief is amended with exact current spans, unrelated facts and both receipts',()=>{
    const s=capturedInitial(),old=s.proposals.find(p=>p.value==='Five staff manually sort incoming forms.');
    const firstAttempt=structuredClone(s.handoff_binding_attempts[0]),firstReceipts=structuredClone(s.receipts);
    const other=s.proposals.filter(p=>p.id!==old.id).map(p=>structuredClone(p));
    s.provider_transcript_verified=true;
    decide(s,old.id,'ACCEPT',fixture.fields);
    const priorDecision=structuredClone(s.decisions.find(d=>d.proposal_id===old.id));
    const t=fixture.turns[1];appendTurn(s,user(t.id,t.raw_text));
    const call=fixture.handoff_calls[1],input=JSON.parse(call.arguments_json).proposals,before=JSON.stringify(input);
    const result=apply(s,input,call.call_id,fixture.fields);
    assert.equal(result.accepted,true);assert.equal(JSON.stringify(input),before);
    assert.deepEqual(s.handoff_requests.map(r=>r.visitor_message_id),fixture.turns.slice(0,2).map(t=>t.id));
    assert.deepEqual(s.handoff_binding_attempts.map(a=>a.request_turn_id),fixture.turns.slice(0,2).map(t=>t.id));
    for(const receipt of firstReceipts)assert.ok(s.receipts.some(r=>JSON.stringify(r)===JSON.stringify(receipt)));
    assert.equal(s.receipts.filter(r=>r.kind==='HANDOFF_REFERENCE_BINDING').length,2);
    assert.deepEqual(s.handoff_binding_attempts[0],firstAttempt);
    assert.deepEqual(s.handoff_binding_attempts[1].original_proposals,input);
    for(const p of other)assert.ok(s.proposals.some(q=>JSON.stringify(q)===JSON.stringify(p)));
    assert.ok(!s.proposals.some(p=>p.id===old.id));
    assert.ok(s.proposals.some(p=>p.value===' manually sort incoming forms.'));
    assert.ok(s.proposals.some(p=>p.value==='it is two staff, not five.'));
    assert.ok(s.proposals.some(p=>p.value==='We do not know API availability.'));
    assert.equal(s.superseded_mappings.length,1);
    assert.deepEqual(s.superseded_mappings[0].proposal,old);
    assert.deepEqual(s.superseded_mappings[0].prior_decision,priorDecision);
    auditArchive(s.superseded_mappings[0],s.turns,fixture.fields);
    for(const {id,...p} of s.proposals){assert.equal(id,digest(p));assertProposal(p,s.turns,fixture.fields);}
    assert.equal(s.approved,false);assert.equal(s.submission_status,'UNSUBMITTED');
    assert.deepEqual(s.external_actions,[]);assert.equal(s.provider_release_verified,false);assert.throws(()=>approve(s));
    const after=JSON.stringify(s);
    assert.deepEqual(apply(s,input,call.call_id,fixture.fields),result);
    assert.equal(JSON.stringify(s),after);
    assert.throws(()=>apply(s,[...input,{...input[0],value:'invented'}],call.call_id,fixture.fields),/immutable/);
    assert.throws(()=>apply(s,input,'a-second-attempt',fixture.fields),/do not retry/);
    assert.equal(JSON.stringify(s),after);
});

test('referential and modified review targets retain the exact requesting source span',()=>{
    for(const text of [
        'Please prepare that for human review only; no sending.',
        'Could you draft this for owner review?',
        'I would like you to prepare these for human review only.',
        'Please create a local review summary.',
        'Please amend that review brief: it is two staff, not five.',
        'Could you revise our saved review summary: there are four dispatchers, not nine.',
    ]) {
        const span=requestedHandoffSpan(text,{hasSuccessfulHandoff:true});
        assert.ok(span,text);assert.equal(text.slice(span.start,span.end),span.evidence);
    }
    for(const text of ['Prepare that.','Please prepare that parcel for human review.',
        'Please prepare that email for human review.','Please amend that review brief.'])
        assert.equal(requestedHandoffSpan(text),null,text);
});

test('independent count assertions, amendment envelopes and work predicates share the correction proof',()=>{
    const cases=[
        ['Nine dispatchers routinely triage incoming requests.','Could you revise our saved review summary: there are four dispatchers, not nine. API support is unknown.','there are four dispatchers, not nine.'],
        ['We have eleven clerks sorting returns.','Please update the owner-review brief. It is seven clerks, not eleven.','It is seven clerks, not eleven.'],
        ['Thirteen coordinators review booking forms.','Amend that local brief: six coordinators handle this, not thirteen.','six coordinators handle this, not thirteen.'],
        ['We have 17 operators checking invoices.','Please amend our review note: we have twelve operators, not seventeen.','we have twelve operators, not seventeen.'],
        ['Eight specialists regularly inspect returned equipment.','Please revise the local summary: it is three specialists, not eight.','it is three specialists, not eight.'],
    ];
    for(const [oldText,correctionText,witness] of cases) {
        const s=fresh(),old=user('old',oldText),goal=user('goal','Keep every proposed change subject to manager review.');
        appendTurn(s,old);appendTurn(s,goal);appendTurn(s,user('initial','Please prepare this for human review only.'));
        assert.equal(apply(s,[proposal(old),proposal(goal,'goal')],'initial').accepted,true);
        const original=s.proposals.find(p=>p.field_id==='work'),unrelated=s.proposals.find(p=>p.field_id==='goal');
        const receipts=structuredClone(s.receipts),correction=user('correction',correctionText);appendTurn(s,correction);
        assert.ok(contradictingCorrection(s.turns,old.id,old.content),correctionText);
        assert.equal(exactCorrectionWitness(old,correction,old.content,witness),true,witness);
        const result=apply(s,[proposal(correction,'work',witness)]);
        assert.equal(result.accepted,true,oldText+' / '+correctionText);
        assert.ok(!s.proposals.some(p=>p.id===original.id));
        assert.ok(s.proposals.some(p=>JSON.stringify(p)===JSON.stringify(unrelated)));
        assert.ok(s.proposals.some(p=>p.value===witness));
        for(const receipt of receipts)assert.ok(s.receipts.some(r=>JSON.stringify(r)===JSON.stringify(receipt)));
        auditArchive(s.superseded_mappings[0],s.turns,fields);
    }
});

test('quoted, narrated, revoked, hypothetical and external requests grant no preparation authority',()=>{
    for(const text of [
        '"Please prepare that for human review only."',
        'My colleague said: please prepare that for human review only.',
        'If I agree later, please prepare that for human review only.',
        'Do not prepare that for human review only.',
        'Please prepare that for human review only. Actually, do not prepare it.',
        'Please amend that review brief and send it to the team.',
        'Please amend that review brief if we agree tomorrow.',
    ]) assert.equal(requestedHandoffSpan(text,{hasSuccessfulHandoff:true}),null,text);
});

test('uncertain, quoted, narrated, different-actor and different-unit contrasts do not retire a fact',()=>{
    for(const text of [
        'Maybe it is two staff, not five.',
        'Please amend the review brief: it might be two staff, not five.',
        'If it is two staff, not five, we could change the brief.',
        'My colleague said: it is two staff, not five.',
        'The example reads: it is two staff, not five.',
        '"Please amend the review brief: it is two staff, not five."',
        'Do not amend the review brief: it is two staff, not five.',
        'Please amend the review brief: they have two staff, not five.',
        'Please amend the review brief: it is two offices, not five.',
    ]) {
        const s=fresh(),old=user('old','We have five staff sorting incoming forms.');
        appendTurn(s,old);appendTurn(s,user('initial','Please draft a local review brief.'));
        assert.equal(apply(s,[proposal(old)],'initial').accepted,true);
        const previous=structuredClone(s.proposals),current=user('correction',text);appendTurn(s,current);
        // Isolate fact retirement from request authorization: every attempted
        // review below has its own explicit request, even for uncertain data.
        appendTurn(s,user('review-request','Please draft a local review summary.'));
        apply(s,[proposal(current)]);
        assert.equal(s.superseded_mappings?.length||0,0,text);
        for(const p of previous)assert.ok(s.proposals.some(q=>JSON.stringify(q)===JSON.stringify(p)),text);
    }
});

test('invalid siblings, cropped witnesses and cross-session calls cannot commit an archive',()=>{
    for(const invalid of ['field','value','source','crop']) {
        const s=capturedInitial(),before=structuredClone(s.proposals),t=fixture.turns[1];
        appendTurn(s,user(t.id,t.raw_text));
        const input=JSON.parse(fixture.handoff_calls[1].arguments_json).proposals;
        if(invalid==='field')input.push({...input[0],field_id:'not-configured'});
        if(invalid==='value')input[0].value='twelve workers';
        if(invalid==='source')input[0].visitor_message_id='invented-source';
        if(invalid==='crop')input[0].value=input[0].evidence='two staff';
        const result=apply(s,input,'invalid-'+invalid,fixture.fields);
        assert.equal(result.accepted,false,invalid);
        assert.deepEqual(s.proposals,before,invalid);assert.equal(s.superseded_mappings?.length||0,0,invalid);
        assert.deepEqual(s.handoff_binding_attempts.at(-1).original_proposals,input);
        assert.equal(s.approved,false);
    }
    const s=capturedInitial(),before=JSON.stringify(s);
    assert.throws(()=>recordProviderHandoffAttempt(s,[],fixture.fields,'cross-session',
        {local_session_id:'other',provider_session_id:s.provider_session_id,tool_call_id:'cross-session'}),/exact local and provider/);
    assert.equal(JSON.stringify(s),before);
});
