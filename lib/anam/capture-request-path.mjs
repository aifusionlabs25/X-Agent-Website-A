// Isolated version of AnamPlayer's existing same-origin capture request seam.
// fetchImpl is required: the simulation cannot fall back to global network I/O.
import {awaitEvanCaptureWork} from './evan-capture-client.ts';
export function createCaptureRequestPath({fetchImpl,session,bindingPromise,isActive=()=>true}) {
 if(typeof fetchImpl!=='function'||typeof session!=='function')throw new Error('ISOLATED_REQUEST_DEPENDENCIES_REQUIRED');
 async function send(fields,signal){
  if(bindingPromise)await awaitEvanCaptureWork(bindingPromise,signal);
  signal.throwIfAborted();const bound=session();
  if(!isActive()||!bound?.launchId||!bound?.sessionId)throw new Error('Capture session not ready');
  const response=await fetchImpl('/api/anam/evan/capture',{
   method:'POST',credentials:'same-origin',cache:'no-store',signal,
   headers:{'Content-Type':'application/json'},body:JSON.stringify({...bound,...fields}),
  });
  if(!response.ok)throw new Error('Capture update unavailable');return response.json();
 }
 return {request:(turns,revision,signal)=>send({turns,revision},signal),
  restore:signal=>send({operation:'read'},signal)};
}
