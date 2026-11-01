import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {appendTurn,recordHandoffAttempt,assertProposal,digest,approve} from '../lib/factory/handoff.ts';
import {submitHandoff,toolEvidenceCallbacks,handoffRequestContext} from '../lib/factory/handoff-context.ts';
import {seal,unseal} from '../lib/factory/store.ts';

const retained=JSON.parse(readFileSync(new URL('./fixtures/factory-exact-handoff-binding.json',import.meta.url),'utf8'));
const fresh=()=>({id:'local',version:1,package_sha256:'fixture',persona_id:'persona',launch_label:'fixture:launch',status:'ACTIVE',
    provider_session_id:'provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,
    provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]});
const identity={local_session_id:'local',provider_session_id:'provider',tool_call_id:'call-1'};
const fields=[{id:'request',label:'Requested next step'},{id:'question',label:'Open question'}];
const u=(id,content)=>({id,role:'user',content});
const p=(id,evidence,field='request')=>({field_id:field,visitor_message_id:id,evidence,value:evidence});
const apply=(s,input,call='call-1')=>recordProviderHandoffAttempt(s,input,fields,'request-'+call,{...identity,tool_call_id:call});
function setup(words='Please draft a local summary for owner review.') {
    const s=fresh();appendTurn(s,u('earlier','The connector capability is unknown.'));appendTurn(s,u('request',words));return s;
}
function replayBeforeHandoff() {
    const s=fresh();s.id=retained.local_session_id;s.provider_session_id=retained.provider_session_id;s.launch_label=retained.launch_label;
    const lastQuote=retained.original_attempt.arguments.proposals.at(-1).evidence;
    const index=retained.original_turns.findIndex(t=>t.role==='user'&&t.content===lastQuote);
    assert.ok(index>=0);
    for(const t of retained.original_turns.slice(0,index+1))appendTurn(s,t);
    return s;
}

test('retained raw call replays to eight pending proposals with two audited exact references; historical record unchanged',()=>{
    const original=JSON.stringify(retained),s=replayBeforeHandoff(),turns=JSON.stringify(s.turns),raw=retained.original_attempt.arguments.proposals;
    // The old strict path still rejects the original ID mismatch.
    const old=structuredClone(s);assert.equal(recordHandoffAttempt(old,raw,retained.fields,'old').accepted,false);
    assert.equal(old.proposals.length,0);assert.deepEqual(old.quarantined_proposals[0].proposals,raw);
    const result=recordProviderHandoffAttempt(s,raw,retained.fields,'offline-replay',{
        local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:retained.original_attempt.toolCallId});
    assert.equal(result.accepted,true);assert.equal(result.status,'PENDING_OWNER_REVIEW');assert.equal(s.proposals.length,8);
    assert.deepEqual(result.reference_bindings.map(b=>b.index),[6,7]);
    for(const binding of result.reference_bindings) {
        const target=s.turns.find(t=>t.id===binding.to_message_id),quote=raw[binding.index].evidence;
        assert.equal(target.content.slice(binding.start,binding.end),quote);assert.equal(binding.source_sha256,digest(target));
        assert.equal(binding.from_message_id,raw[binding.index].visitor_message_id);
    }
    for(const {id,...proposal} of s.proposals){assert.equal(id,digest(proposal));assertProposal(proposal,s.turns,retained.fields);}
    assert.deepEqual(s.handoff_binding_attempts[0].original_proposals,raw);
    assert.equal(s.handoff_requests.length,1);assert.equal(s.receipts.filter(r=>r.kind==='HANDOFF_REQUESTED').length,1);
    assert.equal(s.receipts.filter(r=>r.kind==='HANDOFF_REFERENCE_BINDING').length,1);
    assert.match(handoffRequestContext(s,s.turns.at(-1)),/Do not automatically repeat/);
    assert.equal(JSON.stringify(s.turns),turns);assert.equal(JSON.stringify(retained),original);
    assert.equal(s.approved,false);assert.equal(s.evidence_reviewed,false);assert.deepEqual(s.external_actions,[]);assert.throws(()=>approve(s));
    const reloaded=unseal(seal(s,'fictional-test-key-with-at-least-32-characters'),'fictional-test-key-with-at-least-32-characters');
    assert.deepEqual(reloaded,s);assert.equal(reloaded.provider_release_verified,false);assert.equal(reloaded.provider_transcript_verified,false);
});

test('independently worded quotes bind exactly, including punctuation and Unicode, without altering text',()=>{
    for(const text of ['Please create a concise owner-review note.',
        'Could you draft an unsent summary of our constraints?',
        'Our team needs a human assessment — not a meeting.',
        'The account is café-42; the connector is unknown.']) {
        const s=setup('Context first. '+text+' Keep this unsent.'),original=JSON.stringify(s.turns);
        const result=apply(s,[p('earlier',text)]);assert.equal(result.accepted,true,text);
        assert.equal(s.proposals[0].evidence,text);assert.equal(s.proposals[0].value,text);
        assert.equal(s.proposals[0].visitor_message_id,'request');assert.equal(result.reference_bindings[0].start,15);
        assert.equal(JSON.stringify(s.turns),original);
    }
});

test('valid supplied references stay exact even when identical evidence occurs elsewhere',()=>{
    const s=setup('Same supplied words.');appendTurn(s,u('duplicate','Same supplied words.'));
    const raw=p('request','Same supplied words.');const result=apply(s,[raw]);
    assert.equal(result.accepted,true);assert.equal(result.reference_bindings,undefined);
    assert.equal(s.proposals[0].visitor_message_id,'request');assert.deepEqual(s.handoff_binding_attempts[0].bindings,[]);
});

test('ambiguous turns or occurrences reject instead of choosing first or latest',()=>{
    for(const repeatedInOne of [false,true]) {
        const s=setup(repeatedInOne?'Same supplied words. Same supplied words.':'Same supplied words.');
        if(!repeatedInOne)appendTurn(s,u('duplicate','Same supplied words.'));
        const result=apply(s,[p('earlier','Same supplied words.')]);assert.equal(result.accepted,false);
        assert.equal(s.proposals.length,0);assert.equal(s.handoff_binding_attempts[0].bindings.length,0);
    }
});

test('unknown, foreign, assistant, malformed, paraphrased, changed or oversized evidence remains rejected',()=>{
    const text='Please draft a local summary for owner review.';
    const invalid=[p('missing',text),p('other-session-user',text),p('persona',text),
        {...p('earlier',text),field_id:'invented'}, {...p('earlier',text),value:'Approved and sent.'},
        p('earlier','Please DRAFT a local summary for owner review.'),p('earlier','Draft a summary for review.'),
        p('earlier',''),p('earlier','x'.repeat(4001)),{...p('earlier',text),extra:true},null];
    for(const raw of invalid) {
        const s=setup();appendTurn(s,{id:'persona',role:'persona',content:text});
        const result=apply(s,[raw]);assert.equal(result.accepted,false,JSON.stringify(raw));
        assert.equal(s.proposals.length,0);assert.deepEqual(s.handoff_binding_attempts[0].original_proposals,[raw]);
        assert.deepEqual(s.quarantined_proposals[0].proposals,[raw]);
    }
    for(const input of [[],{},null,Array(25).fill(p('earlier',text))]) {
        const s=setup();assert.equal(apply(s,input).accepted,false);assert.equal(s.proposals.length,0);
    }
});

test('no normalization, concatenation, assistant lookup or provider-history scan can supply missing evidence',()=>{
    for(const raw of ['Please  prepare an unsent brief.','Please prepare an unsent brief!',
        'Please prepare an unsent brief. We need review.','Only in provider history.','Assistant-only words.']) {
        const s=setup('Please prepare an unsent brief.');appendTurn(s,u('next','We need review.'));
        appendTurn(s,{id:'p',role:'persona',content:'Assistant-only words.'});
        s.provider_evidence={transcript:{messages:[{role:'user',message:'Only in provider history.'}]}};
        assert.equal(apply(s,[p('earlier',raw)]).accepted,false,raw);assert.equal(s.proposals.length,0);
    }
});

test('mixed invalid batch remains atomic with original input and attempted binding audit retained',()=>{
    const s=setup(),old={request_id:'historical',proposals:[{verbatim:'old rejected input'}],reason:'retained'};
    s.quarantined_proposals=[structuredClone(old)];
    const raw=[p('earlier',s.turns[1].content),{...p('earlier','The connector capability is unknown.'),value:'It is supported.'}];
    const result=apply(s,raw);assert.equal(result.accepted,false);assert.equal(s.proposals.length,0);
    assert.deepEqual(s.quarantined_proposals[0],old);assert.deepEqual(s.quarantined_proposals[1].proposals,raw);
    assert.deepEqual(s.handoff_binding_attempts[0].original_proposals,raw);assert.equal(s.handoff_binding_attempts[0].bindings.length,1);
    assert.equal(s.handoff_binding_attempts[0].applied,false);assert.equal(result.reference_bindings,undefined);
    assert.match(result.visitor_message,/could not prepare/);assert.match(result.instruction,/Do not retry/);
});

test('correction and uncertainty remain original separate evidence; rebinding confers no factual or owner acceptance',()=>{
    const s=setup('There are seven operators.');appendTurn(s,u('correction','Actually there are five, not seven.'));
    appendTurn(s,u('unknown','The connector capability is unknown.'));
    const turns=JSON.stringify(s.turns),result=apply(s,[p('earlier','There are seven operators.'),p('request','Actually there are five, not seven.')]);
    assert.equal(result.accepted,true);assert.equal(s.proposals.length,2);assert.equal(s.decisions.length,0);
    assert.equal(s.proposals[0].visitor_message_id,'request');assert.equal(s.proposals[1].visitor_message_id,'correction');
    assert.equal(s.approved,false);assert.equal(JSON.stringify(s.turns),turns);assert.deepEqual(result.external_actions,[]);
});

test('session mismatch rejects before mutation, duplicates replay one receipt, altered repeated input cannot rebind',()=>{
    for(const bad of [{...identity,local_session_id:'other'},{...identity,provider_session_id:'other'},
        {...identity,tool_call_id:''},{...identity,tool_call_id:123},{...identity,tool_call_id:'invalid/id'},null]) {
        const s=setup(),before=JSON.stringify(s);
        assert.throws(()=>recordProviderHandoffAttempt(s,[p('earlier',s.turns[1].content)],fields,'r',bad),/exact local and provider/);
        assert.equal(JSON.stringify(s),before);
    }
    const s=setup(),raw=[p('earlier',s.turns[1].content)],result=apply(s,raw),saved=JSON.stringify(s);
    assert.deepEqual(apply(s,raw),result);assert.equal(JSON.stringify(s),saved);
    assert.throws(()=>apply(s,[p('request',s.turns[1].content)]),/immutable/);assert.equal(JSON.stringify(s),saved);
    const failed=setup(),missing=[p('earlier','Later evidence.')];assert.equal(apply(failed,missing).accepted,false);
    appendTurn(failed,u('later','Later evidence.'));
    assert.equal(apply(failed,missing).accepted,false);assert.equal(failed.proposals.length,0);assert.equal(failed.handoff_binding_attempts.length,1);
});

test('strict manual path is unchanged and closure without a retained request stays blocked',()=>{
    const s=setup(),raw=[p('earlier',s.turns[1].content)];assert.throws(()=>assertProposal(raw[0],s.turns,fields));
    assert.equal(recordHandoffAttempt(s,raw,fields,'manual').accepted,false);assert.equal(s.handoff_binding_attempts,undefined);
    const closing=setup('Our desired outcome is a human assessment.');appendTurn(closing,u('bye','Goodbye.'));
    assert.equal(closing.status,'CLOSING_PENDING');assert.equal(apply(closing,[p('earlier',closing.turns[1].content)]).accepted,false);
    assert.equal(closing.proposals.length,0);assert.equal(closing.provider_release_verified,false);
});

test('input and returned-result mutation cannot rewrite retained provenance; lifecycle rejection keeps raw input',()=>{
    const s=setup(),raw=[p('earlier',s.turns[1].content)],result=apply(s,raw),saved=JSON.stringify(s);
    raw[0].evidence='Changed by caller.';result.reference_bindings[0].to_message_id='changed';result.accepted=false;
    assert.equal(JSON.stringify(s),saved);
    const reserved=setup();reserved.status='RESERVED';const invalid=[p('earlier',reserved.turns[1].content)];
    assert.equal(apply(reserved,invalid).accepted,false);assert.deepEqual(reserved.quarantined_proposals[0].proposals,invalid);
    assert.equal(reserved.handoff_binding_attempts[0].applied,false);assert.equal(reserved.proposals.length,0);
});

const require=createRequire(import.meta.url);
const {ToolCallManager}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/ToolCallManager.js');
const {PublicEventEmitter}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/PublicEventEmitter.js');
const {InternalEventEmitter}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/InternalEventEmitter.js');
const {InternalEvent}=require('../node_modules/@anam-ai/js-sdk/dist/main/types/index.js');
test('installed SDK passes session/call identity and returns only committed audited pending result with no retry',async()=>{
    const s=setup(),delivered=[];
    const inside=new InternalEventEmitter(),m=new ToolCallManager(new PublicEventEmitter(),inside);
    m.setActiveSession('provider');inside.addListener(InternalEvent.TOOL_CALL_RESULT_READY,e=>delivered.push(e));
    let commits=0;
    m.registerHandler('factory_handoff',{...toolEvidenceCallbacks(async()=>{},assert.fail),onStart:event=>
        submitHandoff(event.arguments.proposals,async proposals=>{commits++;return recordProviderHandoffAttempt(s,proposals,fields,'sdk',{
            local_session_id:s.id,provider_session_id:event.sessionId,tool_call_id:event.toolCallId});})});
    await m.processToolCallStartedEvent({session_id:'provider',tool_call_id:'call-sdk',tool_name:'factory_handoff',tool_type:'client',
        arguments:{proposals:[p('earlier',s.turns[1].content)]},timestamp:new Date().toISOString()});
    assert.equal(commits,1);assert.equal(delivered.length,1);assert.equal(JSON.parse(delivered[0].result).accepted,true);
    assert.equal(JSON.parse(delivered[0].result).reference_bindings.length,1);assert.equal(JSON.parse(delivered[0].result).status,'PENDING_OWNER_REVIEW');
    assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});
