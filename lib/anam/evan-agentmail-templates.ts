import type { AmyTranscriptTurn } from './session-spine.ts';

export type EvanMovingIntake = {
    moveType: string[];
    originDestination: string[];
    timing: string[];
    propertyScope: string[];
    access: string[];
    inventory: string[];
    services: string[];
    customerCare: string[];
    quoteRequests: string[];
    coverageQuestions: string[];
    walkthrough: string[];
    contactPreferences: string[];
    unknowns: string[];
    missing: string[];
};

const CONTACT = {
    phone: '(602) 943-8228',
    email: 'derrick@mullinsmoving.com',
    address: '4050 East Greenway Road, Suite 3, Phoenix, AZ 85032',
    website: 'https://www.mullins-moving.com/',
    evan: 'https://xagent.aifusionlabs.app/demo/evan',
    calendly: 'https://calendly.com/aifusionlabs',
    logo: 'https://xagent.aifusionlabs.app/agents/thumbnails/Evan%20Mullins%20Moving%20logo.png',
};

const clean = (value: unknown, max = 1_500) =>
    String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max);

const escapeHtml = (value: unknown) => clean(value, 30_000)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const unique = (items: string[], max = 8) => [...new Set(items.map(item => clean(item, 360)).filter(Boolean))].slice(0, max);

function fragmentLines(lines: string[]): string[] {
    return unique(lines.flatMap(line => line
        .split(/(?<=[.!?])\s+|[,;]\s+|\s+(?:and|but|so|plus)\s+/i)
        .map(fragment => fragment
            .replace(/^(?:hi\s+evan|yes|also|and actually|all right|okay)[,.:;\s-]*/i, '')
            .trim())
        .filter(fragment => fragment.length >= 4)), 80);
}

function matching(fragments: string[], pattern: RegExp, max = 6): string[] {
    return unique(fragments.filter(fragment => pattern.test(fragment)), max);
}

function append(intake: string[], value: string) {
    if (value && !intake.includes(value)) intake.push(value);
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
    const fragments = fragmentLines(lines).map(fragment => fragment.replace(/^(?:plus|and|but|so|there(?:'s| is))\s+/i, '').trim());
    const moveType: string[] = [];
    if (lines.some(line => /\b(elderly|senior|walker|retirement)\b/i.test(line))) append(moveType, 'Senior move');
    if (lines.some(line => /\b(house|home|apartment|condo|residential)\b/i.test(line))) append(moveType, 'Residential move');
    if (lines.some(line => /\b(storage unit|multiple (?:stops|locations)|two (?:stops|locations))\b/i.test(line))) append(moveType, 'Multi-stop move');
    append(moveType, matching(fragments, /\b(commercial|office|military|long[- ]distance|labor[- ]only|pod|rental truck)\b/i, 1)[0] ?? '');

    const buckets = {
        originDestination: [] as string[], timing: [] as string[], access: [] as string[],
        inventory: [] as string[], services: [] as string[], customerCare: [] as string[],
        quoteRequests: [] as string[], coverageQuestions: [] as string[], walkthrough: [] as string[],
        contactPreferences: [] as string[], unknowns: [] as string[],
    };
    for (const fragment of fragments) {
        if (/\b(local dashboard is intentionally read-only|read-only nope|system prompt|skip_turn)\b/i.test(fragment)) continue;
        if (/\b(not sure|do not know|don't know|have to check|need to check|do not have|don't have|not captured|unknown|unsure)\b/i.test(fragment)) append(buckets.unknowns, fragment);
        else if (/\b(insured|insurance|coverage|valuation|liability|protection)\b/i.test(fragment)) append(buckets.coverageQuestions, fragment);
        else if (/\b(quote|ballpark|price|pricing|estimate|compare|competitor|rough number)\b/i.test(fragment)) append(buckets.quoteRequests, fragment);
        else if (/\b(call|phone|text|email|reach me|contact me|waiting for|expecting)\b/i.test(fragment)) append(buckets.contactPreferences, fragment);
        else if (/\b(walk[- ]?through|virtual|video|in person|appointment|visit|facetime|zoom|teams|meet)\b/i.test(fragment)) append(buckets.walkthrough, fragment);
        else if (/\b(by the \d{1,2}(?:st|nd|rd|th)?|within \d+|less than \d+|date|week|month|deadline|urgent|as soon|quickly|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(fragment)) append(buckets.timing, fragment);
        else if (/\b(elderly|senior|walker|wheelchair|mobility|stress|stressed|chaotic|smooth|quiet|medical|accessible|caregiver)\b/i.test(fragment)) append(buckets.customerCare, fragment);
        else if (/\b(stair|stairs|staircase|elevator|loading dock|parking|driveway|doorway|long carry|gate|gated|access|hoa|coi|certificate of insurance|building|dock|alley)\b/i.test(fragment)) append(buckets.access, fragment);
        else if (/\b(piano|safe|art|artwork|antique|fragile|glass|grandfather clock|pool table|gun safe|appliance|furniture|boxes|inventory|high[- ]value|specialty|oversized)\b/i.test(fragment)) append(buckets.inventory, fragment);
        else if (/\b(pack|packing|unpack|unpacking|crate|crating|labor|white[- ]glove|disassembly|assembly|pod|rental truck)\b/i.test(fragment)) append(buckets.services, fragment);
        else if (/\b(from|to|out of|into|origin|destination|pickup|drop[- ]?off|phoenix|scottsdale|tempe|mesa|glendale|chandler|gilbert|surprise|arizona|AZ)\b/i.test(fragment)) append(buckets.originDestination, fragment);
    }
    const propertyScope = unique([
        lines.some(line => /\b(house|home)\b/i.test(line)) ? 'House / home' : '',
        lines.some(line => /\b(apartment|condo)\b/i.test(line)) ? 'Apartment / condo' : '',
        lines.some(line => /\bstorage unit\b/i.test(line)) ? 'Storage unit' : '',
        ...matching(fragments, /\b(studio|\d+[- ]bedroom|bedroom|bathroom|square feet|sq\.?\s*ft|story|stories|floor|office|warehouse)\b/i, 4),
    ]);
    const intake: EvanMovingIntake = {
        moveType,
        originDestination: buckets.originDestination,
        timing: buckets.timing,
        propertyScope,
        access: buckets.access,
        inventory: buckets.inventory,
        services: buckets.services,
        customerCare: buckets.customerCare,
        quoteRequests: buckets.quoteRequests,
        coverageQuestions: buckets.coverageQuestions,
        walkthrough: buckets.walkthrough,
        contactPreferences: buckets.contactPreferences,
        unknowns: buckets.unknowns,
        missing: [],
    };

    const missing: string[] = [];
    if (!intake.timing.length) missing.push('exact move date or window');
    if (!intake.propertyScope.some(item => /bedroom|square feet|sq\.?\s*ft/i.test(item))) missing.push('home size / room count');
    if (!intake.inventory.length || intake.unknowns.some(item => /inventory/i.test(item))) missing.push('complete inventory and approximate volume');
    if (!intake.walkthrough.length) missing.push('virtual or in-person walkthrough preference');
    if (!intake.access.length) missing.push('access, parking, stairs, elevator, and building requirements');
    if (intake.unknowns.some(item => /access/i.test(item))) missing.push('storage-unit access details');
    missing.push('exact street addresses and destination access details');
    intake.missing = unique(missing, 8);
    return intake;
}

function findAuthorizedCallbackPhone(turns: AmyTranscriptTurn[]): string | null {
    for (const turn of turns) {
        if (turn.role !== 'user' || !/\b(call|phone|reach me|contact me)\b/i.test(turn.content)) continue;
        const match = clean(turn.content).match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
        if (match) return clean(match[0], 30);
    }
    return null;
}

function firstName(name: string): string {
    return clean(name, 120).split(/\s+/)[0] || 'there';
}

function displayDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not available';
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Phoenix', dateStyle: 'medium', timeStyle: 'short',
    }).format(date) + ' MST';
}

function duration(start: string, end: string): string {
    const milliseconds = new Date(end).getTime() - new Date(start).getTime();
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Not available';
    const totalSeconds = Math.round(milliseconds / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function listText(items: string[]): string {
    return items.length ? items.join('; ') : 'Not captured - confirm with customer';
}

function section(title: string, content: string): string {
    return `<tr><td style="padding:22px 30px 0"><h2 style="margin:0 0 10px;color:#13243a;font-size:18px;line-height:1.3">${escapeHtml(title)}</h2>${content}</td></tr>`;
}

function bullets(items: string[]): string {
    return `<ul style="margin:0;padding:0 0 0 20px;color:#27384d">${items.map(item => `<li style="margin:0 0 9px;padding-left:3px">${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function detailRows(rows: Array<[string, string]>): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows.map(([label, value]) => `<tr><td style="width:145px;padding:7px 12px 7px 0;border-bottom:1px solid #e6ebf0;color:#5b6878;font-size:13px;font-weight:700;vertical-align:top">${escapeHtml(label)}</td><td style="padding:7px 0;border-bottom:1px solid #e6ebf0;color:#1d2b3d;font-size:14px;vertical-align:top">${escapeHtml(value)}</td></tr>`).join('')}</table>`;
}

function button(label: string, href: string, secondary = false): string {
    const background = secondary ? '#ffffff' : '#ef6c22';
    const color = secondary ? '#17324f' : '#ffffff';
    const border = secondary ? '1px solid #bcc8d4' : '1px solid #ef6c22';
    return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:5px 8px 5px 0;padding:11px 17px;border:${border};border-radius:6px;background:${background};color:${color};font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(label)}</a>`;
}

function shell(input: { preheader: string; eyebrow: string; title: string; intro: string; rows: string; footer: string }) {
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f2f5f7;font-family:Arial,Helvetica,sans-serif;color:#1d2b3d;line-height:1.5"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f7"><tr><td align="center" style="padding:24px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #dce3e9;border-radius:10px;overflow:hidden"><tr><td style="padding:24px 30px;background:#13243a"><img src="${CONTACT.logo}" width="185" alt="Mullins Moving" style="display:block;max-width:185px;height:auto"><p style="margin:16px 0 5px;color:#f4a261;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${escapeHtml(input.eyebrow)}</p><h1 style="margin:0;color:#ffffff;font-size:27px;line-height:1.25">${escapeHtml(input.title)}</h1></td></tr><tr><td style="padding:24px 30px 0;color:#27384d;font-size:15px">${input.intro}</td></tr>${input.rows}<tr><td style="padding:24px 30px;background:#f7f9fb;color:#637083;font-size:12px;line-height:1.55">${input.footer}</td></tr></table></td></tr></table></body></html>`;
}

function recapBullets(intake: EvanMovingIntake): string[] {
    const items: string[] = [];
    if (intake.moveType.length) items.push(`Move: ${listText(intake.moveType)}`);
    if (intake.originDestination.length) items.push(`Locations and route: ${listText(intake.originDestination)}`);
    if (intake.timing.length) items.push(`Requested timing: ${listText(intake.timing)}`);
    if (intake.services.length || intake.inventory.length) items.push(`Services and special items: ${listText(unique([...intake.services, ...intake.inventory], 8))}`);
    if (intake.access.length) items.push(`Access: ${listText(intake.access)}`);
    if (intake.customerCare.length) items.push(`Customer-care priorities: ${listText(intake.customerCare)}`);
    if (intake.quoteRequests.length || intake.coverageQuestions.length) items.push(`Questions for the Mullins team: ${listText(unique([...intake.quoteRequests, ...intake.coverageQuestions], 6))}`);
    if (intake.unknowns.length) items.push(`Still to confirm: ${listText(intake.unknowns)}`);
    return items.length ? items.slice(0, 8) : ['The Mullins team will confirm your move details directly with you.'];
}

function transcriptAttachment(input: {
    externalSessionId: string; displayName: string; verifiedEmail: string;
    sessionStartedAt: string; sessionEndedAt: string; turns: AmyTranscriptTurn[];
}) {
    const transcript = [
        'EVAN / MULLINS MOVING - SANITIZED SESSION TRANSCRIPT',
        `Session ID: ${clean(input.externalSessionId, 100)}`,
        `Visitor: ${clean(input.displayName, 120)}`,
        `Verified check-in email: ${clean(input.verifiedEmail, 254)}`,
        `Started (Arizona): ${displayDate(input.sessionStartedAt)}`,
        `Ended (Arizona): ${displayDate(input.sessionEndedAt)}`,
        `Duration: ${duration(input.sessionStartedAt, input.sessionEndedAt)}`,
        '',
        'Spoken email addresses and phone numbers are redacted below. Use the verified check-in email and the authorized callback number in the admin/sales brief.',
        '',
        ...input.turns.map((turn, index) => `${String(index + 1).padStart(2, '0')}. ${turn.role === 'user' ? 'VISITOR' : 'EVAN'}: ${clean(turn.content, 2_000)}`),
        '',
    ].join('\n');
    const safeId = clean(input.externalSessionId, 100).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36) || 'session';
    return { filename: `evan-mullins-transcript-${safeId}.txt`, contentType: 'text/plain; charset=utf-8', content: transcript };
}

export function buildEvanEmailBundle(input: {
    displayName: string;
    verifiedEmail: string;
    externalSessionId: string;
    sessionStartedAt: string;
    sessionEndedAt: string;
    turns: AmyTranscriptTurn[];
}) {
    const name = clean(input.displayName, 120) || 'Visitor';
    const greetingName = firstName(name);
    const callbackPhone = findAuthorizedCallbackPhone(input.turns);
    const turns = redactEvanTranscript(input.turns);
    const intake = buildEvanMovingIntake(turns);
    const recap = recapBullets(intake);
    const sessionDuration = duration(input.sessionStartedAt, input.sessionEndedAt);
    const visitorTurns = turns.filter(turn => turn.role === 'user').length;
    const evanTurns = turns.length - visitorTurns;
    const questionCount = turns.filter(turn => turn.role === 'user')
        .reduce((total, turn) => total + (turn.content.match(/\?/g)?.length ?? 0), 0);
    const priorityFlags = unique([
        intake.timing.some(item => /urgent|quick|less than|by the/i.test(item)) ? 'Time-sensitive request' : '',
        intake.customerCare.length ? 'Senior / mobility care' : '',
        intake.originDestination.length >= 2 ? 'Multiple locations' : '',
        intake.inventory.length ? 'Specialty items' : '',
        intake.quoteRequests.length ? 'Quote requested' : '',
    ]);

    const visitorText = [
        `Hi ${greetingName},`, '',
        'Thank you for speaking with Evan, the Mullins Moving virtual concierge. Here is the working recap we captured:', '',
        ...recap.map(item => `- ${item}`), '',
        'What happens next',
        'A Mullins Moving team member will review your information, confirm anything still needed, and discuss next steps with you. Mullins staff - not Evan - will determine availability, prepare any quote, and explain valuation or coverage options.', '',
        `Schedule a video planning call: ${CONTACT.calendly}`,
        `Call: ${CONTACT.phone}`,
        `Email: ${CONTACT.email}`,
        `Office: ${CONTACT.address}`,
        `Website: ${CONTACT.website}`,
        `Talk with Evan again: ${CONTACT.evan}`, '',
        'Please reply to this email or call Mullins Moving if any detail above needs to be corrected.',
        'This recap is not a binding quote, estimate, booking, price, availability confirmation, or statement of insurance coverage.',
    ].join('\n');

    const visitorHtml = shell({
        preheader: `Your Mullins Moving conversation recap and next steps, ${greetingName}.`,
        eyebrow: 'Mullins Moving conversation recap',
        title: `Thank you, ${greetingName}`,
        intro: `<p style="margin:0 0 10px">Thank you for speaking with Evan, the Mullins Moving virtual concierge.</p><p style="margin:0">Here is the working recap we captured. Please reply or call us if anything needs to be corrected.</p>`,
        rows: [
            section('Move details we heard', bullets(recap)),
            section('What happens next', '<p style="margin:0;color:#27384d">A Mullins Moving team member will review your information, confirm anything still needed, and discuss next steps with you. <strong>Mullins staff - not Evan - will determine availability, prepare any quote, and explain valuation or coverage options.</strong></p>'),
            section('Plan the next conversation', `<p style="margin:0 0 10px;color:#27384d">Choose a video planning call, visit Mullins Moving, or speak with Evan again.</p>${button('Schedule a video call', CONTACT.calendly)}${button('Mullins Moving website', CONTACT.website, true)}${button('Talk with Evan again', CONTACT.evan, true)}`),
            section('Contact Mullins Moving', detailRows([
                ['Phone', CONTACT.phone], ['Email', CONTACT.email], ['Office', CONTACT.address],
            ])),
        ].join(''),
        footer: 'This email is a conversation recap. It is not a binding quote, estimate, booking, price, availability confirmation, or statement of insurance coverage.',
    });

    const salesSections: Array<[string, string[]]> = [
        ['Route / locations', intake.originDestination],
        ['Timing requested', intake.timing],
        ['Property / scope', intake.propertyScope],
        ['Services requested', intake.services],
        ['Specialty / high-care items', intake.inventory],
        ['Access considerations', intake.access],
        ['Senior-care priorities', intake.customerCare],
        ['Quote / comparison request', intake.quoteRequests],
        ['Valuation / coverage questions', intake.coverageQuestions],
        ['Walkthrough preference', intake.walkthrough],
    ];
    const salesText = [
        'MULLINS SALES - MOVE FOLLOW-UP BRIEF',
        `Priority: ${priorityFlags.join(' | ') || 'Standard follow-up'}`, '',
        `Customer: ${name}`,
        `Verified email: ${clean(input.verifiedEmail, 254)} (authoritative secure check-in address)`,
        `Authorized callback: ${callbackPhone ?? 'Not captured - use verified email'}`, '',
        ...salesSections.flatMap(([title, items]) => [title, ...((items.length ? items : ['Not captured - confirm with customer']).map(item => `- ${item}`)), '']),
        'Critical details to confirm before quoting', ...intake.missing.map(item => `- ${item}`), '',
        'Recommended rep action plan',
        '1. Contact the customer and acknowledge the time-sensitive, senior-care nature of the move.',
        '2. Confirm exact dates, all addresses, access restrictions, complete inventory, and service scope.',
        '3. Arrange a virtual or in-person pre-move walkthrough if needed.',
        '4. Explain valuation / coverage options for specialty items; do not characterize them as automatically fully insured.',
        '5. Mullins staff verifies feasibility and availability, then prepares and delivers the quote.', '',
        'No quote, booking, crew availability, finish-time guarantee, or coverage commitment was made by Evan.',
    ].join('\n');

    const salesRows = [
        section('Lead at a glance', detailRows([
            ['Priority flags', priorityFlags.join(' | ') || 'Standard follow-up'],
            ['Customer', name],
            ['Verified email', `${clean(input.verifiedEmail, 254)} (secure check-in; authoritative)`],
            ['Authorized callback', callbackPhone ?? 'Not captured - use verified email'],
        ])),
        ...salesSections.map(([title, items]) => section(title, bullets(items.length ? items : ['Not captured - confirm with customer']))),
        section('Critical details to confirm before quoting', bullets(intake.missing)),
        section('Recommended rep action plan', '<ol style="margin:0;padding:0 0 0 22px;color:#27384d"><li style="margin-bottom:9px">Contact the customer and acknowledge the time-sensitive, senior-care nature of the move.</li><li style="margin-bottom:9px">Confirm exact dates, all addresses, access restrictions, complete inventory, and service scope.</li><li style="margin-bottom:9px">Arrange a virtual or in-person pre-move walkthrough if needed.</li><li style="margin-bottom:9px">Explain valuation / coverage options for specialty items; do not characterize them as automatically fully insured.</li><li>Mullins staff verifies feasibility and availability, then prepares and delivers the quote.</li></ol>'),
    ].join('');

    const adminSummary = recap.slice(0, 5);
    const adminText = [
        'MULLINS ADMIN - EVAN SESSION SNAPSHOT', '',
        `Session ID: ${clean(input.externalSessionId, 100)}`,
        `Started: ${displayDate(input.sessionStartedAt)}`,
        `Ended: ${displayDate(input.sessionEndedAt)}`,
        `Duration: ${sessionDuration}`,
        `Visitor / Evan turns: ${visitorTurns} / ${evanTurns}`,
        `Visitor questions: ${questionCount}`,
        `Checked-in visitor: ${name}`,
        `Verified email: ${clean(input.verifiedEmail, 254)}`,
        `Authorized callback: ${callbackPhone ?? 'Not captured'}`,
        `Routing: Sales follow-up requested${intake.quoteRequests.length ? ' - quote discussion needed' : ''}`, '',
        'Quick operational summary', ...adminSummary.map(item => `- ${item}`), '',
        `Exceptions / missing data: ${intake.missing.join('; ')}`,
        'Transcript: Sanitized plain-text transcript attached. Spoken email addresses and phone numbers are redacted in the attachment.',
    ].join('\n');

    const adminHtml = shell({
        preheader: `Evan session ${clean(input.externalSessionId, 36)} - ${sessionDuration} - transcript attached.`,
        eyebrow: 'Internal operational record',
        title: 'Evan session snapshot',
        intro: '<p style="margin:0">Quick-glance session record for Mullins administration. The sanitized transcript is attached as a plain-text file rather than included in this email body.</p>',
        rows: [
            section('Session telemetry', detailRows([
                ['Session ID', clean(input.externalSessionId, 100)],
                ['Started', displayDate(input.sessionStartedAt)], ['Ended', displayDate(input.sessionEndedAt)],
                ['Duration', sessionDuration], ['Visitor / Evan turns', `${visitorTurns} / ${evanTurns}`],
                ['Visitor questions', String(questionCount)],
            ])),
            section('Identity and routing', detailRows([
                ['Visitor', name], ['Verified email', clean(input.verifiedEmail, 254)],
                ['Authorized callback', callbackPhone ?? 'Not captured'],
                ['Routing', `Sales follow-up requested${intake.quoteRequests.length ? ' - quote discussion needed' : ''}`],
            ])),
            section('Quick operational summary', bullets(adminSummary)),
            section('Exceptions / missing data', bullets(intake.missing)),
            section('Transcript record', '<p style="margin:0;color:#27384d"><strong>Attached:</strong> sanitized plain-text transcript. Spoken email addresses and phone numbers are redacted in the attachment; use the verified check-in contact fields above.</p>'),
        ].join(''),
        footer: 'Internal Mullins Moving operational record. Handle customer information according to company privacy and retention requirements.',
    });

    return {
        intake,
        visitor: {
            subject: 'Thank you for speaking with Evan at Mullins Moving',
            text: visitorText,
            html: visitorHtml,
        },
        admin: {
            subject: `[EVAN SESSION] ${name} - ${sessionDuration} - transcript attached`,
            text: adminText,
            html: adminHtml,
            attachments: [transcriptAttachment({ ...input, displayName: name, turns })],
        },
        sales: {
            subject: `[ACTION] Mullins move lead - ${name}`,
            text: salesText,
            html: shell({
                preheader: `${priorityFlags.join(', ') || 'New Mullins move lead'} - ${name}.`,
                eyebrow: 'Mullins sales action brief',
                title: `Prepare the next step for ${name}`,
                intro: '<p style="margin:0 0 10px">Use this distilled intake to make the customer follow-up specific and efficient.</p><p style="margin:0;padding:12px 14px;background:#fff4e8;border-left:4px solid #ef6c22"><strong>Boundary:</strong> Evan did not issue a quote or confirm booking, crew availability, finish time, or coverage. Mullins staff owns those decisions.</p>',
                rows: salesRows,
                footer: 'Internal Mullins Moving sales brief. Verify all consequential details directly with the customer before quoting, scheduling, or describing valuation / coverage.',
            }),
        },
    };
}
