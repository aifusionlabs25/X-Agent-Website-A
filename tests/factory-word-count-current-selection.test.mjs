import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendTurn,assertProposal,digest,decide,approve} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {selectCurrentProposals} from '../lib/factory/handoff-current.ts';
import {contradictingCorrection,exactCorrectionWitness} from '../lib/factory/handoff-corrections.ts';
import {countTokens,countValue,countView} from '../lib/factory/handoff-counts.ts';

const retained=JSON.parse(readFileSync(new URL('./fixtures/factory-word-count-correction-20261113.json',import.meta.url),'utf8'));
const fields=[{id:'context',label:'Business workflow'},{id:'rules',label:'Restrictions'},{id:'tools',label:'Current tools'}];
const user=(id,content)=>({id,role:'user',content});
const proposal=(turn,field_id='context',evidence=turn.content)=>({field_id,visitor_message_id:turn.id,evidence,value:evidence});
const fresh=()=>({id:'word-count-fixture',version:1,package_sha256:'synthetic-package',persona_id:'synthetic-persona',
    launch_label:'fixture:word-count',status:'ACTIVE',provider_session_id:'synthetic-provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
    provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]});
const apply=(state,input,call='test',allowed=fields)=>recordProviderHandoffAttempt(state,input,allowed,'request-'+call,
    {local_session_id:state.id,provider_session_id:state.provider_session_id,tool_call_id:call});
function audit(selection,turns) {
    const source=turns.find(t=>t.id===selection.original.visitor_message_id);
    assert.equal(selection.source_sha256,digest(source));
    assert.equal(selection.correction_turn_sha256,digest(selection.correction_turn));
    const parts=[selection.removed_span,...selection.retained_spans].sort((a,b)=>a.start-b.start);
    let cursor=selection.evidence_start;
    for(const part of parts){assert.equal(part.start,cursor);assert.ok(part.end>=part.start);cursor=part.end;}
    assert.equal(cursor,selection.evidence_end);
    assert.equal(source.content.slice(selection.evidence_start,selection.evidence_end),selection.original.evidence);
    assert.equal(source.content.slice(selection.removed_span.start,selection.removed_span.end),selection.removed_span.text);
    for(const part of selection.retained_spans){
        assert.equal(part.proposal.evidence,source.content.slice(part.start,part.end));
        assert.equal(part.proposal.value,part.proposal.evidence);
        assert.equal(part.proposal.field_id,selection.original.field_id);
    }
    assert.equal(selection.correction_proposal.value,selection.correction_proposal.evidence);
    assert.ok(selection.correction_turn.content.includes(selection.correction_proposal.evidence));
}
function authored(sourceText,correctionText,witnessText=correctionText) {
    const s=fresh(),old=user('old',sourceText),current=user('current',correctionText);
    appendTurn(s,old);appendTurn(s,current);appendTurn(s,user('request','Please prepare this for local human review only. Do not send anything.'));
    const input=[proposal(old),proposal(current,'context',witnessText)];
    return {s,old,current,input};
}

test('retained native arguments select the correction while retaining all other exact spans and raw history',()=>{
    const s=structuredClone(retained.initial_state);
    for(const t of retained.turns_before_attempt)appendTurn(s,{id:t.id,role:t.role,content:t.content});
    assert.equal(digest(s.turns),retained.captured_local_turns_sha256);
    const raw=structuredClone(retained.original_proposals),before=JSON.stringify(raw),turns=JSON.stringify(s.turns);
    const result=apply(s,raw,retained.captured_tool_call_id,retained.fields),attempt=s.handoff_binding_attempts.at(-1);
    assert.equal(result.accepted,true);assert.equal(result.status,'PENDING_OWNER_REVIEW');
    assert.equal(JSON.stringify(raw),before);assert.equal(JSON.stringify(s.turns),turns);
    assert.deepEqual(attempt.original_proposals,raw);assert.equal(attempt.input_sha256,digest(raw));
    assert.equal(attempt.current_fact_selections.length,1);
    const selection=attempt.current_fact_selections[0];audit(selection,s.turns);
    assert.equal(selection.removed_span.text,'has eight coordinators');
    assert.equal(selection.correction_proposal.evidence,'Correction: three coordinators do this, not eight.');
    assert.ok(!s.proposals.some(p=>p.evidence===raw[0].evidence));
    assert.ok(s.proposals.some(p=>p.evidence===selection.correction_proposal.evidence));
    assert.ok(s.proposals.some(p=>p.evidence==='Our fictional bicycle wholesaler '));
    assert.ok(s.proposals.some(p=>p.evidence===' chasing email quotes.'));
    for(const p of raw.slice(1))assert.ok(s.proposals.some(q=>q.field_id===p.field_id&&q.visitor_message_id===p.visitor_message_id&&q.evidence===p.evidence));
    for(const {id,...p} of s.proposals){assert.equal(id,digest(p));assertProposal(p,s.turns,retained.fields);}
    assert.equal(s.approved,false);assert.equal(s.submission_status,'UNSUBMITTED');assert.deepEqual(s.external_actions,[]);
    assert.equal(s.provider_release_verified,false);assert.throws(()=>approve(s));
});

test('word, digit, mixed, capitalized and compound cardinal counts share the same value grammar',()=>{
    for(const [raw,value] of [['eight','8'],['THIRTEEN','13'],['twenty-one','21'],['forty two','42'],
        ['one hundred and six','106'],['nine hundred ninety-nine','999'],['007','7'],['zero','0']]) {
        assert.equal(countValue(raw),value);assert.equal(countTokens(raw)[0].value,value);
        assert.equal(countView(raw),value);
    }
    const raw='Twenty-one coordinators; four managers.';
    for(const token of countTokens(raw))assert.equal(raw.slice(token.start,token.end),token.raw);
    assert.equal(countValue('three or four'),null);assert.equal(countValue('two hundred hundred'),null);
    assert.deepEqual(countTokens('8.5'),[]);
});

test('independently worded counts and work predicates retain every noncount byte',()=>{
    for(const [old,newText] of [
        ['Our workshop has thirteen operators preparing estimates.','Actually, nine operators do this, not thirteen.'],
        ['The service desk has twenty-one assistants reviewing orders.','Correction: sixteen assistants handle this, not twenty-one.'],
        ['Our office has 17 analysts monitoring tickets.','Actually, twelve analysts do this, not 17.'],
        ['Our desk has eleven agents chasing requests.','Correction: 7 agents do this, not eleven.'],
        ['We have fourteen people processing forms.','Correction: we have six people, not fourteen.'],
        ['There are nine representatives answering questions.','Four representatives answer questions, not nine.'],
    ]) {
        const {s,input}=authored(old,newText),before=JSON.stringify(input),result=apply(s,input);
        assert.equal(result.accepted,true,old+' / '+newText);
        assert.equal(JSON.stringify(input),before);
        assert.equal(s.handoff_binding_attempts[0].current_fact_selections.length,1);
        audit(s.handoff_binding_attempts[0].current_fact_selections[0],s.turns);
        assert.ok(!s.proposals.some(p=>p.value===old));
        assert.ok(s.proposals.some(p=>p.value===newText));
        for(const {id,...p} of s.proposals)assertProposal(p,s.turns,fields);
    }
});

test('a complete exact correction statement may coexist with an unknown or action request in its original turn',()=>{
    for(const [text,witness] of [
        ['Correction: six operators, not ten. API availability is unknown.','Correction: six operators, not ten.'],
        ['Please prepare; and actually six operators, not ten. We do not know the API.','actually six operators, not ten.'],
        ['Actually six operators, not ten; please leave the budget open.','Actually six operators, not ten;'],
        ['Yes, please do that and um, one correction, six operators, not ten. API availability is unknown.',
            'one correction, six operators, not ten.'],
    ]) {
        const {s,input}=authored('We have ten operators handling orders.',text,witness);
        const result=apply(s,input);assert.equal(result.accepted,true,text);
        audit(s.handoff_binding_attempts[0].current_fact_selections[0],s.turns);
        assert.ok(s.proposals.some(p=>p.value===witness));
        assert.equal(s.turns.find(t=>t.id==='current').content,text);
    }
});

test('cropped, mismatched, duplicate and malformed correction witnesses cannot authorize selection',()=>{
    const {s,old,current,input}=authored('We have ten operators handling orders.',
        'Correction: six operators, not ten. API availability is unknown.','Correction: six operators, not ten.');
    for(const invalid of [proposal(current,'context','six operators'),proposal(current,'context','not ten.'),
        {...input[1],value:'six operators'},{...input[1],field_id:'unknown'},{...input[1],visitor_message_id:'absent'}]) {
        const selected=selectCurrentProposals([input[0],invalid],s.turns,fields);
        assert.equal(selected.current_fact_selections.length,0);
    }
    assert.equal(selectCurrentProposals([...input,input[1]],s.turns,fields).current_fact_selections.length,0);
    assert.equal(exactCorrectionWitness(old,current,old.content,'six operators'),false);
});

test('ambiguity, narration, quotation, negation, different units and different actors do not destructively replace facts',()=>{
    for(const correction of [
        'Maybe we have six operators, not ten.','If we have six operators, not ten, this might work.',
        'My colleague said: correction, we have six operators, not ten.',
        '"Correction: we have six operators, not ten."','Do not treat this as a correction: six operators, not ten.',
        'Correction: we have six offices, not ten.','Correction: they have six operators, not ten.',
    ]) {
        const {s,input}=authored('We have ten operators handling orders.',correction);
        const selected=selectCurrentProposals(input,s.turns,fields);
        assert.equal(selected.current_fact_selections.length,0,correction);
        assert.ok(selected.selected.some(p=>p.value===input[0].value),correction);
    }
    for(const old of ['Our workshop might have ten operators processing orders.',
        'If our workshop has ten operators processing orders, we can respond.',
        'Our workshop has only ten operators processing orders.',
        'Our workshop has ten operators processing orders temporarily.',
        'Our workshop has ten operators processing two categories.',
        'Our workshop has ten operators processing orders. The other desk has 10 operators processing forms.']) {
        const {s,input}=authored(old,'Correction: six operators, not ten.');
        assert.equal(selectCurrentProposals(input,s.turns,fields).current_fact_selections.length,0,old);
    }
});

test('strict invalid siblings block the entire batch without losing originals or creating approval',()=>{
    const {s,input}=authored('We have ten operators handling orders.','Correction: six operators, not ten.');
    const result=apply(s,[...input,{...input[1],field_id:'unknown'}]);
    assert.equal(result.accepted,false);assert.deepEqual(s.proposals,[]);assert.deepEqual(s.decisions,[]);
    assert.deepEqual(s.handoff_binding_attempts[0].original_proposals,[...input,{...input[1],field_id:'unknown'}]);
    assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});

test('updating a stored word-count proposal preserves prior decisions in history and unrelated active details',()=>{
    const s=fresh(),old=user('old','Our desk has eleven operators chasing orders. We use a shared inbox. Please prepare a human-review brief.');
    appendTurn(s,old);
    const original=proposal(old,'context','Our desk has eleven operators chasing orders.');
    const tools=proposal(old,'tools','We use a shared inbox.');
    assert.equal(apply(s,[original,tools],'initial').accepted,true);
    const prior=s.proposals.find(p=>p.evidence===original.evidence),toolsId=s.proposals.find(p=>p.field_id==='tools').id;
    // This in-memory fixture simulates an already reconciled owner decision.
    // Appending the correction must invalidate that gate again, as in production.
    s.provider_transcript_verified=true;
    decide(s,prior.id,'ACCEPT',fields);
    const decision=structuredClone(s.decisions.find(d=>d.proposal_id===prior.id));
    const current=user('new','Correction: seven operators do this, not eleven. The API is unknown. Please prepare an updated human-review brief.');
    appendTurn(s,current);
    appendTurn(s,user('update-request','Please draft a local summary for owner review.'));
    assert.equal(s.handoff_requests.at(-1).visitor_message_id,'update-request');
    const correction=proposal(current,'context','Correction: seven operators do this, not eleven.');
    const unknown=proposal(current,'rules','The API is unknown.');
    const result=apply(s,[correction,unknown],'update');assert.equal(result.accepted,true);
    assert.ok(!s.proposals.some(p=>p.id===prior.id));assert.ok(s.proposals.some(p=>p.id===toolsId));
    assert.ok(s.proposals.some(p=>p.evidence===' chasing orders.'));
    assert.ok(s.proposals.some(p=>p.evidence===unknown.evidence));
    const archive=s.superseded_mappings.find(a=>a.proposal.id===prior.id);
    assert.deepEqual(archive.proposal,prior);assert.deepEqual(archive.prior_decision,decision);
    audit(archive.current_fact_selection,s.turns);
    const replacement=s.proposals.find(p=>p.evidence===correction.evidence);
    assert.ok(replacement);assert.ok(!s.decisions.some(d=>d.proposal_id===replacement.id));
    assert.equal(s.approved,false);assert.equal(s.submission_status,'UNSUBMITTED');
});

test('a correction about another actor cannot retire a business-subject count',()=>{
    for(const [source,correction] of [
        ['Our desk has eleven operators chasing orders.','Correction: they have seven operators, not eleven.'],
        ['Their depot has eleven operators reviewing orders.','Correction: we have seven operators, not eleven.'],
        ['The other desk has eleven operators handling requests.','Correction: we have seven operators, not eleven.'],
    ]) {
        const {s,input}=authored(source,correction),selected=selectCurrentProposals(input,s.turns,fields);
        assert.equal(selected.current_fact_selections.length,0,source+' / '+correction);
        assert.ok(selected.selected.some(p=>p.evidence===source));
    }
});

test('the original spelled-out assertion is rejected as stale without changing its raw source or quote',()=>{
    const source=user('source','We have seventeen assistants reviewing orders.'),current=user('current','Correction: twelve assistants, not seventeen.');
    const turns=[source,current],before=JSON.stringify(turns);
    assert.equal(contradictingCorrection(turns,source.id,source.content),current);
    assert.throws(()=>assertProposal(proposal(source),turns,fields));
    assert.equal(JSON.stringify(turns),before);
});
