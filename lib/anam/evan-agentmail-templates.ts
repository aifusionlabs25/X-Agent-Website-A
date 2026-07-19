import type { AmyTranscriptTurn } from './session-spine.ts';

export type EvanMovingIntake = {
    moveType: string[];
    originDestination: string[];
    timing: string[];
    propertyScope: string[];
    access: string[];
    inventory: string[];
    services: string[];
    walkthrough: string[];
    contactPreferences: string[];
    missing: string[];
};

const CONTACT = {
    phone: '(602) 943-8228',
    email: 'derrick@mullinsmoving.com',
    address: '4050 East Greenway Road, Suite 3, Phoenix, AZ 85032',
    website: 'https://www.mullins-moving.com/',
    evan: 'https://xagent.aifusionlabs.app/demo/evan',
};

const clean = (value: unknown, max = 1_500) =>
    String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max);

const escapeHtml = (value: unknown) => clean(value, 30_000)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function uniqueMatches(lines: string[], pattern: RegExp): string[] {
    return [...new Set(lines.filter(line => pattern.test(line)))].slice(0, 8);
}

export function redactEvanTranscript(turns: AmyTranscriptTurn[]): AmyTranscriptTurn[] {
    return turns.slice(0, 200).map(turn => ({
        role: turn.role,
        content: clean(turn.content, 2_000)
            .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[private contact]')
            .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, '[private contact]'),
    }));
}

export function buildEvanMovingIntake(turns: AmyTranscriptTurn[]): EvanMovingIntake {
    const lines = turns.filter(turn => turn.role === 'user').map(turn => clean(turn.content)).filter(Boolean);
    const intake = {
        moveType: uniqueMatches(lines, /\b(residential|commercial|office|apartment|condo|house|home|senior|military|local|long[- ]distance|labor[- ]only|pod|rental truck)\b/i),
        originDestination: uniqueMatches(lines, /\b(from|to|origin|destination|moving out|moving into|pickup|drop[- ]?off|phoenix|scottsdale|tempe|mesa|glendale|chandler|gilbert|arizona|az)\b/i),
        timing: uniqueMatches(lines, /\b(date|week|month|morning|afternoon|evening|deadline|flexible|urgent|as soon|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i),
        propertyScope: uniqueMatches(lines, /\b(studio|bedroom|bathroom|square feet|sq\.?\s*ft|story|stories|floor|house|home|apartment|condo|office|warehouse)\b/i),
        access: uniqueMatches(lines, /\b(stairs|elevator|loading dock|parking|long carry|gate|gated|access hours|hoa|coi|certificate of insurance|building|dock|alley)\b/i),
        inventory: uniqueMatches(lines, /\b(piano|safe|art|antique|fragile|glass|pool table|gun safe|appliance|furniture|boxes|inventory|high[- ]value|specialty|oversized)\b/i),
        services: uniqueMatches(lines, /\b(pack|packing|unpack|unpacking|crate|crating|storage|labor|white[- ]glove|disassembly|assembly|pod|rental truck)\b/i),
        walkthrough: uniqueMatches(lines, /\b(walk[- ]?through|virtual|video|in person|appointment|visit|facetime|zoom|teams|meet)\b/i),
        contactPreferences: uniqueMatches(lines, /\b(call|phone|text|email|morning|afternoon|evening|weekday|weekend|contact|reach me)\b/i),
    };
    const required: Array<[keyof typeof intake, string]> = [
        ['moveType', 'move type'], ['originDestination', 'origin and destination'],
        ['timing', 'move date or window'], ['propertyScope', 'property size and scope'],
        ['access', 'access, parking, stairs, elevator, or building requirements'],
        ['inventory', 'inventory and specialty/high-value items'],
        ['services', 'packing, storage, labor-only, or other service needs'],
        ['walkthrough', 'quote and in-person or virtual walkthrough preference'],
        ['contactPreferences', 'preferred follow-up method and time'],
    ];
    return { ...intake, missing: required.filter(([key]) => intake[key].length === 0).map(([, label]) => label) };
}

function capturedFacts(intake: EvanMovingIntake): string[] {
    const labels: Array<[keyof EvanMovingIntake, string]> = [
        ['moveType', 'Move type'], ['originDestination', 'Origin / destination'],
        ['timing', 'Timing'], ['propertyScope', 'Property / scope'],
        ['access', 'Access requirements'], ['inventory', 'Inventory / specialty'],
        ['services', 'Services'], ['walkthrough', 'Quote / walkthrough'],
        ['contactPreferences', 'Follow-up preference'],
    ];
    return labels.flatMap(([key, label]) => key !== 'missing' && intake[key].length
        ? [`${label}: ${intake[key].join(' | ')}`] : []);
}

function html(title: string, paragraphs: string[], bullets: string[]) {
    return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#171717;line-height:1.55"><h2>${escapeHtml(title)}</h2>${paragraphs.map(item => `<p>${escapeHtml(item)}</p>`).join('')}<ul>${bullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></body></html>`;
}

export function buildEvanEmailBundle(input: {
    displayName: string;
    verifiedEmail: string;
    externalSessionId: string;
    sessionStartedAt: string;
    sessionEndedAt: string;
    turns: AmyTranscriptTurn[];
}) {
    const name = clean(input.displayName, 120) || 'there';
    const turns = redactEvanTranscript(input.turns);
    const intake = buildEvanMovingIntake(turns);
    const facts = capturedFacts(intake);
    const timeline = turns.map(turn => `${turn.role === 'user' ? 'Visitor' : 'Evan'}: ${clean(turn.content, 2_000)}`);
    const visitorParagraphs = [
        `Hi ${name},`,
        'Thank you for speaking with Evan, the Mullins Moving virtual concierge. Here is a working recap of the move details you shared.',
        'The Mullins team will review these details and confirm anything still needed.',
        `Phone: ${CONTACT.phone}`, `Email: ${CONTACT.email}`, `Office: ${CONTACT.address}`,
        `Website: ${CONTACT.website}`, `Talk with Evan again: ${CONTACT.evan}`,
        'This message is a conversation summary, not a binding quote, booking, price, or availability confirmation.',
    ];
    const adminBullets = [
        `Session ID: ${clean(input.externalSessionId, 100)}`, `Started: ${input.sessionStartedAt}`,
        `Ended: ${input.sessionEndedAt}`, `Checked-in visitor: ${name}`,
        `Verified email: ${clean(input.verifiedEmail, 254)}`, `Transcript turns: ${turns.length}`,
        ...facts, ...timeline.map(line => `Transcript ? ${line}`),
    ];
    const salesBullets = [
        `Customer: ${name}`, `Verified email: ${clean(input.verifiedEmail, 254)}`, ...facts,
        `Still to confirm: ${intake.missing.length ? intake.missing.join('; ') : 'No standard intake gaps detected; verify all consequential details.'}`,
        ...timeline.map(line => `Conversation detail ? ${line}`),
    ];
    return {
        intake,
        visitor: {
            subject: 'Thank you for speaking with Evan at Mullins Moving',
            text: [...visitorParagraphs, ...facts.map(item => `- ${item}`)].join('\n\n'),
            html: html('Your Mullins Moving conversation summary', visitorParagraphs, facts),
        },
        admin: {
            subject: `Mullins admin session summary ? ${name}`,
            text: ['Mullins Admin Session Summary', ...adminBullets.map(item => `- ${item}`)].join('\n'),
            html: html('Mullins Admin Session Summary', ['Operational record from Evan. Contact details came from the secure website check-in.'], adminBullets),
        },
        sales: {
            subject: `Moving quote / walkthrough intake ? ${name}`,
            text: ['Mullins Sales Follow-up Brief', ...salesBullets.map(item => `- ${item}`)].join('\n'),
            html: html('Mullins Sales Follow-up Brief', ['Use this brief to prepare a moving quote or schedule an in-person or virtual pre-move walkthrough. Verify all consequential details directly with the customer.'], salesBullets),
        },
    };
}
