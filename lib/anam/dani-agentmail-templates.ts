import type { AmyTranscriptTurn } from './session-spine.ts';

export type DaniEmailContent = {
    subject: string;
    text: string;
    html: string;
};

export type DaniEmailBundle = {
    visitor: DaniEmailContent;
    admin: DaniEmailContent;
    summary: DaniEmailContent;
};

type TemplateInput = {
    displayName: string;
    verifiedEmail: string;
    externalSessionId: string;
    sessionStartedAt: string;
    sessionEndedAt: string;
    generatedAt?: string;
    turns: AmyTranscriptTurn[];
};

const NAVY = '#111827';
const INDIGO = '#4f46e5';
const CYAN = '#0891b2';
const REJOIN_URL = 'https://xagent.aifusionlabs.app/demo/dani';
const CONTACT_PATTERN = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g;
const SECRET_TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{12,}|(?:gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/gi;
const LABELED_SECRET_PATTERN = /\b(api[ -]?key|password|secret|access[ -]?token|bearer token)\b\s*(?:is|=|:)\s*[^\s,;]+/gi;
const SENSITIVE_ID_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

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
        .replace(CONTACT_PATTERN, '[private contact]')
        .replace(LABELED_SECRET_PATTERN, '$1: [private secret]')
        .replace(SECRET_TOKEN_PATTERN, '[private secret]')
        .replace(SENSITIVE_ID_PATTERN, '[private identifier]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function safeName(value: unknown): string {
    return String(value || 'there')
        .normalize('NFKC')
        .replace(/[^\p{L}\p{M}' -]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'there';
}

function firstName(value: unknown): string {
    const name = safeName(value);
    return name === 'there' ? name : name.split(' ')[0]?.slice(0, 40) || 'there';
}

function unique(values: Array<string | null | undefined>, limit = 8): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const candidate of values) {
        const value = clean(candidate, 600);
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        output.push(value);
        if (output.length >= limit) break;
    }
    return output;
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
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'Not available';
    const seconds = Math.max(0, Math.round((end - start) / 1_000));
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function bulletRows(items: string[]): string {
    return items.map(item => `<tr>
        <td style="width:18px;padding:5px 8px 5px 0;vertical-align:top;color:${INDIGO};font-size:17px;line-height:19px;">&#8226;</td>
        <td style="padding:5px 0;color:#334155;font-size:14px;line-height:21px;">${escapeHtml(item)}</td>
    </tr>`).join('');
}

function detailRow(label: string, value: string): string {
    return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.08em;vertical-align:top;width:32%;">${escapeHtml(label)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#172033;font-size:14px;line-height:21px;font-weight:600;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`;
}

function textSection(title: string, items: string[]): string[] {
    return items.length ? [title, ...items.map(item => `- ${item}`), ''] : [];
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#172033;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preview)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef2f7;"><tr><td align="center" style="padding:30px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#fff;border:1px solid #dbe3ee;box-shadow:0 16px 42px rgba(15,23,42,.12);">
<tr><td style="background:${NAVY};padding:27px 30px 25px;border-right:8px solid ${CYAN};">
<div style="font-size:11px;line-height:16px;letter-spacing:.18em;text-transform:uppercase;color:#a5b4fc;font-weight:700;">${escapeHtml(input.eyebrow)}</div>
<div style="margin-top:11px;font-size:28px;line-height:34px;color:#fff;font-weight:700;">${escapeHtml(input.title)}</div>
<div style="margin-top:8px;font-size:14px;line-height:21px;color:#cbd5e1;">${escapeHtml(input.subtitle)}</div>
</td></tr><tr><td style="padding:30px;">${input.body}</td></tr>
<tr><td style="padding:18px 30px;background:${NAVY};color:#94a3b8;font-size:11px;line-height:17px;">${input.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function solutionPatterns(text: string): string[] {
    const patterns: Array<[RegExp, string]> = [
        [/avatar|conversation|voice|website|visitor|lead|intake|concierge|customer service|x agent/i, 'Role-specific conversational X Agent'],
        [/research|competitive|competitor|report|monitor|market|source|citation/i, 'AI-assisted research, monitoring, or reporting'],
        [/knowledge|documents?|search|retrieval|policy|manual|faq/i, 'Knowledge and retrieval experience'],
        [/workflow|automat|handoff|routing|operations|repetitive|process/i, 'Workflow automation and orchestration'],
        [/api|integration|crm|database|calendar|ticket|webhook/i, 'Systems integration or data workflow'],
        [/copilot|internal|decision|analysis|summar|brief|assistant/i, 'Internal copilot or decision-support workflow'],
    ];
    return unique(patterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => label), 6);
}

function buildBrief(turns: AmyTranscriptTurn[]) {
    const userTurns = turns
        .filter(turn => turn.role === 'user')
        .map(turn => clean(turn.content, 650))
        .filter(value => value.length >= 12 && !/^(?:yes|no|okay|ok|right|thanks?|thank you|goodbye)$/i.test(value));
    const combined = userTurns.join(' ');
    const objective = userTurns[0] || 'The visitor explored where practical AI could improve a business workflow.';
    const highlights = unique(userTurns, 6);
    const questions = unique(userTurns.filter(value => /\?|^(?:how|what|why|when|where|which|can|could|would|is|are|do|does)\b/i.test(value)), 6);
    const commitments = unique(userTurns.filter(value => /\b(?:i|we)\s+(?:will|can|plan to|need to|want to)|\b(?:agreed|decided|next step|follow up)\b/i.test(value)), 5);
    const patterns = solutionPatterns(combined);
    const validation = unique([
        'Confirm the business decision or workflow outcome the solution must improve.',
        'Identify the approved data sources, systems, permissions, and human review points.',
        'Choose one baseline metric and a bounded evaluation before making an ROI or deployment claim.',
        patterns.length ? `Validate whether the strongest current solution pattern is: ${patterns[0]}.` : 'Compare the smallest useful AI solution with the current non-AI process.',
    ], 4);
    const transcript = turns
        .filter(turn => turn.role === 'user' || turn.role === 'agent')
        .map(turn => `${turn.role === 'user' ? 'Visitor' : 'Dani'}: ${clean(turn.content, 420)}`)
        .filter(value => value.length > 8)
        .slice(-20);
    return { objective, highlights, questions, commitments, patterns, validation, transcript };
}

export function buildDaniEmailBundle(input: TemplateInput): DaniEmailBundle {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const name = safeName(input.displayName);
    const first = firstName(input.displayName);
    const brief = buildBrief(input.turns);
    const started = formatPhoenixDate(input.sessionStartedAt);
    const ended = formatPhoenixDate(input.sessionEndedAt);
    const generated = formatPhoenixDate(generatedAt);
    const duration = formatElapsed(input.sessionStartedAt, input.sessionEndedAt);

    const visitorBody = `
<p style="margin:0;color:#172033;font-size:16px;line-height:25px;">Hi ${escapeHtml(first)},</p>
<p style="margin:14px 0 0;color:#475569;font-size:15px;line-height:24px;">Thank you for exploring your AI opportunity with Dani. This is a working recap of the points captured during your conversation.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;background:#f8fafc;border-left:4px solid ${INDIGO};"><tr><td style="padding:18px 20px;">
<div style="font-size:11px;line-height:15px;letter-spacing:.12em;text-transform:uppercase;color:${INDIGO};font-weight:700;">Primary objective</div>
<div style="margin-top:8px;color:#263548;font-size:15px;line-height:24px;">${escapeHtml(brief.objective)}</div>
</td></tr></table>
${brief.highlights.length ? `<div style="margin-top:28px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">What Dani heard</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:9px;">${bulletRows(brief.highlights.slice(0, 5))}</table>` : ''}
${brief.patterns.length ? `<div style="margin-top:28px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Directions worth validating</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:9px;">${bulletRows(brief.patterns)}</table>` : ''}
<div style="margin-top:28px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Useful next validation</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:9px;">${bulletRows(brief.validation.slice(0, 3))}</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;background:#f8fafc;"><tr><td style="padding:18px 20px;color:#334155;font-size:14px;line-height:22px;">
Want to continue or share Dani with a colleague? <a href="${REJOIN_URL}" style="color:${INDIGO};font-weight:700;">Reconnect with Dani</a>.
</td></tr></table>
<p style="margin:22px 0 0;color:#475569;font-size:14px;line-height:22px;">Regards,<br><strong style="color:#172033;">Dani</strong><br>AI Solutions Director, AI Fusion Labs</p>`;
    const visitorText = [
        `Hi ${first},`, '',
        'Thank you for exploring your AI opportunity with Dani. This is a working recap of the points captured during your conversation.', '',
        `Primary objective: ${brief.objective}`, '',
        ...textSection('What Dani heard', brief.highlights.slice(0, 5)),
        ...textSection('Directions worth validating', brief.patterns),
        ...textSection('Useful next validation', brief.validation.slice(0, 3)),
        `Reconnect with Dani: ${REJOIN_URL}`, '',
        'Regards,', 'Dani', 'AI Solutions Director, AI Fusion Labs', '',
        'Dani is an AI system. This working recap is not a final design, quote, commitment, professional advice, or compliance determination.',
    ].join('\n');

    const adminRows = [
        detailRow('Session ID', input.externalSessionId),
        detailRow('Started', started),
        detailRow('Ended', ended),
        detailRow('Final duration', duration),
        detailRow('Email generated', generated),
        detailRow('Visitor', name),
        detailRow('Verified contact', input.verifiedEmail),
        detailRow('Transcript turns', String(input.turns.length)),
        detailRow('Transcript source', 'Final Anam session transcript'),
    ].join('');
    const adminBody = `
<p style="margin:0;color:#475569;font-size:14px;line-height:22px;">Operational record created after Dani's provider-verified session closed.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;border:1px solid #e2e8f0;border-collapse:collapse;">${adminRows}</table>
<div style="margin-top:26px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Conversation objective</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background:#f8fafc;border-left:4px solid ${INDIGO};"><tr><td style="padding:18px 20px;color:#263548;font-size:14px;line-height:22px;">${escapeHtml(brief.objective)}</td></tr></table>
<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Sanitized conversation timeline</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(brief.transcript.length ? brief.transcript : ['No transcript turns were available at email time.'])}</table>`;
    const adminText = [
        'DANI SESSION ADMIN RECORD', '',
        `Session ID: ${input.externalSessionId}`,
        `Started: ${started}`,
        `Ended: ${ended}`,
        `Final duration: ${duration}`,
        `Email generated: ${generated}`,
        `Visitor: ${name}`,
        `Verified contact: ${input.verifiedEmail}`,
        `Transcript turns: ${input.turns.length}`,
        'Transcript source: Final Anam session transcript', '',
        `Conversation objective: ${brief.objective}`, '',
        ...textSection('Sanitized conversation timeline', brief.transcript),
        'Internal AI Fusion Labs operational record. Contact details came from the secure website check-in, not speech recognition.',
    ].join('\n');

    const summaryBody = `
<p style="margin:0 0 22px;color:#475569;font-size:14px;line-height:22px;">Dani completed a conversation with ${escapeHtml(name)}. The material below is a working opportunity brief; validate it against the transcript before outreach or commitments.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e2e8f0;border-collapse:collapse;">${detailRow('Contact', name)}${detailRow('Verified email', input.verifiedEmail)}${detailRow('Session ID', input.externalSessionId)}</table>
<div style="margin-top:26px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Primary objective</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background:#f8fafc;border-left:4px solid ${CYAN};"><tr><td style="padding:18px 20px;color:#263548;font-size:14px;line-height:22px;">${escapeHtml(brief.objective)}</td></tr></table>
${brief.highlights.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">User-stated context</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(brief.highlights)}</table>` : ''}
${brief.patterns.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Potential solution patterns</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(brief.patterns)}</table>` : ''}
${brief.commitments.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Possible commitments or next-step language</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(brief.commitments)}</table>` : ''}
${brief.questions.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Questions and qualification gaps</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(brief.questions)}</table>` : ''}
<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Recommended validation</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(brief.validation)}</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:27px;background:#fff7ed;border:1px solid #fed7aa;"><tr><td style="padding:16px 18px;color:#9a3412;font-size:13px;line-height:21px;">Internal planning input only. Distinguish transcript-supported facts from inference. Validate capability, ownership, data access, integration, security, pricing, timing, and delivery before making a commitment.</td></tr></table>`;
    const summaryText = [
        'DANI CALL SUMMARY & OPPORTUNITY BRIEF', '',
        `Contact: ${name}`,
        `Verified email: ${input.verifiedEmail}`,
        `Session ID: ${input.externalSessionId}`, '',
        `Primary objective: ${brief.objective}`, '',
        ...textSection('User-stated context', brief.highlights),
        ...textSection('Potential solution patterns', brief.patterns),
        ...textSection('Possible commitments or next-step language', brief.commitments),
        ...textSection('Questions and qualification gaps', brief.questions),
        ...textSection('Recommended validation', brief.validation),
        'Internal planning input only. Validate all facts, inferences, scope, commercial terms, security, and delivery before making a commitment.',
    ].join('\n');

    return {
        visitor: {
            subject: 'Your conversation recap from Dani | AI Fusion Labs',
            text: visitorText,
            html: shell({
                preview: 'Your working AI opportunity recap from Dani.',
                eyebrow: 'AI Fusion Labs · Follow-up from Dani',
                title: 'Your AI opportunity recap',
                subtitle: 'A concise record of what you explored and what is worth validating next.',
                body: visitorBody,
                footer: 'Dani is an AI system. This recap is informational and requires human validation before any commitment.',
            }),
        },
        admin: {
            subject: `[DANI SESSION END] ${name} · ${duration}`,
            text: adminText,
            html: shell({
                preview: `Dani session admin record for ${name}.`,
                eyebrow: 'AI Fusion Labs · Session Administration',
                title: 'Dani session record',
                subtitle: 'Provider-verified session metadata and sanitized transcript timeline.',
                body: adminBody,
                footer: 'Internal AI Fusion Labs operational record. Do not forward without review.',
            }),
        },
        summary: {
            subject: `[DANI CALL SUMMARY] ${name} · ${brief.patterns[0] || 'AI opportunity discovery'}`,
            text: summaryText,
            html: shell({
                preview: `Dani call summary and opportunity brief for ${name}.`,
                eyebrow: 'AI Fusion Labs · Call Intelligence',
                title: 'Dani call summary',
                subtitle: 'User-stated context, potential solution patterns, gaps, and validation steps.',
                body: summaryBody,
                footer: 'Internal working brief. Facts and commitments must be checked against the authoritative transcript.',
            }),
        },
    };
}
