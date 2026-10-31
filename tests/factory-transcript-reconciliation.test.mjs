import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reconcileTranscript} from '../lib/factory/transcript-reconciliation.ts';

const sid='synthetic-session';
const local=(...texts)=>texts.map((content,i)=>({id:'user::'+i,role:'user',content}));
const transcript=(...texts)=>({sessionId:sid,transcriptsEnabled:true,totalMessages:texts.length,messages:texts.map(message=>({role:'user',message}))});
const check=(turns,tr,extra={})=>reconcileTranscript({provider_session_id:sid,turns,transcript:tr,...extra});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

function verifySpans(result,turns,tr) {
    for(const link of result.links) {
        const original=turns[link.local_turn_index];assert.equal(original.id,link.local_turn_id);
        const recovered=Array(original.content.length).fill(null);
        for(const p of link.provider_spans) {
            const text=tr.messages[p.message_index].message.slice(p.start,p.end);
            assert.equal(text,original.content.slice(p.local_start,p.local_end));
            for(let j=0;j<text.length;j++){assert.equal(recovered[p.local_start+j],null);recovered[p.local_start+j]=text[j];}
        }
        for(const b of link.provider_boundary_spaces){assert.equal(recovered[b.local_offset],null);recovered[b.local_offset]=' ';}
        assert.equal(recovered.join(''),original.content);assert.equal(recovered.includes(null),false);
    }
}

test('retained owner run: strict old comparison fails; exact source-span reconciliation succeeds without changing originals',()=>{
    const f=JSON.parse(readFileSync(new URL('./fixtures/factory-owner-led-handoff.json',import.meta.url),'utf8'));
    const before=JSON.stringify(f),s=f.state,tr=f.transcript;
    const failures=s.turns.filter(t=>t.role==='user'&&!tr.messages.some(p=>p.role==='user'&&p.message===t.content));
    assert.equal(failures.length,2);
    const r=reconcileTranscript({provider_session_id:tr.sessionId,turns:s.turns,transcript:tr,previous_transcript:tr});
    assert.equal(r.verified,true);assert.equal(r.aliases.length,1);assert.equal(r.provider_only_message_indices.length,0);
    assert.equal(r.links.length,11);verifySpans(r,s.turns,tr);assert.equal(JSON.stringify(f),before);
    assert.deepEqual(r,reconcileTranscript({provider_session_id:tr.sessionId,turns:s.turns,transcript:tr,previous_transcript:tr}));
});

test('unseen split and merged utterances retain exact offsets in both directions',()=>{
    for(const [turns,tr] of [
        [local('Our team uses a shared mailbox.','Keep all replies as drafts.'),transcript('Our team uses a shared mailbox. Keep all replies as drafts.')],
        [local('The shipment arrived Tuesday. We declined the replacement.'),transcript('The shipment arrived Tuesday.','We declined the replacement.')],
        [local('A B','C'),transcript('A','B C')]
    ]){const r=check(turns,tr);assert.equal(r.verified,true);verifySpans(r,turns,tr);}
});

test('substrings, changed negation, changed numbers and punctuation are not exact evidence',()=>{
    for(const [a,b] of [
        [['Send the draft.'],['Do not send the draft.']],
        [['Yes'],['No Yes']],
        [['We have 4 staff.'],['We have 6 staff.']],
        [['Thanks.'],['Thanks!']],
        [['We use a CRM.'],['We use  a CRM.']],
        [['alpha','beta'],['alphabeta']]
    ])assert.equal(check(local(...a),transcript(...b)).verified,false,JSON.stringify([a,b]));
});

test('missing provider words, duplicate reuse and reordered visitor turns fail closed',()=>{
    for(const [a,b] of [
        [['Keep the email.','Do not send it.'],['Keep the email.']],
        [['Yes.','Yes.'],['Yes.']],
        [['Tuesday.','No refund.'],['No refund.','Tuesday.']],
        [['A B'],['A B C']],
        [['A','B'],['A C B']]
    ])assert.equal(check(local(...a),transcript(...b)).verified,false,JSON.stringify([a,b]));
});

test('whole provider-only turn recovery is explicit; ambiguous repeated matches are not certified',()=>{
    const tr=transcript('A document arrived.','No phone number provided.','Goodbye.');
    const r=check(local('A document arrived.','Goodbye.'),tr);
    assert.equal(r.verified,true);assert.deepEqual(r.provider_only_message_indices,[1]);
    assert.equal(check(local('Yes.'),transcript('Yes.','Yes.')).reason,'AMBIGUOUS_ALIGNMENT');
    assert.equal(check(local('Yes.','Yes.'),transcript('Yes.','Yes.')).verified,true);
});

test('never join visitor fragments across an intervening assistant reply',()=>{
    const t=local('First fact.','Second fact.');t.splice(1,0,{id:'persona::1',role:'persona',content:'What else?'});
    assert.equal(check(t,transcript('First fact. Second fact.')).verified,false);
    const p=transcript('First fact.','Second fact.');p.messages.splice(1,0,{role:'persona',message:'What else?'});p.totalMessages++;
    assert.equal(check(local('First fact. Second fact.'),p).verified,false);
});

test('provider capture aliases require exact prior same-session index, hash, role and text',()=>{
    const tr=transcript('Use drafts.','Never send.');
    const alias={id:'provider-capture:1:'+hash(tr.messages[1]).slice(0,12),role:'user',content:'Never send.'};
    const turns=[...local('Use drafts.'),alias];
    const good=check(turns,tr,{previous_transcript:tr});assert.equal(good.verified,true);assert.deepEqual(good.provider_only_message_indices,[1]);
    for(const [t,p] of [
        [turns,undefined],
        [turns,{...tr,sessionId:'another'}],
        [[...local('Use drafts.'),{...alias,content:'Send now.'}],tr],
        [[...local('Use drafts.'),{...alias,id:'provider-capture:0:'+hash(tr.messages[1]).slice(0,12)}],tr],
        [[...local('Use drafts.'),{...alias,id:'provider-capture:1:000000000000'}],tr],
        [[...local('Use drafts.'),{...alias,role:'persona'}],tr]
    ])assert.equal(check(t,tr,{previous_transcript:p}).reason,'INVALID_PROVIDER_CAPTURE');
});

test('session mismatch, disabled or incomplete provider transcript and duplicate local IDs cannot verify',()=>{
    const tr=transcript('Known fact.');
    for(const bad of [{...tr,sessionId:'wrong'},{...tr,transcriptsEnabled:false},{...tr,totalMessages:2},
        {...tr,messages:[{role:'system',message:'Known fact.'}]}])assert.equal(check(local('Known fact.'),bad).verified,false);
    assert.equal(check([{id:'dup',role:'user',content:'Known fact.'},{id:'dup',role:'user',content:'Known fact.'}],transcript('Known fact.','Known fact.')).verified,false);
});

test('read-only JSON reload preserves receipt identity and does not create release or approval authority',()=>{
    const turns=local('A document arrived.','The date is unknown.'),tr=transcript('A document arrived. The date is unknown.');
    const r=check(turns,tr);assert.equal(r.verified,true);
    assert.deepEqual(check(JSON.parse(JSON.stringify(turns)),JSON.parse(JSON.stringify(tr))),r);
    assert.equal('provider_release_verified' in r,false);assert.equal('approved' in r,false);assert.equal('status' in r,false);
});
