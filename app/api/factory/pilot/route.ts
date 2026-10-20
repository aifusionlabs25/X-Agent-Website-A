import { NextRequest,NextResponse } from 'next/server';
import { createHmac,randomBytes,timingSafeEqual,randomUUID,createHash } from 'node:crypto';
import manifest from '@/config/factory/aiowa-service-guide.json';
import { appendTurn,propose,decide,approve,digest,type Handoff,type Turn,type Proposal } from '@/lib/factory/handoff';
import * as store from '@/lib/factory/store';
import { fetchAnamSessionMetadata } from '@/lib/anam/session-api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const cookie='factory_preview_owner_v1';
function gate() {
    if(process.env.VERCEL_ENV!=='preview') throw new Error('PREVIEW_ENVIRONMENT_REQUIRED');
    if(process.env.VERCEL_GIT_COMMIT_REF!==manifest.branch) throw new Error('PREVIEW_BRANCH_MISMATCH');
    if(process.env.FACTORY_DELIVERY_ENABLED?.trim()!=='true') throw new Error('PREVIEW_ENABLE_FLAG_MISSING');
    if((process.env.FACTORY_DELIVERY_SECRET||'').length<32) throw new Error('PREVIEW_BRANCH_SECRET_MISSING');
}
function mac(id:string) { return createHmac('sha256',process.env.FACTORY_DELIVERY_SECRET||'').update('factory-owner:'+id).digest('hex'); }
function browser(req:NextRequest) { const [id='',signature='']= (req.cookies.get(cookie)?.value||'').split('.'); const expected=mac(id); return /^[a-f0-9]{32}$/.test(id) && signature.length===expected.length && timingSafeEqual(Buffer.from(signature),Buffer.from(expected)) ? id:null; }
function response(data:unknown,id?:string) { const r=NextResponse.json(data,{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}}); if(id) r.cookies.set(cookie,id+'.'+mac(id),{httpOnly:true,secure:true,sameSite:'strict',path:'/api/factory',maxAge:7*86400}); return r; }
async function provider(path:string, body?:unknown) {
    const key=process.env.ANAM_API_KEY; if(!key) throw new Error('Anam server credential unavailable');
    const r=await fetch('https://api.anam.ai/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    const raw=await r.text(); if(raw.length>1024*1024) throw new Error('Provider response exceeded bound');
    if(!r.ok) throw new Error('Anam request HTTP '+r.status); return JSON.parse(raw);
}
async function checkPersona() {
    const p=await provider('/personas/'+manifest.persona_id);
    const hash=createHash('sha256').update(p.brain?.systemPrompt||'').digest('hex');
    const tools=(p.tools||[]).map((t:{id?:string;_toolId?:string})=>t.id||t._toolId).sort();
    if(p.id!==manifest.persona_id || p.avatar?.id!==manifest.avatar_id || p.voice?.id!==manifest.voice_id
        || p.llmId!==manifest.llm_id || hash!==manifest.prompt_sha256 || p.initialMessage!==manifest.initial_message
        || JSON.stringify(tools)!==JSON.stringify(manifest.tool_ids)) throw new Error('Live persona drift; launch blocked before session token');
    return {persona:true,avatar:true,voice:true,prompt:true,knowledge_tools:true};
}
async function verifySession(state:Handoff, sessionId:string) {
    if(!/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error('Invalid provider session ID');
    const meta=await fetchAnamSessionMetadata(sessionId);
    if(meta.personaId!==manifest.persona_id || meta.clientLabel!==state.launch_label) throw new Error('Provider session/launch binding mismatch');
    return meta;
}
export async function GET(req:NextRequest) {
    try { gate(); const id=browser(req)||randomBytes(16).toString('hex'); const saved=await store.load(id);
        return response({manifest,state:saved.state,history:await store.history(id),source_commit:process.env.VERCEL_GIT_COMMIT_SHA,access:'VERCEL_AUTHENTICATED_PREVIEW',retention:'Encrypted local handoff expires after 7 days; Anam QA retention is separate',release_status:'OWNER_QA_NOT_RELEASED'},id);
    } catch(error) {
        const message=error instanceof Error?error.message:'';
        const code=/^PREVIEW_[A-Z_]+$/.test(message)?message:message.startsWith('Existing project Redis')?'STORE_CONFIGURATION_UNAVAILABLE':message.startsWith('Factory store HTTP')?'STORE_HTTP_REJECTED':'STORE_READ_FAILED';
        console.error('[Factory Preview]',code);
        return NextResponse.json({error:'Private Preview configuration or storage unavailable',code},{status:503});
    }
}
export async function POST(req:NextRequest) {
    let reserved=false;
    try {
        gate(); if(req.headers.get('origin')!==req.nextUrl.origin) return NextResponse.json({error:'Same-origin request required'},{status:403});
        const id=browser(req); if(!id) return NextResponse.json({error:'Open the private Preview first'},{status:401});
        const raw=await req.text(); if(raw.length>128*1024) throw new Error('Request exceeded bound');
        const b=JSON.parse(raw); if(typeof b.request_id!=='string'||!/^[\w-]{8,100}$/.test(b.request_id)) throw new Error('Stable request ID required');
        if(b.action==='preflight') return response({storage:await store.preflight(id),persona:await checkPersona(),manifest});
        const saved=await store.load(id); let state=saved.state;
        if(b.action==='new_conversation') {
            store.requireClosedSession(state);
            if(!state || b.version!==state.version || b.session_id!==state.id || !saved.raw)
                throw new Error('Exact closed session required; reload before continuing');
            await store.archiveClosed(id,saved.raw,state);
            return response({state:null,archived_session_id:state.id});
        }
        if(b.action==='start') {
            if(state) throw new Error('This browser already has a reserved session; do not duplicate an unknown launch');
            await checkPersona(); await store.preflight(id);
            state={id:randomUUID(),version:1,package_sha256:manifest.package_sha256,persona_id:manifest.persona_id,
                launch_label:'factory:'+id+':'+randomUUID(),status:'RESERVED',provider_session_id:null,
                turns:[],proposals:[],decisions:[],receipts:[],processed:[b.request_id],provider_release_verified:false,
                provider_transcript_verified:false,evidence_reviewed:false,approved:false,submission_status:'UNSUBMITTED',external_actions:[]};
            await store.commit(id,saved.raw,state); reserved=true;
            const token=await provider('/auth/session-token',{personaConfig:{personaId:manifest.persona_id},clientLabel:state.launch_label});
            if(typeof token.sessionToken!=='string') throw new Error('Provider token not received; do not retry launch');
            const after=await store.load(id); state.status='TOKEN_READY'; state.version++;
            state.receipts.push({at:new Date().toISOString(),kind:'TOKEN_MINTED',sha256:digest({persona_id:manifest.persona_id,launch_label:state.launch_label})});
            await store.commit(id,after.raw,state); return response({state,sessionToken:token.sessionToken});
        }
        if(!state || state.package_sha256!==manifest.package_sha256 || state.persona_id!==manifest.persona_id) throw new Error('Exact current session binding required');
        if(state.processed.includes(b.request_id)) return response({state,duplicate:true});
        if(b.version!==state.version) throw new Error('Session changed; reload before continuing');
        let toolResult:unknown=null;
        switch(b.action) {
            case 'bind': {
                if(state.status!=='TOKEN_READY' || state.provider_session_id) throw new Error('Session already bound or launch unavailable');
                await verifySession(state,b.provider_session_id); state.provider_session_id=b.provider_session_id; state.status='ACTIVE'; break;
            }
            case 'turn': appendTurn(state,b.turn as Turn); break;
            case 'handoff': {
                try {
                    propose(state,b.proposals as Proposal[],manifest.configured_fields);
                    toolResult={status:'PENDING_OWNER_REVIEW',submission_status:'UNSUBMITTED',external_actions:[],note:'Local proposals retained. No sending, routing, booking, follow-up or external action occurred.'};
                } catch(error) {
                    state.quarantined_proposals??=[];
                    if(state.quarantined_proposals.length>=24)throw new Error('Proposal review bound reached');
                    const reason=error instanceof Error?error.message:'Proposal validation failed';
                    state.quarantined_proposals.push({request_id:b.request_id,proposals:b.proposals??null,reason});
                    state.evidence_reviewed=false;state.approved=false;
                    toolResult={status:'UNMAPPED_OWNER_REVIEW',reason,accepted:false,submission_status:'UNSUBMITTED',external_actions:[],note:'Proposed mapping was not adopted. Original visitor evidence and the rejected proposal are retained for owner review.'};
                }
                break;
            }
            case 'closing': if(!['ACTIVE','CLOSING_PENDING'].includes(state.status)) throw new Error('Session cannot begin closing'); state.status='CLOSING_PENDING'; break;
            case 'tool_receipt': {
                if(b.provider_session_id!==state.provider_session_id || !/^[\w-]{1,200}$/.test(b.tool_call_id||'')
                    || !['factory_handoff','factory_end_session'].includes(b.tool_name) || !['SDK_COMPLETED','SDK_FAILED'].includes(b.phase)) throw new Error('Tool receipt session/name binding mismatch');
                state.tool_events??=[];if(state.tool_events.length>=100)throw new Error('Tool evidence bound reached');
                state.tool_events.push({tool_call_id:b.tool_call_id,tool_name:b.tool_name,phase:b.phase,result:b.result,
                    exposure:'SDK_EVENT_NOT_PROOF_OF_MODEL_CONSUMPTION'}); break;
            }
            case 'reconcile': {
                if(!state.provider_session_id) throw new Error('No bound provider session');
                const meta=await verifySession(state,state.provider_session_id);
                const transcript=await provider('/sessions/'+state.provider_session_id+'/transcript');
                if(transcript.sessionId!==state.provider_session_id || !transcript.transcriptsEnabled || !Array.isArray(transcript.messages)
                    || transcript.totalMessages!==transcript.messages.length) throw new Error('Complete provider transcript unavailable; preserve browser evidence for review');
                const providerTurns=transcript.messages as Array<{role:string;message:string}>;
                if(providerTurns.length>200 || providerTurns.some(p=>!['user','persona'].includes(p.role)||typeof p.message!=='string'||p.message.length>8000)) throw new Error('Provider transcript exceeded evidence contract');
                state.provider_transcript_verified=state.turns.filter(t=>t.role==='user').every(t=>providerTurns.some(p=>p.role==='user'&&p.message===t.content));
                // Never lose a provider-finalized visitor turn merely because a browser event was missed.
                // Its ID is a local capture reference, NOT claimed to be a provider-assigned message ID.
                providerTurns.forEach((p,i)=>{if(p.message.trim()&&!state!.turns.some(t=>t.role===p.role&&t.content===p.message)){
                    state!.turns.push({id:'provider-capture:'+i+':'+digest(p).slice(0,12),role:p.role as 'user'|'persona',content:p.message});
                    state!.evidence_reviewed=false;state!.approved=false;
                }});
                state.provider_evidence={metadata:meta,transcript};
                if(meta.endTime) { state.provider_release_verified=true; state.status='CLOSED'; }
                state.receipts.push({at:new Date().toISOString(),kind:'PROVIDER_READBACK',sha256:digest({meta,transcript})});
                toolResult={provider_release_verified:state.provider_release_verified,transcript_verified:state.provider_transcript_verified}; break;
            }
            case 'decision': decide(state,b.proposal_id,b.decision,manifest.configured_fields); break;
            case 'review_evidence': if(!state.provider_transcript_verified) throw new Error('Reconcile the provider transcript first'); state.evidence_reviewed=true; break;
            case 'approve': approve(state); break;
            default: throw new Error('Unsupported Factory handoff operation');
        }
        if(state.processed.length>=600) throw new Error('Session operation bound reached');
        state.processed.push(b.request_id); state.version++;
        state.receipts.push({at:new Date().toISOString(),kind:b.action,sha256:digest({request:b,result:toolResult})});
        await store.commit(id,saved.raw,state); return response({state,toolResult});
    } catch(error) {
        // No raw upstream bodies, credentials or unrelated environment data.
        const text=error instanceof Error?error.message:'Operation failed';
        return NextResponse.json({error:reserved?'Launch reserved; outcome requires reconciliation. No automatic retry.':text.slice(0,240)},{status:409,headers:{'Cache-Control':'no-store'}});
    }
}
