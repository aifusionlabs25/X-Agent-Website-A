import {createHash} from 'node:crypto';
import plan from './luna-policy.json' with {type:'json'};
import {CaptureApplicationError as Fault} from '../anam/errors.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const finishScript=`-- capture-luna-one-shot-finish-v1
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL')
return 1`;
export function buildLunaRequest(req,meta){
 if(meta.binding.revision!==plan.revision||meta.binding.sourceHash!==plan.sourceHash||meta.binding.previousStateHash!==plan.previousStateHash)
  throw new Fault('LUNA_PINNED_REQUEST_REQUIRED',409);
 const body={model:'gpt-6-luna',service_tier:'default',store:false,stream:false,background:false,reasoning:{effort:'none'},max_output_tokens:5000,tools:[],truncation:'disabled',prompt_cache_options:{mode:'explicit'},
  instructions:req.instructions,input:[{role:'user',content:JSON.stringify(req.input)}],text:{format:{type:'json_schema',name:'capture_state_v01',strict:true,schema:req.schema}}};
 const raw=JSON.stringify(body);
 if(Buffer.byteLength(raw)!==plan.requestBytes||hash(raw)!==plan.requestHash)throw new Fault('LUNA_PINNED_REQUEST_REQUIRED',409);
 return raw;
}
// Operator-provided preflight must be checked against the real account before activation.
// Its flags/reference are NOT independent proof of billing controls or human approval.
export function readLunaRuntime(env,now=Date.now()){
 let receipt;try{receipt=JSON.parse(env.CAPTURE_LUNA_VERIFIED_PREFLIGHT??'');}catch{throw new Fault('LUNA_OWNER_APPROVAL_AND_FRESH_PREFLIGHT_REQUIRED',503);}
 const fail=()=>{throw new Fault('LUNA_OWNER_APPROVAL_AND_FRESH_PREFLIGHT_REQUIRED',503);};
 if(env.CAPTURE_LUNA_AUTHORIZED_TEST_ID!==plan.testId||!env.CAPTURE_LUNA_API_KEY||env.CAPTURE_LUNA_PROJECT_ID!==plan.openaiProjectId
  ||!Number.isFinite(receipt.verifiedAt)||now<receipt.verifiedAt||now-receipt.verifiedAt>30*60*1000
  ||now>=Date.parse(plan.resourceExpiresAt)||receipt.requestHash!==plan.requestHash||receipt.testId!==plan.testId
  ||receipt.projectId!==plan.openaiProjectId||receipt.model!=='gpt-6-luna'||receipt.serviceTier!=='default'
  ||receipt.credentialFingerprint!==hash(env.CAPTURE_LUNA_API_KEY)||receipt.credentialVerified!==true||receipt.spendingVerified!==true||receipt.creditVerified!==true
  ||receipt.maxCalls!==1||receipt.retries!==0||receipt.grossCapMicrodollars!==plan.proposedGrossCapMicrodollars
  ||!Number.isSafeInteger(receipt.projectRemainingMicrodollars)||!Number.isSafeInteger(receipt.pilotRemainingMicrodollars)
  ||receipt.projectRemainingMicrodollars<plan.proposedGrossCapMicrodollars||receipt.pilotRemainingMicrodollars<plan.proposedGrossCapMicrodollars
  ||receipt.inputRate!==0.10||receipt.outputRate!==0.50||receipt.taxReserveMicrodollars!==10000
  ||!/^([a-f0-9]{64})$/.test(receipt.ownerApprovalRecordHash??''))fail();
 return {apiKey:env.CAPTURE_LUNA_API_KEY,projectId:plan.openaiProjectId,now,approvalRecordHash:receipt.ownerApprovalRecordHash,preflightHash:hash(JSON.stringify(receipt))};
}
function completedWire(native){
 if(native.status!=='completed'||native.model!=='gpt-6-luna'||native.service_tier!=='default'||!Array.isArray(native.output))throw new Fault('LUNA_PROVIDER_RESULT_REQUIRES_REVIEW',422);
 const usage=native.usage,n=usage?.input_tokens,o=usage?.output_tokens,d=usage?.input_tokens_details;
 const allowed=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).every(k=>keys.includes(k));
 if(!allowed(usage,['input_tokens','output_tokens','total_tokens','input_tokens_details','output_tokens_details'])
  ||!allowed(d,['cached_tokens','cache_write_tokens','cache_write_tokens_details'])
  ||!allowed(d.cache_write_tokens_details,['ttl_12h_tokens','ttl_30m_tokens'])
  ||!allowed(usage.output_tokens_details,['reasoning_tokens'])||!Number.isSafeInteger(usage.output_tokens_details.reasoning_tokens)
  ||usage.output_tokens_details.reasoning_tokens<0||usage.output_tokens_details.reasoning_tokens>o)throw new Fault('LUNA_USAGE_REQUIRES_REVIEW',422);
 if(!Number.isSafeInteger(n)||n<0||n>32768||!Number.isSafeInteger(o)||o<0||o>5000||usage.total_tokens!==n+o
  ||d?.cached_tokens!==0||d?.cache_write_tokens!==0||d?.cache_write_tokens_details?.ttl_12h_tokens!==0||d?.cache_write_tokens_details?.ttl_30m_tokens!==0)
  throw new Fault('LUNA_USAGE_REQUIRES_REVIEW',422);
 const cost=Math.ceil(n*0.10+o*0.50);if(cost+10000>plan.proposedGrossCapMicrodollars)throw new Fault('LUNA_SPENDING_REQUIRES_REVIEW',422);
 let text='';
 for(const output of native.output){
  if(output.type!=='message'||output.role!=='assistant'||output.status!=='completed'||!Array.isArray(output.content))throw new Fault('LUNA_OUTPUT_REQUIRES_REVIEW',422);
  for(const part of output.content){if(part.type!=='output_text'||typeof part.text!=='string')throw new Fault('LUNA_OUTPUT_REQUIRES_REVIEW',422);text+=part.text;}
 }
 let wire;try{wire=JSON.parse(text);}catch{throw new Fault('LUNA_OUTPUT_REQUIRES_REVIEW',422);}
 return wire;
}
export function createLunaResponder({runtime,command,codec,fetchImpl=fetch}){
 return async(req,meta)=>{
  const raw=buildLunaRequest(req,meta),key='xagent:capture-luna-test:v1:'+plan.testId;
  const ttl=Math.floor((Date.parse(plan.resourceExpiresAt)-runtime.now)/1000);if(ttl<1)throw new Fault('LUNA_AUTHORIZATION_EXPIRED',503);
  const binding={testId:plan.testId,requestHash:plan.requestHash,applicationBinding:meta.binding,approvalRecordHash:runtime.approvalRecordHash,preflightHash:runtime.preflightHash};
  const reserved=codec.seal({...binding,state:'RESERVED_BEFORE_DISPATCH'},key,0);
  // Key is bound to the authorization, not the browser, fixture or deployment.
  // It is never deleted/released, even after a timeout, failure or rejected output.
  if(await command(['SET',key,reserved,'NX','EX',String(ttl)])!=='OK')throw new Fault('LUNA_TEST_ALREADY_RESERVED_NO_RETRY',409);
  let record={...binding,state:'DISPATCH_RESULT_UNKNOWN'},response;
  try{
   response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',cache:'no-store',
    signal:AbortSignal.any([meta.signal??new AbortController().signal,AbortSignal.timeout(15000)]),
    headers:{Authorization:'Bearer '+runtime.apiKey,'OpenAI-Project':runtime.projectId,'Content-Type':'application/json','X-Client-Request-Id':plan.testId},body:raw});
   const nativeText=await response.text();if(Buffer.byteLength(nativeText)>plan.maxResponseBytes)throw new Fault('LUNA_RESPONSE_TOO_LARGE',422);
   if(nativeText.includes(runtime.apiKey)){record={...binding,state:'PROVIDER_RESPONSE_REDACTED_FOR_CREDENTIAL_SAFETY',httpStatus:response.status,responseHash:hash(nativeText)};throw new Fault('LUNA_RESPONSE_REQUIRES_PRIVATE_REVIEW',503);}
   record={...binding,state:'PROVIDER_RESPONSE_RETAINED_VALIDATION_PENDING',httpStatus:response.status,providerRequestId:response.headers.get('x-request-id'),nativeText};
  }catch(error){
   try{await finish(record);}catch{throw new Fault('LUNA_EVIDENCE_RESULT_UNKNOWN_NO_RETRY',503);}
   throw error instanceof Fault?error:new Fault('LUNA_DISPATCH_RESULT_UNKNOWN_NO_RETRY',503);
  }
  await finish(record);
  if(response.status!==200)throw new Fault('LUNA_PROVIDER_HTTP_'+response.status,503);
  let native;try{native=JSON.parse(record.nativeText);}catch{throw new Fault('LUNA_OUTPUT_REQUIRES_REVIEW',422);}
  // Authoritative evidence/reference validation and acceptance are still done by the unchanged contract.
  return completedWire(native);
  async function finish(value){
   const next=codec.seal(value,key,0);
   if(Number(await command(['EVAL',finishScript,1,key,reserved,next]))!==1)throw new Fault('LUNA_EVIDENCE_RESULT_UNKNOWN_NO_RETRY',503);
  }
 };
}
