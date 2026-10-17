/** Conservative, local-only close authorization. No provider/model inference. */
const normalizedSpeech = (value: string): string => value.normalize('NFKC')
    .replace(/"[^"]*"|\u201c[^\u201d]*\u201d|\u2018[^\u2019]*\u2019/g, ' ')
    .replace(/(^|[\s:,(])'[^']*'(?=$|[\s.!?,;:)])/g, '$1 ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, ',')
    .replace(/\s+/g, ' ').trim().toLowerCase();

const isReportedOrHypothetical = (text: string) => /\b(?:hypothetically|for example|suppose|imagine|what if)\b/.test(text)
    || /\b(?:if|when) (?:i|you|we|they|someone|a customer) (?:say|said|says|were to say|wanted to end)\b/.test(text)
    || /\b(?:said|says|asked|mentioned|wrote)\b/.test(text)
    || /\b(?:the phrase|the words|the example|the script)\b/.test(text);

const wantsToContinue = (text: string) => /\b(?:but|however|except|before (?:you|we|i) (?:go|leave|end|finish)|one (?:more|last|other) (?:question|thing)|another question|still (?:need|want|have)|keep (?:talking|going)|continue (?:talking|the conversation))\b/.test(text)
    || /\b(?:i|we) (?:have|want to ask) (?:some |a few )?(?:more|other) questions\b/.test(text)
    || /(?:^|[.!?,;])\s*(?:and )?more questions\b/.test(text)
    || /(?:^|[.!?,;])\s*(?:no[, ]+)?(?:wait|hold on|hang on|not yet)\b/.test(text)
    || /\b(?:don't|do not|not ready to|no need to|shouldn't|cannot|can't|won't|wouldn't|not)\b.{0,45}\b(?:end|stop|finish|close|disconnect|hang up|goodbye|bye|leave)\b/.test(text)
    || /\b(?:not (?:all|done|finished|all set)|(?:isn't|is not) all|haven't finished|have not finished)\b/.test(text);

const lastAgentClause = (value: string) => normalizedSpeech(value).split(/[.!?]+/).map(part => part.trim()).filter(Boolean).at(-1) ?? '';

function isAnythingElseQuestion(value: string): boolean {
    const question = lastAgentClause(value);
    // "No" to a contact readback or email preference is not permission to end.
    if (isReportedOrHypothetical(question) || wantsToContinue(question)
        || /\b(?:e-?mail|phone|number|contact|correct|confirmation|consent|recap)\b/.test(question)) return false;
    const directQuestion = /^(?:(?:and|so|now|great|thanks|thank you|okay|ok)[, ]+)*(?:is there|do you (?:have|need|want)|did you have|would you like)\b/.test(question);
    const shortQuestion = question === 'anything else'
        || (/^anything else\b/.test(question) && /\?\s*$/.test(value));
    return (directQuestion || shortQuestion)
        && /\b(?:anything else|any(?: more| other| further)? questions|any more help)\b/.test(question);
}

function isExplicitEndQuestion(value: string): boolean {
    const question = lastAgentClause(value);
    if (wantsToContinue(question) || isReportedOrHypothetical(question)) return false;
    return /^(?:would you like(?: me| us)? to|do you want(?: me| us)? to|shall (?:i|we)|should (?:i|we)|may i|can i)\s+(?:end|close|finish|stop)\s+(?:(?:this|the|our)\s+)?(?:call|conversation|session|chat)(?:\s+now)?$/.test(question);
}

/**
 * A bare confirmation never authorizes a hangup. A short negative answer is
 * accepted only after an actual final "anything else?" question; a short yes
 * only after an explicit end-call question, never contact/booking confirmation.
 */
export function hasEvanCloseIntent(userText: string, previousAgentText = ''): boolean {
    const text = normalizedSpeech(userText);
    if (!text || text.length > 2_000 || isReportedOrHypothetical(text) || wantsToContinue(text)) return false;

    if (/^(?:no|nope|nah)(?:[, ]+(?:thanks|thank you))?(?:[, ]+evan)?[.!]*$/.test(text)) {
        return isAnythingElseQuestion(previousAgentText);
    }
    if (/^(?:yes|yeah|yep|sure|okay|ok)(?:[, ]+please)?[.!]*$/.test(text)) {
        return isExplicitEndQuestion(previousAgentText);
    }

    let request = text;
    for (let index = 0; index < 6; index += 1) {
        const next = request.replace(/^(?:okay|ok|alright|all right|yes|yeah|yep|thanks|thank you|great|perfect|well|evan)[,;.! ]+/, '')
            .replace(/^(?:no|nope)[,;.!]+\s*/, '');
        if (next === request) break;
        request = next;
    }

    const explicitEnd = /^(?:(?:please|can you|could you|would you|can we|could we|let's|we can|you can|i(?:'d| would) like to|i want to|i need to)\s+)?(?:end|close|stop|finish|disconnect)\s+(?:(?:this|the|our)\s+)?(?:call|conversation|session|chat)(?:\s+(?:now|please|for now))*[.!?]*$/;
    if (explicitEnd.test(request)
        || /^(?:(?:please|can you|could you|you can|let's)\s+)?hang up(?:\s+(?:now|please))*[.!?]*$/.test(request)
        || /^(?:i (?:have|need) to go|i've got to go|i must go|i need to leave)(?:[, ]+(?:now|thanks|thank you))*[.!]*$/.test(request)) return true;

    if (text.includes('?')) return false;
    const courtesy = '(?:[,;.! ]+(?:(?:thanks(?: again)?|thank you)(?: for your help)?|evan|take care))*[.!]*';
    // Keep natural wrap-ups aligned with Evan's prompt, but match the whole
    // statement so "everything about packing" or a new detail cannot close it.
    const wrapUp = `(?:that(?:'s| is) (?:all|it|everything)|(?:i(?:'m| am)|we(?:'re| are)) (?:all set|done|finished)|all set|nothing else|no (?:more|other|further) questions)(?: for (?:now|today))?`;
    const setForNow = `(?:i(?:'m| am)|we(?:'re| are)) set for (?:now|today)`;
    if (new RegExp(`^(?:(?:no|nope)[, ]+)?(?:${wrapUp}|${setForNow})${courtesy}$`).test(request)) return true;

    // A genuine final goodbye is explicit authorization even after a short
    // handoff acknowledgement, but questions/reporting/continuation veto above.
    return /(?:^|[.!;, ]+)(?:goodbye|good-bye|bye(?: bye)?|take care|have a (?:great|good|wonderful|lovely|nice) (?:day|evening|weekend))(?:[, ]+evan)?[.!]*$/.test(request)
        && !/^(?:why|what|how|when|where|who|did|do|does|are|is|was|were|can|could|would|should)\b/.test(request)
        && !/\b(?:say|saying|means?|meant|hear|heard|practice|repeat)\b/.test(request);
}

/** A completed agent turn counts only if it actually ends with a brief goodbye. */
export function isEvanTerminalFarewell(agentText: string): boolean {
    const text = normalizedSpeech(agentText);
    if (!text || text.length > 500 || text.split(' ').length > 80 || agentText.includes('?')) return false;
    if (isReportedOrHypothetical(text) || wantsToContinue(text)
        || /\b(?:is there|do you (?:have|need|want)|can you|could you|would you|tell me|let me know|anything else|next question|say|saying|means?|practice|repeat)\b/.test(text)) return false;
    return /(?:^|[.!;, ]+)(?:goodbye|good-bye|bye(?: bye)?|take care|have a (?:great|good|wonderful|lovely|nice) (?:day|evening|weekend))(?:,\s*[a-z]+(?:\s+[a-z]+)?)?[.!]*$/.test(text);
}
