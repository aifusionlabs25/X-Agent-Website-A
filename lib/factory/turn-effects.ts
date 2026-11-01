import type { Handoff,Turn } from './handoff';
import { visitorReferenceContext,handoffRequestContext } from './handoff-context.ts';

/** Apply only a successfully committed turn. Lifecycle cleanup must not depend
 * on optional model context delivery, model tool use, or farewell wording. */
export function committedTurnEffects(state:Handoff,turn:Turn,effects:{
    armClose:()=>void;finalReply:()=>void;context:(text:string)=>void;contextFailure:(error:unknown)=>void;
}) {
    const index=state.turns.findIndex(t=>t.id===turn.id&&t.role===turn.role&&t.content===turn.content);
    if(index<0)throw new Error('Committed exact turn required before host effects');
    if(state.status==='CLOSING_PENDING') {
        effects.armClose();
        const exitIndex=state.closing_after_turn_id?state.turns.findIndex(t=>t.id===state.closing_after_turn_id):-1;
        // A delayed pre-exit reply cannot satisfy farewell completion.
        if(turn.role==='persona'&&exitIndex>=0&&index>exitIndex)effects.finalReply();
    }
    if(turn.role!=='user')return;
    const context=(text:string)=>{try{effects.context(text);}catch(error){effects.contextFailure(error);}};
    context(visitorReferenceContext(turn));
    const request=handoffRequestContext(state,turn);
    if(request)context(request);
    if(state.status==='CLOSING_PENDING')context('Factory committed visitor exit: end intent is recorded. This is a state receipt, not a request for another spoken reply. The host will close with the supported SDK; no handoff, approval or delivery success is implied.');
}
