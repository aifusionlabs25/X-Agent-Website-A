// Browser-safe: no server credential/state module, node:crypto or provider client.
import {validateEvanCapture,projectEvanCaptureContact,projectEvanCapturePlan,projectEvanCaptureIntake}
 from './capture/evan-capture.ts';
const candidate='f04d8728aea5cc6d3339cc73d4cb2a23ac96c15bb50b17ba0a6b0b797e012cca';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=value=>{if(!value)throw new Error('INVALID_CAPTURE_VIEW');};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))]
 .map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function validateBrowserCapture(raw,turns,revision,session) {
 need(raw&&Object.keys(raw).sort().join(',')==='binding,capture,receipt,review,reviewHash,schema,sourceDigest');
 need(raw.schema==='capture-application.v0.1'&&raw.binding?.candidate===candidate&&raw.binding.role==='moving');
 need(raw.binding.sessionId===session.sessionId&&raw.binding.launchId===session.launchId&&raw.binding.revision===revision);
 need(raw.capture?.revision===revision&&raw.capture.sourceTurnCount===turns.length&&raw.sourceDigest===await hash(turns));
 const record=validateEvanCapture({facts:raw.capture.facts},turns,revision);
 need(equal(record,raw.capture));
 const r=raw.review,c=projectEvanCaptureContact(record);
 need(r&&r.status==='UNSUBMITTED_CAPTURE_REVIEW'&&r.roleApplicability==='MOVING_PROJECTIONS_SUPPORTED');
 need(r.emailSendAllowed===false&&r.actionAuthority==='NONE'&&r.handoffAuthority==='NONE'
  &&r.handoffReadiness==='NOT_EVALUATED'&&r.ownerApproval==='NOT_GRANTED');
 need(equal(r.plan,projectEvanCapturePlan(record))&&equal(r.intake,projectEvanCaptureIntake(record)));
 const rows=[],confirm=[];
 need(r.collection&&Object.keys(r.collection).every(f=>['name','phone','email'].includes(f)));
 for(const field of ['name','phone','email']){
  const value=c[field==='name'?'displayName':field],event=r.collection[field];
  if(event)need(event.field===field&&['PROVIDED','UNCONFIRMED','UNKNOWN','DECLINED','DEFERRED','REMOVED'].includes(event.state)
   &&Number.isSafeInteger(event.revision)&&event.revision<=revision&&Array.isArray(event.evidence));
  if(value&&(!event||event.state==='PROVIDED'))rows.push({field,label:{name:'Name',phone:'Phone',email:'Email'}[field],value});
  if(event?.state==='UNCONFIRMED')confirm.push(field);
  need(r.mayAskContact[field]===(!event&&!rows.some(x=>x.field===field)));
 }
 need(equal(rows,r.contact)&&equal(confirm,r.confirmationNeeded)&&await hash(r)===raw.reviewHash);
 const receipt=raw.receipt;
 need(receipt&&hex(receipt.id)&&hex(receipt.stateHash)&&receipt.revision===revision
  &&receipt.sourceDigest===raw.sourceDigest&&receipt.actionAuthority==='NONE');
 return {record,review:structuredClone(r),receipt:structuredClone(receipt)};
}

// The application must use this current-state selector instead of feeding
// website/account identity into projectEvanCaptureContact as a fallback.
export function captureContactView(state) {
 const contact=projectEvanCaptureContact(state.record??{facts:[]});
 for(const [field,key] of [['name','displayName'],['phone','phone'],['email','email']]){
  const value=state.review?.contact.find(row=>row.field===field)?.value??'';
  contact[key]=value;
  if(field==='phone'&&!value)contact.phoneConfirmed=false;
  if(field==='email'&&!value){contact.emailSource=null;contact.proposedEmail='';}
 }
 return contact;
}
