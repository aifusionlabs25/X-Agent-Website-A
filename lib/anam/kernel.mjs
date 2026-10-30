import {prepareConsumerCapture,digest,candidate} from './consumer-bridge.mjs';
import {CaptureContractError} from './capture/capture-state-contract.mjs';
import {CaptureApplicationError as Fault} from './errors.mjs';
export {CaptureApplicationError} from './errors.mjs';
export const sessionKey = binding => 'synthetic-'+digest(binding).slice(0,40);

// No default transport or credential lookup. The copied route is closed unless
// an explicit simulated instance is injected by the local application fixture.
export const readIsolatedCaptureConfig = () => ({configured:false});
export const runIsolatedCapture = async () => {throw new Fault('ISOLATED_ADAPTER_NOT_CONFIGURED',503);};

function checkStoredEntry(entry,session) {
 if(!entry)return;
 const r=entry.result;
 if(digest(entry.session)!==digest(session)||r?.binding.candidate!==candidate
  ||r.binding.role!=='moving'||r.binding.sessionKey!==sessionKey(session)
  ||r.sourceDigest!==digest(entry.input.turns)||r.sourceDigest!==r.captureState.sourceHash
  ||r.acceptedStateHash!==digest(r.captureState)||r.reviewHash!==digest(r.review)
  ||digest(r.capture)!==digest(r.captureState.record)||r.binding.revision!==r.capture.revision)
  throw new Fault('STORED_CAPTURE_INTEGRITY_REQUIRES_REVIEW',503);
}
function browserView(entry) {
 const r=entry.result;
 return {schema:'capture-application.v0.1',binding:{sessionId:entry.session.sessionId,launchId:entry.session.launchId,
  candidate,role:'moving',revision:r.binding.revision},capture:r.capture,sourceDigest:r.sourceDigest,
  review:r.review,reviewHash:r.reviewHash,
  receipt:{id:digest([entry.session,r.acceptedStateHash]),stateHash:r.acceptedStateHash,
   revision:r.binding.revision,sourceDigest:r.sourceDigest,actionAuthority:'NONE',
   serviceReference:r.serviceReferenceReceipt?{mode:r.serviceReferenceReceipt.mode,
    catalogHash:r.serviceReferenceReceipt.catalogHash,rawWireHash:r.serviceReferenceReceipt.rawWireHash}:null}};
}
export function createCaptureApplication({store,respond,mode}) {
 if(mode!=='SIMULATED_ONLY'||typeof respond!=='function')throw new Fault('SIMULATED_TRANSPORT_REQUIRED',503);
 return async function capture({session,turns,revision,operation='capture',signal,stillActive}) {
  const key=sessionKey(session);
  signal?.throwIfAborted();
  if(!await stillActive())throw new Fault('SESSION_CLOSED');
  if(operation==='read'){
   const entry=await store.read(key);checkStoredEntry(entry,session);return entry?browserView(entry):{schema:'capture-application.v0.1',empty:true};
  }
  const source=digest(turns),reservation=await store.begin(key,revision,source);
  if(reservation.duplicate){checkStoredEntry(reservation.entry,session);return browserView(reservation.entry);}
  try {
   checkStoredEntry(reservation.previous,session);
   const prior=reservation.previous?.result.captureState??null;
   const prepared=prepareConsumerCapture({sessionKey:key,role:'moving',turns,revision,previousState:prior});
   const wire=await respond(structuredClone(prepared.request),{signal,binding:structuredClone(prepared.binding)});
   signal?.throwIfAborted();
   if(Buffer.byteLength(JSON.stringify(wire)??'')>256*1024)throw new Fault('CAPTURE_OUTPUT_TOO_LARGE',422);
   const result=prepared.accept({binding:prepared.binding,wire});
   if(!await stillActive())throw new Fault('SESSION_CLOSED');
   signal?.throwIfAborted();
   const entry={session:structuredClone(session),input:{role:'moving',turns:structuredClone(turns),revision},
    wire:structuredClone(wire),result};
   await store.commit(key,revision,source,reservation.previous?.result.acceptedStateHash??null,entry);
   return browserView(entry);
  } catch(error) {
   const fault=error instanceof Fault?error:signal?.aborted?new Fault('CAPTURE_ABORTED',409):
    error instanceof CaptureContractError?new Fault(error.issues?.[0]?.code??'CAPTURE_REQUIRES_REVIEW',422):
    new Fault('SIMULATED_TRANSPORT_FAILED',503);
   try{await store.fail(key,revision,fault.code);}catch{throw new Fault('CAPTURE_STORAGE_RESULT_UNKNOWN',503);}throw fault;
  }
 };
}
