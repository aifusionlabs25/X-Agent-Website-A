import test from 'node:test';
import assert from 'node:assert/strict';
import {appendTurn,decide,digest} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';

const fields=[{id:'context',label:'Context'},{id:'constraint',label:'Constraint'}];
const u=(id,content)=>({id,role:'user',content});
const p=(turn,field_id='context')=>({field_id,visitor_message_id:turn.id,evidence:turn.content,value:turn.content});
const fresh=()=>({id:'local',version:1,package_sha256:'offline',persona_id:'persona',launch_label:'offline:qualifier',
    status:'ACTIVE',provider_session_id:'provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],
    provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,
    submission_status:'UNSUBMITTED',external_actions:[]});
const apply=(s,input,call)=>recordProviderHandoffAttempt(s,input,fields,'request-'+call,
    {local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:call});
const cases=[
    ['We have six staff that handle quote requests by email.','Correction: we have four staff, not six staff.'],
    ['The delivery address is Cedar Avenue near our warehouse.','Correction: use Pine Street, not Cedar Avenue.'],
    ...[
        'for quote requests','in our warehouse','at the office','on weekdays','under the previous process',
        'over the holiday period','before lunch','after lunch','during the morning','until review',
        'without customer names','except on Fridays','including for new orders','since last spring',
        'to record quotes','from the front desk','by the loading dock','through the weekend',
        'between review sessions','within the office','outside the shop','beside the register',
        'around the holidays','beyond the initial review','only for drafts',
    ].map(tail=>['We use a paper ledger '+tail+'.','Correction: use a spreadsheet, not paper ledger.']),
];

test('provider same-batch selection declines qualified notes and spelled counts without losing their original details',()=>{
    for(const [text,correction] of cases) {
        const s=fresh(),source=u('old',text),current=u('current',correction),sibling=u('sibling','The owner reviews every quote.');
        for(const turn of [source,sibling,current])appendTurn(s,turn);
        const raw=[p(source),p(current),p(sibling,'constraint')],before=JSON.stringify(raw),turns=structuredClone(s.turns);
        const result=apply(s,raw,'batch');
        assert.equal(result.accepted,false,text);assert.equal(s.proposals.length,0);assert.equal(s.superseded_mappings,undefined);
        assert.ok(result.issues.some(issue=>issue.problems.includes('LATER_EXPLICIT_CORRECTION_REQUIRES_CURRENT_EVIDENCE')));
        assert.deepEqual(s.quarantined_proposals[0].proposals,raw);assert.deepEqual(s.turns,turns);assert.equal(JSON.stringify(raw),before);
        assert.equal(s.handoff_binding_attempts[0].applied,false);assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
    }
});

test('provider stored updates retain qualified notes, unrelated mappings and historical owner decisions when selection is unsupported',()=>{
    for(const [text,correction] of cases) {
        const s=fresh(),source=u('old',text),sibling=u('sibling','The owner reviews every quote.');
        appendTurn(s,source);appendTurn(s,sibling);assert.equal(apply(s,[p(source),p(sibling,'constraint')],'initial').accepted,true);
        s.provider_transcript_verified=true;decide(s,digest(p(source)),'ACCEPT',fields);
        const current=u('current',correction);appendTurn(s,current);appendTurn(s,u('request','Please prepare a brief for human review.'));
        const proposals=structuredClone(s.proposals),decisions=structuredClone(s.decisions),turns=structuredClone(s.turns),raw=[p(current)];
        const result=apply(s,raw,'update');
        assert.equal(result.accepted,false,text);assert.deepEqual(s.proposals,proposals);assert.deepEqual(s.decisions,decisions);
        assert.deepEqual(s.turns,turns);assert.equal(s.superseded_mappings,undefined);assert.deepEqual(s.quarantined_proposals[0].proposals,raw);
        assert.ok(s.proposals.some(row=>row.evidence===text));assert.ok(s.proposals.some(row=>row.id===digest(p(sibling,'constraint'))));
        assert.equal(s.handoff_binding_attempts.at(-1).applied,false);assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
    }
});

test('established simple paper-ledger and delivery-address corrections retain their same-field selection behavior',()=>{
    for(const [text,correction] of [
        ['We use a paper ledger.','Correction: use a spreadsheet, not paper ledger.'],
        ['The delivery address is Cedar Avenue.','Correction: use Pine Street, not Cedar Avenue.'],
    ])for(const stored of [false,true]) {
        const s=fresh(),source=u('old',text),current=u('current',correction);appendTurn(s,source);
        if(stored)assert.equal(apply(s,[p(source)],'initial').accepted,true);
        appendTurn(s,current);
        const result=apply(s,stored?[p(current)]:[p(source),p(current)],'current');
        assert.equal(result.accepted,true,text);assert.deepEqual(s.proposals.map(row=>row.value),[correction]);
        assert.equal(s.approved,false);assert.deepEqual(s.decisions,[]);assert.deepEqual(s.external_actions,[]);
    }
});
