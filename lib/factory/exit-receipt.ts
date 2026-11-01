/** Receipt only: the persona owns its conversational farewell. Tool completion
 * must not ask it to generate another one. No closure or handoff success claim. */
export function exitReceipt() {
    return {status:'CLOSING_PENDING',instruction:'Visitor exit is recorded. Do not start another farewell or substantive reply. The host handles SDK closure after the final reply. Nothing has been sent or submitted.'};
}
