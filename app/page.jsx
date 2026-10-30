'use client';
import {useEffect,useRef,useState} from 'react';
import {createEvanCaptureClient} from '@/lib/anam/evan-capture-client.ts';
import {createCaptureRequestPath} from '@/lib/anam/capture-request-path.mjs';
import {captureContactView} from '@/lib/anam/browser-contract.mjs';
export default function Page(){
 const [fixture,setFixture]=useState(null),[state,setState]=useState({status:'loading'}),[error,setError]=useState(''),[reload,setReload]=useState(0);const client=useRef(null);
 useEffect(()=>{let active=true;fetch('/api/capture-fixture',{cache:'no-store'}).then(async r=>{const f=await r.json();if(!r.ok)throw new Error(f.code??'Synthetic fixture access required');return f;}).then(async f=>{
  if(!active)return;setFixture(f);if(!f.binding){setState({status:'not-started'});return;}const sourceKey='capture-synthetic-index:'+f.binding.sessionId;
  const request=createCaptureRequestPath({fetchImpl:window.fetch.bind(window),session:()=>f.binding,isActive:()=>active});
  const c=createEvanCaptureClient({session:f.binding,...request,delayMs:0,onState:s=>{
   if(!active)return;setState(s);if(s.status==='ready')localStorage.setItem(sourceKey,String(s.record.revision));
  },timeoutMs:45000});client.current=c;
  const revision=Number(localStorage.getItem(sourceKey)??0);await c.restore(revision?f.prefixes[revision-1]:[]);
 }).catch(e=>active&&setError(e.message));return()=>{active=false;client.current?.dispose();};},[reload]);
 async function start(){setError('');setState({status:'loading'});try{const r=await fetch('/api/capture-fixture/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const f=await r.json();if(!r.ok)throw new Error(f.code??'Fixture start failed');setReload(x=>x+1);}catch(e){setError(e.message);setState({status:'blocked'});}}
 const revision=state.record?.revision??0,contact=state.record?captureContactView(state):{};
 return <main><h1>Private capture Luna test</h1><p><strong>Fictional data only · steps 1–3 are authored setup · step 4 is one approved Luna call · no email</strong></p>
  {error&&<p role="alert">{error}</p>}<p data-testid="status">Status: {state.status}</p><p data-testid="revision">Accepted revision: {revision}</p>
  {!fixture?.binding&&<button disabled={state.status!=='not-started'} onClick={start}>Start fictional storage test</button>}
  <button disabled={!fixture?.binding||revision>=4||(revision===3&&fixture?.lunaConsumed)||!['ready','listening'].includes(state.status)} onClick={()=>client.current.update(fixture.prefixes[revision])}>{revision===3?'Run approved Luna step':'Apply next fictional turn'}</button>
  {fixture?.lunaConsumed&&revision<4&&<p role="alert">The single Luna authorization has already been used. Another model request is blocked; retain this state for review.</p>}
  <h2>Contact</h2><div data-testid="contact">{contact.displayName&&<p>Name: {contact.displayName}</p>}{contact.phone&&<p>Phone: {contact.phone}</p>}{contact.email&&<p>Email: {contact.email}</p>}</div>
  <p data-testid="email-state">Email collection: {state.review?.collection?.email?.state??'NOT_PROVIDED'}</p>
  <h2>Requested support</h2><ul data-testid="services">{state.review?.plan?.services.map(x=><li key={x}>{x}</li>)}</ul>
  <h2>Inventory</h2><ul data-testid="inventory">{state.review?.plan?.inventoryItems.map(x=><li key={x}>{x}</li>)}</ul>
  <h2>Open questions</h2><ul data-testid="questions">{state.review?.clientQuestions.map(q=><li key={q.id}>{q.text} — {q.state}</li>)}</ul>
  <p data-testid="authority">Handoff: {state.review?.handoffAuthority??'NONE'} · Email allowed: {String(state.review?.emailSendAllowed??false)}</p>
  <p data-testid="receipt">Validation receipt: {state.receipt?.id??'none'}</p>
  <p>This is not a live Evan session. Reload restores the same receipt without another model call. Each fixture lasts at most five minutes. The single-use Luna authorization is shared across browsers and deployments. Errors stop without retries.</p>
 </main>;
}
