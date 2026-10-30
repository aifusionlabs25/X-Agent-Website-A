// Prospective, source-bound wire adapter. It never repairs a historical answer.
// A small, explicit service-change grammar can produce exact records locally.
// The model selects those records by ID; every resolved record still passes the
// unchanged authoritative validator. Unsupported changes stop for review.
import {createHash} from 'node:crypto';
import {currentEvanCaptureFacts,evanServiceIdentity} from './evan-capture.ts';
import {maskEvanCaptureContacts} from './evan-capture-service.ts';

const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fold=x=>String(x).normalize('NFKC').replace(/[’‘]/gu,"'").replace(/\s+/gu,' ').trim().toLowerCase();
const escape=x=>x.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const identity=f=>JSON.stringify([f.location,fold(f.scope),evanServiceIdentity(f.value)]);
const disassembly='disassembl(?:e|y|ing)|taking? apart';
const relevant=/\b(?:disassembl\w*|reassembl\w*|cancel|withdraw|take\b.*\bapart)\b/iu;
const unsafe=/["“”]|\b(?:if|maybe|might|could|don't|do not|never|not|said|says|asked|example|suppose|hypothetical)\b/iu;
const clean=raw=>raw.trim().replace(/[.!?]+$/u,'').trim();
const fact=(value,scope,status,location,evidence)=>({category:'service',value,scope,status,location,evidence,quantity:'',route:null});

// Offsets are supplementary receipts; the canonical quotes remain untouched.
function sourceSpan(turns,e,fail){
 const text=turns[e.turn]?.content,start=text?.indexOf(e.quote)??-1;
 if(start<0||text.indexOf(e.quote,start+1)!==-1)fail('SERVICE_SOURCE_SPAN_AMBIGUOUS');
 return {turn:e.turn,start,end:start+e.quote.length,quote:e.quote};
}

function segments(content){
 // Keep the same-sentence semicolon antecedent intact. Split coordinated
 // explicit commands only, never an item list or a quoted/narrated sentence.
 return (content.match(/[^.!?]+[.!?]?/gu)??[]).flatMap(sentence=>{
  if(unsafe.test(fold(sentence)))return [sentence.trim()];
  return sentence.split(/\s+(?:and|but)\s+(?=(?:please\s+)?(?:cancel|remove|withdraw|keep|retain|request|reassemble|disassemble)\b)/iu).map(x=>x.trim());
 }).filter(Boolean);
}

function parseChange(quote,turn,scopes,current,turns,fail){
 const text=clean(quote),e={turn,quote};
 if(quote.trim().endsWith('?')||unsafe.test(fold(text)))return null;
 const found=[];
 for(const scope of scopes){
  const item=`(?:(?:the|my|our)\\s+)?(${escape(scope)})`;
  const named=`(?:${item}\\s+(${disassembly})|(${disassembly})\\s+(?:of|for)\\s+${item})`;
  const canceled=new RegExp(`^(?:please\\s+)?(?:cancel|remove|withdraw|(?:we|I)\\s+no longer need)\\s+${named}(?:\\s+(?:request|service|help))?$`,'iu').exec(text);
  const kept=new RegExp(`^(?:please\\s+)?(?:keep|retain|request|(?:we|I)\\s+(?:still\\s+)?(?:want|need))\\s+${named}(?:\\s+requested)?$`,'iu').exec(text);
  const explicit=canceled??kept;
  const matching=service=>[...current.values()].filter(f=>fold(f.scope)===fold(scope)&&evanServiceIdentity(f.value)===service);
  if(explicit){
   const prior=matching('disassembly');if(prior.length!==1)fail('SERVICE_LOCATION_REQUIRES_REVIEW');
   const literalItem=explicit[1]??explicit[4],value=explicit[2]??explicit[3];
   found.push(fact(value,literalItem,canceled?'removed':'asserted',prior[0].location,[e]));continue;
  }
  const requested=new RegExp(`^(?:please\\s+)?(reassemble|disassemble)\\s+${item}(?:\\s+only)?(?:\\s+at\\s+(delivery|destination|pickup|origin))?$`,'iu').exec(text);
  if(requested){
   const prior=matching(evanServiceIdentity(requested[1]));
   if(prior.length>1)fail('SERVICE_LOCATION_REQUIRES_REVIEW');
   const place=requested[3]?.toLowerCase(),location=place?(['delivery','destination'].includes(place)?'destination':'origin'):prior[0]?.location??'unspecified';
   found.push(fact(requested[1],requested[2],'asserted',location,[e]));continue;
  }
  const local=new RegExp(`^(?:we(?:'ll| will| are going to)|i(?:'ll| will|'m going to| am going to))\\s+`
   +`(?:take\\s+${item}\\s+apart|(disassemble)\\s+${item})(?:\\s+(?:ourselves|myself))?`
   +`(?:\\s+(?:too|as well))?\\s*;\\s*(?:please\\s+)?cancel\\s+that(?:\\s+(?:request|service|help))?`
   +`(?:\\s+(?:too|as well))?$`,'iu').exec(text.replace(/[’‘]/gu,"'"));
  if(local){
   const prior=matching('disassembly');if(prior.length!==1)fail('SERVICE_LOCATION_REQUIRES_REVIEW');
   // "take the item apart" is not the contiguous value "take apart".
   // Reuse an actual earlier VISITOR service word if needed, never the agent's.
   const old=prior[0],visitorOnly=old.evidence.every(x=>turns[x.turn]?.role==='user');
   const action=quote.match(/\bdisassemble\b/iu)?.[0];
   if(!action&&!visitorOnly)fail('SERVICE_LITERAL_ANTECEDENT_REQUIRES_REVIEW');
   const literalItem=quote.match(new RegExp(`(?<![\\p{L}\\p{N}])${escape(scope)}(?![\\p{L}\\p{N}])`,'iu'))?.[0];
   if(!literalItem)fail('SERVICE_SOURCE_SPAN_AMBIGUOUS');
   found.push(fact(action??old.value,literalItem,'removed',old.location,action?[e]:[...structuredClone(old.evidence),e]));
  }
 }
 if(found.length>1)fail('SERVICE_SCOPE_REQUIRES_REVIEW');
 return found[0]??null;
}

/** Only manage a known service episode with an explicit new service change.
 * Shared-contact and unrelated requests retain the original wire contract. */
export function bindServiceChangeReferences(base,context,previous,api){
 const fail=code=>{throw new api.Error([{code,field:'service',index:null}]);};
 if(context.role!=='moving'||!previous)return base;
 const initial=currentEvanCaptureFacts(previous.record).filter(f=>f.category==='service');
 if(!initial.length)return base;
 const newTurns=context.turns.slice(previous.sourceTurnCount);
 if(!newTurns.some(t=>t.role==='user'&&relevant.test(t.content)))return base;
 const frozen=structuredClone(context),prior=structuredClone(previous),contextHash=digest(context),previousHash=digest(previous);
 // Revalidate old facts, not just an untrusted ID or a claimed approval flag.
 api.validate({facts:initial,contactStates:[]},frozen);
 const current=new Map(initial.map(f=>[identity(f),structuredClone(f)]));
 const scopes=[...new Set(initial.map(f=>f.scope))];
 if(scopes.some(x=>!x||x.length>80))fail('SERVICE_SCOPE_REQUIRES_REVIEW');
 const events=[];
 for(let turn=previous.sourceTurnCount;turn<frozen.turns.length;turn++){
  if(frozen.turns[turn].role!=='user')continue;
  for(const quote of segments(frozen.turns[turn].content)){
   const change=parseChange(quote,turn,scopes,current,frozen.turns,fail);
   if(!change){if(relevant.test(quote))fail('SERVICE_CHANGE_REQUIRES_REVIEW');continue;}
   // Validate every change independently before it is even offered to Luna.
   const validated=api.validate({facts:[change],contactStates:[]},frozen).record.facts[0];
   const key=identity(validated),old=current.get(key);
   if(events.some(x=>x.turn===turn&&x.identity===key))fail('SAME_TURN_SERVICE_CONFLICT_REQUIRES_REVIEW');
   events.push({turn,identity:key,before:old??null,after:validated,sourceSpan:sourceSpan(frozen.turns,{turn,quote},fail)});
   current.set(key,validated);
  }
 }
 if(!events.length)fail('SERVICE_CHANGE_REQUIRES_REVIEW');
 const binding={role:frozen.role,revision:frozen.revision,sourceHash:digest(frozen.turns),previousStateHash:previousHash};
 const records=[...current.values()];
 // Detect stale renewals/other transition defects with the existing state
 // validator before exposing any source record in the request.
 const availableCallbacks=base.input.sourceRequirements.map(r=>({category:r.category,value:r.quote,status:r.status,
  location:'unspecified',scope:'',quantity:'',route:null,evidence:[{turn:r.turn,quote:r.quote}]}));
 api.apply(prior,{facts:[...records,...availableCallbacks],contactStates:[]},frozen);
 const catalog=records.map(f=>({id:'svc-'+digest([binding,f]).slice(0,32),fact:f,
  sourceSpans:f.evidence.map(e=>sourceSpan(frozen.turns,e,fail))}));
 // A service quote must not introduce unmasked contact data through a new input.
 const serialized=JSON.stringify(catalog.map(entry=>entry.fact));
 if(maskEvanCaptureContacts([{role:'user',content:serialized}]).turns[0].content!==serialized)
  fail('SERVICE_REFERENCE_PRIVACY_REQUIRES_REVIEW');
 const catalogHash=digest(catalog),ids=catalog.map(x=>x.id),schema=structuredClone(base.schema);
 schema.required=[...schema.required,'serviceReferences'];
 schema.properties.facts.items.properties.category.enum=schema.properties.facts.items.properties.category.enum.filter(x=>x!=='service');
 schema.properties.serviceReferences={type:'array',minItems:ids.length,maxItems:ids.length,items:{type:'string',enum:[...ids]}};
 const decode=wire=>{
  if(digest(context)!==contextHash||digest(previous)!==previousHash)fail('STALE_SERVICE_REFERENCE_CONTEXT');
  if(!wire||typeof wire!=='object'||Array.isArray(wire)||Object.keys(wire).sort().join(',')!=='contactStates,facts,serviceReferences'
   ||!Array.isArray(wire.facts)||!Array.isArray(wire.contactStates)||!Array.isArray(wire.serviceReferences))fail('SERVICE_REFERENCE_ENVELOPE_REQUIRED');
  if(wire.facts.some(f=>f?.category==='service'))fail('RAW_SERVICE_FACT_FORBIDDEN_IN_REFERENCE_MODE');
  const selected=wire.serviceReferences;
  if(new Set(selected).size!==selected.length||selected.some(id=>!ids.includes(id)))fail('INVALID_SERVICE_REFERENCE');
  if(selected.length!==ids.length)fail('MISSING_REQUIRED_SERVICE_REFERENCE');
  const nonservice=base.restore({facts:wire.facts,contactStates:wire.contactStates});
  const payload={facts:[...nonservice.facts,...structuredClone(records)],contactStates:nonservice.contactStates};
  api.validate(payload,frozen);
  return {payload,receipt:{mode:'SOURCE_BOUND_SERVICE_REFERENCES_V1',...binding,catalogHash,
   rawWireHash:digest(wire),selectedReferences:[...selected],serviceFactsHash:digest(records),
   serviceFactsOrigin:'EXACT_VALIDATED_SOURCE_LOOKUP_NOT_MODEL_AUTHORED',actionAuthority:'NONE'}};
 };
 const accept=wire=>{
  const decoded=decode(wire),state=api.apply(prior,decoded.payload,frozen);
  state.audit.at(-1).serviceReferenceReceipt=decoded.receipt;
  return {state,receipt:decoded.receipt,payload:decoded.payload};
 };
 // Do not feed the model service facts twice as mutable memory and immutable
 // references. The complete prior state is still hashed and retained locally.
 const input=structuredClone(base.input);
 input.previousAccepted.facts=input.previousAccepted.facts.filter(f=>f.category!=='service');
 input.serviceEvidence=structuredClone({mode:'SOURCE_BOUND_SERVICE_REFERENCES_V1',binding,catalogHash,catalog,requiredReferences:ids});
 return {...base,schema,input,decode,accept,restore:wire=>decode(wire).payload,
  serviceReferenceMode:true,serviceChangeAudit:structuredClone(events),
  instructions:base.instructions+'\nSOURCE-BOUND SERVICE MODE: Service records are already validated from exact source spans. Do not generate or edit service facts, quotations, values, scope or status. Return every requiredReferences ID exactly once in serviceReferences. Those records include current cancellations and unaffected services. Earlier service acceptance is preserved privately as immutable history. Continue capturing all nonservice facts and contactStates normally; no service reference grants action authority. Missing, duplicate, stale or unknown references are rejected, never repaired.'};
}
