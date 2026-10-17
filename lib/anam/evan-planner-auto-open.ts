/** Local display intent only: this never extracts, confirms, stores, or geocodes an address. */
export function isEvanRouteIntakeQuestion(text: string): boolean {
    const normalized = text.normalize('NFKC')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/"[^"]*"/g, ' ')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\b(where|what)'s\b/gi, '$1 is')
        .replace(/\byou're\b/gi, 'you are')
        .replace(/\byou'll\b/gi, 'you will')
        .replace(/\bpick-up\b/gi, 'pickup')
        .replace(/\bdrop[ -]off\b/gi, 'dropoff')
        .toLowerCase();

    return normalized.split(/[.!?\n]+/).some(raw => {
        let question = raw.replace(/\s+/g, ' ').trim();
        // Remove only conversational/intake lead-ins. Do not search arbitrarily
        // inside a sentence: reported, quoted, and hypothetical questions must
        // not become live requests merely because they contain route keywords.
        const friendlyLeadIn = /^(?:and|also|so|first|next|okay|ok|great|perfect|absolutely|certainly|sure|thanks|thank you|got it|that helps|sounds good|no problem|of course|to start|to get started|to plan (?:your|the) (?:move|route)|just to clarify)(?:\s*[,;:\u2013\u2014-]\s*|\s+)/;
        const intakeLeadIn = /^(?:(?:if|when) you (?:are ready|would like(?: to (?:discuss|plan|start|talk about) (?:a|your|the)(?: new)? move)?)|if you'd like(?: to (?:discuss|plan|start|talk about) (?:a|your|the)(?: new)? move)?|(?:let's|let us) (?:start|begin) with (?:the basics|your move|the move details|the locations)|before we (?:go further|get started)|just so i understand|to help (?:plan|organize) (?:your|the) move)(?:\s*[,;:\u2013\u2014-]\s*)/;
        for (let prefix = 0; prefix < 4; prefix += 1) {
            const stripped = question.replace(friendlyLeadIn, '').replace(intakeLeadIn, '');
            if (stripped === question) break;
            question = stripped;
        }
        if (!question || /\b(?:moving on|e-?mail|phone|website|billing address|mailing address|contact address)\b/.test(question)) return false;
        if (/\b(?:hypothetically|for example|suppose|imagine|what if)\b/.test(question)
            || /\bif (?:you|we|i) (?:were|had|decided)\b/.test(question)) return false;

        const whereRoute = /\bwhere\b.{0,90}\b(?:mov(?:e|ing)\s+(?:from|to)|(?:coming|starting)\s+from|(?:headed|heading|going)\s+to|pick(?:up| up)|dropoff|deliver(?:y|ing)?|collect(?:ing)?|origin|destination)\b/;
        const routeAddress = /\b(?:pickup|pick up|delivery|dropoff|collection|origin|destination|starting|ending|current|new|home|storage)(?:\s+(?:and|or)\s+(?:pickup|delivery|dropoff|destination|origin))?\s+(?:street\s+)?(?:address(?:es)?|locations?|cities|city|towns?|areas?|zip codes?)\b/;
        const addressForRoute = /\b(?:address(?:es)?|locations?|cities|city|towns?|areas?|zip codes?)\b.{0,55}\b(?:pickup|pick up|delivery|dropoff|origin|destination|mov(?:e|ing)\s+(?:from|to))\b/;
        const homeCity = /^(?:what|which)\s+(?:city|town|area)\b.{0,30}\b(?:current|new|old)\s+(?:home|house)\s+(?:is\s+)?in\b/;

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
                || homeCity.test(question)
                || /^(?:what|which)\s+(?:cities|towns)\s+are\s+you\s+moving\s+between\s*$/.test(question)
                || /^(?:what|which)\s+(?:is|will be)\s+(?:(?:the|your)\s+)?(?:origin|destination)\s*$/.test(question);
        }

        const request = question.match(/^(?:(?:can|could|would|will) you (?:please )?(?:tell me|share|give me|provide|let me know|confirm)|(?:can|could|may) i (?:please )?(?:have|get|ask(?: for)?|start with)|(?:please )?(?:tell me|share|give me|provide|let me know|confirm)|(?:let's|let us) (?:start|begin) with)\s+(.+)$/);
        if (!request) return false;
        const subject = request[1].replace(/^please\s+/, '');
        // A request *about* why an address is needed, timing, price, stairs, or
        // a quoted example is not a request to supply the actual location.
        if (!/^(?:where|what|which|(?:(?:the|your|our)\s+)?(?:pickup|pick up|delivery|dropoff|collection|origin|destination|starting|ending|current|new|home|storage|street|address|addresses|location|locations|city|cities|town|towns|area|zip))\b/.test(subject)
            || /^(?:what|which)\s+(?:time|date|day|month|services?|items?|information|details|company|number|price|cost)\b/.test(subject)
            || /\b(?:date|time|hours|price|cost|policy|insurance)\b/.test(subject)) return false;
        return whereRoute.test(subject) || routeAddress.test(subject) || addressForRoute.test(subject)
            || homeCity.test(subject)
            || /^(?:(?:the|your)\s+)?(?:starting point|origin|destination)(?:\s+and\s+(?:(?:the|your)\s+)?(?:ending point|destination|origin))?(?:\s+for\s+(?:the|your)\s+move)?$/.test(subject);
    });
}

/**
 * Create only inside an Evan session. observeMessage is the SDK-facing entry point;
 * it acts only on a complete, uninterrupted persona message. A second entry point
 * accepts the planner's captured route after a completed user turn, so visitors
 * who volunteer both endpoints do not depend on Evan asking a particular question.
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
    const openRoute = (): boolean => {
        if (disposed || consumed) return false;
        // Consume before the callback so reentrant/transcript-repeat events cannot reopen it.
        consumed = true;
        activeMessage = null;
        completedIds.clear();
        input.onOpenRoute();
        return true;
    };
    const observeAgentText = (text: string): boolean => {
        if (disposed || consumed || !isEvanRouteIntakeQuestion(text)) return false;
        return openRoute();
    };
    const consume = () => {
        consumed = true;
        activeMessage = null;
        completedIds.clear();
    };
    return {
        /** For an already-completed agent turn, or focused classifier tests. */
        observeAgentText,
        /** Display only: uses the existing user-grounded plan, never geocodes or confirms addresses. */
        observeRouteStops: (stops: ReadonlyArray<{ kind: string; city: string }>): boolean => {
            if (disposed || consumed) return false;
            const hasEndpoint = (kind: string) => stops.some(stop => stop.kind === kind && stop.city.trim().length > 0);
            return hasEndpoint('Origin') && hasEndpoint('Destination') ? openRoute() : false;
        },
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
