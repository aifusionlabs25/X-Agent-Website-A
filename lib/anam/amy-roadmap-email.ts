/** Presentation-only inline recap. No attachment or new delivery action. */
export type AmyEmailRoadmap = {
    title: string;
    outcome: string;
    phases: Array<{ title: string; detail: string }>;
};

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function renderAmyEmailRoadmap(roadmap?: AmyEmailRoadmap): { html: string; text: string } {
    if (!roadmap?.phases.length) return { html: '', text: '' };
    const phases = roadmap.phases.slice(0, 8);
    const boundary = 'Conversation-based working outline. Sequence, effort, timing, and any parallel execution require specialist validation; no work is approved or scheduled here.';
    return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:23px;table-layout:fixed;border:1px solid #e5d5dd;background:#fcf8f5;overflow-wrap:anywhere;word-break:break-word;"><tr><td style="padding:20px;">
<h2 style="margin:0;color:#b90059;font-size:10px;line-height:17px;letter-spacing:1.2px;text-transform:uppercase;">Your working roadmap</h2>
<p style="margin:10px 0 7px;color:#332b2a;font-size:17px;line-height:24px;font-weight:600;">${escapeHtml(roadmap.title)}</p>
<p style="margin:0 0 16px;color:#655b56;font-size:13px;line-height:21px;">${escapeHtml(roadmap.outcome)}</p>
${phases.map((phase, index) => `<div style="padding:13px 0;border-top:1px solid #e8ddda;">
<div style="color:#b90059;font-size:12px;line-height:20px;font-weight:700;">${String(index + 1).padStart(2, '0')} · ${escapeHtml(phase.title)}</div>
<div style="margin-top:5px;color:#554b47;font-size:13px;line-height:21px;">${escapeHtml(phase.detail)}</div></div>`).join('')}
<p style="margin:12px 0 0;color:#796b66;font-size:11px;line-height:18px;">${boundary}</p>
</td></tr></table>`,
        text: ['YOUR WORKING ROADMAP', roadmap.title, roadmap.outcome, ...phases.map((phase, i) => `${i + 1}. ${phase.title}: ${phase.detail}`), boundary, ''].join('\n'),
    };
}
