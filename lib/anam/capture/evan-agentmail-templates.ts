import type { AmyTranscriptTurn } from './session-spine.ts';
import { AMY_ANAM_MAX_TURN_CHARACTERS, normalizeAmyTranscript } from './session-spine.ts';
import { buildEvanMovePlan } from './evan-move-planner.ts';
import type { EvanGuestLead } from './evan-guest-lead.ts';
import { projectEvanCaptureContact, projectEvanCaptureIntake } from './evan-capture.ts';
import type { EvanCaptureRecord } from './evan-capture.ts';

export type EvanMovingIntake = {
    moveType: string[];
    originDestination: string[];
    timing: string[];
    propertyScope: string[];
    access: string[];
    inventory: string[];
    services: string[];
    packingPlan: string[];
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

// Bound inputs at capture/legacy normalization, not after multiple validated
// facts are joined for HTML. Clipping here would disagree with the text recap.
const escapeHtml = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const unique = (items: string[], max = 8) => [...new Set(items.map(item => clean(item, 360)).filter(Boolean))].slice(0, max);

// Capture has already validated a bounded record. Presentation must not apply
// the legacy parser's per-item clipping or list caps to its current facts.
const uniqueCaptured = (items: string[]) => [...new Set(items.filter(Boolean))];

function append(intake: string[], value: string) {
    if (value && !intake.includes(value)) intake.push(value);
}

export function redactEvanTranscript(turns: AmyTranscriptTurn[]): AmyTranscriptTurn[] {
    // Use the provider transcript's shared bounds, including late corrections.
    // Sanitize before formatting so contact near a turn's limit is not cut into
    // an unrecognizable, partially exposed fragment.
    const phoneToken = '(?:\\d|zero|oh|one|two|three|four|five|six|seven|eight|nine)';
    const spokenPhone = new RegExp(`(?<![\\p{L}\\d])(?:\\+?${phoneToken}[\\s,…().-]*){10,11}(?![\\s,…().-]*${phoneToken}\\b)`, 'giu');
    const spokenEmail = /\b(?:(?:[a-z0-9][\s,-]+){1,30}[a-z0-9]|[a-z0-9.!#$%&'*+/=?^_`{|}~-]+)\s+(?:at|@)\s+[a-z0-9-]+(?:\s+dot\s+[a-z0-9-]+|\.[a-z0-9-]+)+\b/gi;
    return normalizeAmyTranscript(turns).map(turn => ({
        role: turn.role,
        content: clean(turn.content, AMY_ANAM_MAX_TURN_CHARACTERS)
            .replace(spokenEmail, '[private contact]')
            .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[private contact]')
            .replace(spokenPhone, '[private contact]'),
    }));
}

const CAPTURE_UNAVAILABLE_NOTICE = 'The structured move summary is unavailable. No move facts are confirmed by this recap; the Mullins team must review the transcript and confirm the details directly with you.';

function unavailableCaptureIntake(): EvanMovingIntake {
    return { moveType: [], originDestination: [], timing: [], propertyScope: [], access: [], inventory: [],
        services: [], packingPlan: [], customerCare: [], quoteRequests: [], coverageQuestions: [], walkthrough: [],
        contactPreferences: [], unknowns: [CAPTURE_UNAVAILABLE_NOTICE], missing: ['Manual transcript review and customer confirmation are required.'] };
}

export function buildEvanMovingIntake(turns: AmyTranscriptTurn[]): EvanMovingIntake {
    const normalizedTurns = turns
        .map(turn => ({ role: turn.role, content: clean(turn.content, 2_000) }))
        .filter(turn => Boolean(turn.content));
    const userTurns = normalizedTurns
        .filter(turn => turn.role === 'user')
        .map(turn => ({ role: 'user' as const, content: turn.content }));
    const text = userTurns.map(turn => turn.content).join(' ');
    // Preserve adjacent readback/confirmation context. The shared planner still
    // requires visitor-grounded facts; agent speech alone cannot create a route.
    const plan = buildEvanMovePlan(normalizedTurns);
    const storageRequested = plan.services.includes('Storage stop');

    const routeStops = [...plan.stops];
    const cityPattern = '(Phoenix|Mesa|Chandler|Surprise|Scottsdale|Tempe|Gilbert|Glendale|Queen Creek|Peoria|Goodyear|Avondale|Buckeye)';
    const secondStopMatch = text.match(new RegExp('\\b' + cityPattern + '\\b[^.!?]{0,50}\\b(?:come|be)\\s+(?:the\\s+)?second stop\\b', 'i'));
    if (secondStopMatch) moveStopBefore(routeStops, secondStopMatch[1], routeStops[1]?.city ?? '');
    const beforeMatch = text.match(new RegExp('\\b' + cityPattern + '\\b[^.!?]{0,80}\\bbefore\\s+\\b' + cityPattern + '\\b', 'i'));
    if (beforeMatch) moveStopBefore(routeStops, beforeMatch[1], beforeMatch[2]);

    const moveType: string[] = [];
    if (/\b(elderly|senior|walker|wheelchair|retirement|assisted living)\b/i.test(text)) append(moveType, 'Senior move');
    if (/\b(house|home|apartment|condo|residential)\b/i.test(text)) append(moveType, 'Residential move');
    if (routeStops.length > 2 || storageRequested && /\bstorage unit\b/i.test(text)) append(moveType, 'Multi-stop move');
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
    const services = unique(plan.services
        .filter(service => ['Full packing', 'Packing support', 'Unpacking', 'Labor-only support', 'Furniture disassembly'].includes(service))
        .map(service => service === 'Full packing' && kitchenPacking ? 'Full kitchen packing' : service));
    const packingPlan = plan.packingPlan ? [plan.packingPlan] : [];
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
        ...plan.possibleStops.map(stop => `Possible ${stop.label || 'additional'} stop in ${stop.city} (not confirmed)`),
    ]);
    const propertyScope = unique([
        plan.propertyScope ? capitalize(plan.propertyScope) : '',
        storageRequested && /\bstorage unit\b/i.test(text) ? 'Storage unit stop' : '',
    ]);

    const intake: EvanMovingIntake = {
        moveType,
        originDestination: routeStops.length ? [routeStops.map(stop => stop.city).join(' \u2192 ')] : [],
        timing,
        propertyScope,
        access,
        inventory,
        services,
        packingPlan,
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
    if (storageRequested && /\bstorage unit\b/i.test(text) && !storageAccessCaptured) missing.push('storage-unit access details');
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

function recapBullets(intake: EvanMovingIntake, captureMode = false): string[] {
    const items: string[] = [];
    if (intake.moveType.length) items.push(`Move: ${listText(intake.moveType)}`);
    if (intake.originDestination.length) items.push(`Locations and route: ${listText(intake.originDestination)}`);
    if (intake.timing.length) items.push(`Requested timing: ${listText(intake.timing)}`);
    if (captureMode && intake.propertyScope.length) items.push(`Property / scope: ${listText(intake.propertyScope)}`);
    if (intake.services.length || intake.inventory.length || intake.packingPlan.length) items.push([
        intake.services.length || intake.inventory.length ? `${captureMode ? 'Services and move items' : 'Services and special items'}: ${listText(captureMode ? uniqueCaptured([...intake.services, ...intake.inventory]) : unique([...intake.services, ...intake.inventory], 8))}` : '',
        intake.packingPlan.length ? `Packing plan: ${listText(intake.packingPlan)}` : '',
    ].filter(Boolean).join('. '));
    if (intake.access.length) items.push(`Access: ${listText(intake.access)}`);
    if (intake.customerCare.length) items.push(`Customer-care priorities: ${listText(intake.customerCare)}`);
    if (intake.quoteRequests.length || intake.coverageQuestions.length) items.push(`Questions for the Mullins team: ${listText(captureMode ? uniqueCaptured([...intake.quoteRequests, ...intake.coverageQuestions]) : unique([...intake.quoteRequests, ...intake.coverageQuestions], 6))}`);
    if (intake.unknowns.length) items.push(`Still to confirm: ${listText(intake.unknowns)}`);
    if (captureMode && intake.contactPreferences.length) items.push(`Contact preferences shared: ${listText(intake.contactPreferences)}`);
    return items.length ? captureMode ? items : items.slice(0, 8) : ['The Mullins team will confirm your move details directly with you.'];
}

function transcriptAttachment(input: {
    externalSessionId: string; displayName: string; verifiedEmail: string;
    sessionStartedAt: string; sessionEndedAt: string; turns: AmyTranscriptTurn[]; captureMode?: boolean;
}) {
    const transcript = [
        'EVAN / MULLINS MOVING - SANITIZED SESSION TRANSCRIPT',
        `Session ID: ${clean(input.externalSessionId, 100)}`,
        `Visitor: ${clean(input.displayName, 120)}`,
        `Confirmed contact email: ${clean(input.verifiedEmail, 254)}`,
        `Started (Arizona): ${displayDate(input.sessionStartedAt)}`,
        `Ended (Arizona): ${displayDate(input.sessionEndedAt)}`,
        `Duration: ${duration(input.sessionStartedAt, input.sessionEndedAt)}`,
        '',
        input.captureMode
            ? 'Spoken email addresses and phone numbers are redacted below. The delivery email is separately authorized; any shared phone in the brief requires human verification and respect for contact preferences.'
            : 'Spoken email addresses and phone numbers are redacted below. Use the confirmed contact email and authorized callback number in the admin/sales brief.',
        '',
        ...input.turns.map((turn, index) => `${String(index + 1).padStart(2, '0')}. ${turn.role === 'user' ? 'VISITOR' : 'EVAN'}: ${clean(turn.content, AMY_ANAM_MAX_TURN_CHARACTERS)}`),
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
    emailSource?: 'check-in' | 'spoken' | 'spoken-readback';
    handoffStatus?: 'mullins-confirmed' | 'rehearsal' | 'unconfirmed';
    captureRecord?: EvanCaptureRecord;
    captureStatus?: 'ready' | 'unavailable';
}) {
    const captureUnavailable = input.captureStatus === 'unavailable' || input.captureStatus === 'ready' && !input.captureRecord;
    const captureMode = Boolean(input.captureRecord) || captureUnavailable;
    const capturedContact = input.captureRecord && !captureUnavailable
        ? projectEvanCaptureContact(input.captureRecord, { displayName: input.displayName, email: input.verifiedEmail }) : null;
    // Empty/removed captured names are intentional; do not fall back to a stale name.
    const name = clean(captureUnavailable ? '' : capturedContact ? capturedContact.displayName : input.displayName, 120) || 'Visitor';
    const greetingName = name === 'Visitor' ? 'there' : firstName(name);
    const emailSource = input.emailSource === 'spoken-readback'
        ? 'shared and read back during the conversation'
        : input.emailSource === 'spoken' ? 'shared during the conversation; verify spelling on follow-up' : 'secure website check-in';
    const nextStep = input.handoffStatus === 'mullins-confirmed'
        ? 'Your move brief has been sent to the Mullins Moving team. A team member will follow up within 24 to 48 hours to confirm details and discuss next steps. Mullins staff - not Evan - will determine availability, prepare any quote, and explain valuation or coverage options.'
        : input.handoffStatus === 'rehearsal'
            ? 'This is a rehearsal recap. The internal briefs went to AI Fusion Labs for demo review, not to Mullins Moving. No Mullins callback has been arranged. Contact Mullins Moving directly for an estimate.'
            : 'We could not confirm that Mullins Moving received the internal move brief. Please contact Mullins Moving directly to arrange an estimate. Mullins staff - not Evan - will determine availability, prepare any quote, and explain valuation or coverage options.';
    const callbackPhone = captureMode ? capturedContact?.phone || null : findAuthorizedCallbackPhone(input.turns);
    const callbackLabel = captureMode ? capturedContact?.phoneConfirmed
        ? 'Phone confirmed during call' : 'Phone shared (verify before follow-up)' : 'Authorized callback';
    const turns = redactEvanTranscript(input.turns);
    const intake = captureUnavailable ? unavailableCaptureIntake()
        : input.captureRecord ? projectEvanCaptureIntake(input.captureRecord) : buildEvanMovingIntake(turns);
    const recap = captureUnavailable ? [CAPTURE_UNAVAILABLE_NOTICE] : recapBullets(intake, captureMode);
    const sessionDuration = duration(input.sessionStartedAt, input.sessionEndedAt);
    const visitorTurns = turns.filter(turn => turn.role === 'user').length;
    const evanTurns = turns.length - visitorTurns;
    const questionCount = turns.filter(turn => turn.role === 'user')
        .reduce((total, turn) => total + (turn.content.match(/\?/g)?.length ?? 0), 0);
    const priorityFlags = unique([
        intake.timing.some(item => /urgent|less than|within \d+ days|as soon/i.test(item)) ? 'Time-sensitive request' : '',
        intake.customerCare.length ? captureMode ? 'Care priorities shared' : 'Senior / mobility care' : '',
        intake.originDestination.some(item => item.split(' \u2192 ').length > 2) ? 'Multiple locations' : '',
        intake.inventory.length ? captureMode ? 'Move items shared' : 'Specialty items' : '',
        intake.quoteRequests.length ? captureMode ? 'Visitor questions' : 'Quote requested' : '',
        captureUnavailable ? 'Manual transcript review required' : '',
    ]);

    const visitorText = [
        `Hi ${greetingName},`, '',
        'Thank you for speaking with Evan, the Mullins Moving virtual concierge. Here is the working recap we captured:', '',
        ...recap.map(item => `- ${item}`), '',
        'What happens next',
        nextStep, '',
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
            section('What happens next', `<p style="margin:0;color:#27384d">${escapeHtml(nextStep)}</p>`),
            section('Plan the next conversation', `<p style="margin:0 0 10px;color:#27384d">Choose a video planning call, visit Mullins Moving, or speak with Evan again.</p>${button('Schedule a video call', CONTACT.calendly)}${button('Mullins Moving website', CONTACT.website, true)}${button('Talk with Evan again', CONTACT.evan, true)}`),
            section('Contact Mullins Moving', detailRows([
                ['Phone', CONTACT.phone], ['Email', CONTACT.email], ['Office', CONTACT.address],
            ])),
        ].join(''),
        footer: 'This email is a conversation recap. It is not a binding quote, estimate, booking, price, availability confirmation, or statement of insurance coverage.',
    });

    const salesSections = ([
        ['Services requested', intake.services],
        ['Packing plan', intake.packingPlan],
        [captureMode ? 'Move items mentioned' : 'Specialty / high-care items', intake.inventory],
        ['Access considerations', intake.access],
        ['Customer-care priorities', intake.customerCare],
        [captureMode ? 'Visitor questions / requests' : 'Quote request', intake.quoteRequests],
        ['Valuation / coverage questions', intake.coverageQuestions],
        ['Walkthrough preference', intake.walkthrough],
        ['Details still to confirm', intake.unknowns],
        ...(captureMode ? [['Contact preferences shared', intake.contactPreferences]] : []),
    ] as Array<[string, string[]]>).filter(([, items]) => items.length > 0);
    const repActions = unique([
        'Contact this lead as soon as possible after receipt; the customer-facing follow-up window is 24 to 48 hours when Mullins delivery is confirmed.',
        captureMode ? 'Review the shared contact preferences and verify any phone number before follow-up; the delivery email is separately authorized.' : callbackPhone
            ? 'Contact the customer at the authorized callback number.'
            : 'Contact the customer at the verified email address.',
        intake.missing.length ? 'Confirm: ' + intake.missing.join('; ') + '.' : '',
        intake.customerCare.length ? 'Plan around these customer-care priorities: ' + intake.customerCare.join('; ') + '.' : '',
        intake.inventory.length ? captureMode ? 'Confirm the listed move items, quantities, and any handling requirements.' : 'Review handling requirements for the listed specialty / high-care items.' : '',
        intake.coverageQuestions.length ? 'Explain applicable valuation / coverage options without implying automatic full insurance.' : '',
        intake.walkthrough.length ? 'Coordinate the requested walkthrough format after availability is confirmed.' : '',
        'After the open details are verified, Mullins staff determines feasibility and prepares any quote.',
    ], 8);
    const salesText = [
        'MULLINS SALES - MOVE FOLLOW-UP BRIEF',
        'Priority: ' + (priorityFlags.join(' | ') || 'Standard follow-up'), '',
        'Customer: ' + name,
        'Contact email: ' + clean(input.verifiedEmail, 254) + ` (${emailSource})`,
        callbackLabel + ': ' + (callbackPhone ?? 'Not captured - use verified email'), '',
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
        ['Contact email', clean(input.verifiedEmail, 254) + ` (${emailSource})`],
        [callbackLabel, callbackPhone ?? 'Not captured - use verified email'],
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

    const adminSummary = captureMode ? recap : recap.slice(0, 5);
    const routingSuffix = intake.quoteRequests.length ? captureMode ? ' - visitor questions need review' : ' - quote discussion needed' : '';
    const adminText = [
        'MULLINS ADMIN - EVAN SESSION SNAPSHOT', '',
        `Session ID: ${clean(input.externalSessionId, 100)}`,
        `Started: ${displayDate(input.sessionStartedAt)}`,
        `Ended: ${displayDate(input.sessionEndedAt)}`,
        `Duration: ${sessionDuration}`,
        `Visitor / Evan turns: ${visitorTurns} / ${evanTurns}`,
        `Visitor questions: ${questionCount}`,
        `Visitor: ${name}`,
        `Contact email: ${clean(input.verifiedEmail, 254)} (${emailSource})`,
        `${callbackLabel}: ${callbackPhone ?? 'Not captured'}`,
        `Routing: Sales lead for prompt review${routingSuffix}`, '',
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
                ['Visitor', name], ['Contact email', clean(input.verifiedEmail, 254) + ` (${emailSource})`],
                [callbackLabel, callbackPhone ?? 'Not captured'],
                ['Routing', `Sales lead for prompt review${routingSuffix}`],
            ])),
            section('Quick operational summary', bullets(adminSummary)),
            section('Exceptions / missing data', bullets(intake.missing)),
            section('Transcript record', '<p style="margin:0;color:#27384d"><strong>Attached:</strong> sanitized plain-text transcript. Spoken email addresses and phone numbers are redacted in the attachment; verify the contact fields above on follow-up.</p>'),
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
            attachments: [transcriptAttachment({ ...input, displayName: name, turns, captureMode })],
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

/** One internal demo brief for a guest's explicitly requested follow-up. */
export function buildEvanGuestLeadBrief(input: {
    externalSessionId: string;
    lead: EvanGuestLead;
    turns: AmyTranscriptTurn[];
    captureRecord?: EvanCaptureRecord;
    captureStatus?: 'ready' | 'unavailable';
}) {
    const captureUnavailable = input.captureStatus === 'unavailable' || input.captureStatus === 'ready' && !input.captureRecord;
    const captureMode = Boolean(input.captureRecord) || captureUnavailable;
    const capturedContact = input.captureRecord && !captureUnavailable ? projectEvanCaptureContact(input.captureRecord) : null;
    const turns = redactEvanTranscript(input.turns);
    const intake = captureUnavailable ? unavailableCaptureIntake()
        : input.captureRecord ? projectEvanCaptureIntake(input.captureRecord) : buildEvanMovingIntake(turns);
    const route = intake.originDestination[0] || 'Not confirmed';
    const timing = intake.timing[0] || 'Not confirmed';
    const scope = intake.propertyScope[0] || 'Not confirmed';
    const fields: Array<[string, string]> = captureMode ? [
        ['Name shared, verify before follow-up', capturedContact?.displayName || 'Not captured'],
        [capturedContact?.phoneConfirmed ? 'Phone confirmed during call' : 'Phone shared, verify before follow-up', capturedContact?.phone || 'Not captured'],
        ['Email shared, verify before follow-up', capturedContact?.email || 'Not captured'],
        ['Preferred callback window', capturedContact?.callbackWindow || 'Not captured'],
        ['Contact preference', capturedContact?.contactPreference || 'Not captured'],
        ['Route', route], ['Timing', timing], ['Property / scope', scope],
    ] : [
        ['Name', input.lead.displayName || 'Not verbally confirmed'],
        ...(input.lead.nameForReview ? [['Name shared, needs confirmation', input.lead.nameForReview] as [string, string]] : []),
        ['Phone', input.lead.phone || 'Not verbally confirmed'],
        ['Email', input.lead.email || 'Not verbally confirmed'],
        ...(input.lead.emailForReview ? [['Email shared, needs confirmation', input.lead.emailForReview] as [string, string]] : []),
        ['Preferred callback window', input.lead.callbackWindow || 'Not confirmed'],
        ['Route', route], ['Timing', timing], ['Property / scope', scope],
    ];
    const name = captureMode ? capturedContact?.displayName || 'guest' : input.lead.displayName || 'guest';
    const captureRecap = captureUnavailable ? [CAPTURE_UNAVAILABLE_NOTICE] : recapBullets(intake, true);
    const contactBoundary = captureMode
        ? capturedContact?.phoneConfirmed
            ? 'The phone was read back and confirmed during this call. Other shared contact fields remain working notes. Respect the caller\'s contact preferences and verify uncertain details before use.'
            : 'Shared contact fields are working notes, not readback verification or permission to disregard the caller\'s contact preferences. A human must verify details before use.'
        : 'The primary phone and email fields contain only visitor-supplied details read back and confirmed during the call. Details marked for review were shared by the visitor but not read back and confirmed.';
    const id = clean(input.externalSessionId, 100).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36);
    return {
        subject: `[EVAN DEMO LEAD] Follow-up requested - ${name}`,
        text: [
            'EVAN DEMO / INTERNAL LEAD BRIEF',
            'This is a demo notification to AI Fusion Labs, not proof that Mullins Moving received it.',
            'The customer asked for follow-up. No callback, appointment, estimate, or email recap is scheduled by this message.',
            `Session: ${id}`, '',
            ...fields.map(([label, value]) => `${label}: ${value}`), '',
            ...(captureMode ? ['Working move record', ...captureRecap.map(item => `- ${item}`), ''] : []),
            contactBoundary,
            'Any missing or uncertain details must be confirmed by a human before use.',
        ].join('\n'),
        html: shell({
            preheader: 'Internal Evan demo lead requiring human review.',
            eyebrow: 'AI Fusion Labs demo notification',
            title: 'Evan follow-up request',
            intro: '<p style="margin:0">This is a demo notification to AI Fusion Labs, not proof that Mullins Moving received it. The customer asked for follow-up, but no callback, appointment, estimate, or email recap is scheduled by this message.</p>',
            rows: section('Visitor details and confirmation status', detailRows(fields))
                + (captureMode ? section('Working move record', bullets(captureRecap)) : '')
                + section('Review before action', `<p style="margin:0;color:#27384d">Session ${escapeHtml(id)}. ${captureMode ? escapeHtml(contactBoundary) : 'Primary phone and email fields contain only visitor-supplied, read-back details. Values marked for review were not read back and confirmed. A human must verify missing or uncertain details before use.'}</p>`),
            footer: 'Internal demo brief. Do not treat this as a customer recap, CRM record, booking, or Mullins team delivery receipt.',
        }),
        ...(captureMode ? { attachments: [transcriptAttachment({ externalSessionId: input.externalSessionId,
            displayName: name === 'guest' ? 'Visitor' : name, verifiedEmail: '', sessionStartedAt: '', sessionEndedAt: '', turns, captureMode: true })] } : {}),
    };
}
