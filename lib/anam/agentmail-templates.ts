import type { AmyTranscriptTurn } from './session-spine.ts';
import type { AmyWorkbenchFact, AmyWorkbenchModel } from './workbench-v2.ts';

export type AmyEmailContent = {
    subject: string;
    text: string;
    html: string;
};

export type AmyEmailBundle = {
    visitor: AmyEmailContent;
    admin: AmyEmailContent;
    intake: AmyEmailContent;
};

type TemplateInput = {
    displayName: string;
    verifiedEmail: string;
    externalSessionId: string;
    sessionStartedAt: string;
    generatedAt?: string;
    turns: AmyTranscriptTurn[];
    model: AmyWorkbenchModel;
};

const INSIGHT_NAVY = '#071425';
const INSIGHT_MAGENTA = '#ae0a46';
const EMAIL_ACTION_PATTERN = /\b(?:email|e-mail|follow[- ]?up|send (?:it|that|this)|pulse session|before (?:we )?(?:close|wrap)|wrap up)\b/i;

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function clean(value: unknown, max = 1_000): string {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[private contact]')
        .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, '[private contact]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function unique(values: Array<string | null | undefined>, limit = 8): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of values) {
        const normalized = clean(value, 500);
        if (!normalized || seen.has(normalized.toLowerCase())) continue;
        seen.add(normalized.toLowerCase());
        output.push(normalized);
        if (output.length >= limit) break;
    }
    return output;
}

function safeName(value: unknown): string {
    return String(value || 'there')
        .replace(/[^\p{L}\p{M}' -]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'there';
}

function validFact(fact: AmyWorkbenchFact): boolean {
    if (fact.section === 'Identity') return false;
    if (!clean(fact.value)) return false;
    if (
        ['Timing', 'Requested outputs'].includes(fact.section)
        && EMAIL_ACTION_PATTERN.test(fact.value)
    ) return false;
    return true;
}

function factValue(facts: AmyWorkbenchFact[], label: string): string {
    return clean(facts.find(fact => fact.label === label && validFact(fact))?.value);
}

function formatPhoenixDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.valueOf())) return 'Not available';
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Phoenix',
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date) + ' MST';
}

function formatElapsed(startIso: string, endIso: string): string {
    const start = new Date(startIso).valueOf();
    const end = new Date(endIso).valueOf();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'Not available';
    const seconds = Math.max(0, Math.round((end - start) / 1_000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function detailRow(label: string, value: string): string {
    if (!value) return '';
    return `<tr>
        <td style="padding:11px 13px;border-bottom:1px solid #e6e9ee;color:#657184;font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.08em;vertical-align:top;width:32%;">${escapeHtml(label)}</td>
        <td style="padding:11px 13px;border-bottom:1px solid #e6e9ee;color:#172033;font-size:14px;line-height:21px;font-weight:600;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`;
}

function bulletRows(items: string[]): string {
    return items.map(item => `<tr>
        <td style="width:18px;padding:5px 8px 5px 0;vertical-align:top;color:${INSIGHT_MAGENTA};font-size:17px;line-height:19px;">&#8226;</td>
        <td style="padding:5px 0;color:#2d3a4d;font-size:14px;line-height:21px;">${escapeHtml(item)}</td>
    </tr>`).join('');
}

function textSection(title: string, items: string[]): string[] {
    if (!items.length) return [];
    return [title, ...items.map(item => `- ${item}`), ''];
}

function shell(input: {
    preview: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    body: string;
    footer: string;
}): string {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:#edf0f4;font-family:Arial,Helvetica,sans-serif;color:#172033;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preview)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#edf0f4;">
<tr><td align="center" style="padding:30px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff;border:1px solid #dce1e8;box-shadow:0 16px 42px rgba(7,20,37,.12);">
<tr><td style="background:${INSIGHT_NAVY};padding:0;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="padding:27px 30px 25px;">
<div style="font-size:11px;line-height:16px;letter-spacing:.18em;text-transform:uppercase;color:#ffffff;font-weight:700;">${escapeHtml(input.eyebrow)}</div>
<div style="margin-top:11px;font-size:28px;line-height:34px;color:#ffffff;font-weight:700;">${escapeHtml(input.title)}</div>
<div style="margin-top:8px;font-size:14px;line-height:21px;color:#c7d0dc;">${escapeHtml(input.subtitle)}</div>
</td><td width="8" style="background:${INSIGHT_MAGENTA};font-size:0;line-height:0;">&nbsp;</td>
</tr></table></td></tr>
<tr><td style="padding:30px;">${input.body}</td></tr>
<tr><td style="padding:18px 30px;background:${INSIGHT_NAVY};color:#aeb9c8;font-size:11px;line-height:17px;">${input.footer}</td></tr>
</table></td></tr></table>
</body></html>`;
}

function transcriptSnapshot(turns: AmyTranscriptTurn[]): string[] {
    return turns
        .filter(turn => turn.role === 'user' || turn.role === 'agent')
        .map(turn => `${turn.role === 'user' ? 'Visitor' : 'Amy'}: ${clean(turn.content, 420)}`)
        .filter(line => line.length > 6)
        .slice(-16);
}

export function buildAmyEmailBundle(input: TemplateInput): AmyEmailBundle {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const name = safeName(input.displayName);
    const facts = input.model.facts.filter(validFact);
    const objectiveCandidate = clean(input.model.brief.objective, 700);
    const objective = objectiveCandidate && !EMAIL_ACTION_PATTERN.test(objectiveCandidate)
        ? objectiveCandidate
        : `${clean(input.model.lane, 120) || 'Technology planning'} discussion with Amy.`;
    const environment = factValue(facts, 'Technology context') || clean(input.model.brief.environment.join(' / '));
    const workloads = factValue(facts, 'Critical workloads');
    const guardrail = factValue(facts, 'Primary guardrail');
    const timing = factValue(facts, 'Timing');
    const organization = factValue(facts, 'Context');
    const scale = factValue(facts, 'Environment scale');
    const requestedOutput = factValue(facts, 'Requested output');
    const nextStep = clean(input.model.brief.nextStep, 600)
        || 'Review the confirmed scope with the appropriate Insight specialist and agree on the next decision gate.';
    const priorities = unique(
        input.model.brief.priorities.filter(priority => !EMAIL_ACTION_PATTERN.test(priority)),
        6,
    );
    const openQuestions = unique(input.model.brief.openQuestions, 6);
    const highlights = unique([
        environment ? `Technology context: ${environment}` : '',
        workloads ? `Critical workloads: ${workloads}` : '',
        guardrail ? `Primary guardrail: ${guardrail}` : '',
        timing ? `Project timing: ${timing}` : '',
        requestedOutput ? `Requested output: ${requestedOutput}` : '',
    ], 6);
    const elapsed = formatElapsed(input.sessionStartedAt, generatedAt);
    const started = formatPhoenixDate(input.sessionStartedAt);
    const generated = formatPhoenixDate(generatedAt);
    const transcript = transcriptSnapshot(input.turns);

    const visitorBody = `
<p style="margin:0;color:#172033;font-size:16px;line-height:25px;">Hi ${escapeHtml(name)},</p>
<p style="margin:14px 0 0;color:#435166;font-size:15px;line-height:24px;">Thank you for speaking with Amy. Your conversation has been organized into a concise working recap so you and the Insight team can continue from the same context.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;background:#f7f8fa;border-left:4px solid ${INSIGHT_MAGENTA};"><tr><td style="padding:18px 20px;">
<div style="font-size:11px;line-height:15px;letter-spacing:.12em;text-transform:uppercase;color:${INSIGHT_MAGENTA};font-weight:700;">Conversation objective</div>
<div style="margin-top:8px;color:#263548;font-size:15px;line-height:24px;">${escapeHtml(objective)}</div>
</td></tr></table>
${highlights.length ? `<div style="margin-top:28px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">What we heard</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:9px;">${bulletRows(highlights)}</table>` : ''}
<div style="margin-top:28px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Suggested next step</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:11px;background:#fff7fa;border:1px solid #f2cedc;"><tr><td style="padding:17px 19px;color:#5f2340;font-size:14px;line-height:22px;font-weight:600;">${escapeHtml(nextStep)}</td></tr></table>
<p style="margin:28px 0 0;color:#435166;font-size:14px;line-height:22px;">Reply to this email if you would like to correct the working recap, add context, or request human follow-up.</p>
<p style="margin:22px 0 0;color:#435166;font-size:14px;line-height:22px;">Best regards,<br><strong style="color:#172033;">Amy</strong><br>Insight Enterprise SDR</p>`;
    const visitorText = [
        `Hi ${name},`, '',
        'Thank you for speaking with Amy. Your conversation has been organized into a concise working recap.', '',
        `Conversation objective: ${objective}`, '',
        ...textSection('What we heard', highlights),
        `Suggested next step: ${nextStep}`, '',
        'Reply to this email if you would like to correct the working recap, add context, or request human follow-up.', '',
        'Best regards,', 'Amy', 'Insight Enterprise SDR', '',
        'Amy is an AI-powered conversational agent. This working recap is not a final design, quote, commitment, or compliance determination.',
    ].join('\n');

    const adminDetails = [
        detailRow('Session ID', input.externalSessionId),
        detailRow('Started', started),
        detailRow('Elapsed at email request', elapsed),
        detailRow('Email generated', generated),
        detailRow('Session state', 'Live when follow-up was requested'),
        detailRow('Visitor', name),
        detailRow('Verified contact', input.verifiedEmail),
        detailRow('Transcript turns captured', String(input.turns.length)),
    ].join('');
    const adminBody = `
<p style="margin:0;color:#435166;font-size:14px;line-height:22px;">Operational record generated when Amy completed the approved visitor follow-up action.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;border:1px solid #e1e6ec;border-collapse:collapse;">${adminDetails}</table>
<div style="margin-top:26px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Conversation summary</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background:#f7f8fa;border-left:4px solid ${INSIGHT_MAGENTA};"><tr><td style="padding:18px 20px;color:#263548;font-size:14px;line-height:22px;">${escapeHtml(objective)}</td></tr></table>
${highlights.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Key captured facts</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(highlights)}</table>` : ''}
<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Sanitized conversation timeline</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(transcript.length ? transcript : ['No transcript turns were available at email time.'])}</table>`;
    const adminText = [
        'AMY SESSION OPERATIONS RECORD', '',
        `Session ID: ${input.externalSessionId}`,
        `Started: ${started}`,
        `Elapsed at email request: ${elapsed}`,
        `Email generated: ${generated}`,
        `Visitor: ${name}`,
        `Verified contact: ${input.verifiedEmail}`,
        `Transcript turns captured: ${input.turns.length}`, '',
        `Conversation summary: ${objective}`, '',
        ...textSection('Key captured facts', highlights),
        ...textSection('Sanitized conversation timeline', transcript),
        'Internal AI Fusion Labs operational record. Contact details came from the secure website check-in, not speech recognition.',
    ].join('\n');

    const intakeContext = unique([
        organization ? `Organization context: ${organization}` : '',
        scale ? `Environment scale: ${scale}` : '',
        ...highlights,
    ], 8);
    const intakeBody = `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e1e6ec;border-collapse:collapse;">
${detailRow('Contact', name)}${detailRow('Verified email', input.verifiedEmail)}${detailRow('Opportunity lane', clean(input.model.lane, 150))}${detailRow('Session ID', input.externalSessionId)}
</table>
<div style="margin-top:26px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Opportunity snapshot</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background:#f7f8fa;border-left:4px solid ${INSIGHT_MAGENTA};"><tr><td style="padding:18px 20px;color:#263548;font-size:14px;line-height:22px;">${escapeHtml(objective)}</td></tr></table>
${intakeContext.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Scope and operating context</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(intakeContext)}</table>` : ''}
${priorities.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Priorities and guardrails</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(priorities)}</table>` : ''}
<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Recommended action</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background:#fff7fa;border:1px solid #f2cedc;"><tr><td style="padding:17px 19px;color:#5f2340;font-size:14px;line-height:22px;font-weight:600;">${escapeHtml(nextStep)}</td></tr></table>
${openQuestions.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Qualification gaps for the team</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(openQuestions)}</table>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:27px;background:#fff8e7;border:1px solid #efd79b;"><tr><td style="padding:16px 18px;color:#6b4b09;font-size:13px;line-height:21px;">Internal planning input only. Validate scope, ownership, contract eligibility, compliance, pricing, availability, and timing before making a customer commitment.</td></tr></table>`;
    const intakeText = [
        'INSIGHT SALES & OPERATIONS INTAKE', '',
        `Contact: ${name}`,
        `Verified email: ${input.verifiedEmail}`,
        `Opportunity lane: ${clean(input.model.lane, 150)}`,
        `Session ID: ${input.externalSessionId}`, '',
        `Opportunity snapshot: ${objective}`, '',
        ...textSection('Scope and operating context', intakeContext),
        ...textSection('Priorities and guardrails', priorities),
        `Recommended action: ${nextStep}`, '',
        ...textSection('Qualification gaps for the team', openQuestions),
        'Internal planning input only. Validate scope, ownership, contract eligibility, compliance, pricing, availability, and timing before making a customer commitment.',
    ].join('\n');

    const subjectContext = clean(input.model.lane, 90) || 'Technology planning';
    return {
        visitor: {
            subject: `${subjectContext} | Your conversation with Amy`,
            text: visitorText,
            html: shell({
                preview: `Your ${subjectContext.toLowerCase()} conversation with Amy, organized with a practical next step.`,
                eyebrow: 'Insight · Conversation follow-up',
                title: 'Your conversation, clearly captured.',
                subtitle: 'A concise working recap and a practical path forward.',
                body: visitorBody,
                footer: 'Amy is an AI-powered conversational agent. This working recap is not a final design, quote, commitment, or compliance determination.',
            }),
        },
        admin: {
            subject: `[AMY SESSION] ${name} · ${subjectContext} · ${elapsed}`,
            text: adminText,
            html: shell({
                preview: `Amy session record for ${name}: ${subjectContext}.`,
                eyebrow: 'AI Fusion Labs · Admin only',
                title: 'Amy session operations record',
                subtitle: 'Session timing, delivery context, and a sanitized conversation record.',
                body: adminBody,
                footer: 'Internal AI Fusion Labs operational record. The verified contact came from the secure website check-in and was not reconstructed from speech.',
            }),
        },
        intake: {
            subject: `[INSIGHT INTAKE] ${subjectContext} · ${name}`,
            text: intakeText,
            html: shell({
                preview: `Sales and operations intake for ${name}: ${subjectContext}.`,
                eyebrow: 'Insight · Sales & Operations',
                title: 'Opportunity intake brief',
                subtitle: 'Structured conversation intelligence for review, planning, and responsible next steps.',
                body: intakeBody,
                footer: 'Internal Insight planning brief. Validate all commercial, technical, compliance, availability, and scheduling details before external use.',
            }),
        },
    };
}
