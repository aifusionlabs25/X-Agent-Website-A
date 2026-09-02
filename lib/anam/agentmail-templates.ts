import type { AmyTranscriptTurn } from './session-spine.ts';
import type { AmyWorkbenchFact, AmyWorkbenchModel } from './workbench-v2.ts';
import { renderAmyVisitorRecap } from './amy-visitor-email.ts';
import { renderAmyEmailRoadmap } from './amy-roadmap-email.ts';

export type AmyEmailContent = {
    subject: string;
    text: string;
    html: string;
    attachments?: Array<{
        filename: string;
        contentType: string;
        content: string;
    }>;
};

export type AmyEmailBundle = {
    visitor: AmyEmailContent;
    admin: AmyEmailContent;
    intake: AmyEmailContent;
};

type TemplateInput = {
    displayName: string;
    verifiedEmail: string;
    callbackPhone?: string;
    externalSessionId: string;
    sessionStartedAt: string;
    sessionEndedAt: string;
    generatedAt?: string;
    turns: AmyTranscriptTurn[];
    model: AmyWorkbenchModel;
};

const INSIGHT_NAVY = '#071425';
const INSIGHT_MAGENTA = '#ae0a46';
const AMY_REJOIN_URL = 'https://xagent.aifusionlabs.app/demo/amy?variant=cara4';
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

function safeFirstName(value: unknown): string {
    const name = safeName(value);
    return name === 'there' ? name : name.split(' ')[0].slice(0, 40) || 'there';
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

function safeCallbackPhone(value: unknown): string {
    const normalized = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
    const digits = normalized.replace(/\D/g, '');
    return /^[+()\d\s.-]{7,32}$/.test(normalized) && digits.length >= 7 && digits.length <= 15
        ? normalized
        : '';
}

function visualBriefCards(model: AmyWorkbenchModel): string {
    return model.visualBrief.slides.map((slide, index) => `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:${index ? '16px' : '10px'};background:#fffaf7;border:1px solid #f0cfdd;">
<tr><td style="padding:19px 20px;">
<div style="font-size:10px;line-height:15px;letter-spacing:.16em;text-transform:uppercase;color:${INSIGHT_MAGENTA};font-weight:700;">${escapeHtml(slide.eyebrow)}</div>
<div style="margin-top:7px;color:#302529;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:29px;font-weight:700;">${escapeHtml(slide.title)}</div>
<div style="margin-top:8px;color:#6f5f64;font-size:13px;line-height:20px;">${escapeHtml(slide.summary)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:11px;">${bulletRows(slide.bullets)}</table>
<div style="margin-top:12px;padding-top:10px;border-top:1px solid #eadde2;color:#86747a;font-size:10px;line-height:16px;">${escapeHtml(slide.boundary)}</div>
</td></tr></table>`).join('');
}

function visualBriefText(model: AmyWorkbenchModel): string[] {
    return [
        'FINAL VISUAL BRIEF',
        ...model.visualBrief.slides.flatMap((slide) => [
            '',
            `${slide.eyebrow}: ${slide.title}`,
            slide.summary,
            ...slide.bullets.map((bullet) => `- ${bullet}`),
            `Boundary: ${slide.boundary}`,
        ]),
        '',
    ];
}

export function buildAmyEmailBundle(input: TemplateInput): AmyEmailBundle {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const name = safeName(input.displayName);
    const callbackPhone = safeCallbackPhone(input.callbackPhone);
    const firstName = safeFirstName(input.displayName);
    const facts = input.model.facts.filter(validFact);
    const objectiveCandidate = clean(input.model.brief.objective, 700);
    const objective = objectiveCandidate && !EMAIL_ACTION_PATTERN.test(objectiveCandidate)
        ? objectiveCandidate
        : `${clean(input.model.lane, 120) || 'Technology planning'} discussion with Amy.`;
    const representedSecurityContext = [factValue(facts, 'Affected scope'), factValue(facts, 'Evidence source')].filter(Boolean).join(' / ');
    const environment = factValue(facts, 'Technology context') || clean(input.model.brief.environment
        .filter(item => !representedSecurityContext.includes(item)).join(' / '));
    const workloads = factValue(facts, 'Critical workloads');
    const guardrail = factValue(facts, 'Primary guardrail');
    const timing = factValue(facts, 'Timing');
    const organization = factValue(facts, 'Context');
    const scale = factValue(facts, 'Environment scale');
    const requestedOutput = factValue(facts, 'Requested output');
    const decisionOwner = factValue(facts, 'Decision owner') || factValue(facts, 'Stakeholder context');
    const requirementsStatus = factValue(facts, 'Requirements status');
    const discoveryAgenda = factValue(facts, 'Workshop agenda to clarify');
    const dataSources = factValue(facts, 'Available data') || factValue(facts, 'Evidence source');
    const qualificationDetails = ['Infrastructure status', 'AI funding', 'AI data-flow review', 'Reported data category',
        'Security findings', 'Affected scope', 'Reported audit requirement', 'Accountable team', 'Ownership status', 'Evidence source', 'Governance drivers']
        .map(label => ({ label, value: factValue(facts, label) })).filter(item => item.value);
    const roadmap = /\broad\s?map\b/i.test(requestedOutput) && input.model.signalCount > 1 ? {
        title: clean(input.model.roadmap.title, 180),
        outcome: clean(input.model.roadmap.outcome, 600),
        phases: input.model.roadmap.phases.map(phase => ({ title: clean(phase.title, 180), detail: clean(phase.detail, 700) })),
    } : undefined;
    const roadmapRecap = renderAmyEmailRoadmap(roadmap);
    const includeVisualBrief = /visual brief/i.test(requestedOutput)
        || input.turns.some((turn) => turn.role === 'user' && /\bvisual brief\b/i.test(turn.content));
    const nextStep = clean(input.model.brief.nextStep, 600)
        || 'Review the confirmed scope with the appropriate Insight specialist and agree on the next decision gate.';
    const priorities = unique(
        input.model.brief.priorities.filter(priority => !EMAIL_ACTION_PATTERN.test(priority)),
        6,
    );
    const openQuestions = unique(input.model.brief.openQuestions, 6);
    const highlights = unique([
        ...qualificationDetails.map(item => `${item.label}: ${item.value}`),
        environment ? `Technology context: ${environment}` : '',
        workloads ? `Critical workloads: ${workloads}` : '',
        guardrail ? `Primary guardrail: ${guardrail}` : '',
        timing ? `Project timing: ${timing}` : '',
        requestedOutput ? `Requested output: ${requestedOutput}` : '',
        decisionOwner ? `Reported decision ownership: ${decisionOwner}` : '',
        requirementsStatus ? `Requirements status: ${requirementsStatus}` : '',
        discoveryAgenda ? `Workshop agenda to clarify: ${discoveryAgenda}` : '',
        dataSources && dataSources !== factValue(facts, 'Evidence source') ? `Visitor-identified data: ${dataSources}` : '',
    ], 22);
    const duration = formatElapsed(input.sessionStartedAt, input.sessionEndedAt);
    const elapsed = duration;
    const started = formatPhoenixDate(input.sessionStartedAt);
    const ended = formatPhoenixDate(input.sessionEndedAt);
    const generated = formatPhoenixDate(generatedAt);
    const transcript = transcriptSnapshot(input.turns);
    const transcriptTitle = input.turns.length > transcript.length
        ? `Sanitized conversation excerpt (last ${transcript.length} of ${input.turns.length} turns; entries may be shortened)`
        : 'Sanitized conversation timeline';
    const customerValue = unique([
        objective,
        guardrail ? `Protect the stated operating guardrail: ${guardrail}` : '',
        workloads ? `Maintain continuity for the critical workload: ${workloads}` : '',
        timing ? `Work toward the stated timing: ${timing}` : '',
    ], 5);
    const pursuitPlan = unique([
        `Assign an Insight opportunity owner and align the appropriate ${environment || clean(input.model.lane, 120) || 'technology'} specialists before outreach.`,
        guardrail ? `Open the follow-up by confirming the non-negotiable guardrail: ${guardrail}` : '',
        `Use the next working session to advance this decision: ${nextStep}`,
        openQuestions[0] ? `Resolve the first qualification gap: ${openQuestions[0]}` : '',
        timing ? `Anchor the pursuit plan and decision gates to the stated timing: ${timing}` : '',
    ], 5);

    const visitorRecap = renderAmyVisitorRecap({
        firstName,
        lane: clean(input.model.lane, 150) || 'Technology planning',
        objective: input.turns.length ? objective : 'No detailed conversation context was available for this recap.',
        details: [
            ...qualificationDetails,
            { label: 'Technology context', value: environment },
            { label: 'Critical workloads', value: workloads },
            { label: 'Your guardrail', value: guardrail },
            { label: 'Your timing', value: timing },
            { label: 'Decision ownership', value: decisionOwner },
            { label: 'Requirements status', value: requirementsStatus },
            { label: 'To clarify together', value: discoveryAgenda },
        ],
        nextStep: input.turns.length ? nextStep : 'Start a new conversation with Amy when you are ready to discuss your priorities.',
        openQuestions: input.turns.length ? openQuestions : [],
        rejoinUrl: AMY_REJOIN_URL,
        roadmap,
    });

    const adminDetails = [
        detailRow('Session ID', input.externalSessionId),
        detailRow('Started', started),
        detailRow('Ended', ended),
        detailRow('Final call duration', duration),
        detailRow('Email generated', generated),
        detailRow('Session state', 'Finalized before email delivery'),
        detailRow('Visitor', name),
        detailRow('Verified contact', input.verifiedEmail),
        detailRow('Confirmed callback', callbackPhone || 'Email follow-up only'),
        detailRow('Transcript turns captured', String(input.turns.length)),
    ].join('');
    const adminBody = `
<p style="margin:0;color:#435166;font-size:14px;line-height:22px;">Operational record generated when Amy completed the approved visitor follow-up action.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;border:1px solid #e1e6ec;border-collapse:collapse;">${adminDetails}</table>
<div style="margin-top:26px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Conversation summary</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background:#f7f8fa;border-left:4px solid ${INSIGHT_MAGENTA};"><tr><td style="padding:18px 20px;color:#263548;font-size:14px;line-height:22px;">${escapeHtml(objective)}</td></tr></table>
${highlights.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Key captured facts</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(highlights)}</table>` : ''}
${roadmapRecap.html}
<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">${escapeHtml(transcriptTitle)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(transcript.length ? transcript : ['No transcript turns were available at email time.'])}</table>`;
    const adminText = [
        'AMY SESSION OPERATIONS RECORD', '',
        `Session ID: ${input.externalSessionId}`,
        `Started: ${started}`,
        `Ended: ${ended}`,
        `Final call duration: ${duration}`,
        `Email generated: ${generated}`,
        `Visitor: ${name}`,
        `Verified contact: ${input.verifiedEmail}`,
        `Confirmed callback: ${callbackPhone || 'Email follow-up only'}`,
        `Transcript turns captured: ${input.turns.length}`, '',
        `Conversation summary: ${objective}`, '',
        ...textSection('Key captured facts', highlights),
        ...(roadmapRecap.text ? [roadmapRecap.text] : []),
        ...textSection(transcriptTitle, transcript),
        'Internal AI Fusion Labs operational record. Contact details came from the secure website check-in, not speech recognition.',
    ].join('\n');

    const intakeContext = unique([
        organization ? `Organization context: ${organization}` : '',
        scale ? `Environment scale: ${scale}` : '',
        ...highlights,
    ], 24);
    const intakeBody = `
<p style="margin:0 0 22px;color:#435166;font-size:14px;line-height:22px;">I completed a conversation with ${escapeHtml(name)} and organized the verified context below for Sales and Operations. Use it to prepare a focused follow-up without introducing unsupported assumptions.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e1e6ec;border-collapse:collapse;">
${detailRow('Contact', name)}${detailRow('Verified email', input.verifiedEmail)}${detailRow('Confirmed callback', callbackPhone || 'Email follow-up only')}${detailRow('Opportunity lane', clean(input.model.lane, 150))}${detailRow('Session ID', input.externalSessionId)}
</table>
<div style="margin-top:26px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Opportunity snapshot</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background:#f7f8fa;border-left:4px solid ${INSIGHT_MAGENTA};"><tr><td style="padding:18px 20px;color:#263548;font-size:14px;line-height:22px;">${escapeHtml(objective)}</td></tr></table>
${intakeContext.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Scope and operating context</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(intakeContext)}</table>` : ''}
${priorities.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Priorities and guardrails</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(priorities)}</table>` : ''}
${customerValue.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Customer value and urgency</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(customerValue)}</table>` : ''}
<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Recommended next-meeting objective</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;background:#fff7fa;border:1px solid #f2cedc;"><tr><td style="padding:17px 19px;color:#5f2340;font-size:14px;line-height:22px;font-weight:600;">${escapeHtml(nextStep)}</td></tr></table>
${pursuitPlan.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Recommended pursuit plan</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(pursuitPlan)}</table>` : ''}
${openQuestions.length ? `<div style="margin-top:25px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Qualification gaps for the team</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">${bulletRows(openQuestions)}</table>` : ''}
${roadmapRecap.html}
${includeVisualBrief ? `<div style="margin-top:30px;font-size:18px;line-height:24px;color:#172033;font-weight:700;">Final Visual Brief</div><p style="margin:7px 0 0;color:#657184;font-size:13px;line-height:20px;">The same finalized, conversation-grounded view sent to the visitor is included here for sales preparation.</p>${visualBriefCards(input.model)}` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:27px;background:#fff8e7;border:1px solid #efd79b;"><tr><td style="padding:16px 18px;color:#6b4b09;font-size:13px;line-height:21px;">Internal planning input only. Validate scope, ownership, contract eligibility, compliance, pricing, availability, and timing before making a customer commitment.</td></tr></table>`;
    const intakeText = [
        'INSIGHT SALES & OPERATIONS INTAKE', '',
        `Contact: ${name}`,
        `Verified email: ${input.verifiedEmail}`,
        `Confirmed callback: ${callbackPhone || 'Email follow-up only'}`,
        `Opportunity lane: ${clean(input.model.lane, 150)}`,
        `Session ID: ${input.externalSessionId}`, '',
        `I completed a conversation with ${name} and organized the verified context below for Sales and Operations.`, '',
        `Opportunity snapshot: ${objective}`, '',
        ...textSection('Scope and operating context', intakeContext),
        ...textSection('Priorities and guardrails', priorities),
        ...textSection('Customer value and urgency', customerValue),
        `Recommended next-meeting objective: ${nextStep}`, '',
        ...textSection('Recommended pursuit plan', pursuitPlan),
        ...textSection('Qualification gaps for the team', openQuestions),
        ...(roadmapRecap.text ? [roadmapRecap.text] : []),
        ...(includeVisualBrief ? visualBriefText(input.model) : []),
        'Internal planning input only. Validate scope, ownership, contract eligibility, compliance, pricing, availability, and timing before making a customer commitment.',
    ].join('\n');

    const subjectContext = clean(input.model.lane, 90) || 'Technology planning';
    const visualAttachment = includeVisualBrief ? {
        filename: 'amy-visual-brief.html',
        contentType: 'text/html; charset=utf-8',
        content: shell({
            preview: `Final Visual Brief for the ${subjectContext.toLowerCase()} conversation.`,
            eyebrow: 'Insight · Amy Visual Brief',
            title: input.model.visualBrief.title || 'Conversation working brief',
            subtitle: 'Final conversation-grounded revision for review and printing.',
            body: visualBriefCards(input.model),
            footer: "AI-generated working brief. It is not a final design, quote, commitment, architecture, contract, or compliance determination.",
        }),
    } : null;
    return {
        visitor: {
            subject: `${subjectContext} | A follow-up from Amy`,
            ...visitorRecap,
            ...(visualAttachment ? { attachments: [visualAttachment] } : {}),
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
            ...(visualAttachment ? { attachments: [visualAttachment] } : {}),
        },
    };
}
