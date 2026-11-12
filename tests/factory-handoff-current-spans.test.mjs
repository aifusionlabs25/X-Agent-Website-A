import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectCurrentFact} from '../lib/factory/handoff-current-spans.ts';
import {assertProposal,digest} from '../lib/factory/handoff.ts';

const fields=[{id:'context',label:'Context'},{id:'constraint',label:'Constraints'}];
const u=(id,content)=>({id,role:'user',content});
const p=(t,field_id='context',evidence=t.content)=>({field_id,visitor_message_id:t.id,evidence,value:evidence});
function project(content,correction='Correction: we have 4 staff, not 6.',evidence=content) {
    const turns=[u('old',content),u('current',correction)],original=p(turns[0],'context',evidence),input=[original,p(turns[1],'constraint')];
    const before=JSON.stringify({turns,input});
    const result=projectCurrentFact(original,input,turns,fields,0);
    assert.equal(JSON.stringify({turns,input}),before,'projection never mutates source or supplied proposals');
    return {result,turns,input};
}
function coverage(result,turns,allowed=fields) {
    assert.ok(result);
    const b=result.binding,source=turns.find(t=>t.id===b.original.visitor_message_id);
    assert.equal(b.rule,'EXACT_POSITIVE_COUNT_PARTITION');assert.equal(b.source_sha256,digest(source));
    assert.equal(source.content.slice(b.evidence_start,b.evidence_end),b.original.evidence);
    assert.equal(source.content.slice(b.removed_span.start,b.removed_span.end),b.removed_span.text);
    const all=[{start:b.removed_span.start,end:b.removed_span.end,text:b.removed_span.text},
        ...b.retained_spans.map(s=>({start:s.start,end:s.end,text:s.proposal.evidence}))].sort((a,b)=>a.start-b.start);
    let cursor=b.evidence_start;
    for(const s of all){assert.equal(s.start,cursor);assert.equal(source.content.slice(s.start,s.end),s.text);cursor=s.end;}
    assert.equal(cursor,b.evidence_end);assert.equal(all.map(s=>s.text).join(''),b.original.evidence);
    for(const s of b.retained_spans){assert.equal(s.proposal.value,s.proposal.evidence);assert.equal(s.proposal.field_id,b.original.field_id);assert.equal(s.proposal.visitor_message_id,source.id);}
    for(const q of result.proposals)assertProposal(q,turns,allowed);
    assert.equal(b.correction_turn_sha256,digest(b.correction_turn));
    assert.equal(b.correction_proposal.evidence,b.correction_turn.content);
    assert.equal(b.correction_proposal.value,b.correction_turn.content);
}

test('saved broad quotes retain every unaffected span, including the email-arrival relative clause',()=>{
    const saved=JSON.parse(readFileSync(new URL('./fixtures/factory-handoff-format-20261109.json',import.meta.url),'utf8'));
    const turns=saved.turns_before_attempt,input=structuredClone(saved.original_proposals),before=JSON.stringify(saved);
    for(const q of input)q.value=q.evidence;
    input[5].visitor_message_id=turns.at(-1).id;
    for(const index of [0,1,3,4]) {
        const result=projectCurrentFact(input[index],input,turns,saved.fields,index);coverage(result,turns,saved.fields);
        assert.equal(result.binding.resolved_index,index);assert.equal(result.binding.removed_span.text,'We have 6 staff');
        assert.equal(result.binding.correction_proposal_index,5);assert.deepEqual(result.binding.correction_proposal,input[5]);
        assert.ok(result.proposals.some(q=>q.evidence.includes('that handle quote requests arriving by email.')));
        assert.ok(result.proposals.some(q=>q.evidence.includes('They copy details into a spreadsheet, but we sometimes miss requests.')));
        assert.ok(result.proposals.some(q=>q.evidence.includes('A person must approve every quote before anything goes to the customer though.')));
        assert.ok(result.proposals.every(q=>q.field_id===input[index].field_id));
    }
    assert.equal(JSON.stringify(saved),before);
});

test('positive frame variants retain relative clauses and unrelated facts verbatim',()=>{
    for(const [content,correction,removed] of [
        ['We have 6 staff. We use email.','Correction: we have 4 staff, not 6.','We have 6 staff.'],
        ['I have 12 agents who review drafts.','Actually I have 9 agents, not 12.','I have 12 agents'],
        ['They have 10 operators that do not send quotes unless approved.','Correction: they have 8 operators, not 10.','They have 10 operators'],
        ['Our team has 8 people. There are 2 branches.','Actually our team has 5 people, not 8.','Our team has 8 people.'],
        ['The team has 7 staff! Email intake stays.','Correction: we have 3 staff, not 7.','The team has 7 staff!'],
        ['There are 11 agents that handle requests by email.','Correction: there are 8 agents, not 11.','There are 11 agents'],
    ]) {
        const {result,turns}=project(content,correction);coverage(result,turns);assert.equal(result.binding.removed_span.text,removed);
        assert.equal(result.binding.correction_proposal.field_id,'constraint');
        assert.ok(result.proposals.every(q=>q.field_id==='context'));
    }
});

test('unqualified positive work participles retain complete predicates and independent facts verbatim',()=>{
    for(const [content,correction,removed,predicate] of [
        ['We have 6 staff handling requests by email. The portal is unchanged.','4 staff handle requests, not 6.','We have 6 staff',' handling requests by email. The portal is unchanged.'],
        ['Our team has 11 operators processing draft orders. A person approves them.','Actually our team has 7 operators, not 11.','Our team has 11 operators',' processing draft orders. A person approves them.'],
        ['I have 9 assistants reviewing forms. Budget is unknown.','Correction: I have 5 assistants, not 9.','I have 9 assistants',' reviewing forms. Budget is unknown.'],
        ['There are 8 representatives answering questions.','5 representatives answer questions, not 8.','There are 8 representatives',' answering questions.'],
        ['7 people preparing estimates.','3 people prepare estimates, not 7.','7 people',' preparing estimates.'],
        ['They have 12 operators managing requests.','Correction: they have 8 operators, not 12.','They have 12 operators',' managing requests.'],
        ['We have 10 assistants receiving orders.','Correction: we have 6 assistants, not 10.','We have 10 assistants',' receiving orders.'],
    ]) {
        const {result,turns}=project(content,correction);coverage(result,turns);
        assert.equal(result.binding.removed_span.text,removed);assert.ok(result.proposals.some(p=>p.value===predicate));
        assert.equal(result.binding.correction_proposal.field_id,'constraint');
    }
});

test('work-participle projection still declines qualified, negated, narrated or ambiguous assertions',()=>{
    for(const content of [
        'We do not have 6 staff handling requests.','If we have 6 staff handling requests, we can reply.',
        'We might have 6 staff handling requests.','We have only 6 staff handling requests.',
        'We have 6 staff handling requests only if approved.','We have 6 staff handling requests unless reassigned.',
        'We have 6 staff handling requests temporarily.','We have 6 staff handling requests until reassignment.',
        'We have 6 staff handling requests sometimes.','We have 6 staff handling requests, not invoices.',
        'We have 6 staff handling 2 categories.','We have 6 staff handling requests?',
        'My colleague said. We have 6 staff handling requests.','"We have 6 staff handling requests."',
        'We have 6 staff handling requests. They have 6 staff handling orders.',
    ])assert.equal(project(content).result,null,content);
    assert.equal(project('They have 6 staff handling requests.','Correction: we have 4 staff, not 6.').result,null);
    assert.equal(project('We have 6 staff handling requests.','Correction: we have 4 offices, not 6.').result,null);
});

test('absolute source offsets and whitespace-only residuals remain covered in the audit',()=>{
    for(const [content,evidence] of [['Background.  We have 6 staff.  End.',' We have 6 staff. '],['  We have 6 staff.  ','  We have 6 staff.  '],['We have 6 staff','We have 6 staff']]) {
        const {result,turns}=project(content,undefined,evidence);coverage(result,turns);
        assert.equal(result.proposals.length,0);
        assert.ok(result.binding.retained_spans.every(s=>!s.proposal.evidence.trim()));
    }
});

test('source-level negation, conditions, narration, questions, qualifiers and ambiguous scopes fail closed',()=>{
    for(const content of [
        'If we have 6 staff, we can send quotes.','We do not have 6 staff.','We might have 6 staff.',
        'We have at least 6 staff.','We have only 6 staff.','We have 6 staff only.',
        'We have 6 staff in Reno.','We have 6 staff and use email.','We have 6 staff, not 4.',
        'We have 6 staff with 2 branches.','We have 6 staff that work 2 shifts.',
        'We have 6 staff?','We have 6 staff who handle requests?',
        'We have 6 staff who handle requests\nif possible?',
        'My colleague said: We have 6 staff.','My colleague said. We have 6 staff.',
        'For example. We have 6 staff.','Imagine. We have 6 staff.','"We have 6 staff."',
        '“We have 6 staff.”',"'We have 6 staff.'",'There are 6 staff and 6 staff on another shift.',
        'We have 6 staff. We have 6 staff.','We have 6 staff... Maybe.','If approved\nWe have 6 staff.',
    ])assert.equal(project(content).result,null,content);
    for(const source of ['If We have 6 staff.','We do not think We have 6 staff.','My colleague said: We have 6 staff.'])
        assert.equal(project(source,undefined,'We have 6 staff.').result,null,'a narrowed evidence quote cannot hide its source scope');
});

test('missing, partial, duplicate, invalid or subsequently stale correction witnesses do not partition',()=>{
    const turns=[u('old','We have 6 staff that handle email.'),u('current','Correction: we have 4 staff, not 6.')],original=p(turns[0]),current=p(turns[1],'constraint');
    for(const input of [[original],[original,{...current,evidence:'we have 4 staff',value:'we have 4 staff'}],
        [original,current,current],[original,{...current,field_id:'unknown'}],[original,{...current,value:'Four staff'}],
        [original,{...current,visitor_message_id:'unknown'}],[original,{...current,extra:true}],[],null,Array(25).fill(current)])
        assert.equal(projectCurrentFact(original,input,turns,fields,0),null,JSON.stringify(input));
    turns.push(u('newest','Correction: we have 3 staff, not 4.'));
    assert.equal(projectCurrentFact(original,[original,current,p(turns[2],'constraint')],turns,fields,0),null);
});

test('different units and multiword negations cannot manufacture a numerical replacement',()=>{
    for(const correction of ['Correction: we have 4 locations, not 6.','Correction: not we have 6 staff.',
        'Correction: we have 4 locations, not 6. It is not we have 6 staff.',
        'Correction: maybe we have 4 staff, not 6.','Correction: if we have 4 staff, not 6, this works.'])
        assert.equal(project('We have 6 staff.',correction).result,null,correction);
    for(const [source,correction] of [
        ['They have 6 staff.','Correction: we have 4 staff, not 6.'],
        ['We have 6 staff.','Correction: they have 4 staff, not 6.'],
        ['Our team has 6 staff.','Correction: their team has 4 staff, not 6.'],
    ])assert.equal(project(source,correction).result,null,source+' / '+correction);
});

test('projection does not repair a malformed original or choose repeated source occurrences',()=>{
    const {turns,input}=project('We have 6 staff.');
    for(const original of [{...input[0],value:'6 staff'},{...input[0],field_id:'unknown'},
        {...input[0],extra:true},{...input[0],visitor_message_id:'missing'},null])
        assert.equal(projectCurrentFact(original,input,turns,fields,0),null);
    const repeated=[u('old','We have 6 staff. We have 6 staff.'),turns[1]],original=p(repeated[0],'context','We have 6 staff.');
    assert.equal(projectCurrentFact(original,[original,p(turns[1])],repeated,fields,0),null);
    assert.equal(project('We have 6 staff. They have 6 staff.',undefined,'We have 6 staff.').result,null);
});
