import type { AmyTranscriptTurn } from './session-spine.ts';
import { buildEvanMovePlan } from './evan-move-planner.ts';

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
    const userTurns = turns
        .filter(turn => turn.role === 'user')
        .map(turn => ({ role: 'user' as const, content: clean(turn.content, 2_000) }))
        .filter(turn => Boolean(turn.content));
    const text = userTurns.map(turn => turn.content).join(' ');
    const plan = buildEvanMovePlan(userTurns);

    const routeStops = [...plan.stops];
    const cityPattern = '(Phoenix|Mesa|Chandler|Surprise|Scottsdale|Tempe|Gilbert|Glendale|Queen Creek|Peoria|Goodyear|Avondale|Buckeye)';
    const secondStopMatch = text.match(new RegExp('\\b' + cityPattern + '\\b[^.!?]{0,50}\\b(?:come|be)\\s+(?:the\\s+)?second stop\\b', 'i'));
    if (secondStopMatch) moveStopBefore(routeStops, secondStopMatch[1], routeStops[1]?.city ?? '');
    const beforeMatch = text.match(new RegExp('\\b' + cityPattern + '\\b[^.!?]{0,80}\\bbefore\\s+\\b' + cityPattern + '\\b', 'i'));
    if (beforeMatch) moveStopBefore(routeStops, beforeMatch[1], beforeMatch[2]);

    const moveType: string[] = [];
    if (/\b(elderly|senior|walker|wheelchair|retirement|assisted living)\b/i.test(text)) append(moveType, 'Senior move');
    if (/\b(house|home|apartment|condo|residential)\b/i.test(text)) append(moveType, 'Residential move');
    if (routeStops.length > 2 || /\bstorage unit\b/i.test(text)) append(moveType, 'Multi-stop move');
    if (/\b(commercial|office)\b/i.test(text)) append(moveType, 'Commercial move');
    if (/\b(long[- ]distance|out of state)\b/i.test(text)) append(moveType, 'Long-distance move');

    const timing: string[] = [];
    const relativeWindow = text.match(/\b(?:about|approximately|roughly)?\s*((?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+weeks?)\b/i)?.[1];
    const target = text.match(/\b(?:aiming for|target(?:ing)?|by|on)\s+(?:the\s+)?(\d{1,2})(st|nd|rd|th)?(?:\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december))?\b/i);
    const ordinal = target ? target[1] + (target[2] ?? ordinalSuffix(Number(target[1]))) : '';
    const targetLabel = target?.[3] ? ordinal + ' of ' + capitalize(target[3]) : ordinal ? ordinal + ' (month not confirmed)' : '';
    if (relativeWindow && targetLabel) append(timing, 'About ' + relativeWindow.toLowerCase() + '; target day: ' + targetLabel);
    else if (targetLabel) append(timing, 'Target day: ' + targetLabel);
    else if (relativeWindow) append(timing, 'About ' + relativeWindow.toLowerCase());
    else if (plan.timing) append(timing, capitalize(plan.timing));

    const kitchenPacking = /\b(?:full packing\b[^.!?]{0,35}\bkitchen\b|full kitchen packing)\b/i.test(text);
    const services = unique([
        kitchenPacking ? 'Full kitchen packing' : '',
        !kitchenPacking && /\bfull packing\b/i.test(text) ? 'Full packing' : '',
        !kitchenPacking && !/\bfull packing\b/i.test(text) && /\bpacking\b/i.test(text) ? 'Packing support' : '',
        /\bunpacking\b/i.test(text) ? 'Unpacking' : '',
        /\blabor[- ]only\b/i.test(text) ? 'Labor-only support' : '',
        /\bdisassembl(?:e|y|ing)\b/i.test(text) ? 'Furniture disassembly' : '',
    ]);
    const inventoryRules: Array<[RegExp, string]> = [
        [/\bsectional(?: sofa)?\b/i, 'Sectional'],
        [/\btreadmill\b/i, 'Treadmill'],
        [/\btool chest\b/i, 'Tool chest'],
        [/\blarge mirrors?\b/i, 'Large mirrors'],
        [/\bartwork\b|\bfine art\b/i, 'Artwork'],
        [/\bgrandfather clock\b/i, 'Grandfather clock'],
        [/\bpianos?\b/i, 'Piano'],
        [/\bantiques?\b|\bantique furniture\b/i, 'Antiques'],
        [/\bsafes?\b/i, 'Safe'],
        [/\bpool table\b/i, 'Pool table'],
    ];
    const inventory = unique(inventoryRules
        .filter(([pattern]) => pattern.test(text))
        .map(([, label]) => label));

    const origin = routeStops.find(stop => stop.kind === 'Origin')?.city ?? routeStops[0]?.city;
    const destination = [...routeStops].reverse().find(stop => stop.kind === 'Destination')?.city ?? routeStops.at(-1)?.city;
    const access = unique([
        /\bstairs?\b|\bstaircase\b/i.test(text) ? 'Stairs' + (origin ? ' at ' + origin + ' origin' : '') : '',
        /\bnarrow driveway\b/i.test(text) ? 'Narrow driveway' + (destination ? ' at ' + destination + ' destination' : '') : '',
        /\belevator\b/i.test(text) ? 'Elevator requirements' : '',
        /\bloading dock\b|\bloading window\b/i.test(text) ? 'Loading access requirements' : '',
        /\bparking\b/i.test(text) ? 'Parking constraints' : '',
    ]);
    const customerCare = unique(plan.carePriorities.filter(item => !/time-sensitive/i.test(item)));
    const quoteRequests = /\b(quote|ballpark|price|pricing|estimate|compare|competitor|rough number)\b/i.test(text)
        ? ['Quote requested']
        : [];
    const coverageQuestions = /\b(insured|insurance|coverage|valuation|liability|protection)\b/i.test(text)
        ? ['Valuation / coverage explanation requested']
        : [];
    const walkthrough = unique([
        /\bvirtual (?:walk[- ]?through|survey)\b/i.test(text) ? 'Virtual walkthrough requested' : '',
        /\bin[- ]person (?:walk[- ]?through|survey|estimate)\b/i.test(text) ? 'In-person walkthrough requested' : '',
    ]);
    const unknowns = unique([
        /\b(?:can't|cannot|do not|don't) (?:give|provide) exact addresses?\b/i.test(text)
            ? 'Exact street addresses not yet available'
            : '',
        /\bstorage(?: unit)?\b[^.!?]{0,80}\b(?:not sure|don't know|do not know|have to check|need to check|unknown)\b/i.test(text)
            ? 'Storage-unit access needs confirmation'
            : '',
        /\b(?:do not|don't) have (?:a )?(?:full|complete) inventory\b/i.test(text)
            ? 'Complete inventory / approximate volume needs confirmation'
            : '',
    ]);
    const propertyScope = unique([
        plan.propertyScope ? capitalize(plan.propertyScope) : '',
        /\bstorage unit\b/i.test(text) ? 'Storage unit stop' : '',
    ]);

    const intake: EvanMovingIntake = {
        moveType,
        originDestination: routeStops.length ? [routeStops.map(stop => stop.city).join(' \u2192 ')] : [],
        timing,
        propertyScope,
        access,
        inventory,
        services,
        customerCare,
        quoteRequests,
        coverageQuestions,
        walkthrough,
        contactPreferences: [],
        unknowns,
        missing: [],
    };

    const missing: string[] = [];
    if (!intake.timing.length) missing.push('exact move date or window');
    else if (intake.timing.some(item => /month not confirmed/i.test(item))) missing.push('month / year for the requested target day');
    if (!intake.propertyScope.some(item => /studio|bedroom|square feet|sq\.?\s*ft/i.test(item))) missing.push('home size / room count');
    if (!intake.inventory.length || intake.unknowns.some(item => /inventory|volume/i.test(item))) {
        missing.push('complete inventory and approximate volume');
    }
    if (!intake.access.length) missing.push('origin and destination access requirements');
    const storageAccessCaptured = /\bstorage unit\b[^.!?]{0,100}\b(stairs?|elevator|parking|driveway|gate|loading|ground floor|access)\b/i.test(text);
    if (/\bstorage unit\b/i.test(text) && !storageAccessCaptured) missing.push('storage-unit access details');
    const addressUnavailable = intake.unknowns.some(item => /street addresses/i.test(item));
    if (addressUnavailable || !/\b\d{1,6}\s+[A-Za-z0-9]/.test(text)) missing.push('exact street addresses');
    if (/\b(?:phone|contact number|reach me|call me)\b/i.test(text) && !findAuthorizedCallbackPhone(turns)) {
        missing.push('valid callback number if phone follow-up is preferred');
    }
    intake.missing = unique(missing, 8);
    return intake;
}

function moveStopBefore(
    stops: Array<{ city: string; kind: 'Origin' | 'Destination' | 'Additional stop' }>,
    earlierCity: string,
    laterCity: string,
) {
    const earlierIndex = stops.findIndex(stop => stop.city.toLowerCase() === earlierCity.toLowerCase());
    const laterIndex = stops.findIndex(stop => stop.city.toLowerCase() === laterCity.toLowerCase());
    if (earlierIndex < 0 || laterIndex < 0 || earlierIndex < laterIndex) return;
    const [earlier] = stops.splice(earlierIndex, 1);
    stops.splice(laterIndex, 0, earlier);
}

function ordinalSuffix(value: number): string {
    const remainder100 = value % 100;
    if (remainder100 >= 11 && remainder100 <= 13) return 'th';
    if (value % 10 === 1) return 'st';
    if (value % 10 === 2) return 'nd';
    if (value % 10 === 3) return 'rd';
    return 'th';
}

function capitalize(value: string): string {
    const normalized = clean(value, 160);
    return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : '';
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
        intake.timing.some(item => /urgent|less than|within \d+ days|as soon/i.test(item)) ? 'Time-sensitive request' : '',
        intake.customerCare.length ? 'Senior / mobility care' : '',
        intake.originDestination.some(item => item.split(' \u2192 ').length > 2) ? 'Multiple locations' : '',
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

    const salesSections = ([
        ['Services requested', intake.services],
        ['Specialty / high-care items', intake.inventory],
        ['Access considerations', intake.access],
        ['Customer-care priorities', intake.customerCare],
        ['Quote request', intake.quoteRequests],
        ['Valuation / coverage questions', intake.coverageQuestions],
        ['Walkthrough preference', intake.walkthrough],
    ] as Array<[string, string[]]>).filter(([, items]) => items.length > 0);
    const repActions = unique([
        callbackPhone
            ? 'Contact the customer at the authorized callback number.'
            : 'Contact the customer at the verified email address.',
        intake.missing.length ? 'Confirm: ' + intake.missing.join('; ') + '.' : '',
        intake.customerCare.length ? 'Plan around these customer-care priorities: ' + intake.customerCare.join('; ') + '.' : '',
        intake.inventory.length ? 'Review handling requirements for the listed specialty / high-care items.' : '',
        intake.coverageQuestions.length ? 'Explain applicable valuation / coverage options without implying automatic full insurance.' : '',
        intake.walkthrough.length ? 'Coordinate the requested walkthrough format after availability is confirmed.' : '',
        'After the open details are verified, Mullins staff determines feasibility and prepares any quote.',
    ], 8);
    const salesText = [
        'MULLINS SALES - MOVE FOLLOW-UP BRIEF',
        'Priority: ' + (priorityFlags.join(' | ') || 'Standard follow-up'), '',
        'Customer: ' + name,
        'Verified email: ' + clean(input.verifiedEmail, 254) + ' (authoritative secure check-in address)',
        'Authorized callback: ' + (callbackPhone ?? 'Not captured - use verified email'), '',
        'Move at a glance',
        '- Route: ' + listText(intake.originDestination),
        '- Timing: ' + listText(intake.timing),
        '- Property / scope: ' + listText(intake.propertyScope), '',
        ...salesSections.flatMap(([title, items]) => [title, ...items.map(item => '- ' + item), '']),
        ...(intake.missing.length
            ? ['Critical details to confirm before quoting', ...intake.missing.map(item => '- ' + item), '']
            : []),
        'Recommended rep action plan',
        ...repActions.map((item, index) => String(index + 1) + '. ' + item), '',
        'No quote, booking, crew availability, or finish-time guarantee was made by Evan.',
        ...(intake.coverageQuestions.length ? ['No valuation or coverage commitment was made by Evan.'] : []),
    ].join('\n');

    const atAGlanceRows: Array<[string, string]> = [
        ['Priority flags', priorityFlags.join(' | ') || 'Standard follow-up'],
        ['Customer', name],
        ['Verified email', clean(input.verifiedEmail, 254) + ' (secure check-in; authoritative)'],
        ['Authorized callback', callbackPhone ?? 'Not captured - use verified email'],
        ['Route', listText(intake.originDestination)],
        ['Timing', listText(intake.timing)],
        ['Property / scope', listText(intake.propertyScope)],
    ];
    const actionList = '<ol style="margin:0;padding:0 0 0 22px;color:#27384d">'
        + repActions.map(item => '<li style="margin-bottom:9px">' + escapeHtml(item) + '</li>').join('')
        + '</ol>';
    const salesRows = [
        section('Lead at a glance', detailRows(atAGlanceRows)),
        ...salesSections.map(([title, items]) => section(title, bullets(items))),
        ...(intake.missing.length ? [section('Critical details to confirm before quoting', bullets(intake.missing))] : []),
        section('Recommended rep action plan', actionList),
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
                intro: '<p style="margin:0 0 10px">Use this distilled intake to make the customer follow-up specific and efficient.</p><p style="margin:0;padding:12px 14px;background:#fff4e8;border-left:4px solid #ef6c22"><strong>Boundary:</strong> Evan did not issue a quote or confirm booking, crew availability, or finish time. Mullins staff owns those decisions.</p>',
                rows: salesRows,
                footer: 'Internal Mullins Moving sales brief. Verify all consequential details directly with the customer before quoting or scheduling.',
            }),
        },
    };
}
