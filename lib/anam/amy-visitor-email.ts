/** Presentation only. The caller owns transcript extraction and attachment policy. */
type VisitorRecap = {
    firstName: string;
    lane: string;
    objective: string;
    details: Array<{ label: string; value: string }>;
    nextStep: string;
    openQuestions: string[];
    rejoinUrl: string;
};

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const INTRO = 'Thanks again for speaking with me. I’ve summarized the key points and a suggested next step below.';
const FOOTER = "I'm an AI-powered conversational agent. This working recap is not a final design, quote, commitment, or compliance determination. Specialist review and scheduling require separate confirmation.";

export function renderAmyVisitorRecap(input: VisitorRecap): { html: string; text: string } {
    const details = input.details.filter(item => item.value).slice(0, 4);
    const detailRows: string[] = [];
    for (let index = 0; index < details.length; index += 2) {
        const pair = details.slice(index, index + 2);
        detailRows.push(`<tr>${pair.map(item => `<td class="recap-detail" width="${pair.length === 1 ? '100%' : '50%'}" ${pair.length === 1 ? 'colspan="2"' : ''} style="padding:15px 16px;background:#ffffff;border:1px solid #e8ddda;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;">
<div style="color:#b90059;font-size:10px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">${escapeHtml(item.label)}</div>
<div style="margin-top:7px;color:#554b47;font-size:14px;line-height:22px;">${escapeHtml(item.value)}</div></td>`).join('')}</tr>`);
    }
    // Keep the existing question intact instead of displaying the model's clipped
    // "Clarify [question without its first word]" fallback as a sentence.
    const questionAsNextStep = input.nextStep.startsWith('Clarify ') && input.openQuestions[0];
    const nextStep = questionAsNextStep
        ? `Clarify the next decision: ${input.openQuestions[0]}`
        : input.nextStep;
    const questions = input.openQuestions.filter(Boolean).slice(questionAsNextStep ? 1 : 0, questionAsNextStep ? 3 : 2);
    const questionHtml = questions.length ? `<p style="margin:13px 0 5px;color:#685963;font-size:12px;line-height:19px;font-weight:700;">Still to clarify</p><ul style="margin:0;padding-left:18px;color:#685963;font-size:13px;line-height:21px;">${questions.map(item => `<li style="margin:4px 0;">${escapeHtml(item)}</li>`).join('')}</ul>` : '';
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>A follow-up from Amy</title>
<style>@media only screen and (max-width:480px){.recap-pad{padding-left:22px!important;padding-right:22px!important}.recap-title{font-size:32px!important;line-height:37px!important}.recap-detail{display:block!important;width:auto!important}.recap-tag{font-size:8px!important;letter-spacing:.5px!important}}body,table,td,p,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table{mso-table-lspace:0pt;mso-table-rspace:0pt}img{border:0;outline:none;text-decoration:none}</style></head>
<body style="margin:0;padding:0;background:#eee9e5;color:#332b2a;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Your conversation recap and a suggested next step from Amy.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eee9e5;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;background:#ffffff;border:1px solid #e4dcd6;table-layout:fixed;overflow-wrap:anywhere;word-break:break-word;">
<tr><td height="4" bgcolor="#cf0065" style="height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="recap-pad" style="padding:29px 34px 25px;background:#fcf8f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="115"><img src="https://xagent.aifusionlabs.app/agents/insight-logo.png" width="109" height="45" alt="Insight" style="display:block;width:109px;height:45px;color:#554640;font-size:22px;"></td><td class="recap-tag" align="right" style="font-size:9px;line-height:15px;color:#766862;letter-spacing:1.2px;">A FOLLOW-UP FROM AMY</td></tr></table>
<p style="margin:28px 0 15px;color:#b90059;font-size:10px;line-height:17px;letter-spacing:1.5px;font-weight:700;text-transform:uppercase;">From conversation to a clearer next step</p>
<h1 class="recap-title" style="margin:0;color:#332b2a;font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:43px;font-weight:400;letter-spacing:-1px;">Thank you, ${escapeHtml(input.firstName)}.<br>Here’s what we took away.</h1>
<p style="margin:18px 0 0;color:#655b56;font-size:15px;line-height:25px;">${INTRO}</p>
</td></tr>
<tr><td class="recap-pad" style="padding:25px 34px 30px;">
<h2 style="margin:0 0 12px;color:#70635d;font-size:10px;line-height:17px;letter-spacing:1.5px;font-weight:700;text-transform:uppercase;">Your conversation at a glance</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fcf8f5;border:1px solid #e5d5dd;table-layout:fixed;">
<tr><td style="padding:15px 20px;border-bottom:1px solid #e8ddda;color:#b90059;font-size:10px;line-height:17px;letter-spacing:1px;font-weight:700;">CONVERSATION SUMMARY · KEY TAKEAWAYS</td></tr>
<tr><td style="padding:20px;">
<h3 style="margin:0 0 17px;color:#332b2a;font:27px/33px Georgia,'Times New Roman',serif;">${escapeHtml(input.lane)}</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr><td style="padding:17px 18px;background:#cf0065;color:#ffffff;">
<div style="font-size:10px;line-height:16px;letter-spacing:1.1px;font-weight:700;">CONVERSATION FOCUS</div>
<p style="margin:8px 0 0;color:#ffffff;font-size:15px;line-height:24px;font-weight:600;">${escapeHtml(input.objective)}</p>
</td></tr></table>
${detailRows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;table-layout:fixed;border-collapse:collapse;">${detailRows.join('')}</table>` : ''}
<p style="margin:14px 0 0;color:#796b66;font-size:10px;line-height:17px;">Conversation-based working view · Specialist validation still required</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:23px;table-layout:fixed;"><tr><td style="padding:20px 22px;background:#fbf0f5;border-left:3px solid #cf0065;">
<h2 style="margin:0;color:#b90059;font-size:10px;line-height:17px;letter-spacing:1.2px;font-weight:700;text-transform:uppercase;">Suggested next step</h2>
<p style="margin:10px 0 0;color:#44313a;font-size:15px;line-height:24px;font-weight:600;">${escapeHtml(nextStep)}</p>
${questionHtml}
<p style="margin:12px 0 0;color:#796573;font-size:11px;line-height:18px;">For review—not a booking confirmation.</p>
</td></tr></table>
<p style="margin:23px 0 17px;color:#766963;font-size:13px;line-height:22px;">Have an update or a correction? Bring it to your next conversation with me.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#cf0065" style="background:#cf0065;mso-padding-alt:13px 22px;"><a href="${escapeHtml(input.rejoinUrl)}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:14px;line-height:21px;font-weight:700;text-decoration:none;">Continue with Amy &nbsp; &#8599;</a></td></tr></table>
<p style="margin:24px 0 0;color:#766963;font-size:13px;line-height:22px;">Thank you for your time,<br><strong style="color:#332b2a;font-size:15px;">Amy</strong><br>Your AI conversation guide · Insight demo</p>
</td></tr>
<tr><td class="recap-pad" style="padding:19px 34px 23px;background:#fcf8f5;border-top:1px solid #e8ddda;color:#766963;font-size:11px;line-height:18px;"><strong style="display:block;margin-bottom:6px;color:#5f5550;font-size:10px;letter-spacing:.8px;">INSIGHT DEMO · BUILT BY AI FUSION LABS</strong>${FOOTER}</td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
    const text = [
        `Thank you, ${input.firstName}.`, '', INTRO, '',
        'YOUR CONVERSATION AT A GLANCE', input.lane,
        `Conversation focus: ${input.objective}`, '',
        ...details.map(item => `${item.label}: ${item.value}`), '',
        `Suggested next step: ${nextStep}`, '',
        ...(questions.length ? ['Still to clarify', ...questions.map(item => `- ${item}`), ''] : []),
        'For review—not a booking confirmation.', '',
        'Have an update or a correction? Bring it to your next conversation with me.',
        `Continue with Amy: ${input.rejoinUrl}`, '',
        'Thank you for your time,', 'Amy', 'Your AI conversation guide · Insight demo', '',
        'INSIGHT DEMO · BUILT BY AI FUSION LABS', FOOTER,
    ].join('\n');
    return { html, text };
}
