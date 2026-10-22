export function isUnexpectedEvanClose(input: {
    isEvan: boolean;
    requestedCloseReason: string | null;
    publicAudioBlocked: boolean;
}): boolean {
    return input.isEvan
        && input.requestedCloseReason === null
        && !input.publicAudioBlocked;
}
