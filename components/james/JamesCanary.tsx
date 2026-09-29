'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient, AnamEvent } from '@anam-ai/js-sdk';
import type { AnamClient } from '@anam-ai/js-sdk';
import type { Turn, view } from '@/lib/james-canary/state';
import {comparisonTrace} from './comparison-trace';

type State=ReturnType<typeof view>;
const KEY='james-hosted-canary-session-v1';
export default function JamesCanary({comparisonEnabled=false}:{comparisonEnabled?:boolean}){
    const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('Start a new canary conversation when ready.'),[history,setHistory]=useState<Turn[]>([]);
    const client=useRef<AnamClient|null>(null), id=useRef(''), chain=useRef<Promise<unknown>>(Promise.resolve()), failed=useRef(false), stopped=useRef(false), closing=useRef(false);
    const latest=useRef<State|null>(null), seen=useRef(new Set<string>()), finalized=useRef(new Set<string>()), messages=useRef<Turn[]>([]);
    const arm=useRef(''),access=useRef(''),trace=useRef<ReturnType<typeof comparisonTrace>|null>(null);
    const latestFinalVisitor=useRef<string|null>(null),[traceText,setTraceText]=useState('');
    const storageKey=()=>comparisonEnabled?KEY+'-comparison-'+arm.current:KEY;
    function render(s:State){latest.current=s;setState(s);}
    async function api(action:string,body:object={}){
        const response=await fetch('/api/james-canary',{method:'POST',headers:{'Content-Type':'application/json',...(comparisonEnabled?{'x-james-comparison':access.current}:{})},body:JSON.stringify({action,id:id.current,...body})});
        const data=await response.json();
        if(!response.ok){trace.current?.record('HOST_API_REJECTED',{action,httpStatus:response.status,errorCategory:action==='turn'?'FINALIZED_STATE_REJECTED':action==='tool'?'TOOL_STATE_UNAVAILABLE':'LIFECYCLE_OR_AUTH_REJECTED'});throw new Error(data.error||'Canary request failed');}return data;
    }
    async function close(){
        if(closing.current)return;closing.current=true;setBusy(true);
        try {
            await chain.current;
            await api('begin-close');
            if(client.current&&!stopped.current){stopped.current=true;trace.current?.record('SDK_CLOSE_INVOKED');await client.current.stopStreaming();trace.current?.record('SDK_CLOSE_RETURNED');}
            const s=await api('close');render(s);setNotice(s.email_status==='SENT'?'Session closed. Owner-test email sent to the authorized test mailbox; provider receipt retained. Nothing sent to Knowles.':'Session closed. The brief is preserved. No verified email send to the firm.');
            trace.current?.record('HOST_CLOSE_VERIFIED',{state:s});trace.current?.flush();
        } catch(error){setNotice(error instanceof Error?error.message:'Closure needs attention');closing.current=false;}
        finally{setBusy(false);}
    }
    function queueHistory(){
        if(closing.current||failed.current)return;
        for(const [index,turn] of messages.current.entries()){
            if(messages.current.findLastIndex(t=>t.id===turn.id)!==index)continue;
            if(!finalized.current.has(turn.id)||seen.current.has(turn.id))continue;
            seen.current.add(turn.id);
            trace.current?.record('FINALIZED_TURN_ENQUEUED',{turn,revision:latest.current?.revision});
            chain.current=chain.current.then(async()=>{
                if(failed.current)throw new Error('Prior finalized event did not persist');
                // No late intake after a visitor ending; permit its one final assistant turn.
                if(latest.current?.state==='CLOSING_PENDING'&&turn.role==='user')return;
                const s=await api('turn',{turn,finalized:true});render(s);
                trace.current?.record('TURN_COMMITTED',{turnId:turn.id,role:turn.role,revision:s.revision,stateHash:s.stateHash,state:s});
                if(s.state==='CLOSING_PENDING'&&turn.role==='persona')setTimeout(()=>void close(),1500);
            }).catch(error=>{failed.current=true;setNotice(`Notes need attention: ${error.message}. End the session; do not repeat the turn.`);});
        }
    }
    useEffect(()=>{
        if(comparisonEnabled){
            arm.current=new URLSearchParams(location.search).get('steering')||'';
            access.current=location.hash.slice(1)||sessionStorage.getItem('james-comparison-access-'+arm.current)||'';
            if(access.current)sessionStorage.setItem('james-comparison-access-'+arm.current,access.current);
            if(location.hash)window.history.replaceState(null,'',location.pathname+location.search);
            setNotice('Isolated steering '+arm.current.toUpperCase()+' comparison. Synthetic speech only. No handoff or email.');
        }
        const saved=localStorage.getItem(storageKey());
        if(saved){id.current=saved;
            void fetch('/api/james-canary?id='+encodeURIComponent(saved)).then(async r=>{const s=await r.json();if(!r.ok)throw new Error(s.error);render(s);setNotice(s.state==='CLOSED'?'Saved closed session restored.':'Saved session restored. The media stream is not automatically reconnected.');}).catch(error=>setNotice(error.message));}
        return()=>{if(client.current&&!stopped.current){stopped.current=true;void client.current.stopStreaming();}trace.current?.restore();};
    // This effect restores once; mutable SDK lifecycle is held in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    },[]);
    async function start(){
        setBusy(true);setNotice('Connecting to the current James persona…');failed.current=false;stopped.current=false;closing.current=false;
        seen.current.clear();finalized.current.clear();messages.current=[];setHistory([]);
        try{
            if(comparisonEnabled){trace.current=comparisonTrace(arm.current);trace.current.record('ARM_START',{arm:arm.current,providerConsumption:'NOT_OBSERVABLE'});}
            const launched=await api('start',comparisonEnabled?{arm:arm.current}:{});id.current=launched.id;localStorage.setItem(storageKey(),launched.id);render(launched);
            trace.current?.record('HOST_STARTED',{hostedId:launched.id,comparison:launched.comparison,config:launched.config});
            const c=createClient(launched.sessionToken);client.current=c;
            let resolveBinding:()=>void,rejectBinding:(error:Error)=>void;
            const binding=new Promise<void>((resolve,reject)=>{resolveBinding=resolve;rejectBinding=reject;});chain.current=binding;
            c.addListener(AnamEvent.SESSION_READY,providerId=>{
                trace.current?.record('SDK_SESSION_READY',{providerId});
                void api('bind',{providerId}).then(s=>{render(s);setNotice('Connected. Speak naturally; only finalized visitor information updates the brief.');resolveBinding();})
                    .catch(error=>{failed.current=true;setNotice(error.message);rejectBinding(error);if(!stopped.current){stopped.current=true;void c.stopStreaming();}});
            });
            c.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED,event=>{
                // SDK emits the stream event BEFORE appending its final chunk to history.
                // Only the subsequent HISTORY_UPDATED event may enqueue the assembled reply.
                if(event.endOfSpeech===true && !event.interrupted){finalized.current.add(event.id);if(event.role==='user')latestFinalVisitor.current=event.id;trace.current?.record('FINAL_STREAM_EVENT',{turnId:event.id,role:event.role});}
            });
            c.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED,items=>{
                messages.current=items.filter(t=>t.role==='user'||t.role==='persona').map(t=>({id:t.id,role:t.role as Turn['role'],content:t.content}));
                setHistory(messages.current);queueHistory();
            });
            c.registerToolCallHandler('james_handoff',{onStart:async payload=>{
                const callId=payload.toolCallId;
                trace.current?.beginCall(callId);
                trace.current?.record('TOOL_HANDLER_STARTED',{toolCallId:callId,operation:payload.arguments.operation,latestFinalizedVisitorId:latestFinalVisitor.current,revision:latest.current?.revision});
                try{
                    const awaited=chain.current;await awaited;
                    trace.current?.record('CHAIN_WAIT_FINISHED',{toolCallId:callId,latestFinalizedVisitorId:latestFinalVisitor.current,queueChanged:awaited!==chain.current,revision:latest.current?.revision});
                    if(failed.current)throw new Error('Finalized evidence unavailable');
                    const result=await api('tool',{operation:payload.arguments.operation});
                    const text=JSON.stringify(result);
                    trace.current?.record('HANDLER_RESOLVED',{toolCallId:callId,latestFinalizedVisitorId:latestFinalVisitor.current,sourceTurnId:result.source_turn_id,revision:result.notes_receipt?.revision,exactResult:text,currentTurnMatches:result.source_turn_id===latestFinalVisitor.current});
                    trace.current?.hash('HANDLER_RESULT_HASH',text,{toolCallId:callId});return text;
                }
                catch(error){trace.current?.record('HANDLER_CAUGHT_ERROR',{toolCallId:callId,errorCategory:error instanceof Error?error.name:'UNKNOWN',finalizedEvidenceFailed:failed.current});return JSON.stringify({status:'UNAVAILABLE',sent:false,instruction:'No verified write or send. Do not claim notes saved, email sent, firm review or follow-up.'});}
            },...(comparisonEnabled?{
                onComplete:async payload=>{trace.current?.record('SDK_LOCAL_COMPLETED',{toolCallId:payload.toolCallId,providerConsumption:'NOT_OBSERVABLE'});},
                onFail:async payload=>{trace.current?.record('SDK_LOCAL_FAILED',{toolCallId:payload.toolCallId,errorCategory:'SDK_TOOL_FAILURE'});}
            }:{} )});
            c.addListener(AnamEvent.MIC_PERMISSION_DENIED,()=>setNotice('Microphone access is blocked. Allow microphone access for this site.'));
            c.addListener(AnamEvent.CONNECTION_CLOSED,()=>{if(!closing.current)setNotice('Media connection ended. Use Verify closure to preserve and verify the final brief.');});
            await c.streamToVideoElement('james-canary-video');
        }catch(error){setNotice(error instanceof Error?error.message:'James could not connect');}
        finally{setBusy(false);}
    }
    const active=state&&state.state!=='CLOSED';
    return <main className="fixed inset-0 z-[110] overflow-auto bg-zinc-950 p-4 text-white sm:p-6">
        <header className="mx-auto mb-4 flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs tracking-widest text-amber-300">JAMES vNEXT · CANARY / DEMO</p><h1 className="text-2xl font-semibold">A conversation with James</h1></div>
            <a href="/" className="text-sm underline">X-Agent website</a>
        </header>
        <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-2">
            <section><video id="james-canary-video" autoPlay playsInline className="aspect-[4/3] w-full rounded-xl bg-black object-contain"/>
                <p role="status" className="my-3 text-sm text-zinc-200">{notice}</p>
                <div className="flex gap-3"><button onClick={()=>void start()} disabled={busy||Boolean(active)} className="rounded bg-white px-5 py-3 font-semibold text-black disabled:opacity-40">Start James</button>
                    <button onClick={()=>void close()} disabled={busy||!active} className="rounded border border-white/40 px-5 py-3 disabled:opacity-40">{state?.state==='CLOSING'?'Verify closure':'End conversation'}</button></div>
                <p className="mt-4 text-xs text-zinc-400">Use fictional demo information. This is not legal advice or a submission to Knowles. No email is sent. The brief is stored for up to 24 hours in this browser-bound session.</p>
                {state&&<p className="mt-2 text-xs text-zinc-400">{state.state} · {state.acceptedVisitorTurns} visitor turns · {state.config.voiceName} · Session {state.id.slice(-8)}</p>}
                <details className="mt-4"><summary className="text-sm">Conversation captions</summary>{history.map((t,i)=><p key={t.id+':'+i} className="my-2 text-sm"><strong>{t.role==='user'?'Visitor':'James'}: </strong>{t.content}</p>)}</details>
                {comparisonEnabled&&<details className="mt-4"><summary>Owner comparison diagnostics</summary><button onClick={()=>{trace.current?.flush();setTraceText(trace.current?.snapshot()||sessionStorage.getItem('james-planner-comparison-trace-'+arm.current)||'[]');}}>Show current synthetic trace</button><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{traceText}</pre></details>}
            </section>
            <aside className="rounded-xl bg-amber-50 p-6 text-zinc-900" aria-label="Structured intake brief">
                <h2 className="text-xl font-semibold">Live intake brief</h2><p className="mb-5 text-xs text-zinc-600">Visitor-reported information · {state?.providerRelease?'Provider transcript verified':'Finalized speech; provider verification at close'}</p>
                {!state?.acceptedVisitorTurns&&<p>Clear intake details will appear here as you talk.</p>}
                {state?.brief.map(section=><section key={section.title} className="mb-5"><h3 className="border-b border-amber-200 pb-1 text-xs font-bold tracking-widest">{section.title}</h3><ul className="mt-2 space-y-2">{section.items.map((item,i)=><li key={i} className="text-sm">{item.label&&<span className="font-semibold">{item.label.replaceAll('_',' ')}: </span>}{item.text}</li>)}</ul></section>)}
                {state&&<p className="border-t border-amber-200 pt-3 text-xs">Receipt revision {state.revision} · {state.stateHash.slice(0,12)} · UNSUBMITTED · No external actions</p>}
            </aside>
        </div>
    </main>;
}
