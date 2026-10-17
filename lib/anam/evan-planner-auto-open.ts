/** Local display intent only: this never extracts, confirms, stores, or geocodes an address. */
export function isEvanRouteIntakeQuestion(text: string): boolean {
    const normalized = text.normalize('NFKC')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\b(where|what)'s\b/gi, '$1 is')
        .replace(/\byou're\b/gi, 'you are')
        .replace(/\byou'll\b/gi, 'you will')
        .replace(/\bpick-up\b/gi, 'pickup')
        .replace(/\bdrop[ -]off\b/gi, 'dropoff')
        .toLowerCase();

    return normalized.split(/[.!?\n]+/).some(raw => {
        const question = raw.replace(/\s+/g, ' ').trim().replace(
            /^(?:(?:and|also|so|first|next|okay|ok|great|sure|thanks|thank you|got it|that helps|to start|to get started|to plan (?:your|the) (?:move|route)|just to clarify)[,:]?\s+)+/,
            '',
        );
        if (!question || /\b(?:moving on|e-?mail|phone|website|billing address|mailing address|contact address)\b/.test(question)) return false;

        const whereRoute = /\bwhere\b.{0,90}\b(?:mov(?:e|ing)\s+(?:from|to)|(?:coming|starting)\s+from|(?:headed|heading|going)\s+to|pick(?:up| up)|dropoff|deliver(?:y|ing)?|collect(?:ing)?|origin|destination)\b/;
        const routeAddress = /\b(?:pickup|pick up|delivery|dropoff|collection|origin|destination|starting|ending|current|new|home|storage)(?:\s+(?:and|or)\s+(?:pickup|delivery|dropoff|destination|origin))?\s+(?:street\s+)?(?:address(?:es)?|locations?|cities|city|towns?|areas?|zip codes?)\b/;
        const addressForRoute = /\b(?:address(?:es)?|locations?|cities|city|towns?|areas?|zip codes?)\b.{0,55}\b(?:pickup|pick up|delivery|dropoff|origin|destination|mov(?:e|ing)\s+(?:from|to))\b/;

        if (/^where\b/.test(question)) {
            // "Where is the delivery date listed?" is not a route-location request.
            if (/\b(?:date|time|hours|price|cost|policy|insurance|website)\b/.test(question)) return false;
            const moveEndpoints = /^where\s+(?:does|will|is)\s+(?:the|your)\s+move\s+(?:start(?:ing)?|begin(?:ning)?|end(?:ing)?|finish(?:ing)?)(?:\s+and\s+(?:end(?:ing)?|finish(?:ing)?))?\s*$/;
            return whereRoute.test(question) || moveEndpoints.test(question);
        }

        if (/^(?:what|which)\b/.test(question)) {
            if (/^(?:what|which)\s+(?:time|date|day|month|services?|items?|information|details|company|number)\b/.test(question)) return false;
            const asksLocation = /^(?:what|which)\s+(?:(?:is|are|will be)\s+)?(?:(?:the|your|our)\s+)?(?:pickup|delivery|dropoff|collection|origin|destination|starting|ending|current|new|home|storage|street|address|addresses|location|locations|city|cities|town|towns|area|zip)\b/.test(question);
            if (!asksLocation) return false;
            return routeAddress.test(question) || addressForRoute.test(question)
                || /^(?:what|which)\s+(?:cities|towns)\s+are\s+you\s+moving\s+between\s*$/.test(question)
                || /^(?:what|which)\s+(?:is|will be)\s+(?:(?:the|your)\s+)?(?:origin|destination)\s*$/.test(question);
        }

        const politeRequest = /^(?:(?:can|could|would|will) you (?:please )?(?:tell me|share|give me|provide|let me know)|(?:can|could|may) i (?:please )?(?:have|get|ask for))\b/;
        return politeRequest.test(question)
            && (whereRoute.test(question) || routeAddress.test(question) || addressForRoute.test(question));
    });
}

/**
 * Create only inside an Evan session. observeMessage is the SDK-facing entry point;
 * it acts only on a complete, uninterrupted persona message, never user speech.
 * Manual/tool opening or dismissal consumes this one-time automatic display opportunity.
 * Existing explicit controls stay independent and can still reopen the planner afterward.
 */
export function createEvanPlannerAutoOpen(input: { onOpenRoute: () => void }) {
    let consumed = false;
    let disposed = false;
    let activeMessage: { id: string; text: string; interrupted: boolean } | null = null;
    const completedIds = new Set<string>();
    const rememberCompleted = (id: string) => {
        completedIds.add(id);
        if (completedIds.size > 32) completedIds.delete(completedIds.values().next().value!);
    };
    const clearActive = () => {
        if (activeMessage) rememberCompleted(activeMessage.id);
        activeMessage = null;
    };
    const observeAgentText = (text: string): boolean => {
        if (disposed || consumed || !isEvanRouteIntakeQuestion(text)) return false;
        // Consume before the callback so reentrant/transcript-repeat events cannot reopen it.
        consumed = true;
        activeMessage = null;
        completedIds.clear();
        input.onOpenRoute();
        return true;
    };
    const consume = () => {
        consumed = true;
        activeMessage = null;
        completedIds.clear();
    };
    return {
        /** For an already-completed agent turn, or focused classifier tests. */
        observeAgentText,
        observeMessage: (message: {
            id: string;
            role: string;
            content: string;
            endOfSpeech: boolean;
            interrupted?: boolean;
        }): boolean => {
            if (disposed || consumed) return false;
            if (message.role === 'user') { clearActive(); return false; }
            if (message.role !== 'persona' || !message.id || message.id.length > 256 || completedIds.has(message.id)) return false;
            if (activeMessage?.id !== message.id) {
                clearActive();
                activeMessage = { id: message.id, text: '', interrupted: false };
            }
            activeMessage.interrupted ||= message.interrupted === true;
            if (activeMessage.text.length + message.content.length > 4_096) {
                clearActive();
                return false;
            }
            activeMessage.text += message.content;
            if (!message.endOfSpeech) return false;
            const completed = activeMessage;
            clearActive();
            return !completed.interrupted && observeAgentText(completed.text);
        },
        markOpened: consume,
        dismiss: consume,
        dispose: () => { disposed = true; consume(); },
    };
}
