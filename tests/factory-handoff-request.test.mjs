import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedHandoffSpan} from '../lib/factory/handoff-request.ts';

test('retained direct request keeps the exact sentence and leaves other clauses untouched',()=>{
    const raw='Okay. Please prepare an unsent brief asking whether this workflow could be suitable. Do not email anyone. My phone is not consent to a call.';
    const before=raw,r=requestedHandoffSpan(raw);
    assert.deepEqual(r,{start:6,end:84,evidence:'Please prepare an unsent brief asking whether this workflow could be suitable.'});
    assert.equal(raw.slice(r.start,r.end),r.evidence);assert.equal(raw,before);
    assert.ok(raw.slice(r.end).includes('Do not email anyone.'));
});

test('a natural affirmative prefix retains the saved explicit unsent request verbatim',()=>{
    const raw='Yeah, please prepare an unsent brief asking whether this workflow could be suitable. I want a human assessment, not a booked meeting or a promised callback.';
    const evidence='Yeah, please prepare an unsent brief asking whether this workflow could be suitable.';
    const r=requestedHandoffSpan(raw);
    assert.deepEqual(r,{start:0,end:evidence.length,evidence});
    assert.equal(raw.slice(r.start,r.end),evidence);
    assert.equal(raw.slice(r.end),' I want a human assessment, not a booked meeting or a promised callback.');
});

test('colloquial affirmative prefixes still require an explicit local preparation request',()=>{
    for(const evidence of [
        'Yeah, could you draft a summary for the owner to review?',
        'Yep, create a short local review note about our intake process.',
        'Yup please prepare a concise brief for human review!',
        'YEAH, I would like you to create an unsent handoff note.',
    ]) {
        const raw=`We are exploring options.\n  ${evidence}  `;
        const start=raw.indexOf(evidence);
        assert.deepEqual(requestedHandoffSpan(raw),{start,end:start+evidence.length,evidence});
    }
});

test('affirmative prefixes do not override quotation, negation, conditions or delivery boundaries',()=>{
    for(const raw of [
        'Yeah.',
        'Yep, please.',
        'Yup, that sounds useful.',
        'Yeah, an unsent brief would be useful.',
        'Yeah, please prepare a summary of your services.',
        'Yeah, do not prepare an unsent brief.',
        "Yep, please don't draft a local summary.",
        'Yup, create a local brief. Actually, cancel drafting it.',
        'Yeah, if we proceed, please prepare an unsent brief.',
        'Yep, could you draft a local summary after I confirm?',
        '"Yeah, please draft an unsent brief."',
        'The manager wrote:\nYup, create a local review note.',
        'Yeah, please send the unsent brief.',
        'Yep, create an unsent summary and send it to our manager.',
        'Yup, please draft a local brief, then email it.',
    ]) assert.equal(requestedHandoffSpan(raw),null,raw);
});

test('independently phrased direct local preparation requests preserve raw offsets',()=>{
    for(const raw of [
        'Could you create a concise summary for owner review?',
        'Would you please draft a local brief?',
        "I'd like you to prepare an unsent summary.",
        'I would like you to create a summary for a human to review.',
        'I want you to draft a brief for human review.',
        'Yes, please create a local review note.',
        'Please draft an owner-review summary!',
        'We work with a shared inbox.\n  Can you prepare an unsent brief?  ',
        'Prepare a short summary for the owner to review.',
        'Please prepare an unsent brief about the question. Do not send it.',
    ]) {
        const r=requestedHandoffSpan(raw);assert.ok(r,raw);assert.equal(r.evidence,raw.slice(r.start,r.end));
        assert.ok(r.start>=0&&r.end<=raw.length);assert.equal(r.evidence,r.evidence.trim());
    }
});

test('negation, retraction, hypothetical and narration do not become requests',()=>{
    for(const raw of [
        'Do not prepare an unsent brief.',
        "Please don't prepare a summary for owner review.",
        'Please prepare an unsent brief. Actually, do not prepare it.',
        'If I asked you to prepare an unsent brief, what would be in it?',
        'Please prepare an unsent brief if we decide to proceed.',
        'Could you prepare a local summary once I have approval?',
        'My colleague asked you to prepare an unsent brief.',
        'She said: please prepare an unsent summary.',
        'My manager wrote:\nPlease prepare an unsent brief.',
        'She said. Please prepare an unsent brief.',
        'Can you explain how you prepare an unsent brief?',
        'No, I do not want an owner-review summary.',
    ]) assert.equal(requestedHandoffSpan(raw),null,raw);
});

test('quoted or code instructions are retained words, not current visitor intent',()=>{
    for(const raw of [
        '"Please prepare an unsent brief."',
        '“Please prepare an unsent brief.”',
        "'Please prepare an unsent brief.'",
        '‘Please prepare an unsent brief.’',
        '`Please prepare an unsent brief.`',
        'The note says “Okay. Please prepare an unsent brief.”',
        'Quote. Please prepare an unsent brief. Unquote.',
        'Instructions:\n```\nPlease prepare an unsent brief.\n```',
    ]) assert.equal(requestedHandoffSpan(raw),null,raw);
});

test('callback, delivery-only, generic summaries and mixed delivery are outside the bounded signal',()=>{
    for(const raw of [
        'Will someone call me today?',
        'Please send the summary to the firm.',
        'Email this information to the owner.',
        'I would like to book an appointment.',
        'Please prepare a brief.',
        'Please create a summary of your services.',
        'Please prepare an unsent brief and send it to the owner.',
        'Could you draft a local summary, then email it?',
        'Yes.',
        '',
        ' '.repeat(10),
        'Please prepare an unsent brief.'+'x'.repeat(8000),
    ]) assert.equal(requestedHandoffSpan(raw),null,raw.slice(0,120));
});

test('a request span cannot itself carry field mapping, acceptance, approval or transmission state',()=>{
    const result=requestedHandoffSpan('Please prepare an unsent brief.');
    assert.deepEqual(Object.keys(result).sort(),['end','evidence','start']);
    assert.equal(result.evidence,'Please prepare an unsent brief.');
});
