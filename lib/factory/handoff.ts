/** Generic evidence boundary. Streamed speech is NOT certified by this verifier. */
import { createHash } from 'node:crypto';
export type Field = {id:string; label:string};
export type Turn = {id:string; role:'user'|'persona'; content:string};
export type Proposal = {field_id:string; visitor_message_id:string; evidence:string; value:string};
export type Decision = {proposal_id:string; decision:'ACCEPT'|'REJECT'; at:string};
export type Handoff = {
    id:string; version:number; package_sha256:string; persona_id:string; launch_label:string;
    status:'RESERVED'|'TOKEN_READY'|'ACTIVE'|'CLOSING_PENDING'|'CLOSED'; provider_session_id:string|null;
    turns:Turn[]; proposals:Array<Proposal & {id:string}>; decisions:Decision[];
    receipts:Array<{at:string; kind:string; sha256:string}>; processed:string[];
    provider_release_verified:boolean; provider_transcript_verified:boolean;
    provider_evidence?:unknown;
    tool_events?:Array<{tool_call_id:string;tool_name:string;phase:string;result:unknown;exposure:string}>;
    evidence_reviewed:boolean; approved:boolean; submission_status:'UNSUBMITTED'; external_actions:never[];
};
export const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function assertProposal(p:Proposal, turns:Turn[], fields:Field[]) {
    if (!p || Object.keys(p).sort().join() !== ['evidence','field_id','value','visitor_message_id'].sort().join()
        || !fields.some(f=>f.id===p.field_id) || typeof p.evidence!=='string' || !p.evidence.trim()
        || p.evidence.length>4000 || typeof p.value!=='string' || p.value!==p.evidence
        || !turns.some(t=>t.role==='user' && t.id===p.visitor_message_id && t.content.includes(p.evidence))) {
        throw new Error('Mapping requires a known field and an exact persisted visitor span; value must remain verbatim');
    }
}
export function appendTurn(state:Handoff, turn:Turn) {
    if (!['ACTIVE','CLOSING_PENDING'].includes(state.status)) throw new Error('Conversation is not accepting turns');
    if (state.status==='CLOSING_PENDING' && turn.role==='user') throw new Error('Visitor exit has begun');
    if (!turn || !['user','persona'].includes(turn.role) || typeof turn.id!=='string' || !/^[\w:.-]{1,200}$/.test(turn.id)
        || typeof turn.content!=='string' || !turn.content.trim() || turn.content.length>8000 || state.turns.length>=200) throw new Error('Invalid finalized turn');
    const previous = state.turns.find(t=>t.id===turn.id);
    if (previous) { if (JSON.stringify(previous)!==JSON.stringify(turn)) throw new Error('Finalized evidence is immutable'); return; }
    state.turns.push({...turn});
    state.approved=false; state.evidence_reviewed=false; state.provider_transcript_verified=false;
    if (turn.role==='user' && clearExit(turn.content)) state.status='CLOSING_PENDING';
}
export function clearExit(text:string) {
    // Detection only. Raw evidence is never normalized or replaced.
    return /^(?:(?:thanks|thank you)(?:[, ]+(?:for your help|[a-z]+))?[.! ,]*)?(?:(?:goodbye|bye)(?:[, ]+[a-z]+)?|that['’]s all(?:[, ]+thank you)?|i['’]m all set(?:[, ]+thanks)?|we['’]re done)[.! ,]*$/i.test(text.trim());
}
export function propose(state:Handoff, proposals:Proposal[], fields:Field[]) {
    if (!['ACTIVE','CLOSED'].includes(state.status)) throw new Error('Handoff proposals are not available during closure');
    if (!Array.isArray(proposals) || proposals.length>24) throw new Error('Bounded proposals required');
    for (const p of proposals) assertProposal(p,state.turns,fields);
    for (const p of proposals) { const id=digest(p); if (!state.proposals.some(v=>v.id===id)) state.proposals.push({...p,id}); }
    state.approved=false;
}
export function decide(state:Handoff, id:string, decision:'ACCEPT'|'REJECT', fields:Field[]) {
    const p=state.proposals.find(x=>x.id===id);
    if (!p || !['ACCEPT','REJECT'].includes(decision)) throw new Error('Unknown proposal/decision');
    if (!state.provider_transcript_verified) throw new Error('Provider transcript must be reconciled before owner mapping');
    if (decision==='ACCEPT') { const {id:_,...raw}=p; void _; assertProposal(raw,state.turns,fields); }
    if (state.decisions.some(x=>x.proposal_id===id)) throw new Error('Owner decision already recorded');
    state.decisions.push({proposal_id:id,decision,at:new Date().toISOString()}); state.approved=false;
}
export function approve(state:Handoff) {
    if (state.status!=='CLOSED' || !state.provider_release_verified || !state.provider_transcript_verified
        || !state.evidence_reviewed || !state.turns.some(t=>t.role==='user')
        || state.proposals.some(p=>!state.decisions.some(d=>d.proposal_id===p.id))) throw new Error('Close, reconcile and review all original evidence/proposals before approval');
    state.approved=true;
}
