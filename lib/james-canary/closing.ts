import type { Session, Turn } from './state.ts';
import { explicitRuntimeDeparture } from './runtime-close.ts';

export type WebsiteClosing = {
    policy: 'JAMES-CLOSE-001';
    runtimeOwned?: true;
    recap?: { hash: string; turnId: string };
    complete?: { hash: string; turnId: string };
    departureTurnId?: string;
    farewellTurnId?: string;
    reason?: 'VISITOR_DEPARTURE' | 'COMPLETED_INTAKE';
    departureKind?: 'EXPLICIT_GOODBYE' | 'CONTEXTUAL_ACK';
    closeOrigin?: 'EXPLICIT_GOODBYE' | 'CONTEXTUAL_ACK' | 'UNCLASSIFIED_AUTOMATIC' | 'MANUAL_BUTTON' | 'PROVIDER_ENDED_RECOVERY';
    closeSignal?: 'AUDIO_QUIET' | 'BOUNDED_FALLBACK';
};
type Evidence = { hash: string; ready: boolean; contactAndBriefReady: boolean; briefConfirmed: boolean; values: string[] };
const normalize=(s:string)=>s.toLowerCase().replace(/[’]/g,"'").replace(/[^a-z0-9@]+/g,' ').trim();
const affirmative=(s:string)=>/^(?:(?:yes|yeah|yep|correct|right|absolutely)[,!.\s]*)?(?:(?:that(?:['’]s| is)|it(?:['’]s| is)|it looks|everything(?:['’]s| is)|the (?:recap|summary|brief) is) (?:all )?(?:right|correct|accurate)[,!.\s]*)?(?:thank you|thanks)?[!.\s]*$/i.test(s.trim())&&Boolean(s.trim())&&!/^(?:thanks|thank you)[!.\s]*$/i.test(s.trim());
const nothingElse=(s:string)=>/^(?:(?:no|nope)[,!.\s]*)?(?:(?:that(?:['’]s| is)|that covers|you have) (?:all|everything)|nothing (?:else|more)|no (?:other|more) (?:details|information|questions))(?:[,!.\s]+(?:to add|thanks|thank you))?[,!.\s]*$/i.test(s.trim())
    || /^(?:no|nope)[!.\s]*$/i.test(s.trim());
const completenessQuestion=(s:string)=>/\b(?:anything else|anything more|anything (?:you|we) (?:haven['’]t|have not)|anything (?:missing|incorrect)|anything (?:else )?(?:to add|to correct))\b/i.test(s)&&/[?]/.test(s);
const recapQuestion=(s:string)=>/\b(?:is|does|did|have)\b.{0,100}\b(?:correct|accurate|right|capture|miss|missing)\b/i.test(s)&&/[?]/.test(s);
const courtesy=(s:string)=>/^(?:thanks|thank you|you too)(?:,\s*james)?[!.\s]*$/i.test(s.trim());
const contextualWrapUp=(s:string)=>/^(?:(?:no|nope)[,!.\s]+)?(?:that(?:['’]s| is) (?:all|everything)|nothing (?:else|more))(?:[,!.\s]+(?:thanks|thank you)(?: for your help)?)?[!.\s]*$/i.test(s.trim());
const closingCourtesy=(s:string)=>/^(?:thanks|thank you)(?: for your help)?(?:,?\s+james)?[!.\s]*$/i.test(s.trim());
export function isFinalFarewell(text:string){
    // A quoted example, conditional farewell, permission question or additional
    // discovery must never become a transport-close command.
    if(/[?"“”]/.test(text)||/\b(?:say goodbye|said goodbye|will call|will review)\b/i.test(text))return false;
    const sentences=text.trim().split(/(?<=[.!])\s+/),terminal=sentences.at(-1)||'';
    const conditional=/\b(?:if|unless|when you)\b/i;
    // An independent earlier instruction may be conditional without making the
    // farewell conditional. Keep a dangling "If you are finished. Goodbye."
    // conservative rather than treating punctuation as permission to close.
    if(conditional.test(terminal)||sentences.slice(0,-1).some(sentence=>conditional.test(sentence)&&!/[,:;]/.test(sentence)))return false;
    return /^(?:take care(?:[, ]+[^.!?]{1,45})?|goodbye(?:[, ]+[^.!?]{1,45})?|bye|have a (?:good|great|nice|safe) (?:day|evening|night)(?:,\s*[\p{L}][\p{L}'’\-]*(?:\s+[\p{L}][\p{L}'’\-]*){0,3})?)[.!\s]*$/iu.test(terminal);
}
// Runtime-owned candidate recognition stays separate from the legacy close policy.
const candidateCourtesy=(s:string)=>courtesy(s)||/^cheers[!.\s]*$/i.test(s.trim());
const candidateFinalFarewell=(text:string)=>{
    if(/\b(?:but|however|need|please)\b/i.test(text))return false;
    if(isFinalFarewell(text))return true;
    if(/[?"“”]/.test(text)||/\b(?:if|unless|when you|say goodbye|said goodbye)\b/i.test(text))return false;
    const terminal=text.trim().split(/(?<=[.!])\s+/).at(-1)||'';
    return /^take care,?\s+and i hope your [\p{L}\s]{1,35} (?:starts? feeling|feels?|gets?) better(?: soon)?[.!\s]*$/iu.test(terminal);
};
const candidateContextualWrapUp=(s:string)=>contextualWrapUp(s)||contextualWrapUp(s.trim().replace(/^(?:yeah|yes|yep)[,!.\s]+i(?:['’]m| am) here[.!]\s*/i,''));
const idleCheckIn=(s:string)=>/(?:^|[.!]\s+)are you still there\?[.\s]*$/i.test(s.trim());
export function cancelWebsiteClose(session:Session){
    if(!session.websiteClosing)return;
    delete session.websiteClosing.departureTurnId;delete session.websiteClosing.farewellTurnId;
    delete session.websiteClosing.reason;
    delete session.websiteClosing.departureKind;
    delete session.websiteClosing.closeOrigin;delete session.websiteClosing.closeSignal;
    if(session.state==='CLOSING_PENDING'||session.state==='CLOSING')session.state='ACTIVE';
}
export function trackWebsiteClose(session:Session,previous:Session,turn:Turn,evidence:Evidence,directDeparture:boolean){
    const flow=session.websiteClosing;if(!flow)return;
    if(flow.runtimeOwned){
        if(turn.role==='user'){
            const prior=previous.turns.at(-1);
            const beforePrior=previous.turns.at(-2);
            const acknowledgedFarewell=prior?.role==='persona'&&candidateFinalFarewell(prior.content)&&candidateCourtesy(turn.content);
            const completedAfterClosingQuestion=prior?.role==='persona'&&completenessQuestion(prior.content)&&contextualWrapUp(turn.content);
            const completedAfterIdleCheckIn=prior?.role==='persona'&&idleCheckIn(prior.content)
                &&beforePrior?.role==='persona'&&candidateFinalFarewell(beforePrior.content)
                &&candidateContextualWrapUp(turn.content);
            // Interrupted persona speech is not saved as a turn. Adjacent finalized
            // visitor fragments can still form one clear wrap-up, but a question,
            // correction, case fact or intervening James turn cannot be merged.
            const completedAcrossVisitorFragments=prior?.role==='user'&&contextualWrapUp(prior.content)&&closingCourtesy(turn.content);
            if(explicitRuntimeDeparture(turn.content)||acknowledgedFarewell||completedAfterClosingQuestion||completedAfterIdleCheckIn||completedAcrossVisitorFragments){
                flow.departureTurnId??=turn.id;flow.reason='VISITOR_DEPARTURE';session.state='CLOSING_PENDING';
                flow.departureKind??=acknowledgedFarewell||completedAfterClosingQuestion||completedAfterIdleCheckIn||completedAcrossVisitorFragments?'CONTEXTUAL_ACK':'EXPLICIT_GOODBYE';
                if(acknowledgedFarewell)flow.farewellTurnId??=prior.id;
            }else cancelWebsiteClose(session);
        }else if(flow.departureTurnId&&candidateFinalFarewell(turn.content))flow.farewellTurnId??=turn.id;
        return;
    }
    if(flow.recap?.hash!==evidence.hash)delete flow.recap;
    if(flow.complete?.hash!==evidence.hash)delete flow.complete;
    const prior=previous.turns.at(-1);
    if(turn.role==='user'){
        const alreadyComplete=flow.complete;
        cancelWebsiteClose(session);
        delete flow.complete;
        // STT may finalize "That's everything" and "Thanks" separately. A
        // courtesy can retain existing, hash-bound completeness; it cannot
        // create it, retain a farewell candidate, or bypass speech cancellation.
        if(alreadyComplete?.hash===evidence.hash&&courtesy(turn.content)){
            flow.complete=alreadyComplete;
            return;
        }
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
