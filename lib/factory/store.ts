import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import type { Handoff } from './handoff.ts';
const ttl=7*24*60*60;
function key(secret:string) { if(secret.length<32) throw new Error('Branch session secret unavailable'); return createHash('sha256').update('factory-preview-v1\0'+secret).digest(); }
export function seal(value:unknown, secret:string) { const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',key(secret),iv); return Buffer.concat([iv,c.update(JSON.stringify(value)),c.final(),c.getAuthTag()]).toString('base64url'); }
export function unseal(raw:string,secret:string) { const b=Buffer.from(raw,'base64url'),d=createDecipheriv('aes-256-gcm',key(secret),b.subarray(0,12)); d.setAuthTag(b.subarray(-16)); return JSON.parse(Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString()); }
function prefix(id:string) { if(!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid browser identity'); return 'xagent:factory:preview:v1:'+id; }
export async function command(args:(string|number)[], env:NodeJS.ProcessEnv=process.env, fetcher:typeof fetch=fetch) {
    const url=env.KV_REST_API_URL||'', token=env.KV_REST_API_TOKEN||'';
    if (!/^https:\/\/[a-z0-9-]+\.(?:upstash\.io|kv\.vercel-storage\.com)$/.test(url) || !token) throw new Error('Existing project Redis REST configuration unavailable');
    const r=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args),cache:'no-store',signal:AbortSignal.timeout(8000),redirect:'error'});
    if(!r.ok) throw new Error('Factory store HTTP '+r.status);
    const t=await r.text(); if(t.length>2*1024*1024) throw new Error('Store response exceeded bound');
    const out=JSON.parse(t); if(out.error) throw new Error('Factory store rejected operation'); return out.result;
}
export async function load(id:string) { const raw=await command(['GET',prefix(id)]); return {raw:raw as string|null,state:raw?unseal(raw,process.env.FACTORY_DELIVERY_SECRET||'') as Handoff:null}; }
export function requireClosedSession(state:Handoff|null) {
    if(!state || state.status!=='CLOSED' || !state.provider_release_verified || !state.provider_transcript_verified)
        throw new Error('Verify provider closure and complete transcript before starting a fresh conversation');
}
export async function history(id:string) {
    const values=await command(['LRANGE',prefix(id)+':history',0,19]);
    if(!Array.isArray(values)) throw new Error('Saved session history unavailable');
    return values.map((raw:string)=>unseal(raw,process.env.FACTORY_DELIVERY_SECRET||'') as Handoff);
}
export async function archiveClosed(id:string,previous:string,state:Handoff) {
    requireClosedSession(state);
    // One atomic transition: preserve the exact encrypted record before clearing
    // the current pointer. Late writes and concurrent resets cannot overwrite it.
    const empty=seal(null,process.env.FACTORY_DELIVERY_SECRET||'');
    const script="if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; if redis.call('LLEN',KEYS[2])>=20 then return -1 end; redis.call('LPUSH',KEYS[2],ARGV[1]); redis.call('EXPIRE',KEYS[2],ARGV[3]); redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1";
    const result=await command(['EVAL',script,2,prefix(id),prefix(id)+':history',previous,empty,ttl]);
    if(result===-1) throw new Error('Saved-session limit reached; export history before requesting more test capacity');
    if(result!==1) throw new Error('Session changed; reload before starting another conversation');
}
export async function commit(id:string, previous:string|null,state:Handoff) {
    const raw=seal(state,process.env.FACTORY_DELIVERY_SECRET||'');
    const script="local old=redis.call('GET',KEYS[1]); if (ARGV[1]=='__NEW__' and not old) or old==ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1 end; return 0";
    if(await command(['EVAL',script,1,prefix(id),previous??'__NEW__',raw,ttl])!==1) throw new Error('Concurrent change; reload saved state (no provider retry)');
}
export async function preflight(id:string) {
    const k=prefix(id)+':preflight', value=seal({disposable:true,nonce:randomBytes(8).toString('hex')},process.env.FACTORY_DELIVERY_SECRET||'');
    const script="if redis.call('SET',KEYS[1],ARGV[1],'NX','EX',60) then local v=redis.call('GET',KEYS[1]); local t=redis.call('TTL',KEYS[1]); redis.call('DEL',KEYS[1]); return {v,t} end; return {}";
    const out=await command(['EVAL',script,1,k,value]);
    if(out?.[0]!==value || Number(out[1])<=0 || !unseal(out[0],process.env.FACTORY_DELIVERY_SECRET||'').disposable) throw new Error('Hosted atomic encrypted storage preflight failed');
    return {encrypted_readback:true,atomic_write:true,expiry_seconds:out[1],disposable_record_removed:true};
}
