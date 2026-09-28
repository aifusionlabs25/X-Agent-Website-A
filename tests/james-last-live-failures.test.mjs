import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyIntake,ingest,applyTurn,receipt,readiness,conversationGuidance,brief,spokenPhone,PERSONA_ID} from '../lib/james-canary/state.ts';
import {signOwnerGrant,verifyOwnerGrant,sendPreparedOwnerTest,OWNER_RECIPIENT} from '../lib/james-canary/owner-email.ts';
import {post,get} from '../lib/james-canary/server.ts';
const base=()=>({id:'17e1b181-d4fa-42eb-8209-cad30ef97880',browserId:'browser',clientLabel:'test',createdAt:new Date().toISOString(),revision:0,stateHash:'initial',personaId:PERSONA_ID,config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),receipts:[]});
const add=(s,text,role='user')=>applyTurn(s,{id:String(s.turns.length),role,content:text});
function complete(){
    let s=add(base(),'A contractor left my kitchen torn apart. I paid a $4,000 deposit. I want my $4,000 back.');
    s=add(s,'The payment was on August 3rd. He is not answering my calls. I have a text message agreement and bank transfer receipt. My kitchen is unusable.');
    s=add(s,'- Oh yeah, my name is Maya Patel. My phone number is 480-555-0177.');
    return s;
}
test('retained contact error: extracted facts survive filler residue with exact provenance',()=>{
    const text=' - Oh yeah, my name is Maya Patel. My phone number is 480-555-0177.';
    const s=add(base(),text);
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').value,'Maya Patel');
    assert.equal(s.intake.facts.find(f=>f.field==='primary_phone').value,'4805550177');
    assert.ok(s.intake.facts.every(f=>text.includes(f.evidence)));
    assert.equal(s.intake.facts.filter(f=>f.field==='material_facts').length,0);
    const compound=add(base(),'An issue before my name is Maya Patel, and a concern after.');
    assert.ok(compound.intake.facts.every(f=>compound.turns[0].content.includes(f.evidence)));
    assert.ok(compound.intake.facts.some(f=>f.field==='uncertainties'));
});
test('refund outcome alternatives resolve semantic intent without another refund-vs-completion question',()=>{
    for(const text of ["I want my $4,000 back.","Sorry, yeah, ideally I'd like my money back.",'getting my four thousand dollars back that is the main thing']){
        const s=add(base(),text),g=conversationGuidance(s);
        assert.ok(s.intake.facts.some(f=>f.field==='requested_outcome'));
        assert.ok(g.completed_intents_do_not_reask.includes('requested_outcome'));
        assert.notEqual(g.next_question_intent,'requested_outcome');
    }
});
test('contractor depth, explicit urgency, dates and amount stay visitor reported; scope unverified',()=>{
    const s=complete(),r=readiness(s.intake),g=conversationGuidance(s);
    assert.equal(r.ready,true);assert.match(r.practiceScope,/UNVERIFIED/);
    assert.ok(s.intake.facts.some(f=>f.field==='client_reported_urgency'&&f.value==='My kitchen is unusable'));
    assert.ok(s.intake.facts.some(f=>f.field==='relevant_dates_events'&&f.value==='August 3rd'));
    assert.ok(g.known_evidence_do_not_reask.some(f=>f.value.includes('$4,000')));
    assert.ok(g.completed_intents_do_not_reask.includes('agreement_payment'));
    assert.equal(readiness(add(base(),'A contractor took a deposit.').intake).ready,false);
});
test('unanswered email stays OPEN; one question cannot simultaneously permit closing',()=>{
    let s=complete(),g=conversationGuidance(s);
    assert.equal(g.next_question_intent,'primary_email');assert.equal(g.completion_language_allowed,false);
    s=add(s,g.next_question,'persona');s=add(s,'My kitchen is unusable.');g=conversationGuidance(s);
    assert.equal(g.next_question_intent,'email_still_open');assert.equal(g.completion_language_allowed,false);
    assert.match(JSON.stringify(brief(s.intake)),/Primary email — not answered/);
    s=add(s,'I decline email.');assert.equal(conversationGuidance(s).completion_language_allowed,true);
});
test('contextual yes please records handoff; arbitrary yes and callback timing do not',()=>{
    const s=complete();
    assert.equal(add(s,'Yes, please.').intake.handoff,'NOT_REQUESTED');
    const offered=add(s,"If you’d like, we can prepare a brief summary for the firm after we finish.",'persona');
    assert.equal(add(offered,' Yes, please.').intake.handoff,'HANDOFF_REQUESTED');
    assert.equal(add(s,'Will someone call me today?').intake.handoff,'NOT_REQUESTED');
});
test('contact no longer prevents subsequent handoff and farewell, canonical phone survives',()=>{
    let s=complete();s=add(s,'Please prepare the summary for the firm.');s=add(s,'Bye.');
    assert.equal(s.state,'CLOSING_PENDING');s=add(s,'Goodbye. Take care.','persona');
    assert.equal(s.intake.handoff,'HANDOFF_REQUESTED');
    assert.equal(spokenPhone(s.intake.facts.find(f=>f.field==='primary_phone').value),'four eight zero, five five five, zero one seven seven');
    assert.throws(()=>add(s,'Late visitor information'),/not accepting/);
});
test('one-use owner capability is signed, expiring and fixed recipient; browser mode is insufficient',()=>{
    const key='fake-secret-long-enough',g={id:'17e1b181-d4fa-42eb-8209-cad30ef97880',expiresAt:Date.now()+60000,recipient:OWNER_RECIPIENT,maxSends:1};
    assert.deepEqual(verifyOwnerGrant(signOwnerGrant(g,key),key),g);
    assert.throws(()=>verifyOwnerGrant('owner',key));
    assert.throws(()=>verifyOwnerGrant(signOwnerGrant({...g,recipient:'elsewhere@example.com'},key),key));
    assert.throws(()=>verifyOwnerGrant(signOwnerGrant(g,key),key,g.expiresAt+1));
    assert.throws(()=>verifyOwnerGrant(signOwnerGrant(g,key),'another-secret-long-enough'));
});
test('email reserves before single send; verified receipt required; reload/failure never retries',async()=>{
    const previous={...process.env};Object.assign(process.env,{AGENTMAIL_API_KEY:'fake-key-long-enough',AMY_AGENTMAIL_ADDRESS:'test@agentmail.to'});
    try{
        for(const fail of [false,true]){
            const s=complete();Object.assign(s,{state:'CLOSED',providerRelease:{transcriptHash:'verified'},ownerTest:{grantId:'authorized',expiresAt:Date.now()+60000}});s.intake.handoff='PREPARED';
            let stored=s,calls=0;
            const deps={stamp:receipt,save:async(prev,next)=>{assert.equal(stored.revision,prev.revision);stored=structuredClone(next);},send:async(message)=>{
                calls++;assert.equal(stored.email.status,'RESERVED');assert.equal(message.to,OWNER_RECIPIENT);assert.match(message.text,/OWNER TEST ONLY/);
                if(fail)throw Error('timeout');return {sent:true,provider:'agentmail',messageId:'receipt-1',threadId:null};
            }};
            const result=await sendPreparedOwnerTest(s,deps);assert.equal(calls,1);assert.equal(result.email.status,fail?'FAILED_OR_UNKNOWN':'SENT');
            await sendPreparedOwnerTest(JSON.parse(JSON.stringify(stored)),deps);assert.equal(calls,1);
            assert.ok(result.email.snapshotHash);assert.ok(result.email.bodyHash);
            const noGrant={...s,ownerTest:undefined};assert.equal(await sendPreparedOwnerTest(noGrant,deps),noGrant);assert.equal(calls,1);
            await assert.rejects(sendPreparedOwnerTest({...s,state:'ACTIVE'},deps),/Verified closed/);
        }
    }finally{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
test('owner HTTP lifecycle consumes grant once and sends only after verified close; reload is read-only',async()=>{
    const env={...process.env},fetch=globalThis.fetch;
    Object.assign(process.env,{AMY_ANAM_SESSION_SPINE_ENABLED:'true',AMY_ANAM_SESSION_SPINE_KILL_SWITCH:'false',AMY_ANAM_SESSION_SECRET:'mock-secret-long-enough'.repeat(3),AMY_ANAM_REDIS_REST_URL:'https://redis.invalid',AMY_ANAM_REDIS_REST_TOKEN:'fake',ANAM_API_KEY:'fake-anam-key-long-enough',AGENTMAIL_API_KEY:'fake-agentmail-key-long-enough',AMY_AGENTMAIL_ADDRESS:'test@agentmail.to'});
    const db=new Map(),providerId='e5254022-51d0-423e-9870-bb1a1fa117ad',messages=[];let label='',released=false,sends=0,launches=0;
    globalThis.fetch=async(url,options={})=>{
        const u=String(url),data=options.body?JSON.parse(options.body):null;
        if(u.includes('redis.invalid/pipeline'))return Response.json([{result:[1,600]}]);
        if(u==='https://redis.invalid'){
            if(data[0]==='GET')return Response.json({result:db.get(data[1])||null});
            if(data[0]==='SET'){if(db.has(data[1]))return Response.json({result:null});db.set(data[1],data[2]);return Response.json({result:'OK'});}
            const [,script,,key,rev,box]=data;assert.match(script,/cjson.decode/);
            if((rev===-1&&db.has(key))||(rev!==-1&&(!db.has(key)||JSON.parse(db.get(key)).revision!==rev)))return Response.json({result:0});
            db.set(key,box);return Response.json({result:1});
        }
        if(u.endsWith('/personas/'+PERSONA_ID))return Response.json({id:PERSONA_ID,brain:{systemPrompt:'Unchanged published prompt'},voice:{id:'owner-voice',displayName:'Owner voice'}});
        if(u.endsWith('/auth/session-token')){launches++;label=data.clientLabel;return Response.json({sessionToken:'mock'});}
        if(u.endsWith('/transcript'))return Response.json({sessionId:providerId,transcriptsEnabled:true,totalMessages:messages.length,messages,endTime:new Date().toISOString()});
        if(u.endsWith('/sessions/'+providerId))return Response.json({id:providerId,personaId:PERSONA_ID,clientLabel:label,startTime:new Date().toISOString(),endTime:released?new Date().toISOString():null});
        if(u.startsWith('https://api.agentmail.to/')){assert.ok(released);assert.deepEqual(data.to,[OWNER_RECIPIENT]);sends++;return Response.json({message_id:'verified-receipt'});}
        throw Error('Unexpected target '+u);
    };
    try{
        const token=signOwnerGrant({id:'17e1b181-d4fa-42eb-8209-cad30ef97880',expiresAt:Date.now()+60000,recipient:OWNER_RECIPIENT,maxSends:1},process.env.ANAM_API_KEY);
        const request=(body,cookie='',grant=token)=>new Request('https://demo.invalid/api/james-canary',{method:'POST',headers:{origin:'https://demo.invalid','Content-Type':'application/json',cookie,'x-james-owner-test':grant},body:JSON.stringify(body)});
        assert.equal((await post(request({action:'owner-test-preflight'}))).status,200);assert.equal(launches,0);
        const r=await post(request({action:'start'})),cookie=r.headers.get('set-cookie').split(';')[0],started=await r.json();assert.equal(r.status,200);
        assert.equal((await post(request({action:'start'},cookie))).status,400);assert.equal(launches,1);
        const action=async(action,extra={})=>{const response=await post(request({action,id:started.id,...extra},cookie));const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
        await action('bind',{providerId});
        const turns=[...complete().turns,{id:'email',role:'user',content:'I decline email.'},{id:'request',role:'user',content:'Please prepare the summary for the firm.'},{id:'bye',role:'user',content:'Thanks, James. Goodbye.'},{id:'farewell',role:'persona',content:'Have a great day.'}];
        for(const turn of turns){await action('turn',{turn,finalized:true});messages.push({role:turn.role,message:turn.content});}
        assert.equal(sends,0);await action('begin-close');assert.equal(sends,0);released=true;
        const closed=await action('close');assert.equal(closed.state,'CLOSED');assert.equal(closed.handoff,'PREPARED');assert.equal(closed.email_status,'SENT');assert.equal(closed.email_receipt,'verified-receipt');assert.equal(sends,1);
        assert.deepEqual(await action('close'),closed);assert.equal(sends,1);
        assert.deepEqual(await (await get(new Request('https://demo.invalid/api/james-canary?id='+started.id,{headers:{cookie}}))).json(),closed);assert.equal(sends,1);
    }finally{globalThis.fetch=fetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
