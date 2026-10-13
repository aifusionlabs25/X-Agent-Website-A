export type JamesEmailTemplateInput = {
    sections: { title: string; items: { label: string; text: string }[] }[];
    sessionId: string;
    providerId?: string;
    providerStartedAt?: string;
    providerEndedAt: string;
    transcriptHash: string;
    snapshotHash: string;
    transcriptFilename: string;
    turnCount: number;
    generatedAt: string;
};
export type JamesEmailContent = { subject: string; text: string; html: string };
export type JamesEmailTemplates = {
    caller: JamesEmailContent;
    internal: JamesEmailContent;
    admin: JamesEmailContent;
};

const ZONE = 'America/Phoenix';
const DEMO = 'Knowles Law Firm demo · For demo purposes only. This message is not confirmation of representation or firm acceptance.';
const AI_NOTICE = 'James is an AI agent and can make mistakes. Please verify important information.';
const BODY = 'font-size:14px;line-height:23px;color:#48525a;';
const HEADING = "font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:28px;font-weight:400;";
const UNKNOWN = /^(?:not yet provided|not provided|not known by the visitor|visitor declined|not available|unknown|pending)[.!\s]*$/i;
type Row = { section: string; label: string; text: string };

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
function textBound(value: unknown, field: string, max: number, empty = false): asserts value is string {
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
        throw new Error(`Invalid or oversized James email ${field}`);
    }
}
function isoDate(value: string, field: string): Date {
    // Never interpret timezone-less input in the machine's local timezone.
    const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(value);
    if (!match || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid James email ${field}`);
    const [year, month, day] = match.slice(1).map(Number);
    const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw new Error(`Invalid James email ${field}`);
    return new Date(value);
}
function validate(input: JamesEmailTemplateInput): void {
    if (!input || typeof input !== 'object' || !Array.isArray(input.sections) || input.sections.length > 24) {
        throw new Error('Invalid or oversized James email sections');
    }
    let rows = 0;
    let sourceLength = 0;
    for (const section of input.sections) {
        if (!section || !Array.isArray(section.items)) throw new Error('Invalid James email section');
        textBound(section.title, 'section title', 160);
        sourceLength += section.title.length;
        rows += section.items.length;
        if (rows > 120) throw new Error('Oversized James email rows');
        for (const item of section.items) {
            if (!item) throw new Error('Invalid James email item');
            textBound(item.label, 'row label', 160);
            textBound(item.text, 'row text', 4_000, true);
            sourceLength += item.label.length + item.text.length;
        }
    }
    if (sourceLength > 24_000) throw new Error('Oversized James email source');
    for (const key of ['sessionId', 'transcriptHash', 'snapshotHash', 'transcriptFilename', 'providerEndedAt', 'generatedAt'] as const) {
        textBound(input[key], key, key === 'transcriptFilename' ? 240 : 180);
        if (/[\r\n]/u.test(input[key])) throw new Error(`Invalid James email ${key}`);
    }
    for (const key of ['providerId', 'providerStartedAt'] as const) {
        if (input[key] !== undefined) {
            textBound(input[key], key, 180, true);
            if (/[\r\n]/u.test(input[key])) throw new Error(`Invalid James email ${key}`);
        }
    }
    if (!Number.isSafeInteger(input.turnCount) || input.turnCount < 0 || input.turnCount > 1_000_000) {
        throw new Error('Invalid James email turn count');
    }
    isoDate(input.providerEndedAt, 'provider end timestamp');
    isoDate(input.generatedAt, 'generation timestamp');
    if (input.providerStartedAt) isoDate(input.providerStartedAt, 'provider start timestamp');
}
const known = (row: Row) => !!row.text.trim() && !UNKNOWN.test(row.text.trim());
const normalized = (value: string) => value.trim().toLocaleLowerCase('en-US');
function callerDetails(rows: Row[]): Row[] {
    // A compact selection of actual brief rows, not a second copy of the intake.
    const priority = ['Reason for contacting', 'Principal concern', 'Requested help',
        'Reported location', 'Incident / matter timing', 'Questions for attorney review',
        'Reported circumstances', 'Documents / evidence', 'Reported urgency'];
    const candidates = rows.filter(row => normalized(row.section) !== 'client' && known(row));
    const selected: Row[] = [];
    for (const label of priority) {
        for (const row of candidates.filter(row => normalized(row.label) === normalized(label))) {
            if (!selected.some(old => normalized(old.text) === normalized(row.text))) selected.push(row);
            if (selected.length === 5) return selected;
        }
    }
    for (const row of candidates) {
        if (!selected.some(old => normalized(old.text) === normalized(row.text))) selected.push(row);
        if (selected.length === 5) break;
    }
    return selected;
}
function clientName(rows: Row[]): string | undefined {
    const row = rows.find(row => normalized(row.section) === 'client'
        && normalized(row.label) === 'full name' && known(row));
    return row?.text;
}
function safeFirstName(name: string | undefined): string | undefined {
    if (!name || name.length > 100 || !/^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*(?: [\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*){0,5}$/u.test(name.trim())) return undefined;
    return name.trim().split(' ')[0];
}
function summary(rows: Row[]): string {
    const details = callerDetails(rows);
    const request = rows.find(row => normalized(row.section) !== 'client' && known(row)
        && normalized(row.label) === 'requested help');
    const chosen = details.slice(0, 1);
    const next = request && !chosen.some(row => normalized(row.text) === normalized(request.text))
        ? request : details[1];
    if (next) chosen.push(next);
    return chosen.length ? chosen.map(row => `${row.label}: ${row.text}`).join('\n')
        : 'No matter details were captured in the brief.';
}
const line = (row: Pick<Row, 'label' | 'text'>) => `${row.label}: ${row.text}`;
function bullets(rows: Pick<Row, 'label' | 'text'>[]): string {
    return '<ul style="margin:0;padding:0 0 0 19px;' + BODY + '">'
        + rows.map(row => `<li style="padding:4px 0;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;"><strong style="color:#253039;">${escapeHtml(row.label)}:</strong> ${escapeHtml(row.text)}</li>`).join('') + '</ul>';
}
function paragraph(value: string, style = BODY): string {
    return `<p style="margin:0;${style}overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;">${escapeHtml(value)}</p>`;
}
function h2(value: string): string {
    return `<h2 style="margin:25px 0 9px;${HEADING}">${escapeHtml(value)}</h2>`;
}
function card(content: string): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4efdf;border-left:3px solid #af8952;"><tr><td style="padding:21px 23px;">${content}</td></tr></table>`;
}
function metadataRows(items: { label: string; text: string }[]): string {
    return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:12px;line-height:20px;text-align:left;">'
        + items.map(item => `<tr><th scope="row" style="padding:9px 12px 9px 0;width:34%;font-weight:400;color:#6a6258;border-bottom:1px solid #e6e0d3;vertical-align:top;">${escapeHtml(item.label)}</th><td style="padding:9px 0;border-bottom:1px solid #e6e0d3;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;">${escapeHtml(item.text)}</td></tr>`).join('') + '</table>';
}
function shell(subject: string, preheader: string, eyebrow: string, headline: string, content: string, notice: string): string {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title>
<style>body{margin:0!important}table{border-collapse:collapse} @media(max-width:540px){.outer{padding:12px 8px!important}.pad{padding-left:24px!important;padding-right:24px!important}.headline{font-size:30px!important;line-height:36px!important}}</style></head>
<body style="margin:0;padding:0;background:#eae8e2;color:#253039;font-family:'Trebuchet MS',Verdana,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eae8e2;"><tr><td class="outer" align="center" style="padding:36px 16px;">
<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" class="email" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#fffdf7;border:1px solid #dcd7cc;">
<tr><td style="height:5px;background:#af8952;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="pad" style="padding:30px 40px;background:#172329;color:#fffdf7;"><p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:29px;line-height:32px;letter-spacing:1px;">KNOWLES</p><p style="margin:5px 0 0;color:#d8bf96;font-size:10px;line-height:16px;letter-spacing:3px;">LAW FIRM</p></td></tr>
<tr><td class="pad" style="padding:32px 40px 30px;"><p style="margin:0 0 13px;color:#715d40;font-size:10px;line-height:16px;font-weight:700;letter-spacing:1.6px;">${escapeHtml(eyebrow)}</p><h1 class="headline" style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:42px;font-weight:400;color:#172329;overflow-wrap:anywhere;">${escapeHtml(headline)}</h1>${content}</td></tr>
<tr><td class="pad" style="padding:21px 40px;border-top:1px solid #e1dacc;background:#f7f3e9;"><p style="margin:0;color:#253039;font-size:12px;line-height:19px;font-weight:700;">KNOWLES LAW FIRM</p><p style="margin:5px 0 0;color:#6a6258;font-size:12px;line-height:19px;">For demo purposes only.</p></td></tr>
<tr><td class="pad" style="padding:19px 40px 23px;font-size:11px;line-height:17px;color:#6a6258;"><p style="margin:0 0 7px;">${escapeHtml(notice)}</p><p style="margin:0;">${escapeHtml(DEMO)}</p></td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
function date(value: Date): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: 'long', day: 'numeric' }).format(value);
}
function timestamp(value: Date): string {
    return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(value);
}
function duration(start: Date | undefined, end: Date): string {
    if (!start || start.getTime() > end.getTime()) return 'Not available';
    const total = Math.floor((end.getTime() - start.getTime()) / 1_000);
    const hours = Math.floor(total / 3_600);
    const minutes = Math.floor((total % 3_600) / 60);
    const seconds = total % 60;
    return [[hours, 'hour'], [minutes, 'minute'], [seconds, 'second']]
        .filter(([amount], index) => !!amount || (index === 2 && total === 0))
        .map(([amount, unit]) => `${amount} ${unit}${amount === 1 ? '' : 's'}`).join(', ');
}
function searchTerms(rows: Row[]): string {
    // Whole, short phrases from non-contact rows; no guessed practice-area tags.
    const phrases: string[] = [];
    for (const row of rows) {
        if (normalized(row.section) === 'client' || !known(row) || row.text.length > 120
            || /@|\d{3}[-. ]?\d{3}[-. ]?\d{4}/u.test(row.text)) continue;
        if (!phrases.some(old => normalized(old) === normalized(row.text))) phrases.push(row.text);
        if (phrases.length === 6) break;
    }
    return phrases.length ? phrases.join(' · ') : 'No short matter phrases were captured.';
}
function finish(subject: string, text: string, html: string): JamesEmailContent {
    // Fail closed rather than send an incomplete brief or clipped HTML body.
    if (subject.length > 200 || /[\r\n]/u.test(subject) || text.length > 30_000 || html.length > 90_000) {
        throw new Error('Oversized James email output');
    }
    return { subject, text, html };
}

/** Pure rendering only. The caller must attach the named transcript and own
 * authorization, recipients, delivery, reservations and provider receipts. */
export function buildJamesEmailTemplates(input: JamesEmailTemplateInput): JamesEmailTemplates {
    validate(input);
    const rows: Row[] = input.sections.flatMap(section => section.items.map(item => ({ section: section.title, ...item })));
    const details = callerDetails(rows);
    const name = clientName(rows);
    const firstName = safeFirstName(name);
    const greeting = firstName ? `Thank you, ${firstName}.` : 'Thank you for speaking with James.';
    const ended = isoDate(input.providerEndedAt, 'provider end timestamp');
    const started = input.providerStartedAt ? isoDate(input.providerStartedAt, 'provider start timestamp') : undefined;
    const generated = isoDate(input.generatedAt, 'generation timestamp');
    const next = 'No appointment or response time has been confirmed. The firm would need to confirm whether it can assist and agree on next steps with you.';
    const callerSubject = 'Thank you for speaking with James | Your conversation recap';
    const callerNotice = `${AI_NOTICE} This recap is not legal advice or confirmation of representation.`;
    const recap = details.length ? bullets(details) : paragraph('No matter details were captured in the brief.');
    const callerText = ['KNOWLES LAW FIRM', greeting,
        'Thank you for speaking with me. Here is a short recap of what you shared, so the important details are easy to find.',
        'A few key details', details.length ? details.map(row => `• ${line(row)}`).join('\n') : 'No matter details were captured in the brief.',
        'What happens next', next, 'James\nAI intake assistant · Knowles Law Firm demo',
        'KNOWLES LAW FIRM\nFor demo purposes only.', callerNotice, DEMO].join('\n\n');
    const callerHtml = shell(callerSubject, 'Your conversation recap, key details, and next step to confirm.',
        `YOUR CONVERSATION RECAP / ${date(ended)}`, greeting,
        `<p style="margin:0 0 24px;${BODY}">Thank you for speaking with me. Here is a short recap of what you shared, so the important details are easy to find.</p>`
        + card(`<h2 style="margin:0 0 13px;${HEADING}">A few key details</h2>${recap}`)
        + h2('What happens next') + paragraph(next)
        + `<p style="margin:25px 0 3px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-style:italic;color:#172329;">James</p><p style="margin:0;font-size:12px;line-height:20px;color:#6a6258;">AI intake assistant · Knowles Law Firm demo</p>`, callerNotice);

    const internalSubject = 'James | Firm intake brief and transcript';
    const tldr = summary(rows);
    const review = 'For team review: Confirm the contact details, missing facts, and whether the firm can assist before making commitments.';
    const attachment = `Verified transcript attached: ${input.transcriptFilename} (${input.turnCount} turns).`;
    const internalNotice = `Visitor-reported information is unverified. ${AI_NOTICE} Verify the brief against the attached transcript before acting.`;
    const allSectionsText = input.sections.map(section => `${section.title}\n${section.items.map(item => `• ${line(item)}`).join('\n')}`).join('\n\n');
    const allSectionsHtml = input.sections.map(section => h2(section.title) + bullets(section.items)).join('');
    const internalText = ['KNOWLES LAW FIRM', name || 'New conversation', `TL;DR\n${tldr}`, allSectionsText,
        review, attachment, `Prepared by James · AI intake assistant\nReference ${input.sessionId}`, internalNotice, DEMO].join('\n\n');
    const internalHtml = shell(internalSubject, tldr, `INTAKE TEAM / ${date(ended)}`, name || 'New conversation',
        card('<p style="margin:0 0 8px;color:#70552c;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1px;">TL;DR</p>' + paragraph(tldr))
        + allSectionsHtml + `<p style="margin:20px 0 24px;padding:15px 0;border-top:1px solid #e6e0d3;border-bottom:1px solid #e6e0d3;${BODY}">${escapeHtml(review)}</p>`
        + card('<p style="margin:0 0 5px;color:#70552c;font-size:10px;line-height:16px;font-weight:700;letter-spacing:1px;">TRANSCRIPT · TXT</p>' + paragraph(attachment))
        + `<p style="margin:24px 0 0;font-size:12px;line-height:20px;color:#6a6258;overflow-wrap:anywhere;">Prepared by James · AI intake assistant<br>Reference ${escapeHtml(input.sessionId)}</p>`, internalNotice);

    const adminSubject = 'James | Conversation session record';
    const metadata = [
        { label: 'Date', text: date(ended) },
        { label: 'Provider started', text: started ? timestamp(started) : 'Not available' },
        { label: 'Provider ended', text: timestamp(ended) },
        { label: 'Timezone', text: 'America/Phoenix · UTC−07:00' },
        { label: 'Duration', text: duration(started, ended) },
        { label: 'Website session', text: input.sessionId },
        { label: 'Provider session', text: input.providerId || 'Not available' },
        { label: 'Transcript turns', text: String(input.turnCount) },
        { label: 'Transcript file', text: input.transcriptFilename },
        { label: 'Transcript hash', text: input.transcriptHash },
        { label: 'Brief snapshot hash', text: input.snapshotHash },
        { label: 'Record generated', text: timestamp(generated) },
    ];
    const terms = searchTerms(rows);
    const adminNotice = `Recordkeeping copy, not a legal compliance certification. ${AI_NOTICE} Apply the firm's approved access and retention policies.`;
    const adminText = ['KNOWLES LAW FIRM', 'The conversation, on record.', tldr, 'Session details',
        metadata.map(line).join('\n'), 'Search terms from the brief', terms, adminNotice, DEMO].join('\n\n');
    const adminHtml = shell(adminSubject, 'James session record: provider timing, source summary and record identifiers.',
        'ADMINISTRATION / RECORD COPY', 'The conversation, on record.',
        paragraph(tldr) + h2('Session details') + metadataRows(metadata)
        + h2('Search terms from the brief') + paragraph(terms), adminNotice);
    return {
        caller: finish(callerSubject, callerText, callerHtml),
        internal: finish(internalSubject, internalText, internalHtml),
        admin: finish(adminSubject, adminText, adminHtml),
    };
}
