import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seal,unseal,requireClosedSession,archiveClosed,history,load,commit} from '../lib/factory/store.ts';

test('only verified closed sessions may be archived',()=>{
    const s={status:'CLOSED',provider_release_verified:true,provider_transcript_verified:true};
    assert.doesNotThrow(()=>requireClosedSession(s));
    for(const bad of [null,{...s,status:'ACTIVE'},{...s,status:'CLOSING_PENDING'},
        {...s,provider_release_verified:false},{...s,provider_transcript_verified:false}])
        assert.throws(()=>requireClosedSession(bad));
});
test('encrypted archive preserves originals; CAS refuses stale resets and late writes',async()=>{
    const keys=['FACTORY_DELIVERY_SECRET','KV_REST_API_URL','KV_REST_API_TOKEN'];
    const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]])), originalFetch=globalThis.fetch;
    Object.assign(process.env,{FACTORY_DELIVERY_SECRET:'x'.repeat(64),KV_REST_API_URL:'https://synthetic.upstash.io',KV_REST_API_TOKEN:'synthetic'});
    const s={id:'old',status:'CLOSED',version:4,provider_release_verified:true,provider_transcript_verified:true,
        turns:[{content:'synthetic evidence'}],decisions:[{decision:'ACCEPT'}],approved:true};
    let raw=seal(s,process.env.FACTORY_DELIVERY_SECRET),saved=[],expiry=0;
    const old=raw;
    globalThis.fetch=async(_url,options)=>{
        const a=JSON.parse(options.body);let result;
        if(a[0]==='GET')result=raw;
        else if(a[0]==='LRANGE')result=saved;
        else if(a[0]==='EVAL'&&a[2]===2) {
            if(raw!==a[5])result=0;
            else if(saved.length>=20)result=-1;
            else {saved.unshift(raw);raw=a[6];expiry=a[7];result=1;}
        }else if(a[0]==='EVAL'&&a[2]===1){
            if(raw===a[4]||(!raw&&a[4]==='__NEW__')){raw=a[5];result=1;}else result=0;
        }else throw new Error('Unexpected operation');
        return new Response(JSON.stringify({result}));
    };
    try{
        await archiveClosed('a'.repeat(32),old,s);
        assert.equal(expiry,604800);assert.equal(saved[0],old);
        assert.deepEqual(await history('a'.repeat(32)),[s]);
        assert.equal((await load('a'.repeat(32))).state,null);
        await assert.rejects(archiveClosed('a'.repeat(32),old,s),/Session changed/);
        await assert.rejects(commit('a'.repeat(32),old,{...s,version:5}),/Concurrent/);
        const empty=await load('a'.repeat(32));
        await commit('a'.repeat(32),empty.raw,{id:'new',status:'RESERVED'});
        assert.equal((await load('a'.repeat(32))).state.id,'new');
        assert.deepEqual(unseal(saved[0],process.env.FACTORY_DELIVERY_SECRET),s);
        saved=Array(20).fill(old);raw=old;
        await assert.rejects(archiveClosed('a'.repeat(32),old,s),/limit reached/);
        assert.equal(raw,old);assert.equal(saved.length,20);
    }finally{globalThis.fetch=originalFetch;for(const k of keys){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}}
});
test('fresh action has exact session/version gate; UI discards SDK callbacks and never auto-launches',()=>{
    const server=readFileSync(new URL('../app/api/factory/pilot/route.ts',import.meta.url),'utf8');
    const block=server.split("if(b.action==='new_conversation')")[1].split("if(b.action==='start')")[0];
    assert.match(block,/b.version!==state.version/);assert.match(block,/b.session_id!==state.id/);
    assert.match(block,/archiveClosed/);assert.doesNotMatch(block,/provider\(/);
    const ui=readFileSync(new URL('../components/factory/FactoryPilot.tsx',import.meta.url),'utf8');
    const fresh=ui.split('async function freshConversation()')[1].split('function downloadSaved')[0];
    assert.match(fresh,/window.location.reload/);assert.doesNotMatch(fresh,/launch\(|createClient/);
    assert.match(ui,/Previous test sessions/);assert.match(ui,/Download saved session/);
});
