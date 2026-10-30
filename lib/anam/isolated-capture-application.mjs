import {createCaptureApplication} from './kernel.mjs';
import {createRedisCaptureStore} from './redis-store.mjs';
import {createCaptureCodec} from './codec.mjs';
import {CaptureApplicationError} from './errors.mjs';
export {CaptureApplicationError};
const slot=Symbol.for('xagent.capture.isolated.runtime.v1');
export function installIsolatedCaptureRuntime(config){
 if(config?.mode!=='SIMULATED_ONLY'||typeof config.command!=='function'||typeof config.respond!=='function'
  ||!/^capture-sim-[a-z0-9-]+$/.test(config.namespace??'')||!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.origin??'')
  ||!Buffer.isBuffer(config.encryptionKey)||config.encryptionKey.length!==32||!config.binding?.sessionId)
  throw new CaptureApplicationError('EXPLICIT_ISOLATED_RUNTIME_REQUIRED',503);
 const publicOrigin=new URL(config.origin),canonical=config.canonicalRequestOrigin??config.origin;
 if(![config.origin,'http://localhost:'+publicOrigin.port].includes(canonical))
  throw new CaptureApplicationError('UNEXPECTED_INTERNAL_ORIGIN',503);
 if(globalThis[slot])throw new CaptureApplicationError('ISOLATED_RUNTIME_ALREADY_INSTALLED',503);
 globalThis[slot]={...config,canonicalRequestOrigin:canonical,codec:createCaptureCodec(config.encryptionKey),rate:new Map()};
}
export function isolatedRuntime(){return globalThis[slot]??null;}
export function readIsolatedCaptureConfig(){return {configured:Boolean(isolatedRuntime())};}
export async function runIsolatedCapture(input){
 const r=isolatedRuntime();if(!r)throw new CaptureApplicationError('ISOLATED_RUNTIME_NOT_CONFIGURED',503);
 if(JSON.stringify(input.session)!==JSON.stringify(r.binding))throw new CaptureApplicationError('SESSION_BINDING_MISMATCH');
 // A request gets a store for its authenticated binding; no global bound store.
 const store=createRedisCaptureStore({binding:input.session,command:r.command,codec:r.codec,namespace:r.namespace,ttlSeconds:300});
 return createCaptureApplication({store,respond:r.respond,mode:'SIMULATED_ONLY'})(input);
}
