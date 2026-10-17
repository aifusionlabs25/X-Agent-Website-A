/** Browser-only working notes. Never use this model to authorize contact or route email. */
export type EvanPlannerCheckIn = { displayName?: string; email?: string };
export type EvanPlannerContactField = 'displayName' | 'phone' | 'email' | 'contactPreference' | 'callbackWindow';
export type EvanPlannerContact = {
    displayName: string;
    phone: string;
    email: string;
    emailSource: 'check-in' | 'spoken' | null;
    proposedEmail: string;
    contactPreference: string;
    callbackWindow: string;
    hiddenFields: EvanPlannerContactField[];
};
type ContactTurn = { role: 'user' | 'agent'; content: string };

const clean = (value: string | undefined, max = 140) => (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}\b/gi;
const DIGIT_WORDS: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
const NAME_STOP = /\b(?:moving|calling|looking|planning|going|trying|handling|worried|concerned|confused|hard|complicated|sure|done|all|good|fine|okay|ok|set|great|happy|comfortable|satisfied|finished|busy|elderly|retired|not|sorry|ready|interested|available|from|at|with|and|but|thanks|thank|the|a|an|my|phone|email|number|tomorrow|today)\b/i;

function contactName(value: string): string {
    const name = clean(value.split(/[,.;!?]|\s+(?:and|but|my|with|from)\s+/i)[0], 70);
    return /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4}$/u.test(name) && !NAME_STOP.test(name) ? name : '';
}

function contactPhone(value: string): string {
    const normalized = value.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi, word => DIGIT_WORDS[word.toLowerCase()]);
    const candidates = normalized.match(/(?:\+?1[\s,.-]*)?\(?\d(?:[\s,().-]*\d){9,10}(?!\d)/g) ?? [];
    for (const candidate of candidates) {
        let digits = candidate.replace(/\D/g, '');
        if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
        if (digits.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return '';
}

function contactEmail(value: string): string {
    // Only explicit address tokens; do not guess spelled local parts or repair ambiguous ASR.
    if (/\b(?:[a-z][\s,-]+){2,}[a-z]\s+(?:at|@)\s*/i.test(value)) return '';
    const normalized = value.replace(/\s+at\s+/gi, '@').replace(/\s+dot\s+/gi, '.');
    const matches = normalized.match(EMAIL) ?? [];
    return matches.length === 1 ? matches[0].toLowerCase() : '';
}

function contactCorrection(value: string, kind: 'phone' | 'email'): { value: string; rejected: boolean; replacement: boolean } {
    const rejection = value.match(/\b(?:isn't|not|don't\s+use|do\s+not\s+use|wrong|incorrect)\b/i);
    if (!rejection || rejection.index === undefined) return { value, rejected: false, replacement: false };
    const firstValueIndex = kind === 'phone'
        ? value.search(/\d|\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/i)
        : value.search(EMAIL);
    if (firstValueIndex >= 0 && firstValueIndex < rejection.index && !/^(?:wrong|incorrect)$/i.test(rejection[0])) {
        // "My phone is ..., but not after five" keeps the supplied phone;
        // a later availability negation is not a rejection of that value.
        return { value, rejected: false, replacement: false };
    }
    // Once the old detail is explicitly rejected, never extract it again. Only
    // a subsequent replacement cue can supply the new working value.
    const tail = value.slice(rejection.index + rejection[0].length);
    const replacements = [...tail.matchAll(/\b(?:it\s+is|it's|(?:please\s+)?use|instead(?:\s+use)?|(?:the\s+)?correct(?:ed)?\s+(?:number|phone|email|address)\s+is|my\s+(?:phone(?:\s+number)?|mobile(?:\s+number)?|cell(?:\s+number)?|number|email(?:\s+address)?)\s+is|(?:call|email|text)\s+me\s+at)\s+(?!not\b)/gi)];
    const cue = replacements.at(-1);
    return cue && cue.index !== undefined
        ? { value: tail.slice(cue.index + cue[0].length), rejected: true, replacement: true }
        : { value: '', rejected: true, replacement: false };
}

function callbackWindow(value: string, answeringWindow: boolean): string {
    const match = value.match(/\b(?:call(?:\s+me)?(?:\s+back)?|reach\s+me|callback(?:\s+window)?(?:\s+is)?|best\s+time(?:\s+to\s+(?:call|reach)\s+me)?\s+is|i(?:'m|\s+am)\s+available)\s+(.+)/i);
    const candidate = clean(match?.[1] ?? (answeringWindow ? value : ''), 100).split(/[,;!?]|\.(?=\s|$)|\s+(?:and|but)\s+/i)[0];
    if (!candidate || /\b(?:at\s+)?\d[\d\s().-]{8,}/.test(candidate)) return '';
    if (!/\b(?:after|before|between|morning|afternoon|evening|weekdays?|weekends?|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|anytime|any\s+time|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i.test(candidate)) return '';
    return candidate;
}

/**
 * A deterministic view of explicitly supplied visitor details, recomputed from
 * this session's turns. Provider replies supply question context only, never data.
 * Keep this output in React memory; do not persist, log, or send it to a model.
 * A check-in email remains the recap destination; proposed spoken changes are
 * unverified display notes and intentionally cannot alter backend delivery.
 */
export function buildEvanPlannerContact(turns: ContactTurn[], checkIn: EvanPlannerCheckIn = {}): EvanPlannerContact {
    const checkInEmail = contactEmail(clean(checkIn.email, 254));
    const result: EvanPlannerContact = {
        displayName: clean(checkIn.displayName, 70), phone: '',
        email: checkInEmail, emailSource: checkInEmail ? 'check-in' : null,
        proposedEmail: '', contactPreference: '', callbackWindow: '', hiddenFields: [],
    };
    let previousAgent = '';
    let checkInEmailHidden = false;
    const hide = (field: EvanPlannerContactField) => {
        result[field] = '';
        if (!result.hiddenFields.includes(field)) result.hiddenFields.push(field);
        if (field === 'email') {
            result.emailSource = null; result.proposedEmail = '';
            // Suppress the check-in value for the remainder of this mounted
            // session, even if a different spoken address is supplied later.
            // This changes display only; server delivery authority is untouched.
            checkInEmailHidden = true;
        }
    };
    const show = (field: EvanPlannerContactField) => { result.hiddenFields = result.hiddenFields.filter(item => item !== field); };

    for (const turn of turns) {
        const text = clean(turn.content, 2000).replace(/[’]/g, "'");
        if (turn.role === 'agent') { previousAgent = text; continue; }
        if (!text) continue;
        const question = previousAgent;
        previousAgent = ''; // Only the immediately preceding question can establish context.
        const askingAboutContact = /^(?:is|what|which|do\s+you|does|have\s+you|did\s+you)\b/i.test(text) && /\?/.test(text);
        const clearAll = /\b(?:remove|delete|clear|hide|forget)\s+(?:(?:all|my|the)\s+)*(?:contact\s+(?:details|information)|personal\s+(?:details|information))\b/i.test(text);
        if (clearAll) {
            (['displayName', 'phone', 'email', 'contactPreference', 'callbackWindow'] as const).forEach(hide);
            continue;
        }
        const removed = new Set<EvanPlannerContactField>();
        for (const [field, label] of [['displayName', 'name'], ['phone', '(?:phone|number|callback number)'], ['email', '(?:email|e-mail|address)'], ['callbackWindow', '(?:callback window|callback time|best time)']] as const) {
            const removal = new RegExp(`\\b(?:remove|delete|clear|hide|forget|don'?t (?:show|display|keep|save)|do not (?:show|display|keep|save))\\s+(?:my\\s+|the\\s+)?${label}\\b`, 'i');
            const refusal = new RegExp(`\\b(?:don'?t want to (?:share|give)|won'?t (?:share|give)|prefer not to (?:share|give))\\s+(?:my\\s+)?${label}\\b`, 'i');
            if (removal.test(text) || refusal.test(text)) { hide(field); removed.add(field); }
        }

        if (!removed.has('displayName') && !askingAboutContact) {
            // Informal "I'm ..." / "this is ..." also describe health, tasks,
            // or feelings. Only an explicit name statement or a direct answer
            // to a name question can establish identity, even for a new guest.
            const explicit = text.match(/\bmy\s+(?:full\s+)?name\s+is\s+(.+)/i);
            const answer = /\b(?:your\s+(?:full\s+)?name|who\s+am\s+i\s+speaking\s+(?:to|with))\b.*\?/i.test(question)
                ? text.replace(/^(?:this\s+is|i\s+am|i'm)\s+/i, '') : '';
            const name = contactName(explicit?.[1] ?? answer);
            if (name && !/\b(?:name\s+is\s+not|not\s+my\s+name)\b/i.test(text)) { result.displayName = name; show('displayName'); }
        }

        const explicitPhone = /\b(?:my\s+(?:(?:phone|mobile|cell|callback)\s+)?number(?:\s+is)?|my\s+(?:phone|mobile|cell)(?:\s+number)?\s+(?:is|should\s+be)|(?:call|text|reach)\s+me\s+(?:at|on))\b/i.test(text)
            || /^(?:(?:actually|sorry|no)[,.]?\s+)?(?:phone|callback)\s+(?:number\s+)?(?:is|should\s+be)\b/i.test(text);
        const answerIsOtherNumber = /\b(?:address|street|road|avenue|storage\s+(?:code|number)|account|order|quote|reference|booking)\b/i.test(text);
        const phoneContext = explicitPhone
            || (!answerIsOtherNumber && /\b(?:your|best|callback)\b.{0,35}\b(?:phone|mobile|cell|number)\b.*\?/i.test(question));
        if (phoneContext && !askingAboutContact && !removed.has('phone')) {
            const correction = contactCorrection(text, 'phone');
            const forbidden = /\b(?:not\s+(?:my|the)|don'?t\s+(?:call|use)|do\s+not\s+(?:call|use))\b/i.test(text);
            const phone = (!forbidden || correction.replacement) ? contactPhone(correction.value) : '';
            if (correction.rejected) result.phone = '';
            if (phone) { result.phone = phone; show('phone'); }
        }

        const emailContext = /\b(?:my\s+(?:email|e-mail)|email\s+me\s+(?:at|on))\b/i.test(text)
            || /^(?:(?:actually|sorry|no)[,.]?\s+)?(?:email|e-mail)(?:\s+address)?\s+(?:is|should\s+be)\b/i.test(text)
            || /\b(?:your|best)\b.{0,30}\b(?:email|e-mail)\b.*\?/i.test(question);
        if (emailContext && !askingAboutContact && !removed.has('email')) {
            const correction = contactCorrection(text, 'email');
            const forbidden = /\b(?:not\s+my|don'?t\s+(?:email|use)|do\s+not\s+(?:email|use))\b/i.test(text);
            const email = (!forbidden || correction.replacement) ? contactEmail(correction.value) : '';
            if (correction.rejected) {
                result.proposedEmail = '';
                if (!checkInEmail || checkInEmailHidden) { result.email = ''; result.emailSource = null; }
            }
            if (email) {
                show('email');
                if (checkInEmail && !checkInEmailHidden && email !== checkInEmail) {
                    result.email = checkInEmail; result.emailSource = 'check-in'; result.proposedEmail = email;
                } else { result.email = email; result.emailSource = checkInEmail && !checkInEmailHidden ? 'check-in' : 'spoken'; result.proposedEmail = ''; }
            }
        }

        if (/\b(?:do not|don't|no)\s+(?:contact|follow\s*up)(?:\s+with)?\s+me\b|\bno\s+follow[- ]?up\b/i.test(text)) {
            result.contactPreference = 'No follow-up requested'; result.callbackWindow = '';
            show('contactPreference');
        } else if (/\b(?:email\s+only|only\s+(?:contact\s+me\s+by\s+)?email|prefer\s+email)\b/i.test(text)) {
            result.contactPreference = 'Email only'; result.callbackWindow = ''; show('contactPreference');
        } else if (/\b(?:text\s+(?:me|only)|prefer\s+(?:a\s+)?text|send\s+me\s+(?:a\s+)?text)\b/i.test(text) && !/\b(?:don't|do not)\s+text\b/i.test(text)) {
            result.contactPreference = 'Text message'; show('contactPreference');
        } else if (/\b(?:phone\s+only|prefer\s+(?:a\s+)?(?:phone\s+)?call|(?:please\s+)?call\s+me|reach\s+me\s+(?:at|on))\b/i.test(text) && !/\b(?:don't|do not)\s+call\b/i.test(text)) {
            result.contactPreference = 'Phone call'; show('contactPreference');
        } else if (/\b(?:don't|do not)\s+call\s+me\b/i.test(text)) {
            result.contactPreference = 'No phone calls'; result.callbackWindow = ''; show('contactPreference');
        }

        if (!removed.has('callbackWindow') && !['Email only', 'No phone calls', 'No follow-up requested'].includes(result.contactPreference)) {
            const window = callbackWindow(text, /\b(?:best\s+time|callback\s+(?:window|time)|when\s+(?:can|should|may))\b.*\?/i.test(question));
            if (window && !/\b(?:don't|do not|cannot|can't)\b/i.test(text)) { result.callbackWindow = window; show('callbackWindow'); }
        }
    }
    return result;
}
