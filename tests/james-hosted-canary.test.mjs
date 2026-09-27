import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyIntake,ingest,endIntent,readiness,brief,applyTurn,receipt,PERSONA_ID } from '../lib/james-canary/state.ts';
import {seal,unseal,verifyFinalEvidence,post,get} from '../lib/james-canary/server.ts';
const turn=(id,content,role='user')=>({id,content,role});
const base=()=>({id:'17e1b181-d4fa-42eb-8209-cad30ef97880',browserId:'browser',clientLabel:'label',createdAt:new Date().toISOString(),revision:0,stateHash:'initial',personaId:PERSONA_ID,config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),receipts:[]});
test('location correction retains event and timing with immutable provenance',()=>{
    const original=ingest(emptyIntake(),turn('1','I got into a fender bender this afternoon in Mesa.'));
    const next=ingest(original,turn('2','Actually, it was Tempe.'));
    assert.ok(next.facts.some(f=>f.value==='Tempe'));
    assert.ok(!next.facts.some(f=>f.value==='Mesa'));
    assert.ok(next.facts.some(f=>f.value.includes('fender bender')));
    assert.ok(next.facts.some(f=>f.value==='this afternoon'));
    assert.ok(next.history.some(f=>f.value==='Mesa'));
    assert.ok(original.facts.some(f=>f.value==='Mesa'));
});
test('email candidate requires exact contextual confirmation; no general fact duplication',()=>{
    let s=ingest(emptyIntake(),turn('1','My email is d dot reyes at mail dot com.'));
    assert.equal(s.emailCandidate.value,'d.reyes@mail.com');assert.equal(s.facts.length,0);
    assert.equal(ingest(s,turn('2','Yes.'),'Would you like a summary?').facts.length,0);
    s=ingest(s,turn('3','Yes.'),'I heard d.reyes@mail.com. Is that correct?');
    assert.equal(s.facts[0].field,'primary_email');assert.equal(s.facts[0].value,'d.reyes@mail.com');assert.equal(s.emailCandidate,undefined);
});

test('retained hosted phone answer after phone-or-email question ignores punctuation only',()=>{
    let s=ingest(emptyIntake(),turn('1',' Hi James, my name is Morgan Hale. I was in a minor car accident this morning in Mesa. The police gave me a report.'));
    const prior='I’ve noted your name, the accident, and that the police gave you a report. To keep this intake moving, could you let me know how you’d like us to reach you—by phone or email—and what you’re hoping to achieve from contacting us? ';
    s=ingest(s,turn('2',' Actually, it was Tempe. My phone number is 480-555-0136.'),prior);
    assert.equal(s.facts.find(f=>f.field==='primary_phone').value,'4805550136');
    assert.ok(s.facts.some(f=>f.value==='Tempe'));assert.ok(!s.facts.some(f=>f.value==='Mesa'));
    assert.ok(s.facts.some(f=>f.value.includes('minor car accident')));assert.ok(s.facts.some(f=>f.value==='this morning'));
    assert.ok(!s.emailCandidate);assert.ok(!s.facts.some(f=>f.field==='uncertainties'));
    const uncertain=ingest(s,turn('3','My email is unclear.'),prior);
    assert.ok(uncertain.facts.some(f=>f.field==='uncertainties'&&f.evidence==='My email is unclear.'));
});
test('first-class name/phone, legal questions, missing outcome never satisfied by handoff intent',()=>{
    let s=ingest(emptyIntake(),turn('1','My name is Dana Reyes. My phone number is 480-555-0136.'));
    s=ingest(s,turn('2','Should I call the insurer or talk to a lawyer first?'));
    s=ingest(s,turn('3','Yes, please prepare the information for the firm.'));
    assert.equal(s.facts.find(f=>f.field==='primary_phone').value,'4805550136');
    assert.equal(s.facts.find(f=>f.field==='client_questions').status,'DEFERRED_TO_FIRM');
    assert.equal(s.handoff,'HANDOFF_REQUESTED');assert.ok(readiness(s).missing.includes('Requested outcome'));
    assert.equal(s.facts.filter(f=>f.field==='material_facts').length,0);
});
test('brief omits filler, all supplied fields remain source-bound and no sent status',()=>{
    let s=ingest(emptyIntake(),turn('1','Okay. Sure. Go ahead. Thanks.'));
    assert.equal(s.facts.length,0);
    s=ingest(s,turn('2','I want help understanding the papers.'));
    assert.ok(brief(s).some(section=>section.title==='REQUESTED OUTCOME'));
    assert.match(JSON.stringify(brief(s)),/Not sent/);
});
test('end intent does not depend on assistant words; narrated goodbye does not close',()=>{
    assert.ok(endIntent('Thanks, James. Goodbye.'));assert.ok(!endIntent('My ex said goodbye yesterday.'));
    let s=applyTurn(base(),turn('1','Thanks, James. Goodbye.'));assert.equal(s.state,'CLOSING_PENDING');
    s=applyTurn(s,turn('2','Have a great day.','persona'));assert.equal(s.state,'CLOSING_PENDING');
    assert.throws(()=>applyTurn(s,turn('3','New facts')),/not accepting/);
});
test('idempotent finalized turns reject changed evidence and chain receipts',()=>{
    const initial=base(),next=applyTurn(initial,turn('1','I was served papers yesterday.'));
    const persisted=receipt(initial,next,{event:'turn'});
    assert.equal(persisted.revision,1);assert.equal(persisted.receipts[0].previousHash,'initial');
    assert.equal(applyTurn(persisted,turn('1','I was served papers yesterday.')),persisted);
    assert.throws(()=>applyTurn(persisted,turn('1','Changed')),/changed/);
});
test('encrypted storage round-trip and cross-session tamper rejection',()=>{
    const key='ab'.repeat(32), s=base(),box=seal(s,key);
    assert.deepEqual(unseal(box,s.id,key),s);assert.ok(!box.includes(s.clientLabel));
    assert.throws(()=>unseal(box,'other',key));assert.throws(()=>unseal(box,s.id,'cd'.repeat(32)));
});
test('provider transcript must match visitor and email-confirmation context',()=>{
    let s=applyTurn(base(),turn('a','What is your name?','persona'));s=applyTurn(s,turn('b','My name is Dana Reyes.'));
    verifyFinalEvidence(s,[{role:'agent',content:'What is your name?'},{role:'user',content:'My name is Dana Reyes.'}]);
    assert.throws(()=>verifyFinalEvidence(s,[{role:'user',content:'Different'}]));
    assert.throws(()=>verifyFinalEvidence(s,[{role:'agent',content:'Other question'},{role:'user',content:'My name is Dana Reyes.'}]));
});
test('isolated route, fixed persona, no outbound email, no unsupported provider stop',()=>{
    const server=readFileSync(new URL('../lib/james-canary/server.ts',import.meta.url),'utf8');
    const client=readFileSync(new URL('../components/james/JamesCanary.tsx',import.meta.url),'utf8');
    assert.ok(!server.includes('agentmail'));assert.ok(!server.includes('/stop'));
    assert.match(server,/personaConfig:\{personaId:PERSONA_ID\}/);assert.match(server,/verifyFinalEvidence\(current,completed.turns\)/);
    assert.match(client,/!stopped.current/);assert.match(client,/stopStreaming\(\)/);assert.match(client,/MESSAGE_HISTORY_UPDATED/);
});
test('hosted lifecycle uses existing store, binds persona, persists/reloads and never sends mail',async()=>{
    const previousEnv={...process.env},previousFetch=globalThis.fetch;
    Object.assign(process.env,{AMY_ANAM_SESSION_SPINE_ENABLED:'true',AMY_ANAM_SESSION_SPINE_KILL_SWITCH:'false',
        AMY_ANAM_SESSION_SECRET:'test-only-secret-not-real'.repeat(3),AMY_ANAM_REDIS_REST_URL:'https://redis.invalid',AMY_ANAM_REDIS_REST_TOKEN:'fake',ANAM_API_KEY:'fake'});
    const db=new Map(),calls=[];let label='',released=false;
    const providerId='e5254022-51d0-423e-9870-bb1a1fa117ad',providerTurns=[];
    globalThis.fetch=async(url,options={})=>{
        calls.push(String(url)); const data=options.body?JSON.parse(options.body):null;
        if(String(url).includes('redis.invalid/pipeline'))return Response.json([{result:[1,600]}]);
        if(String(url)==='https://redis.invalid'){
            if(data[0]==='GET')return Response.json({result:db.get(data[1])||null});
            const [,script,,key,rev,box]=data;assert.match(script,/cjson.decode/);
            if((rev===-1&&db.has(key))||(rev!==-1&&(!db.has(key)||JSON.parse(db.get(key)).revision!==rev)))return Response.json({result:0});
            db.set(key,box);return Response.json({result:1});
        }
        if(String(url).endsWith('/personas/'+PERSONA_ID))return Response.json({id:PERSONA_ID,brain:{systemPrompt:'Published prompt'},voice:{id:'owner-voice',displayName:'Owner voice'}});
        if(String(url).endsWith('/auth/session-token')){label=data.clientLabel;assert.deepEqual(data.personaConfig,{personaId:PERSONA_ID});return Response.json({sessionToken:'fake-token'});}
        if(String(url).endsWith('/transcript'))return Response.json({sessionId:providerId,transcriptsEnabled:true,totalMessages:providerTurns.length,messages:providerTurns,endTime:new Date().toISOString()});
        if(String(url).endsWith('/sessions/'+providerId))return Response.json({id:providerId,personaId:PERSONA_ID,clientLabel:label,startTime:new Date().toISOString(),endTime:released?new Date().toISOString():null});
        throw new Error('Unexpected network target '+url);
    };
    try {
        const request=(body,cookie='')=>new Request('https://demo.invalid/api/james-canary',{method:'POST',headers:{origin:'https://demo.invalid','Content-Type':'application/json',cookie},body:JSON.stringify(body)});
        const launched=await post(request({action:'start'})),cookie=launched.headers.get('set-cookie').split(';')[0],start=await launched.json();
        assert.equal(launched.status,200);assert.equal(start.config.voiceName,'Owner voice');
        const action=async(action,extra={})=>{const r=await post(request({action,id:start.id,...extra},cookie));const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;};
        await action('bind',{providerId});
        const contents=['I got into a fender bender this afternoon in Mesa.','Actually, it was Tempe.','My name is Dana Reyes. My phone number is 480-555-0136.','Should I call the insurer first?','I want help understanding my options.','Please prepare the summary for the firm.','Thanks, James. Goodbye.'];
        for(const [i,content] of contents.entries()) {await action('turn',{turn:turn(String(i),content),finalized:true});providerTurns.push({role:'user',message:content});}
        await action('turn',{turn:turn('farewell','Have a great day.','persona'),finalized:true});providerTurns.push({role:'persona',message:'Have a great day.'});
        const before=await action('tool',{operation:'SEND'});assert.equal(before.status,'EMAIL_UNAVAILABLE');assert.equal(before.sent,false);
        await action('begin-close');released=true;const closed=await action('close');assert.equal(closed.state,'CLOSED');assert.equal(closed.handoff,'PREPARED');
        const read=await get(new Request('https://demo.invalid/api/james-canary?id='+start.id,{headers:{cookie}}));assert.deepEqual(await read.json(),closed);
        const unauthorized=await get(new Request('https://demo.invalid/api/james-canary?id='+start.id));assert.equal(unauthorized.status,400);
        assert.ok(calls.every(url=>url.startsWith('https://redis.invalid')||url.startsWith('https://api.anam.ai/v1/')));
        assert.ok(![...db.values()].some(v=>v.includes('Dana')));
    } finally {globalThis.fetch=previousFetch;for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];Object.assign(process.env,previousEnv);}
});
