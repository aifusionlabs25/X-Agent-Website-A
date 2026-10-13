export type VisitorNameAnswer = {
    value: string;
    clause: string;
    pureContact: boolean;
    contact?: 'phone' | 'email';
};

const acknowledgments = /^(?:(?:yeah|yep|yes|um|uh|erm|okay|ok|sure|well|right)[,.\s]+)*/iu;
const unavailableName = /^(?:unknown|unsure|not (?:sure|known|provided|available|interested)|no(?: name| thanks)?|none|declined|rather not|prefer not|yes|yeah|okay|sure|well|sorry|fine|hello|hi|understood|go ahead|continue|thanks|thank you|goodbye|bye)$/iu;
const phone = /^(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}[.!\s]*$/u;

function lastQuestion(prior: string): string {
    return prior.match(/[^.!?]*\?/gu)?.at(-1)?.trim()
        || prior.trim().split(/[.!?]/u).at(-1)?.trim() || '';
}

export function asksAnotherPersonsName(prior: string): boolean {
    const question = lastQuestion(prior);
    // Multiple name requests do not identify which person a bare answer names.
    return (question.match(/\bname\b/giu)?.length ?? 0) > 1
        || /\b(?:other (?:driver|person|party)|driver['’]s|officer['’]s|witness['’]s|contractor['’]s|attorney['’]s|his|her|their)\b[^?]{0,60}\b(?:full )?name\b/iu.test(question);
}

function asksVisitorName(prior: string): boolean {
    let question = lastQuestion(prior);
    if (asksAnotherPersonsName(prior)) return false;
    const ownName = /\byour\s+(?:full\s+)?name\b|\bwhat\s+name\b[^?]{0,60}\b(?:you|your)\b|\bwhat\s+(?:should|can)\s+(?:I|we)\s+call\s+you\b|\bwho\s+(?:am I|are we)\s+(?:speaking|talking)\s+(?:with|to)\b/iu.test(question);
    if (!ownName) return false;
    // Reachability is not an incident location. Remove only these specific
    // callback clauses, leaving any actual city/location question ambiguous.
    question = question.replace(/\bwhere\s+(?:(?:the|our|your)\s+)?(?:firm|team|we|I|someone|they)\s+(?:can|could|may|should|will|would)\s+(?:reach|contact|call)\s+you\b/giu, '')
        .replace(/\bwhere\s+(?:can|could|may|should)\s+(?:we|I|the firm|our team)\s+(?:reach|contact|call)\s+you\b/giu, '')
        .replace(/\bwhere\s+you\s+(?:can|could|may)\s+be\s+(?:reached|contacted|called)\b/giu, '');
    return !/\b(?:where|location|which city)\b/iu.test(question);
}

/** Read one direct visitor name clause, not an entire speech turn. The caller
 * stores only the exact captured span; sibling contacts/case facts stay separate. */
export function visitorNameAnswer(text: string, prior: string): VisitorNameAnswer | null {
    if (!asksVisitorName(prior)) return null;
    const input = text.trim();
    const ack = acknowledgments.exec(input)![0];
    const introduction = /^(?:(?:it(?:['’]?s| is)|that(?:['’]s| is)|my(?: full)? name(?: is|['’]s)|this is|call me|you can call me)\s+)?/iu.exec(input.slice(ack.length))![0];
    const start = ack.length + introduction.length;
    const matched = /^([\p{Lu}][\p{L}'’-]+(?:\s+(?:(?:de|del|da|dos|van|von|la|le)\s+)*[\p{Lu}][\p{L}'’-]+){0,3})(?=\s*(?:[.!?,;]|$)|\s+(?:and|but)\b)/u.exec(input.slice(start));
    if (!matched || unavailableName.test(matched[1])) return null;
    const value = matched[1], end = start + value.length;
    const suffix = input.slice(end);
    const tail = suffix.replace(/^\s*(?:[.!?,;]\s*)?(?:(?:and|but)\s+)?/iu, '').trim();
    if (!tail || /^[.!?\s]*$/u.test(tail)) return {value,clause:input,pureContact:true};
    // A later explicit identity may be a correction. Leave that turn to the
    // existing explicit-name extraction instead of overwriting it with this one.
    if (/\bmy\s+(?:full\s+)?name\b/iu.test(tail)) return null;
    // Refuse a second possible name/place rather than guessing which value
    // belongs in the visitor's identity field.
    if (!/^(?:my\s+(?:cell(?:\s*phone)?|phone|number|callback|email|name)\b|I\b|I['’]m\b|we\b|they\b|he\b|she\b|there\b|the\b|also\b)/iu.test(tail)) return null;
    const contactPhone = /^my\s+(?:cell(?:\s*phone)?(?: number)?|phone(?: number)?|callback(?: number)?)\s*(?:is|['’]s|:)\s*(.+)$/iu.exec(tail);
    if (contactPhone && phone.test(contactPhone[1])) return {value,clause:input,pureContact:true,contact:'phone'};
    const contactEmail = /^my\s+email(?: address)?\s*(?:is|['’]s|:)\s*[\w.+-]+@[\w.-]+\.[a-z]{2,}[.!\s]*$/iu.test(tail);
    if (contactEmail) return {value,clause:input,pureContact:true,contact:'email'};
    return {value,clause:input.slice(0,end)+(suffix.match(/^\s*[.!?,;]/u)?.[0]||''),pureContact:false};
}

/** A quoted/reported other person's name cannot become the visitor's name. */
export function reportsAnotherPersonsName(text: string): boolean {
    const input = text.trim().replace(acknowledgments, '');
    const outsideQuotes = input.replace(/"[^"]*"|“[^”]*”/gu, '');
    if (/\bmy\s+(?:full\s+)?name\b/iu.test(outsideQuotes)) return false;
    return /^(?:he|she|they|his|her|their|the (?:other driver|officer|witness|contractor|attorney))\b/iu.test(input)
        && /\b(?:name|called)\b/iu.test(input);
}
