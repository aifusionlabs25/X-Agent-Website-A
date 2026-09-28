import { createHmac, timingSafeEqual } from 'node:crypto';
import { brief, readiness, sha } from './state.ts';
import type { Session } from './state.ts';
import { readAmyAgentMailProviderConfig, sendAmyEmailWithAgentMail } from '../email/amy-email-provider.ts';

export const OWNER_RECIPIENT='aifusionlabs@gmail.com';
const DOMAIN='james-hosted-owner-test-one-send-v1';
export type OwnerGrant={id:string;expiresAt:number;recipient:typeof OWNER_RECIPIENT;maxSends:1};
/** Server/operator-only capability. Never issued by the public browser or model.
 * Domain-separated use of the existing canary credential; no new public auth path. */
export function signOwnerGrant(grant:OwnerGrant,key:string){
    if(key.length<16)throw new Error('Owner authorization signing unavailable');
    const payload=Buffer.from(JSON.stringify(grant)).toString('base64url');
    return payload+'.'+createHmac('sha256',key).update(DOMAIN+':'+payload).digest('hex');
}
export function verifyOwnerGrant(token:unknown,key:string,now=Date.now()):OwnerGrant{
    if(typeof token!=='string'||token.length>1000||key.length<16)throw new Error('Owner test authorization invalid');
    const [payload,signature,...extra]=token.split('.');
    const expected=createHmac('sha256',key).update(DOMAIN+':'+payload).digest('hex');
    if(extra.length||!/^[a-f0-9]{64}$/.test(signature||'')||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new Error('Owner test authorization invalid');
    const g=JSON.parse(Buffer.from(payload,'base64url').toString());
    if(!/^[a-f0-9-]{36}$/.test(g.id)||g.recipient!==OWNER_RECIPIENT||g.maxSends!==1||!Number.isSafeInteger(g.expiresAt)||g.expiresAt<=now||g.expiresAt>now+2*60*60*1000)throw new Error('Owner test authorization expired or outside scope');
    return g;
}
export function emailConfiguration(){
    const c=readAmyAgentMailProviderConfig();
    if(!c.configured||c.apiBaseUrl!=='https://api.agentmail.to')throw new Error('Owner test email transport is not configured');
    return {sender:c.inboxAddress,recipient:OWNER_RECIPIENT};
}
export function prepareOwnerMessage(s:Session){
    if(s.state!=='CLOSED'||!s.providerRelease||s.intake.handoff!=='PREPARED'||!readiness(s.intake).ready)throw new Error('Verified closed and prepared snapshot required');
    const text=['OWNER TEST ONLY — NOT SENT TO KNOWLES',`Session: ${s.id}`,`Snapshot: ${s.stateHash}`,
        'Visitor-reported information. No legal advice, representation, firm review or callback is confirmed.',
        ...brief(s.intake).filter(section=>section.title!=='HANDOFF STATUS').map(section=>section.title+'\n'+section.items.map(item=>(item.label?item.label+': ':'')+item.text).join('\n'))].join('\n\n');
    const html='<pre>'+text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))+'</pre>';
    return {to:OWNER_RECIPIENT,subject:`James owner-test intake — ${s.id.slice(-8)}`,text,html};
}
/** Reservation is durably saved BEFORE the single transport attempt. A crash,
 * timeout, unknown receipt, or reload cannot cause another send. */
export async function sendPreparedOwnerTest(s:Session,deps:{save:(previous:Session,next:Session)=>Promise<void>;stamp:(previous:Session,next:Session,event:unknown)=>Session;send?:typeof sendAmyEmailWithAgentMail}){
    if(!s.ownerTest||s.email)return s;
    if(s.ownerTest.expiresAt<=Date.now())throw new Error('Owner test authorization expired; no send attempted');
    const message=prepareOwnerMessage(s);emailConfiguration();
    const reserved=deps.stamp(s,{...structuredClone(s),email:{status:'RESERVED',snapshotHash:s.stateHash,subject:message.subject,bodyHash:sha(message.text),reservedAt:new Date().toISOString()}},{action:'owner-email-reservation',grantId:s.ownerTest.grantId,recipient:OWNER_RECIPIENT});
    await deps.save(s,reserved);
    const next=structuredClone(reserved);
    try{
        const result=await (deps.send||sendAmyEmailWithAgentMail)(message,{idempotencyKey:'james-owner-'+s.ownerTest.grantId});
        if(!result.sent||!result.messageId)throw new Error('Missing provider receipt');
        next.email!.status='SENT';next.email!.messageId=result.messageId;
    }catch{
        next.email!.status='FAILED_OR_UNKNOWN';next.email!.error='No verified send receipt; no retry authorized.';
    }
    const result=deps.stamp(reserved,next,{action:'owner-email-result',status:next.email!.status,messageId:next.email!.messageId||null});
    await deps.save(reserved,result);return result;
}
