import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contradictingCorrection} from '../lib/factory/handoff-corrections.ts';
import {proposalIssues} from '../lib/factory/handoff.ts';
import {selectCurrentProposals} from '../lib/factory/handoff-current.ts';

const saved=JSON.parse(readFileSync(new URL('./fixtures/factory-handoff-format-20261109.json',import.meta.url),'utf8'));
const u=(id,content)=>({id,role:'user',content});
function detect(correction,evidence='We have 6 staff.') {
    const turns=[u('old',evidence),u('correction',correction)],before=JSON.stringify(turns);
    const result=contradictingCorrection(turns,'old',evidence);
    assert.equal(JSON.stringify(turns),before,'all source words and IDs remain immutable');
    return result;
}

test('saved compound consent and correction flags every broad six-staff quote without altering evidence',()=>{
    const before=JSON.stringify(saved),turns=saved.turns_before_attempt;
    const correction=turns.find(t=>t.role==='user'&&t.content.startsWith('Yeah, do that'));
    assert.ok(correction);
    for(const index of [0,1,3,4]) {
        const p=saved.original_proposals[index];
        assert.equal(contradictingCorrection(turns,p.visitor_message_id,p.evidence),correction);
    }
    for(const index of [1,4]) {
        const p=saved.original_proposals[index];
        assert.equal(contradictingCorrection(turns,p.visitor_message_id,p.value),null,'unrelated exact statements are not stale');
    }
    assert.equal(JSON.stringify(saved),before);
});

test('affirmative or coordinated clauses can introduce independently worded explicit corrections',()=>{
    for(const correction of [
        'Yes, please prepare it, one correction, 4 staff handle requests, not 6.',
        'That sounds useful; a correction: we have 4 staff, not 6.',
        'Please retain the draft and actually we have 4 staff, not 6.',
        'The draft can proceed but to correct that, we have 4 staff, not 6.',
        'Proceed with the draft. I meant 4 staff, not 6.',
        'Please prepare it\nQuick correction: we have 4 staff, not 6.',
    ])assert.equal(detect(correction)?.id,'correction',correction);
    assert.equal(detect('Yes, one correction, 4 staff, not 6. The portal API is unknown.')?.id,'correction');
    assert.equal(detect('Yes, one correction, 4 staff, not 6. I do not know if the portal has an API.')?.id,'correction');
});

test('narrated, quoted, conditional, uncertain, questioned or disclaimed prefixes do not assert corrections',()=>{
    for(const correction of [
        'My colleague said, one correction, 4 staff, not 6.',
        'Please say, one correction, 4 staff, not 6.',
        'For example, one correction, 4 staff, not 6.',
        'Imagine this, one correction, 4 staff, not 6.',
        'Yes, "one correction, 4 staff, not 6."',
        "Yes, 'Please prepare it, one correction, 4 staff, not 6.'",
        'Yes, ‘Please prepare it, one correction, 4 staff, not 6.’',
        'If we proceed, one correction, 4 staff, not 6.',
        'Maybe prepare it, one correction, 4 staff, not 6.',
        'Yes, one correction, I think we have 4 staff, not 6.',
        'Can you prepare it? One correction, 4 staff, not 6.',
        'Yes, one correction, do we have 4 staff, not 6?',
        'Do not apply this, one correction, 4 staff, not 6.',
        'This is not a correction, actually 4 staff, not 6.',
        'Please ignore this, one correction, 4 staff, not 6.',
        'The text reads: prepare it, one correction, 4 staff, not 6.',
    ])assert.equal(detect(correction),null,correction);
});

test('markers inside a clause or after an earlier contrast do not claim that contrast as a correction',()=>{
    assert.equal(detect('Our one correction is 4 staff, not 6.'),null);
    assert.equal(detect('We have 4 staff, not 6, and one correction concerns email.'),null);
    assert.equal(detect('Yes, one correction, 4 locations, not 6.'),null);
    assert.equal(detect('Yes, one correction, 4 staff, not 6.','We do not have 6 staff.'),null);
});

test('recognized compound correction partitions exact details without remapping its witness field',()=>{
    const turns=saved.turns_before_attempt,input=structuredClone(saved.original_proposals);
    const correction=turns.find(t=>t.role==='user'&&t.content.startsWith('Yeah, do that'));
    // Isolate current-fact selection from the independently repaired format and reference errors.
    for(const p of input)p.value=p.evidence;
    input[5].visitor_message_id=correction.id;
    const before=JSON.stringify(input),selection=selectCurrentProposals(input,turns,saved.fields);
    assert.deepEqual(selection.superseded,[]);
    assert.equal(selection.selected.length,10);
    assert.deepEqual(selection.current_fact_selections.map(row=>row.resolved_index),[0,1,3,4]);
    assert.deepEqual(selection.selected.filter(p=>p.visitor_message_id===correction.id),[input[5]]);
    assert.ok(selection.selected.some(p=>p.value.includes('that handle quote requests arriving by email.')));
    for(const row of selection.current_fact_selections)assert.deepEqual(row.original,input[row.resolved_index]);
    const issues=proposalIssues(selection.selected,turns,saved.fields);
    assert.deepEqual(issues,[]);
    assert.equal(JSON.stringify(input),before);
});
