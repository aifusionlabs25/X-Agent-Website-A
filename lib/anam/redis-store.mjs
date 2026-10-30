import {randomBytes} from 'node:crypto';
import {digest} from './consumer-bridge.mjs';
import {CaptureApplicationError as Fault} from './errors.mjs';
import {sessionKey} from './kernel.mjs';
import {script} from './capture-script.mjs';
export {script};
export function createRedisCaptureStore({binding,command,codec,namespace,ttlSeconds=7*24*60*60}){
 if(!binding||typeof command!=='function'||!codec?.seal||!codec?.open
  ||!/^capture-sim-[a-z0-9-]{1,40}$/.test(namespace??'')||!Number.isSafeInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>7*24*60*60)
  throw new Fault('ISOLATED_CAPTURE_STORE_CONFIG_REQUIRED',503);
 const bound=structuredClone(binding),key=sessionKey(bound),tokens=new Map();
 const keys=['xagent:amy:anam:launch:v1:'+bound.launchId,'xagent:amy:anam:session:v1:'+bound.sessionId,
  'xagent:evan:anam:capture:v1:'+namespace+':'+key];
 const check=k=>{if(k!==key)throw new Fault('CAPTURE_STORE_SESSION_MISMATCH');};
 const unpack=raw=>{if(!raw)return null;const h=typeof raw==='string'?JSON.parse(raw):raw;
  const entry=codec.open(h.box,keys[2],h.revision);
  if(entry.result.binding.revision!==h.revision||entry.result.sourceDigest!==h.source
   ||entry.result.acceptedStateHash!==h.stateHash||digest(entry.result.captureState)!==h.stateHash)
   throw new Fault('STORED_CAPTURE_INTEGRITY_REQUIRES_REVIEW',503);return entry;};
 async function run(op,revision=0,source='',token='',expected='',envelope='',code=''){
  let response;
  try{response=await command(['EVAL',script,3,...keys,op,JSON.stringify(bound),String(revision),source,token,expected,envelope,code,String(ttlSeconds)]);}
  catch{throw new Fault('CAPTURE_STORAGE_RESULT_UNKNOWN',503);}
  let result;try{result=typeof response==='string'?JSON.parse(response):response;}catch{throw new Fault('CAPTURE_STORAGE_RESPONSE_INVALID',503);}
  if(!result||typeof result.kind!=='string')throw new Fault('CAPTURE_STORAGE_RESPONSE_INVALID',503);
  if(!['ok','reserved','duplicate'].includes(result.kind))throw new Fault(result.kind);
  return result;
 }
 return {
  async read(k){check(k);return unpack((await run('read')).value);},
  async begin(k,revision,source){check(k);const token=randomBytes(16).toString('hex');
   const response=await run('begin',revision,source,token);if(response.kind==='duplicate')return {duplicate:true,entry:unpack(response.value)};
   tokens.set(revision,{token,source});return {duplicate:false,previous:unpack(response.value)};},
  async commit(k,revision,source,expectedHash,entry){check(k);const pending=tokens.get(revision);
   if(!pending||pending.source!==source)throw new Fault('ATTEMPT_BINDING_MISMATCH');
   const envelope=JSON.stringify({revision,source,stateHash:entry.result.acceptedStateHash,box:codec.seal(entry,keys[2],revision)});
   if(Buffer.byteLength(envelope)>512*1024)throw new Fault('CAPTURE_ENVELOPE_TOO_LARGE',422);
   await run('commit',revision,source,pending.token,expectedHash??'',envelope);tokens.delete(revision);},
  async fail(k,revision,code){check(k);const pending=tokens.get(revision);if(!pending)return;
   try{await run('fail',revision,pending.source,pending.token,'','',code);}finally{tokens.delete(revision);}},
  keys:structuredClone(keys),
 };
}
