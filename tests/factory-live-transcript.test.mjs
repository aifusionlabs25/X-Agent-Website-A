import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {liveTranscript} from '../lib/factory/live-transcript.ts';
const require=createRequire(import.meta.url);
const sdkRoot=new URL('../node_modules/@anam-ai/js-sdk/dist/main/',import.meta.url);
const {MessageHistoryClient}=require(fileURLToPath(new URL('modules/MessageHistoryClient.js',sdkRoot)));
const {PublicEventEmitter}=require(fileURLToPath(new URL('modules/PublicEventEmitter.js',sdkRoot)));
const {InternalEventEmitter}=require(fileURLToPath(new URL('modules/InternalEventEmitter.js',sdkRoot)));

test('installed SDK replay: old whitelist loses visitor, new adapter retains visitor and complete assembled reply',()=>{
    const pub=new PublicEventEmitter(), sdk=new MessageHistoryClient(pub,new InternalEventEmitter());
    const oldComplete=new Set(),old=[],now=[],adapter=liveTranscript();
    pub.addListener('MESSAGE_STREAM_EVENT_RECEIVED',e=>{if(e.endOfSpeech)oldComplete.add(e.id);now.push(...adapter.stream(e));});
    pub.addListener('MESSAGE_HISTORY_UPDATED',h=>{old.push(...h.filter(m=>oldComplete.has(m.id)));now.push(...adapter.history(h));});
    const event=(role,id,content,end)=>sdk.processWebRtcTextMessageEvent({role,message_id:id,content,end_of_speech:end,interrupted:false});
    event('user','1','I run a small design studio.',false);
    assert.equal(now.length,1);assert.equal(old.length,0);
    event('persona','2','We can discuss ',false);
    assert.equal(adapter.drafts()[0].content,'We can discuss ');assert.equal(now.length,1);
    event('persona','2','a bounded workflow.',true);
    assert.equal(old.some(m=>m.role==='user'),false);
    assert.deepEqual(now.map(m=>m.content),['I run a small design studio.','We can discuss a bounded workflow.']);
    assert.deepEqual(adapter.drafts(),[]);
});
test('unfinalized persona is visible but never emitted as authoritative evidence',()=>{
    const a=liveTranscript();assert.deepEqual(a.stream({id:'p',role:'persona',content:'Partial reply',endOfSpeech:false}),[]);
    assert.equal(a.drafts()[0].content,'Partial reply');assert.equal(a.trace()[0].end,false);
    assert.deepEqual(a.history([{id:'p',role:'persona',content:'Partial reply'}]),[]);
});
test('duplicates do not duplicate turns, changed finalized evidence fails closed',()=>{
    const a=liveTranscript(),u={id:'u',role:'user',content:'Do not contact anyone.',endOfSpeech:false};
    assert.equal(a.stream(u).length,1);assert.deepEqual(a.stream(u),[]);
    assert.deepEqual(a.history([u]),[]);assert.throws(()=>a.history([{...u,content:'Contact everyone.'}]),/changed/);
});
test('empty terminal fragment uses assembled SDK history, never last fragment',()=>{
    const a=liveTranscript();a.stream({id:'p',role:'persona',content:'Complete assembled response.',endOfSpeech:false});
    a.stream({id:'p',role:'persona',content:'',endOfSpeech:true});
    assert.equal(a.history([{id:'p',role:'persona',content:'Complete assembled response.'}])[0].content,'Complete assembled response.');
});
test('trace is bounded and contains no transcript content',()=>{
    const a=liveTranscript();for(let i=0;i<250;i++)a.stream({id:'p',role:'persona',content:'x',endOfSpeech:false});
    assert.equal(a.trace().length,200);assert.equal(a.trace().some(t=>'content' in t),false);
});
test('page uses adapter, live drafts and single SDK close; no persona configuration edits',()=>{
    const s=readFileSync(new URL('../components/factory/FactoryPilot.tsx',import.meta.url),'utf8');
    assert.ok(!s.includes('completed.has'));assert.match(s,/transcript.history\(messages\)/);assert.match(s,/transcript.stream\(e\)/);
    assert.match(s,/live, not yet finalized/);assert.match(s,/if\(stopping.current\|\|!client.current\)return/);
});
