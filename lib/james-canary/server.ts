import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server.js';
import { AMY_ANAM_BROWSER_COOKIE, amyAnamCookieOptions, createAmyAnamBrowserSessionWithSecret,
    readAmyAnamBrowserSession, readAmyAnamSpineConfig, createAmyAnamLaunch, isTrustedBrowserOrigin,
    readBoundedJsonObject, isUuid, requestFingerprint } from '../anam/session-spine.ts';
import { consumeAmyAnamDistributedRateLimit } from '../anam/session-spine-store.ts';
import { fetchAnamSessionMetadata, verifyAnamSessionMetadata, fetchCompletedAnamTranscript } from '../anam/session-api.ts';
import { PERSONA_ID as CANARY_PERSONA_ID, emptyIntake, applyTurn, receipt, readiness, conversationGuidance, spokenPhone, sha, view } from './state.ts';
import type { Session, Turn } from './state.ts';
import {verifyOwnerGrant,emailConfiguration,sendPreparedOwnerTest} from './owner-email.ts';
import {verifyDemoGrant,bindDemoGrant,readDemoAccessMode,createVisitorDemoAuthorization,reserveVisitorEmailAllowance,preflightDemoTransport,prepareDemoMessages,sendDemoSummaries} from './demo-email.ts';
import {finalizeBrief,confirmBrief,applyBriefCorrection,reserveBriefInvitation,hasSubstantiveBriefFact} from './structured-brief.ts';

const COOKIE='xagent_james_canary';
const TTL=24*60*60;
const PREFIX='xagent:james:canary:v1:';
function config() { const c=readAmyAnamSpineConfig(); if(!c.gatesOpen)throw new Error('Hosted session storage is unavailable'); return c; }
export function createJamesServer(options: {personaId?:string;cookie?:string;prefix?:string;allowDemoEmail?:boolean}={}) {
const PERSONA_ID=options.personaId||CANARY_PERSONA_ID;
const cookie=options.cookie||COOKIE, prefix=options.prefix||PREFIX;
function secret() { return createHmac('sha256',config().signingSecret).update(prefix).digest('hex'); }
function browser(req: Request) {
    const headers=new Headers(req.headers);
    const own=(headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookie+'='));
    headers.set('cookie',own?AMY_ANAM_BROWSER_COOKIE+own.slice(cookie.length):'');
    return readAmyAnamBrowserSession(new Request(req.url,{headers}),secret());
}
function encode(session:Session){return seal(session,secret(),prefix);}
function decode(value:string,id:string){return unseal(value,id,secret(),PERSONA_ID,prefix);}
async function redis(command: (string|number)[]) {
    const c=config();
    const response=await fetch(c.redisUrl,{method:'POST',headers:{Authorization:`Bearer ${c.redisToken}`,'Content-Type':'application/json'},
        body:JSON.stringify(command),cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Session storage unavailable');
    const result=await response.json(); if(result.error)throw new Error('Session storage operation failed'); return result.result;
}
async function save(previous:Session|null,next:Session) {
    const value=encode(next);
    const script="local old=redis.call('GET',KEYS[1]); if ARGV[1]=='-1' then if old then return 0 end else if not old or cjson.decode(old).revision~=tonumber(ARGV[1]) then return 0 end end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1";
    const result=await redis(['EVAL',script,1,prefix+next.id,previous?.revision??-1,value,TTL]);
    if(result!==1)throw new Error('Session changed concurrently; reload the current state without resending');
}
async function load(req:Request,id:unknown) {
    if(!isUuid(id))throw new Error('Invalid session identifier');
    const owner=browser(req); if(!owner)throw new Error('Session browser authorization expired');
    const raw=await redis(['GET',prefix+id]); if(typeof raw!=='string')throw new Error('Session is unavailable or expired');
    const session=decode(raw,id); if(session.browserId!==owner.id)throw new Error('Session belongs to a different browser'); return session;
}
function launch(session:Session) {
    const binding=createAmyAnamLaunch(session.browserId,PERSONA_ID,Date.parse(session.createdAt));
    return {...binding,launchId:session.id,clientLabel:session.clientLabel};
}
async function get(req:Request) {
    try { const id=new URL(req.url).searchParams.get('id'); return json(view(await load(req,id))); }
    catch(error){return json({error:error instanceof Error?error.message:'Session unavailable'},400);}
}
async function post(req:Request) {
    try {
        if(!isTrustedBrowserOrigin(req))return json({error:'Request origin is not allowed'},403);
        const body=await readBoundedJsonObject(req,20*1024);
        if(body.action==='demo-email-preflight'){
            if(!options.allowDemoEmail)throw new Error('Demo email is unavailable on this surface');
            const grant=verifyDemoGrant(req.headers.get('x-james-demo-access'));
            return json({ready:true,...await preflightDemoTransport(),accessMode:grant.accessMode,
                maxSessions:grant.accessMode==='reusable'?null:1,maxEmails:2,maxEmailsPerSession:2,retries:0});
        }
        if(body.action==='owner-test-preflight'){
            if(options.allowDemoEmail)throw new Error('Legacy owner authorization is not valid on this surface');
            verifyOwnerGrant(req.headers.get('x-james-owner-test'));
            return json({ready:true,...emailConfiguration(),maxSends:1,retries:0});
        }
        if(body.action==='start') {
            const ownerToken=req.headers.get('x-james-owner-test');
            if(options.allowDemoEmail&&ownerToken)throw new Error('Legacy owner authorization is not valid on this surface');
            const grant=ownerToken?verifyOwnerGrant(ownerToken):null;
            if(grant)emailConfiguration();
            const demoToken=req.headers.get('x-james-demo-access');
            if(demoToken&&!options.allowDemoEmail)throw new Error('Demo email is unavailable on this surface');
            const visitorEmail=Boolean(options.allowDemoEmail&&process.env.JAMES_DEMO_EMAIL_ENABLED==='true'&&readDemoAccessMode()==='visitor');
            if(visitorEmail&&demoToken)throw new Error('No email access code is needed; start without an operator code');
            const demoGrant=demoToken?verifyDemoGrant(demoToken):null;
            const rate=await consumeAmyAnamDistributedRateLimit({fingerprint:requestFingerprint(req,prefix+'start'),limit:5,windowSeconds:600});
            if(!rate.allowed)return json({error:'Session start limit reached'},429);
            const id=randomUUID();
            const visitorAuthorization=visitorEmail?createVisitorDemoAuthorization(id):null;
            const demoTransport=demoGrant||visitorAuthorization?await preflightDemoTransport():null;
            let owner=browser(req), token:string|undefined;
            if(!owner){const created=createAmyAnamBrowserSessionWithSecret(secret());owner=created.session;token=created.token;}
            const p=await provider('/personas/'+PERSONA_ID);
            if(p.id!==PERSONA_ID)throw new Error('Persona identity did not match');
            const state:Session={id,browserId:owner.id,clientLabel:(options.allowDemoEmail?'xagent-james-notepad:':'xagent-james-canary:')+id,createdAt:new Date().toISOString(),revision:0,stateHash:'',
                personaId:PERSONA_ID,config:{promptHash:sha(p.brain?.systemPrompt||''),configHash:sha(JSON.stringify(p)),voiceId:p.voice?.id||'',voiceName:p.voice?.displayName||''},
                state:'LAUNCHING',turns:[],intake:emptyIntake(),receipts:[]};
            if(options.allowDemoEmail)state.intakeBrief={version:2};
            if(grant){
                const claimed=await redis(['SET',prefix+'owner-grant:'+grant.id,id,'NX','EX',TTL]);
                if(claimed!=='OK')throw new Error('Owner test authorization already consumed; no new session authorized');
                state.ownerTest={grantId:grant.id,expiresAt:grant.expiresAt};
            }
            if(demoGrant&&demoTransport){
                // Legacy codes are single-use. Reusable operator access receives
                // a unique call capability so different calls never share send keys.
                const bound=bindDemoGrant(demoGrant,id);
                const claimed=await redis(['SET',prefix+'demo-grant:'+bound.grantId,id,'NX','EX',TTL]);
                if(claimed!=='OK')throw new Error('Demo authorization already consumed; create no new session with this code');
                state.demoEmail={...bound,sender:demoTransport.sender,replyTo:demoTransport.replyTo};
            }
            if(visitorAuthorization&&demoTransport)state.demoEmail={...visitorAuthorization,sender:demoTransport.sender,replyTo:demoTransport.replyTo};
            if(!state.config.voiceId||!p.brain?.systemPrompt)throw new Error('Published persona configuration is incomplete');
            state.stateHash=sha(JSON.stringify(state)); await save(null,state);
            const minted=await provider('/auth/session-token',{clientLabel:state.clientLabel,personaConfig:{personaId:PERSONA_ID}});
            if(typeof minted.sessionToken!=='string')throw new Error('Session token missing');
            const response=json({...view(state),sessionToken:minted.sessionToken});
            if(token)response.cookies.set(cookie,token,amyAnamCookieOptions());
            return response;
        }
        const current=await load(req,body.id); let next=structuredClone(current);
        if(body.action==='preview-demo-email'){
            if(!options.allowDemoEmail)throw new Error('Demo email is unavailable on this surface');
            const prepared=prepareDemoMessages(current);
            return json({snapshotHash:prepared.snapshotHash,callerAddress:prepared.callerAddress,sender:prepared.sender,replyTo:prepared.replyTo,
                messages:[{lane:'internal',to:prepared.internal.to,text:prepared.internal.text},{lane:'caller',to:prepared.caller.to,text:prepared.caller.text}]});
        }
        if(body.action==='send-demo-email'){
            if(!options.allowDemoEmail)throw new Error('Demo email is unavailable on this surface');
            next=await sendDemoSummaries(current,{snapshotHash:body.snapshotHash,callerAddress:body.callerAddress,approved:body.approved},
                {save,stamp:receipt,reserveAllowance:callerAddress=>reserveVisitorEmailAllowance(callerAddress,{redis,prefix})});
            return json(view(next));
        }
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
        } else if(['finalize-brief','confirm-brief','correct-brief','reserve-brief-invitation'].includes(String(body.action))) {
            if(!options.allowDemoEmail||!current.providerId||!current.intakeBrief)throw new Error('Structured brief is unavailable');
            if(!['ACTIVE','CLOSED'].includes(current.state))throw new Error('Brief review is unavailable during connection or closure');
            if(body.action==='finalize-brief')next=finalizeBrief(current);
            else if(body.action==='confirm-brief')next=confirmBrief(current,body.snapshotHash);
            else if(body.action==='correct-brief')next=applyBriefCorrection(current,body.slot,body.value,body.snapshotHash);
            else {
                next=reserveBriefInvitation(current,body.snapshotHash);
                if(next===current)return json({...view(current),invitation_allowed:false});
            }
        } else if(body.action==='tool') {
            if(!['STATUS','REQUEST_HANDOFF','PREPARE','SEND'].includes(String(body.operation)))throw new Error('Unsupported tool operation');
            if(!current.providerId)throw new Error('Session is not bound');
            // No spoken/model tool call can consent to the email workflow.
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
            if(next.intakeBrief&&hasSubstantiveBriefFact(next.intake))next=finalizeBrief(next);
            if(next.intake.handoff==='HANDOFF_REQUESTED'&&readiness(next.intake).ready)next.intake.handoff='PREPARED';
        } else throw new Error('Unsupported session operation');
        next=receipt(current,next,body);await save(current,next);
        if(body.action==='close'&&next.ownerTest&&next.intake.handoff==='PREPARED'){
            try{next=await sendPreparedOwnerTest(next,{save,stamp:receipt});}
            catch{return json({...view(next),operation_notice:'Session closed. Legacy owner email requires attention; inspect saved state before any further action.'});}
        }
        return json({...view(next),...(body.action==='reserve-brief-invitation'?{invitation_allowed:true}:{})});
    } catch(error) { return json({error:error instanceof Error?error.message:'Canary operation failed'},400); }
}
return {get,post};
}

export function seal(session: Session, key: string, prefix=PREFIX): string {
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
    cipher.setAAD(Buffer.from(prefix+session.id));
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(session),'utf8'),cipher.final()]);
    return JSON.stringify({revision:session.revision,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')});
}
export function unseal(value:string,id:string,key:string,personaId=CANARY_PERSONA_ID,prefix=PREFIX):Session {
    const box=JSON.parse(value), decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(box.iv,'base64'));
    decipher.setAAD(Buffer.from(prefix+id)); decipher.setAuthTag(Buffer.from(box.tag,'base64'));
    const state=JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]).toString('utf8')) as Session;
    if(state.id!==id||state.personaId!==personaId||state.revision!==box.revision)throw new Error('Session integrity check failed');
    return state;
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
    let providerIndex=-1;
    for(const turn of session.turns) {
        const role=turn.role==='persona'?'agent':'user';
        const index=providerTurns.findIndex((p,i)=>i>providerIndex&&p.role===role&&normalized(p.content)===normalized(turn.content));
        if(index<0)throw new Error('Provider transcript does not match finalized assistant context and turn order');
        providerIndex=index;
    }
}
export function toolResult(s:Session,operation:string) {
    const fields=(field:string)=>s.intake.facts.filter(f=>f.field===field).map(f=>({value:field==='primary_phone'?spokenPhone(f.value):f.value,status:f.status}));
    const contact_fields=Object.fromEntries(['visitor_preferred_identifier','primary_phone','primary_email','alternate_email'].map(f=>[f,fields(f)]));
    const ready=readiness(s.intake), pending=s.intake.emailCandidate;
    const currentVisitor=s.turns.findLast(t=>t.role==='user');
    const stateView=view(s);
    const liveNotes=stateView.intakeBrief?stateView.intakeBrief.sections.map(section=>({title:section.title,items:section.rows.map(row=>({
        label:row.label,text:row.key==='phone'&&/^\d{3}-\d{3}-\d{4}$/.test(row.value)?spokenPhone(row.value.replaceAll('-','')):row.value,
    }))})):stateView.brief.map(section=>({...section,items:section.items.map(item=>item.label==='Phone'?{...item,text:spokenPhone(item.text)}:item)}));
    return { status:operation==='SEND'?'EMAIL_UNAVAILABLE':operation==='PREPARE'&&(!ready.ready||s.state!=='CLOSED')?'HANDOFF_NOT_READY':s.intake.handoff, handoff_request_state:s.intake.handoff,
        sent:false, human_review:'NOT_CONFIRMED', external_actions:[], email_recorded:fields('primary_email').length>0&&!pending,
        primary_email_candidate:pending?.value||null, email_needs_confirmation:Boolean(pending),
        contact_fields,contact_complete:['visitor_preferred_identifier','primary_phone','primary_email'].every(f=>fields(f).length||s.intake.declined.includes(f))&&!pending,
        handoff_readiness:ready,notes_receipt:{revision:s.revision,state_hash:s.stateHash},live_notes:liveNotes,
        accepted_current_turn_notes:s.intake.facts.filter(f=>f.turnId===currentVisitor?.id).map(f=>f.field==='primary_phone'?{...f,value:spokenPhone(f.value),evidence:'Canonical phone retained in receipt-backed state; speak the value exactly.'}:f),
        source_turn_id:currentVisitor?.id||null,conversation_guidance:conversationGuidance(s),
        instruction:'PUBLIC CANARY: no email or external action can be sent. Never say I will pass this on, the firm will review it, someone will call, or it will be sent. A callback question is not handoff consent. Honor handoff_truth and practice_scope. Use the deterministic phone_speech.spoken exactly for any readback: individual digit words in 3-3-4 groups, never regenerate the number as numeric text. Use only accepted contact fields; confirm the pending email candidate before claiming it recorded. Ask one matter-specific missing question at a time; unknown is valid and questions must not loop. Do not offer completion while readiness is false. Never invent dates, legal conclusions, filings or strategy. A clear visitor goodbye permits one farewell, regardless of intake completeness.' };
}
function json(value:unknown,status=200){return NextResponse.json(value,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});}
export const {get,post}=createJamesServer();
