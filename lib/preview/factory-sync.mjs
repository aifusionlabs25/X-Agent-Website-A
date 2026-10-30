// Private Preview capture outbox. No provider client, email or action authority.
import {createHash,timingSafeEqual} from 'node:crypto';
import {readPreviewConfig,trustedOrigin,createStorageCommand} from './config.mjs';
import lunaPlan from './luna-policy.json' with {type:'json'};
import {createCaptureCodec} from '../anam/codec.mjs';
import {prepareConsumerCapture,digest} from '../anam/consumer-bridge.mjs';
import {sessionKey} from '../anam/kernel.mjs';
import {readBoundedJsonObject} from '../anam/capture/session-spine.ts';
import {CaptureApplicationError as Fault} from '../anam/errors.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const clone=x=>structuredClone(x);
const fail=(code,status=503)=>{throw new Fault(code,status);};
const MAX_RAW=512*1024,MAX_QUEUE=3;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');

export function readFactorySyncConfig(env,config){
 if(env.FACTORY_CAPTURE_SYNC_ENABLED!=='1'){
  if(![undefined,'','0'].includes(env.FACTORY_CAPTURE_SYNC_ENABLED))fail('FACTORY_SYNC_CONFIGURATION_REQUIRED');
  return null;
 }
 const token=env.FACTORY_CAPTURE_SYNC_TOKEN??'',channel=env.FACTORY_CAPTURE_SYNC_CHANNEL??'';
 if(!/^[A-Za-z0-9_-]{32,256}$/.test(token)||!/^[a-z0-9][a-z0-9-]{7,63}$/.test(channel))fail('FACTORY_SYNC_CONFIGURATION_REQUIRED');
 const expiresAt=Date.parse(config.pins.resourceExpiresAt),ttl=Math.floor((expiresAt-config.now)/1000);
 if(!Number.isSafeInteger(expiresAt)||ttl<1||ttl>7*24*60*60)fail('FACTORY_SYNC_RETENTION_INVALID');
 const source={project_id:config.pins.projectId,branch:config.pins.branch,deployment_id:env.VERCEL_DEPLOYMENT_ID,
  source_id:config.pins.sourceId,scope:config.scope,channel};
 const base='xagent:factory:capture-sync:v1:'+config.scope+':'+channel;
 return {source,expiresAt,expiresAtSeconds:Math.floor(expiresAt/1000),ttl,token,base,indexKey:base+':index',maxQueue:MAX_QUEUE};
}
export const factoryOutboxId=({source,entry})=>hash(JSON.stringify([source.scope,source.channel,
 entry.result.binding.sessionKey,entry.input.revision,entry.result.acceptedStateHash]));
const sameSource=(a,b)=>exact(a,Object.keys(b))&&Object.keys(b).every(k=>a[k]===b[k]);
const itemKey=(c,id)=>c.base+':item:'+id;
const ackKey=(c,id)=>c.base+':ack:'+id;

function validateRaw(raw,c,id,expectedHash){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX_RAW||hash(raw)!==expectedHash)fail('FACTORY_SYNC_EVIDENCE_INTEGRITY');
 let envelope;try{envelope=JSON.parse(raw);}catch{fail('FACTORY_SYNC_EVIDENCE_INTEGRITY');}
 const p=envelope?.provenance,e=envelope?.entry;
 if(envelope.schema!=='factory.capture-source.v0.1'||!p||!sameSource(Object.fromEntries(Object.keys(c.source).map(k=>[k,p[k]])),c.source)
  ||p.kind!=='HOSTED_CAPTURE_BATCH_COMPLETE'||p.completion!=='CAPTURE_BATCH_COMPLETE'
  ||e?.input?.revision!==4||!envelope.native||typeof envelope.native.text!=='string'||hash(envelope.native.text)!==envelope.native.sha256
  ||!e?.result?.binding||factoryOutboxId({source:c.source,entry:e})!==id)
  fail('FACTORY_SYNC_EVIDENCE_INTEGRITY');
 return envelope;
}
function openItem(raw,c,codec,id,expectedHash){
 let record;try{record=JSON.parse(raw);}catch{fail('FACTORY_SYNC_EVIDENCE_INTEGRITY');}
 if(!exact(record,['id','payload_sha256','box'])||record.id!==id||record.payload_sha256!==expectedHash)fail('FACTORY_SYNC_EVIDENCE_INTEGRITY');
 const value=codec.open(record.box,itemKey(c,id),0);
 if(!exact(value,['raw','id','payload_sha256'])||value.id!==id||value.payload_sha256!==expectedHash)fail('FACTORY_SYNC_EVIDENCE_INTEGRITY');
 validateRaw(value.raw,c,id,expectedHash);
 return {id,payload_sha256:expectedHash,raw:value.raw};
}
const receiptKeys=['id','payload_sha256','import_id','agent_id','session_id','case_version'];
function receiptBody(body){
 if(!exact(body,receiptKeys)||!hex(body.id)||!hex(body.payload_sha256)||!hex(body.case_version)
  ||typeof body.import_id!=='string'||!/^[A-Za-z0-9-]{8,80}$/.test(body.import_id)
  ||typeof body.agent_id!=='string'||!/^agent-[a-f0-9]{24}$/.test(body.agent_id)
  ||typeof body.session_id!=='string'||!/^local-session-[a-f0-9]{24}$/.test(body.session_id))fail('FACTORY_SYNC_ACK_INVALID',400);
 return Object.fromEntries(receiptKeys.map(k=>[k,body[k]]));
}
function openAck(raw,c,codec,id,metadata){
 let record;try{record=JSON.parse(raw);}catch{fail('FACTORY_SYNC_ACK_INTEGRITY');}
 if(!exact(record,['receipt_sha256','box'])||record.receipt_sha256!==metadata.receipt_sha256)fail('FACTORY_SYNC_ACK_INTEGRITY');
 const value=codec.open(record.box,ackKey(c,id),0),receipt=receiptBody(value.receipt);
 if(!sameSource(value.source,c.source)||receipt.id!==id||receipt.payload_sha256!==metadata.payload_sha256
  ||hash(JSON.stringify(receipt))!==record.receipt_sha256)fail('FACTORY_SYNC_ACK_INTEGRITY');
 return receipt;
}

// Invoked before the existing capture commit. The Lua commit atomically writes
// its immutable encrypted record and index together with the accepted capture.
export function createFactorySyncPublisher({env,config,command,codec}){
 const c=readFactorySyncConfig(env,config);if(!c)return null;
 return {config:c,async prepare({entry,previous}){
  if(entry?.input?.revision!==4)return null;
  if(!previous||entry.result?.binding?.sessionKey!==sessionKey(entry.session)
   ||entry.result.binding.previousStateHash!==previous.result?.acceptedStateHash)fail('FACTORY_SYNC_PREVIOUS_STATE_REQUIRED');
  const prepared=prepareConsumerCapture({sessionKey:sessionKey(entry.session),role:entry.input.role,
   turns:entry.input.turns,revision:4,previousState:previous.result.captureState});
  if(digest(prepared.binding)!==digest(entry.result.binding)
   ||digest(prepared.accept({binding:prepared.binding,wire:entry.wire}))!==digest(entry.result))fail('FACTORY_SYNC_CAPTURE_REVALIDATION_FAILED');
  const nativeKey='xagent:capture-luna-test:v1:'+lunaPlan.testId;
  const retained=await command(['GET',nativeKey]);if(!retained)fail('FACTORY_SYNC_NATIVE_EVIDENCE_REQUIRED');
  const record=codec.open(retained,nativeKey,0);
  if(record.testId!==lunaPlan.testId||record.requestHash!==lunaPlan.requestHash||record.httpStatus!==200
   ||record.state!=='PROVIDER_RESPONSE_RETAINED_VALIDATION_PENDING'||digest(record.applicationBinding)!==digest(entry.result.binding)
   ||typeof record.nativeText!=='string')fail('FACTORY_SYNC_NATIVE_EVIDENCE_MISMATCH');
  let native,wire;try{
   native=JSON.parse(record.nativeText);
   wire=JSON.parse(native.output.flatMap(x=>x.content).map(x=>{if(x.type!=='output_text')throw new Error();return x.text;}).join(''));
  }catch{fail('FACTORY_SYNC_NATIVE_EVIDENCE_MISMATCH');}
  if(native.status!=='completed'||native.model!=='gpt-6-luna'||digest(wire)!==digest(entry.wire))fail('FACTORY_SYNC_NATIVE_EVIDENCE_MISMATCH');
  const envelope={schema:'factory.capture-source.v0.1',entry:clone(entry),previousState:clone(previous.result.captureState),
   native:{text:record.nativeText,sha256:hash(record.nativeText)},
   provenance:{kind:'HOSTED_CAPTURE_BATCH_COMPLETE',completion:'CAPTURE_BATCH_COMPLETE',...c.source}};
  const raw=JSON.stringify(envelope),payload_sha256=hash(raw),id=factoryOutboxId({source:c.source,entry});
  validateRaw(raw,c,id,payload_sha256);
  const value={id,payload_sha256,raw},recordRaw=JSON.stringify({id,payload_sha256,box:codec.seal(value,itemKey(c,id),0)});
  return {id,payload_sha256,keys:[c.indexKey,itemKey(c,id)],record:recordRaw,ttl:c.ttl,expiresAtSeconds:c.expiresAtSeconds,maxQueue:c.maxQueue};
 }};
}

// Read-only queue inspection. ACKed entries require a valid encrypted receipt;
// evidence itself is never deleted or replaced by acknowledgement.
export const factoryPeekScript=`-- factory-capture-sync-peek-v1
local ids=redis.call('HKEYS',KEYS[1]);table.sort(ids)
if #ids>3 then return cjson.encode({error='QUEUE_BOUND_EXCEEDED'}) end
if #ids==0 then return '{"records":[],"item":null}' end
local records={};local selected=nil
for _,id in ipairs(ids) do
 local metadata=cjson.decode(redis.call('HGET',KEYS[1],id))
 local ack=redis.call('GET',ARGV[1]..':ack:'..id)
 table.insert(records,{id=id,metadata=metadata,ack=ack or cjson.null})
 if not selected and metadata.status=='PENDING' then
  selected={id=id,raw=redis.call('GET',ARGV[1]..':item:'..id) or cjson.null}
 end
end
return '{"records":'..cjson.encode(records)..',"item":'..(selected and cjson.encode(selected) or 'null')..'}'`;
export const factoryAckScript=`-- factory-capture-sync-ack-v1
local raw=redis.call('HGET',KEYS[1],ARGV[1])
if not raw or not redis.call('GET',KEYS[2]) then return 'MISSING' end
local metadata=cjson.decode(raw)
if metadata.payload_sha256~=ARGV[2] then return 'CONFLICT' end
local old=redis.call('GET',KEYS[3])
if metadata.status=='ACKED' then
 if metadata.receipt_sha256==ARGV[3] and old then return 'ALREADY_ACKNOWLEDGED' end
 return 'CONFLICT'
end
if metadata.status~='PENDING' or old then return 'CONFLICT' end
local deadline=tonumber(ARGV[5]);local now=tonumber(redis.call('TIME')[1])
if not deadline or deadline<=now or deadline>now+604800 then return 'EXPIRED' end
redis.call('SET',KEYS[3],ARGV[4])
redis.call('EXPIREAT',KEYS[3],deadline)
redis.call('HSET',KEYS[1],ARGV[1],cjson.encode({payload_sha256=ARGV[2],status='ACKED',receipt_sha256=ARGV[3]}))
redis.call('EXPIREAT',KEYS[1],deadline)
return 'ACKNOWLEDGED'`;

export function createFactorySyncHandlers({env=process.env,clock=Date.now,fetchImpl=fetch,pins}={}){
 async function handle(request,acknowledge){
  try{
   const config=readPreviewConfig(env,clock(),pins),c=readFactorySyncConfig(env,config);
   if(!c)return json({error:'Factory capture synchronization is disabled'},404);
   if(!trustedOrigin(request,config,false)||new URL(request.url).pathname!=='/api/factory-capture-sync')fail('FACTORY_SYNC_HOST_MISMATCH',403);
   const supplied=Buffer.from(request.headers.get('authorization')??''),expected=Buffer.from('Bearer '+c.token);
   if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))fail('FACTORY_SYNC_AUTH_REQUIRED',401);
   const command=createStorageCommand(config,fetchImpl),codec=createCaptureCodec(config.key);
   if(!acknowledge){
    let data;try{data=JSON.parse(await command(['EVAL',factoryPeekScript,1,c.indexKey,c.base]));}catch{fail('FACTORY_SYNC_STORAGE_REQUIRES_REVIEW');}
    if(!data||data.error||!Array.isArray(data.records)||data.records.length>3)fail('FACTORY_SYNC_STORAGE_REQUIRES_REVIEW');
    const pending=[];
    for(const r of data.records){
     if(!hex(r.id)||!hex(r.metadata?.payload_sha256))fail('FACTORY_SYNC_INDEX_INTEGRITY');
     if(r.metadata.status==='ACKED')openAck(r.ack,c,codec,r.id,r.metadata);
     else if(r.metadata.status==='PENDING'&&!r.ack)pending.push(r);
     else fail('FACTORY_SYNC_INDEX_INTEGRITY');
    }
    let items=[];
    if(pending.length){
     if(data.item?.id!==pending[0].id||typeof data.item.raw!=='string')fail('FACTORY_SYNC_INDEX_INTEGRITY');
     items=[openItem(data.item.raw,c,codec,pending[0].id,pending[0].metadata.payload_sha256)];
    }else if(data.item!==null)fail('FACTORY_SYNC_INDEX_INTEGRITY');
    return json({schema:'factory.capture-sync-batch.v0.1',source:c.source,expires_at:c.expiresAt,items});
   }
   const body=receiptBody(await readBoundedJsonObject(request,4096)),key=itemKey(c,body.id);
   const item=await command(['GET',key]);if(!item)fail('FACTORY_SYNC_ITEM_MISSING',404);
   openItem(item,c,codec,body.id,body.payload_sha256);
   const receipt_sha256=hash(JSON.stringify(body)),ack=JSON.stringify({receipt_sha256,
    box:codec.seal({receipt:body,source:c.source,received_at:config.now},ackKey(c,body.id),0)});
   const old=await command(['GET',ackKey(c,body.id)]);
   if(old){
    let oldReceipt;try{oldReceipt=JSON.parse(old);}catch{fail('FACTORY_SYNC_ACK_INTEGRITY');}
    if(oldReceipt.receipt_sha256!==receipt_sha256)fail('FACTORY_SYNC_ACK_CONFLICT',409);
    openAck(old,c,codec,body.id,{payload_sha256:body.payload_sha256,receipt_sha256});
   }
   const status=await command(['EVAL',factoryAckScript,3,c.indexKey,key,ackKey(c,body.id),body.id,body.payload_sha256,receipt_sha256,ack,String(c.expiresAtSeconds)]);
   if(!['ACKNOWLEDGED','ALREADY_ACKNOWLEDGED'].includes(status))fail('FACTORY_SYNC_ACK_CONFLICT',409);
   return json({schema:'factory.capture-sync-ack.v0.1',source:c.source,id:body.id,payload_sha256:body.payload_sha256,status});
  }catch(error){
   const status=error instanceof Fault?error.status:503;
   return json({error:'Factory capture synchronization needs attention',code:error instanceof Fault?error.code:'FACTORY_SYNC_REQUEST_FAILED',retryAllowed:false},status);
  }
 }
 return {GET:request=>handle(request,false),POST:request=>handle(request,true)};
}
