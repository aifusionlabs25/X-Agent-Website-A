// Candidate website only. Finalized text is evidence of intent, not a model tool.
export const CLOSE_FALLBACK_MS = 15000;
export const CLOSE_QUIET_MS = 2500;
export function runtimeDepartureToArm(turn:{id:string;role:string},closing?:{runtimeOwned?:boolean;departureTurnId?:string}):string|null {
    return turn.role==='user'&&closing?.runtimeOwned===true&&closing.departureTurnId===turn.id?turn.id:null;
}
export function explicitRuntimeDeparture(text: string): boolean {
    // Whole utterance grammar: never extract a goodbye from quoted, conditional,
    // negated, or mixed new-information speech. Bare thanks is not departure.
    const value=text.trim().replace(/[’]/g,"'").replace(/[,.!]+/g,' ').replace(/\s+/g,' ').trim();
 if(/^you too (?:bye(?: bye)?|goodbye)(?: james)?$/i.test(value))return true;
    // A completed-answer acknowledgment followed by goodbye is departure,
    // but this does not admit arbitrary case facts before a terminal goodbye.
    if(/^(?:thanks|thank you) that (?:answers|answered) my question (?:bye|goodbye)(?: james)?$/i.test(value))return true;
    return /^(?:(?:okay|ok|all right) )?(?:(?:thanks|thank you)(?: for your help)?(?: james)? )?(?:bye(?: bye)?|goodbye|end (?:the |this |our )?call|please (?:end (?:the |this |our )?call|hang up)|hang up|i (?:have|need) to go|have a (?:good|great|nice) (?:day|evening|night))(?: james)?(?: (?:thanks|thank you))?$/i.test(value);
}
export type RuntimeCloseAttempt = { departureTurnId: string; startedAt: number; farewellTurnId?: string; finalizedAt?: number };
export function freshRuntimeCloseAttempt(departureTurnId:string,startedAt:number,farewellTurnId?:string):RuntimeCloseAttempt {
    return {departureTurnId,startedAt,...(farewellTurnId?{farewellTurnId}:{})};
}
export function runtimeCloseSignal(attempt:RuntimeCloseAttempt,input:{now:number;visitorSpeaking:boolean;personaSpeaking:boolean;audioRunning:boolean;lastSoundAt:number;quietSince:number|null}):'AUDIO_QUIET'|'BOUNDED_FALLBACK'|null {
    if(input.visitorSpeaking)return null;
    // This is measured stream silence, NOT an authoritative playback-end event.
    if(attempt.farewellTurnId&&attempt.finalizedAt!==undefined&&input.audioRunning&&!input.personaSpeaking
        &&input.lastSoundAt>=attempt.startedAt&&input.quietSince!==null
        &&input.now-input.quietSince>=CLOSE_QUIET_MS&&input.now-attempt.finalizedAt>=CLOSE_QUIET_MS)return 'AUDIO_QUIET';
    // One absolute deadline, never extended by model output or idle check-ins.
    return input.now-attempt.startedAt>=CLOSE_FALLBACK_MS?'BOUNDED_FALLBACK':null;
}
