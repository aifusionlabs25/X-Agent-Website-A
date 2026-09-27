import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server.js';
import { AMY_ANAM_BROWSER_COOKIE, amyAnamCookieOptions, createAmyAnamBrowserSessionWithSecret,
    readAmyAnamBrowserSession, readAmyAnamSpineConfig, createAmyAnamLaunch, isTrustedBrowserOrigin,
    readBoundedJsonObject, isUuid, requestFingerprint } from '../anam/session-spine.ts';
import { consumeAmyAnamDistributedRateLimit } from '../anam/session-spine-store.ts';
import { fetchAnamSessionMetadata, verifyAnamSessionMetadata, fetchCompletedAnamTranscript } from '../anam/session-api.ts';
import { PERSONA_ID, emptyIntake, applyTurn, receipt, readiness, sha, view } from './state.ts';
import type { Session, Turn } from './state.ts';

const COOKIE='xagent_james_canary';
const TTL=24*60*60;
const PREFIX='xagent:james:canary:v1:';
function config() { const c=readAmyAnamSpineConfig(); if(!c.gatesOpen)throw new Error('Hosted session storage is unavailable'); return c; }
function secret() { return createHmac('sha256',config().signingSecret).update(PREFIX).digest('hex'); }
function browser(req: Request) {
    const headers=new Headers(req.headers);
    const own=(headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='));
    headers.set('cookie',own?AMY_ANAM_BROWSER_COOKIE+own.slice(COOKIE.length):'');
    return readAmyAnamBrowserSession(new Request(req.url,{headers}),secret());
}
export function seal(session: Session, key: string): string {
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
    cipher.setAAD(Buffer.from(PREFIX+session.id));
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(session),'utf8'),cipher.final()]);
    return JSON.stringify({revision:session.revision,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')});
}
export function unseal(value:string,id:string,key:string):Session {
    const box=JSON.parse(value), decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(box.iv,'base64'));
    decipher.setAAD(Buffer.from(PREFIX+id)); decipher.setAuthTag(Buffer.from(box.tag,'base64'));
    const state=JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]).toString('utf8')) as Session;
    if(state.id!==id||state.personaId!==PERSONA_ID||state.revision!==box.revision)throw new Error('Session integrity check failed');
    return state;
}
async function redis(command: (string|number)[]) {
    const c=config();
    const response=await fetch(c.redisUrl,{method:'POST',headers:{Authorization:`Bearer ${c.redisToken}`,'Content-Type':'application/json'},
        body:JSON.stringify(command),cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Session storage unavailable');
    const result=await response.json(); if(result.error)throw new Error('Session storage operation failed'); return result.result;
}
async function save(previous:Session|null,next:Session) {
    const value=seal(next,secret());
    // Existing Redis atomic-script pattern; concurrent/late writes never overwrite accepted state.
    const script="local old=redis.call('GET',KEYS[1]); if ARGV[1]=='-1' then if old then return 0 end else if not old or cjson.decode(old).revision~=tonumber(ARGV[1]) then return 0 end end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1";
    const result=await redis(['EVAL',script,1,PREFIX+next.id,previous?.revision??-1,value,TTL]);
    if(result!==1)throw new Error('Session changed concurrently; reload the current state without resending');
}
async function load(req:Request,id:unknown) {
    if(!isUuid(id))throw new Error('Invalid session identifier');
    const owner=browser(req); if(!owner)throw new Error('Session browser authorization expired');
    const raw=await redis(['GET',PREFIX+id]); if(typeof raw!=='string')throw new Error('Session is unavailable or expired');
    const session=unseal(raw,id,secret()); if(session.browserId!==owner.id)throw new Error('Session belongs to a different browser'); return session;
}
function launch(session:Session) {
    // Structural adapter to the existing provider identity verifier, not an Amy session/store.
    const binding=createAmyAnamLaunch(session.browserId,PERSONA_ID,Date.parse(session.createdAt));
    return {...binding,launchId:session.id,clientLabel:session.clientLabel};
}
async function provider(path:string,body?:object) {
    if(!process.env.ANAM_API_KEY)throw new Error('Anam is unavailable');
    const response=await fetch('https://api.anam.ai/v1'+path,{method:body?'POST':'GET',
        headers:{Authorization:`Bearer ${process.env.ANAM_API_KEY}`,'Content-Type':'application/json'},
        ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`Anam request failed (${response.status}); no automatic retry`);
    const raw=await response.text(); if(raw.length>256*1024)throw new Error('Provider response exceeded bound'); return JSON.parse(raw);
}
export function verifyFinalEvidence(session:Session,providerTurns:{role:'user'|'agent';content:string}[]) {
    const normalized=(v:string)=>v.trim().replace(/\s+/g,' ').toLowerCase();
    const users=providerTurns.filter(t=>t.role==='user'), local=session.turns.filter(t=>t.role==='user');
    if(users.length!==local.length || users.some((t,i)=>normalized(t.content)!==normalized(local[i].content)))throw new Error('Provider transcript does not match finalized visitor evidence');
    // Email confirmation and contextual handoff rely on assistant context too.
    for(let i=0;i<session.turns.length;i++) {
        const t=session.turns[i]; if(t.role!=='persona')continue;
        if(!providerTurns.some(p=>p.role==='agent'&&normalized(p.content)===normalized(t.content)))throw new Error('Provider transcript does not match finalized assistant context');
    }
}
function toolResult(s:Session,operation:string) {
    const fields=(field:string)=>s.intake.facts.filter(f=>f.field===field).map(f=>({value:f.value,status:f.status}));
    const contact_fields=Object.fromEntries(['visitor_preferred_identifier','primary_phone','primary_email','alternate_email'].map(f=>[f,fields(f)]));
    const ready=readiness(s.intake), pending=s.intake.emailCandidate;
    const next=pending?`Read back ${pending.value} and ask whether it is correct.`:ready.missing[0];
    return { status:operation==='SEND'?'EMAIL_UNAVAILABLE':s.intake.handoff, handoff_request_state:s.intake.handoff,
        sent:false, human_review:'NOT_CONFIRMED', external_actions:[], email_recorded:fields('primary_email').length>0&&!pending,
        primary_email_candidate:pending?.value||null, email_needs_confirmation:Boolean(pending),
        contact_fields,contact_complete:['visitor_preferred_identifier','primary_phone','primary_email'].every(f=>fields(f).length||s.intake.declined.includes(f))&&!pending,
        handoff_readiness:ready,notes_receipt:{revision:s.revision,state_hash:s.stateHash},live_notes:view(s).brief,
        conversation_guidance:{completion_language_allowed:ready.ready,next_question:next,max_questions_per_reply:1,
            completed_intents_do_not_reask:s.intake.facts.map(f=>f.field),date_authority:'Only visitor-reported timing; no calendar calculations'},
        instruction:'PUBLIC CANARY: no email or external action can be sent. A request is not delivery, review or follow-up. Do not promise any firm action. Use only accepted contact fields; confirm the pending email candidate before claiming it recorded. Ask at most one useful missing question, not a repeated broad discovery question. Never invent dates or legal conclusions. A clear visitor goodbye permits one farewell, regardless of intake completeness.' };
}
function json(value:unknown,status=200){return NextResponse.json(value,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});}
export async function get(req:Request) {
    try { const id=new URL(req.url).searchParams.get('id'); return json(view(await load(req,id))); }
    catch(error){return json({error:error instanceof Error?error.message:'Session unavailable'},400);}
}
export async function post(req:Request) {
    try {
        if(!isTrustedBrowserOrigin(req))return json({error:'Request origin is not allowed'},403);
        const body=await readBoundedJsonObject(req,20*1024);
        if(body.action==='start') {
            const rate=await consumeAmyAnamDistributedRateLimit({fingerprint:requestFingerprint(req,'james-canary-start'),limit:5,windowSeconds:600});
            if(!rate.allowed)return json({error:'Session start limit reached'},429);
            let owner=browser(req), token:string|undefined;
            if(!owner){const created=createAmyAnamBrowserSessionWithSecret(secret());owner=created.session;token=created.token;}
            const p=await provider('/personas/'+PERSONA_ID);
            if(p.id!==PERSONA_ID)throw new Error('Persona identity did not match');
            const id=randomUUID();
            const state:Session={id,browserId:owner.id,clientLabel:'xagent-james-canary:'+id,createdAt:new Date().toISOString(),revision:0,stateHash:'',
                personaId:PERSONA_ID,config:{promptHash:sha(p.brain?.systemPrompt||''),configHash:sha(JSON.stringify(p)),voiceId:p.voice?.id||'',voiceName:p.voice?.displayName||''},
                state:'LAUNCHING',turns:[],intake:emptyIntake(),receipts:[]};
            if(!state.config.voiceId||!p.brain?.systemPrompt)throw new Error('Published persona configuration is incomplete');
            state.stateHash=sha(JSON.stringify(state)); await save(null,state);
            const minted=await provider('/auth/session-token',{clientLabel:state.clientLabel,personaConfig:{personaId:PERSONA_ID}});
            if(typeof minted.sessionToken!=='string')throw new Error('Session token missing');
            const response=json({...view(state),sessionToken:minted.sessionToken});
            if(token)response.cookies.set(COOKIE,token,amyAnamCookieOptions());
            return response;
        }
        const current=await load(req,body.id); let next=structuredClone(current);
        if(body.action==='bind') {
            if(!isUuid(body.providerId)|| (current.providerId&&current.providerId!==body.providerId))throw new Error('Provider session binding is invalid');
            const metadata=await fetchAnamSessionMetadata(body.providerId); verifyAnamSessionMetadata(metadata,launch(current));
            if(current.state!=='LAUNCHING'&&current.state!=='ACTIVE')throw new Error('Session cannot bind');
            if(metadata.endTime)throw new Error('Provider session already ended');
            next.providerId=body.providerId;next.state='ACTIVE';
        } else if(body.action==='turn') {
            if(!current.providerId)throw new Error('Session is not bound');
            const t=body.turn as Turn;
            if(!t||typeof t.id!=='string'||t.id.length>160||!['user','persona'].includes(t.role)||typeof t.content!=='string'||body.finalized!==true)throw new Error('Finalized turn required');
            next=applyTurn(current,{id:t.id,role:t.role,content:t.content});
            if(next===current)return json(view(current));
        } else if(body.action==='tool') {
            if(!['STATUS','REQUEST_HANDOFF','PREPARE','SEND'].includes(String(body.operation)))throw new Error('Unsupported tool operation');
            if(!current.providerId)throw new Error('Session is not bound');
            // Model cannot invent visitor consent or authorize an action.
            return json(toolResult(current,String(body.operation)));
        } else if(body.action==='begin-close') {
            if(current.state==='CLOSED')return json(view(current));
            if(!current.providerId)throw new Error('Session is not bound');next.state='CLOSING';
        } else if(body.action==='close') {
            if(current.state==='CLOSED')return json(view(current));
            if(current.state!=='CLOSING'||!current.providerId)throw new Error('SDK closure must begin first');
            const completed=await fetchCompletedAnamTranscript(current.providerId,launch(current),{pollDelaysMs:[0,1000,2000,4000]});
            if(completed.status!=='ready'||(!completed.metadata.endTime&&!completed.metadata.exitStatus))throw new Error('Provider release/transcript not yet verified; local session remains CLOSING');
            verifyFinalEvidence(current,completed.turns);
            next.providerRelease={endTime:completed.metadata.endTime||completed.metadata.exitStatus||'',transcriptHash:sha(JSON.stringify(completed.turns)),verifiedAt:new Date().toISOString()};
            next.state='CLOSED';next.closedAt=new Date().toISOString();
            if(next.intake.handoff==='HANDOFF_REQUESTED'&&readiness(next.intake).ready)next.intake.handoff='PREPARED';
        } else throw new Error('Unsupported session operation');
        next=receipt(current,next,body);await save(current,next);return json(view(next));
    } catch(error) { return json({error:error instanceof Error?error.message:'Canary operation failed'},400); }
}
