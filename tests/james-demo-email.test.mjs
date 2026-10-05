import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyIntake,applyTurn,ingest,brief,receipt,sha,view,CURRENT_JAMES_PERSONA_ID,readiness} from '../lib/james-canary/state.ts';
import {prepareDemoMessages,sendDemoSummaries,sendDemoMessage,verifyDemoGrant,bindDemoGrant,readDemoAccessMode,readVisitorEmailPolicy,createVisitorDemoAuthorization,reserveVisitorEmailAllowance,readDemoEmailConfig,preflightDemoTransport,INTERNAL_DEMO_RECIPIENT} from '../lib/james-canary/demo-email.ts';
import {finalizeBrief,confirmBrief,applyBriefCorrection,structuredBriefView} from '../lib/james-canary/structured-brief.ts';
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
const visitorEnvironment=()=>({...environment(),JAMES_DEMO_EMAIL_ACCESS_MODE:'visitor',JAMES_DEMO_EMAIL_DAILY_SEND_LIMIT:'25',JAMES_DEMO_EMAIL_ACCESS_SHA256:undefined,JAMES_DEMO_EMAIL_EXPIRES_AT:undefined});
function visitorComplete(){
    let s=complete();s.intakeBrief={version:2};s=finalizeBrief(s);
    for(const [slot,value] of [['name','Maya Patel'],['phone','480-555-0177'],['location','Phoenix']])s=applyBriefCorrection(s,slot,value,structuredBriefView(s).hash);
    s=confirmBrief(s,structuredBriefView(s).hash);
    s.demoEmail={...s.demoEmail,...createVisitorDemoAuthorization(s.id,Date.now(),visitorEnvironment())};
    return s;
}
test('visitor capability is created on the server without code, bound to one call, bounded and revocable',()=>{
    const env=visitorEnvironment(),now=Date.now();
    const a=createVisitorDemoAuthorization('first',now,env),b=createVisitorDemoAuthorization('second',now,env);
    assert.equal(a.accessMode,'visitor');assert.notEqual(a.grantId,b.grantId);assert.equal(a.expiresAt-now,24*60*60*1000);
    assert.equal(a.accessDigest,undefined);assert.throws(()=>verifyDemoGrant(token,now,env),/server session/);
    for(const limit of [undefined,'','0','-1','1001','25\n',' 25 ','2.5'])assert.throws(()=>readVisitorEmailPolicy({...env,JAMES_DEMO_EMAIL_DAILY_SEND_LIMIT:limit}),/bounded/);
    assert.throws(()=>createVisitorDemoAuthorization('call',now,{...env,JAMES_DEMO_EMAIL_ENABLED:'false'}),/off/);
    const s=visitorComplete();assert.equal(prepareDemoMessages(s,Date.now(),env).callerAddress,'maya@example.test');
    assert.throws(()=>prepareDemoMessages(s,Date.now(),{...env,JAMES_DEMO_EMAIL_ACCESS_MODE:'reusable'}),/off/);
    assert.throws(()=>prepareDemoMessages(s,s.demoEmail.expiresAt,env),/authorization/);
    assert.throws(()=>prepareDemoMessages({...s,intakeBrief:undefined},Date.now(),env),/structured/);
    assert.equal(prepareDemoMessages(complete(),Date.now(),env).callerAddress,'maya@example.test');
});
test('visitor send allowance uses atomic expiring global/recipient counters without raw addresses, fails closed',async()=>{
    const env=visitorEnvironment();let calls=0;
    await reserveVisitorEmailAllowance('maya@example.test',{env,prefix:'james:',redis:async command=>{
        calls++;assert.equal(command[0],'EVAL');assert.equal(command[2],2);
        assert.deepEqual(command.slice(3),['james:demo-email-budget:total','james:demo-email-budget:recipient:'+sha('maya@example.test'),25,5,86400]);
        assert.ok(!JSON.stringify(command).includes('maya@'));assert.match(command[1],/EXPIRE/);return 1;
    }});assert.equal(calls,1);
    for(const result of [0,null,'1'])await assert.rejects(reserveVisitorEmailAllowance('maya@example.test',{env,prefix:'james:',redis:async()=>result}),/no email was attempted/);
    await assert.rejects(reserveVisitorEmailAllowance('maya@example.test',{env,prefix:'james:',redis:async()=>{throw Error('storage offline');}}),/offline/);
});
test('code-free email still needs confirmed brief and explicit consent; quota precedes reservation and duplicate requests send nothing',async()=>{
    const s=visitorComplete(),store=memoryStore(s);let allowances=0;
    store.deps.env=visitorEnvironment();store.deps.reserveAllowance=async recipient=>{assert.equal(recipient,'maya@example.test');assert.equal(store.stored.demoEmail.deliveries,undefined);allowances++;};
    const consent={approved:true,snapshotHash:s.stateHash,callerAddress:'maya@example.test'};
    await assert.rejects(sendDemoSummaries(s,{...consent,approved:false},store.deps),/Approve/);assert.equal(allowances,0);assert.equal(store.calls.length,0);
    await assert.rejects(sendDemoSummaries(s,consent,{...store.deps,reserveAllowance:undefined}),/allowance/);
    await assert.rejects(sendDemoSummaries(s,consent,{...store.deps,reserveAllowance:async()=>{throw Error('budget exceeded');}}),/budget/);assert.equal(store.calls.length,0);
    const result=await sendDemoSummaries(s,consent,store.deps);assert.equal(allowances,1);assert.equal(store.calls.length,2);
    await sendDemoSummaries(result,{},store.deps);assert.equal(allowances,1);assert.equal(store.calls.length,2);
});
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
test('reusable private code remains valid across calls and days, never opens unauthenticated access',()=>{
    const now=Date.now(),env={...environment(),JAMES_DEMO_EMAIL_ACCESS_MODE:'reusable',JAMES_DEMO_EMAIL_EXPIRES_AT:'expired'};
    assert.equal(readDemoAccessMode({}),'one-use');
    for(const mode of ['public','', ' reusable '])assert.throws(()=>readDemoAccessMode({JAMES_DEMO_EMAIL_ACCESS_MODE:mode}),/invalid/);
    const first=verifyDemoGrant(token,now,env),later=verifyDemoGrant(token,now+7*24*60*60*1000,env);
    assert.equal(first.accessMode,'reusable');assert.equal(first.id,later.id);
    assert.equal(first.expiresAt-now,24*60*60*1000);assert.equal(later.expiresAt-(now+7*24*60*60*1000),24*60*60*1000);
    for(const code of [undefined,'','x'.repeat(43),token+'\n'])assert.throws(()=>verifyDemoGrant(code,now,env));
    assert.throws(()=>verifyDemoGrant(token,now,{...env,JAMES_DEMO_EMAIL_ENABLED:'false'}),/off/);
    const a=bindDemoGrant(first,'first-call'),b=bindDemoGrant(first,'second-call');
    assert.notEqual(a.grantId,b.grantId);assert.equal(a.accessDigest,sha(token));
    assert.equal(bindDemoGrant(verifyDemoGrant(token,now,environment()),'legacy-call').grantId,sha(token));
});
test('reusable call authorization respects expiry, revocation and sender changes; prior one-use calls survive upgrade',()=>{
    const env={...environment(),JAMES_DEMO_EMAIL_ACCESS_MODE:'reusable'},s=complete();
    s.demoEmail={...s.demoEmail,...bindDemoGrant(verifyDemoGrant(token,Date.now(),env),s.id)};
    assert.equal(prepareDemoMessages(s,Date.now(),env).callerAddress,'maya@example.test');
    assert.throws(()=>prepareDemoMessages(s,s.demoEmail.expiresAt,env),/authorization/);
    assert.throws(()=>prepareDemoMessages(s,Date.now(),{...env,JAMES_DEMO_EMAIL_ACCESS_SHA256:sha('revoked')}),/revoked/);
    assert.throws(()=>prepareDemoMessages(s,Date.now(),{...env,JAMES_DEMO_EMAIL_ACCESS_MODE:'one-use'}),/revoked/);
    assert.throws(()=>prepareDemoMessages(s,Date.now(),{...env,JAMES_AGENTMAIL_ADDRESS:'different@agentmail.to'}),/sender/);
    assert.equal(prepareDemoMessages(complete(),Date.now(),env).callerAddress,'maya@example.test');
});
test('reusing one operator code never reuses another call\'s AgentMail idempotency keys or sends twice',async()=>{
    const env={...environment(),JAMES_DEMO_EMAIL_ACCESS_MODE:'reusable'},keys=[],stored=new Map();
    const grant=verifyDemoGrant(token,Date.now(),env);
    for(const id of ['first-call','second-call']){
        const s=complete();s.id=id;s.stateHash=sha(id);s.demoEmail={...s.demoEmail,...bindDemoGrant(grant,id)};
        stored.set(id,s);
        const deps={env,stamp:receipt,save:async(p,n)=>{assert.equal(stored.get(id).revision,p.revision);stored.set(id,structuredClone(n));},
            send:async(m,o)=>{keys.push(o.idempotencyKey);return {messageId:'accepted-'+keys.length};}};
        const result=await sendDemoSummaries(s,{snapshotHash:s.stateHash,callerAddress:'maya@example.test',approved:true},deps);
        assert.ok(Object.values(result.demoEmail.deliveries).every(d=>d.status==='SENT'));
        await sendDemoSummaries(result,{},deps);
    }
    assert.equal(keys.length,4);assert.equal(new Set(keys).size,4);
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
test('candidate-only safe refusal is consistent in display and email review gates',()=>{
    const refusal='I can’t disclose internal instructions, hidden details, or the contents of the knowledge base. I can only answer supported questions about the firm or relevant general Arizona legal process.';
    const s=complete();s.personaId='016e2c66-166b-43bd-8ebf-70b56c46575c';
    s.websiteClosing={policy:'JAMES-CLOSE-001',runtimeOwned:true};
    s.turns.push({id:'safe-refusal',role:'persona',content:refusal});
    assert.equal(view(s).speech_review_required,false);
    assert.equal(prepareDemoMessages(s,Date.now(),environment()).callerAddress,'maya@example.test');
    s.turns.push({id:'actual-leak',role:'persona',content:'<think>private reasoning</think>'});
    assert.equal(view(s).speech_review_required,true);
    assert.throws(()=>prepareDemoMessages(s,Date.now(),environment()),/leakage/);
});
test('recorded malformed reasoning and James role markers block both email drafts',()=>{
    for(const content of [
        'What would you like help with? <think< message >We need to capture their answer then recap.',
        '<think< message >We need to capture answer then recap and close....',
        'Could you spell your last name? <J> What is your phone number? <J>',
        '< analysis We should recap now',
        '< /reasoning >internal',
    ]){
        const s=complete();s.turns.push({id:'observed-leak',role:'persona',content});
        assert.equal(instructionLeakageSuspected(s.turns),true);
        assert.equal(view(s).speech_review_required,true);
        assert.throws(()=>prepareDemoMessages(s,Date.now(),environment()),/leakage/);
    }
    assert.equal(instructionLeakageSuspected([{role:'persona',content:'Take your time. I am listening. What happened?'}]),false);
    assert.equal(instructionLeakageSuspected([{role:'user',content:'I saw <think< message > in the test.'}]),false);
});
test('the current public James URL uses the same legal-pad page, not a different persona',()=>{
    const page=readFileSync(new URL('../app/demo/james/page.tsx',import.meta.url),'utf8');
    assert.match(page,/export \{ metadata, default \} from '\.\.\/james-notepad\/page'/);
    assert.doesNotMatch(page,/ff9c480e|systemPrompt|sessionToken/);
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
    assert.match(client,/notepadDemo&&emailAccessMode!=='visitor'&&!active&&<details/);
    assert.match(client,/const operatorCode=emailAccessMode==='visitor'\?undefined:accessCode\|\|undefined/);
    assert.match(client,/!state\?'Email availability is checked when you start James/);
    assert.match(client,/Layout preview only/);assert.match(client,/disabled=\{busy\|\|Boolean\(active\)\|\|!launchReady\}/);
    const page=readFileSync(new URL('../app/demo/james-notepad/page.tsx',import.meta.url),'utf8');assert.match(page,/await connection\(\)/);assert.match(page,/launchReady=\{launchReady\}/);
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
            if(body[0]==='EVAL'&&body[2]===2){const total=Number(db.get(body[3])||0),recipient=Number(db.get(body[4])||0);if(total>=body[5]||recipient>=body[6])return Response.json({result:0});db.set(body[3],String(total+1));db.set(body[4],String(recipient+1));return Response.json({result:1});}
            const [,,,key,rev,box]=body;
            if((rev===-1&&db.has(key))||(rev!==-1&&(!db.has(key)||JSON.parse(db.get(key)).revision!==rev)))return Response.json({result:0});
            db.set(key,box);return Response.json({result:1});
        }
        if(u.endsWith('/personas/'+CURRENT_JAMES_PERSONA_ID))return Response.json({id:CURRENT_JAMES_PERSONA_ID,brain:{systemPrompt:'Current owner prompt, not changed'},voice:{id:'owner-voice',displayName:'Hale'}});
        if(u.endsWith('/auth/session-token')){assert.deepEqual(body.personaConfig,{personaId:CURRENT_JAMES_PERSONA_ID});label=body.clientLabel;launches++;return Response.json({sessionToken:'fake'});}
        if(u.endsWith('/sessions/'+providerId))return Response.json({id:providerId,personaId:CURRENT_JAMES_PERSONA_ID,clientLabel:label,startTime:new Date().toISOString(),endTime:released?new Date().toISOString():null});
        if(u.endsWith('/transcript'))return Response.json({sessionId:providerId,transcriptsEnabled:true,totalMessages:messages.length,messages,endTime:new Date().toISOString()});
        if(u.includes('api.agentmail.to')){if(!o.method)return Response.json({email:'james-demo@agentmail.to',display_name:'AI Fusion Labs Demo'});assert.ok(released);assert.deepEqual(body.to,[sends%2?'maya@example.test':INTERNAL_DEMO_RECIPIENT]);sends++;return Response.json({message_id:'provider-'+sends});}
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
        const activeReview=await action('finalize-brief');
        assert.equal(activeReview.intakeBrief.phase,'REVIEW');
        assert.equal((await post(request({action:'confirm-brief',id:s.id,snapshotHash:activeReview.intakeBrief.hash}))).status,400);
        assert.equal((await post(request({action:'confirm-brief',id:s.id,snapshotHash:'stale'},cookie))).status,400);
        assert.equal((await post(request({action:'tool',id:s.id,operation:'CONFIRM_BRIEF'},cookie))).status,400);
        const firstInvite=await action('reserve-brief-invitation',{snapshotHash:activeReview.intakeBrief.hash});
        assert.equal(firstInvite.invitation_allowed,true);
        const repeatedInvite=await action('reserve-brief-invitation',{snapshotHash:activeReview.intakeBrief.hash});
        assert.equal(repeatedInvite.invitation_allowed,false);assert.equal(repeatedInvite.revision,firstInvite.revision);
        assert.equal((await post(request({action:'preview-demo-email',id:s.id},cookie))).status,400);
        // JAMES-CLOSE-001: authenticated closing requests bind the exact final
        // turn/revision; an interruption cancels them and remains recordable.
        assert.equal((await post(request({action:'begin-close',id:s.id,automatic:true,farewellTurnId:'invented',revision:0},cookie))).status,400);
        const goodbye={id:'closing-user',role:'user',content:'Thanks, James. Goodbye.'};
        await action('turn',{turn:goodbye,finalized:true});messages.push({role:goodbye.role,message:goodbye.content});
        const farewell={id:'closing-persona',role:'persona',content:'Thank you. Take care.'};
        const pending=await action('turn',{turn:farewell,finalized:true});messages.push({role:farewell.role,message:farewell.content});
        assert.equal(pending.state,'CLOSING_PENDING');
        assert.equal((await post(request({action:'begin-close',id:s.id,automatic:true,farewellTurnId:farewell.id,revision:pending.revision-1},cookie))).status,400);
        const cancelled=await action('cancel-close');assert.equal(cancelled.state,'ACTIVE');
        assert.equal((await post(request({action:'begin-close',id:s.id,automatic:true,farewellTurnId:farewell.id,revision:pending.revision},cookie))).status,400);
        const wait={id:'closing-wait',role:'user',content:'Wait, not yet.'};
        const resumed=await action('turn',{turn:wait,finalized:true});messages.push({role:wait.role,message:wait.content});assert.equal(resumed.state,'ACTIVE');
        await action('begin-close');
        assert.equal((await post(request({action:'correct-brief',id:s.id,slot:'name',value:'Maya Patel',snapshotHash:activeReview.intakeBrief.hash},cookie))).status,400);
        released=true;const closed=await action('close');assert.equal(closed.state,'CLOSED');assert.equal(sends,0);
        assert.equal((await post(request({action:'preview-demo-email',id:s.id},cookie))).status,400);
        let reviewed=await action('correct-brief',{slot:'name',value:'Maya Patel',snapshotHash:closed.intakeBrief.hash});
        reviewed=await action('correct-brief',{slot:'phone',value:'480-555-0177',snapshotHash:reviewed.intakeBrief.hash});
        reviewed=await action('correct-brief',{slot:'location',value:'Phoenix',snapshotHash:reviewed.intakeBrief.hash});
        assert.deepEqual(reviewed.intakeBrief.missing,[]);
        await action('confirm-brief',{snapshotHash:reviewed.intakeBrief.hash});
        const p=await action('preview-demo-email');assert.equal(p.messages.length,2);assert.equal(sends,0);
        assert.equal((await post(request({action:'send-demo-email',id:s.id,...p,approved:false},cookie))).status,400);assert.equal(sends,0);
        const sent=await action('send-demo-email',{snapshotHash:p.snapshotHash,callerAddress:p.callerAddress,approved:true});assert.equal(sends,2);assert.ok(sent.demo_email_status.every(d=>d.status==='SENT'));assert.equal(sent.email_receipt,null);
        assert.equal((await post(request({action:'correct-brief',id:s.id,slot:'name',value:'Maya Patel',snapshotHash:sent.intakeBrief.hash},cookie))).status,400);
        await action('send-demo-email',{snapshotHash:p.snapshotHash,callerAddress:p.callerAddress,approved:true});assert.equal(sends,2);
        const reload=await get(new Request('https://demo.invalid/api/james-notepad?id='+s.id,{headers:{cookie}}));assert.deepEqual(await reload.json(),sent);assert.equal(sends,2);
        assert.equal((await get(new Request('https://demo.invalid/api/james-notepad?id='+s.id))).status,400);
        // Upgrade leaves the old code/claim intact while each future call gets
        // a distinct send capability. Preflight never starts a provider call.
        process.env.JAMES_DEMO_EMAIL_ACCESS_MODE='reusable';process.env.JAMES_DEMO_EMAIL_EXPIRES_AT='expired';
        const reusableCheck=await post(request({action:'demo-email-preflight'},'',token));
        const reusableMeta=await reusableCheck.json();assert.equal(reusableCheck.status,200);
        assert.equal(reusableMeta.accessMode,'reusable');assert.equal(reusableMeta.maxSessions,null);assert.equal(reusableMeta.maxEmailsPerSession,2);assert.equal(launches,1);
        const nextCalls=[];
        for(let i=0;i<2;i++){
            const nextCall=await post(request({action:'start'},cookie,token));assert.equal(nextCall.status,200);nextCalls.push(await nextCall.json());
        }
        assert.notEqual(nextCalls[0].id,nextCalls[1].id);assert.equal(launches,3);assert.equal(sends,2);
        for(const nextCall of nextCalls)assert.equal(db.get('xagent:james:notepad-demo:v1:demo-grant:'+sha('james-demo-session:'+sha(token)+':'+nextCall.id)),nextCall.id);
        assert.equal((await post(request({action:'start',accessMode:'reusable'},cookie,'x'.repeat(43)))).status,400);assert.equal(launches,3);
        // Code-free mode is a server setting, not a request-body privilege.
        Object.assign(process.env,{JAMES_DEMO_EMAIL_ACCESS_MODE:'visitor',JAMES_DEMO_EMAIL_DAILY_SEND_LIMIT:'25'});
        delete process.env.JAMES_DEMO_EMAIL_ACCESS_SHA256;
        assert.equal((await post(request({action:'demo-email-preflight'}))).status,400);assert.equal(launches,3);
        messages.length=0;released=false;
        const visitorStart=await post(request({action:'start'},cookie));const visitor=await visitorStart.json();assert.equal(visitorStart.status,200,JSON.stringify(visitor));
        assert.equal(visitor.demo_email_authorized,true);assert.equal(launches,4);assert.equal(sends,2);
        assert.doesNotMatch(JSON.stringify(visitor),/grantId|accessDigest/);
        const visitorAction=async(action,extra={})=>{const r=await post(request({action,id:visitor.id,...extra},cookie));const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
        assert.equal((await post(request({action:'preview-demo-email',id:visitor.id}))).status,400);
        await visitorAction('bind',{providerId});
        for(const t of complete().turns){await visitorAction('turn',{turn:t,finalized:true});messages.push({role:t.role,message:t.content});}
        await visitorAction('begin-close');released=true;let visitorReviewed=await visitorAction('close');assert.equal(sends,2);
        for(const [slot,value] of [['name','Maya Patel'],['phone','480-555-0177'],['location','Phoenix']])visitorReviewed=await visitorAction('correct-brief',{slot,value,snapshotHash:visitorReviewed.intakeBrief.hash});
        await visitorAction('confirm-brief',{snapshotHash:visitorReviewed.intakeBrief.hash});const vp=await visitorAction('preview-demo-email');
        assert.equal((await post(request({action:'send-demo-email',id:visitor.id,...vp,approved:false},cookie))).status,400);assert.equal(sends,2);
        const visitorSent=await visitorAction('send-demo-email',{snapshotHash:vp.snapshotHash,callerAddress:vp.callerAddress,approved:true});assert.equal(sends,4);
        assert.ok(visitorSent.demo_email_status.every(d=>d.status==='SENT'));
        await visitorAction('send-demo-email',{});assert.equal(sends,4);
        assert.equal(db.get('xagent:james:notepad-demo:v1:demo-email-budget:total'),'1');
        assert.equal(db.get('xagent:james:notepad-demo:v1:demo-email-budget:recipient:'+sha('maya@example.test')),'1');
        process.env.JAMES_DEMO_EMAIL_DAILY_SEND_LIMIT='0';assert.equal((await post(request({action:'start'},cookie))).status,400);assert.equal(launches,4);
        process.env.JAMES_DEMO_EMAIL_ENABLED='false';const notesOnly=await post(request({action:'start',accessMode:'visitor',demoEmail:{accessMode:'visitor'}},cookie));assert.equal(notesOnly.status,200);assert.equal((await notesOnly.json()).demo_email_authorized,false);assert.equal(launches,5);assert.equal(sends,4);
        assert.ok([...db.keys()].every(k=>k.startsWith('xagent:james:notepad-demo:v1:')));assert.ok(![...db.values()].some(v=>v.includes('Maya')));
    }finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);}
});
