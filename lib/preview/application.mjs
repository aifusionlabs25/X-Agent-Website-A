import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {readPreviewConfig,trustedOrigin,createStorageCommand} from './config.mjs';
import {startScript,rateScript} from './scripts.mjs';
import {fixtureResponse} from './fixture-response.mjs';
import {createLunaResponder,readLunaRuntime} from './luna-responder.mjs';
import lunaPlan from './luna-policy.json' with {type:'json'};
import {createFactorySyncPublisher} from './factory-sync.mjs';
import {prefixes} from '../fixture.mjs';
import {EVAN_PERSONA_ID} from '../anam/persona-ids.ts';
import {parseEvanCaptureTurns,EvanCaptureError} from '../anam/evan-capture-service.ts';
import {readBoundedJsonObject,isUuid,AmyAnamRequestError} from '../anam/capture/session-spine.ts';
import {createCaptureCodec} from '../anam/codec.mjs';
import {createCaptureApplication,sessionKey} from '../anam/kernel.mjs';
import {createRedisCaptureStore} from '../anam/redis-store.mjs';
import {digest} from '../anam/consumer-bridge.mjs';
import {CaptureApplicationError as Fault} from '../anam/errors.mjs';
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const signature=(payload,c)=>createHmac('sha256',c.cookieKey).update(payload).digest('base64url');
function cookie(request,c){
 const raw=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(c.cookieName+'='))?.slice(c.cookieName.length+1);
 if(!raw)return null;
 const [id,expiry,sig,...rest]=raw.split('.'),payload=id+'.'+expiry;
 if(rest.length||!isUuid(id)||!/^\d+$/.test(expiry??'')||Number(expiry)<=c.now||Number(expiry)>c.now+c.pins.fixtureTtlSeconds*1000)return null;
 const expected=signature(payload,c),supplied=Buffer.from(sig??'');
 if(supplied.length!==Buffer.byteLength(expected)||!timingSafeEqual(supplied,Buffer.from(expected)))return null;
 return {id,expiresAt:Number(expiry)};
}
const indexKey=(c,b)=>'xagent:capture-preview:v1:'+c.scope+':browser:'+b.id;
function validEntry(entry,c,b){
 if(!entry||entry.scope!==c.scope||!Number.isFinite(entry.expiresAt)||entry.expiresAt>b.expiresAt||entry.expiresAt<=c.now
  ||entry.binding?.browserId!==b.id||!isUuid(entry.binding?.launchId)||!isUuid(entry.binding?.sessionId)
  ||entry.binding.personaId!==EVAN_PERSONA_ID||entry.namespace!=='capture-sim-'+c.scope)
  throw new Fault('FIXTURE_BINDING_MISMATCH',409);
 return entry;
}
async function load(command,codec,c,b){
 const key=indexKey(c,b),raw=await command(['GET',key]);
 return raw?validEntry(codec.open(raw,key,0),c,b):null;
}
async function active(command,entry){
 const b=entry.binding;
 const [launchRaw,sessionRaw]=await Promise.all([command(['GET','xagent:amy:anam:launch:v1:'+b.launchId]),command(['GET','xagent:amy:anam:session:v1:'+b.sessionId])]);
 let l,s;try{l=JSON.parse(launchRaw);s=JSON.parse(sessionRaw);}catch{return false;}
 return Boolean(l&&s&&l.browserSessionId===b.browserId&&s.browserSessionId===b.browserId
  &&l.boundSessionId===b.sessionId&&s.externalSessionId===b.sessionId&&s.launchId===b.launchId
  &&l.resolvedPersonaId===b.personaId&&s.resolvedPersonaId===b.personaId
  &&l.agentSlug==='evan'&&s.agentSlug==='evan'&&l.variant==='evan-mullins'&&s.variant==='evan-mullins'&&s.state==='bound');
}
const view=entry=>({mode:'BOUNDED_LUNA_TEST',lunaRevision:4,binding:entry?{launchId:entry.binding.launchId,sessionId:entry.binding.sessionId}:null,
 expiresAt:entry?.expiresAt??null,prefixes});
// Request-local composition. No warm-process binding or in-memory rate authority.
// Vercel Authentication remains a separately verified deployment requirement.
export function createPreviewHandlers({env=process.env,clock=Date.now,fetchImpl=fetch,providerFetch=fetch,pins}={}){
 async function handle(request,operation){
  try{
   const c=readPreviewConfig(env,clock(),pins);
   if(!trustedOrigin(request,c,operation!=='get'))return json({error:'Request origin is not allowed'},403);
   const command=createStorageCommand(c,fetchImpl),codec=createCaptureCodec(c.key);let b=cookie(request,c);
   if(operation==='get'){
    if(!b){b={id:randomUUID(),expiresAt:c.now+c.ttl*1000};const payload=b.id+'.'+b.expiresAt;
     return json(view(null),200,{'Set-Cookie':c.cookieName+'='+payload+'.'+signature(payload,c)+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+c.ttl});}
    const entry=await load(command,codec,c,b);
    return json({...view(entry),lunaConsumed:Number(await command(['EXISTS','xagent:capture-luna-test:v1:'+lunaPlan.testId]))===1});
   }
   if(!b)throw new Fault('SIGNED_SYNTHETIC_BROWSER_REQUIRED',401);
   if(operation==='start'){
    const body=await readBoundedJsonObject(request,1024);
    if(Object.keys(body).length)throw new Fault('EMPTY_FIXTURE_START_REQUIRED',400);
    const existing=await load(command,codec,c,b);
    if(existing){if(!await active(command,existing))throw new Fault('FIXTURE_CLOSED_OR_EXPIRED',409);return json(view(existing));}
    const ttl=Math.min(c.ttl,Math.floor((b.expiresAt-c.now)/1000));if(ttl<1)throw new Fault('FIXTURE_EXPIRED',409);
    const binding={browserId:b.id,launchId:randomUUID(),sessionId:randomUUID(),personaId:EVAN_PERSONA_ID};
    const entry={scope:c.scope,binding,namespace:'capture-sim-'+c.scope,expiresAt:c.now+ttl*1000};
    const launch={launchId:binding.launchId,browserSessionId:b.id,boundSessionId:binding.sessionId,resolvedPersonaId:binding.personaId,agentSlug:'evan',variant:'evan-mullins',state:'bound'};
    const session={...launch,externalSessionId:binding.sessionId};delete session.boundSessionId;
    const key=indexKey(c,b),capture='xagent:evan:anam:capture:v1:'+entry.namespace+':'+sessionKey(binding);
    const result=await command(['EVAL',startScript,5,key,'xagent:capture-preview:v1:'+c.scope+':budget',
     'xagent:amy:anam:launch:v1:'+binding.launchId,'xagent:amy:anam:session:v1:'+binding.sessionId,capture+':owner',
     String(c.pins.maxFixtures),String(Math.floor((Date.parse(c.pins.resourceExpiresAt)-c.now)/1000)),
     codec.seal(entry,key,0),String(ttl),JSON.stringify(launch),JSON.stringify(session),digest(entry)]);
    if(!['CREATED','EXISTING'].includes(result?.[0]))throw new Fault(result?.[0]==='FIXTURE_BUDGET_EXHAUSTED'?'FIXTURE_BUDGET_EXHAUSTED':'FIXTURE_START_NEEDS_REVIEW',409);
    return json(view(validEntry(codec.open(result[1],key,0),c,b)));
   }
   const body=await readBoundedJsonObject(request,96*1024),readOnly=body.operation==='read';
   const allowed=readOnly?['launchId','sessionId','operation']:['launchId','sessionId','revision','turns','operation'];
   if(Object.keys(body).some(k=>!allowed.includes(k))||!isUuid(body.launchId)||!isUuid(body.sessionId)
    ||body.operation!==undefined&&!['read','capture'].includes(body.operation)
    ||!readOnly&&(!Number.isSafeInteger(body.revision)||body.revision<1||body.revision>4))throw new Fault('INVALID_FIXTURE_REQUEST',400);
   const turns=readOnly?[]:parseEvanCaptureTurns(body.turns);
   if(!readOnly&&digest(turns)!==digest(prefixes[body.revision-1]))throw new Fault('PINNED_FICTIONAL_SOURCE_REQUIRED',422);
   const entry=await load(command,codec,c,b);
   if(!entry||entry.binding.launchId!==body.launchId||entry.binding.sessionId!==body.sessionId)throw new Fault('FIXTURE_BINDING_MISMATCH',409);
   if(!await active(command,entry))throw new Fault('FIXTURE_CLOSED_OR_EXPIRED',409);
   const n=Number(await command(['EVAL',rateScript,1,'xagent:capture-preview:v1:'+c.scope+':rate:'+b.id,String(c.ttl)]));
   if(!Number.isSafeInteger(n)||n>c.pins.rateLimit)throw new Fault('FIXTURE_RATE_LIMIT',429);
   const factorySync=createFactorySyncPublisher({env,config:c,command,codec});
   const respond=!readOnly&&body.revision===4?createLunaResponder({runtime:readLunaRuntime(env,c.now),command,codec,fetchImpl:providerFetch}):fixtureResponse;
   const store=createRedisCaptureStore({binding:entry.binding,command,codec,namespace:entry.namespace,ttlSeconds:c.ttl,factorySync});
   const result=await createCaptureApplication({store,respond,mode:'BOUNDED_LUNA_TEST'})({session:entry.binding,
    turns,revision:readOnly?null:body.revision,operation:readOnly?'read':'capture',signal:request.signal,stillActive:()=>active(command,entry)});
   return json(result);
  }catch(error){
   if(error instanceof Fault)return json({error:'Synthetic Preview needs attention',code:error.code,retryAllowed:false},error.status);
   if(error instanceof AmyAnamRequestError||error instanceof EvanCaptureError)return json({error:'Invalid synthetic fixture input',retryAllowed:false},400);
   return json({error:'Synthetic Preview unavailable',code:'FIXTURE_REQUEST_FAILED',retryAllowed:false},503);
  }
 }
 return {GET:request=>handle(request,'get'),START:request=>handle(request,'start'),CAPTURE:request=>handle(request,'capture')};
}
