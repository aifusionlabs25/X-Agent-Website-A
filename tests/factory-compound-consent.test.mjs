import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestedHandoffSpan} from '../lib/factory/handoff-request.ts';
import {appendTurn,assertProposal} from '../lib/factory/handoff.ts';
import {recordProviderHandoffAttempt} from '../lib/factory/handoff-binding.ts';
import {handoffOutputGate} from '../lib/factory/handoff-output-gate.ts';

const retained=JSON.parse(readFileSync(new URL('./fixtures/factory-compound-consent-20261112.json',import.meta.url),'utf8'));
const user=(id,content)=>({id,role:'user',content});
const offer={id:'offer',role:'persona',content:'We can retain your stated constraints. Would you like me to prepare a local note for owner review?'};
const fresh=()=>({id:'local',version:1,package_sha256:'fixture',persona_id:'persona',launch_label:'fictional',status:'ACTIVE',provider_session_id:'provider',turns:[],proposals:[],decisions:[],receipts:[],processed:[],provider_release_verified:false,provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]});

test('retained compound consent binds both accepted proposals and the media receipt without changing original evidence',()=>{
 const original=JSON.stringify(retained),s=fresh();
 s.id=retained.local_session_id;s.provider_session_id=retained.provider_session_id;s.launch_label=retained.launch_label;
 const turns=retained.turns,last=turns.at(-1),events=[];
 for(const t of turns.slice(0,-1))appendTurn(s,t);
 const gate=handoffOutputGate({localSessionId:s.id,providerSessionId:()=>s.provider_session_id,output:()=>{},notice:()=>{},report:e=>events.push(e)});
 gate.committed(s);gate.visitor(last);appendTurn(s,last);gate.committed(s);
 const tool=retained.attempt.tool_call_id;gate.handoffStarted(s.provider_session_id,tool);
 const result=recordProviderHandoffAttempt(s,retained.attempt.original_proposals,retained.fields,'offline-compound-consent',{local_session_id:s.id,provider_session_id:s.provider_session_id,tool_call_id:tool});
 gate.committed(s);
 assert.equal(result.accepted,true);assert.equal(result.accepted_proposal_count,7);
 assert.equal(s.handoff_requests.length,1);assert.equal(s.handoff_requests[0].evidence,'Yes, I would, please.');
 assert.equal(s.handoff_requests[0].offer_turn_id,turns.at(-2).id);
 assert.equal(s.handoff_binding_attempts[0].request_turn_id,last.id);
 assert.equal(gate.snapshot().accepted,true);assert.equal(gate.snapshot().settled,true);
 assert.equal(events.at(-1).phase,'VERIFIED_RECEIPT');assert.equal(events.at(-1).muted,false);
 for(const {id,...p} of s.proposals)assertProposal(p,s.turns,retained.fields);
 assert.deepEqual(s.turns,turns);assert.equal(JSON.stringify(retained),original);
 assert.equal(s.approved,false);assert.deepEqual(s.external_actions,[]);
});

test('independent natural affirmative clauses retain original offsets and accompanying facts',()=>{
 for(const [raw,expected] of [
  ['  Yes, I would, please. And uh, let me know when you are ready.','Yes, I would, please.'],
  ['Absolutely, please. Our team uses a shared inbox.','Absolutely, please.'],
  ["Sure, go ahead; we don't know the budget.",'Sure, go ahead'],
  ['Yes, I would, and we have three branches.','Yes, I would'],
  ['Yep, please do and keep the technical question open.','Yep, please do'],
  ['Yes, please. No emails or calls.','Yes, please.'],
  ["Yes, please. Don't send anything.",'Yes, please.'],
  ['Please do. Is a portal integration supported?','Please do.'],
 ]) {
  const r=requestedHandoffSpan(raw,{precedingTurn:offer});assert.ok(r,raw);
  assert.equal(r.evidence,expected);assert.equal(raw.slice(r.start,r.end),expected);
  assert.equal(r.offer_turn_id,offer.id);assert.equal(r.offer_evidence,offer.content);
  const s=fresh();appendTurn(s,offer);appendTurn(s,user('answer',raw));
  assert.equal(s.handoff_requests[0].evidence,expected);assert.equal(s.turns.at(-1).content,raw);
 }
});

test('compound consent cannot gain authority across retraction, conditions, delivery or a different question',()=>{
 for(const raw of [
  'Yes, please. Actually, no.', 'Yes, I would, but not now.',
  'Yes, please. Actually no, thanks.', 'Yes, please. Maybe later.',
  'Yes, please. I changed my mind.', 'Yes, please. Not anymore.',
  'Yes, please. Provided that my manager agrees.', 'Yes, please. As long as the owner approves.',
  'Yes, please; subject to the board agreeing.', 'Yes, please. Providing that I consent later.',
  'Yes, please; only if my supervisor approves.', 'Yes, please. After I approve it.',
  'Yes, please. When I confirm, start.', 'Yes, please and send it to my customer.',
  'Yes, please. Could you email it to me?', 'Yes, please and call me today.',
  'Yes, please. Schedule a meeting.', 'Yes, please. I prefer tomorrow, then deliver the summary.',
  'Absolutely, please. Email it to me.', 'Yes, please. Do not prepare it.',
  "Yes, please. I don't want that after all.", 'Yes, please. Wait until tomorrow.',
  'Yes, but please cancel preparing the summary.', 'My colleague said yes, please.',
  '"Yes, I would, please." And keep the details.', 'If we go ahead, yes, please.',
 ]) assert.equal(requestedHandoffSpan(raw,{precedingTurn:offer}),null,raw);
 for(const precedingTurn of [undefined,user('other','Would you like a note?'),
  {...offer,content:'Is this your contact email?'},
  {...offer,content:'Would you like me to prepare a local note or explain the product?'},
  {...offer,content:'Would you like me to prepare a local note? Is that your phone?'},
  {...offer,content:'He asked: Would you like me to prepare a local note?'},
 ]) assert.equal(requestedHandoffSpan('Yes, I would, please. We use Outlook.',{precedingTurn}),null);
});
