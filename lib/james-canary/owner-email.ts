import { timingSafeEqual } from 'node:crypto';
import { brief, readiness, sha } from './state.ts';
import type { Session } from './state.ts';
import { readAmyAgentMailProviderConfig, sendAmyEmailWithAgentMail } from '../email/amy-email-provider.ts';

export const OWNER_RECIPIENT='aifusionlabs@gmail.com';
export type OwnerGrant={id:string;expiresAt:number;recipient:typeof OWNER_RECIPIENT;maxSends:1};
/** Exact authorization for the owner's 2026-09-28 single test. Only its digest
 * is deployed; the random capability stays with the operator. No provider-key
 * reuse, public issuance endpoint, renewable allowance, or query-string gate. */
export const OWNER_POLICY:OwnerGrant&{tokenHash:string}={id:'6e79476f-19f3-4b35-aeb3-050cc980bbfb',expiresAt:1790614313835,recipient:OWNER_RECIPIENT,maxSends:1,tokenHash:'87d56916644af2fdb7d15f5e01aeaf2784fccdf09e52871e4c104d165c8f0e1d'};
export function verifyOwnerGrant(token:unknown,now=Date.now(),policy=OWNER_POLICY):OwnerGrant{
    if(typeof token!=='string'||!/^[\w-]{43}$/.test(token)||!timingSafeEqual(Buffer.from(sha(token)),Buffer.from(policy.tokenHash)))throw new Error('Owner test authorization invalid');
    if(policy.recipient!==OWNER_RECIPIENT||policy.maxSends!==1||policy.expiresAt<=now)throw new Error('Owner test authorization expired or outside scope');
    return {id:policy.id,expiresAt:policy.expiresAt,recipient:OWNER_RECIPIENT,maxSends:1};
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
