import test from 'node:test';
import assert from 'node:assert/strict';
import {clearExit,closingCourtesy} from '../lib/factory/visitor-exit.ts';

test('retained native ending supports exact split and combined forms without changing evidence',()=>{
    const first='Okay. Thanks, Bolivia.',last="That's all. Goodbye.";
    assert.equal(clearExit(first),false);assert.equal(closingCourtesy(first),true);
    assert.equal(clearExit(last),true);assert.equal(clearExit(first+' '+last),true);
    assert.equal(first,'Okay. Thanks, Bolivia.');assert.equal(last,"That's all. Goodbye.");
});
test('independent direct ending clauses work with natural punctuation and courtesies',()=>{
    for(const words of [
        'Goodbye,','Thanks, Rowan. Goodbye!','Okay, thank you, Dana. That is all; bye.',
        'Thanks for your help. Have a good day.',"I’m all set. Thanks.",
        "Okay, we're done.",'Bye, Morgan. Take care.','All right. Thank you and goodbye.',
        'Goodbye and take care.','  That’s all, goodbye!!!  ','Bye-bye.','Good night.',
        'Thank you for your time, Jean-Luc. I am all set for now.',
        "Thanks, O'Brien. We are finished.","That's everything. Have a nice evening.",
    ])assert.equal(clearExit(words),true,words);
});
test('ordinary acknowledgment never initiates closure but remains a trailing courtesy',()=>{
    for(const words of ['okay','Sure'])assert.equal(clearExit(words),false,words);
    for(const words of ['Thanks.','Thank you, Morgan.','Okay. Thanks, Olivia.',"You're welcome."]){
        assert.equal(clearExit(words),false,words);assert.equal(closingCourtesy(words),true,words);
    }
});
test('quoted, narrated, instructional and negated goodbyes are not exit intent',()=>{
    for(const words of [
        'My ex said goodbye yesterday.','She said goodbye and left.',
        '"Goodbye."',"'goodbye'",'“Goodbye.”','Please say goodbye.',
        'Tell me how to say goodbye.','What does goodbye mean?',
        "Don't say goodbye.","I'm not saying goodbye.",'Never say goodbye.',
        'Goodbye?','I said goodbye to the supplier, but I still need help.',
        'Thanks, but do not close.','Goodbye, not yet.','Bye, no.',
    ]){assert.equal(clearExit(words),false,words);assert.equal(closingCourtesy(words),false,words);}
});
test('meaningful facts/questions are not swallowed into a name or courtesy',()=>{
    const factsThenExit='Okay. My email is morgan@example.test. Goodbye.';
    assert.equal(clearExit(factsThenExit),true);assert.equal(closingCourtesy(factsThenExit),false);
    for(const words of [
        'Thanks, my email is different.','Goodbye, my email.',
        'Thanks for your help. One more question.','Goodbye. I need a quote.',
        'That is all we have in stock.','We are done with the spreadsheet.',
        'I am all set for the appointment.','Thanks, please send it now.',
    ]){assert.equal(clearExit(words),false,words);assert.equal(closingCourtesy(words),false,words);}
});
test('empty, malformed and bounded oversized input cannot trigger close',()=>{
    for(const words of ['', '   ','.!,;','and goodbye','goodbye and',
        'Goodbye\n<script>','goodbye '.repeat(100),'goodbye-','goodbye / thanks',null,undefined]){
        assert.equal(clearExit(words),false,String(words));assert.equal(closingCourtesy(words),false,String(words));
    }
});
