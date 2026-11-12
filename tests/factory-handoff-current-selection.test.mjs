import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendTurn,assertProposal,recordHandoffAttempt,proposalIssues,digest,decide,approve} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {selectCurrentProposals} from '../lib/factory/handoff-current.ts';
import {seal,unseal} from '../lib/factory/store.ts';

// This is an offline replay of the saved bytes, with independently authored
// cases below. No provider, model, transcript reconciliation or network runs.
const fixtureUrl=new URL('./fixtures/factory-handoff-format-20261109.json',import.meta.url);
const fixtureBytes=readFileSync(fixtureUrl),saved=JSON.parse(fixtureBytes);
const fields=[{id:'context',label:'Business context'},{id:'rules',label:'Constraints'},{id:'tools',label:'Tools'}];
const u=(id,content)=>({id,role:'user',content});
const p=(turn,field_id='context',evidence=turn.content)=>({field_id,visitor_message_id:turn.id,evidence,value:evidence});
const fresh=()=>({id:'local',version:1,package_sha256:'offline-fixture',persona_id:'persona',launch_label:'fixture:current-selection',
    status:'ACTIVE',provider_session_id:'provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
    provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,
    submission_status:'UNSUBMITTED',external_actions:[]});
const identity=(s,tool_call_id)=>({local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id});
function apply(s,raw,call='selection',allowed=fields) {
    return recordProviderHandoffAttempt(s,raw,allowed,'request-'+call,identity(s,call));
}
function replay() {
    const s=fresh();s.id=saved.captured_local_session_id;s.provider_session_id=saved.captured_provider_session_id;
    for(const turn of saved.turns_before_attempt)appendTurn(s,turn);
    return s;
}
function example(old='Our shop is in Reno. We have 10 people. Quotes stay in the shared inbox.',
    correction='One correction, we have 8 people, not 10.') {
    const s=fresh(),source=u('source',old),current=u('current',correction);
    appendTurn(s,source);appendTurn(s,current);return {s,source,current};
}
function pendingOnly(s,result) {
    assert.equal(result.owner_approved,false);assert.equal(result.submission_status,'UNSUBMITTED');assert.deepEqual(result.external_actions,[]);
    assert.equal(s.approved,false);assert.equal(s.evidence_reviewed,false);assert.equal(s.submission_status,'UNSUBMITTED');assert.deepEqual(s.external_actions,[]);
    assert.throws(()=>approve(s));
}
function validProposals(s,allowed=fields) {
    for(const {id,...proposal} of s.proposals){assert.equal(id,digest(proposal));assertProposal(proposal,s.turns,allowed);}
}
function partitionAudit(selection,turns) {
    const source=turns.find(t=>t.id===selection.original.visitor_message_id),correction=turns.find(t=>t.id===selection.correction_turn.id);
    assert.ok(source);assert.ok(correction);assert.equal(source.role,'user');assert.equal(correction.role,'user');
    assert.equal(selection.rule,'EXACT_POSITIVE_COUNT_PARTITION');assert.equal(selection.source_sha256,digest(source));
    assert.equal(selection.correction_turn_sha256,digest(correction));assert.deepEqual(selection.correction_turn,correction);
    assert.equal(source.content.slice(selection.evidence_start,selection.evidence_end),selection.original.evidence);
    assert.equal(source.content.slice(selection.removed_span.start,selection.removed_span.end),selection.removed_span.text);
    const segments=[selection.removed_span,...selection.retained_spans].sort((a,b)=>a.start-b.start);
    let cursor=selection.evidence_start;
    for(const span of segments){assert.equal(span.start,cursor,'the audit covers every original character without gaps or overlap');cursor=span.end;}
    assert.equal(cursor,selection.evidence_end);
    for(const span of selection.retained_spans) {
        assert.equal(span.proposal.field_id,selection.original.field_id);assert.equal(span.proposal.visitor_message_id,source.id);
        assert.equal(span.proposal.evidence,source.content.slice(span.start,span.end));assert.equal(span.proposal.value,span.proposal.evidence);
    }
    assert.equal(selection.correction_proposal.visitor_message_id,correction.id);
    assert.equal(selection.correction_proposal.evidence,correction.content);assert.equal(selection.correction_proposal.value,correction.content);
}

test('saved raw six-proposal replay passes pending review and retains every noncount detail with immutable provenance',()=>{
    const s=replay(),raw=structuredClone(saved.original_proposals),rawBefore=JSON.stringify(raw),turnsBefore=JSON.stringify(s.turns);
    assert.equal(digest(s.turns),saved.turns_sha256);assert.equal(saved.captured_result.accepted,false);
    const result=apply(s,raw,saved.tool_call_id,saved.fields),attempt=s.handoff_binding_attempts[0];
    assert.equal(result.accepted,true);assert.equal(result.status,'PENDING_OWNER_REVIEW');assert.deepEqual(result.issues,[]);
    assert.equal(result.accepted_proposal_count,s.proposals.length);assert.ok(s.proposals.length<=24);assert.equal(attempt.applied,true);
    assert.deepEqual(attempt.original_proposals,raw);assert.equal(attempt.input_sha256,digest(raw));assert.equal(attempt.local_turns_sha256,saved.turns_sha256);
    assert.deepEqual(attempt.format_bindings.map(b=>b.resolved_index),[1,4]);assert.deepEqual(attempt.bindings.map(b=>b.index),[5]);
    assert.deepEqual(attempt.current_fact_selections.map(a=>a.resolved_index),[0,1,3,4]);
    assert.deepEqual(result.current_fact_selections,attempt.current_fact_selections);
    const oldSource=s.turns.find(t=>t.id===raw[0].visitor_message_id),current=s.turns.at(-1);
    for(const audit of attempt.current_fact_selections) {
        partitionAudit(audit,s.turns);assert.deepEqual(audit.original,attempt.resolved_proposals[audit.resolved_index]);
        assert.equal(audit.correction_proposal_index,5);assert.deepEqual(audit.correction_proposal,attempt.resolved_proposals[5]);
        assert.equal(audit.removed_span.text.trim(),'We have 6 staff');
        const retained=audit.retained_spans.map(span=>span.proposal.evidence).join('');
        for(const detail of [
            'I, I uh have a plumbing supply business called Copper Mesa Supply.',
            'that handle quote requests arriving by email.',
            'They copy details into a spreadsheet, but we sometimes miss requests.',
            'We want help collecting request details and preparing draft quotes.',
            'A person must approve every quote before anything goes to the customer though.',
        ])assert.ok(retained.includes(detail),detail);
        for(const span of audit.retained_spans)assert.ok(s.proposals.some(row=>row.id===digest(span.proposal)));
    }
    assert.ok(!s.proposals.some(row=>/\bWe have 6 staff\b/.test(row.value)));
    assert.equal(s.proposals.filter(row=>row.visitor_message_id===current.id).length,1,'the supplied correction is not cloned into other fields');
    assert.ok(s.proposals.some(row=>row.field_id===raw[5].field_id&&row.value===current.content));
    assert.ok(s.proposals.some(row=>row.value==='No, just uh email and Excel.'));
    assert.ok(current.content.includes("I don't know whether or not if it has an API."));
    assert.equal(oldSource.content,raw[0].evidence);assert.equal(JSON.stringify(raw),rawBefore);assert.equal(JSON.stringify(s.turns),turnsBefore);
    assert.deepEqual(readFileSync(fixtureUrl),fixtureBytes);assert.deepEqual(saved.captured_result.issues.map(i=>i.index),[1,4,5]);
    assert.deepEqual(s.decisions,[]);assert.equal(s.provider_release_verified,false);assert.equal(s.provider_transcript_verified,false);
    validProposals(s,saved.fields);pendingOnly(s,result);
    assert.equal(s.receipts.find(r=>r.kind==='HANDOFF_REFERENCE_BINDING').sha256,digest(attempt));
    const secret='offline-current-selection-secret-more-than-32-characters';assert.deepEqual(unseal(seal(s,secret),secret),s);
});

test('same-field whole corrections preserve broad siblings and cross-field witnesses remain in their supplied field',()=>{
    for(const witnessField of ['context','rules'])for(const [old,correction,details] of [
        ['Our shop is in Reno. We have 10 people. Quotes stay in the shared inbox.','One correction, we have 8 people, not 10.',['Our shop is in Reno.','Quotes stay in the shared inbox.']],
        ['We have 10 people that handle quote requests by email.','Actually, we have 8 people, not 10.',['that handle quote requests by email.']],
        ['There are 9 reviewers who check draft orders. The portal API is unknown.','One correction, there are 7 reviewers, not 9.',['who check draft orders.','The portal API is unknown.']],
        ['Our team has 8 operators. The owner reviews every quote.','Correction: our team has 5 operators, not 8.',['The owner reviews every quote.']],
    ]) {
        const {s,source,current}=example(old,correction),raw=[p(source),p(current,witnessField)],before=JSON.stringify(raw),turns=JSON.stringify(s.turns);
        const result=apply(s,raw);assert.equal(result.accepted,true,old+' / '+witnessField);
        assert.equal(result.current_fact_selections?.length,1,old+' / '+witnessField+' retains a partition audit');const audit=result.current_fact_selections[0];partitionAudit(audit,s.turns);
        const residuals=s.proposals.filter(row=>row.visitor_message_id===source.id);
        assert.ok(residuals.length>0);assert.ok(residuals.every(row=>row.field_id==='context'));
        for(const detail of details)assert.ok(residuals.some(row=>row.value.includes(detail)),detail);
        assert.deepEqual(s.proposals.filter(row=>row.visitor_message_id===current.id).map(({id,...proposal})=>{assert.equal(id,digest(proposal));return proposal;}),[p(current,witnessField)]);
        assert.equal(JSON.stringify(raw),before);assert.equal(JSON.stringify(s.turns),turns);validProposals(s);pendingOnly(s,result);
    }
});

test('independent exact evidence embedded inside a source uses absolute offsets and preserves Unicode and whitespace',()=>{
    const evidence='Shop café ☕ is open.\nWe have 10 people that handle email.\n  Human review stays required.',prefix='Background outside the proposal. ';
    const {s,source,current}=example(prefix+evidence+' End outside the proposal.');
    const raw=[p(source,'context',evidence),p(current,'rules')],result=apply(s,raw);
    assert.equal(result.accepted,true);const audit=result.current_fact_selections[0];partitionAudit(audit,s.turns);
    assert.equal(audit.evidence_start,prefix.length);assert.equal(audit.evidence_end,prefix.length+evidence.length);
    const retained=audit.retained_spans.map(span=>span.proposal.evidence).join('');
    assert.ok(retained.includes('Shop café ☕ is open.\n'));assert.ok(retained.includes('that handle email.\n  Human review stays required.'));
    assert.ok(!retained.includes(prefix));validProposals(s);
});

test('unsupported coordinated and qualified counts fail closed without discarding any sibling fact',()=>{
    for(const old of ['We have 10 people and use a shared inbox.','We have 10 people, 2 branches.',
        'We have 10 people (2 branches).','We have 10 people working 2 shifts.',
        'We have 10 people processing requests only after approval.','We have 10 people available.']) {
        const {s,source,current}=example(old),raw=[p(source),p(current)],before=JSON.stringify(raw),turns=JSON.stringify(s.turns);
        const result=apply(s,raw);assert.equal(result.accepted,false,old);assert.equal(s.proposals.length,0);
        assert.deepEqual(s.quarantined_proposals[0].proposals,raw);assert.deepEqual(s.handoff_binding_attempts[0].original_proposals,raw);
        assert.equal(s.handoff_binding_attempts[0].applied,false);assert.equal(JSON.stringify(raw),before);assert.equal(JSON.stringify(s.turns),turns);
        assert.equal(s.superseded_mappings,undefined);pendingOnly(s,result);
    }
});

test('missing, partial, duplicate or ambiguous current witnesses cannot authorize a count partition',()=>{
    for(const mode of ['missing','partial','duplicate','conflicting-source','unknown-field','different-corrected-fact']) {
        const {s,source,current}=example();let witnesses=[p(current,'rules')];
        if(mode==='missing')witnesses=[];
        if(mode==='partial')witnesses=[p(current,'rules','we have 8 people')];
        if(mode==='duplicate')witnesses.push(structuredClone(witnesses[0]));
        if(mode==='conflicting-source') {
            // Different source assertions really are ambiguous; the identical
            // exact source in two fields is covered as valid below.
            const conflict=u('conflict','One correction, we have 7 people, not 8.');
            appendTurn(s,conflict);witnesses.push(p(conflict,'tools'));
        }
        if(mode==='unknown-field')witnesses[0].field_id='unknown';
        if(mode==='different-corrected-fact') {
            const other=u('other-correction','One correction, we have 8 locations, not 10.');appendTurn(s,other);witnesses=[p(other,'rules')];
        }
        const raw=[p(source),...witnesses],result=apply(s,raw);
        assert.equal(result.accepted,false,mode);assert.equal(s.proposals.length,0);assert.equal(s.superseded_mappings,undefined);
        assert.deepEqual(s.quarantined_proposals[0].proposals,raw);assert.equal(s.handoff_binding_attempts[0].applied,false);pendingOnly(s,result);
    }
});

test('identical exact correction in distinct fields is one factual witness, with all mappings retained',()=>{
    const {s,source,current}=example(),raw=[p(source),p(current,'rules'),p(current,'tools')];
    const result=apply(s,raw);assert.equal(result.accepted,true);validProposals(s);
    assert.deepEqual(result.current_fact_selections[0].equivalent_correction_proposal_indices,[1,2]);
    assert.ok(s.proposals.some(q=>q.field_id==='rules'&&q.evidence===current.content));
    assert.ok(s.proposals.some(q=>q.field_id==='tools'&&q.evidence===current.content));
    assert.deepEqual(s.handoff_binding_attempts[0].original_proposals,raw);pendingOnly(s,result);
});

test('an unrelated numeric correction neither deletes nor partitions a still-current original fact',()=>{
    const {s,source,current}=example('We have 10 people. The owner reviews every order.','One correction, we have 8 locations, not 10.');
    const raw=[p(source),p(current,'rules')],result=apply(s,raw);
    assert.equal(result.accepted,true);assert.ok(s.proposals.some(row=>row.value===source.content));
    assert.equal(result.current_fact_selections?.length||0,0);assert.equal(s.superseded_mappings,undefined);
    assert.deepEqual(raw,[p(source),p(current,'rules')]);validProposals(s);
});

function storedExample() {
    const s=fresh(),source=u('source','Our shop is in Reno. We have 10 people that handle email. The owner reviews every quote.'),other=u('tools','We use a spreadsheet.');
    appendTurn(s,source);appendTurn(s,other);assert.equal(apply(s,[p(source),p(other,'tools')],'initial').accepted,true);
    s.provider_transcript_verified=true;decide(s,digest(p(source)),'ACCEPT',fields);
    const prior=structuredClone(s.proposals.find(row=>row.id===digest(p(source)))),priorDecision=structuredClone(s.decisions[0]),initialAttempt=structuredClone(s.handoff_binding_attempts[0]);
    const current=u('current','One correction, we have 8 people, not 10.');appendTurn(s,current);
    appendTurn(s,u('request','Please prepare a brief for human review.'));
    return {s,source,current,other,prior,priorDecision,initialAttempt};
}

test('stored broad mappings are partitioned transactionally, keeping historical decisions and fresh residuals unapproved',()=>{
    const {s,current,other,prior,priorDecision,initialAttempt}=storedExample(),turns=structuredClone(s.turns),raw=[p(current,'rules')];
    const result=apply(s,raw,'update');assert.equal(result.accepted,true);assert.equal(s.superseded_mappings.length,1);
    const archived=s.superseded_mappings[0];assert.deepEqual(archived.proposal,prior);assert.equal(archived.replacement_proposal_id,digest(raw[0]));
    assert.deepEqual(archived.correction_turn,current);assert.equal(archived.correction_turn_sha256,digest(current));assert.deepEqual(archived.prior_decision,priorDecision);
    partitionAudit(archived.current_fact_selection,s.turns);assert.ok(archived.retained_proposal_ids.length>0);
    assert.deepEqual(result.prior_current_fact_selections,[archived.current_fact_selection]);
    assert.deepEqual(s.handoff_binding_attempts.at(-1).prior_current_fact_selections,result.prior_current_fact_selections);
    assert.deepEqual(archived.retained_proposal_ids,archived.current_fact_selection.retained_spans.map(span=>digest(span.proposal)));
    for(const id of archived.retained_proposal_ids) {
        assert.ok(s.proposals.some(row=>row.id===id));assert.ok(!s.decisions.some(row=>row.proposal_id===id),'old ACCEPT never approves a derived residual');
    }
    assert.ok(!s.proposals.some(row=>row.id===prior.id));assert.ok(!s.proposals.some(row=>/We have 10 people/.test(row.value)));
    assert.ok(s.proposals.some(row=>row.id===digest(p(other,'tools'))));assert.deepEqual(s.decisions,[priorDecision]);
    assert.deepEqual(s.handoff_binding_attempts[0],initialAttempt);assert.deepEqual(s.turns,turns);
    assert.equal(s.provider_release_verified,false);assert.equal(s.provider_transcript_verified,false);validProposals(s);pendingOnly(s,result);
    s.status='CLOSED';s.provider_release_verified=true;s.provider_transcript_verified=true;s.evidence_reviewed=true;
    assert.throws(()=>approve(s),'new correction and residuals still need explicit owner decisions');assert.equal(s.approved,false);
    const secret='offline-stored-selection-secret-more-than-32-characters',reloaded=unseal(seal(s,secret),secret);
    assert.deepEqual(reloaded,s);assert.deepEqual(reloaded.superseded_mappings[0].prior_decision,priorDecision);
    assert.ok(reloaded.superseded_mappings[0].proposal.value.includes('We have 10 people'));
});

test('stored same-field relative details receive the same complete partition archive as broad multi-sentence notes',()=>{
    const s=fresh(),source=u('source','We have 10 people that handle quote requests by email.'),current=u('current','Correction: we have 8 people, not 10.');
    appendTurn(s,source);assert.equal(apply(s,[p(source)],'initial').accepted,true);const prior=structuredClone(s.proposals[0]);
    appendTurn(s,current);appendTurn(s,u('request','Please prepare a brief for human review.'));
    const result=apply(s,[p(current)],'update');assert.equal(result.accepted,true);
    assert.ok(s.proposals.some(row=>row.value.includes('that handle quote requests by email.')));
    assert.equal(s.superseded_mappings.length,1);const archived=s.superseded_mappings[0];assert.deepEqual(archived.proposal,prior);
    assert.ok(archived.current_fact_selection,'the archive retains the exact partition even for a same-field witness');
    partitionAudit(archived.current_fact_selection,s.turns);
    assert.deepEqual(archived.retained_proposal_ids,archived.current_fact_selection.retained_spans.map(span=>digest(span.proposal)));
    assert.deepEqual(result.prior_current_fact_selections,[archived.current_fact_selection]);
    assert.deepEqual(s.handoff_binding_attempts.at(-1).prior_current_fact_selections,result.prior_current_fact_selections);
    validProposals(s);pendingOnly(s,result);
});

test('unsupported stored qualifiers block the provider update while retaining the complete previous mapping',()=>{
    for(const old of ['We have 10 people and use a shared inbox.','We have 10 people working 2 shifts.',
        'We have 10 people processing requests only after approval.','We have 10 people available.']) {
        const s=fresh(),source=u('source',old),current=u('current','Correction: we have 8 people, not 10.');
        appendTurn(s,source);assert.equal(apply(s,[p(source)],'initial').accepted,true);
        appendTurn(s,current);appendTurn(s,u('request','Please prepare a brief for human review.'));
        const before=structuredClone(s.proposals),turns=structuredClone(s.turns),raw=[p(current)];
        const result=apply(s,raw,'update');assert.equal(result.accepted,false,old);assert.deepEqual(s.proposals,before);assert.deepEqual(s.turns,turns);
        assert.equal(s.superseded_mappings,undefined);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);
        assert.equal(s.handoff_binding_attempts.at(-1).applied,false);pendingOnly(s,result);
    }
});

test('unqualified work-participle updates preserve every residual span and historical owner decision',()=>{
    for(const work of ['processing requests','reviewing drafts','handling email','managing orders']) {
        const s=fresh(),source=u('source',`Our shop is in Reno. We have 10 people ${work}. Quotes stay in the shared inbox.`);
        const sibling=u('sibling','The owner reviews every quote.'),current=u('current','Correction: we have 8 people, not 10.');
        appendTurn(s,source);appendTurn(s,sibling);
        assert.equal(apply(s,[p(source),p(sibling,'rules')],'initial').accepted,true);
        s.provider_transcript_verified=true;decide(s,digest(p(source)),'ACCEPT',fields);
        const original=structuredClone(s.proposals.find(p=>p.visitor_message_id===source.id));
        const decision=structuredClone(s.decisions.find(d=>d.proposal_id===original.id));
        appendTurn(s,current);appendTurn(s,u('request','Please prepare a brief for human review.'));
        const result=apply(s,[p(current)],'update');assert.equal(result.accepted,true);
        assert.equal(s.superseded_mappings.length,1);const archived=s.superseded_mappings[0];
        assert.deepEqual(archived.proposal,original);assert.deepEqual(archived.prior_decision,decision);
        partitionAudit(archived.current_fact_selection,s.turns);
        assert.equal(archived.current_fact_selection.removed_span.text,'We have 10 people');
        assert.ok(s.proposals.some(p=>p.value===` ${work}. Quotes stay in the shared inbox.`));
        assert.ok(s.proposals.some(p=>p.value==='Our shop is in Reno. '));
        assert.ok(s.proposals.some(p=>p.value===sibling.content));
        assert.ok(s.proposals.some(p=>p.value===current.content));
        assert.ok(s.proposals.every(p=>!p.value.includes('We have 10 people')));
        for(const id of archived.retained_proposal_ids)assert.ok(!s.decisions.some(d=>d.proposal_id===id));
        validProposals(s);pendingOnly(s,result);
    }
});

test('malformed siblings reject the entire stored update before any archive, deletion or residual creation',()=>{
    for(const mode of ['schema','unknown-field','unknown-source','nonexact-evidence','invented-value','null']) {
        const {s,current}=storedExample(),good=p(current,'rules');let bad={...good};
        if(mode==='schema')bad.extra=true;
        if(mode==='unknown-field')bad.field_id='invented';
        if(mode==='unknown-source')bad.visitor_message_id='missing';
        if(mode==='nonexact-evidence')bad.value=bad.evidence='We have eight colleagues.';
        if(mode==='invented-value')bad.value='Eight people are confirmed.';
        if(mode==='null')bad=null;
        const raw=[good,bad],before={proposals:structuredClone(s.proposals),decisions:structuredClone(s.decisions),turns:structuredClone(s.turns),attempt:structuredClone(s.handoff_binding_attempts[0])};
        const result=apply(s,raw,'invalid-'+mode);assert.equal(result.accepted,false,mode);
        assert.deepEqual(s.proposals,before.proposals);assert.deepEqual(s.decisions,before.decisions);assert.deepEqual(s.turns,before.turns);
        assert.deepEqual(s.handoff_binding_attempts[0],before.attempt);assert.equal(s.superseded_mappings,undefined);
        assert.deepEqual(s.quarantined_proposals.at(-1).proposals,raw);assert.equal(s.handoff_binding_attempts.at(-1).applied,false);
        assert.equal(result.current_fact_selections,undefined);pendingOnly(s,result);
    }
});

test('a malformed sibling also prevents every otherwise valid same-batch selection from being committed',()=>{
    const {s,source,current}=example(),raw=[p(source),p(current,'rules'),{...p(current,'tools'),extra:'not allowed'}],before=JSON.stringify(s.turns);
    const result=apply(s,raw);assert.equal(result.accepted,false);assert.equal(s.proposals.length,0);assert.equal(s.superseded_mappings,undefined);
    assert.equal(result.current_fact_selections,undefined);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);
    assert.deepEqual(s.handoff_binding_attempts[0].original_proposals,raw);assert.equal(JSON.stringify(s.turns),before);
});

test('the 24-proposal bound applies after same-batch expansion and never truncates retained sibling facts',()=>{
    for(const count of [11,12]) {
        const {s,source,current}=example(),allowed=Array.from({length:count},(_,i)=>({id:'f'+i,label:'Field '+i})).concat({id:'correction',label:'Correction'});
        const raw=allowed.slice(0,count).map(field=>p(source,field.id));raw.push(p(current,'correction'));
        const result=apply(s,raw,'bound-'+count,allowed);
        if(count===11) {
            assert.equal(result.accepted,true);assert.equal(s.proposals.length,23);assert.equal(result.accepted_proposal_count,23);validProposals(s,allowed);
        } else {
            assert.equal(result.accepted,false);assert.equal(s.proposals.length,0);assert.equal(s.superseded_mappings,undefined);
            assert.deepEqual(s.quarantined_proposals[0].proposals,raw);assert.equal(s.handoff_binding_attempts[0].applied,false);
        }
    }
});

test('stored projection expansion over the batch bound is atomic and keeps every prior mapping',()=>{
    const s=fresh(),source=u('source','Our shop is in Reno. We have 10 people. Drafts need review.'),current=u('current','Correction: we have 8 people, not 10.');
    const allowed=Array.from({length:12},(_,i)=>({id:'f'+i,label:'Field '+i})).concat({id:'correction',label:'Correction'});
    appendTurn(s,source);assert.equal(apply(s,allowed.slice(0,12).map(field=>p(source,field.id)),'initial',allowed).accepted,true);
    appendTurn(s,current);appendTurn(s,u('request','Please prepare a brief for human review.'));const before=structuredClone(s.proposals),raw=[p(current,'correction')];
    const result=apply(s,raw,'overflow',allowed);assert.equal(result.accepted,false);assert.deepEqual(s.proposals,before);
    assert.equal(s.superseded_mappings,undefined);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);assert.equal(s.handoff_binding_attempts.at(-1).applied,false);
});

test('stored historical failed results remain immutable and are never replayed through the newly capable selector',()=>{
    const s=replay(),raw=structuredClone(saved.original_proposals),prior={request_id:'captured-failure',...identity(s,saved.tool_call_id),
        request_turn_id:s.handoff_requests?.at(-1)?.visitor_message_id??null,input_sha256:digest(raw),local_turns_sha256:digest(s.turns),
        original_proposals:structuredClone(raw),resolved_proposals:structuredClone(raw),selected_proposals:structuredClone(raw),
        superseded_proposals:[],bindings:[],applied:false,result:structuredClone(saved.captured_result)};
    s.handoff_binding_attempts=[prior];s.quarantined_proposals=[{request_id:prior.request_id,proposals:structuredClone(raw),reason:saved.captured_result.reason}];
    s.receipts.push({at:'2026-11-09T00:00:00.000Z',kind:'HANDOFF_REFERENCE_BINDING',sha256:digest(prior)});
    const before=JSON.stringify(s),result=apply(s,raw,saved.tool_call_id,saved.fields);
    assert.deepEqual(result,saved.captured_result);assert.equal(result.accepted,false);assert.equal(JSON.stringify(s),before);
    assert.equal(s.proposals.length,0);assert.equal(s.superseded_mappings,undefined);
    assert.throws(()=>apply(s,raw.slice(1),saved.tool_call_id,saved.fields),/immutable/);assert.equal(JSON.stringify(s),before);
});

test('new successful receipts remain immutable under duplicate calls and returned audit mutation',()=>{
    const {s,source,current}=example(),raw=[p(source),p(current,'rules')],result=apply(s,raw),before=JSON.stringify(s);
    assert.equal(result.accepted,true);assert.deepEqual(apply(s,raw),result);assert.equal(JSON.stringify(s),before);
    assert.throws(()=>apply(s,[...raw,p(current,'tools')]),/immutable/);assert.equal(JSON.stringify(s),before);
    result.current_fact_selections[0].original.value='Caller mutation';result.current_fact_selections[0].retained_spans[0].proposal.value='Caller mutation';
    assert.equal(JSON.stringify(s),before);raw[0].value='Caller mutation';assert.equal(JSON.stringify(s),before);
});

test('strict manual validation still rejects broad stale evidence and never performs provider selection',()=>{
    const {s,source,current}=example(),raw=[p(source),p(current,'rules')],before=JSON.stringify(raw);
    assert.throws(()=>assertProposal(raw[0],s.turns,fields),/exact persisted visitor span/);
    assert.deepEqual(proposalIssues(raw,s.turns,fields).map(issue=>issue.problems),[['LATER_EXPLICIT_CORRECTION_REQUIRES_CURRENT_EVIDENCE']]);
    const result=recordHandoffAttempt(s,raw,fields,'manual');assert.equal(result.accepted,false);assert.equal(s.proposals.length,0);
    assert.equal(s.handoff_binding_attempts,undefined);assert.equal(s.superseded_mappings,undefined);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);
    assert.equal(JSON.stringify(raw),before);
    const selected=selectCurrentProposals(raw,s.turns,fields);assert.equal(selected.current_fact_selections.length,1);
    assert.equal(JSON.stringify(raw),before,'provider selection never rewrites caller-owned proposals');
});
