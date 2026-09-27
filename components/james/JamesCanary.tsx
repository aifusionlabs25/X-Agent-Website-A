'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient, AnamEvent } from '@anam-ai/js-sdk';
import type { AnamClient } from '@anam-ai/js-sdk';
import type { Turn, view } from '@/lib/james-canary/state';

type State=ReturnType<typeof view>;
const KEY='james-hosted-canary-session-v1';
export default function JamesCanary(){
    const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('Start a new canary conversation when ready.'),[history,setHistory]=useState<Turn[]>([]);
    const client=useRef<AnamClient|null>(null), id=useRef(''), chain=useRef<Promise<unknown>>(Promise.resolve()), failed=useRef(false), stopped=useRef(false), closing=useRef(false);
    const latest=useRef<State|null>(null), seen=useRef(new Set<string>()), finalized=useRef(new Set<string>()), messages=useRef<Turn[]>([]);
    function render(s:State){latest.current=s;setState(s);}
    async function api(action:string,body:object={}){
        const response=await fetch('/api/james-canary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:id.current,...body})});
        const data=await response.json(); if(!response.ok)throw new Error(data.error||'Canary request failed');return data;
    }
    async function close(){
        if(closing.current)return;closing.current=true;setBusy(true);
        try {
            await chain.current;
            await api('begin-close');
            if(client.current&&!stopped.current){stopped.current=true;await client.current.stopStreaming();}
            const s=await api('close');render(s);setNotice('Session closed. The brief is preserved. Nothing was emailed or sent to the firm.');
        } catch(error){setNotice(error instanceof Error?error.message:'Closure needs attention');closing.current=false;}
        finally{setBusy(false);}
    }
    function queueHistory(){
        if(closing.current||failed.current)return;
        for(const [index,turn] of messages.current.entries()){
            if(messages.current.findLastIndex(t=>t.id===turn.id)!==index)continue;
            if(!finalized.current.has(turn.id)||seen.current.has(turn.id))continue;
            seen.current.add(turn.id);
            chain.current=chain.current.then(async()=>{
                if(failed.current)throw new Error('Prior finalized event did not persist');
                // No late intake after a visitor ending; permit its one final assistant turn.
                if(latest.current?.state==='CLOSING_PENDING'&&turn.role==='user')return;
                const s=await api('turn',{turn,finalized:true});render(s);
                if(s.state==='CLOSING_PENDING'&&turn.role==='persona')setTimeout(()=>void close(),1500);
            }).catch(error=>{failed.current=true;setNotice(`Notes need attention: ${error.message}. End the session; do not repeat the turn.`);});
        }
    }
    useEffect(()=>{
        const saved=localStorage.getItem(KEY);
        if(saved){id.current=saved;
            void fetch('/api/james-canary?id='+encodeURIComponent(saved)).then(async r=>{const s=await r.json();if(!r.ok)throw new Error(s.error);render(s);setNotice(s.state==='CLOSED'?'Saved closed session restored.':'Saved session restored. The media stream is not automatically reconnected.');}).catch(error=>setNotice(error.message));}
        return()=>{if(client.current&&!stopped.current){stopped.current=true;void client.current.stopStreaming();}};
    // This effect restores once; mutable SDK lifecycle is held in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    },[]);
    async function start(){
        setBusy(true);setNotice('Connecting to the current James persona…');failed.current=false;stopped.current=false;closing.current=false;
        seen.current.clear();finalized.current.clear();messages.current=[];setHistory([]);
        try{
            const launched=await api('start');id.current=launched.id;localStorage.setItem(KEY,launched.id);render(launched);
            const c=createClient(launched.sessionToken);client.current=c;
            let resolveBinding:()=>void,rejectBinding:(error:Error)=>void;
            const binding=new Promise<void>((resolve,reject)=>{resolveBinding=resolve;rejectBinding=reject;});chain.current=binding;
            c.addListener(AnamEvent.SESSION_READY,providerId=>{
                void api('bind',{providerId}).then(s=>{render(s);setNotice('Connected. Speak naturally; only finalized visitor information updates the brief.');resolveBinding();})
                    .catch(error=>{failed.current=true;setNotice(error.message);rejectBinding(error);if(!stopped.current){stopped.current=true;void c.stopStreaming();}});
            });
            c.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED,event=>{
                // SDK emits the stream event BEFORE appending its final chunk to history.
                // Only the subsequent HISTORY_UPDATED event may enqueue the assembled reply.
                if(event.endOfSpeech===true && !event.interrupted)finalized.current.add(event.id);
            });
            c.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED,items=>{
                messages.current=items.filter(t=>t.role==='user'||t.role==='persona').map(t=>({id:t.id,role:t.role as Turn['role'],content:t.content}));
                setHistory(messages.current);queueHistory();
            });
            c.registerToolCallHandler('james_handoff',{onStart:async payload=>{
                try{await chain.current;if(failed.current)throw new Error('Finalized evidence unavailable');return JSON.stringify(await api('tool',{operation:payload.arguments.operation}));}
                catch{return JSON.stringify({status:'UNAVAILABLE',sent:false,instruction:'No verified write or send. Do not claim notes saved, email sent, firm review or follow-up.'});}
            }});
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
