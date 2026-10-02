import type { Session, Turn } from './state.ts';

export type WebsiteClosing = {
    policy: 'JAMES-CLOSE-001';
    recap?: { hash: string; turnId: string };
    complete?: { hash: string; turnId: string };
    departureTurnId?: string;
    farewellTurnId?: string;
    reason?: 'VISITOR_DEPARTURE' | 'COMPLETED_INTAKE';
};
type Evidence = { hash: string; ready: boolean; contactAndBriefReady: boolean; briefConfirmed: boolean; values: string[] };
const normalize=(s:string)=>s.toLowerCase().replace(/[’]/g,"'").replace(/[^a-z0-9@]+/g,' ').trim();
const affirmative=(s:string)=>/^(?:(?:yes|yeah|yep|correct|right|absolutely)[,!.\s]*)?(?:(?:that(?:['’]s| is)|it(?:['’]s| is)|it looks|everything(?:['’]s| is)|the (?:recap|summary|brief) is) (?:all )?(?:right|correct|accurate)[,!.\s]*)?(?:thank you|thanks)?[!.\s]*$/i.test(s.trim())&&Boolean(s.trim())&&!/^(?:thanks|thank you)[!.\s]*$/i.test(s.trim());
const nothingElse=(s:string)=>/^(?:(?:no|nope)[,!.\s]*)?(?:(?:that(?:['’]s| is)|that covers|you have) (?:all|everything)|nothing (?:else|more)|no (?:other|more) (?:details|information|questions))(?:[,!.\s]+(?:to add|thanks|thank you))?[,!.\s]*$/i.test(s.trim())
    || /^(?:no|nope)[!.\s]*$/i.test(s.trim());
const completenessQuestion=(s:string)=>/\b(?:anything else|anything more|anything (?:you|we) (?:haven['’]t|have not)|anything (?:missing|incorrect)|anything (?:else )?(?:to add|to correct))\b/i.test(s)&&/[?]/.test(s);
const recapQuestion=(s:string)=>/\b(?:is|does|did|have)\b.{0,100}\b(?:correct|accurate|right|capture|miss|missing)\b/i.test(s)&&/[?]/.test(s);
export function isFinalFarewell(text:string){
    // A quoted example, conditional farewell, permission question or additional
    // discovery must never become a transport-close command.
    return !/[?"“”]/.test(text)&&! /\b(?:if|unless|when you|say goodbye|said goodbye|will call|will review)\b/i.test(text)
        && /(?:^|[.!]\s+)(?:take care(?:[, ]+[^.!?]{1,45})?|goodbye(?:[, ]+[^.!?]{1,45})?|bye|have a (?:good|great|nice) (?:day|evening|night))[.!\s]*$/i.test(text.trim());
}
export function cancelWebsiteClose(session:Session){
    if(!session.websiteClosing)return;
    delete session.websiteClosing.departureTurnId;delete session.websiteClosing.farewellTurnId;
    delete session.websiteClosing.reason;
    if(session.state==='CLOSING_PENDING'||session.state==='CLOSING')session.state='ACTIVE';
}
export function trackWebsiteClose(session:Session,previous:Session,turn:Turn,evidence:Evidence,directDeparture:boolean){
    const flow=session.websiteClosing;if(!flow)return;
    if(flow.recap?.hash!==evidence.hash)delete flow.recap;
    if(flow.complete?.hash!==evidence.hash)delete flow.complete;
    const prior=previous.turns.at(-1);
    if(turn.role==='user'){
        const alreadyComplete=flow.complete;
        cancelWebsiteClose(session);
        delete flow.complete;
        // The legacy detector also accepts "that's all, thanks". That phrase
        // can mean completeness, not departure, so this policy narrows it.
        const goodbye=directDeparture&&/\b(?:goodbye|bye|have a (?:good|great|nice) (?:day|evening|night))\b/i.test(turn.content);
        if(goodbye||/^(?:please )?(?:end (?:the|this|our) call|hang up|i (?:need|have) to go)[.!\s]*$/i.test(turn.content.trim())){flow.departureTurnId=turn.id;return;}
        if(prior?.role!=='persona')return;
        // These record information-review/completeness evidence, NEVER consent
        // to disconnect or to email. No confirmed boolean is sent to Anam.
        const asksForCorrections=/\banything (?:missing|incorrect)\b/i.test(prior.content);
        const noCorrections=asksForCorrections
            &&/^no[,!.\s]+(?:it looks|it(?:['’]s| is)|everything(?:['’]s| is)) (?:right|correct|accurate)[.!\s]*$/i.test(turn.content.trim());
        const agreed=asksForCorrections?noCorrections:affirmative(turn.content);
        const priorText=normalize(prior.content);
        const supportedValues=evidence.values.filter(value=>normalize(value).length>=4&&priorText.includes(normalize(value)));
        const currentBriefReview=/\b(?:legal pad|intake brief)\b/i.test(prior.content)&&evidence.values.length>0;
        if(agreed&&recapQuestion(prior.content)&&(supportedValues.length>=2||currentBriefReview))
            flow.recap={hash:evidence.hash,turnId:turn.id};
        if(agreed&&flow.recap&&alreadyComplete?.hash===evidence.hash)flow.complete=alreadyComplete;
        const nothing=nothingElse(turn.content);
        if(nothing&&completenessQuestion(prior.content))flow.complete={hash:evidence.hash,turnId:turn.id};
        // A clear "that's everything" can accompany recap acceptance without
        // requiring the same closing question to be asked a second time.
        if(/\b(?:that(?:['’]s| is) (?:all|everything)|nothing else)\b/i.test(turn.content)
            &&! /\b(?:but|wait|not yet|actually|except)\b|[?]/i.test(turn.content)
            &&(flow.recap||evidence.briefConfirmed))flow.complete={hash:evidence.hash,turnId:turn.id};
        return;
    }
    delete flow.farewellTurnId;delete flow.reason;
    if(session.state==='CLOSING_PENDING')session.state='ACTIVE';
    if(!isFinalFarewell(turn.content))return;
    const normal=evidence.ready&&evidence.contactAndBriefReady
        &&(evidence.briefConfirmed||flow.recap?.hash===evidence.hash)&&flow.complete?.hash===evidence.hash;
    if(!flow.departureTurnId&&!normal)return;
    flow.farewellTurnId=turn.id;flow.reason=flow.departureTurnId?'VISITOR_DEPARTURE':'COMPLETED_INTAKE';
    session.state='CLOSING_PENDING';
}
export function enqueueClosingMutation<T>(queue:{current:Promise<unknown>},action:()=>Promise<T>){
    const preceding=queue.current;
    const task=preceding.then(action);
    // Recover only this close-request failure, not a prior failed turn save.
    // The caller still receives/reports the original rejection.
    queue.current=preceding.then(()=>task.then(()=>undefined,()=>undefined));
    return task;
}
/** SDK text completion is not playback completion. Require observed output for
 * this turn, then a measured quiet window, with no intervening visitor speech. */
export function playbackAllowsClose(input:{now:number;finalizedAt:number;turnStartedAt:number;lastSoundAt:number;quietSince:number|null;running:boolean;personaSpeaking:boolean;visitorSpeaking:boolean;epoch:number;expectedEpoch:number}){
    return input.running&&!input.personaSpeaking&&!input.visitorSpeaking&&input.epoch===input.expectedEpoch
        &&input.lastSoundAt>=input.turnStartedAt&&input.lastSoundAt>0&&input.quietSince!==null
        &&input.now-input.quietSince>=2000&&input.now-input.finalizedAt>=2000;
}
