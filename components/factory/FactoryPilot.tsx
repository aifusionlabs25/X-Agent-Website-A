'use client';
import { useEffect,useRef,useState } from 'react';
import { AnamEvent,createClient,type AnamClient } from '@anam-ai/js-sdk';
import type { Handoff,Field,Turn } from '@/lib/factory/handoff';
import { liveTranscript,submitTypedTurn } from '@/lib/factory/live-transcript';
import { sdkCloseTracker,type SdkCloseTracker,type CloseReason } from '@/lib/factory/sdk-close';
import { collectionReferenceContext,submitHandoff,closedSessionStatus,toolEvidenceCallbacks,handoffRequestStatus } from '@/lib/factory/handoff-context';
import { committedTurnEffects } from '@/lib/factory/turn-effects';
import {contextSendTracker,type ContextSendTracker} from '@/lib/factory/context-send';
import { exitReceipt,exitReplyObserver } from '@/lib/factory/exit-receipt';
import { contradictingCorrection } from '@/lib/factory/handoff-corrections';
import { createFarewellCloseCoordinator,type FarewellCloseCoordinator } from '@/lib/anam/farewell-close-coordinator';
import styles from './pilot.module.css';
type Manifest={name:string;persona_id:string;voice_name:string;package_sha256:string;configured_fields:Field[]};
export default function FactoryPilot() {
    const [manifest,setManifest]=useState<Manifest|null>(null),[state,setState]=useState<Handoff|null>(null);
    const [error,setError]=useState(''),[busy,setBusy]=useState(false),[text,setText]=useState(''),[muted,setMuted]=useState(false);
    const [mappingField,setMappingField]=useState(''),[mappingTurn,setMappingTurn]=useState(''),[span,setSpan]=useState('');
    const [status,setStatus]=useState('Loading the approved Preview…');
    const [drafts,setDrafts]=useState<Turn[]>([]),[transport,setTransport]=useState<unknown[]>([]);
    const [history,setHistory]=useState<Handoff[]>([]);
    const [closeTrace,setCloseTrace]=useState<ReturnType<SdkCloseTracker['snapshot']>|null>(null);
    const current=useRef<Handoff|null>(null), client=useRef<AnamClient|null>(null), queue=useRef<Promise<unknown>>(Promise.resolve());
    const stopping=useRef(false),farewell=useRef<FarewellCloseCoordinator|null>(null);
    const submitting=useRef(false);
    const closer=useRef<SdkCloseTracker|null>(null);
    const contextSender=useRef<ContextSendTracker|null>(null);
    const accept=(s:Handoff|null)=>{current.current=s;setState(s);};
    async function refresh() {
        const r=await fetch('/api/factory/pilot',{cache:'no-store'}), v=await r.json();
        if(!r.ok) throw new Error(v.error||'Preview unavailable'); setManifest(v.manifest);accept(v.state);setHistory(v.history||[]);
        setStatus(v.state?.status==='CLOSED'?closedSessionStatus(v.state):v.state?.status||'Ready when you are. No session has started.');
    }
    useEffect(()=>{void refresh().catch(e=>setError(e.message));return()=>{farewell.current?.dispose();if(client.current&&!stopping.current){stopping.current=true;void closer.current?.close('UNMOUNT').catch(()=>{});}};},[]); // only hydrate, never auto-launch
    function post(action:string, data:Record<string,unknown>={}) {
        const request_id=crypto.randomUUID();
        const run=async()=>{
            const r=await fetch('/api/factory/pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,request_id,version:current.current?.version,...data})});
            const v=await r.json();if(!r.ok)throw new Error(v.error||'Operation blocked');if(v.state)accept(v.state);return v;
        };
        const result=queue.current.then(run); queue.current=result.catch(e=>{setError(e.message);});return result;
    }
    async function reconcile() {setStatus('Checking provider release and original transcript…');const r=await post('reconcile');setStatus(closedSessionStatus(r.state));}
    async function stop(reason:CloseReason='OWNER_FINISH') {
        if(stopping.current||!client.current)return;stopping.current=true;farewell.current?.dispose();
        setStatus('Closing the Anam session…');
        // Storage/context failure must not prevent the actual SDK release.
        if(current.current?.status==='ACTIVE')try{await post('closing');}catch(e){setError(e instanceof Error?e.message:'Closing state not retained; provider reconciliation is required.');}
        if(!closer.current)throw new Error('SDK close tracker unavailable; preserve the session for reconciliation');
        await closer.current.close(reason);
        await reconcile();
    }
    function armClose() {farewell.current?.arm();}
    function afterTurn(s:Handoff,turn:Turn) {
        committedTurnEffects(s,turn,{armClose,finalReply:()=>{farewell.current?.completeFarewell();},
            context:(message,kind)=>{
                if(!contextSender.current)throw new Error('Context sender unavailable');
                contextSender.current.send(kind,turn.id,message);
            },
            contextFailure:()=>setError('Session context delivery was unavailable. Saved request and closure state remain authoritative; no preparation success is implied.')});
    }
    async function launch() {
        if(busy||current.current)return;setBusy(true);setError('');setStatus('Verifying exact persona, image, voice and storage…');
        try {
            const r=await post('start');const c=createClient(r.sessionToken);client.current=c;
            let binding:Promise<unknown>=Promise.resolve();const transcript=liveTranscript(),exitReplies=exitReplyObserver();
            let boundProviderId:string|null=null;
            const launchState=r.state as Handoff;
            const contextTracker=contextSendTracker({send:message=>c.addContext(message),report:event=>{
                if(!boundProviderId)throw new Error('Context evidence requires a bound provider session');
                return post('context_send_receipt',{receipt:{...event,local_session_id:launchState.id,
                    provider_session_id:boundProviderId,launch_label:launchState.launch_label}}).catch(()=>{
                    setError('Context-send evidence could not be retained. Provider receipt and model consumption are unverified.');
                    throw new Error('Context telemetry unavailable');
                });
            }});
            contextSender.current=contextTracker;
            const tracker=sdkCloseTracker({stop:()=>c.stopStreaming(),report:event=>{
                if(event.reason!=='UNMOUNT')setCloseTrace(tracker.snapshot());
                return binding.then(()=>post('sdk_close_receipt',{receipt:{...event,
                    local_session_id:launchState.id,launch_label:launchState.launch_label,provider_session_id:boundProviderId}}));
            }});
            closer.current=tracker;
            farewell.current=createFarewellCloseCoordinator({stopStreaming:()=>stop('VISITOR_EXIT'),
                onStopError:()=>setError('Session close could not be verified. Preserve the session for reconciliation.')});
            c.addListener(AnamEvent.SESSION_READY,id=>{boundProviderId=id;binding=post('bind',{provider_session_id:id});void binding.then(()=>{
                contextTracker.send('COLLECTION',null,collectionReferenceContext(manifest?.configured_fields||[]));
                setStatus('Connected — Olivia · Cindy voice');
            }).catch(e=>{setError(e.message);if(!stopping.current){stopping.current=true;void tracker.close('BIND_FAILED').catch(()=>{});}});});
            const persist=(turns:Turn[])=>{
                for(const turn of turns) {
                    void binding.then(()=>post('turn',{turn})).then(v=>{
                        afterTurn(v.state,turn);
                    }).catch(e=>setError(e.message));
                }
                setDrafts(transcript.drafts());setTransport(transcript.trace());
            };
            c.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED,e=>{
                try{exitReplies.observe(e);persist(transcript.stream(e));}catch(e){setError(e instanceof Error?e.message:'Transcript stream failed');}
            });
            c.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED,messages=>{
                try{messages.forEach(m=>exitReplies.observe(m));persist(transcript.history(messages));}catch(e){setError(e instanceof Error?e.message:'Transcript history failed');}
            });
            const evidenceCallbacks=toolEvidenceCallbacks(event=>post('tool_receipt',event),e=>setError(e instanceof Error?e.message:'Tool evidence could not be retained'));
            c.registerToolCallHandler('factory_handoff',{...evidenceCallbacks,onStart:async p=>{
                await binding;
                return submitHandoff(p.arguments.proposals,async proposals=>(await post('provider_handoff',{proposals,
                    local_session_id:launchState.id,provider_session_id:p.sessionId,tool_call_id:p.toolCallId})).toolResult);
            }});
            c.registerToolCallHandler('factory_end_session',{...evidenceCallbacks,onStart:async p=>{
                await binding; await post('closing');armClose();
                return JSON.stringify(exitReceipt(exitReplies.receipt(p.userActionCorrelationId)));
            }});
            c.addListener(AnamEvent.CONNECTION_CLOSED,()=>{if(!stopping.current){stopping.current=true;void reconcile().catch(e=>setError(e.message));}});
            await c.streamToVideoElement('factory-olivia-video');
        }catch(e){setError(e instanceof Error?e.message:'Launch failed. Do not retry an unknown launch.');}
        finally{setBusy(false);}
    }
    async function action(name:string, data:Record<string,unknown>={}) {setBusy(true);setError('');try{await post(name,data);}catch(e){setError(e instanceof Error?e.message:'Blocked');}finally{setBusy(false);}}
    async function freshConversation() {
        if(busy||!current.current)return;
        setBusy(true);setError('');
        try {
            await post('new_conversation',{session_id:current.current.id});
            // A full reload discards the old SDK listeners and pending event
            // closures; none can be rebound to the next conversation.
            window.location.reload(); // Never mint a token or auto-start here.
        } catch(e){setError(e instanceof Error?e.message:'Fresh conversation blocked');}
        finally{setBusy(false);}
    }
    function downloadSaved(saved:Handoff) {
        const blob=new Blob([JSON.stringify({handoff:saved,kind:'SAVED_SESSION_EVIDENCE',submission_status:'UNSUBMITTED'},null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='factory-'+saved.id+'-saved-evidence.json';a.click();URL.revokeObjectURL(url);
    }
    const active=state?.status==='ACTIVE'&&!stopping.current;
    async function sendText() {
        const c=client.current;
        if(!active||!c||!text.trim()||submitting.current)return;
        submitting.current=true;const content=text.trim();setText('');setError('');
        const turn:Turn={id:'typed-visitor::'+crypto.randomUUID(),role:'user',content};
        try {
            await submitTypedTurn(turn,t=>post('turn',{turn:t}),t=>{
                if(!current.current)throw new Error('Committed session state unavailable');
                afterTurn(current.current,t);
                c.sendUserMessage(t.content);
            });
        } catch(e){setError((e instanceof Error?e.message:'Typed message dispatch failed')+' — no automatic resubmission. Provider evidence must be reconciled.');}
        finally{submitting.current=false;}
    }
    function download() {if(!state?.approved)return;const blob=new Blob([JSON.stringify({manifest,handoff:state},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='factory-'+state.id+'-UNSUBMITTED.json';a.click();URL.revokeObjectURL(url);}
    const unresolved=state?.proposals.filter(p=>!state.decisions.some(d=>d.proposal_id===p.id))||[];
    const corrected=state?.proposals.filter(p=>contradictingCorrection(state.turns,p.visitor_message_id,p.evidence))||[];
    return <main className={styles.page}>
        <div className={styles.mast}><span>AIowa / X–Factory</span><span>PRIVATE OWNER PREVIEW · NOT RELEASED</span></div>
        <header className={styles.heading}><p>Practical guidance. Human judgment.</p><h1>{manifest?.name||'AIowa Service Guide'}</h1><div>Olivia, with Cindy’s voice. An AI assistant — not Tony Simons.</div></header>
        <div className={styles.grid}>
            <section className={styles.conversation} aria-label="Olivia conversation">
                <div className={styles.stage}><video id="factory-olivia-video" autoPlay playsInline poster="/factory-aiowa-approved.png" aria-label="Olivia live avatar"/></div>
                <div className={styles.controls}><p role="status">{status}</p>
                    {!state&&<button onClick={()=>void launch()} disabled={busy||!manifest}>Start private conversation</button>}
                    {state?.status==='CLOSED'&&<><button disabled={busy||!state.provider_release_verified||!state.provider_transcript_verified} onClick={()=>void freshConversation()}>Start new conversation</button><small>This saves the closed session below and opens an empty page. Review and export any handoff first; saved records are read-only. You will click Start private conversation separately.</small></>}
                    {state&&!client.current&&state.status!=='CLOSED'&&<p>This saved session cannot be silently restarted. Check its closure before starting another.</p>}
                    {active&&<><button onClick={()=>{const c=client.current;if(c){if(muted)c.unmuteInputAudio();else c.muteInputAudio();setMuted(!muted);}}}>{muted?'Enable microphone':'Mute microphone'}</button><button className={styles.secondary} onClick={()=>void stop().catch(e=>setError(e.message))}>Finish conversation</button></>}
                    <form onSubmit={e=>{e.preventDefault();void sendText();}}><label htmlFor="visitor-input">Or type your message</label><div className={styles.inline}><input id="visitor-input" value={text} onChange={e=>setText(e.target.value)} disabled={!active} placeholder="Your question or workflow…"/><button disabled={!active||!text.trim()}>Send</button></div></form>
                    <small>Microphone access starts only after you click Start. Use synthetic information for this owner QA Preview.</small>
                </div>
                {drafts.length>0&&<div className={styles.transcript} aria-label="Live transcript — awaiting finalization">{drafts.map(t=><p key={t.id}><strong>Olivia · live, not yet finalized</strong><br/>{t.content}</p>)}</div>}
                <details className={styles.transcript}><summary>Original conversation evidence ({state?.turns.length||0} turns)</summary>{state?.turns.map(t=><p key={t.id}><strong>{t.role==='user'?'Visitor':'Olivia'}</strong><br/>{t.content}</p>)}</details>
                <details><summary>Transcript transport diagnostics</summary><p>SDK event metadata only; not proof of spoken delivery.</p><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(transport,null,2)}</pre></details>
                <details><summary>Session-close evidence</summary><p>Client-instrumented SDK invocation/result only. Verified provider release is a separate receipt.</p><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify({local:closeTrace,persisted:state?.sdk_close_events||[]},null,2)}</pre></details>
                <details><summary>Previous test sessions ({history.length})</summary><p>Read-only evidence, retained for a limited time—not permanent storage. Download records you want to keep.</p>{history.map(s=><div key={s.id}><p>{s.id} · {s.status} · {s.turns.length} turns · {s.approved?'Handoff approved':'Handoff not approved'}</p><button onClick={()=>downloadSaved(s)}>Download saved session</button></div>)}</details>
            </section>
            <aside className={styles.review} aria-label="Owner handoff review"><div className={styles.label}>OWNER OPERATIONS</div><h2>A handoff, not an action.</h2><p>UNSUBMITTED · No email, booking, CRM update or external business action.</p>
                <dl className={styles.meta}><div><dt>Package</dt><dd>{manifest?.package_sha256.slice(0,12)}</dd></div><div><dt>Session</dt><dd>{state?.status||'Not started'}</dd></div><div><dt>Provider release</dt><dd>{state?.provider_release_verified?'Verified':'Not verified'}</dd></div></dl>
                <h3>Configured collection fields</h3>{manifest?.configured_fields.map(f=>{const values=state?.proposals.filter(p=>p.field_id===f.id&&!corrected.some(c=>c.id===p.id)&&state.decisions.some(d=>d.proposal_id===p.id&&d.decision==='ACCEPT'));return <div key={f.id} className={styles.field}><strong>{f.label}</strong>{values?.length?values.map(p=><p key={p.id}>{p.value}</p>):<span>Not owner-mapped</span>}</div>;})}
                <h3>Proposals awaiting owner decision</h3>{unresolved.length===0?<p>No pending field proposals. Unmapped visitor words remain in the original evidence.</p>:unresolved.map(p=><div key={p.id} className={styles.proposal}><strong>{manifest?.configured_fields.find(f=>f.id===p.field_id)?.label}</strong><blockquote>{p.evidence}</blockquote>{corrected.some(c=>c.id===p.id)&&<p>Outdated evidence — a later visitor correction needs a new exact mapping. This earlier value cannot be accepted as current.</p>}<button disabled={busy||!state?.provider_transcript_verified||corrected.some(c=>c.id===p.id)} onClick={()=>void action('decision',{proposal_id:p.id,decision:'ACCEPT'})}>Accept exact mapping</button><button className={styles.secondary} disabled={busy||!state?.provider_transcript_verified} onClick={()=>void action('decision',{proposal_id:p.id,decision:'REJECT'})}>Do not adopt</button></div>)}
                {corrected.length>0&&<p>A visitor correction is still awaiting an exact current mapping. Earlier evidence is preserved; approval remains separate.</p>}
                {Boolean(state?.superseded_mappings?.length)&&<details><summary>Replaced mappings — historical evidence</summary>{state?.superseded_mappings?.map(row=><div key={row.proposal.id} className={styles.proposal}><strong>{manifest?.configured_fields.find(f=>f.id===row.proposal.field_id)?.label}</strong><p>Earlier value, no longer current:</p><blockquote>{row.proposal.evidence}</blockquote><p>Visitor correction:</p><blockquote>{row.correction_turn.content}</blockquote><p>The replacement is a separate proposal requiring its own owner decision.</p></div>)}</details>}
                {state&&handoffRequestStatus(state)&&<p>{handoffRequestStatus(state)}</p>}
                {Boolean(state?.quarantined_proposals?.length)&&<details><summary>Unmapped proposals — not adopted</summary>{state?.quarantined_proposals?.map(q=><div className={styles.proposal} key={q.request_id}><strong>{q.reason}</strong><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(q.proposals,null,2)}</pre><p>Needs owner clarification or a new exact mapping. No active Accept action is available for this invalid proposal.</p></div>)}</details>}
                {(active||state?.status==='CLOSED')&&<details><summary>Map exact visitor words</summary><p>Owner mapping, not semantic inference. Corrections and prior evidence remain visible.</p><select aria-label="Collection field" value={mappingField} onChange={e=>setMappingField(e.target.value)}><option value="">Choose field</option>{manifest?.configured_fields.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select><select aria-label="Visitor evidence" value={mappingTurn} onChange={e=>{setMappingTurn(e.target.value);setSpan(state?.turns.find(t=>t.id===e.target.value)?.content||'');}}><option value="">Choose visitor message</option>{state?.turns.filter(t=>t.role==='user').map(t=><option key={t.id} value={t.id}>{t.content}</option>)}</select><textarea aria-label="Exact evidence span" value={span} onChange={e=>setSpan(e.target.value)}/><button disabled={busy||!mappingField||!mappingTurn||!span} onClick={()=>void action('handoff',{proposals:[{field_id:mappingField,visitor_message_id:mappingTurn,evidence:span,value:span}]})}>Propose exact mapping</button></details>}
                {state?.provider_session_id&&<button className={styles.secondary} disabled={busy} onClick={()=>void reconcile().catch(e=>setError(e.message))}>Verify closure &amp; reconcile evidence</button>}
                {state?.status==='CLOSED'&&<><button disabled={busy||!state.provider_transcript_verified||state.evidence_reviewed} onClick={()=>void action('review_evidence')}>I reviewed all original evidence &amp; uncertainties</button><button disabled={busy||!state.evidence_reviewed||unresolved.length>0||corrected.some(p=>state.decisions.some(d=>d.proposal_id===p.id&&d.decision==='ACCEPT'))||state.approved} onClick={()=>void action('approve')}>Approve unsubmitted handoff</button><button disabled={!state.approved} onClick={download}>Download JSON</button></>}
                <p className={styles.footnote}>Field fit, unresolved questions and corrections remain an owner-review responsibility. Approval does not send anything. Encrypted handoff storage expires after 7 days; provider QA retention is separate.</p>
            </aside>
        </div>
        {error&&<div className={styles.error} role="alert">{error}<br/>No automatic retry has been made.</div>}
    </main>;
}
