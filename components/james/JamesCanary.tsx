'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient, AnamEvent } from '@anam-ai/js-sdk';
import type { AnamClient } from '@anam-ai/js-sdk';
import type { Turn, view } from '@/lib/james-canary/state';

type State=ReturnType<typeof view>;
type EmailPreview={snapshotHash:string;callerAddress:string;sender:string;replyTo:string;messages:{lane:string;to:string;text:string}[]};
export default function JamesCanary({apiPath='/api/james-canary',storageKey='james-hosted-canary-session-v1',notepadDemo=false}:{apiPath?:string;storageKey?:string;notepadDemo?:boolean}={}){
    const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(notepadDemo?'Start a demo conversation when ready.':'Start a new canary conversation when ready.'),[history,setHistory]=useState<Turn[]>([]);
    const [padOpen,setPadOpen]=useState(!notepadDemo),[accessCode,setAccessCode]=useState(''),[preview,setPreview]=useState<EmailPreview|null>(null),[approved,setApproved]=useState(false);
    const client=useRef<AnamClient|null>(null), id=useRef(''), chain=useRef<Promise<unknown>>(Promise.resolve()), failed=useRef(false), stopped=useRef(false), closing=useRef(false);
    const latest=useRef<State|null>(null), seen=useRef(new Set<string>()), finalized=useRef(new Set<string>()), messages=useRef<Turn[]>([]);
    function render(s:State){latest.current=s;setState(s);}
    async function api(action:string,body:object={},demoAccess?:string){
        const response=await fetch(apiPath,{method:'POST',headers:{'Content-Type':'application/json',...(demoAccess?{'x-james-demo-access':demoAccess}:{})},body:JSON.stringify({action,id:id.current,...body})});
        const data=await response.json(); if(!response.ok)throw new Error(data.error||'Canary request failed');return data;
    }
    async function close(){
        if(closing.current)return;closing.current=true;setBusy(true);
        try {
            await chain.current;
            await api('begin-close');
            if(client.current&&!stopped.current){stopped.current=true;await client.current.stopStreaming();}
            const s=await api('close');render(s);setPadOpen(true);setNotice(s.operation_notice||(s.email_status==='SENT'?'Session closed. Owner-test email accepted by AgentMail. Nothing sent to Knowles.':'Session closed and notes verified. Nothing has been emailed unless a send result is shown below.'));
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
        const saved=localStorage.getItem(storageKey);
        if(saved){id.current=saved;
            void fetch(apiPath+'?id='+encodeURIComponent(saved)).then(async r=>{const s=await r.json();if(!r.ok)throw new Error(s.error);render(s);if(s.state==='CLOSED')setPadOpen(true);setNotice(s.state==='CLOSED'?'Saved closed session restored.':'Saved session restored. The media stream is not automatically reconnected.');}).catch(error=>setNotice(error.message));}
        return()=>{if(client.current&&!stopped.current){stopped.current=true;void client.current.stopStreaming();}};
    // This effect restores once; mutable SDK lifecycle is held in refs.
    },[apiPath,storageKey]);
    async function start(){
        setBusy(true);setNotice('Connecting to the current James persona…');failed.current=false;stopped.current=false;closing.current=false;
        seen.current.clear();finalized.current.clear();messages.current=[];setHistory([]);setPreview(null);setApproved(false);
        try{
            if(accessCode)await api('demo-email-preflight',{},accessCode);
            const launched=await api('start',{},accessCode||undefined);setAccessCode('');id.current=launched.id;localStorage.setItem(storageKey,launched.id);render(launched);
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
    async function previewEmails(){
        setBusy(true);setApproved(false);
        try{setPreview(await api('preview-demo-email'));setNotice('Review both summaries and the caller address before approving the two demo emails.');}
        catch(error){setNotice(error instanceof Error?error.message:'Email preview unavailable');}
        finally{setBusy(false);}
    }
    async function sendEmails(){
        if(!preview||!approved)return;
        setBusy(true);
        try{
            const s=await api('send-demo-email',{snapshotHash:preview.snapshotHash,callerAddress:preview.callerAddress,approved:true});render(s);setPreview(null);setApproved(false);
            setNotice('Demo send attempts completed. See the separate internal and caller results below. AgentMail acceptance is not proof of inbox delivery.');
        }catch(error){
            setPreview(null);setApproved(false);
            setNotice((error instanceof Error?error.message:'Email send needs attention')+'. Do not retry; reload to inspect the saved send results.');
        }finally{setBusy(false);}
    }
    const active=state&&state.state!=='CLOSED';
    return <main className="fixed inset-0 z-[110] overflow-auto bg-zinc-950 p-4 text-white sm:p-6">
        <header className="mx-auto mb-4 flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs tracking-widest text-amber-300">{notepadDemo?'AI FUSION LABS · JAMES LEGAL PAD DEMO':'JAMES vNEXT · CANARY / DEMO'}</p><h1 className="font-serif text-3xl">A conversation with James</h1></div>
            <Link href="/" className="text-sm underline">X-Agent website</Link>
        </header>
        <div className={'mx-auto grid max-w-7xl gap-5 '+(padOpen?'lg:grid-cols-2':'')}>
            <section><video id="james-canary-video" autoPlay playsInline className="aspect-[4/3] w-full rounded-xl bg-black object-contain"/>
                <p role="status" className="my-3 text-sm text-zinc-200">{notice}</p>
                {notepadDemo&&!active&&<details className="mb-4 rounded border border-white/20 p-3"><summary className="cursor-pointer text-sm">Operator email test (optional)</summary><label className="mt-3 block text-xs">One-use demo access code<input type="password" autoComplete="off" value={accessCode} onChange={e=>setAccessCode(e.target.value)} disabled={busy} className="mt-2 block w-full rounded border border-white/30 bg-zinc-900 p-2 text-white"/></label><p className="mt-2 text-xs text-zinc-400">Leave blank for a notes-only call. Codes are never saved in browser storage or URLs.</p></details>}
                <div className="flex flex-wrap gap-3"><button onClick={()=>void start()} disabled={busy||Boolean(active)} className="rounded bg-white px-5 py-3 font-semibold text-black disabled:opacity-40">Start James</button>
                    <button onClick={()=>void close()} disabled={busy||!active} className="rounded border border-white/40 px-5 py-3 disabled:opacity-40">{state?.state==='CLOSING'?'Verify closure':'End conversation'}</button>
                    <button aria-expanded={padOpen} aria-controls="james-legal-pad" onClick={()=>setPadOpen(v=>!v)} className="rounded border border-amber-300/60 px-5 py-3 text-amber-200">{padOpen?'Hide legal pad':'Show legal pad'}</button></div>
                <p className="mt-4 text-xs text-zinc-400">Use fictional case details only. This is not legal advice or a submission to Knowles. {state?.demo_email_authorized?'Email testing is authorized for this session, but requires post-call review and explicit approval.':state?.owner_test?'Legacy owner email test; inspect its send status.':'Email sending is off for this session.'} Notes expire 24 hours after their last saved update. Anam transcripts and emailed copies have separate retention rules.</p>
                {state&&<p className="mt-2 text-xs text-zinc-400">{state.state} · {state.acceptedVisitorTurns} visitor turns · {state.config.voiceName} · Session {state.id.slice(-8)}</p>}
                {state?.speech_review_required&&<p role="alert" className="mt-3 border-l-2 border-amber-400 pl-3 text-sm text-amber-200">Possible instruction leakage detected in James’s captions. Email preparation is blocked for review. This does not filter or prevent spoken audio.</p>}
                {!!state?.demo_email_status.length&&<ul className="mt-4 space-y-2 text-sm">{state.demo_email_status.map(result=><li key={result.lane}>{result.lane==='internal'?'Internal summary':'Caller recap'} to {result.recipient}: {result.status==='SENT'?'accepted by AgentMail':result.status==='RESERVED'?'pending or unknown — do not retry':'no verified receipt — do not retry'}.</li>)}</ul>}
                {notepadDemo&&state?.state==='CLOSED'&&state.demo_email_authorized&&!state.demo_email_status.length&&<button onClick={()=>void previewEmails()} disabled={busy||state.speech_review_required} className="mt-4 rounded bg-amber-200 px-5 py-3 font-semibold text-zinc-950 disabled:opacity-40">Review demo emails</button>}
                {preview&&<section className="mt-5 rounded border border-amber-200/40 p-4" aria-label="Demo email review"><h2 className="font-serif text-xl">Review before sending</h2><p className="my-2 text-xs">From AI Fusion Labs Demo ({preview.sender}) · Replies to {preview.replyTo}</p>{preview.messages.map(m=><details key={m.lane} className="my-3"><summary>{m.lane==='internal'?'Internal review summary':'Caller recap'} → {m.to}</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{m.text}</pre></details>)}<label className="my-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} disabled={busy}/><span>I reviewed both summaries, confirm these are fictional demo case details, and authorize one internal email plus one recap to {preview.callerAddress}. I have permission to use this caller mailbox.</span></label><button onClick={()=>void sendEmails()} disabled={busy||!approved} className="rounded bg-amber-200 px-5 py-3 font-semibold text-zinc-950 disabled:opacity-40">Email both demo summaries</button></section>}
                <details className="mt-4"><summary className="text-sm">Conversation captions</summary>{history.map((t,i)=><p key={t.id+':'+i} className="my-2 text-sm"><strong>{t.role==='user'?'Visitor':'James'}: </strong>{t.content}</p>)}</details>
            </section>
            {padOpen&&<aside id="james-legal-pad" className="relative rounded-b-lg border-t-[14px] border-amber-800 bg-[#fff1a8] py-6 pl-12 pr-6 text-zinc-900 shadow-xl" style={{backgroundImage:'linear-gradient(90deg, transparent 35px, #df827966 35px, #df827966 37px, transparent 37px), repeating-linear-gradient(transparent 0px, transparent 27px, #b7a56b44 27px, #b7a56b44 28px)'}} aria-label="James legal pad">
                <h2 className="font-serif text-2xl">{state?.state==='CLOSED'?'Organized call summary':'James’s legal pad'}</h2><p className="mb-5 mt-2 text-xs text-zinc-700">Visitor-reported information · {state?.providerRelease?'Provider transcript verified':'Finalized speech; provider verification at close'}</p><p className="mb-5 text-sm italic">See something wrong? Tell James during the call; supported corrections replace the current note while preserving its history.</p>
                {!state?.acceptedVisitorTurns&&<p>Clear intake details will appear here as you talk.</p>}
                {state?.brief.map(section=><section key={section.title} className="mb-5"><h3 className="border-b border-amber-200 pb-1 text-xs font-bold tracking-widest">{section.title}</h3><ul className="mt-2 space-y-2">{section.items.map((item,i)=><li key={i} className="text-sm">{item.label&&<span className="font-semibold">{item.label.replaceAll('_',' ')}: </span>}{item.text}</li>)}</ul></section>)}
                {state&&<p className="border-t border-amber-300 pt-3 text-xs">Receipt revision {state.revision} · {state.stateHash.slice(0,12)} · {state.external_actions.length?'Demo email activity shown separately — nothing submitted to Knowles':'UNSUBMITTED · No external actions'}</p>}
            </aside>}
        </div>
    </main>;
}
