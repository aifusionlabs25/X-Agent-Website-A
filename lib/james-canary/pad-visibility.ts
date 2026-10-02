/** Browser-only presentation policy. No LLM/tool/prompt chooses the layout. */
export type PadVisibility = { open: boolean; revealed: boolean; manual: boolean };
export const initialPadVisibility = (): PadVisibility => ({open:false,revealed:false,manual:false});
export const BRIEF_REVIEW_INVITATION = 'Your intake brief is ready to review on the legal pad. Please check it and tell me what needs correcting, or use Confirm brief if it is accurate.';
export function revealForFirstFact(state: PadVisibility, hasSubstantiveFact: boolean): PadVisibility {
    if (!hasSubstantiveFact || state.revealed) return state;
    return {...state, revealed:true, open:state.manual ? state.open : true};
}
export function togglePad(state: PadVisibility): PadVisibility { return {...state,open:!state.open,manual:true}; }
