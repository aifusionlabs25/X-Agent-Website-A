import type { EvanCaptureFact } from './evan-capture.ts';

const clean = (text: string) => text.trim().replace(/[.!?]+$/u, '').trim();
const key = (text: string) => clean(text).normalize('NFKC').toLowerCase().replace(/^the\s+/u, '');
const has = (text: string, value: string) => new RegExp('(?<![\\p{L}\\p{N}])'
    + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'iu').test(text);

/** A caller-confirmed noun repair preserves the original item's quantity and
 * location. The agent can identify the misheard item, but the replacement must
 * be spoken by the caller. No global books->boxes substitution or agent-only
 * correction; ambiguous groups and bare yes remain unchanged. */
export function confirmedEvanInventoryCorrection(
    text: string, question: string, entries: Array<[string, EvanCaptureFact]>, turn: number,
): { oldKey: string; next: EvanCaptureFact } | null {
    let before = '', proposed = '';
    const questions = question.match(/[^.!?]*\?/gu) ?? [];
    if (questions.length === 1 && question.trimEnd().endsWith('?')
        && !/\b(?:hypothetical|example|suppose|imagine|maybe)\b/iu.test(question)) {
        const correction = questions[0].trim().match(/^(?:you (?:mentioned|said)|I (?:heard|noted|have))\s+(.+?)[,;]\s*(?:I assume you meant|did you mean|do you mean|was that supposed to be)\s+(.+?)\?$/iu);
        const reversed = questions[0].trim().match(/^(?:did|do) you mean\s+(.+?)\s+(?:instead of|rather than|not)\s+(.+?)\?$/iu);
        if (correction) { before = correction[1]; proposed = clean(correction[2]); }
        else if (reversed) { before = reversed[2]; proposed = clean(reversed[1]); }
    }
    const reply = clean(text);
    if (/\b(?:his|her|their|brother|sister|friend|neighbor|landlord|suppose|imagine|example|hypothetical)\b/iu.test(reply)
        || /["“”]/u.test(reply)) return null;
    const explicit = reply.match(/^(?:(?:actually|correction|sorry)[, ]+)?(?:I (?:meant|said)|it(?:['’]s| is)|they(?:['’]re| are))\s+(.+?)[, ]+not\s+(.+)$/iu)
        ?? reply.match(/^([^,]+),\s*not\s+(.+)$/iu);
    let replacement = explicit?.[1] ?? '';
    if (explicit) { before = explicit[2]; proposed = ''; }
    else if (before && proposed) {
        replacement = reply.replace(/^(?:(?:yes|yeah|yep|right|correct|exactly|that(?:['’]s| is) right)[,!.\s]+)+/iu, '')
            .replace(/^(?:I (?:meant|said)|it(?:['’]s| is)|they(?:['’]re| are))\s+/iu, '');
        if (key(replacement) !== key(proposed)) return null;
    }
    replacement = clean(replacement);
    if (!before || !replacement || !/^[\p{L}][\p{L}'’ -]{1,79}$/u.test(replacement)
        || replacement.split(/\s+/u).length > 5
        || /\b(?:yes|no|not|and|or|also|more|another|maybe|perhaps|actually|thanks|right|correct|phone|email|name|address|pickup|destination|date|moving|packing|service|help|please)\b/iu.test(replacement)) return null;
    const candidates = entries.filter(([, fact]) => fact.category === 'inventory' && fact.status === 'asserted'
        && has(before, fact.value) && key(fact.value) !== key(replacement));
    if (candidates.length !== 1) return null;
    const [oldKey, original] = candidates[0];
    // Do not merge a renamed group into another already captured group.
    if (entries.some(([, fact]) => fact.category === 'inventory' && fact.status !== 'removed'
        && key(fact.value) === key(replacement) && fact.location === original.location && fact.scope === original.scope)) return null;
    const latest = { turn, quote: text };
    return { oldKey, next: { ...original, value: replacement, evidence: [...original.evidence.slice(-7), latest] } };
}
