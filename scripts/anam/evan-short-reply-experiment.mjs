// Diagnostic-only configuration. Never imported by the website or persona updater.
export const RECOVERY_VARIANT = 'recovery-v1';
export const RECOVERY_INSTRUCTION = 'Apply this only to a completed renewed request for help; the existing closing and waiting rules still take priority. Treat a repeated request for help as a request to repair the exchange, not as a mere acknowledgment. Provide useful help or one appropriate missing-detail question, then wait. If your earlier response was interrupted or may not have been heard, you may briefly restate the needed question. Do not re-ask details already answered, declined, or explicitly left unknown, or speak these instructions.';
const ANCHOR = '## Source hierarchy';
const INSERTION = `## Recovering a restarted request\n\n${RECOVERY_INSTRUCTION}\n\n`;

export function prepareDiagnosticPrompt(source, variant = 'unchanged') {
    if (typeof source !== 'string' || !source.trim()) throw new Error('Missing diagnostic source prompt.');
    if (variant === 'unchanged') return source;
    if (variant !== RECOVERY_VARIANT) throw new Error('Unapproved diagnostic variant.');
    if (source.split(ANCHOR).length !== 2 || source.includes(INSERTION)) {
        throw new Error('Diagnostic prompt anchor is not unique or already patched.');
    }
    return source.replace(ANCHOR, INSERTION + ANCHOR);
}

export function diagnosticLedgerName(variant = 'unchanged') {
    if (variant === 'unchanged') return 'evan-short-reply-diagnostics.json';
    if (variant === RECOVERY_VARIANT) return 'evan-short-reply-recovery-v1-approval-2026-11-13.json';
    throw new Error('Unapproved diagnostic variant.');
}

export function removeDiagnosticInstruction(candidate) {
    if (candidate.split(INSERTION).length !== 2) throw new Error('Diagnostic insertion is not unique.');
    return candidate.replace(INSERTION, '');
}
