import type { Turn } from './handoff';

export type ExitReplyObservation={correlation_id:string|null;reply_ids:string[];
    reply_state:'TEXT_ALREADY_OBSERVED'|'NOT_OBSERVED'|'UNKNOWN';receipt_already_issued:boolean};

/** Generation observation, not proof of audio playback. The installed SDK
 * exposes userActionCorrelationId and persona::<correlation> message IDs.
 * Never guess the latest reply when the correlation is missing. */
export function exitReplyObserver() {
    const observed=new Set<string>(),issued=new Map<string,ExitReplyObservation>();
    return {
        observe(turn:Turn) {
            if(turn.role!=='persona'||!turn.content.trim()||observed.size>=200)return;
            observed.add(turn.id);
        },
        receipt(correlationId?:string):ExitReplyObservation {
            if(!correlationId||!/^[\w-]{1,200}$/.test(correlationId))
                return {correlation_id:null,reply_ids:[],reply_state:'UNKNOWN',receipt_already_issued:false};
            const prior=issued.get(correlationId);
            if(prior)return {...prior,reply_ids:[...prior.reply_ids],receipt_already_issued:true};
            const id='persona::'+correlationId,seen=observed.has(id);
            const result:ExitReplyObservation={correlation_id:correlationId,reply_ids:seen?[id]:[],
                reply_state:seen?'TEXT_ALREADY_OBSERVED':'NOT_OBSERVED',receipt_already_issued:false};
            issued.set(correlationId,result);return {...result,reply_ids:[...result.reply_ids]};
        },
    };
}

/** One outcome channel. Never replay the first farewell invitation for a second
 * close-tool call. No audio truncation, phrase-matching closure or success claim. */
export function exitReceipt(observation?:ExitReplyObservation) {
    const mayFinish=observation?.reply_state==='NOT_OBSERVED'&&!observation.receipt_already_issued;
    return {status:'CLOSING_PENDING',reply_observation:observation??null,
        instruction:'Visitor exit is recorded. '+(mayFinish
            ? 'If you have not already begun closing speech, say one short farewell only. If closing speech is already underway, finish it once without repeating it. Do not announce that you will close the session and then say goodbye separately. '
            : 'Do not start another farewell or substantive reply. Closing speech may already be underway; finish the existing reply without another acknowledgment or goodbye. ')
        +'The host handles SDK closure after the final reply. Nothing has been sent or submitted.'};
}
