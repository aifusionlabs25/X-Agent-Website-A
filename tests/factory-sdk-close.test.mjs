import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sdkCloseTracker} from '../lib/factory/sdk-close.ts';
import {appendSdkCloseEvidence} from '../lib/factory/handoff.ts';
const id='11111111-1111-4111-8111-111111111111',at='2026-10-31T00:00:00.000Z';
const state=()=>({id:'local',launch_label:'fixture:launch',provider_session_id:'provider',status:'CLOSING_PENDING',
 provider_release_verified:false,provider_transcript_verified:false,approved:false,turns:[],proposals:[],decisions:[]});
const receipt=(phase='INVOKED',changes={})=>({invocation_id:id,method:'stopStreaming',reason:'VISITOR_EXIT',phase,at,
 local_session_id:'local',launch_label:'fixture:launch',provider_session_id:'provider',...changes});

test('concurrent exit/manual/unmount close invokes SDK once; records after actual invocation',async()=>{
 const order=[],events=[];let calls=0,release;
 const tracker=sdkCloseTracker({id:()=>id,now:()=>at,stop:()=>{calls++;order.push('sdk');return new Promise(r=>{release=r;});},
  report:e=>{order.push(e.phase);events.push(e);}});
 const a=tracker.close('VISITOR_EXIT'),b=tracker.close('OWNER_FINISH'),c=tracker.close('UNMOUNT');
 assert.equal(a,b);assert.equal(b,c);assert.equal(calls,0);await Promise.resolve();
 assert.equal(calls,1);assert.deepEqual(order,['sdk','INVOKED']);release();await a;
 assert.deepEqual(events.map(e=>e.phase),['INVOKED','RESOLVED']);assert.equal(tracker.snapshot().invocations,1);
 assert.equal(events[0].reason,'VISITOR_EXIT');
});
test('sync SDK exception is an actual rejected invocation; no retry',async()=>{
 let calls=0;const t=sdkCloseTracker({id:()=>id,now:()=>at,stop:()=>{calls++;throw Error('SDK failed');},report:()=>{}});
 await assert.rejects(t.close('OWNER_FINISH'));await assert.rejects(t.close('VISITOR_EXIT'));
 assert.equal(calls,1);assert.deepEqual(t.snapshot().events.map(x=>x.phase),['INVOKED','REJECTED']);
});
test('telemetry failure never blocks SDK cleanup or causes a retry',async()=>{
 let calls=0;const t=sdkCloseTracker({id:()=>id,now:()=>at,stop:async()=>{calls++;},report:async()=>{throw Error('report failed');}});
 await t.close('UNMOUNT');await Promise.resolve();
 assert.equal(calls,1);assert.equal(t.snapshot().report_failures,2);assert.equal(t.snapshot().events.length,2);
});
test('SDK resolution does not mark release or CLOSED; trace survives JSON reload',()=>{
 const s=state();appendSdkCloseEvidence(s,receipt());appendSdkCloseEvidence(s,receipt('RESOLVED'));
 assert.equal(s.status,'CLOSING_PENDING');assert.equal(s.provider_release_verified,false);
 assert.equal(s.provider_transcript_verified,false);assert.equal(s.approved,false);
 assert.equal(JSON.parse(JSON.stringify(s)).sdk_close_events.length,2);
});
test('duplicate event is semantic/order-independent, contradictory evidence fails',()=>{
 const s=state();appendSdkCloseEvidence(s,receipt());appendSdkCloseEvidence(s,Object.fromEntries(Object.entries(receipt()).reverse()));
 assert.equal(s.sdk_close_events.length,1);
 assert.throws(()=>appendSdkCloseEvidence(s,receipt('INVOKED',{reason:'UNMOUNT'})),/immutable/);
 assert.throws(()=>appendSdkCloseEvidence(s,receipt('RESOLVED',{reason:'UNMOUNT'})),/binding/);
});
test('old local session, provider and launch cannot contaminate a new session',()=>{
 for(const change of [{local_session_id:'previous'},{provider_session_id:'other'},{launch_label:'other'},
  {method:'unsupported_stop'},{phase:'RELEASE_VERIFIED'},{reason:'invented'}])
  assert.throws(()=>appendSdkCloseEvidence(state(),receipt('INVOKED',change)),/exact local/);
});
test('missing/reversed/failed phase evidence stays incomplete; no invented success',()=>{
 assert.throws(()=>appendSdkCloseEvidence(state(),receipt('RESOLVED')),/phases/);
 const s=state();appendSdkCloseEvidence(s,receipt());appendSdkCloseEvidence(s,receipt('REJECTED'));
 assert.throws(()=>appendSdkCloseEvidence(s,receipt('RESOLVED')),/phases/);assert.equal(s.sdk_close_events.length,2);
});
test('multiple real invocation IDs remain visible rather than being silently reduced to one',()=>{
 const s=state();appendSdkCloseEvidence(s,receipt());appendSdkCloseEvidence(s,receipt('RESOLVED'));
 appendSdkCloseEvidence(s,receipt('INVOKED',{invocation_id:'22222222-2222-4222-8222-222222222222'}));
 assert.equal(new Set(s.sdk_close_events.map(x=>x.invocation_id)).size,2);
});
test('only one browser SDK call site; evidence POST never creates provider release or action authority',()=>{
 const ui=readFileSync(new URL('../components/factory/FactoryPilot.tsx',import.meta.url),'utf8');
 const api=readFileSync(new URL('../app/api/factory/pilot/route.ts',import.meta.url),'utf8');
 assert.equal((ui.match(/\.stopStreaming\(/g)||[]).length,1);
 for(const reason of ['UNMOUNT','BIND_FAILED','VISITOR_EXIT'])assert.ok(ui.includes(reason));
 assert.match(api,/case 'sdk_close_receipt': appendSdkCloseEvidence\(state,b.receipt\); break;/);
 assert.doesNotMatch(api.split("case 'sdk_close_receipt':")[1].split('break;')[0],/provider\(|status=|release_verified=/);
 assert.match(ui,/CLIENT|Client-instrumented/);assert.ok(!ui.includes('ANAM_API_KEY'));
});
