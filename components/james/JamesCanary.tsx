'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient, AnamEvent } from '@anam-ai/js-sdk';
import type { AnamClient } from '@anam-ai/js-sdk';
import type { Turn, view } from '@/lib/james-canary/state';
import { initialPadVisibility, revealForFirstFact, togglePad, BRIEF_REVIEW_INVITATION } from '@/lib/james-canary/pad-visibility';
import type { PadVisibility } from '@/lib/james-canary/pad-visibility';
import { enqueueClosingMutation, playbackAllowsClose } from '@/lib/james-canary/closing';

type State=ReturnType<typeof view>;
type EmailPreview={snapshotHash:string;callerAddress:string;sender:string;replyTo:string;messages:{lane:string;to:string;text:string}[]};
export default function JamesCanary({apiPath='/api/james-canary',storageKey='james-hosted-canary-session-v1',notepadDemo=false,launchReady=true,emailAccessMode='one-use',previewStates}:{apiPath?:string;storageKey?:string;notepadDemo?:boolean;launchReady?:boolean;emailAccessMode?:'one-use'|'reusable'|'visitor';previewStates?:{label:string;state:State|null}[]}={}){
    const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(notepadDemo?'Start a demo conversation when ready.':'Start a new canary conversation when ready.'),[history,setHistory]=useState<Turn[]>([]);
    const [padVisibility,setPadVisibility]=useState<PadVisibility>(()=>notepadDemo?initialPadVisibility():{open:true,revealed:true,manual:false}),[accessCode,setAccessCode]=useState(''),[preview,setPreview]=useState<EmailPreview|null>(null),[approved,setApproved]=useState(false);
    const [editSlot,setEditSlot]=useState('name'),[editValue,setEditValue]=useState(''),[editing,setEditing]=useState(false),[previewIndex,setPreviewIndex]=useState(0);
    const padOpen=padVisibility.open;
    const client=useRef<AnamClient|null>(null), id=useRef(''), chain=useRef<Promise<unknown>>(Promise.resolve()), failed=useRef(false), stopped=useRef(false), closing=useRef(false);
    const latest=useRef<State|null>(null), seen=useRef(new Set<string>()), finalized=useRef(new Set<string>()), messages=useRef<Turn[]>([]);
    const invitationTimer=useRef<ReturnType<typeof setTimeout>|null>(null),personaSpeaking=useRef(false),visitorSpeaking=useRef(false);
    const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null),audioMonitor=useRef<ReturnType<typeof setInterval>|null>(null);
    const closeEpoch=useRef(0),closeInFlight=useRef(false),speechStarts=useRef(new Map<string,number>());
    const audio=useRef<{context:AudioContext;source:MediaStreamAudioSourceNode;analyser:AnalyserNode;quietSince:number|null;lastSoundAt:number}|null>(null);
    const render=useCallback((s:State)=>{
        latest.current=s;setState(s);
        if(notepadDemo)setPadVisibility(v=>revealForFirstFact(v,Boolean(s.intakeBrief?.hasSubstantiveFact)));
        setPreview(null);setApproved(false);
    },[notepadDemo]);
    function changePad(){
        const next=togglePad(padVisibility);setPadVisibility(next);
        if(id.current&&!previewStates)try{localStorage.setItem(storageKey+'-pad',JSON.stringify({id:id.current,...next}));}catch{/* Visibility is local presentation only. */}
    }
    /** SDK 4.20 has no played-speech-complete event. Only speak the fixed review
     * invitation after measured output silence and no visitor/persona turn.
     * No audio probe means UI-only review, never a timed interruption guess. */
    function outputIsQuiet(){
        const probe=audio.current;
        if(probe?.context.state!=='running'||visitorSpeaking.current||personaSpeaking.current){
            if(probe)probe.quietSince=null;
            return false;
        }
        const samples=new Float32Array(probe.analyser.fftSize);probe.analyser.getFloatTimeDomainData(samples);
        const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
        if(rms>=0.006){probe.quietSince=null;probe.lastSoundAt=performance.now();return false;}
        probe.quietSince??=performance.now();
        return performance.now()-probe.quietSince>=1200;
    }
    function scheduleInvitation(){
        if(invitationTimer.current||!notepadDemo||previewStates)return;
        let attempts=0;
        const check=()=>{
            invitationTimer.current=null;
            const s=latest.current;
            if(s?.websiteClosing&&(s.websiteClosing.departureTurnId||s.websiteClosing.recap||s.websiteClosing.complete))return;
            if(closing.current||stopped.current||failed.current||s?.state!=='ACTIVE'||s.intakeBrief?.phase!=='REVIEW'||s.intakeBrief.invitationReserved)return;
            if(++attempts>120)return; // Visible review remains available; no automatic retry.
            if(!outputIsQuiet()){invitationTimer.current=setTimeout(check,250);return;}
            chain.current=chain.current.then(async()=>{
                const current=latest.current;
                if(current?.state!=='ACTIVE'||current.intakeBrief?.phase!=='REVIEW'||closing.current||!outputIsQuiet())return;
                const reserved=await api('reserve-brief-invitation',{snapshotHash:current.intakeBrief.hash});render(reserved);
                if(reserved.invitation_allowed&&latest.current?.intakeBrief?.hash===current.intakeBrief.hash
                    &&!closing.current&&!stopped.current&&!failed.current&&outputIsQuiet()&&client.current?.isStreaming()){
                    // Exact caller-facing speech, not a prompt asking the LLM to
                    // decide the UI state, summarize, or approve its own notes.
                    await client.current.talk(BRIEF_REVIEW_INVITATION);
                }else if(reserved.invitation_allowed)setNotice('Your intake brief is ready on the legal pad. Please review it there; James will not interrupt the current speech.');
            }).catch(()=>setNotice('Your intake brief is ready on the legal pad. Please review it there; no spoken invitation is confirmed.'));
        };
        invitationTimer.current=setTimeout(check,250);
    }
    async function api(action:string,body:object={},demoAccess?:string){
        if(previewStates)throw new Error('Offline preview cannot make session requests');
        const response=await fetch(apiPath,{method:'POST',headers:{'Content-Type':'application/json',...(demoAccess?{'x-james-demo-access':demoAccess}:{})},body:JSON.stringify({action,id:id.current,...body})});
        const data=await response.json(); if(!response.ok)throw new Error(data.error||'Canary request failed');return data;
    }
    function cancelPendingClose(){
        closeEpoch.current++;
        if(closeTimer.current)clearTimeout(closeTimer.current);closeTimer.current=null;
        if(!latest.current?.websiteClosing||closing.current||stopped.current)return;
        if(!latest.current.websiteClosing.farewellTurnId&&!latest.current.websiteClosing.departureTurnId)return;
        chain.current=chain.current.then(async()=>{render(await api('cancel-close'));})
            .catch(()=>{failed.current=true;setNotice('Closing paused. The session needs attention; use End conversation when ready.');});
    }
    function scheduleClose(farewellTurnId:string){
        if(closeTimer.current)clearTimeout(closeTimer.current);
        const epoch=closeEpoch.current,finalizedAt=performance.now();
        const check=()=>{
            closeTimer.current=null;
            if(epoch!==closeEpoch.current||closing.current||failed.current||stopped.current||latest.current?.websiteClosing?.farewellTurnId!==farewellTurnId)return;
            const probe=audio.current;outputIsQuiet();
            const allowed=probe&&playbackAllowsClose({now:performance.now(),finalizedAt,turnStartedAt:speechStarts.current.get(farewellTurnId)??Infinity,
                lastSoundAt:probe.lastSoundAt,quietSince:probe.quietSince,running:probe.context.state==='running',personaSpeaking:personaSpeaking.current,
                visitorSpeaking:visitorSpeaking.current,epoch:closeEpoch.current,expectedEpoch:epoch});
            if(allowed){void close({epoch,farewellTurnId});return;}
            if(performance.now()-finalizedAt>45000){setNotice('James has finished the conversation. Use End conversation when ready; automatic audio completion could not be verified.');return;}
            closeTimer.current=setTimeout(check,200);
        };
        closeTimer.current=setTimeout(check,200);
    }
    async function close(automatic?:{epoch:number;farewellTurnId:string}){
        if(closing.current||closeInFlight.current)return;closeInFlight.current=true;setBusy(true);
        const stillCurrent=()=>!automatic||(automatic.epoch===closeEpoch.current&&!visitorSpeaking.current
            &&latest.current?.websiteClosing?.farewellTurnId===automatic.farewellTurnId);
        try {
            // Closure and visitor cancellation share the same mutation queue.
            // Otherwise both could race the server revision and discard the
            // very correction that was supposed to cancel automatic closing.
            const beginTask=enqueueClosingMutation(chain,async()=>{
                if(!stillCurrent())return null;
                return api('begin-close',automatic?{automatic:true,farewellTurnId:automatic.farewellTurnId,revision:latest.current?.revision}:{});
            });
            const begun=await beginTask;
            if(!begun)return;
            if(!stillCurrent()){await chain.current;return;}
            render(begun);
            closing.current=true;
            if(client.current&&!stopped.current){stopped.current=true;await client.current.stopStreaming();}
            if(closeTimer.current)clearTimeout(closeTimer.current);closeTimer.current=null;
            if(audioMonitor.current)clearInterval(audioMonitor.current);audioMonitor.current=null;
            if(invitationTimer.current)clearTimeout(invitationTimer.current);invitationTimer.current=null;
            if(audio.current)void audio.current.context.close().catch(()=>{});audio.current=null;
            const s=await api('close');render(s);if(!notepadDemo)setPadVisibility(v=>({...v,open:true}));setNotice(s.operation_notice||(s.email_status==='SENT'?'Session closed. Owner-test email accepted by AgentMail. Nothing sent to Knowles.':'Session closed. Review the finalized intake brief; nothing has been emailed unless a send result is shown below.'));
        } catch(error){setNotice(error instanceof Error?error.message:'Closure needs attention');closing.current=false;}
        finally{closeInFlight.current=false;setBusy(false);}
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
                if(latest.current?.state==='CLOSING_PENDING'&&!latest.current.websiteClosing&&turn.role==='user')return;
                const s=await api('turn',{turn,finalized:true});render(s);
                scheduleInvitation();
                if(s.state==='CLOSING_PENDING'&&turn.role==='persona'){
                    if(s.websiteClosing?.farewellTurnId)scheduleClose(s.websiteClosing.farewellTurnId);
                    else if(!s.websiteClosing)setTimeout(()=>void close(),1500);
                }
            }).catch(error=>{failed.current=true;setNotice(`Notes need attention: ${error.message}. End the session; do not repeat the turn.`);});
        }
    }
    useEffect(()=>{
        if(previewStates)return;
        let saved:string|null=null;
        try{saved=localStorage.getItem(storageKey);}catch{/* Private/blocked storage must not crash the page. */}
        if(saved){id.current=saved;
            void fetch(apiPath+'?id='+encodeURIComponent(saved)).then(async r=>{const s=await r.json();if(!r.ok)throw new Error(s.error);render(s);
                try{const choice=JSON.parse(localStorage.getItem(storageKey+'-pad')||'null');if(choice?.id===saved&&typeof choice.open==='boolean'&&typeof choice.revealed==='boolean'&&choice.manual===true)setPadVisibility(choice);}catch{/* Ignore malformed presentation preferences. */}
                setNotice(s.state==='CLOSED'?'Saved closed session restored.':'Saved session restored. The media stream is not automatically reconnected.');}).catch(error=>setNotice(error.message));}
        return()=>{if(closeTimer.current)clearTimeout(closeTimer.current);if(audioMonitor.current)clearInterval(audioMonitor.current);if(invitationTimer.current)clearTimeout(invitationTimer.current);if(audio.current)void audio.current.context.close().catch(()=>{});if(client.current&&!stopped.current){stopped.current=true;void client.current.stopStreaming();}};
    // This effect restores once; mutable SDK lifecycle is held in refs.
    },[apiPath,storageKey,previewStates,render]);
    async function start(){
        setBusy(true);setNotice('Connecting to the current James persona…');failed.current=false;stopped.current=false;closing.current=false;
        personaSpeaking.current=false;visitorSpeaking.current=false;
        closeEpoch.current++;closeInFlight.current=false;speechStarts.current.clear();
        if(closeTimer.current)clearTimeout(closeTimer.current);closeTimer.current=null;
        if(audioMonitor.current)clearInterval(audioMonitor.current);audioMonitor.current=null;
        if(notepadDemo)setPadVisibility(initialPadVisibility());setEditing(false);
        if(invitationTimer.current)clearTimeout(invitationTimer.current);invitationTimer.current=null;
        if(audio.current)void audio.current.context.close().catch(()=>{});audio.current=null;
        seen.current.clear();finalized.current.clear();messages.current=[];setHistory([]);setPreview(null);setApproved(false);
        try{
            const operatorCode=emailAccessMode==='visitor'?undefined:accessCode||undefined;
            if(operatorCode)await api('demo-email-preflight',{},operatorCode);
            const launched=await api('start',{},operatorCode);setAccessCode('');id.current=launched.id;
            try{localStorage.setItem(storageKey,launched.id);}catch{/* The active call can continue without reload recovery. */}
            render(launched);
            const c=createClient(launched.sessionToken);client.current=c;
            let resolveBinding:()=>void,rejectBinding:(error:Error)=>void;
            const binding=new Promise<void>((resolve,reject)=>{resolveBinding=resolve;rejectBinding=reject;});chain.current=binding;
            c.addListener(AnamEvent.SESSION_READY,providerId=>{
                void api('bind',{providerId}).then(s=>{render(s);setNotice('Connected. Speak naturally; only finalized visitor information updates the brief.');resolveBinding();})
                    .catch(error=>{failed.current=true;setNotice(error.message);rejectBinding(error);if(!stopped.current){stopped.current=true;void c.stopStreaming();}});
            });
            c.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED,event=>{
                if(event.role==='persona'){
                    if(!speechStarts.current.has(event.id))speechStarts.current.set(event.id,performance.now());
                    personaSpeaking.current=!event.endOfSpeech&&!event.interrupted;
                    if(event.interrupted)cancelPendingClose();
                }
                if(event.role==='user'&&!event.endOfSpeech&&latest.current?.websiteClosing)cancelPendingClose();
                // SDK emits the stream event BEFORE appending its final chunk to history.
                // Only the subsequent HISTORY_UPDATED event may enqueue the assembled reply.
                if(event.endOfSpeech===true && !event.interrupted)finalized.current.add(event.id);
            });
            c.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED,items=>{
                messages.current=items.filter(t=>t.role==='user'||t.role==='persona').map(t=>({id:t.id,role:t.role as Turn['role'],content:t.content}));
                setHistory(messages.current);queueHistory();
            });
            c.addListener(AnamEvent.USER_SPEECH_STARTED,()=>{visitorSpeaking.current=true;if(audio.current)audio.current.quietSince=null;if(latest.current?.websiteClosing)cancelPendingClose();});
            c.addListener(AnamEvent.USER_SPEECH_ENDED,()=>{visitorSpeaking.current=false;});
            c.addListener(AnamEvent.AUDIO_STREAM_STARTED,stream=>{
                try{
                    if(audio.current)void audio.current.context.close().catch(()=>{});
                    const context=new AudioContext(),source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();
                    analyser.fftSize=1024;source.connect(analyser);audio.current={context,source,analyser,quietSince:null,lastSoundAt:0};
                    if(audioMonitor.current)clearInterval(audioMonitor.current);
                    audioMonitor.current=setInterval(()=>{
                        const probe=audio.current;if(probe?.context.state!=='running')return;
                        const samples=new Float32Array(probe.analyser.fftSize);probe.analyser.getFloatTimeDomainData(samples);
                        const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
                        if(rms>=0.006){probe.lastSoundAt=performance.now();probe.quietSince=null;}
                        else if(!personaSpeaking.current&&!visitorSpeaking.current)probe.quietSince??=performance.now();
                    },100);
                    void context.resume().catch(()=>{}); // Failure keeps spoken review off, not guessed.
                }catch{/* A visible deterministic review still works without Web Audio. */}
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
    function briefAction(action:string,body:object={}){
        if(previewStates)return;
        setBusy(true);
        chain.current=chain.current.then(async()=>{
            const s=await api(action,body);render(s);setEditing(false);setEditValue('');
            setNotice(action==='confirm-brief'?'You confirmed this intake brief. This is not consent to email or end the call.'
                :action==='correct-brief'?'Correction applied. Please review and confirm the updated brief.'
                :'Intake brief organized for review. Check the fields and make any corrections.');
            scheduleInvitation();
        }).catch(error=>setNotice(error instanceof Error?error.message:'Brief review needs attention')).finally(()=>setBusy(false));
    }
    function advancePreview(){
        const index=(previewIndex+1)%(previewStates?.length||1);setPreviewIndex(index);
        const next=previewStates?.[index].state;
        if(next)render(next);else{latest.current=null;setState(null);setPadVisibility(initialPadVisibility());}
    }
    const active=state&&state.state!=='CLOSED';
    return <main className="fixed inset-0 z-[110] overflow-auto bg-zinc-950 p-4 text-white sm:p-6">
        <header className="mx-auto mb-4 flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs tracking-widest text-amber-300">{notepadDemo?'AI FUSION LABS · JAMES LEGAL PAD DEMO':'JAMES vNEXT · CANARY / DEMO'}</p><h1 className="font-serif text-3xl">A conversation with James</h1></div>
            <Link href="/" className="text-sm underline">X-Agent website</Link>
        </header>
        {previewStates&&<div className="mx-auto mb-4 flex max-w-7xl items-center gap-4 border border-amber-300/30 p-3 text-sm"><span>Local fictional-data preview: {previewStates[previewIndex].label}</span><button className="rounded border px-3 py-2" onClick={advancePreview}>Advance preview</button></div>}
        <div className={'mx-auto grid max-w-7xl gap-5 '+(padOpen?'lg:grid-cols-2':'')}>
            <section className={padOpen?'lg:sticky lg:top-0 lg:self-start':''}><video id="james-canary-video" autoPlay playsInline poster={notepadDemo?'/agents/thumbnails/james-knowles-cara4-20261001.png':undefined} className={'w-full rounded-xl bg-black object-contain '+(padOpen?'aspect-[4/3]':'h-[calc(100dvh-19rem)] min-h-[320px]')}/>
                {!launchReady&&<p role="alert" className="mt-3 rounded border border-amber-200/40 p-3 text-sm text-amber-200">Layout preview only. Live calls are disabled until this demo’s session storage and Anam settings are configured.</p>}
                <p role="status" className="my-3 text-sm text-zinc-200">{notice}</p>
                {notepadDemo&&emailAccessMode!=='visitor'&&!active&&<details className="mb-4 rounded border border-white/20 p-3"><summary className="cursor-pointer text-sm">Operator email test (optional)</summary><label className="mt-3 block text-xs">{emailAccessMode==='reusable'?'Reusable demo access code':'One-use demo access code'}<input type="password" autoComplete="off" value={accessCode} onChange={e=>setAccessCode(e.target.value)} disabled={busy} className="mt-2 block w-full rounded border border-white/30 bg-zinc-900 p-2 text-white"/></label><p className="mt-2 text-xs text-zinc-400">{emailAccessMode==='reusable'?'Use the same private code for each new call. Each call requires its own summary review and approval. ':'Leave blank for a notes-only call. '}Codes are never saved in browser storage or URLs.</p>{emailAccessMode==='reusable'&&<p className="mt-2 text-xs text-zinc-400">Leave blank to keep this call notes-only. The reusable code does not expire; each call’s email authorization lasts up to 24 hours.</p>}</details>}
                <div className="flex flex-wrap gap-3"><button onClick={()=>void start()} disabled={busy||Boolean(active)||!launchReady} className="rounded bg-white px-5 py-3 font-semibold text-black disabled:opacity-40">Start James</button>
                    <button onClick={()=>void close()} disabled={busy||!active||Boolean(previewStates)} className="rounded border border-white/40 px-5 py-3 disabled:opacity-40">{state?.state==='CLOSING'?'Verify closure':'End conversation'}</button>
                    <button aria-expanded={padOpen} aria-controls="james-legal-pad" onClick={changePad} className="rounded border border-amber-300/60 px-5 py-3 text-amber-200">{padOpen?'Hide legal pad':'Show legal pad'}</button>
                    {notepadDemo&&state?.intakeBrief?.hasSubstantiveFact&&state.intakeBrief.phase==='COLLECTING'&&<button onClick={()=>briefAction('finalize-brief')} disabled={busy||Boolean(previewStates)} className="rounded border border-amber-300/40 px-4 py-3 text-amber-200 disabled:opacity-40">Review intake brief</button>}</div>
                {!padOpen&&state?.intakeBrief?.phase==='REVIEW'&&<p className="mt-3 text-sm text-amber-200">Your brief is ready for review. Show the legal pad to check and confirm it.</p>}
                <p className="mt-4 text-xs text-zinc-400">Use fictional case details only. This is not legal advice or a submission to Knowles. {state?.demo_email_authorized?'Email testing is authorized for this session, but requires post-call review and explicit approval.':state?.owner_test?'Legacy owner email test; inspect its send status.':'Email sending is off for this session.'} Notes expire 24 hours after their last saved update. Anam transcripts and emailed copies have separate retention rules.</p>
                {state&&<p className="mt-2 text-xs text-zinc-400">{state.state} · {state.acceptedVisitorTurns} visitor turns · {state.config.voiceName} · Session {state.id.slice(-8)}</p>}
                {state?.speech_review_required&&<p role="alert" className="mt-3 border-l-2 border-amber-400 pl-3 text-sm text-amber-200">Possible instruction leakage detected in James’s captions. Email preparation is blocked for review. This does not filter or prevent spoken audio.</p>}
                {!!state?.demo_email_status.length&&<ul className="mt-4 space-y-2 text-sm">{state.demo_email_status.map(result=><li key={result.lane}>{result.lane==='internal'?'Internal summary':'Caller recap'} to {result.recipient}: {result.status==='SENT'?'accepted by AgentMail':result.status==='RESERVED'?'pending or unknown — do not retry':'no verified receipt — do not retry'}.</li>)}</ul>}
                {notepadDemo&&state?.state==='CLOSED'&&state.demo_email_authorized&&!state.demo_email_status.length&&<button onClick={()=>void previewEmails()} disabled={busy||state.speech_review_required||state.intakeBrief?.phase!=='CONFIRMED'||Boolean(state.intakeBrief?.missing.length)} className="mt-4 rounded bg-amber-200 px-5 py-3 font-semibold text-zinc-950 disabled:opacity-40">Review demo emails</button>}
                {preview&&<section className="mt-5 rounded border border-amber-200/40 p-4" aria-label="Demo email review"><h2 className="font-serif text-xl">Review before sending</h2><p className="my-2 text-xs">From AI Fusion Labs Demo ({preview.sender}) · Replies to {preview.replyTo}</p>{preview.messages.map(m=><details key={m.lane} className="my-3"><summary>{m.lane==='internal'?'Internal review summary':'Caller recap'} → {m.to}</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{m.text}</pre></details>)}<label className="my-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} disabled={busy}/><span>I reviewed both summaries, confirm these are fictional demo case details, and authorize one internal email plus one recap to {preview.callerAddress}. I have permission to use this caller mailbox.</span></label><button onClick={()=>void sendEmails()} disabled={busy||!approved} className="rounded bg-amber-200 px-5 py-3 font-semibold text-zinc-950 disabled:opacity-40">Email both demo summaries</button></section>}
                <details className="mt-4"><summary className="text-sm">Conversation captions</summary>{history.map((t,i)=><p key={t.id+':'+i} className="my-2 text-sm"><strong>{t.role==='user'?'Visitor':'James'}: </strong>{t.content}</p>)}</details>
            </section>
            {padOpen&&<aside id="james-legal-pad" className="relative rounded-b-lg border-t-[14px] border-amber-800 bg-[#fff1a8] py-6 pl-12 pr-6 text-zinc-900 shadow-xl" style={{backgroundImage:'linear-gradient(90deg, transparent 35px, #df827966 35px, #df827966 37px, transparent 37px), repeating-linear-gradient(transparent 0px, transparent 27px, #b7a56b44 27px, #b7a56b44 28px)'}} aria-label="James legal pad">
                <div className="mb-6 flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.2em] text-amber-900">Knowles · demonstration intake</p><h2 className="mt-1 font-serif text-2xl">James’s intake brief</h2></div><span className="rounded border border-amber-800/25 px-2 py-1 text-[10px] uppercase tracking-wider">{state?.intakeBrief?.phase==='CONFIRMED'?'Confirmed':state?.intakeBrief?.phase==='REVIEW'?'Review':'In progress'}</span></div>
                <p className="mb-5 text-xs text-zinc-700">{state?.intakeBrief?.phase==='REVIEW'?'Please review these organized details. Tell James what needs changing, or edit a field below.':state?.intakeBrief?.phase==='CONFIRMED'?'You confirmed this version. Any new correction will require another review.':'Key details appear quietly as the intake progresses. This is a brief, not the conversation transcript.'}</p>
                {notepadDemo?<>
                    {!state?.intakeBrief?.hasSubstantiveFact&&<p className="py-8 font-serif italic text-zinc-600">{state&&!state.intakeBrief?'Start a new call for the structured intake brief.':'Waiting for your first intake detail…'}</p>}
                    {state?.intakeBrief?.sections.map(section=><section key={section.title} className="mb-6"><h3 className="mb-3 border-b border-amber-700/20 pb-1 text-[11px] font-bold uppercase tracking-[0.15em]">{section.title}</h3><dl className="space-y-3">{section.rows.map(row=><div key={row.key}><dt className="text-[11px] font-semibold text-amber-950/80">{row.label}{['name','phone','email'].includes(row.key)&&row.sourceIds.length>0&&<span className="ml-2 font-normal text-zinc-600">{row.confirmed?'verified':'not yet verified'}</span>}</dt><dd className={'mt-0.5 text-sm leading-relaxed '+(!row.sourceIds.length?'italic text-zinc-500':'')}>{row.value}</dd></div>)}</dl></section>)}
                    {state?.intakeBrief&&state.intakeBrief.phase!=='COLLECTING'&&<section className="mt-6 border-t border-amber-700/25 pt-4" aria-label="Intake brief review">
                        {!!state.intakeBrief.missing.length&&<p className="mb-3 text-xs text-amber-950">Partial intake · still open: {state.intakeBrief.missing.join(', ')}. Confirming this brief does not fill those gaps.</p>}
                        <div className="flex flex-wrap gap-2"><button onClick={()=>briefAction('confirm-brief',{snapshotHash:state.intakeBrief!.hash})} disabled={busy||state.intakeBrief.phase==='CONFIRMED'||Boolean(previewStates)||Boolean(state.demo_email_status.length)} className="rounded bg-amber-950 px-4 py-2 text-sm text-amber-50 disabled:opacity-40">{state.intakeBrief.phase==='CONFIRMED'?'Brief confirmed':'Confirm brief'}</button><button onClick={()=>{if(!editing&&active)cancelPendingClose();setEditing(v=>!v);}} disabled={busy||Boolean(state.demo_email_status.length)} className="rounded border border-amber-950/40 px-4 py-2 text-sm">Correct a field</button></div>
                        {editing&&<form onSubmit={event=>{event.preventDefault();briefAction('correct-brief',{slot:editSlot,value:editValue,snapshotHash:state.intakeBrief!.hash});}} className="mt-4 space-y-3">
                            <label className="block text-xs">Field<select value={editSlot} onChange={event=>setEditSlot(event.target.value)} className="mt-1 block w-full rounded border border-amber-900/30 bg-amber-50/70 p-2">{state.intakeBrief.editableSlots.map(slot=><option key={slot.key} value={slot.key}>{slot.label}</option>)}</select></label>
                            <label className="block text-xs">Correct value<input value={editValue} onChange={event=>setEditValue(event.target.value)} maxLength={1000} required className="mt-1 block w-full rounded border border-amber-900/30 bg-amber-50/70 p-2"/></label>
                            <p className="text-xs text-zinc-600">Save only the value for this field. Saving explicitly confirms that corrected field, not the entire brief.</p>
                            <button type="submit" disabled={busy||Boolean(previewStates)} className="rounded bg-amber-950 px-4 py-2 text-sm text-amber-50 disabled:opacity-40">Save correction</button>
                        </form>}
                    </section>}
                </>:state?.brief.map(section=><section key={section.title} className="mb-5"><h3 className="border-b border-amber-200 pb-1 text-xs font-bold tracking-widest">{section.title}</h3><ul className="mt-2 space-y-2">{section.items.map((item,i)=><li key={i} className="text-sm">{item.label&&<span className="font-semibold">{item.label.replaceAll('_',' ')}: </span>}{item.text}</li>)}</ul></section>)}
                <p className="mt-5 text-xs text-zinc-600">Visitor-reported information only. Nothing submitted to Knowles; firm acceptance, review and follow-up are not confirmed. {state?.providerRelease?'Provider transcript verified separately.':''}</p>
                {state&&<p className="border-t border-amber-300 pt-3 text-xs">Receipt revision {state.revision} · {state.stateHash.slice(0,12)} · {state.external_actions.length?'Demo email activity shown separately — nothing submitted to Knowles':'UNSUBMITTED · No external actions'}</p>}
            </aside>}
        </div>
    </main>;
}
