import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {candidateSpeakingPrompt} from '../lib/james-canary/speaking-style.ts';
import {candidateRuntimeConfig,verifyCandidateRuntime} from '../lib/james-canary/runtime-session.ts';
import {applyTurn,emptyIntake,sha,view} from '../lib/james-canary/state.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/james-candidate-runtime.json',import.meta.url),'utf8'));
const original=fixture.candidate.brain.systemPrompt;
const paragraph='Default to brief acknowledgment → useful synthesis → forward movement. Give each turn one primary job. Answer a meaningful direct question first when you can do so within authority; do not use intake questions to avoid a permissible answer.';
const baselineHash='4ff9a5aee9a23b95e1b8c85b7c3ac67869424fff319d786a1aadacbe4958b1b7';
let sequence=0;
function base(){return {id:'offline-speaking-style',browserId:'offline',clientLabel:'offline',createdAt:'2026-10-13T00:00:00Z',revision:0,stateHash:'offline',
    personaId:fixture.candidate.id,config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},
    websiteClosing:{policy:'JAMES-CLOSE-001',runtimeOwned:true},receipts:[]};}
function say(s,role,content){return applyTurn(s,{id:'speaking-style-'+(++sequence),role,content});}
function row(s,key){return view(s).intakeBrief.sections.flatMap(section=>section.rows).find(row=>row.key===key);}
function shortIntake(){
    let s=say(base(),'persona','What happened?');
    s=say(s,'user','I was arrested earlier in Phoenix. I was processed and released.');
    s=say(s,'persona','What is your full name, callback number, and email?');
    s=say(s,'user','Michael Carter 602-555-0138 and michael.carter@example.test');
    return s;
}
function runtime(){
    const {config,binding}=candidateRuntimeConfig(structuredClone(fixture.candidate));
    const expected={clientLabel:'offline-speaking-verification',createdAt:'2026-10-03T06:00:00Z',runtimeBinding:binding};
    const metadata={id:'offline',personaId:null,clientLabel:expected.clientLabel,startTime:expected.createdAt,
        endTime:null,exitStatus:null,personaConfig:structuredClone(fixture.resolvedConfig)};
    metadata.personaConfig.brainType='ANAM_GPT_4O_MINI_V1';
    metadata.personaConfig.llmConfig={id:binding.llmId,modelName:'qwen/qwen3.6-27b'};
    return {config,binding,expected,metadata};
}

test('speaking-style amendment replaces precisely one paragraph and leaves all other bytes unchanged',()=>{
    const before=structuredClone(fixture),amended=candidateSpeakingPrompt(original),parts=original.split(paragraph);
    assert.equal(parts.length,2);assert.notEqual(amended,original);
    assert.ok(amended.startsWith(parts[0]));assert.ok(amended.endsWith(parts[1]));
    const replacement=amended.slice(parts[0].length,amended.length-parts[1].length);
    assert.ok(replacement);assert.ok(!replacement.includes('\n\n'),'one paragraph only');
    assert.equal(amended.replace(replacement,paragraph),original);
    assert.match(replacement,/without repeating or paraphrasing/i);
    assert.match(replacement,/brief acknowledgment is optional/i);
    assert.match(replacement,/single concise closing recap/i);
    assert.match(replacement,/necessary exact contact confirmations, uncertainty/i);
    assert.equal(sha(original),baselineHash);assert.deepEqual(fixture,before);
});

test('missing, duplicated, or already amended speaking-style baseline fails closed',()=>{
    for(const prompt of [original.replace(paragraph,''),original+'\n\n'+paragraph,candidateSpeakingPrompt(original)])
        assert.throws(()=>candidateSpeakingPrompt(prompt),/speaking-style baseline/i);
});

test('source, uncertainty, retrieval, contact, and closing safeguards remain unchanged',()=>{
    const amended=candidateSpeakingPrompt(original);
    for(const text of [
        'Do not give legal advice',
        'Before answering a general Arizona DUI, criminal-court, or MVD process question, call the approved knowledge tool and wait for its result',
        'Normally ask one focused question at a time',
        'Verify only as needed. Never infer a name from email, invent digits, silently alter email spelling/punctuation, or use general recap agreement to resolve uncertain contact data.',
        'Give one concise recap of source-supported facts, timing, current status, meaningful uncertainty, principal concern, and requested help.',
        'Runtime owns provider state, tool gates, hangup functions, UI state, and termination',
    ]){assert.ok(original.includes(text),text);assert.ok(amended.includes(text),text);}
});

test('runtime config and verification binding use the amended prompt without editing the saved baseline',()=>{
    const candidate=structuredClone(fixture.candidate),before=structuredClone(candidate);
    const {config,binding}=candidateRuntimeConfig(candidate),amended=candidateSpeakingPrompt(original);
    assert.equal(config.systemPrompt,amended);assert.equal(binding.promptHash,sha(amended));
    assert.notEqual(binding.promptHash,baselineHash);assert.deepEqual(candidate,before);
    assert.equal(sha(candidate.brain.systemPrompt),baselineHash);
    assert.deepEqual(config.toolIds,candidate.tools.filter(tool=>tool.name!=='end_call').map(tool=>tool._toolId));
});

test('amended session metadata verifies but the old unamended session cannot satisfy the new binding',()=>{
    const {config,expected,metadata}=runtime();
    assert.throws(()=>verifyCandidateRuntime(metadata,expected),/prompt mismatch/i);
    metadata.personaConfig.systemPrompt=config.systemPrompt;
    assert.doesNotThrow(()=>verifyCandidateRuntime(metadata,expected));
});

test('predeployment persisted bindings still verify their original sessions without accepting the new prompt',()=>{
    const {config,binding,expected,metadata}=runtime();
    const oldExpected={...expected,runtimeBinding:{...structuredClone(binding),promptHash:baselineHash}};
    const beforeBinding=structuredClone(oldExpected),beforeMetadata=structuredClone(metadata);
    assert.equal(sha(metadata.personaConfig.systemPrompt),baselineHash);
    assert.doesNotThrow(()=>verifyCandidateRuntime(metadata,oldExpected));
    assert.deepEqual(oldExpected,beforeBinding);assert.deepEqual(metadata,beforeMetadata);
    metadata.personaConfig.systemPrompt=config.systemPrompt;
    assert.throws(()=>verifyCandidateRuntime(metadata,oldExpected),/prompt mismatch/i);
    assert.deepEqual(oldExpected,beforeBinding,'verification must not upgrade an old saved binding');
});

test('saved persona drift remains rejected rather than being hidden by the speaking-style amendment',()=>{
    const candidate=structuredClone(fixture.candidate);candidate.brain.systemPrompt+='\nUnexpected saved persona change';
    assert.throws(()=>candidateRuntimeConfig(candidate),/baseline drift/i);
});

test('short non-echo intake questions preserve visitor-grounded name, contact, and matter notes',()=>{
    const s=shortIntake(),last=s.turns.at(-1);
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'phone').value,'602-555-0138');
    assert.equal(row(s,'email').value,'michael.carter@example.test');assert.match(row(s,'reason').value,/arrested earlier/i);
    assert.equal(row(s,'name').confirmed,false);assert.equal(row(s,'phone').confirmed,false);assert.equal(row(s,'email').confirmed,false);
    assert.ok(!s.turns.some(t=>t.role==='persona'&&t.content.includes('Michael Carter')),'notes exist before James repeats any name');
    for(const fact of s.intake.facts.filter(f=>f.turnId===last.id)){
        assert.equal(fact.sourceHash,sha(last.content));assert.ok(last.content.includes(fact.evidence));
    }
});

test('a focused question preserves reported uncertainty without a spoken mini-recap',()=>{
    let s=shortIntake();s=say(s,'persona','What does the paperwork mention?');
    const text="I think it mentioned a license hearing, but I don't remember the date.";s=say(s,'user',text);
    const facts=s.intake.facts.filter(f=>f.turnId===s.turns.at(-1).id);
    assert.ok(facts.some(f=>f.status==='NEEDS_CLARIFICATION'));
    for(const fact of facts){assert.equal(fact.sourceHash,sha(text));assert.ok(text.includes(fact.evidence));}
    assert.equal(row(s,'name').value,'Michael Carter');assert.equal(row(s,'phone').value,'602-555-0138');
});

test('necessary targeted contact confirmations still work with concise speaking',()=>{
    let s=shortIntake();
    for(const [question,answer,key]of [
        ['Is your name Michael Carter correct?','Yes.','name'],
        ['Your callback number is six zero two, five five five, zero one three eight. Is that correct?','Yes.','phone'],
        ['Your email is michael.carter at example dot test. Is that correct?','Yes.','email'],
    ]){s=say(s,'persona',question);s=say(s,'user',answer);assert.equal(row(s,key).confirmed,true,key);}
    assert.equal(s.intake.emailCandidate,undefined);
});

test('a short summary agreement cannot pretend uncertain contact fields were individually verified',()=>{
    let s=shortIntake();s=say(s,'persona','Your name is Michael Carter, callback 602-555-0138, and email michael.carter@example.test. Have I got that right?');
    s=say(s,'user','Yes.');
    assert.equal(row(s,'name').confirmed,false);assert.equal(row(s,'phone').confirmed,false);
});

test('one brief farewell preserves runtime-owned departure recognition without repeated facts',()=>{
    let s=shortIntake();s=say(s,'user','Thanks. Goodbye.');
    assert.equal(s.state,'CLOSING_PENDING');s=say(s,'persona','Take care.');
    assert.equal(s.websiteClosing.farewellTurnId,s.turns.at(-1).id);
    assert.equal(s.websiteClosing.reason,'VISITOR_DEPARTURE');
});
