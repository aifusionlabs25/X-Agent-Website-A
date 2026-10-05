import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {emptyIntake} from '../lib/james-canary/state.ts';
import {completeVerifiedSession,seal,unseal} from '../lib/james-canary/server.ts';
import {recover} from '../lib/james-canary/prompt-candidate-server.ts';
import {candidateRuntimeConfig} from '../lib/james-canary/runtime-session.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/james-candidate-runtime.json',import.meta.url),'utf8'));
const candidateId='016e2c66-166b-43bd-8ebf-70b56c46575c';
const providerId='4056f1c6-bd11-4682-bcc8-fddcbc8fa22e';
const base=()=>({id:'11111111-2222-4333-8444-555555555555',browserId:'test',clientLabel:'test',
    createdAt:'2026-10-03T20:00:00Z',revision:0,stateHash:'test',personaId:candidateId,config:{},
    providerId,state:'ACTIVE',turns:[{id:'u1',role:'user',content:'I was in an accident.'}],intake:emptyIntake(),
    intakeBrief:{version:2},websiteClosing:{policy:'JAMES-CLOSE-001',runtimeOwned:true},receipts:[]});
const completed=()=>({status:'ready',metadata:{id:providerId,personaId:null,clientLabel:'test',
    startTime:'2026-10-03T20:00:00Z',endTime:'2026-10-03T20:01:00Z',exitStatus:'OK',
    personaConfig:fixture.resolvedConfig},turns:[{role:'user',content:'I was in an accident.'}]});

test('provider-ended reconciliation stamps the candidate once and preserves origin',()=>{
    const s=base();
    const closed=completeVerifiedSession(s,completed(),'PROVIDER_ENDED_RECOVERY');
    assert.equal(closed.state,'CLOSED');
    assert.equal(closed.websiteClosing.closeOrigin,'PROVIDER_ENDED_RECOVERY');
    assert.equal(closed.providerRelease.endTime,'2026-10-03T20:01:00Z');
    assert.strictEqual(completeVerifiedSession(closed,completed(),'PROVIDER_ENDED_RECOVERY'),closed);
    assert.equal(s.state,'ACTIVE');
    const begun=base();begun.websiteClosing.closeOrigin='CONTEXTUAL_ACK';begun.state='CLOSING';
    assert.equal(completeVerifiedSession(begun,completed(),'PROVIDER_ENDED_RECOVERY').websiteClosing.closeOrigin,'CONTEXTUAL_ACK');
});

test('reconciliation refuses active provider, missing end time, and transcript drift',()=>{
    assert.throws(()=>completeVerifiedSession(base(),{status:'pending'},'PROVIDER_ENDED_RECOVERY'),/release\/transcript/);
    const active=completed();active.metadata.endTime=null;active.metadata.exitStatus=null;
    assert.throws(()=>completeVerifiedSession(base(),active,'PROVIDER_ENDED_RECOVERY'),/release\/transcript/);
    const mismatch=completed();mismatch.turns[0].content='different visitor evidence';
    assert.throws(()=>completeVerifiedSession(base(),mismatch,'PROVIDER_ENDED_RECOVERY'),/does not match/);
    const strict=base();strict.runtimeBinding={};
    const noTime=completed();noTime.metadata.endTime=null;
    assert.throws(()=>completeVerifiedSession(strict,noTime,'PROVIDER_ENDED_RECOVERY'),/end time/);
});

test('candidate recovery endpoint requires a configured secret and rejects unauthenticated requests before I/O',async()=>{
    const oldSecret=process.env.CRON_SECRET;
    const oldFetch=globalThis.fetch;
    globalThis.fetch=async()=>{throw new Error('Unexpected remote I/O');};
    try{
        delete process.env.CRON_SECRET;
        assert.equal((await recover(new Request('https://example.invalid/recover'))).status,503);
        process.env.CRON_SECRET='test-only-recovery-secret-long-enough';
        assert.equal((await recover(new Request('https://example.invalid/recover'))).status,401);
    }finally{
        globalThis.fetch=oldFetch;
        if(oldSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=oldSecret;
    }
});

test('scheduled candidate recovery closes an ended session once using mocked provider and Redis',async()=>{
    const oldEnv={...process.env},oldFetch=globalThis.fetch;
    const prefix='xagent:james:prompt-candidate:v1:';
    const signingSecret='test-only-session-signing-secret'.repeat(3);
    const cronSecret='test-only-recovery-secret-long-enough';
    Object.assign(process.env,{AMY_ANAM_SESSION_SPINE_ENABLED:'true',AMY_ANAM_SESSION_SPINE_KILL_SWITCH:'false',
        AMY_ANAM_SESSION_SECRET:signingSecret,AMY_ANAM_REDIS_REST_URL:'https://redis.invalid',
        AMY_ANAM_REDIS_REST_TOKEN:'fake',ANAM_API_KEY:'fake',CRON_SECRET:cronSecret});
    const key=createHmac('sha256',signingSecret).update(prefix).digest('hex');
    const {binding}=candidateRuntimeConfig(structuredClone(fixture.candidate));
    const session={...base(),runtimeBinding:binding};
    const stored=new Map([[prefix+session.id,seal(session,key,prefix)]]);
    const index=new Set([session.id]);
    const config=structuredClone(fixture.resolvedConfig);
    config.llmConfig={id:binding.llmId,modelName:'qwen/qwen3.6-27b'};
    let ended=true,providerReads=0;
    globalThis.fetch=async(url,options={})=>{
        const target=String(url),cmd=options.body?JSON.parse(options.body):null;
        if(target==='https://redis.invalid'){
            if(cmd[0]==='ZRANGE')return Response.json({result:[...index]});
            if(cmd[0]==='GET')return Response.json({result:stored.get(cmd[1])??null});
            if(cmd[0]==='ZREM'){index.delete(cmd[2]);return Response.json({result:1});}
            if(cmd[0]==='ZADD'){assert.equal(cmd[1],prefix+'reconcile:index');assert.equal(cmd[3],session.id);return Response.json({result:0});}
            if(cmd[0]==='EVAL'){
                const sessionKey=cmd[3],indexKey=cmd[4],revision=cmd[5],encoded=cmd[6];
                assert.equal(indexKey,prefix+'reconcile:index');
                if(JSON.parse(stored.get(sessionKey)).revision!==revision)return Response.json({result:0});
                stored.set(sessionKey,encoded);
                if(cmd[8]==='remove')index.delete(cmd[10]);
                return Response.json({result:1});
            }
        }
        if(target===`https://api.anam.ai/v1/sessions/${providerId}`){
            providerReads++;
            return Response.json({id:providerId,personaId:null,clientLabel:session.clientLabel,
                startTime:session.createdAt,endTime:ended?'2026-10-03T20:01:00Z':null,
                exitStatus:ended?'OK':null,personaConfig:config});
        }
        if(target===`https://api.anam.ai/v1/sessions/${providerId}/transcript`)
            return Response.json({sessionId:providerId,transcriptsEnabled:true,totalMessages:1,
                endTime:'2026-10-03T20:01:00Z',messages:[{role:'user',message:'I was in an accident.'}]});
        throw new Error('Unexpected offline target '+target);
    };
    const request=()=>new Request('https://example.invalid/recover',{headers:{authorization:'Bearer '+cronSecret}});
    try{
        ended=false;
        const pending=await (await recover(request())).json();
        assert.equal(pending.pending,1);assert.equal(index.size,1);
        ended=true;
        const done=await (await recover(request())).json();
        assert.deepEqual(done,{selected:1,closed:1,pending:0,failed:0});
        const closed=unseal(stored.get(prefix+session.id),session.id,key,candidateId,prefix);
        assert.equal(closed.state,'CLOSED');
        assert.equal(closed.websiteClosing.closeOrigin,'PROVIDER_ENDED_RECOVERY');
        assert.equal(closed.providerRelease.endTime,'2026-10-03T20:01:00Z');
        assert.equal(index.size,0);
        assert.deepEqual(await (await recover(request())).json(),{selected:0,closed:0,pending:0,failed:0});
        assert.equal(providerReads,2,'only the pending and successful passes contact the mocked provider');
    }finally{
        globalThis.fetch=oldFetch;
        for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];
        Object.assign(process.env,oldEnv);
    }
});

test('bounded recovery rotates pending sessions so a later provider-ended session is not starved',async()=>{
    const oldEnv={...process.env},oldFetch=globalThis.fetch;
    const prefix='xagent:james:prompt-candidate:v1:';
    const signingSecret='test-only-session-signing-secret'.repeat(3);
    const cronSecret='test-only-recovery-secret-long-enough';
    Object.assign(process.env,{AMY_ANAM_SESSION_SPINE_ENABLED:'true',AMY_ANAM_SESSION_SPINE_KILL_SWITCH:'false',
        AMY_ANAM_SESSION_SECRET:signingSecret,AMY_ANAM_REDIS_REST_URL:'https://redis.invalid',
        AMY_ANAM_REDIS_REST_TOKEN:'fake',ANAM_API_KEY:'fake',CRON_SECRET:cronSecret});
    const key=createHmac('sha256',signingSecret).update(prefix).digest('hex');
    const {binding}=candidateRuntimeConfig(structuredClone(fixture.candidate));
    const config=structuredClone(fixture.resolvedConfig);
    config.llmConfig={id:binding.llmId,modelName:'qwen/qwen3.6-27b'};
    const sessions=Array.from({length:21},(_,i)=>({
        ...base(),id:`11111111-2222-4333-8444-${String(i+1).padStart(12,'0')}`,
        providerId:`22222222-3333-4444-8555-${String(i+1).padStart(12,'0')}`,
        runtimeBinding:binding,
    }));
    const byProvider=new Map(sessions.map(s=>[s.providerId,s]));
    const stored=new Map(sessions.map(s=>[prefix+s.id,seal(s,key,prefix)]));
    const scores=new Map(sessions.map((s,i)=>[s.id,i]));
    globalThis.fetch=async(url,options={})=>{
        const target=String(url),cmd=options.body?JSON.parse(options.body):null;
        if(target==='https://redis.invalid'){
            if(cmd[0]==='ZRANGE')return Response.json({result:[...scores].sort((a,b)=>a[1]-b[1]).slice(0,20).map(([id])=>id)});
            if(cmd[0]==='GET')return Response.json({result:stored.get(cmd[1])??null});
            if(cmd[0]==='ZADD'){scores.set(cmd[3],cmd[2]);return Response.json({result:0});}
            if(cmd[0]==='EVAL'){
                const sessionKey=cmd[3],revision=cmd[5],encoded=cmd[6];
                if(JSON.parse(stored.get(sessionKey)).revision!==revision)return Response.json({result:0});
                stored.set(sessionKey,encoded);
                if(cmd[8]==='remove')scores.delete(cmd[10]);
                return Response.json({result:1});
            }
        }
        const match=target.match(/^https:\/\/api\.anam\.ai\/v1\/sessions\/([^/]+)(\/transcript)?$/);
        if(match){
            const session=byProvider.get(match[1]);
            assert.ok(session);
            if(match[2])return Response.json({sessionId:session.providerId,transcriptsEnabled:true,totalMessages:1,
                endTime:'2026-10-03T20:01:00Z',messages:[{role:'user',message:'I was in an accident.'}]});
            const ended=session===sessions[20];
            return Response.json({id:session.providerId,personaId:null,clientLabel:session.clientLabel,
                startTime:session.createdAt,endTime:ended?'2026-10-03T20:01:00Z':null,
                exitStatus:ended?'OK':null,personaConfig:config});
        }
        throw new Error('Unexpected offline target '+target);
    };
    const request=()=>new Request('https://example.invalid/recover',{headers:{authorization:'Bearer '+cronSecret}});
    try{
        const first=await (await recover(request())).json();
        assert.deepEqual(first,{selected:20,closed:0,pending:20,failed:0});
        const second=await (await recover(request())).json();
        assert.equal(second.closed,1,'the later ended session enters the next bounded batch');
        const later=sessions[20];
        assert.equal(unseal(stored.get(prefix+later.id),later.id,key,candidateId,prefix).state,'CLOSED');
    }finally{
        globalThis.fetch=oldFetch;
        for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];
        Object.assign(process.env,oldEnv);
    }
});

test('public James recovery is scheduled while the legacy cron schedule remains intact',()=>{
    const schedule=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
    assert.deepEqual(schedule.crons.map(c=>c.path),[
        '/api/anam/session/recover?slot=a','/api/anam/session/recover?slot=b','/api/james-notepad/recover']);
    const route=readFileSync(new URL('../app/api/james-notepad/recover/route.ts',import.meta.url),'utf8');
    assert.match(route,/public-server/);
    const candidate=readFileSync(new URL('../lib/james-canary/prompt-candidate-server.ts',import.meta.url),'utf8');
    assert.match(candidate,/runtimeClose: true/);
    const publicServer=readFileSync(new URL('../lib/james-canary/public-server.ts',import.meta.url),'utf8');
    assert.match(publicServer,/runtimeClose: true/);
    const legacy=readFileSync(new URL('../lib/james-canary/demo-server.ts',import.meta.url),'utf8');
    assert.doesNotMatch(legacy,/runtimeClose: true/);
});
