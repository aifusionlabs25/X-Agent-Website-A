export type VisitorNameAnswer = {
    value: string;
    clause: string;
    pureContact: boolean;
    contacts?: ('phone' | 'email')[];
};

const acknowledgments = /^(?:(?:yeah|yep|yes|um|uh|erm|okay|ok|sure|well|right)[,.\s]+)*/iu;
const unavailableName = /^(?:unknown|unsure|not (?:sure|known|provided|available|interested)|no(?: name| thanks)?|none|declined|rather not|prefer not|yes|yeah|okay|sure|well|sorry|fine|hello|hi|understood|go ahead|continue|thanks|thank you|goodbye|bye|exactly|right|correct|accurate|absolutely|perfect|great|alright|got it|sounds good|(?:(?:really|very|still)\s+)?(?:worried|scared|afraid|anxious|upset|shaken))$/iu;
const phoneValue = String.raw`(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}`;
const emailValue = String.raw`(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\b[a-z]\s+)?[a-z0-9]+(?:(?:\.|\s+(?:dot|period)\s+)[a-z0-9]+)*\s+at\s+[a-z0-9]+(?:(?:\.|\s+(?:dot|period)\s+)[a-z0-9]+)+)`;
const contactLabels = String.raw`(?:my\s+)?(?:cell(?:\s*phone)?|phone|number|callback|emails?)\b`;
const contactBoundary = new RegExp(String.raw`[.!?,;]|\s+(?:and|but)\b|\s+(?=`+contactLabels+'|'+phoneValue+String.raw`(?=$|[\s.!?,;])|`+emailValue+String.raw`(?=$|[\s.!?,;]))`,'iu');
const phoneLabel = String.raw`(?:my\s+)?(?:cell(?:\s*phone)?(?: number)?|phone(?: number)?|callback(?: number)?|number)\s*(?:is|['’]s|:)?\s*`;
const emailLabel = String.raw`(?:my\s+)?email(?: address|s)?\s*(?:is|['’]s|:)?\s*`;
const phoneClause = new RegExp('^(?:'+phoneLabel+')?'+phoneValue+String.raw`(?=$|[\s.!?,;])`,'iu');
const emailClause = new RegExp('^(?:'+emailLabel+')?'+emailValue+String.raw`(?=$|[\s.!?,;])`,'iu');
const labeledContact = new RegExp(String.raw`\b(?:`+phoneLabel+phoneValue+'|'+emailLabel+emailValue+')','iu');
const spokenEmailOnly = /^[\p{L}\p{N}_.’'+-]+(?:\s+[\p{L}\p{N}_.’'+-]+)*\s+at\s+[a-z0-9]+(?:(?:\.|\s+(?:dot|period)\s+)[a-z0-9]+)+[.!?\s]*$/iu;
const nonIdentityOpening = /^(?:we|he|she|they|it|there|my|your|his|her|their|the|in|from|at|if|hypothetically|suppose|assuming|imagine|could|would|should|do|does|did|are|was|were|not|no|never|maybe|perhaps|please|really|very|still|just|because|unknown|unsure|declined|don['’]t|didn['’]t|can['’]t|won['’]t)\b/iu;
const caseOrControlAnswer = /^(?:field (?:sobriety )?tests?|breath(?: test)?(?: maybe)?|blood tests?|license (?:suspend\w*|revok\w*|details)|contact first|general (?:process|information)(?: first)?|papers?|paperwork|no thanks)[.!?\s]*$/iu;
const wholeControlAnswer=/^(?:(?:yes|yeah|yep|okay|ok|sure|right|correct|accurate|exactly|absolutely|perfect|great|alright|got it|sounds good|(?:that|it)(?:['’]s| is) (?:right|correct|accurate))[,!?.\s]*)+$/iu;

export function visitorNameControl(text:string):boolean {return wholeControlAnswer.test(text.trim());}

function contactAtStart(text: string): {kind: 'phone' | 'email'; length: number} | null {
    const phone = phoneClause.exec(text), email = emailClause.exec(text);
    if (phone) return {kind:'phone',length:phone[0].length};
    if (email) return {kind:'email',length:email[0].length};
    return null;
}

/** A pure contact suffix may contain more than one independent contact clause.
 * Never discard sibling case facts or an incomplete/ambiguous contact answer. */
function personalContacts(tail: string): ('phone' | 'email')[] | null {
    const contacts: ('phone' | 'email')[] = [];
    let remaining = tail;
    for (let i = 0; i < 4; i++) {
        const contact = contactAtStart(remaining);
        if (!contact) return null;
        contacts.push(contact.kind);
        remaining = remaining.slice(contact.length).replace(/^[\s.!?,;]+/u, '')
            .replace(/^(?:and|but)\s+/iu, '').trim();
        if (!remaining) return [...new Set(contacts)];
    }
    return null;
}

/** Only fully consumed contact clauses qualify. Leading conversational
 * acknowledgments are not documents; any sibling case/paperwork text prevents
 * this classification so its independently reported facts remain untouched. */
export function visitorContactOnlyAnswer(text:string):('phone'|'email')[]|null {
    const body=text.trim().replace(/^(?:(?:sorry|yes|yeah|yep|okay|ok|sure|right|thanks|thank you|that['’]s right)[.!?,\s]+)*/iu,'')
        .replace(/^(?:and|but)\s+/iu,'');
    return personalContacts(body);
}

function lastQuestion(prior: string): string {
    return prior.match(/[^.!?]*\?/gu)?.at(-1)?.trim()
        || prior.trim().split(/[.!?]/u).at(-1)?.trim() || '';
}

function thirdPartyContactQuestion(question:string):boolean {
    return /\b(?:other (?:driver|person|party)|officer|witness|contractor|attorney|lawyer|spouse|husband|wife|partner|employer|mother|father|parent|friend|his|her|their)\b/iu.test(question)
        && /\b(?:contact|phone|callback|number|email|name)\b/iu.test(question);
}

export function asksAnotherPersonsName(prior: string): boolean {
    const question = lastQuestion(prior);
    // Multiple name requests do not identify which person a bare answer names.
    return (question.match(/\bname\b/giu)?.length ?? 0) > 1
        || /\bname\b/iu.test(question)&&thirdPartyContactQuestion(question)
        || /\b(?:other (?:driver|person|party)|driver['’]s|officer['’]s|witness['’]s|contractor['’]s|attorney['’]s|his|her|their)\b[^?]{0,60}\b(?:full )?name\b/iu.test(question);
}

function asksVisitorName(prior: string): boolean {
    let question = lastQuestion(prior);
    if (asksAnotherPersonsName(prior)||thirdPartyContactQuestion(question)) return false;
    const ownName = /\byour\s+(?:(?:full|first and last)\s+)?name\b|\bwhat\s+name\b[^?]{0,60}\b(?:you|your|firm)\b|\b(?:may|can|could)\s+I\s+(?:get|have|record)\s+(?:a |the )?(?:full )?name\b|\bwhat\s+(?:should|can)\s+(?:I|we)\s+call\s+you\b|\bwho\s+(?:am I|are we)\s+(?:speaking|talking)\s+(?:with|to)\b/iu.test(question);
    if (!ownName) return false;
    // Reachability is not an incident location. Remove only these specific
    // callback clauses, leaving any actual city/location question ambiguous.
    question = question.replace(/\bwhere\s+(?:(?:the|our|your)\s+)?(?:firm|team|we|I|someone|they)\s+(?:can|could|may|should|will|would)\s+(?:reach|contact|call)\s+you\b/giu, '')
        .replace(/\bwhere\s+(?:can|could|may|should)\s+(?:we|I|the firm|our team)\s+(?:reach|contact|call)\s+you\b/giu, '')
        .replace(/\bwhere\s+you\s+(?:can|could|may)\s+be\s+(?:reached|contacted|called)\b/giu, '');
    return !/\b(?:where|location|which city)\b/iu.test(question);
}

/** A caller can volunteer their name while answering their own callback or
 * contact-details question. Never borrow this context from another person or
 * from an incident/location question. */
function asksVisitorContact(prior: string): boolean {
    const question=lastQuestion(prior);
    if(asksAnotherPersonsName(prior)||thirdPartyContactQuestion(question)
        || /\b(?:location|which city|where\s+(?:did|was|is|are)|where\b[^?]{0,40}\b(?:happen|occur))\b/iu.test(question))return false;
    return /\b(?:callback|phone(?: number)?|email(?: address)?|contact (?:info|information|details)|number)\b/iu.test(question)
        && /\b(?:your|you|callback|firm|follow[ -]?up)\b/iu.test(question);
}

/** Read one direct visitor name clause, not an entire speech turn. The caller
 * stores only the exact captured span; sibling contacts/case facts stay separate. */
export function visitorNameAnswer(text: string, prior: string): VisitorNameAnswer | null {
    const input = text.trim();
    if(wholeControlAnswer.test(input))return null;
    const nameContext=asksVisitorName(prior),contactContext=asksVisitorContact(prior);
    const ack = acknowledgments.exec(input)![0];
    // A selected contact-intake option is a dialog act, not part of the name.
    const choice=contactContext?/^(?:contact(?: info| information| details)? first)[,.:\s]+/iu.exec(input.slice(ack.length))?.[0]||'':'';
    const introduction = /^(?:(?:it(?:['’]?s| is)|that(?:['’]s| is)|my(?: full)? name(?: is|['’]s)|I(?:['’]m| am)|this is|call me|you can call me)\s+)?/iu.exec(input.slice(ack.length+choice.length))![0];
    // Only an actual identity declaration supplies its own context. "I'm"
    // or "this is" can start an ordinary case/status answer, not just a name.
    const explicit=/^(?:my(?: full)? name(?: is|['’]s)|call me|you can call me)\s+/iu.test(introduction);
    if(/^(?:I(?:['’]m| am)|this is)\s+/iu.test(introduction)&&!nameContext)return null;
    if(!explicit&&!nameContext&&!contactContext)return null;
    const start = ack.length + choice.length + introduction.length;
    // ASR capitalization and punctuation are not identity evidence. Locate the
    // name's original span before a field label or known contact value.
    const rest = input.slice(start);
    // A contact-only answer has no independent name span. In particular, a dot
    // in an email address must never make its local part look like a first name.
    if (contactAtStart(rest)) return null;
    const boundary = contactBoundary.exec(rest);
    const span = (boundary ? rest.slice(0,boundary.index) : rest).trimEnd();
    const matched = /^([\p{L}][\p{L}'’-]+(?:\s+(?:(?:de|del|da|dos|van|von|la|le)\s+)*[\p{L}][\p{L}'’-]+){0,3})$/iu.exec(span);
    if (!matched || unavailableName.test(matched[1]) || caseOrControlAnswer.test(matched[1]) || /\b(?:and|but|or|not)\b/iu.test(matched[1])
        || nonIdentityOpening.test(matched[1])) return null;
    const value = matched[1], end = start + value.length;
    const suffix = input.slice(end);
    const tail = suffix.replace(/^\s*(?:[.!?,;]\s*)?(?:(?:and|but)\s+)?/iu, '').trim();
    const contacts = personalContacts(tail);
    // A spaced spoken email alone is not a name. A complete, separate phone
    // followed by an email, however, establishes an actual contact list.
    if (spokenEmailOnly.test(rest) && !labeledContact.test(rest)
        && !(contacts?.includes('phone') && contacts.includes('email'))) return null;
    if (!tail || /^[.!?\s]*$/u.test(tail)) return {value,clause:input,pureContact:true};
    // A later explicit identity may be a correction. Leave that turn to the
    // existing explicit-name extraction instead of overwriting it with this one.
    if (/\bmy\s+(?:full\s+)?name\b/iu.test(tail)) return null;
    // Refuse a second possible name/place rather than guessing which value
    // belongs in the visitor's identity field.
    if (!contactAtStart(tail) && !/^(?:my\s+(?:cell(?:\s*phone)?|phone|number|callback|email|name)\b|I\b|I['’]m\b|we\b|they\b|he\b|she\b|there\b|the\b|also\b|please\b)/iu.test(tail)) return null;
    if (contacts) return {value,clause:input,pureContact:true,contacts};
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
