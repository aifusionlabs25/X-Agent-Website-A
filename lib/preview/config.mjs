import {createHash,createHmac} from 'node:crypto';
import {policy} from './policy.mjs';
import {CaptureApplicationError as Fault} from '../anam/errors.mjs';
export function readPreviewConfig(env=process.env,now=Date.now(),pins=policy){
 const fail=code=>{throw new Fault(code,503);};
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_PROJECT_ID!==pins.projectId
  ||env.VERCEL_GIT_COMMIT_REF!==pins.branch||env.CAPTURE_PREVIEW_SOURCE_ID!==pins.sourceId
  ||env.CAPTURE_PREVIEW_MODE!=='SIMULATED_ONLY'||!/^dpl_[a-zA-Z0-9]+$/.test(env.VERCEL_DEPLOYMENT_ID??''))
  fail('ISOLATED_PREVIEW_TARGET_REQUIRED');
 const host=env.VERCEL_URL??'';
 if(!/^[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(host))fail('EXACT_PREVIEW_HOST_REQUIRED');
 const resourceDeadline=Date.parse(pins.resourceExpiresAt);
 if(!Number.isFinite(now)||!Number.isFinite(resourceDeadline)||resourceDeadline-now<1000)fail('DISPOSABLE_STORAGE_EXPIRED');
 const endpoint=(env.AMY_ANAM_REDIS_REST_URL??'').replace(/\/$/,'');let url;
 try{url=new URL(endpoint);}catch{fail('APPROVED_STORAGE_REQUIRED');}
 if(url.protocol!=='https:'||!url.hostname.endsWith('.upstash.io')||url.port||url.pathname!=='/'||url.search||url.hash||url.username||url.password)
  fail('APPROVED_STORAGE_REQUIRED');
 const token=env.AMY_ANAM_REDIS_REST_TOKEN??'';
 if(!token||createHash('sha256').update(endpoint+'\0'+token).digest('hex')!==pins.resourceFingerprint)fail('APPROVED_STORAGE_REQUIRED');
 const encoded=env.CAPTURE_PREVIEW_ENCRYPTION_KEY??'',key=Buffer.from(encoded,'base64');
 if(key.length!==32||key.toString('base64')!==encoded)fail('PREVIEW_ENCRYPTION_KEY_REQUIRED');
 const scope=createHash('sha256').update([pins.sourceId,env.VERCEL_DEPLOYMENT_ID,host].join('\0')).digest('hex').slice(0,24);
 return {origin:'https://'+host,endpoint,token,key,scope,pins,now,
  cookieName:'__Host-capture-fixture-'+scope,
  cookieKey:createHmac('sha256',key).update('capture-preview-cookie-v1\0'+scope).digest(),
  ttl:Math.min(pins.fixtureTtlSeconds,Math.floor((Date.parse(pins.resourceExpiresAt)-now)/1000))};
}
export function trustedOrigin(request,config,write=false){
 const url=new URL(request.url);
 return url.origin===config.origin&&request.headers.get('host')===url.host
  &&(!write||request.headers.get('origin')===config.origin);
}
// One request, no retry, redirects forbidden, bounded error with no URL/token/body.
export function createStorageCommand(config,fetchImpl=fetch){
 return async command=>{
  let response;try{response=await fetchImpl(config.endpoint+'/pipeline',{method:'POST',redirect:'error',
   cache:'no-store',signal:AbortSignal.timeout(3000),headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify([command])});}
  catch{throw new Fault('CAPTURE_STORAGE_TRANSPORT_UNKNOWN',503);}
  if(!response.ok)throw new Fault('CAPTURE_STORAGE_HTTP_'+response.status,503);
  let body;try{const raw=await response.text();if(Buffer.byteLength(raw)>1024*1024)throw new Error();body=JSON.parse(raw);}catch{throw new Fault('CAPTURE_STORAGE_RESPONSE_INVALID',503);}
  if(!Array.isArray(body)||body.length!==1||!body[0]||body[0].error||!Object.hasOwn(body[0],'result'))throw new Fault('CAPTURE_STORAGE_COMMAND_REJECTED',503);
  return body[0].result;
 };
}
