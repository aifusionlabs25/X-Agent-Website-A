/** Evan-local adaptation of James's deterministic visitor-name/contact-list
 * parser. No James runtime, persona, service or state imports are used. Names
 * remain independent visitor spans; neither email local parts nor agent text
 * supply identity. The same evidence helper can feed browser and final notes. */
export type EvanVisitorNameAnswer = {
    value: string;
    clause: string;
    pureContact: boolean;
    contacts?: ('phone' | 'email')[];
};

const acknowledgments = /^(?:(?:yeah|yep|yes|um|uh|erm|okay|ok|sure|well|right)[!,.\s]+)*/iu;
const unavailableName = /^(?:unknown|unsure|not (?:sure|known|provided|available|interested)|no(?: name| thanks)?|none|declined|rather not|prefer not|yes|yeah|okay|sure|well|sorry|fine|hello|hi|understood|go ahead|continue|thanks|thank you|goodbye|bye|exactly|right|correct|accurate|absolutely|perfect|great|alright|got it|sounds good|(?:(?:really|very|still)\s+)?(?:worried|scared|afraid|anxious|upset|shaken))$/iu;
// A courtesy is a dialog act, not identity, even after a real name question.
// Check the proposed span only: a later explicit name/channel correction or
// move detail in the same visitor turn must still be processed independently.
const courtesyName = /^(?:thanks?\b|thank\s+you\b|(?:many|a thousand)\s+thanks\b|(?:(?:really|much|greatly)\s+)?appreciat(?:e|ed)\b|(?:have|enjoy)\s+(?:an?\s+|your\s+)?(?:(?:nice|good|great|lovely|wonderful)\s+)?(?:day|evening|night|weekend)\b|take\s+care\b|(?:talk|speak|see)\s+(?:to\s+)?you(?:\s+(?:soon|later|tomorrow))?$|(?:goodbye|bye|cheers)\b|all\s+the\s+best\b|until\s+next\s+time\b|(?:(?:so|very|really)\s+)?grateful\b|(?:been\s+)?a\s+pleasure\b|(?:(?:that|this|it)\s+)?sounds\s+(?:good|great|lovely|excellent)\b|(?:that|this|it)\s+(?:was|is)\s+(?:helpful|useful|great|lovely)\b|(?:nice|good|great|lovely)\s+(?:(?:talking|speaking)\s+(?:to|with)|to\s+meet)\s+you\b)/iu;
// ASR can punctuate spoken digit groups with commas. Contact-list validation
// must accept the same separators as channel extraction or it loses the name
// attached to an otherwise valid phone/email answer.
const phoneValue = String.raw`(?:\+?1[\s,….-]*)?\(?\d{3}\)?[\s,….-]*\d{3}[\s,….-]*\d{4}`;
/** ASR sometimes writes the spoken zero as O inside an otherwise numeric
 * North-American phone. Normalize only a complete 3-3-4 numeric-shaped span;
 * never change names, email local parts, vanity numbers or arbitrary O words.
 * Replacement is length-preserving so evidence quotes keep original offsets. */
export function normalizeEvanPhoneDigitAliases(text: string): string {
    const emails = [...text.matchAll(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}\b/giu)];
    return text.replace(/(?<![\p{L}\p{N}@+._])(?:\+?1[\s,….-]*)?\(?[2-9][\dOo]{2}\)?[\s,….-]*[2-9][\dOo]{2}[\s,….-]*[\dOo]{4}(?![\p{L}\p{N}@_]|\.[\p{L}\p{N}]|[\s,…().-]*\d)/gu,
        (value, index: number) => emails.some(email => index < email.index + email[0].length && index + value.length > email.index)
            ? value : value.replace(/[Oo]/g, '0'));
}
const emailValue = String.raw`(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\b[a-z]\s+)?[a-z0-9]+(?:(?:\.|\s+(?:dot|period)\s+)[a-z0-9]+)*\s+at\s+[a-z0-9]+(?:(?:\.|\s+(?:dot|period)\s+)[a-z0-9]+)+)`;
const contactLabels = String.raw`(?:my\s+)?(?:cell(?:\s*phone)?|phone|number|callback|emails?)\b`;
const contactBoundary = new RegExp(String.raw`[.!?,;]|\s+(?:and|but)\b|\s+(?=`+contactLabels+'|'+phoneValue+String.raw`(?=$|[\s.!?,;])|`+emailValue+String.raw`(?=$|[\s.!?,;]))`,'iu');
const phoneLabel = String.raw`(?:my\s+)?(?:cell(?:\s*phone)?(?: number)?|phone(?: number)?|callback(?: number)?|number)\s*(?:is|['’]s|:)?\s*`;
const emailLabel = String.raw`(?:my\s+)?email(?: address|s)?\s*(?:is|['’]s|:)?\s*`;
const phoneClause = new RegExp('^(?:'+phoneLabel+')?'+phoneValue+String.raw`(?=$|[\s.!?,;])`,'iu');
const emailClause = new RegExp('^(?:'+emailLabel+')?'+emailValue+String.raw`(?=$|[\s.!?,;])`,'iu');
const labeledContact = new RegExp(String.raw`\b(?:`+phoneLabel+phoneValue+'|'+emailLabel+emailValue+')','iu');
const spokenEmailOnly = /^[\p{L}\p{N}_.’'+-]+(?:\s+[\p{L}\p{N}_.’'+-]+)*\s+at\s+[a-z0-9]+(?:(?:\.|\s+(?:dot|period)\s+)[a-z0-9]+)+[.!?\s]*$/iu;
const nonIdentityOpening = /^(?:I|you|we|he|she|they|it|there|my|your|his|her|their|the|in|from|at|if|hypothetically|suppose|assuming|imagine|could|would|should|do|does|did|are|was|were|not|no|never|maybe|perhaps|please|moving|packing|unpacking|loading|downsizing|happy|ready|fine|good|done|finished|all|available|busy|stressed|really|very|still|just|because|unknown|unsure|declined|don['’]t|didn['’]t|can['’]t|won['’]t)\b/iu;
const taskOrControlAnswer = /^(?:packing|unpacking|loading|moving|downsizing|stressed|worried|all set|done|finished)(?:\s+\p{L}+){0,3}[.!?\s]*$|^(?:contact first|general (?:process|information)(?: first)?|no thanks)[.!?\s]*$/iu;
const wholeControlAnswer=/^(?:(?:yes|yeah|yep|okay|ok|sure|right|correct|accurate|exactly|absolutely|perfect|great|alright|got it|sounds good|(?:that|it)(?:['’]s| is) (?:exactly )?(?:right|correct|accurate))[,!?.\s]*)+$/iu;

export function evanVisitorNameControl(text:string):boolean {return wholeControlAnswer.test(text.trim());}

function contactAtStart(text: string): {kind: 'phone' | 'email'; length: number} | null {
    const phone = phoneClause.exec(normalizeEvanPhoneDigitAliases(text)), email = emailClause.exec(text);
    if (phone) return {kind:'phone',length:phone[0].length};
    if (email) return {kind:'email',length:email[0].length};
    return null;
}

/** A pure contact suffix may contain more than one independent contact clause.
 * Never discard sibling move facts or an incomplete/ambiguous contact answer. */
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
 * acknowledgments are not identity; any sibling move-detail text prevents
 * this classification so its independently reported facts remain untouched. */
export function evanVisitorContactOnlyAnswer(text:string):('phone'|'email')[]|null {
    const body=text.trim().replace(/^(?:(?:sorry|yes|yeah|yep|okay|ok|sure|right|thanks|thank you|that['’]s right)[.!?,\s]+)*/iu,'')
        .replace(/^(?:and|but)\s+/iu,'');
    return personalContacts(body);
}

function lastQuestion(prior: string): string {
    return prior.match(/[^.!?]*\?/gu)?.at(-1)?.trim()
        || prior.trim().split(/[.!?]/u).filter(part => part.trim()).at(-1)?.trim() || '';
}

/** A generic handoff question can refer to the contact request immediately
 * before it: "I'll need your name. What name should I give them?" Retain only
 * that adjacent statement, not an older question or an unrelated topic. Its
 * third-party ownership cues must also survive the same boundary. */
function contactQuestionContext(prior: string): string {
    const question = lastQuestion(prior);
    if (!/^(?:what|which)\s+(?:(?:full|first and last)\s+)?(?:name|number|phone|email|contact details)\b[^?]{0,100}\b(?:give|pass|share|send|record|use)\b/iu.test(question)) return question;
    const prefix = prior.slice(0, prior.lastIndexOf(question)).trim();
    if (!prefix || /\?$/u.test(prefix)) return question;
    const statement = prefix.match(/[^.!?]+[.!]?$/u)?.[0]?.trim() ?? '';
    if (!/\b(?:your|his|her|their)\b[^.!?]{0,60}\b(?:name|phone|number|email|contact)\b/iu.test(statement)) return question;
    return statement + ' ' + question;
}

function thirdPartyContactQuestion(question:string):boolean {
    return /\b(?:other (?:person|party)|driver|mover|contractor|spouse|husband|wife|partner|employer|mother|father|parent|friend|brother|sister|landlord|neighbor|customer|client|his|her|their)\b/iu.test(question)
        && /\b(?:contact|phone|callback|number|email|name)\b/iu.test(question);
}

export function evanAsksAnotherPersonsName(prior: string): boolean {
    const question = lastQuestion(prior);
    // Multiple name requests do not identify which person a bare answer names.
    return (question.match(/\bname\b/giu)?.length ?? 0) > 1
        || /\bname\b/iu.test(question)&&thirdPartyContactQuestion(question)
        || /\b(?:other (?:person|party)|driver['’]s|mover['’]s|contractor['’]s|his|her|their)\b[^?]{0,60}\b(?:full )?name\b/iu.test(question);
}

function asksVisitorName(prior: string): boolean {
    let question = contactQuestionContext(prior);
    if (evanAsksAnotherPersonsName(prior)||thirdPartyContactQuestion(question)) return false;
    const ownName = /\b(?:share|provide)\s+(?:your|a)\s+(?:full\s+)?name\b|\byour\s+(?:(?:full|first and last)\s+)?name\b|\bwhat\s+name\b[^?]{0,60}\b(?:you|your|firm)\b|\b(?:may|can|could)\s+I\s+(?:get|have|record)\s+(?:a |the )?(?:full )?name\b|\b(?:do|can|could|would)\s+you\s+(?:have|share|provide|give)(?:\s+(?:me|us))?\s+(?:a|your)\s+(?:full\s+)?name\b|\bwhat\s+(?:should|can)\s+(?:I|we)\s+call\s+you\b|\bwho\s+(?:am I|are we)\s+(?:speaking|talking)\s+(?:with|to)\b/iu.test(question);
    if (!ownName) return false;
    // Reachability is not a move location. Remove only these specific
    // callback clauses, leaving any actual city/location question ambiguous.
    question = question.replace(/\bwhere\s+(?:(?:the|our|your)\s+)?(?:firm|team|we|I|someone|they)\s+(?:can|could|may|should|will|would)\s+(?:reach|contact|call)\s+you\b/giu, '')
        .replace(/\bwhere\s+(?:can|could|may|should)\s+(?:we|I|the firm|our team)\s+(?:reach|contact|call)\s+you\b/giu, '')
        .replace(/\bwhere\s+you\s+(?:can|could|may)\s+be\s+(?:reached|contacted|called)\b/giu, '');
    return !/\b(?:where|location|which city)\b/iu.test(question);
}

/** A caller can volunteer their name while answering their own callback or
 * contact-details question. Never borrow this context from another person or
 * from a move-location question. */
function asksVisitorContact(prior: string): boolean {
    const question=contactQuestionContext(prior);
    if(evanAsksAnotherPersonsName(prior)||thirdPartyContactQuestion(question)
        || /\b(?:location|which city|where\s+(?:did|was|is|are)|where\b[^?]{0,40}\b(?:happen|occur))\b/iu.test(question))return false;
    return /\b(?:callback|phone(?: number)?|email(?: address)?|contact (?:info|information|details)|number)\b/iu.test(question)
        && /\b(?:your|you|callback|firm|follow[ -]?up)\b/iu.test(question);
}

/** An explicit own-contact introduction can occur inside a move answer. Require
 * an independent name followed by a contact value; never derive it from email,
 * quoted speech, a hypothetical, or another person's contact information. */
function volunteeredContactName(text: string, prior: string): EvanVisitorNameAnswer | null {
    const input = text.trim();
    const outsideQuotes = input.replace(/"[^"]*"|“[^”]*”|(?:^|[\s,(])'[^']*'|‘[^’]*’/gu, value => ' '.repeat(value.length));
    const introductions = [...outsideQuotes.matchAll(/\bmy\s+(?:contact\s+)?(?:info(?:rmation)?|details)\s*(?:is\b|are\b|:)\s*/giu)];
    if (introductions.length !== 1) return null;
    const introduction = introductions[0], prefix = input.slice(0, introduction.index);
    const clausePrefix = prefix.split(/[.!?;]/u).at(-1) || '';
    if (/\b(?:if|whether|unless)\s*[, :]*$/iu.test(clausePrefix)
        || /\b(?:suppose|imagine|pretend|hypothetically|example|said|says|told|wrote|quoted|reads?)\b/iu.test(clausePrefix)
        || /\b(?:do not|don['’]t|will not|won['’]t|rather not|prefer not|cannot|can['’]t|not sure|maybe)\b/iu.test(clausePrefix)) return null;
    const body = input.slice(introduction.index + introduction[0].length);
    const answer = directEvanVisitorNameAnswer(body, prior, true);
    if (!answer) return null;
    const tail = body.slice(body.indexOf(answer.value) + answer.value.length)
        .replace(/^[\s.!?,;]+/u, '').replace(/^(?:and|but)\s+/iu, '');
    if (!contactAtStart(tail)) return null;
    return { ...answer, clause: input.slice(introduction.index, introduction.index + introduction[0].length) + answer.clause,
        // Do not let a pure contact suffix erase substantive earlier clauses.
        pureContact: answer.pureContact && !prefix.replace(acknowledgments, '').trim() };
}

export function evanVisitorNameAnswer(text: string, prior: string): EvanVisitorNameAnswer | null {
    return volunteeredContactName(text, prior) || directEvanVisitorNameAnswer(text, prior);
}

/** Read one direct visitor name clause, not an entire speech turn. The caller
 * stores only the exact captured span; sibling contacts/move facts stay separate. */
function directEvanVisitorNameAnswer(text: string, prior: string, explicitContact = false): EvanVisitorNameAnswer | null {
    const input = normalizeEvanPhoneDigitAliases(text.trim());
    if(wholeControlAnswer.test(input))return null;
    const nameContext=explicitContact||asksVisitorName(prior),contactContext=asksVisitorContact(prior);
    const ack = acknowledgments.exec(input)![0];
    // A selected contact-intake option is a dialog act, not part of the name.
    const choice=contactContext?/^(?:contact(?: info| information| details)? first)[,.:\s]+/iu.exec(input.slice(ack.length))?.[0]||'':'';
    const introduction = /^(?:(?:it(?:['’]?s| is)|that(?:['’]s| is)|my(?: full)? name(?: is|['’]s)|I(?:['’]m| am)|this is|call me|you can call me|(?:please\s+)?(?:put|list|record|book)\s+(?:it|(?:the|my|our)\s+(?:move|request|booking|reservation))\s+under)\s+)?/iu.exec(input.slice(ack.length+choice.length))![0];
    // Only an actual identity declaration supplies its own context. "I'm"
    // or "this is" can start an ordinary move/status answer, not just a name.
    const explicit=/^(?:my(?: full)? name(?: is|['’]s)|call me|you can call me|(?:please\s+)?(?:put|list|record|book)\s+.+\s+under)\s+/iu.test(introduction);
    if(/^(?:I(?:['’]m| am)|this is)\s+/iu.test(introduction)&&!nameContext&&!contactContext)return null;
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
    const matched = /^([\p{L}][\p{L}'’-]*(?:\s+(?:(?:de|del|da|dos|van|von|la|le)\s+)*[\p{L}][\p{L}'’-]*){0,3})$/iu.exec(span);
    if (!matched || unavailableName.test(matched[1]) || courtesyName.test(matched[1]) || taskOrControlAnswer.test(matched[1]) || /\b(?:and|but|or|not)\b/iu.test(matched[1])
        || nonIdentityOpening.test(matched[1])) return null;
    const value = matched[1], end = start + value.length;
    const suffix = input.slice(end);
    const tail = suffix.replace(/^\s*(?:[.!?,;]\s*)?(?:(?:and|but)\s+)?/iu, '').trim();
    const contacts = personalContacts(tail);
    // An own contact-details request can start with a full name, followed by
    // channels in later turns. A phone/email-only question still cannot turn
    // an arbitrary bare answer into a name.
    const contactCardQuestion = contactContext && /\bcontact (?:details|info|information)\b/iu.test(contactQuestionContext(prior))
        && value.trim().split(/\s+/u).length >= 2;
    if (!nameContext && !contactCardQuestion && !explicit && !introduction.trim() && !contacts && !labeledContact.test(tail)) return null;
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
    if (!/^\s*[.!?;]\s+/u.test(suffix) && !contactAtStart(tail) && !/^(?:my\s+(?:cell(?:\s*phone)?|phone|number|callback|email|name)\b|I\b|I['’]m\b|we\b|they\b|he\b|she\b|there\b|the\b|also\b|please\b)/iu.test(tail)) return null;
    if (contacts) return {value,clause:input,pureContact:true,contacts};
    // A complete contact card can be followed by a separate question or move
    // fact. Keep its identity evidence without marking the whole turn as contact-only.
    const contactPrefix = tail.split(/(?:[.!?;]\s+|\s+and\s+)(?=(?:what|when|how|can|could|do|does|I|we|also|there)\b)/iu)[0];
    const prefixContacts = contactPrefix !== tail ? personalContacts(contactPrefix) : null;
    return {value,clause:input.slice(0,end)+(suffix.match(/^\s*[.!?,;]/u)?.[0]||''),pureContact:false,
        ...(prefixContacts ? { contacts: prefixContacts } : {})};
}

/** A quoted/reported other person's name cannot become the visitor's name. */
export function evanReportsAnotherPersonsName(text: string): boolean {
    const input = text.trim().replace(acknowledgments, '');
    const outsideQuotes = input.replace(/"[^"]*"|“[^”]*”/gu, '');
    if (/\bmy\s+(?:full\s+)?name\b/iu.test(outsideQuotes)) return false;
    return /^(?:he|she|they|his|her|their|the (?:driver|mover|contractor))\b/iu.test(input)
        && /\b(?:name|called)\b/iu.test(input);
}



export type EvanContactIdentityValue = { value: string; quote: string };
export type EvanContactIdentity = {
    name: EvanContactIdentityValue | null;
    phone: EvanContactIdentityValue | null;
    email: EvanContactIdentityValue | null;
    /** Explicit rejection of an own channel, for the existing contact reducer. */
    rejected: Array<'phone' | 'email'>;
};

export type EvanContactIntent = {
    /** A display label and the exact visitor words supporting that label. */
    contactPreference: EvanContactIdentityValue | null;
    /** The literal callback-time span; never move timing or agent readback. */
    callbackWindow: EvanContactIdentityValue | null;
};

const digitWords: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
const phoneSource = /(?<![\p{L}\d])(?:\+?1[\s,…().-]*)?(?:\d|zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s,…().-]*(?:\d|zero|oh|one|two|three|four|five|six|seven|eight|nine)){9}(?![\s,…().-]*(?:\d|zero|oh|one|two|three|four|five|six|seven|eight|nine)\b)/giu;
const emailSource = /\b[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}\b|\b[A-Z0-9_+'-]+(?:(?:\.|\s+(?:dot|period)\s+)[A-Z0-9_+'-]+)*\s+at\s+[A-Z0-9-]+(?:(?:\.|\s+(?:dot|period)\s+)[A-Z0-9-]+)+\b/giu;
const maskedQuotes = (text: string) => text.replace(/"[^"]*"|“[^”]*”|(?:^|[\s,(])'[^']*'|‘[^’]*’/gu, value => ' '.repeat(value.length));
// Channel values are evidence, not surrounding prose. Mask them only for
// context decisions so domains such as example.test or her.test cannot act as
// hypothetical/third-party markers for the next independently supplied field.
const lastClause = (text: string) => (text.split(/[;]|\.(?=\s|$)|[!?]/u).at(-1) ?? '')
    .replace(emailSource, value => ' '.repeat(value.length)).replace(phoneSource, value => ' '.repeat(value.length));
const unsafePrefix = (text: string) => /\b(?:suppose|imagine|pretend|hypothetically|example|said|says|told|wrote|quoted|reads?)\b/iu.test(text)
    || /\b(?:if|whether|unless)\b[^;.!?]*$/iu.test(text);
const otherPerson = /\b(?:his|her|their|your)\b|\bmy\s+(?:brother|sister|husband|wife|spouse|partner|mother|father|parent|friend|landlord|neighbor|customer|client)['’]s\b/iu;
const ownInfo = /\bmy\s+(?:contact\s+)?(?:info(?:rmation)?|details)\s*(?:is\b|are\b|:)/giu;
const explicitPhoneLabel = /\b(?:my\s+(?:(?:phone|mobile|cell|callback)\s+)?number|my\s+(?:phone|mobile|cell)|(?:call|text|reach)\s+me\s+(?:at|on))\b/iu;
const explicitEmailLabel = /\b(?:my\s+(?:email|e-mail)|email\s+me\s+(?:at|on))\b/iu;
const rejectValue = /\b(?:not|isn['’]t|wrong|incorrect|don['’]?t\s+use|do\s+not\s+use)\b/iu;
const replaceValue = /\b(?:it\s+is|it['’]s|(?:please\s+)?use|instead(?:\s+use)?|(?:the\s+)?correct(?:ed)?\s+(?:number|phone|email|address)\s+is|my\s+(?:phone(?:\s+number)?|number|email(?:\s+address)?)\s+is|(?:call|email|text)\s+me\s+at)\s+(?!not\b)/giu;

export function evanContactOffer(text: string): boolean {
    const source = maskedQuotes(text);
    const match = /\b(?:leave|share|give)\s+(?:my|you)\s+(?:contact\s+)?(?:info|information|details)\b/iu.exec(source);
    if (!match || unsafePrefix(lastClause(source.slice(0, match.index)))) return false;
    return !/\b(?:not|don['’]?t|won['’]?t|cannot|can['’]?t|rather not|prefer not)\b/iu.test(lastClause(source.slice(0, match.index)));
}

/** Conservative channel normalization shared with the planner. */
export function normalizeEvanContactPhone(text: string): string {
    const matches = [...normalizeEvanPhoneDigitAliases(text).matchAll(phoneSource)];
    if (matches.length !== 1) return '';
    let digits = matches[0][0].replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/giu,
        word => digitWords[word.toLowerCase()]).replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)
        ? '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6) : '';
}

export function normalizeEvanContactEmail(text: string): string {
    if (/\b(?:[a-z][\s,-]+){2,}[a-z]\s+(?:at|@)\s*/iu.test(text)) return '';
    const matches = [...text.matchAll(emailSource)];
    if (matches.length !== 1) return '';
    return matches[0][0].replace(/\s+at\s+/giu, '@').replace(/\s+(?:dot|period)\s+/giu, '.').toLowerCase();
}

/** Contact intent is separate from recap-email permission and field retention.
 * The caller may decline a recap yet still request coordinator contact. Source
 * spans allow the capture record to retain literal evidence, not display labels. */
export function extractEvanContactIntent(text: string, priorQuestion = ''): EvanContactIntent {
    const result: EvanContactIntent = { contactPreference: null, callbackWindow: null };
    const outside = maskedQuotes(text);
    const clauses = [...outside.matchAll(/[^;!?]+(?:[;!?]|$)/gu)].flatMap(match => {
        let offset = match.index;
        return match[0].split(/(?<=\.)\s+(?=[\p{L}])/u).map(value => {
            const index = offset; offset += value.length + (outside.slice(offset + value.length).match(/^\s+/u)?.[0].length ?? 0);
            return { value, index };
        });
    });
    const isSafe = (clause: string) => !unsafePrefix(clause.replace(emailSource, '').replace(phoneSource, '').replace(/[.!?;]\s*$/u, ''))
        && !otherPerson.test(clause.replace(emailSource, '').replace(phoneSource, ''))
        && !/\b(?:he|she|they)\s+(?:wants?|prefers?|needs?)\b|\bmy\s+(?:brother|sister|husband|wife|spouse|partner|mother|father|parent|friend|landlord|neighbor|customer|client)\b/iu.test(clause)
        && !/^\s*(?:is|are|what|which|when|does|do)\b[^?]*\?/iu.test(clause);
    const preferences: Array<{ index: number; value: string; quote: string }> = [];
    const rules: Array<{ value: string; negative?: boolean; pattern: RegExp }> = [
        { value: 'No follow-up requested', negative: true, pattern: /\b(?:(?:do\s+not|don['’]?t|never)\s+(?:contact|follow[ -]?up)(?:\s+with)?\s+me|(?:I\s+)?(?:do\s+not|don['’]?t)\s+want\s+(?:any\s+)?(?:contact|follow[ -]?up)|(?:no|stop|cancel)\s+(?:(?:any|all)\s+)?follow[ -]?up)\b(?!\s+(?:emails?|calls?|texts?|information|details|by|via)\b)/giu },
        { value: 'No phone calls', negative: true, pattern: /\b(?:(?:do\s+not|don['’]?t|never)\s+call\s+me|no\s+(?:more\s+)?(?:phone\s+)?calls)\b/giu },
        { value: 'Email only', pattern: /\b(?:email\s+only|only\s+(?:(?:contact|reach)\s+me\s+(?:by|via|through)\s+)?email)\b/giu },
        { value: 'Email', pattern: /\b(?:prefer\s+(?:to\s+be\s+contacted\s+(?:by|via)\s+)?email|(?:contact|reach)\s+me\s+(?:by|via|through)\s+email)\b/giu },
        { value: 'Text message', pattern: /\b(?:text\s+(?:me|only)|prefer\s+(?:a\s+)?text|send\s+me\s+(?:a\s+)?text)\b/giu },
        { value: 'Phone call', pattern: /\b(?:phone[ -]+only|prefer\s+(?:a\s+)?(?:phone\s+)?call|(?:please\s+)?call\s+me|reach\s+me\s+(?:at|on))\b/giu },
    ];
    for (const clause of clauses) {
        if (!isSafe(clause.value)) continue;
        for (const rule of rules) {
            for (const match of clause.value.matchAll(rule.pattern)) {
                const prefix = clause.value.slice(0, match.index).split(/[,]|\b(?:but|instead)\b/iu).at(-1) ?? '';
                if (!rule.negative && /\b(?:no|not|never|don['’]?t|cannot|can['’]?t|won['’]?t|rather\s+not)\b/iu.test(prefix)) continue;
                const index = clause.index + match.index;
                preferences.push({ index, value: rule.value, quote: text.slice(index, index + match[0].length) });
            }
        }
    }
    preferences.sort((left, right) => left.index - right.index);
    const preference = preferences.at(-1);
    if (preference) result.contactPreference = { value: preference.value, quote: preference.quote };
    if (preference && ['Email', 'Email only', 'No phone calls', 'No follow-up requested'].includes(preference.value)) return result;

    const question = lastQuestion(priorQuestion);
    const answeringWindow = !thirdPartyContactQuestion(question)
        && !/\b(?:his|her|their|mother|father|brother|sister|spouse|partner|friend|neighbor|landlord|customer|client)\b/iu.test(question)
        && /\b(?:best\s+time|callback\s+(?:window|time)|when\s+(?:can|should|may))\b[^?]*\?/iu.test(question)
        && !/\b(?:move|moving|pickup|drop[ -]?off|delivery|arrival|loading|packing)\b/iu.test(question);
    const safeCallContext = preference?.value === 'Phone call' || clauses.some(clause => isSafe(clause.value)
        && /\b(?:phone[ -]+only|callback|call|reach\s+me)\b/iu.test(clause.value)
        && !/\b(?:no|not|never|don['’]?t|cannot|can['’]?t)\b/iu.test(clause.value));
    for (const clause of clauses) {
        if (!isSafe(clause.value) || !answeringWindow && !safeCallContext
            || /\b(?:no|not|never|don['’]?t|cannot|can['’]?t|unavailable)\b/iu.test(clause.value)
            || /\b(?:move|moving|pickup|drop[ -]?off|delivery|arrival|crew|loading|packing|unpacking)\b/iu.test(clause.value)) continue;
        for (const temporal of clause.value.matchAll(/\b(?:in\s+the\s+(?:morning|afternoon|evening)|mornings?|afternoons?|evenings?|weekdays?|weekends?|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|anytime|any\s+time|after|before|between|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/giu)) {
            // A callback cue in a sibling sentence is not authority for a date
            // inside an unrelated location/status statement. Bind this time to
            // an adjacent callback/availability phrase, or a standalone answer.
            const prefix = clause.value.slice(0, temporal.index).replace(acknowledgments, '')
                // A separately stated own phone value can sit between the
                // callback predicate and its time. Mask only its literal span;
                // unrelated location/status words must still fail binding.
                .replace(phoneSource, '').trim();
            if (prefix && !/\b(?:call(?:\s+me)?(?:\s+back)?|reach\s+me|callback(?:\s+(?:window|time))?|best\s+time|I(?:['’]m|\s+am)\s+available)(?:\s+(?:is|on|at|from|around))*[, :]*$/iu.test(prefix)) continue;
            const suffix = clause.value.slice(temporal.index);
            const stop = /[,;!?]|\.(?=\s|$)|\s+(?:(?:are|is|would\s+be|works?)\s+(?:the\s+)?(?:best|better|good|fine|ideal)|(?:for|with)\s+(?:a\s+|the\s+)?(?:callback|call)|(?:about|regarding)\b|(?:and|but)\s+(?:I|my|we|the|please)\b)/iu.exec(suffix);
            const value = (stop ? suffix.slice(0, stop.index) : suffix).trim();
            if (!value || value.length > 100 || !/\b(?:morning|afternoon|evening|week|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|any|\d)/iu.test(value)
                || /\d[\d\s().-]{8,}/u.test(value)
                || !/^(?:(?:\d{1,2}(?::\d{2})?|a\.?m\.?|p\.?m\.?|in|the|on|at|around|this|next|every|after|before|between|from|through|until|to|and|mornings?|afternoons?|evenings?|weekdays?|weekends?|tomorrow|today|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|anytime|any|time)[\s–-]*)+$/iu.test(value)) continue;
            const index = clause.index + temporal.index;
            result.callbackWindow = { value, quote: text.slice(index, index + value.length) };
        }
    }
    return result;
}

/** Facts only: exact visitor spans and normalized display values, never
 * readback confirmation, consent, persistence, or delivery authority. */
export function extractEvanContactIdentity(text: string, priorQuestion = '', offeredContact = false): EvanContactIdentity {
    const result: EvanContactIdentity = { name: null, phone: null, email: null, rejected: [] };
    const outside = normalizeEvanPhoneDigitAliases(maskedQuotes(text));
    if (evanVisitorNameControl(outside) || /^\s*(?:is|what|which|do\s+you|does|have\s+you|did\s+you)\b/iu.test(outside) && /\?/u.test(outside)) return result;
    const ownIntroductions = [...outside.matchAll(ownInfo)].filter(match => {
        const prefix = lastClause(outside.slice(0, match.index));
        return !unsafePrefix(prefix) && !otherPerson.test(prefix)
            && !/\b(?:rather not|prefer not|do not|don['’]t|will not|won['’]t|cannot|can['’]t|not sure|maybe)\b/iu.test(prefix);
    });
    const offer = offeredContact || evanContactOffer(text);
    const ownQuestion = asksVisitorName(priorQuestion) || asksVisitorContact(priorQuestion);
    let answer = evanVisitorNameAnswer(text, priorQuestion);
    // A complete labelled contact card is itself a voluntary introduction;
    // it must not depend on Evan asking a particular scripted name question.
    // Keep bare names/values, third-party answers and reported examples out.
    let volunteeredBundle = false;
    if (!answer && !thirdPartyContactQuestion(contactQuestionContext(priorQuestion))) {
        const card = directEvanVisitorNameAnswer(outside, '', true);
        if (card && card.value.trim().split(/\s+/u).length >= 2
            && card.contacts?.length && labeledContact.test(outside)
            && !unsafePrefix(lastClause(outside.slice(0, outside.indexOf(card.value))))
            && !otherPerson.test(outside.replace(emailSource, '').replace(phoneSource, ''))) {
            answer = card;
            volunteeredBundle = true;
        }
    }
    if (!answer && offeredContact) answer = directEvanVisitorNameAnswer(text, priorQuestion, true);
    // An own offer can be followed by an independent contact list in the next
    // clause; it does not turn the offer's status words into a visitor name.
    if (!answer && evanContactOffer(text)) {
        const offerAt = outside.search(/\b(?:leave|share|give)\s+(?:my|you)\s+/iu);
        const boundary = /[.!?;]\s+/u.exec(outside.slice(offerAt));
        if (boundary) answer = directEvanVisitorNameAnswer(text.slice(offerAt + boundary.index + boundary[0].length), priorQuestion, true);
    }
    if (!answer) {
        for (const declaration of outside.matchAll(/\bmy\s+(?:full\s+)?name\s+(?:is|['’]s)\s+/giu)) {
            const prefix = lastClause(outside.slice(0, declaration.index));
            if (!unsafePrefix(prefix) && !otherPerson.test(prefix)) {
                answer = directEvanVisitorNameAnswer(text.slice(declaration.index), priorQuestion);
            }
        }
    }
    // Preserve Evan's existing self-introduction boundary: an opening greeting
    // or a full name immediately followed by an explicit own contact clause.
    if (!answer) {
        const greeting = /^\s*(?:hi|hello|hey)\s+Evan[,.!]\s*/iu.exec(outside);
        const body = greeting ? text.slice(greeting[0].length) : text.replace(/^(?:(?:sure|yes|yeah|okay|ok|uh|um)[,.!\s]+)+/iu, '');
        const completeContact = Boolean(normalizeEvanContactPhone(body) || normalizeEvanContactEmail(body));
        if (greeting || completeContact && /^(?:I['’]m|I am|this is)\s+[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){1,3}[,.;!]\s*(?:and\s+)?my\s+(?:phone|mobile|cell|callback|number|email)\b/iu.test(body)) {
            const candidate = directEvanVisitorNameAnswer(body, 'What is your name?');
            if (candidate && candidate.value.trim().split(/\s+/u).length > 1) answer = candidate;
        }
    }
    const nameIndex = answer ? outside.indexOf(answer.value) : -1;
    if (answer && nameIndex >= 0 && !unsafePrefix(lastClause(outside.slice(0, nameIndex)))
        && !otherPerson.test(lastClause(outside.slice(0, nameIndex)))) {
        result.name = { value: answer.value, quote: text.slice(nameIndex, nameIndex + answer.value.length) };
    }
    const bundle = Boolean(result.name) && (volunteeredBundle || ownQuestion || offer || ownIntroductions.length > 0
        || /\bmy\s+(?:full\s+)?name\b|\bmy\s+(?:phone|email)\b/iu.test(outside));
    // A visitor may volunteer a complete, standalone address even when the
    // preceding question was generic. Keep quoted, third-party, multi-address
    // and hypothetical text out; never derive a name from the address.
    const standaloneContact = evanVisitorContactOnlyAnswer(outside);
    const priorHandoff = lastQuestion(priorQuestion);
    const standaloneEmail = (!priorHandoff || /\b(?:anything else|what else|help (?:you|with))\b/iu.test(priorHandoff))
        && !thirdPartyContactQuestion(contactQuestionContext(priorQuestion))
        && standaloneContact?.length === 1 && standaloneContact[0] === 'email';
    for (const kind of ['phone', 'email'] as const) {
        if (kind === 'email' && /\b(?:[a-z][\s,-]+){2,}[a-z]\s+(?:at|@)\s*/iu.test(outside)) continue;
        const pattern = kind === 'phone' ? phoneSource : emailSource;
        const ownLabel = kind === 'phone' ? explicitPhoneLabel : explicitEmailLabel;
        const candidates = [...outside.matchAll(pattern)];
        const accepted: Array<EvanContactIdentityValue & { index: number }> = [];
        for (const candidate of candidates) {
            const index = candidate.index, prefix = outside.slice(0, index), clause = lastClause(prefix);
            if (unsafePrefix(clause) || otherPerson.test(clause)) continue;
            const explicit = ownLabel.test(clause);
            const inheritedCorrection = ownLabel.test(prefix) && [...clause.matchAll(replaceValue)].length > 0;
            const ownContext = explicit || inheritedCorrection || ownQuestion || offer || kind === 'email' && standaloneEmail
                || ownIntroductions.some(introduction => introduction.index < index) || bundle;
            if (!ownContext) continue;
            if (!explicit && /\b(?:address|street|road|avenue|storage\s+(?:code|number)|account|order|quote|reference|booking)\b/iu.test(clause)) continue;
            const rejection = rejectValue.exec(clause);
            if (rejection && ![...clause.slice(rejection.index + rejection[0].length).matchAll(replaceValue)].length) {
                if (explicit && !result.rejected.includes(kind)) result.rejected.push(kind);
                continue;
            }
            const quote = text.slice(index, index + candidate[0].length);
            const value = kind === 'phone' ? normalizeEvanContactPhone(quote) : normalizeEvanContactEmail(quote);
            if (value) accepted.push({ value, quote, index });
        }
        // Own-channel rejection without a replacement must clear a prior value.
        if (!accepted.length) {
            const label = ownLabel.exec(outside), rejection = rejectValue.exec(outside);
            const first = candidates[0]?.index ?? Infinity;
            if (label && rejection && label.index < rejection.index && rejection.index < first
                && !unsafePrefix(lastClause(outside.slice(0, label.index)))
                && !otherPerson.test(lastClause(outside.slice(0, label.index)))
                && !result.rejected.includes(kind)) result.rejected.push(kind);
        }
        const chosen = accepted.length === 1 ? accepted[0]
            : accepted.length > 1 && /\b(?:actually|instead|correct|use)\b/iu.test(outside.slice(accepted[0].index)) ? accepted.at(-1) : null;
        if (chosen) result[kind] = { value: chosen.value, quote: chosen.quote };
    }
    return result;
}

type ContactTurn = { role: 'user' | 'agent'; content: string };
type SourcedContactValue = EvanContactIdentityValue & { sourceTurn: number };
export type EvanContactTurnIdentity = {
    name: SourcedContactValue | null;
    phone: SourcedContactValue | null;
    email: SourcedContactValue | null;
    rejected: Array<'phone' | 'email'>;
};

/** A bare name offered to a callback-time question is ambiguous until the
 * agent addresses that same first name while asking for the visitor's contact.
 * The visitor's words, never the agent's acknowledgment, remain the source. */
function callbackNameCandidate(text: string, question: string): EvanContactIdentityValue | null {
    if (!/\b(?:callback|call\s+(?:you|back)|reach\s+you)\b/iu.test(question)
        || !/\b(?:time|when|day|window)\b/iu.test(question)
        || thirdPartyContactQuestion(question) || extractEvanContactIntent(text, question).callbackWindow) return null;
    const candidate = directEvanVisitorNameAnswer(text, '', true);
    if (!candidate?.pureContact || candidate.contacts?.length || candidate.value.split(/\s+/u).length < 2
        || text.replace(/[.!]+$/u, '').trim().toLocaleLowerCase() !== candidate.value.toLocaleLowerCase()
        || /\b(?:today|tomorrow|morning|afternoon|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|anytime|whenever)\b/iu.test(candidate.value)) return null;
    return { value: candidate.value, quote: candidate.value };
}

function acknowledgesCallbackName(text: string, name: string): boolean {
    const first = name.split(/\s+/u)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !thirdPartyContactQuestion(text)
        && new RegExp(`\\b(?:thanks|thank you|nice to meet you|got it)[,\\s]+${first}(?=[,.!\\s]|$)`, 'iu').test(text)
        && /\?/u.test(text) && (/\b(?:you|your)\b/iu.test(text) || /\b(?:best|preferred)\s+(?:phone\s+)?number\b/iu.test(text))
        && /\b(?:phone|number|email|contact|callback|reach you)\b/iu.test(text);
}

/** Whether the latest completed agent turn corroborates an immediately prior
 * caller-provided name. Used to refresh the planner without waiting for speech. */
export function hasEvanCallbackNameAcknowledgment(turns: ContactTurn[]): boolean {
    if (turns.length < 3) return false;
    const [question, answer, acknowledgment] = turns.slice(-3);
    if (question.role !== 'agent' || answer.role !== 'user' || acknowledgment.role !== 'agent') return false;
    const candidate = callbackNameCandidate(answer.content.trim(), question.content);
    return Boolean(candidate && acknowledgesCallbackName(acknowledgment.content, candidate.value));
}

/** Recompute a bounded contact exchange, not permanent conversational context.
 * Short acknowledgments/readbacks keep an established own-contact request
 * alive. Topic changes, third parties and removals end it. Consecutive user
 * turns do not silently reuse an old question. Every value still originates
 * in a visitor span, including a late-confirmed unsolicited full name. */
export function resolveEvanContactIdentities(turns: ContactTurn[]): EvanContactTurnIdentity[] {
    const resolved: EvanContactTurnIdentity[] = [];
    let context = '', immediate = '', previousOffer = false, lastContact = -100, ownChannel = false;
    let pendingName: SourcedContactValue | null = null;
    const key = (value: string) => value.normalize('NFKC').replace(/[’]/g, "'").toLowerCase().trim();
    const containsName = (text: string, name: string) => new RegExp('(?<![\\p{L}\\p{N}])'
        + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'iu').test(text);
    const readback = (text: string) => {
        const questions = text.replace(emailSource, value => value.replace(/[.!?]/gu, ' ')).match(/[^.!?]*\?/gu) ?? [];
        return !thirdPartyContactQuestion(text)
            && /\b(?:read\b.{0,25}\bback|your\s+(?:contact\s+)?details|(?:got|have)\s+(?:it|that)|was that|did I get|is that (?:right|correct))\b/iu.test(text)
            && !/\b(?:suppose|imagine|example|hypothetical)\b/iu.test(text.replace(emailSource, ''))
            && questions.every(question => /^(?:did I get\b|have I got\b|is that\b|was that\b|does that\b|correct\b|right\b)/iu.test(question.trim()));
    };
    const acknowledgment = (text: string) => /^(?:(?:thanks|thank you)(?:[, ]+[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,2})?|got it|okay|ok|right|great|sure|understood)[,.!\s]*$/iu.test(text);
    for (const [index, turn] of turns.entries()) {
        const empty: EvanContactTurnIdentity = { name: null, phone: null, email: null, rejected: [] };
        resolved.push(empty);
        const text = turn.content.trim();
        if (index - lastContact > 12) { context = ''; ownChannel = false; }
        if (pendingName && index - pendingName.sourceTurn > 12) pendingName = null;
        if (turn.role === 'agent') {
            if (hasEvanCallbackNameAcknowledgment(turns.slice(0, index + 1))) {
                const sourceTurn = index - 1;
                const candidate = callbackNameCandidate(turns[sourceTurn].content.trim(), turns[index - 2].content);
                if (candidate) resolved[sourceTurn].name = { ...candidate, sourceTurn };
            }
            immediate = text;
            previousOffer = false;
            if (asksVisitorName(text) || asksVisitorContact(text)) { context = text; lastContact = index; }
            else if (!acknowledgment(text) && !readback(text)) { context = ''; pendingName = null; ownChannel = false; }
            // Even a contact-looking readback cannot inherit a different
            // person's identity or an unrelated move-location question.
            if (thirdPartyContactQuestion(text)) { context = ''; pendingName = null; ownChannel = false; }
            continue;
        }
        const question = immediate;
        const bridge = Boolean(question && (acknowledgment(question) || readback(question)));
        const contactQuestion = bridge && context ? context : question;
        const identity = extractEvanContactIdentity(text, contactQuestion, previousOffer || bridge && ownChannel);
        // Continuing an established channel exchange does not ask for a new
        // name. Explicit self-identification still works without borrowed context.
        if (bridge) identity.name = extractEvanContactIdentity(text, question, previousOffer).name;
        immediate = '';
        previousOffer = evanContactOffer(text);
        for (const field of ['name', 'phone', 'email'] as const) {
            const value = identity[field];
            if (value) empty[field] = { ...value, sourceTurn: index };
        }
        empty.rejected = identity.rejected;
        const clears = /\b(?:remove|delete|clear|hide|forget|don['’]?t (?:show|keep|save)|do not (?:show|keep|save)|(?:prefer|rather) not|won['’]?t share)\b/iu.test(text);
        if (clears || thirdPartyContactQuestion(text)) { context = ''; pendingName = null; previousOffer = false; ownChannel = false; continue; }
        if (empty.name) pendingName = null;
        // A generic "anything else?" may receive an unsolicited full name.
        // Hold it as a candidate only; a first-name thank-you is NOT proof.
        if (!empty.name && /\b(?:anything else|what else|help you|help with)\b/iu.test(question)
            && !/\b(?:city|where|address|furniture|items|inventory|name|phone|email)\b/iu.test(question)) {
            const candidate = directEvanVisitorNameAnswer(text, '', true);
            if (candidate?.pureContact && !candidate.contacts?.length && candidate.value.split(/\s+/u).length >= 2
                && key(text.replace(/[.!]+$/u, '')) === key(candidate.value)) {
                pendingName = { value: candidate.value, quote: text.slice(text.indexOf(candidate.value), text.indexOf(candidate.value) + candidate.value.length), sourceTurn: index };
            }
        }
        if (pendingName && evanVisitorNameControl(text) && readback(question)
            && containsName(question, pendingName.value)) {
            empty.name = pendingName;
            pendingName = null;
        }
        if (pendingName && readback(question) && /\b(?:no|nope|wrong|incorrect|not right|not correct|not me|not mine)\b/iu.test(text)) pendingName = null;
        const contactAnswer = Boolean(empty.name || empty.phone || empty.email || previousOffer);
        if (contactAnswer) lastContact = index;
        if (empty.phone || empty.email) ownChannel = true;
        // A substantial visitor topic change also expires the exchange. A
        // malformed channel remains unrecorded, but does not discard the
        // surrounding contact request needed for its next corrected value.
        if (!contactAnswer && !evanVisitorNameControl(text) && pendingName?.sourceTurn !== index
            && !/^[\dOo\s,+().-]+[.!]?$/u.test(text)) { context = ''; pendingName = null; ownChannel = false; }
    }
    return resolved;
}

