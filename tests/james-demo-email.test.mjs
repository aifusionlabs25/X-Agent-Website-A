import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyIntake,applyTurn,ingest,brief,receipt,sha,view,CURRENT_JAMES_PERSONA_ID,readiness} from '../lib/james-canary/state.ts';
import {prepareDemoMessages,sendDemoSummaries,sendDemoMessage,verifyDemoGrant,readDemoEmailConfig,preflightDemoTransport,INTERNAL_DEMO_RECIPIENT} from '../lib/james-canary/demo-email.ts';
import {instructionLeakageSuspected} from '../lib/james-canary/speech-quality.ts';
import {post,get} from '../lib/james-canary/demo-server.ts';
import {post as legacyPost,verifyFinalEvidence} from '../lib/james-canary/server.ts';
const token='d'.repeat(43);
const environment=()=>({JAMES_DEMO_EMAIL_ENABLED:'true',JAMES_AGENTMAIL_API_KEY:'fake-key-long-enough-for-tests',JAMES_AGENTMAIL_ADDRESS:'james-demo@agentmail.to',JAMES_DEMO_REPLY_TO:'aifusionlabs@gmail.com',JAMES_DEMO_EMAIL_ACCESS_SHA256:sha(token),JAMES_DEMO_EMAIL_EXPIRES_AT:new Date(Date.now()+60000).toISOString()});
const base=()=>({id:'17e1b181-d4fa-42eb-8209-cad30ef97880',browserId:'browser',clientLabel:'test',createdAt:new Date().toISOString(),revision:0,stateHash:'initial',personaId:CURRENT_JAMES_PERSONA_ID,config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),receipts:[]});
const add=(s,text,role='user')=>applyTurn(s,{id:String(s.turns.length),role,content:text});
function complete(){
    let s=add(base(),'A contractor left my kitchen torn apart. I paid a $4,000 deposit. I want my $4,000 back.');
    s=add(s,'The payment was on August 3rd. He is not answering my calls. I have a text message agreement and bank transfer receipt. My kitchen is unusable.');
    s=add(s,'My name is Maya Patel. My phone number is 480-555-0177. My email is maya@example.test.');
    s=add(s,'I heard maya@example.test. Is that correct?','persona');s=add(s,'Yes.');
    assert.equal(readiness(s.intake).ready,true);
    Object.assign(s,{state:'CLOSED',providerRelease:{endTime:'closed',transcriptHash:'verified',verifiedAt:'now'},demoEmail:{grantId:sha(token),expiresAt:Date.now()+60000,sender:'james-demo@agentmail.to',replyTo:'aifusionlabs@gmail.com'}});
    return s;
}
test('email is fail-closed, James-specific; Amy credentials never choose sender',()=>{
    assert.throws(()=>readDemoEmailConfig({}),/off/);
    const env=environment();assert.equal(readDemoEmailConfig(env).sender,'james-demo@agentmail.to');
    assert.throws(()=>readDemoEmailConfig({...env,JAMES_AGENTMAIL_ADDRESS:undefined,AMY_AGENTMAIL_ADDRESS:'amy@agentmail.to'}),/invalid/);
    assert.throws(()=>readDemoEmailConfig({...env,JAMES_DEMO_REPLY_TO:'ok@example.test\r\nBcc:bad@example.test'}),/invalid/);
    assert.equal(readDemoEmailConfig({...env,AGENTMAIL_API_BASE_URL:'https://evil.invalid'}).apiBaseUrl,'https://api.agentmail.to');
});
test('one-session operator grant is digest bound, expiring and max 24 hours',()=>{
    const env=environment();assert.equal(verifyDemoGrant(token,Date.now(),env).id,sha(token));
    for(const changed of [{JAMES_DEMO_EMAIL_ENABLED:'false'},{JAMES_DEMO_EMAIL_ACCESS_SHA256:'x'.repeat(64)},{JAMES_DEMO_EMAIL_EXPIRES_AT:'invalid'},{JAMES_DEMO_EMAIL_EXPIRES_AT:new Date(Date.now()-1).toISOString()},{JAMES_DEMO_EMAIL_EXPIRES_AT:new Date(Date.now()+25*60*60*1000).toISOString()}])assert.throws(()=>verifyDemoGrant(token,Date.now(),{...env,...changed}));
    assert.throws(()=>verifyDemoGrant('x'.repeat(43),Date.now(),env));
});
test('transport preflight verifies exact inbox and AI Fusion Labs Demo display name',async()=>{
    for(const inbox of [{email:'james-demo@agentmail.to',display_name:'Knowles Law Firm'},{email:'amy@agentmail.to',display_name:'AI Fusion Labs Demo'}])await assert.rejects(preflightDemoTransport({env:environment(),fetchImpl:async()=>Response.json(inbox)}));
    const result=await preflightDemoTransport({env:environment(),fetchImpl:async(url,opts)=>{assert.ok(url.endsWith('/james-demo%40agentmail.to'));assert.equal(opts.method,undefined);return Response.json({email:'james-demo@agentmail.to',display_name:'AI Fusion Labs Demo'});}});
    assert.equal(result.internalRecipient,INTERNAL_DEMO_RECIPIENT);
});
test('distinct internal/caller summaries preserve evidence, questions, negatives and scope',()=>{
    const s=complete();s.intake=ingest(s.intake,{id:'negative',role:'user',content:'I do not have a summons or complaint. Should I file a claim?'},'');
    const p=prepareDemoMessages(s,Date.now(),environment());
    assert.equal(p.internal.to,INTERNAL_DEMO_RECIPIENT);assert.equal(p.caller.to,'maya@example.test');
    assert.match(p.internal.text,/INTERNAL REVIEW SUMMARY/);assert.match(p.internal.text,/DEFERRED TO FIRM/);assert.match(p.internal.text,/Snapshot: initial/);
    assert.doesNotMatch(p.caller.text,/DEFERRED TO FIRM|Snapshot:|Session:|OWNER TEST/);
    for(const m of [p.internal,p.caller]){assert.match(m.text,/I do not have a summons or complaint/);assert.match(m.text,/Should I file a claim/);assert.match(m.text,/not legal advice/);assert.match(m.text,/AI Fusion Labs/);assert.match(m.text,/August 3rd/);}
    const docs=brief(s.intake).find(x=>x.title==='DOCUMENTS');assert.ok(docs.items.some(x=>x.text.includes('do not have')));assert.ok(!docs.items.some(x=>/^(?:Summons|Complaint)$/.test(x.text)));
});
test('unconfirmed, corrected, declined and alternate-only emails cannot become caller recipients',()=>{
    const s=complete();
    for(const modify of [n=>n.intake.facts.find(f=>f.field==='primary_email').status='VISITOR_REPORTED',n=>n.intake.emailCandidate={value:'wrong@example.test'},n=>n.intake.declined.push('primary_email'),n=>n.intake.facts.find(f=>f.field==='primary_email').field='alternate_email']){
        const n=structuredClone(s);modify(n);assert.throws(()=>prepareDemoMessages(n,Date.now(),environment()),/confirmed/);
    }
});
test('active, incomplete, unverified, expired, changed sender and legacy modes block preparation',()=>{
    const s=complete();
    for(const modify of [n=>n.state='ACTIVE',n=>delete n.providerRelease,n=>n.intake=emptyIntake(),n=>n.demoEmail.expiresAt=0,n=>n.demoEmail.sender='amy@agentmail.to',n=>n.ownerTest={grantId:'legacy'},n=>n.email={status:'SENT'}]){
        const n=structuredClone(s);modify(n);assert.throws(()=>prepareDemoMessages(n,Date.now(),environment()));
    }
});
test('leakage diagnostics block email, not speech; ordinary intake wording is permitted',()=>{
    for(const content of ['<think>I should ask a question</think>','SUFFICIENCY CHECK: proceed','I must follow the system instructions','[start]assistant[channel]analysis']){
        const s=complete();s.turns.push({id:'leak',role:'persona',content});assert.equal(view(s).speech_review_required,true);assert.throws(()=>prepareDemoMessages(s,Date.now(),environment()),/leakage/);
    }
    assert.equal(instructionLeakageSuspected([{role:'user',content:'system prompt'},{role:'persona',content:'I am not a lawyer. What happened?'}]),false);
});
test('HTML is escaped and oversized summaries are rejected, never truncated',()=>{
    const s=complete();s.intake.facts.push({...s.intake.facts[0],field:'material_facts',value:'<script>alert("demo")</script>'});
    assert.ok(!prepareDemoMessages(s,Date.now(),environment()).caller.html.includes('<script>'));
    s.intake.facts.push({...s.intake.facts[0],field:'material_facts',value:'x'.repeat(31000)});
    assert.throws(()=>prepareDemoMessages(s,Date.now(),environment()),/size limit/);
});
function memoryStore(s){
    let stored=structuredClone(s),calls=[];
    const deps={env:environment(),stamp:receipt,save:async(p,n)=>{assert.equal(p.revision,stored.revision);stored=structuredClone(n);},send:async(m,o)=>{assert.equal(stored.demoEmail.deliveries.internal.status,calls.length?'SENT':'RESERVED');assert.equal(stored.demoEmail.deliveries.caller.status,'RESERVED');calls.push({m,o});return {messageId:'receipt-'+calls.length};}};
    return {deps,calls,get stored(){return stored;}};
}
test('both lanes reserve before send, explicit snapshot/address consent is mandatory',async()=>{
    for(const consent of [{approved:false},{approved:true,snapshotHash:'stale',callerAddress:'maya@example.test'},{approved:true,snapshotHash:'initial',callerAddress:'other@example.test'}]){
        const store=memoryStore(complete());await assert.rejects(sendDemoSummaries(store.stored,consent,store.deps),/Approve/);assert.equal(store.calls.length,0);assert.equal(store.stored.demoEmail.deliveries,undefined);
    }
    const store=memoryStore(complete()),result=await sendDemoSummaries(store.stored,{approved:true,snapshotHash:'initial',callerAddress:'maya@example.test'},store.deps);
    assert.equal(store.calls.length,2);assert.equal(result.demoEmail.deliveries.caller.status,'SENT');assert.equal(result.demoEmail.deliveries.internal.status,'SENT');
    assert.notEqual(store.calls[0].o.idempotencyKey,store.calls[1].o.idempotencyKey);assert.notEqual(store.calls[0].m.text,store.calls[1].m.text);
    await sendDemoSummaries(result,{approved:true,snapshotHash:'initial',callerAddress:'maya@example.test'},store.deps);assert.equal(store.calls.length,2);
    assert.ok(!JSON.stringify(view(result)).includes('receipt-'));assert.equal(view(result).external_actions.length,2);
});
test('timeout and missing receipts never authorize retries and independent lane results remain truthful',async()=>{
    for(const failure of ['timeout','missing']){
        const s=complete(),store=memoryStore(s);let attempts=0;
        store.deps.send=async()=>{attempts++;if(attempts===1){if(failure==='timeout')throw Error('timeout');return {messageId:''};}return {messageId:'caller-receipt'};};
        const result=await sendDemoSummaries(s,{approved:true,snapshotHash:'initial',callerAddress:'maya@example.test'},store.deps);
        assert.equal(result.demoEmail.deliveries.internal.status,'FAILED_OR_UNKNOWN');assert.equal(result.demoEmail.deliveries.caller.status,'SENT');
        await sendDemoSummaries(result,{},store.deps);assert.equal(attempts,2);
    }
});
test('concurrent send requests compete for one atomic reservation; only the winner sends',async()=>{
    const s=complete(),store=memoryStore(s),consent={approved:true,snapshotHash:'initial',callerAddress:'maya@example.test'};
    const results=await Promise.allSettled([sendDemoSummaries(s,consent,store.deps),sendDemoSummaries(s,consent,store.deps)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(store.calls.length,2);
});
test('caller preview is invalidated by an intervening session revision',async()=>{
    const s=complete(),p=prepareDemoMessages(s,Date.now(),environment());
    const next=receipt(s,structuredClone(s),{action:'changed'}),store=memoryStore(next);
    await assert.rejects(sendDemoSummaries(next,{approved:true,snapshotHash:p.snapshotHash,callerAddress:p.callerAddress},store.deps),/Approve/);assert.equal(store.calls.length,0);
});
test('reservation failure sends nothing; receipt persistence failure stops the second lane',async()=>{
    const s=complete();let sends=0,saves=0,stored=s;
    const deps={env:environment(),stamp:receipt,save:async(p,n)=>{saves++;if(saves===2)throw Error('storage failure');stored=structuredClone(n);},send:async()=>{sends++;return {messageId:'accepted'};}};
    const result=await sendDemoSummaries(s,{approved:true,snapshotHash:'initial',callerAddress:'maya@example.test'},deps);
    assert.equal(sends,1);assert.equal(result.demoEmail.deliveries.internal.status,'RESERVED');assert.equal(stored.demoEmail.deliveries.caller.status,'RESERVED');
    await sendDemoSummaries(stored,{},deps);assert.equal(sends,1);
    const blocked={...deps,save:async()=>{throw Error('reservation failure');}};
    await assert.rejects(sendDemoSummaries(s,{approved:true,snapshotHash:'initial',callerAddress:'maya@example.test'},blocked));assert.equal(sends,1);
});
test('AgentMail adapter uses dedicated sender, reply-to, one recipient, no tracking or CC/BCC',async()=>{
    const p=prepareDemoMessages(complete(),Date.now(),environment());
    const result=await sendDemoMessage(p.caller,{env:environment(),idempotencyKey:'test-caller',fetchImpl:async(url,o)=>{
        const body=JSON.parse(o.body);assert.ok(url.includes('james-demo%40agentmail.to'));assert.deepEqual(body.to,['maya@example.test']);assert.deepEqual(body.reply_to,['aifusionlabs@gmail.com']);assert.equal(body.track_opens,false);assert.equal(body.cc,undefined);assert.equal(body.bcc,undefined);assert.equal(o.headers['Idempotency-Key'],'test-caller');return Response.json({message_id:'accepted'});
    }});assert.equal(result.messageId,'accepted');
    await assert.rejects(sendDemoMessage(p.caller,{env:environment(),idempotencyKey:'test',fetchImpl:async()=>Response.json({}, {status:200})}),/receipt/);
});
test('provider confirmation context must preserve turn order, not just text membership',()=>{
    const s=base();s.turns=[{id:'1',role:'persona',content:'I heard maya@example.test. Is that correct?'},{id:'2',role:'user',content:'Yes.'}];
    assert.throws(()=>verifyFinalEvidence(s,[{role:'user',content:'Yes.'},{role:'agent',content:s.turns[0].content}]),/turn order/);
});
test('new route targets current James; legacy routes and prompt/KB overrides stay unchanged',()=>{
    const source=readFileSync(new URL('../lib/james-canary/demo-server.ts',import.meta.url),'utf8');assert.match(source,/CURRENT_JAMES_PERSONA_ID/);assert.match(source,/xagent:james:notepad-demo:v1/);
    const client=readFileSync(new URL('../components/james/JamesCanary.tsx',import.meta.url),'utf8');assert.match(client,/Show legal pad/);assert.match(client,/repeating-linear-gradient/);assert.match(client,/type="password"/);assert.doesNotMatch(client,/localStorage.setItem\([^\n]*accessCode/);
});
test('HTTP demo lifecycle: isolated original persona, no automatic sends, preview/consent, two sends, replay safe',async()=>{
    const previous={...process.env},oldFetch=globalThis.fetch;
    Object.assign(process.env,environment(),{AMY_ANAM_SESSION_SPINE_ENABLED:'true',AMY_ANAM_SESSION_SPINE_KILL_SWITCH:'false',AMY_ANAM_SESSION_SECRET:'fake-secret-for-testing'.repeat(3),AMY_ANAM_REDIS_REST_URL:'https://redis.invalid',AMY_ANAM_REDIS_REST_TOKEN:'fake',ANAM_API_KEY:'fake'});
    const db=new Map(),providerId='e5254022-51d0-423e-9870-bb1a1fa117ad',messages=[];let label='',released=false,sends=0,launches=0;
    globalThis.fetch=async(url,o={})=>{
        const u=String(url),body=o.body?JSON.parse(o.body):null;
        if(u.includes('redis.invalid/pipeline'))return Response.json([{result:[1,600]}]);
        if(u==='https://redis.invalid'){
            if(body[0]==='GET')return Response.json({result:db.get(body[1])||null});
            if(body[0]==='SET'){if(db.has(body[1]))return Response.json({result:null});db.set(body[1],body[2]);return Response.json({result:'OK'});}
            const [,,,key,rev,box]=body;
            if((rev===-1&&db.has(key))||(rev!==-1&&(!db.has(key)||JSON.parse(db.get(key)).revision!==rev)))return Response.json({result:0});
            db.set(key,box);return Response.json({result:1});
        }
        if(u.endsWith('/personas/'+CURRENT_JAMES_PERSONA_ID))return Response.json({id:CURRENT_JAMES_PERSONA_ID,brain:{systemPrompt:'Current owner prompt, not changed'},voice:{id:'owner-voice',displayName:'Hale'}});
        if(u.endsWith('/auth/session-token')){assert.deepEqual(body.personaConfig,{personaId:CURRENT_JAMES_PERSONA_ID});label=body.clientLabel;launches++;return Response.json({sessionToken:'fake'});}
        if(u.endsWith('/sessions/'+providerId))return Response.json({id:providerId,personaId:CURRENT_JAMES_PERSONA_ID,clientLabel:label,startTime:new Date().toISOString(),endTime:released?new Date().toISOString():null});
        if(u.endsWith('/transcript'))return Response.json({sessionId:providerId,transcriptsEnabled:true,totalMessages:messages.length,messages,endTime:new Date().toISOString()});
        if(u.includes('api.agentmail.to')){if(!o.method)return Response.json({email:'james-demo@agentmail.to',display_name:'AI Fusion Labs Demo'});assert.ok(released);assert.deepEqual(body.to,[sends?'maya@example.test':INTERNAL_DEMO_RECIPIENT]);sends++;return Response.json({message_id:'provider-'+sends});}
        throw Error('Unexpected target '+u);
    };
    try{
        const request=(body,cookie='',code='')=>new Request('https://demo.invalid/api/james-notepad',{method:'POST',headers:{origin:'https://demo.invalid','Content-Type':'application/json',cookie,...(code?{'x-james-demo-access':code}:{})},body:JSON.stringify(body)});
        assert.equal((await post(request({action:'demo-email-preflight'},'',token))).status,200);assert.equal(launches,0);
        assert.equal((await legacyPost(request({action:'demo-email-preflight'},'',token))).status,400);
        const started=await post(request({action:'start'},'',token));assert.equal(started.status,200);const cookie=started.headers.get('set-cookie').split(';')[0],s=await started.json();assert.equal(s.personaId,CURRENT_JAMES_PERSONA_ID);assert.ok(cookie.startsWith('xagent_james_notepad_demo='));
        assert.equal((await post(request({action:'start'},cookie,token))).status,400);assert.equal(launches,1);
        const action=async(action,extra={})=>{const r=await post(request({action,id:s.id,...extra},cookie));const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
        await action('bind',{providerId});
        for(const t of complete().turns){await action('turn',{turn:t,finalized:true});messages.push({role:t.role,message:t.content});}
        assert.equal((await post(request({action:'preview-demo-email',id:s.id},cookie))).status,400);
        await action('begin-close');released=true;const closed=await action('close');assert.equal(closed.state,'CLOSED');assert.equal(sends,0);
        const p=await action('preview-demo-email');assert.equal(p.messages.length,2);assert.equal(sends,0);
        assert.equal((await post(request({action:'send-demo-email',id:s.id,...p,approved:false},cookie))).status,400);assert.equal(sends,0);
        const sent=await action('send-demo-email',{snapshotHash:p.snapshotHash,callerAddress:p.callerAddress,approved:true});assert.equal(sends,2);assert.ok(sent.demo_email_status.every(d=>d.status==='SENT'));assert.equal(sent.email_receipt,null);
        await action('send-demo-email',{snapshotHash:p.snapshotHash,callerAddress:p.callerAddress,approved:true});assert.equal(sends,2);
        const reload=await get(new Request('https://demo.invalid/api/james-notepad?id='+s.id,{headers:{cookie}}));assert.deepEqual(await reload.json(),sent);assert.equal(sends,2);
        assert.equal((await get(new Request('https://demo.invalid/api/james-notepad?id='+s.id))).status,400);
        assert.ok([...db.keys()].every(k=>k.startsWith('xagent:james:notepad-demo:v1:')));assert.ok(![...db.values()].some(v=>v.includes('Maya')));
    }finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
