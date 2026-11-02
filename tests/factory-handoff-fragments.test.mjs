import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {assertProposal,digest,approve} from '../lib/factory/handoff.ts';
import {exitReceipt} from '../lib/factory/exit-receipt.ts';
import {committedTurnEffects} from '../lib/factory/turn-effects.ts';
const require=createRequire(new URL('../lib/factory/handoff-binding.ts',import.meta.url));
const ts=require('typescript');
const oldSource=execFileSync('git',['show','06694d8f93cd1f06e1e30bb5bcadc73824f16b07:lib/factory/handoff-binding.ts'],{encoding:'utf8'});
const oldModule={exports:{}};
new Function('require','exports','module',ts.transpileModule(oldSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,oldModule.exports,oldModule);
const retained=JSON.parse(readFileSync(new URL('./fixtures/factory-handoff-speech-fragments.json',import.meta.url),'utf8'));
const u=(id,content)=>({id:'user::'+id,role:'user',content});
const fresh=turns=>({id:'local',version:1,package_sha256:'fixture',persona_id:'persona',launch_label:'fixture',status:'ACTIVE',provider_session_id:'provider',turns,proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]});
const fields=[{id:'fact',label:'Visitor facts'}];
const p=(words,id='user::a')=>({field_id:'fact',visitor_message_id:id,evidence:words,value:words});
const identity={local_session_id:'local',provider_session_id:'provider',tool_call_id:'call'};
const run=(s,rows)=>recordProviderHandoffAttempt(s,rows,fields,'request',identity);

test('retained failing payload: old binding rejects; exact fragment projection yields eight pending rows with immutable source',()=>{
 const s=fresh(structuredClone(retained.turns)),raw=retained.call.arguments.proposals,original=JSON.stringify(s.turns);
 const before=oldModule.exports.recordProviderHandoffAttempt(structuredClone(s),raw,retained.fields,'before',identity);
 assert.equal(before.accepted,false);
 const result=recordProviderHandoffAttempt(s,raw,retained.fields,'after',identity);
 assert.equal(result.accepted,true);assert.equal(s.proposals.length,8);
 assert.deepEqual(result.fragment_bindings.map(b=>b.index),[0,1]);assert.equal(result.reference_bindings[0].index,4);
 for(const {id,...row} of s.proposals){assertProposal(row,s.turns,retained.fields);assert.equal(id,digest(row));}
 for(const b of result.fragment_bindings){
  const text=b.segments.map(seg=>{const t=s.turns.find(t=>t.id===seg.message_id);assert.equal(digest(t),seg.source_sha256);return t.content.slice(seg.start,seg.end);}).join(' ');
  assert.equal(text,raw[b.index].evidence);
 }
 assert.equal(JSON.stringify(s.turns),original);assert.deepEqual(s.handoff_binding_attempts[0].original_proposals,raw);
 assert.equal(s.approved,false);assert.throws(()=>approve(s));assert.deepEqual(s.external_actions,[]);
 const saved=JSON.stringify(s);
 assert.deepEqual(recordProviderHandoffAttempt(s,raw,retained.fields,'duplicate',identity),result);assert.equal(JSON.stringify(s),saved);
 assert.deepEqual(JSON.parse(saved).handoff_binding_attempts,s.handoff_binding_attempts);
});

test('independent paraphrases retain uncertainty and corrections in exact separate rows',()=>{
 for(const fragments of [
  ['We process orders manually.','The approval volume is unknown.'],
  ['The location was Mesa.','Actually, it was Tempe.'],
  ['Four people handle returns','and a fifth checks them.'],
  ['Use café-42 —','only for internal review.']
 ]){
  const turns=fragments.map((x,i)=>u(i?'b':'a',x)),s=fresh(turns),raw=p(fragments.join(' '));
  assert.equal(run(s,[raw]).accepted,true);
  assert.deepEqual(s.proposals.map(x=>x.evidence),fragments);
  assert.deepEqual(s.turns,turns);assert.equal(s.decisions.length,0);
 }
});

test('fragment projection rejects normalization, partial spans, skipped or assistant turns, wrong anchors, synthetic IDs and forged values',()=>{
 const words=['The order is pending.','The amount is unknown.'];
 const cases=[
  {turns:[u('a',words[0]),u('b',words[1])],row:p(words.join('  '))},
  {turns:[u('a',words[0]),u('b',words[1])],row:p('order is pending. '+words[1])},
  {turns:[u('a',words[0]),u('b',words[1])],row:p(words.join(' ').replace('unknown.','known.'))},
  {turns:[u('a',words[0]),{id:'p',role:'persona',content:'Response.'},u('b',words[1])],row:p(words.join(' '))},
  {turns:[u('a',words[0]),u('skip','Do not omit this.'),u('b',words[1])],row:p(words.join(' '))},
  {turns:[u('earlier','Earlier context.'),u('a',words[0]),u('b',words[1])],row:p(words.join(' '),'user::earlier')},
  {turns:[{id:'typed-visitor::a',role:'user',content:words[0]},u('b',words[1])],row:p(words.join(' '),'typed-visitor::a')},
  {turns:[u('a',words[0]),u('b',words[1])],row:{...p(words.join(' ')),value:'Approved.'}},
  {turns:[u('a',words[0]),u('b',words[1])],row:{...p(words.join(' ')),field_id:'foreign'}},
 ];
 for(const {turns,row} of cases){const s=fresh(turns);assert.equal(run(s,[row]).accepted,false,JSON.stringify(row));assert.equal(s.proposals.length,0);}
});

test('mixed invalid and excessive expansion reject atomically; raw inputs retained',()=>{
 const s=fresh([u('a','One.'),u('b','Two.')]),raw=[p('One. Two.'),p('Invented.')];
 assert.equal(run(s,raw).accepted,false);assert.equal(s.proposals.length,0);
 assert.deepEqual(s.quarantined_proposals[0].proposals,raw);assert.equal(s.handoff_binding_attempts[0].fragment_bindings.length,1);
 const many=fresh(Array.from({length:8},(_,i)=>u(i?'n'+i:'a','Part '+i+'.')));
 const quote=many.turns.map(t=>t.content).join(' '),input=Array(4).fill(p(quote));
 assert.equal(run(many,input).accepted,false);assert.equal(many.proposals.length,0);
});

test('strict validator still rejects combined source; projection never creates a source turn',()=>{
 const s=fresh([u('a','One.'),u('b','Two.')]),raw=p('One. Two.');
 assert.throws(()=>assertProposal(raw,s.turns,fields));assert.equal(run(s,[raw]).accepted,true);
 assert.throws(()=>assertProposal(raw,s.turns,fields));assert.equal(s.turns.length,2);
});

test('farewell receipt and host status no longer request another spoken farewell; close still armed',()=>{
 const t=u('bye','Goodbye.'),s=fresh([t]);s.status='CLOSING_PENDING';s.closing_after_turn_id=t.id;
 let armed=0,finished=0;const messages=[];
 const effects={armClose(){armed++;},finalReply(){finished++;},context:x=>messages.push(x),contextFailure:assert.fail};
 committedTurnEffects(s,t,effects);
 assert.equal(armed,1);assert.match(messages.at(-1),/not a request for another spoken reply/);
 assert.doesNotMatch(messages.at(-1),/Give one/);
 const receipt=exitReceipt();assert.equal(receipt.status,'CLOSING_PENDING');assert.match(receipt.instruction,/Do not start another farewell/);
 const last={id:'p',role:'persona',content:"You're welcome."};s.turns.push(last);committedTurnEffects(s,last,effects);
 assert.equal(finished,1);assert.equal(s.provider_release_verified,false);assert.equal(s.status,'CLOSING_PENDING');
 const source=readFileSync(new URL('../components/factory/FactoryPilot.tsx',import.meta.url),'utf8');
 assert.ok(source.includes('JSON.stringify(exitReceipt(exitReplies.receipt(p.userActionCorrelationId)))'));assert.ok(!source.includes("status:'FAREWELL_REQUIRED'"));
});
