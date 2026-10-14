import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTurn,emptyIntake,sha,view,CURRENT_JAMES_PERSONA_ID} from '../lib/james-canary/state.ts';
import {finalizeBrief} from '../lib/james-canary/structured-brief.ts';
import {prepareDemoMessages} from '../lib/james-canary/demo-email.ts';

const question='That’s completely understandable. Let’s take this one step at a time. Did the officer ask you to perform any field sobriety tests, or did you take a breath or blood test?';
const actual="Field tests, maybe a breath test too. I'm really not sure. Sorry, I'm in a hurry. If you can just arrange for the phone to follow up, my info is Michelle Carter, 602-555-0138. Email's michelle.carter at email.com.";
const now=Date.parse('2026-10-14T23:23:00Z');
const env={JAMES_DEMO_EMAIL_ENABLED:'true',JAMES_AGENTMAIL_API_KEY:'offline-fake-key-never-used',
    JAMES_AGENTMAIL_ADDRESS:'james-demo@agentmail.to',JAMES_DEMO_REPLY_TO:'aifusionlabs@gmail.com',
    JAMES_DEMO_EMAIL_ACCESS_MODE:'visitor',JAMES_DEMO_EMAIL_DAILY_SEND_LIMIT:'25',
    JAMES_DEMO_EMAIL_BUNDLE:'three',JAMES_DEMO_EMAIL_RECIPIENT_MODE:'owner'};
function base(candidate=true){return {id:'offline-volunteered-name',browserId:'offline',clientLabel:'offline',
    createdAt:'2026-10-14T23:21:15Z',revision:0,stateHash:sha('offline'),personaId:CURRENT_JAMES_PERSONA_ID,
    config:{},state:'ACTIVE',turns:[],intake:emptyIntake(),intakeBrief:{version:2},receipts:[],
    ...(candidate?{websiteClosing:{policy:'JAMES-CLOSE-001',runtimeOwned:true}}:{})};}
function say(s,role,content){return applyTurn(s,{id:'volunteered-'+s.turns.length,role,content});}
function replay(text,prior=question,candidate=true){return say(say(base(candidate),'persona',prior),'user',text);}
function row(s,key){return view(s).intakeBrief.sections.flatMap(section=>section.rows).find(row=>row.key===key);}
function finish(s){
    s=finalizeBrief({...s,state:'CLOSED',closedAt:'2026-10-14T23:22:57Z'});
    s.providerId='offline-provider-no-session-created';
    s.providerTranscript=s.turns.map(turn=>({role:turn.role==='persona'?'agent':'user',content:turn.content}));
    s.providerRelease={startTime:s.createdAt,endTime:s.closedAt,verifiedAt:s.closedAt,transcriptHash:sha(JSON.stringify(s.providerTranscript))};
    s.demoEmail={grantId:'offline',expiresAt:now+60000,sender:env.JAMES_AGENTMAIL_ADDRESS,replyTo:env.JAMES_DEMO_REPLY_TO,
        accessMode:'visitor',bundle:'three',recipientMode:'owner',automaticOwner:true};
    return s;
}
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function assertOutputs(s,name,source){
    const fact=s.intake.facts.findLast(f=>f.field==='visitor_preferred_identifier');
    assert.equal(row(s,'name').value,name);assert.equal(row(s,'name').confirmed,false);
    assert.equal(fact.evidence,name);assert.equal(fact.sourceHash,sha(source));
    assert.equal(s.turns.find(t=>t.id===fact.turnId).content,source);
    assert.ok(s.intake.history.some(f=>f.id===fact.id));
    s=finish(s);
    assert.equal(s.intakeBrief.finalized.sections.flatMap(section=>section.rows).find(row=>row.key==='name').value,name);
    assert.equal(row(s,'name').value,name);
    const before=JSON.stringify(s),messages=prepareDemoMessages(s,now,env);
    assert.equal(JSON.stringify(s),before,'rendering does not mutate the stored session');
    for(const format of ['text','html']){
        const rendered=format==='html'?escape(name):name;
        assert.ok(messages.internal[format].includes(rendered),'firm email retains full caller name');
        assert.ok(messages.caller[format].includes('Thank you, '+(format==='html'?escape(name.split(' ')[0]):name.split(' ')[0])+'.'),'caller recap uses caller’s name');
        assert.ok(messages.admin[format].includes(rendered),'admin record retains full caller name');
        assert.ok(messages.admin[format].includes('Contact name'));
    }
    assert.ok(messages.internal.text.includes('Full name: '+name));
    assert.ok(messages.admin.text.includes('Contact name: '+name));
    assert.equal(messages.internal.to,'aifusionlabs@gmail.com');
    assert.equal(messages.caller.to,'aifusionlabs@gmail.com');
    assert.equal(messages.admin.to,'aifusionlabs@gmail.com');
    return messages;
}

test('observed Michelle turn survives complete offline transcript replay, finalized pad and three emails',t=>{
    t.mock.method(globalThis,'fetch',()=>{throw new Error('No network permitted in name replay');});
    const turns=[['persona',"Hi, this is James with Knowles Law Firm. What's going on today?"],
        ['user',"Hi, I'm really freaked out. I got stopped for a DUI in Phoenix around 10.30. There was no crash, but I'm just panicking about losing my license. I don't know what to do."],
        ['persona','I hear you, and I’m glad you called. I can help organize the basics so the firm has a clear picture, but I can’t provide legal advice. Did the officer cite, arrest, or release you at the scene?'],
        ['user','arrested, processed and released later that night.'],['user',"Everything happened so fast. Sorry, I'm just all over the place."],
        ['persona',question],['user',actual],['user','Thank you and bye.'],
        ['persona','Got it, Michelle. I’ve noted the Phoenix DUI arrest around 10:30, no crash, release that evening, and your contact information. I’ll have the firm follow up with you at the number and email you provided. Take care.'],
        ['user','Thanks, bye.'],['persona','You’re welcome, Michelle. Take care.']];
    let s=base();for(const [role,text]of turns)s=say(s,role,text);
    assertOutputs(s,'Michelle Carter',actual);
    assert.equal(row(s,'phone').value,'602-555-0138');assert.equal(row(s,'email').value,'michelle.carter@email.com');
    assert.equal(s.turns.length,11);
    assert.ok(s.intake.facts.some(f=>f.value.includes('arrested, processed')),'earlier case facts are preserved');
});

for(const [text,name]of [
    ['My info is Avery Stone, 602-555-0138.','Avery Stone'],
    ['My information is Avery Stone. My email is avery@example.test.','Avery Stone'],
    ['My contact info is avery stone 602-555-0138 email is avery@example.test','avery stone'],
    ['My contact information is MORGAN HALE, 602-555-0138.','MORGAN HALE'],
    ['My contact details are Ana-María O’Neill; my phone is 602-555-0138.','Ana-María O’Neill'],
    ['Here are my contact details: José del Río, 602-555-0138.','José del Río'],
    ["I was arrested earlier. My details are Mary O'Neill, 602-555-0138.","Mary O'Neill"],
    ['I was arrested earlier and my info is Avery Stone, 602-555-0138.','Avery Stone'],
    ['My info is Avery Stone, 602-555-0138. I was arrested earlier.','Avery Stone'],
    ['Sorry, I’m in a hurry. For follow-up, my info is Avery Stone, 602-555-0138.','Avery Stone'],
    ['My contact info is Avery Stone, avery@example.test.','Avery Stone'],
])test('volunteered contact variant reaches pad, firm, caller and admin: '+text,()=>{
    const s=replay(text);assertOutputs(s,name,text);
    if(text.includes('arrested earlier'))assert.ok(s.intake.facts.some(f=>f.evidence.includes('arrested earlier')),'mixed-turn case evidence survives');
});

test('a volunteered correction supersedes the old name in all outputs without erasing history',()=>{
    let s=say(base(),'user','My name is Avery Stone.');const old=s.intake.facts.find(f=>f.field==='visitor_preferred_identifier');
    const correction='Actually, my contact details are Jordan Blake, 602-555-0138.';
    s=say(s,'persona',question);s=say(s,'user',correction);
    const messages=assertOutputs(s,'Jordan Blake',correction);
    assert.equal(s.intake.facts.find(f=>f.field==='visitor_preferred_identifier').supersedes,old.id);
    assert.ok(s.intake.history.some(f=>f.id===old.id));
    for(const key of ['caller','internal','admin'])assert.ok(!messages[key].text.includes('Avery Stone'));
});

for(const text of [
    'My info is 602-555-0138.',
    'My info is michelle.carter@example.test.',
    'My contact information is michelle carter at email.com.',
    'His info is Avery Stone, 602-555-0138.',
    'My husband’s contact details are Avery Stone, 602-555-0138.',
    'He said my info is Avery Stone, 602-555-0138.',
    'He said, "my info is Avery Stone, 602-555-0138."',
    "She said, 'my info is Avery Stone, 602-555-0138.'",
    'She said “my contact details are Avery Stone, 602-555-0138.”',
    'If my info is Avery Stone, 602-555-0138, would that work?',
    'Suppose that my info is Avery Stone, 602-555-0138.',
    'Imagine my contact details are Avery Stone, 602-555-0138.',
    'For example, my info is Avery Stone, 602-555-0138.',
    'I would rather not give my info. My phone is 602-555-0138.',
    'My info is Unknown, 602-555-0138.',
    'My info is Not Sure, 602-555-0138.',
    'My info is Avery Stone or Jordan Blake, 602-555-0138.',
    'My info is field tests, 602-555-0138.',
])test('nonidentity/contact-only/ambiguous wording never manufactures a name: '+text,()=>{
    const s=say(say(say(base(),'user','I got stopped for a DUI in Phoenix.'),'persona',question),'user',text);
    assert.equal(row(s,'name').sourceIds.length,0);
    const messages=prepareDemoMessages(finish(s),now,env);
    assert.match(messages.caller.text,/Thank you for speaking with James\./);
    assert.match(messages.internal.text,/Full name: Not yet provided/);
    assert.match(messages.admin.text,/Contact name: Not yet provided/);
});

test('legacy non-candidate intake does not acquire volunteered-contact extraction',()=>{
    const s=replay(actual,question,false);assert.equal(row(s,'name').sourceIds.length,0);
});
