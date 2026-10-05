import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {candidateRuntimeConfig,verifyCandidateRuntime} from '../lib/james-canary/runtime-session.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/james-candidate-runtime.json',import.meta.url),'utf8'));
function setup(){
    const {config,binding}=candidateRuntimeConfig(structuredClone(fixture.candidate));
    const expected={clientLabel:'offline-verification',createdAt:'2026-10-03T06:00:00Z',runtimeBinding:binding};
    const metadata={id:'offline',personaId:null,clientLabel:expected.clientLabel,startTime:expected.createdAt,
        endTime:null,exitStatus:null,personaConfig:structuredClone(fixture.resolvedConfig)};
    metadata.personaConfig.brainType='ANAM_GPT_4O_MINI_V1';
    metadata.personaConfig.llmConfig={id:binding.llmId,modelName:'qwen/qwen3.6-27b'};
    return {config,binding,expected,metadata};
}
const rag=c=>c.tools.find(t=>t.subtype==='rag');
test('known resolved document scope verifies without changing the session payload or source',()=>{
    const before=structuredClone(fixture),{config,binding,expected,metadata}=setup(),request=structuredClone(config);
    verifyCandidateRuntime(metadata,expected);
    assert.deepEqual(config,request);
    assert.deepEqual(fixture,before);
    assert.equal(config.tools,undefined);
    assert.deepEqual(config.toolIds,fixture.candidate.tools.filter(t=>t.name!=='end_call').map(t=>t._toolId));
    assert.ok(rag(binding).documentFolderIds);
    assert.equal(rag(binding).scopes,undefined);
});
test('original folder representation and consistent dual representation verify',()=>{
    const {binding,expected,metadata}=setup();
    metadata.personaConfig.tools=structuredClone(binding.tools);
    verifyCandidateRuntime(metadata,expected);
    rag(metadata.personaConfig).scopes=structuredClone(rag(fixture.resolvedConfig).scopes);
    verifyCandidateRuntime(metadata,expected);
});
test('document ordering is immaterial, while tool fields remain exact',()=>{
    const {expected,metadata}=setup();
    rag(metadata.personaConfig).scopes[0].documentIds.reverse();
    metadata.personaConfig.tools.reverse();
    verifyCandidateRuntime(metadata,expected);
});
test('provider-resolved false interruption setting is accepted for retained tools',()=>{
    const {expected,metadata}=setup();
    metadata.personaConfig.tools.forEach(t=>t.disableInterruptions=false);
    verifyCandidateRuntime(metadata,expected);
});
test('enabled or malformed interruption settings remain rejected',()=>{
    for(const value of [true,null,'false',0]){
        const {expected,metadata}=setup();
        metadata.personaConfig.tools[0].disableInterruptions=value;
        assert.throws(()=>verifyCandidateRuntime(metadata,expected),/tool mismatch/);
    }
});
const invalid=[
    ['missing document',t=>t.scopes[0].documentIds.pop()],
    ['extra document',t=>t.scopes[0].documentIds.push('unexpected')],
    ['substituted document',t=>t.scopes[0].documentIds[0]='unexpected'],
    ['duplicate document',t=>t.scopes[0].documentIds[0]=t.scopes[0].documentIds[1]],
    ['wrong namespace',t=>t.scopes[0].namespace='production'],
    ['extra scope',t=>t.scopes.push(structuredClone(t.scopes[0]))],
    ['empty scope',t=>t.scopes=[]],
    ['null scope',t=>t.scopes=[null]],
    ['malformed scopes',t=>t.scopes={}],
    ['wildcard scope property',t=>t.scopes[0].allDocuments=true],
    ['no folder or scope',t=>delete t.scopes],
    ['conflicting dual folder',t=>t.documentFolderIds=['production']],
    ['description drift',t=>t.description+=' changed'],
    ['schema drift',t=>t.parameters.required=[]],
    ['type drift',t=>t.type='client'],
    ['subtype drift',t=>t.subtype='webhook'],
    ['unapproved retrieval tuning',t=>t.topK=100],
];
for(const [label,mutate] of invalid)test('rejects '+label,()=>{
    const {expected,metadata}=setup();mutate(rag(metadata.personaConfig));
    assert.throws(()=>verifyCandidateRuntime(metadata,expected),/tool mismatch/);
});
test('unknown expected folder cannot borrow the pinned scope mapping',()=>{
    const {expected,metadata}=setup();rag(expected.runtimeBinding).documentFolderIds=['unknown'];
    assert.throws(()=>verifyCandidateRuntime(metadata,expected),/tool mismatch/);
});
test('duplicate names, extra native end-call and missing pause are rejected',()=>{
    for(const mutate of [
        c=>c.tools.push({type:'system',name:'end_call'}),
        c=>c.tools.pop(),
        c=>c.tools[1]=structuredClone(c.tools[0]),
        c=>c.tools[1].description+=' changed',
        c=>c.tools[1].scopes=structuredClone(c.tools[0].scopes),
    ]){
        const {expected,metadata}=setup();mutate(metadata.personaConfig);
        assert.throws(()=>verifyCandidateRuntime(metadata,expected),/tool/);
    }
});
test('prompt, model, speech, identity and launch-time checks remain enforced',()=>{
    for(const mutate of [
        m=>m.personaConfig.systemPrompt+=' ',
        m=>m.personaConfig.llmConfig.id='other',
        m=>delete m.personaConfig.llmConfig,
        m=>m.personaConfig.voiceDetectionOptions.endOfSpeechSensitivity=0.5,
        m=>m.personaConfig.ttsProviderVoiceId='other',
        m=>m.personaConfig.avatarEngineKey='other',
        m=>m.personaId=fixture.candidate.id,
        m=>m.clientLabel='wrong',
        m=>m.startTime='2000-01-01T00:00:00Z',
    ]){
        const {expected,metadata}=setup();mutate(metadata);
        assert.throws(()=>verifyCandidateRuntime(metadata,expected),/mismatch/);
    }
});
test('prompt baseline guard still rejects arbitrary fixture prompts',()=>{
    const source=structuredClone(fixture.candidate);source.brain.systemPrompt='Candidate prompt';
    assert.throws(()=>candidateRuntimeConfig(source),/baseline drift/);
});
test('candidate launch rejects missing or duplicate tool references',()=>{
    for(const mutate of [
        source=>delete source.tools[1]._toolId,
        source=>source.tools[2]._toolId=source.tools[1]._toolId,
    ]){
        const source=structuredClone(fixture.candidate);mutate(source);
        assert.throws(()=>candidateRuntimeConfig(source),/tool references missing or duplicated/);
    }
});
