/** Capture-only classification helpers. Never rewrite transcript evidence or
 * use these to authorize contact, actions, or call closure. Negation, ownership
 * and uncertainty are deliberately not treated as conversational filler. */
export function stripEvanCaptureLeadIn(text: string): string {
    return text.trim().replace(/^(?:(?:hi|hello|hey|right|okay|ok|yeah|yes|yep|sure|well|so|and|uh+|um+|erm|hmm|sorry|actually|correction|I mean|you know)(?:[,;:.!\s]+|$))+/iu, '').trim();
}

export function isEvanGenericMoveIntroduction(text: string): boolean {
    // Normalize filler only for this whole-clause classification. Meaningful
    // sibling requests must prevent a match and remain available for review.
    const body = stripEvanCaptureLeadIn(text)
        .replace(/\b(?:uh+|um+|erm|hmm)\b[,\s]*/giu, ' ')
        .replace(/\s+/g, ' ').trim();
    // Bounded help-seeking tails, including the observed ASR "carry you"
    // variant. This classifies a generic note only; it does not repair speech
    // or suppress a suffix naming an object, date, route, constraint or service.
    const helpRequest = String.raw`(?:(?:could|can|would)\s+(?:really\s+)?use|would\s+like|(?:really\s+)?(?:need|want)|looking\s+for|carry\s+you|could\s+you)\s+(?:(?:some|your|a little)\s+)?help`;
    return new RegExp(String.raw`^(?:I(?:['’]m| am)|we(?:['’]re| are))\s+planning\s+(?:(?:a|my|our)\s+move|to\s+move|on\s+moving)(?:\s+and[,\s]+(?:(?:I|we)\s+)?${helpRequest})?[.!?]*$`, 'iu').test(body)
        || /^(?:I|we)\s+(?:could use|need|want)\s+(?:some\s+)?help\s+(?:with(?:\s+planning)?|planning)\s+(?:a|my|our)\s+move[.!?]*$/iu.test(body);
}
