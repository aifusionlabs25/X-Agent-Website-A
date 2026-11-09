import test from 'node:test';
import assert from 'node:assert/strict';
import {contradictingCorrection} from '../lib/factory/handoff-corrections.ts';

function detect(original,correction,evidence=original) {
    const turns=[{id:'old-source',role:'user',content:original},{id:'new-source',role:'user',content:correction}];
    const before=JSON.stringify(turns);
    const result=contradictingCorrection(turns,'old-source',evidence);
    assert.equal(JSON.stringify(turns),before,'raw evidence is immutable');
    return result;
}
test('explicit numeric correction retains its original source turn',()=>{
    assert.equal(detect('We have 6 staff.','One correction, we have 4 staff, not 6.').content,'One correction, we have 4 staff, not 6.');
});
test('independently worded counts require a concrete matching subject',()=>{
    for(const [old,current] of [
        ['Our team has 10 people.','Actually our team is 8 people, not 10.'],
        ['The delivery count is 5.','Correction: delivery count is 3, not 5.'],
        ['There are 12 locations.','A correction: there are 9 locations, not 12.'],
        ['The number of staff is 7.','Just to correct that, we have 5 staff, not 7.'],
        ['We have 11 staff.','Correction: the staff count is 8, not 11.'],
    ])assert.equal(detect(old,current)?.id,'new-source',current);
});
test('shared numbers do not cross units or erase an unrelated sibling quote',()=>{
    assert.equal(detect('We have 6 locations.','One correction, we have 4 staff, not 6.'),null);
    assert.equal(detect('The invoice count is 5.','Correction: delivery count is 3, not 5.'),null);
    assert.equal(detect('We have 6 staff. We use Gmail.','One correction, we have 4 staff, not 6.','We use Gmail.'),null);
    assert.equal(detect('We have 6 locations in our team.','Correction: we have 4 staff in our team, not 6.'),null);
});
test('bare and ambiguous numeric contrasts require owner review',()=>{
    for(const current of ['Correction: 4, not 6.','One correction, we have 4 staff and 3 locations, not 6.','Correction: we have 6 staff, not 6.'])
        assert.equal(detect('We have 6 staff.',current),null,current);
    assert.equal(detect('There are 6 staff and 6 staff on another shift.','Correction: we have 4 staff, not 6.'),null);
});
test('a unique count stays stale inside a compound quote without erasing distinct counts',()=>{
    const correction='Correction: we have 8 people, not 10.';
    for(const original of ['We have 10 people (2 branches).','We have 10 people working 2 shifts.','Across 2 branches we have 10 people.'])
        assert.equal(detect(original,correction)?.id,'new-source',original);
    assert.equal(detect('The delivery count is 5 with 2 branches.','Correction: delivery count is 3, not 5.')?.id,'new-source');
    for(const original of ['We have 10 people with 2 people on another shift.','We have 10 people (10 branches).'])
        assert.equal(detect(original,correction),null,original);
    assert.equal(detect('We have 10 locations working 2 shifts.',correction),null);
    assert.equal(detect('We have 10 people working 2 shifts.','Correction: we have 4 people, not 2.'),null);
});
test('narrated, quoted, uncertain, conditional or questioned corrections do not assert a replacement',()=>{
    for(const current of ['My colleague said we have 4 staff, not 6.','Actually my colleague said we have 4 staff, not 6.',
        'Correction: "we have 4 staff, not 6."','One correction, I think we have 4 staff, not 6.',
        'Actually, if we have 4 staff, not 6, can this work?','Actually, are there 4 staff, not 6?'])
        assert.equal(detect('We have 6 staff.',current),null,current);
});
test('meaningful negatives and instructions are not old positive count claims',()=>{
    assert.equal(detect('We do not have 6 staff.','Correction: we have 4 staff, not 6.'),null);
    assert.equal(detect("We don't have 6 staff.",'Correction: we have 4 staff, not 6.'),null);
    assert.equal(detect('There aren’t 6 staff.','Correction: we have 4 staff, not 6.'),null);
    assert.equal(detect('There are no 6 staff teams.','Correction: we have 4 staff, not 6.'),null);
    assert.equal(detect('Please do not send emails.','Correction: send a draft, not emails.'),null);
});
test('existing exact multiword correction behavior and provenance remain',()=>{
    assert.equal(detect('The delivery address is Cedar Avenue.','Correction: use Pine Street, not Cedar Avenue.')?.id,'new-source');
    assert.equal(detect('The delivery address is not Cedar Avenue.','Correction: use Pine Street, not Cedar Avenue.'),null);
    assert.equal(detect('Budget is unknown.','Correction: use Pine Street, not Cedar Avenue.'),null);
});
test('assistant and earlier turns never become a later visitor correction',()=>{
    const turns=[{id:'earlier',role:'user',content:'Correction: we have 4 staff, not 6.'},{id:'source',role:'user',content:'We have 6 staff.'},{id:'assistant',role:'persona',content:'Correction: we have 4 staff, not 6.'}];
    assert.equal(contradictingCorrection(turns,'source',turns[1].content),null);
});
