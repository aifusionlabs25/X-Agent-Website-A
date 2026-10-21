import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTurn,emptyIntake,receipt,sha,view,readiness,CURRENT_JAMES_PERSONA_ID} from '../lib/james-canary/state.ts';
import {finalizeBrief,confirmBrief,applyBriefCorrection,structuredBriefView} from '../lib/james-canary/structured-brief.ts';
import {prepareDemoMessages,sendDemoSummaries as sendDemoSummariesWithPolicy,sendDemoMessage,verifiedTranscriptAttachment,readDemoEmailConfig,preflightDemoTransport,INTERNAL_DEMO_RECIPIENT} from '../lib/james-canary/demo-email.ts';
const sendDemoSummaries=(session,consent,deps)=>sendDemoSummariesWithPolicy(session,consent,{accessAllowed:async()=>true,...deps});

const now=Date.parse('2026-10-13T18:05:00.000Z');
const env=(mode='owner')=>({JAMES_DEMO_EMAIL_ENABLED:'true',JAMES_AGENTMAIL_API_KEY:'fake-james-key-long-enough-for-tests',JAMES_AGENTMAIL_ADDRESS:'james-demo@agentmail.to',JAMES_DEMO_REPLY_TO:'aifusionlabs@gmail.com',JAMES_DEMO_EMAIL_ACCESS_MODE:'visitor',JAMES_DEMO_EMAIL_DAILY_SEND_LIMIT:'25',JAMES_DEMO_EMAIL_BUNDLE:'three',JAMES_DEMO_EMAIL_RECIPIENT_MODE:mode});
function complete(mode='owner'){
    let s={id:'17e1b181-d4fa-42eb-8209-cad30ef97880',browserId:'offline',clientLabel:'offline-three-email',createdAt:'2026-10-13T18:00:00.000Z',revision:0,stateHash:sha('initial-three-email'),personaId:CURRENT_JAMES_PERSONA_ID,config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),receipts:[]};
    const say=(content,role='user')=>s=applyTurn(s,{id:String(s.turns.length),role,content});
    say('A contractor left my kitchen torn apart. I paid a $4,000 deposit. I want my $4,000 back.');
    say('The payment was on August 3rd. He is not answering my calls. I have a text message agreement and bank transfer receipt. My kitchen is unusable.');
    say('My name is Maya Patel. My phone number is 480-555-0177. My email is maya@example.test.');
    say('I heard maya@example.test. Is that correct?','persona');say('Yes.');
    assert.equal(readiness(s.intake).ready,true);
    Object.assign(s,{state:'CLOSED',closedAt:'2026-10-13T18:04:00.000Z',intakeBrief:{version:2}});
    s=finalizeBrief(s);
    for(const [slot,value]of [['name','Maya Patel'],['phone','480-555-0177'],['location','Phoenix']])s=applyBriefCorrection(s,slot,value,structuredBriefView(s).hash);
    s=confirmBrief(s,structuredBriefView(s).hash);assert.equal(structuredBriefView(s).missing.length,0);
    s.providerId='11111111-2222-4333-8444-555555555555';
    s.providerTranscript=[...s.turns.map(t=>({role:t.role==='persona'?'agent':'user',content:t.content})),{role:'agent',content:'Provider-only finalized reply — received after the browser captions. Goodbye.'}];
    s.providerRelease={startTime:s.createdAt,endTime:'2026-10-13T18:04:00.000Z',verifiedAt:'2026-10-13T18:04:03.000Z',transcriptHash:sha(JSON.stringify(s.providerTranscript))};
    s.demoEmail={grantId:sha('offline-three-email-'+mode),expiresAt:now+3600000,sender:'james-demo@agentmail.to',replyTo:'aifusionlabs@gmail.com',accessMode:'visitor',bundle:'three',recipientMode:mode};
    return s;
}
function approval(s,e=env()){
    const p=prepareDemoMessages(s,now,e);
    return {approved:true,snapshotHash:p.snapshotHash,callerAddress:p.callerAddress,messageHash:p.messageHash};
}
function store(s,e=env()){
    let current=structuredClone(s);const sends=[],saves=[];let allowances=0;
    const deps={env:e,now,stamp:receipt,reserveAllowance:async address=>{assert.equal(address,'maya@example.test');allowances++;},save:async(p,n)=>{
        assert.equal(p.revision,current.revision,'CAS rejects stale revisions');current=structuredClone(n);saves.push(structuredClone(n));
    },send:async(message,options)=>{
        if(!sends.length)assert.ok(['internal','caller','admin'].every(lane=>current.demoEmail.deliveries[lane].status==='RESERVED'),'all three lanes durably reserved before first send');
        sends.push({message,options});return {messageId:'fake-receipt-'+sends.length};
    }};
    return {deps,sends,saves,get current(){return current;},get allowances(){return allowances;}};
}

test('three-bundle configuration requires an explicit approved owner or caller recipient mode',()=>{
    for(const mode of [undefined,'','both','all',' owner '])assert.throws(()=>readDemoEmailConfig({...env(),JAMES_DEMO_EMAIL_RECIPIENT_MODE:mode}),/recipient mode/);
    for(const mode of ['owner','caller'])assert.equal(readDemoEmailConfig(env(mode)).recipientMode,mode);
    assert.throws(()=>readDemoEmailConfig({...env(),JAMES_DEMO_EMAIL_BUNDLE:'four'}),/bundle/);
    assert.equal(readDemoEmailConfig({...env(),JAMES_DEMO_EMAIL_BUNDLE:undefined,JAMES_DEMO_EMAIL_RECIPIENT_MODE:undefined}).bundle,undefined);
});

for(const mode of ['owner','caller']){
    test(mode+' mode keeps all three recipients separate and attaches transcript only to firm review lane',()=>{
        const p=prepareDemoMessages(complete(mode),now,env(mode));
        assert.equal(p.internal.to,INTERNAL_DEMO_RECIPIENT);assert.equal(p.admin.to,INTERNAL_DEMO_RECIPIENT);
        assert.equal(p.caller.to,mode==='owner'?INTERNAL_DEMO_RECIPIENT:'maya@example.test');
        assert.equal(p.callerAddress,'maya@example.test');assert.equal(p.internal.attachments.length,1);
        assert.equal(p.caller.attachments,undefined);assert.equal(p.admin.attachments,undefined);
        assert.match(p.internal.subject,/brief|transcript/i);assert.match(p.admin.subject,/record/i);
        assert.doesNotMatch(p.caller.text,/11111111-2222|Transcript hash|Brief snapshot hash|Website session|Provider session/);
        assert.match(p.caller.text,/demo purposes only/i);
        assert.equal(p.messageHash,sha(JSON.stringify({internal:p.internal,caller:p.caller,admin:p.admin})));
    });
}

test('saved bundle and recipient mode bind preparation and prevent routing drift',()=>{
    const s=complete();
    for(const change of [{JAMES_DEMO_EMAIL_RECIPIENT_MODE:'caller'},{JAMES_DEMO_EMAIL_BUNDLE:'two'},{JAMES_AGENTMAIL_ADDRESS:'different@agentmail.to'}])assert.throws(()=>prepareDemoMessages(s,now,{...env(),...change}),/routing|sender/);
    const old=structuredClone(s);delete old.demoEmail.bundle;delete old.demoEmail.recipientMode;
    assert.throws(()=>prepareDemoMessages(old,now,env()),/routing/);
});

test('verified attachment exports every normalized provider turn, including extra provider-only reply',()=>{
    const s=complete(),attachment=verifiedTranscriptAttachment(s),text=Buffer.from(attachment.content,'base64').toString('utf8');
    assert.equal(attachment.content_type,'text/plain');assert.equal(attachment.filename,'james-transcript-'+s.id+'.txt');
    assert.equal(Buffer.from(text,'utf8').toString('base64'),attachment.content);
    for(const [index,turn]of s.providerTranscript.entries())assert.ok(text.includes(`${index+1}. ${turn.role==='user'?'Visitor':'James'}: ${turn.content}`));
    assert.match(text,/Provider-only finalized reply — received after the browser captions/);
    assert.match(text,new RegExp(s.providerRelease.transcriptHash));
    assert.equal(s.turns.some(t=>t.content.includes('Provider-only')),false);
});

test('missing, empty, altered or oversized complete provider transcripts fail closed without truncation',()=>{
    for(const alter of [s=>delete s.providerTranscript,s=>s.providerTranscript=[],s=>delete s.providerRelease,s=>s.providerTranscript[0].content+=' altered']){
        const s=complete();alter(s);assert.throws(()=>verifiedTranscriptAttachment(s),/verified provider transcript/);
    }
    const s=complete();s.providerTranscript=[{role:'agent',content:'x'.repeat(512*1024)}];s.providerRelease.transcriptHash=sha(JSON.stringify(s.providerTranscript));
    assert.throws(()=>verifiedTranscriptAttachment(s),/size limit/);
});

test('provider-only instruction leakage blocks all three messages even if browser history is clean',()=>{
    const s=complete();s.providerTranscript.push({role:'agent',content:'<think>private internal planning</think>'});s.providerRelease.transcriptHash=sha(JSON.stringify(s.providerTranscript));
    assert.equal(s.turns.some(t=>t.content.includes('<think>')),false);assert.throws(()=>prepareDemoMessages(s,now,env()),/leakage/);
});

test('three-message consent requires exact bundle fingerprint before allowance, reservations or sends',async()=>{
    const s=complete(),consent=approval(s);
    for(const change of [{approved:false},{snapshotHash:'old'},{callerAddress:'other@example.test'},{messageHash:undefined},{messageHash:'wrong'}]){
        const m=store(s);await assert.rejects(sendDemoSummaries(s,{...consent,...change},m.deps),/Approve/);
        assert.equal(m.allowances,0);assert.equal(m.sends.length,0);assert.equal(m.saves.length,0);
    }
});

test('attachment changes invalidate consent even when brief snapshot is otherwise unchanged',async()=>{
    const s=complete(),consent=approval(s),n=structuredClone(s);
    n.providerTranscript.push({role:'agent',content:'A new independently verified final reply.'});n.providerRelease.transcriptHash=sha(JSON.stringify(n.providerTranscript));
    assert.equal(n.stateHash,s.stateHash);assert.notEqual(prepareDemoMessages(n,now,env()).messageHash,consent.messageHash);
    const m=store(n);await assert.rejects(sendDemoSummaries(n,consent,m.deps),/Approve/);assert.equal(m.sends.length,0);
});

test('confirmed recipient and current structured brief remain mandatory in both routing modes',()=>{
    for(const mode of ['owner','caller'])for(const alter of [s=>s.intake.facts.find(f=>f.field==='primary_email').status='VISITOR_REPORTED',s=>s.intake.emailCandidate={value:'changed@example.test'},s=>delete s.intakeBrief.confirmation,s=>s.state='ACTIVE',s=>s.demoEmail.expiresAt=now]){
        const s=complete(mode);alter(s);assert.throws(()=>prepareDemoMessages(s,now,env(mode)));
    }
});

test('all three lanes reserve together, use distinct keys, and duplicate replay never sends again',async()=>{
    const s=complete(),m=store(s),result=await sendDemoSummaries(s,approval(s),m.deps);
    assert.equal(m.sends.length,3);assert.equal(m.allowances,1);assert.equal(m.saves.length,4);
    assert.deepEqual(Object.keys(m.saves[0].demoEmail.deliveries),['internal','caller','admin']);
    assert.ok(Object.values(m.saves[0].demoEmail.deliveries).every(x=>x.status==='RESERVED'));
    assert.equal(new Set(m.sends.map(x=>x.options.idempotencyKey)).size,3);
    assert.deepEqual(m.sends.map(x=>x.options.idempotencyKey.split('-').at(-1)),['internal','caller','admin']);
    assert.ok(Object.values(result.demoEmail.deliveries).every(x=>x.status==='SENT'));
    await sendDemoSummaries(result,{},m.deps);assert.equal(m.sends.length,3);assert.equal(m.allowances,1);
    const exposed=view(result);assert.equal(exposed.demo_email_status.length,3);assert.equal(exposed.external_actions.length,3);
    assert.equal(exposed.providerTranscript,undefined);assert.ok(!JSON.stringify(exposed).includes('Provider-only finalized reply'));
    assert.ok(!JSON.stringify(exposed).includes('fake-receipt-'));
});

test('concurrent three-bundle sends have exactly one CAS reservation winner',async()=>{
    const s=complete(),m=store(s),consent=approval(s);
    const results=await Promise.allSettled([sendDemoSummaries(s,consent,m.deps),sendDemoSummaries(s,consent,m.deps)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(m.sends.length,3);
});

for(const failLane of [0,1,2])for(const failure of ['timeout','missing receipt']){
    test('independent '+failure+' in lane '+failLane+' remains unknown and never retries any lane',async()=>{
        const s=complete(),m=store(s);let attempts=0;
        m.deps.send=async()=>{const index=attempts++;if(index===failLane){if(failure==='timeout')throw Error('timeout');return {messageId:''};}return {messageId:'fake-ok-'+index};};
        const result=await sendDemoSummaries(s,approval(s),m.deps);
        assert.deepEqual(['internal','caller','admin'].map(l=>result.demoEmail.deliveries[l].status),[0,1,2].map(i=>i===failLane?'FAILED_OR_UNKNOWN':'SENT'));
        await sendDemoSummaries(result,{},m.deps);assert.equal(attempts,3);
    });
}

test('failed durable reservation sends no email',async()=>{
    const s=complete(),m=store(s);m.deps.save=async()=>{throw Error('CAS storage failure');};
    await assert.rejects(sendDemoSummaries(s,approval(s),m.deps),/CAS storage failure/);assert.equal(m.sends.length,0);
});

for(const failingSave of [2,3]){
    test('receipt storage failure at save '+failingSave+' stops remaining lanes and reload authorizes no retry',async()=>{
        const s=complete(),m=store(s),save=m.deps.save;let saves=0;
        m.deps.save=async(p,n)=>{if(++saves===failingSave)throw Error('receipt storage failure');await save(p,n);};
        const result=await sendDemoSummaries(s,approval(s),m.deps);assert.equal(m.sends.length,failingSave-1);
        assert.equal(result.demoEmail.deliveries.admin.status,'RESERVED');
        await sendDemoSummaries(m.current,{},m.deps);assert.equal(m.sends.length,failingSave-1);
    });
}

test('AgentMail payload uses one recipient, reply-to, no CC/BCC or tracking and only verified TXT attachment',async()=>{
    const p=prepareDemoMessages(complete(),now,env());let calls=0;
    for(const lane of ['internal','caller','admin'])await sendDemoMessage(p[lane],{env:env(),idempotencyKey:'fake-'+lane,fetchImpl:async(url,options)=>{
        calls++;const payload=JSON.parse(options.body);assert.match(url,/james-demo%40agentmail\.to\/messages\/send$/);
        assert.equal(payload.to.length,1);assert.deepEqual(payload.reply_to,['aifusionlabs@gmail.com']);assert.equal(payload.cc,undefined);assert.equal(payload.bcc,undefined);assert.equal(payload.track_opens,false);
        assert.deepEqual(payload.attachments,lane==='internal'?p.internal.attachments:undefined);
        return Response.json({message_id:'fake-accepted-'+lane});
    }});
    assert.equal(calls,3);
});

test('invalid attachment shape, filename, encoding, type and oversize fail before mocked transport is invoked',async()=>{
    const p=prepareDemoMessages(complete(),now,env());let calls=0;
    for(const alter of [m=>m.attachments.push(structuredClone(m.attachments[0])),m=>m.attachments[0].filename='../private.txt',m=>m.attachments[0].content='invalid*base64',m=>m.attachments[0].content_type='text/html',m=>m.attachments[0].content=Buffer.alloc(512*1024+1).toString('base64')]){
        const message=structuredClone(p.internal);alter(message);
        await assert.rejects(sendDemoMessage(message,{env:env(),idempotencyKey:'fake-invalid',fetchImpl:async()=>{calls++;return Response.json({message_id:'should-not-send'});}}),/attachment/);
    }
    assert.equal(calls,0);
});

test('three-bundle transport preflight returns explicit routing but does not send',async()=>{
    let calls=0;const result=await preflightDemoTransport({env:env(),fetchImpl:async(_url,options)=>{
        calls++;assert.equal(options.method,undefined);return Response.json({email:'james-demo@agentmail.to',display_name:'AI Fusion Labs Demo'});
    }});assert.equal(calls,1);assert.equal(result.bundle,'three');assert.equal(result.recipientMode,'owner');
});

test('legacy two-email bundle remains compatible without transcript attachment or message-hash consent',async()=>{
    const s=complete();delete s.demoEmail.bundle;delete s.demoEmail.recipientMode;delete s.providerTranscript;
    const e={...env(),JAMES_DEMO_EMAIL_BUNDLE:'two',JAMES_DEMO_EMAIL_RECIPIENT_MODE:undefined},p=prepareDemoMessages(s,now,e);
    assert.equal(p.admin,undefined);assert.equal(p.messageHash,undefined);assert.equal(p.internal.attachments,undefined);
    const m=store(s,e);m.deps.send=async(message,options)=>{m.sends.push({message,options});return {messageId:'legacy-receipt'};};
    await sendDemoSummaries(s,{approved:true,snapshotHash:p.snapshotHash,callerAddress:p.callerAddress},m.deps);assert.equal(m.sends.length,2);
});
