import {timingSafeEqual} from 'node:crypto';
import {sha} from './state.ts';
import type {Session} from './state.ts';

export const COMPARISON_ID='james-planner-20260929';
export const COMMON_PROMPT_HASH='6c0f139216a8bce8477b1df81e145e37eb028c050b3ccc9d67ce7e12ac8ce528';
export const EXPIRES_AT=Date.parse('2026-09-30T23:59:00Z');
export type Arm='on'|'off';
export type ComparisonBinding={experiment:typeof COMPARISON_ID;arm:Arm;promptHash:string};
export type ComparedSession=Session&{comparison?:ComparisonBinding};
const hashes={on:'6f9497ed4fd02244f501474a894e6a35ef53e0ddd6fce9d83c06f80f8bcfc6a4',off:'f5e403c1120e57200c9201c897c6a72484960045ca593f955caea1b4d12a25be'};
export function comparisonEnabled(){return process.env.VERCEL_ENV==='preview'&&process.env.JAMES_PLANNER_COMPARISON===COMPARISON_ID;}
export function authorizeComparison(token:unknown,arm:unknown,now=Date.now()):Arm {
    if(arm!=='on'&&arm!=='off')throw Error('Select the authorized comparison arm');
    if(typeof token!=='string'||token.length!==43||!timingSafeEqual(Buffer.from(sha(token)),Buffer.from(hashes[arm])))throw Error('Comparison owner authorization required');
    if(now>=EXPIRES_AT)throw Error('Comparison window expired');
    return arm;
}
type PersonaReadback={tools?:{name?:string;awaitResult?:boolean;toolTimeoutSeconds?:number}[];brain?:{systemPrompt?:string};llmId?:string;voice?:{id?:string}};
export function checkComparisonPersona(p:PersonaReadback){
    const tool=p.tools?.find(t=>t.name==='james_handoff');
    if(sha(p.brain?.systemPrompt||'')!==COMMON_PROMPT_HASH||tool?.awaitResult!==true||tool?.toolTimeoutSeconds!==15||
      p.llmId!=='85906141-db1c-4927-b74d-3c82ebe2436e'||p.voice?.id!=='5ea79b27-25e5-52d9-bab8-944038935c40'||
      sha(JSON.stringify(p.tools))!=='de4b45951268296f9ee9df742ce85aab8707c44c426c567396b058c11dbcacb6')throw Error('Comparison persona binding changed; no session started');
}
/** ON is byte-equivalent to the baseline JSON. OFF removes speaker steering,
 * not accepted facts, uncertainty, readiness, permissions or action truth. */
export function comparisonResult<T extends {conversation_guidance:{contractor_contact:{instruction?:string};known_evidence_do_not_reask:unknown;completed_intents_do_not_reask:unknown};instruction:string}>(result:T,arm:Arm):T {
    if(arm==='on')return result;
    const copy=structuredClone(result),g=copy.conversation_guidance as Record<string,unknown>;
    for(const key of ['stage','completion_language_allowed','greeting_allowed','conversation_continuity','one_job_per_turn','email_open_instruction',
      'next_question_intent','next_question','max_clarifications_per_intent','resolved_answer_policy','hesitation_recovery','max_questions_per_reply',
      'repeat_question_after_tool','response_pattern'])delete g[key];
    delete copy.conversation_guidance.contractor_contact.instruction;
    g.known_evidence=g.known_evidence_do_not_reask;delete g.known_evidence_do_not_reask;
    g.resolved_intents=g.completed_intents_do_not_reask;delete g.completed_intents_do_not_reask;
    copy.instruction=copy.instruction.replace('Ask one matter-specific missing question at a time; unknown is valid and questions must not loop. ','');
    return copy;
}
