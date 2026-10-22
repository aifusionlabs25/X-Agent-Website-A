import type { AmyTranscriptTurn } from './session-spine.ts';
import { extractEvanBundledName } from './evan-bundled-name.ts';

export type EvanGuestLead = {
    displayName: string | null;
    /** Visitor-supplied name not fully repeated by Evan; human review only. */
    nameForReview: string | null;
    phone: string | null;
    email: string | null;
    /** Visitor-supplied email not read back by Evan; internal review only, never a delivery address. */
    emailForReview?: string;
    requestedFollowUp: true;
    callbackWindow: string | null;
};

export type EvanGuestRecapRecipient = {
    /** Only an unambiguous address explicitly supplied by the visitor. */
    email: string;
    displayName: string;
    confirmedByReadback: boolean;
};

const digits = (text: string) => text.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi, word => ({
    zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
} as Record<string, string>)[word.toLowerCase()]);

function phoneIn(text: string): string | null {
    const candidate = digits(text).match(/(?:\+?1[\s,….-]*)?\(?\d(?:[\s,…().-]*\d){9,10}(?!\d)/)?.[0];
    if (!candidate) return null;
    let value = candidate.replace(/\D/g, '');
    if (value.length === 11 && value.startsWith('1')) value = value.slice(1);
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(value) ? value : null;
}

function emailIn(text: string): string | null {
    const normalized = text.toLowerCase().replace(/\s+at\s+/g, '@').replace(/\s+dot\s+/g, '.');
    const matches = normalized.match(/\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}\b/g) ?? [];
    return matches.length === 1 ? matches[0] : null;
}

function nameIn(text: string, previousAgent: string, previousUserOfferedContact = false): string | null {
    const explicit = text.match(/\bmy (?:full )?name is ([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,3})/iu);
    const introduced = text.match(/^(?:hi|hello|hey)\s+evan[,!.]?\s+(?:i'm|i am|this is)\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,3})/iu);
    const askedName = /\b(?:your (?:full )?name|who am i speaking (?:to|with)|share a name)\b|\b(?:may|can|could) i (?:have|get) your (?:full )?name\b/i.test(previousAgent);
    const answer = askedName
        ? text.match(/^(?:(?:sure|yes|yeah)[,.! ]+)?(?:this is |i am |i'm )?([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){1,3})(?=[,.!?]|$)/iu)
        : null;
    const volunteeredDetails = previousUserOfferedContact
        || /\b(?:leave|share|give)\s+(?:my|you)\s+(?:contact\s+)?(?:info|information|details)\b/i.test(text);
    const callbackQuestion = /\b(?:best|callback|phone)\s+(?:phone\s+)?number\b.*\?/i.test(previousAgent);
    const bundledText = text.replace(/^(?:(?:sure|yes|yeah|okay|ok|uh|um)[,.\s]+)+/i, '');
    const bundledName = volunteeredDetails || callbackQuestion
        ? bundledText.match(/(?:^|[.!]\s*)([\p{Lu}][\p{L}'’.-]*\s+[\p{Lu}][\p{L}'’.-]*)(?=,\s*(?:phone|callback)(?:\s+number)?\b)/u)?.[1]
        : null;
    const selfIntroduction = extractEvanBundledName(text, Boolean(phoneIn(text) || emailIn(text)));
    const value = (explicit?.[1] ?? introduced?.[1] ?? answer?.[1] ?? bundledName ?? selfIntroduction)
        .replace(/\s+(?:and|but|from|with)\b.*$/i, '').trim().replace(/[,.!?]+$/, '');
    if (!value || /\b(?:moving|from|phone|email|going|planning|looking)\b/i.test(value)) return null;
    return value.slice(0, 70);
}

const affirmative = (text: string) => /^(?:yes|yeah|yep|correct|that's right|that is right|you got it|exactly|right)(?=$|[\s,.!?;:])/i.test(text.trim())
    && !/\b(?:but|except|wrong|not|actually|no)\b/i.test(text);
const decline = (text: string) => /\b(?:do not|don't|no)\s+(?:contact|follow[- ]?up)(?:\s+with)?\s+me\b|\bno\s+follow[- ]?up\b|\b(?:do not|don't) want (?:you|anyone) to (?:call|email|contact|follow[- ]?up with) me\b/i.test(text);
const followUpRequest = (text: string) => /\b(?:please|could|can|would)\b.{0,70}\b(?:call|email|contact|follow[- ]?up|reach out)\b.{0,40}\b(?:me|us)\b|\b(?:call|email|contact|follow[- ]?up|reach out)\s+me\b/i.test(text)
    || /\b(?:could|can|would|will)\s+(?:someone|the team|mullins)\s+(?:please\s+)?(?:call|contact|email|reach out)(?:\s+me)?\b.{0,60}\b(?:estimate|quote|move|follow[- ]?up)\b/i.test(text)
    || /\b(?:i'm|i am|sure|yes)\b.{0,50}\b(?:leave|share|give)\s+(?:my|you)\s+(?:contact\s+)?(?:info|information|details)\b.{0,50}\b(?:follow[- ]?up|callback)\b/i.test(text);
const followUpQuestion = (text: string) => /\b(?:would|should|can|may|do)\b.{0,75}\b(?:call|email|contact|follow[- ]?up|reach out)\b.{0,40}\b(?:you|me)\b.*\?/i.test(text);

/** Agent speech can confirm a value, but can never supply the address itself. */
function scanGuestContact(turns: AmyTranscriptTurn[]) {
    let name: string | null = null;
    let phone: string | null = null;
    let email: string | null = null;
    let confirmedName = false;
    let confirmedPhone = false;
    let confirmedEmail = false;
    let requestedFollowUp = false;
    let recapDeclined = false;
    let previousAgent = '';
    let previousUserOfferedContact = false;
    let callbackWindow: string | null = null;

    for (const turn of turns.slice(0, 400)) {
        const text = String(turn.content ?? '').normalize('NFKC').replace(/[’]/g, "'").trim().slice(0, 4000);
        if (turn.role === 'agent') { previousAgent = text; previousUserOfferedContact = false; continue; }
        if (!text) continue;
        const offersContact = /\b(?:leave|share|give)\s+(?:my|you)\s+(?:contact\s+)?(?:info|information|details)\b/i.test(text);
        const volunteeredContact = offersContact || previousUserOfferedContact;
        previousUserOfferedContact = offersContact;
        const declinedAllContact = decline(text);
        const declinedEmailThisTurn = /\b(?:do not|don't)\s+(?:send\s+(?:me\s+)?(?:an?\s+)?(?:email|recap)|email\s+me)\b|\bno\s+(?:email|recap)\b/i.test(text);
        if (declinedAllContact) { requestedFollowUp = false; recapDeclined = true; phone = null; email = null; confirmedPhone = false; confirmedEmail = false; }
        else if (followUpRequest(text) || (followUpQuestion(previousAgent) && affirmative(text))) requestedFollowUp = true;
        if (declinedEmailThisTurn) { recapDeclined = true; email = null; confirmedEmail = false; }
        const emailCorrection = /\b(?:my\s+email\s+is\s+not|email\s+(?:is\s+)?(?:wrong|incorrect)|not\s+my\s+email|(?:don't|do\s+not)\s+use\s+(?:that|the|my)\s+email)\b/i.test(text);
        if (emailCorrection) { email = null; confirmedEmail = false; }
        if (/\b(?:remove|forget|delete|don't use|do not use)\s+my\s+(?:phone|number)\b/i.test(text)) { phone = null; confirmedPhone = false; }
        if (/\b(?:remove|forget|delete|don't use|do not use)\s+my\s+(?:email|e-mail)\b/i.test(text)) { email = null; confirmedEmail = false; }
        if (/\b(?:remove|forget|delete|don't use|do not use)\s+my\s+(?:full\s+)?name\b/i.test(text)) { name = null; confirmedName = false; }

        const suppliedName = nameIn(text, previousAgent, volunteeredContact);
        const suppliedPhone = /\b(?:my (?:phone|mobile|cell|callback|number)|(?:call|text|reach) me (?:at|on)|(?:phone|callback) number)\b/i.test(text)
            || (volunteeredContact && /\b(?:phone|callback)\s+(?:number\s+)?(?:is\s+)?(?=\+?\d)/i.test(text))
            || /\b(?:your|best|callback)\b.{0,35}\b(?:phone|number)\b.*\?/i.test(previousAgent)
            ? phoneIn(text) : null;
        const invitedContact = /\b(?:share|provide|give)\b.{0,70}\b(?:callback\s+number|phone\s+number|email)\b/i.test(previousAgent);
        const correctedEmailTail = emailCorrection
            ? text.match(/\b(?:it\s+is|it's|(?:please\s+)?use|the\s+correct\s+(?:email|address)\s+is)\s+(.+)/i)?.[1]
            : null;
        const suppliedEmail = emailCorrection ? (correctedEmailTail ? emailIn(correctedEmailTail) : null) : /\b(?:my (?:email|e-mail)|email me (?:at|on)|(?:email|e-mail) address)\b/i.test(text)
            || (invitedContact && /\b(?:email|e-mail)\s+(?:address\s+)?(?:is\s+)?[\w.+-]+@/i.test(text))
            || (volunteeredContact && /\b(?:email|e-mail)\s+(?:address\s+)?(?:is\s+)?[\w.+-]+@/i.test(text))
            || (requestedFollowUp && suppliedPhone && /\b(?:email|e-mail)\s+(?:address\s+)?(?:is\s+)?[\w.+-]+@/i.test(text))
            || /\b(?:your|best)\b.{0,30}\b(?:email|e-mail)\b|\b(?:email|e-mail) address\b/i.test(previousAgent)
            ? emailIn(text) : null;
        if (suppliedName) { name = suppliedName; confirmedName = false; }
        if (suppliedPhone) { phone = suppliedPhone; confirmedPhone = false; }
        if (suppliedEmail && !declinedAllContact && !declinedEmailThisTurn) {
            email = suppliedEmail; confirmedEmail = false; recapDeclined = false;
        }
        if (/\b(?:wrong|incorrect|not right|isn't right|that's not)\b/i.test(text)) {
            if (phone && phoneIn(previousAgent) === phone) confirmedPhone = false;
            if (email && emailIn(previousAgent) === email) confirmedEmail = false;
        }
        if (affirmative(text)) {
            if (name && previousAgent.toLowerCase().includes(name.toLowerCase())) confirmedName = true;
            if (phone && phoneIn(previousAgent) === phone) confirmedPhone = true;
            if (email && emailIn(previousAgent) === email) confirmedEmail = true;
        }
        if (requestedFollowUp && /\b(?:tomorrow|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) {
            callbackWindow = text.match(/\b(?:tomorrow|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)?.[0] ?? null;
        }
        previousAgent = '';
    }
    return {
        displayName: confirmedName ? name : null,
        nameForReview: confirmedName ? null : name,
        phone: confirmedPhone ? phone : null,
        email: confirmedEmail ? email : null,
        ...(email && !confirmedEmail ? { emailForReview: email } : {}),
        requestedFollowUp,
        recapDeclined,
        callbackWindow,
    };
}

/** Sharing an email authorizes one recap; readback improves accuracy but is not another consent gate. */
export function extractEvanGuestRecapRecipient(turns: AmyTranscriptTurn[]): EvanGuestRecapRecipient | null {
    const contact = scanGuestContact(turns);
    const email = contact.email || contact.emailForReview;
    if (!email || contact.recapDeclined) return null;
    return {
        email,
        displayName: contact.displayName || contact.nameForReview || 'Visitor',
        confirmedByReadback: Boolean(contact.email),
    };
}

/** A later spoken refusal suppresses an earlier website recap choice. */
export function hasEvanRecapDecline(turns: AmyTranscriptTurn[]): boolean {
    return scanGuestContact(turns).recapDeclined;
}

/** A separate callback request still gates the internal phone-only demo brief. */
export function extractEvanConsentedGuestLead(turns: AmyTranscriptTurn[]): EvanGuestLead | null {
    const contact = scanGuestContact(turns);
    if (!contact.requestedFollowUp || (!contact.phone && !contact.email)) return null;
    return {
        displayName: contact.displayName,
        nameForReview: contact.nameForReview,
        phone: contact.phone,
        email: contact.email,
        ...(contact.emailForReview ? { emailForReview: contact.emailForReview } : {}),
        requestedFollowUp: true,
        callbackWindow: contact.callbackWindow,
    };
}
