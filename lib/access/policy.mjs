// Explicit synthetic fixture authorization, never a signed-in owner assertion.
// The live website access policy is neither imported, changed nor bypassed.
import {isolatedRuntime} from '../anam/isolated-capture-application.mjs';
export async function requireAgentBrowserAccess(_request,agent,browserId){
 const r=isolatedRuntime();return r?.mode==='SIMULATED_ONLY'&&agent==='evan'&&browserId===r.binding.browserId
  ?null:Response.json({error:'Synthetic fixture access required'},{status:403});
}
