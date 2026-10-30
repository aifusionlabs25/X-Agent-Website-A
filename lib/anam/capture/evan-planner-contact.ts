import { resolveEvanContactIdentities, extractEvanContactIntent, normalizeEvanContactEmail as contactEmail,
    normalizeEvanContactPhone as contactPhone } from './evan-contact-identity.ts';

/** Browser-only working notes. The server separately checks the final transcript before routing email. */
export type EvanPlannerCheckIn = { displayName?: string; email?: string };
export type EvanPlannerContactField = 'displayName' | 'phone' | 'email' | 'contactPreference' | 'callbackWindow';
export type EvanPlannerContact = {
    displayName: string;
    phone: string;
    phoneConfirmed: boolean;
    email: string;
    emailSource: 'check-in' | 'spoken' | null;
    spokenEmailConfirmed: boolean;
    proposedEmail: string;
    contactPreference: string;
    callbackWindow: string;
    hiddenFields: EvanPlannerContactField[];
};
type ContactTurn = { role: 'user' | 'agent'; content: string };

const clean = (value: string | undefined, max = 140) => (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * A deterministic view of explicitly supplied visitor details, recomputed from
 * this session's turns. Provider replies supply question context only, never data.
 * Keep this output in React memory; do not persist, log, or send it to a model.
 * A check-in email remains the recap destination; proposed spoken changes are
 * display notes and intentionally cannot alter that private delivery address.
 */
export function buildEvanPlannerContact(turns: ContactTurn[], checkIn: EvanPlannerCheckIn = {}): EvanPlannerContact {
    const checkInEmail = contactEmail(clean(checkIn.email, 254));
    const result: EvanPlannerContact = {
        displayName: clean(checkIn.displayName, 70), phone: '', phoneConfirmed: false,
        email: checkInEmail, emailSource: checkInEmail ? 'check-in' : null,
        spokenEmailConfirmed: false, proposedEmail: '', contactPreference: '', callbackWindow: '', hiddenFields: [],
    };
    let previousAgent = '';
    const identities = resolveEvanContactIdentities(turns);
    let checkInEmailHidden = false;
    const hide = (field: EvanPlannerContactField) => {
        result[field] = '';
        if (!result.hiddenFields.includes(field)) result.hiddenFields.push(field);
        if (field === 'email') {
            result.emailSource = null; result.proposedEmail = ''; result.spokenEmailConfirmed = false;
            // Suppress the check-in value for the remainder of this mounted
            // session, even if a different spoken address is supplied later.
            // This changes display only; server delivery authority is untouched.
            checkInEmailHidden = true;
        }
        if (field === 'phone') result.phoneConfirmed = false;
    };
    const show = (field: EvanPlannerContactField) => { result.hiddenFields = result.hiddenFields.filter(item => item !== field); };

    for (const [index, turn] of turns.entries()) {
        const text = clean(turn.content, 2000).replace(/[’]/g, "'");
        if (turn.role === 'agent') { previousAgent = text; continue; }
        if (!text) continue;
        const question = previousAgent;
        previousAgent = ''; // Confirmations still bind only to this exact readback.
        const confirmsReadback = /^(?:yes|yeah|yep|correct|that's right|that is right|that's correct|that is correct|you got it|exactly|right)(?:[,.! ]|$)/i.test(text)
            && !/\b(?:but|except|wrong|not|actually|no)\b/i.test(text);
        if (confirmsReadback) {
            if (result.phone && contactPhone(question) === result.phone) result.phoneConfirmed = true;
            const spokenEmail = result.proposedEmail || (result.emailSource === 'spoken' ? result.email : '');
            if (spokenEmail && contactEmail(question) === spokenEmail) result.spokenEmailConfirmed = true;
        }
        const askingAboutContact = /^(?:is|what|which|do\s+you|does|have\s+you|did\s+you)\b/i.test(text) && /\?/.test(text);
        const clearAll = /\b(?:remove|delete|clear|hide|forget)\s+(?:(?:all|my|the)\s+)*(?:contact\s+(?:details|information)|personal\s+(?:details|information))\b/i.exec(text);
        const removed = new Set<EvanPlannerContactField>();
        if (clearAll) {
            (['displayName', 'phone', 'email', 'contactPreference', 'callbackWindow'] as const).forEach(field => { hide(field); removed.add(field); });
        }
        for (const [field, label] of [['displayName', 'name'], ['phone', '(?:phone|number|callback number)'], ['email', '(?:email|e-mail|address)'], ['callbackWindow', '(?:callback window|callback time|best time)']] as const) {
            const removal = new RegExp(`\\b(?:remove|delete|clear|hide|forget|don'?t (?:show|display|keep|save)|do not (?:show|display|keep|save))\\s+(?:my\\s+|the\\s+)?${label}\\b`, 'i');
            const refusal = new RegExp(`\\b(?:don'?t want to (?:share|give)|won'?t (?:share|give)|prefer not to (?:share|give))\\s+(?:my\\s+)?${label}\\b`, 'i');
            if (removal.test(text) || refusal.test(text)) { hide(field); removed.add(field); }
        }

        const identity = identities[index];
        if (!removed.has('displayName') && !askingAboutContact && identity.name) {
            const greetingOnly = /^(?:hi|hello|hey)\s+Evan[,.!]/iu.test(text);
            if (!greetingOnly || !result.displayName) {
                result.displayName = identity.name.value.replace(/[’]/g, "'"); show('displayName');
            }
        }
        if (!removed.has('phone') && !askingAboutContact) {
            if (identity.rejected.includes('phone')) { result.phone = ''; result.phoneConfirmed = false; }
            if (identity.phone) {
                if (result.phone !== identity.phone.value) result.phoneConfirmed = false;
                result.phone = identity.phone.value; show('phone');
            }
        }
        if (!removed.has('email') && !askingAboutContact) {
            if (identity.rejected.includes('email')) {
                result.proposedEmail = ''; result.spokenEmailConfirmed = false;
                if (!checkInEmail || checkInEmailHidden) { result.email = ''; result.emailSource = null; }
            }
            const email = identity.email?.value;
            if (email) {
                const previousSpoken = result.proposedEmail || (result.emailSource === 'spoken' ? result.email : '');
                if (previousSpoken !== email) result.spokenEmailConfirmed = false;
                show('email');
                if (checkInEmail && !checkInEmailHidden && email !== checkInEmail) {
                    result.email = checkInEmail; result.emailSource = 'check-in'; result.proposedEmail = email;
                } else {
                    result.email = email; result.emailSource = checkInEmail && !checkInEmailHidden ? 'check-in' : 'spoken'; result.proposedEmail = '';
                }
            }
        }

        // Clearing displayed fields does not erase a later independent opt-out.
        // Earlier preferences cannot be revived by the clear operation itself.
        const intent = extractEvanContactIntent(clearAll ? text.slice(clearAll.index + clearAll[0].length) : text, question);
        if (intent.contactPreference) {
            result.contactPreference = intent.contactPreference.value;
            show('contactPreference');
            if (['Email', 'Email only', 'No phone calls', 'No follow-up requested'].includes(result.contactPreference)) result.callbackWindow = '';
        }
        if (!removed.has('callbackWindow') && !['Email', 'Email only', 'No phone calls', 'No follow-up requested'].includes(result.contactPreference)) {
            if (intent.callbackWindow) { result.callbackWindow = intent.callbackWindow.value; show('callbackWindow'); }
        }
    }
    return result;
}
