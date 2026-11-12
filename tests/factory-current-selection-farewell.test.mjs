import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import * as handoff from '../lib/factory/handoff.ts';
import * as fragments from '../lib/factory/handoff-fragments.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {selectCurrentProposals} from '../lib/factory/handoff-current.ts';
import {exitReplyObserver,exitReceipt} from '../lib/factory/exit-receipt.ts';
import {collectionReferenceContext} from '../lib/factory/handoff-context.ts';

const path=new URL('../../HERMES_X_FACTORY/verification/olivia-current-handoff-owner-voice-qa-v0.1/review/saved-session-response.json',import.meta.url);
const bytes=readFileSync(path),saved=JSON.parse(bytes),fields=saved.manifest.configured_fields;
const captured=saved.state.handoff_binding_attempts[0];
const request=captured.original_proposals.at(-1).evidence;
const identity=s=>({local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:'offline-selection'});
function replay(){
 const s=structuredClone(saved.state);
 Object.assign(s,{status:'ACTIVE',turns:[],proposals:[],decisions:[],receipts:[],processed:[],handoff_binding_attempts:[],quarantined_proposals:[],tool_events:[],handoff_requests:[],visitor_exit:undefined,closing_after_turn_id:undefined,provider_release_verified:false,provider_transcript_verified:false});
 for(const t of saved.state.turns){handoff.appendTurn(s,t);if(t.role==='user'&&t.content===request)break;}
 return s;
}
const require=createRequire(import.meta.url),ts=require('typescript'),old={exports:{}};
const oldSource=execFileSync('git',['show','9dfb5c88bb5a348336cdd16faa2c1ff60f482037:lib/factory/handoff-binding.ts'],{encoding:'utf8'});
new Function('require','exports','module',ts.transpileModule(oldSource,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(
 name=>name==='./handoff.ts'?handoff:name==='./handoff-fragments.ts'?fragments:assert.fail(name),old.exports,old);

test('retained nonnumeric compound call stays blocked rather than deleting unrelated history',()=>{
 const before=replay(),after=replay(),raw=structuredClone(captured.original_proposals),turnHash=handoff.digest(after.turns);
 const rejected=old.exports.recordProviderHandoffAttempt(before,raw,fields,'offline-before',identity(before));
 assert.equal(rejected.accepted,false);assert.deepEqual(rejected.issues,captured.result.issues);
 const result=recordProviderHandoffAttempt(after,raw,fields,'offline-after',identity(after));
 assert.equal(result.accepted,false);assert.equal(result.accepted_proposal_count,0);assert.equal(after.proposals.length,0);
 assert.ok(result.issues.some(row=>row.problems.includes('LATER_EXPLICIT_CORRECTION_REQUIRES_CURRENT_EVIDENCE')));
 const audit=after.handoff_binding_attempts[0];assert.deepEqual(audit.original_proposals,raw);
 assert.deepEqual(after.quarantined_proposals[0].proposals,raw);assert.deepEqual(audit.superseded_proposals,[]);
 assert.deepEqual(audit.current_fact_selections,[]);assert.equal(audit.bindings.length,1);
 assert.equal(handoff.digest(after.turns),turnHash);assert.equal(after.approved,false);assert.deepEqual(after.external_actions,[]);
 assert.deepEqual(readFileSync(path),bytes);
 const once=handoff.digest(after);assert.deepEqual(recordProviderHandoffAttempt(after,raw,fields,'same-call',identity(after)),result);assert.equal(handoff.digest(after),once);
 assert.throws(()=>recordProviderHandoffAttempt(after,raw.slice(1),fields,'changed',identity(after)),/immutable/);
});

test('constructed exact nonnumeric spans preserve the unaffected fact and supplied correction separately',()=>{
 const s=replay(),raw=structuredClone(captured.original_proposals),original=JSON.stringify(raw);
 // Offline test-selected input, not a provider reply: isolate the unchanged
 // first sentence rather than replacing the whole compound quotation.
 const first=raw[0].evidence.slice(0,raw[0].evidence.indexOf('.')+1);
 raw[0]={...raw[0],evidence:first,value:first};
 const result=recordProviderHandoffAttempt(s,raw,fields,'constructed-only',identity(s));
 assert.equal(result.accepted,true);assert.equal(s.proposals.length,6);
 assert.ok(s.proposals.some(p=>p.value===first));assert.ok(s.proposals.some(p=>p.value===raw[1].value));
 for(const p of s.proposals){const {id,...proposal}=p;assert.equal(id,handoff.digest(proposal));handoff.assertProposal(proposal,s.turns,fields);}
 assert.equal(JSON.stringify(captured.original_proposals),original);assert.deepEqual(readFileSync(path),bytes);
 assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});

test('absent, cross-field, partial, duplicate or invalid correction cannot silently remove the old fact',()=>{
 for(const mode of ['absent','other-field','partial','duplicate','invalid']){
  const s=replay(),p=structuredClone(captured.original_proposals);
  if(mode==='absent')p.splice(1,1);
  if(mode==='other-field')p[1].field_id=fields.find(f=>f.id!==p[1].field_id).id;
  if(mode==='partial')p[1].value=p[1].evidence='not the shared mailbox.';
  if(mode==='duplicate')p.push(structuredClone(p[1]));
  if(mode==='invalid')p[1].value='Invented correction';
  assert.equal(recordProviderHandoffAttempt(s,p,fields,mode,identity(s)).accepted,false,mode);assert.equal(s.proposals.length,0);
 }
});

test('a separate invalid field still rejects the entire selected batch and preserves raw payload',()=>{
 const s=replay(),p=structuredClone(captured.original_proposals);p[2].field_id='invented-field';
 const r=recordProviderHandoffAttempt(s,p,fields,'bad-field',identity(s));assert.equal(r.accepted,false);
 assert.equal(s.proposals.length,0);assert.deepEqual(s.quarantined_proposals[0].proposals,p);assert.equal(s.handoff_binding_attempts[0].applied,false);
});

test('independent roles and unrelated exact fields survive; never use generic latest-wins',()=>{
 for(const [oldFact,correction] of [
  ['We use a paper ledger.','Actually, we use a digital register, not a paper ledger.'],
  ['The shipping destination is Cedar Avenue.','Correction: the destination is Pine Street, not Cedar Avenue.'],
 ]){
  const turns=[{id:'old',role:'user',content:oldFact},{id:'other',role:'user',content:'Budget is unknown.'},{id:'new',role:'user',content:correction}];
  const f=[{id:'subject',label:'Subject'},{id:'budget',label:'Budget'}];
  const p=turns.map(t=>({field_id:t.id==='other'?'budget':'subject',visitor_message_id:t.id,evidence:t.content,value:t.content}));
  const r=selectCurrentProposals(p,turns,f);assert.deepEqual(r.selected,[p[1],p[2]]);assert.equal(r.superseded.length,1);
  const unrelated=[...turns.slice(0,2),{id:'third',role:'user',content:'The back office has a second register.'}];
  const q=unrelated.map(t=>({field_id:'subject',visitor_message_id:t.id,evidence:t.content,value:t.content}));
  assert.deepEqual(selectCurrentProposals(q,unrelated,f).selected,q);
 }
});

test('quoted or ambiguous corrections are not promoted; strict manual validation still rejects stale evidence',()=>{
 const s=replay(),raw=structuredClone(captured.original_proposals);
 assert.throws(()=>handoff.assertProposal(raw[0],s.turns,fields));
 const correction=s.turns.find(t=>t.id===raw[1].visitor_message_id);correction.content='The supplier said "'+correction.content+'"';
 raw[1].value=raw[1].evidence=correction.content;
 assert.equal(selectCurrentProposals(raw,s.turns,fields).superseded.length,0);
});

test('saved double farewell is two clauses in one reply; observation changes receipt, not historical transcript',()=>{
 const last=saved.state.turns.at(-1);assert.equal(last.role,'persona');
 assert.match(last.content,/I'll close the session now/);assert.match(last.content,/You're welcome, Jordan\. Goodbye/);
 const correlation=last.id.slice('persona::'.length),o=exitReplyObserver();
 // Simulated arrival of the captured pre-tool clause, NOT a claim that its
 // historical browser arrival time was retained in this session.
 o.observe({...last,content:last.content.split('\n')[0]});
 const r=exitReceipt(o.receipt(correlation));assert.equal(r.reply_observation.reply_state,'TEXT_ALREADY_OBSERVED');
 assert.match(r.instruction,/Do not start another farewell/);assert.doesNotMatch(r.instruction,/say one short farewell/);
 assert.deepEqual(readFileSync(path),bytes);
});

test('fresh tool-first sequence permits only one farewell; later tool calls never invite another',()=>{
 const o=exitReplyObserver();const first=exitReceipt(o.receipt('new-exit'));
 assert.equal(first.reply_observation.reply_state,'NOT_OBSERVED');assert.match(first.instruction,/one short farewell only/);
 const again=exitReceipt(o.receipt('new-exit'));assert.equal(again.reply_observation.receipt_already_issued,true);
 assert.match(again.instruction,/Do not start another farewell/);
 assert.match(collectionReferenceContext([]),/silently call factory_end_session BEFORE closing speech/);
});

test('prior replies, visitor quotes and empty chunks cannot masquerade as current generated closing speech',()=>{
 const o=exitReplyObserver();o.observe({id:'persona::old',role:'persona',content:'Goodbye.'});
 o.observe({id:'persona::current',role:'user',content:'Goodbye.'});o.observe({id:'persona::current',role:'persona',content:''});
 assert.equal(o.receipt('current').reply_state,'NOT_OBSERVED');assert.equal(o.receipt().reply_state,'UNKNOWN');
 assert.match(exitReceipt(o.receipt()).instruction,/Do not start another farewell/);
 assert.equal(exitReplyObserver().receipt('old').reply_state,'NOT_OBSERVED');
});

test('runtime wires incremental and finalized reply observations to the exact tool correlation',()=>{
 const src=readFileSync(new URL('../components/factory/FactoryPilot.tsx',import.meta.url),'utf8');
 assert.ok(src.includes('if(!recovery.isHeldOrRecoveryReply(e.id))exitReplies.observe(e)'));
 assert.ok(src.includes('messages.forEach(m=>{if(!recovery.isHeldOrRecoveryReply(m.id))exitReplies.observe(m);})'));
 assert.ok(src.includes('if(!failureSpeech.current?.isHeldOrRecoveryReply(turn.id))farewell.current?.completeFarewell()'));
 assert.ok(src.includes('exitReplies.receipt(p.userActionCorrelationId)'));
 assert.equal((src.match(/\.stopStreaming\(/g)||[]).length,1);assert.ok(src.includes('await reconcile()'));
 const end=src.slice(src.indexOf("c.registerToolCallHandler('factory_end_session'"),src.indexOf('c.addListener(AnamEvent.CONNECTION_CLOSED'));
 assert.ok(!end.includes('addContext'));assert.ok(!end.includes('sendUserMessage'));
});

test('installed SDK exposes one correlated receipt without issuing another speech/context request',async()=>{
 const {ToolCallManager}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/ToolCallManager.js');
 const {PublicEventEmitter}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/PublicEventEmitter.js');
 const {InternalEventEmitter}=require('../node_modules/@anam-ai/js-sdk/dist/main/modules/InternalEventEmitter.js');
 const {InternalEvent}=require('../node_modules/@anam-ai/js-sdk/dist/main/types/index.js');
 const inside=new InternalEventEmitter(),manager=new ToolCallManager(new PublicEventEmitter(),inside),wire=[];
 const observer=exitReplyObserver();observer.observe({id:'persona::exit-turn',role:'persona',content:'Have a pleasant evening.'});
 inside.addListener(InternalEvent.TOOL_CALL_RESULT_READY,p=>wire.push(p));manager.setActiveSession('fixture');
 manager.registerHandler('factory_end_session',{onStart:async p=>JSON.stringify(exitReceipt(observer.receipt(p.userActionCorrelationId)))});
 await manager.processToolCallStartedEvent({session_id:'fixture',tool_call_id:'end-once',tool_name:'factory_end_session',tool_type:'client',arguments:{},user_action_correlation_id:'exit-turn',timestamp:new Date().toISOString()});
 assert.equal(wire.length,1);const result=JSON.parse(wire[0].result);
 assert.equal(result.reply_observation.reply_state,'TEXT_ALREADY_OBSERVED');assert.match(result.instruction,/Do not start another farewell/);
});
