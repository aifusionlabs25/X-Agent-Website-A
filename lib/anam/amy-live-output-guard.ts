export type AmyUnsafeSpokenOutputReason = 'contact_privacy' | 'provider_fallback' | 'tool_markup';

export type AmyLiveOutputInspection = {
    reason: AmyUnsafeSpokenOutputReason;
    safePrefix: string;
};

const UNSAFE_SPOKEN_PATTERNS: Array<{
    reason: AmyUnsafeSpokenOutputReason;
    pattern: RegExp;
}> = [
    {
        reason: 'contact_privacy',
        pattern: /\b(?:could|can|would) you (?:please )?(?:state|say|repeat|spell|share).{0,45}\b(?:email|e-mail|address)\b/i,
    },
    {
        reason: 'contact_privacy',
        pattern: /\b(?:I heard|I have|I got|I've got|recorded).{0,120}(?:@|\bat\s+(?:gmail|outlook|hotmail|yahoo)\b|\b(?:gmail|outlook|hotmail|yahoo)\s+(?:dot|\.)\s*com\b)/i,
    },
    {
        reason: 'tool_markup',
        pattern: /^\s*</,
    },
    {
        reason: 'provider_fallback',
        pattern: /\b(?:sorry[,\s]*)?i(?:'m| am) having trouble(?: thinking(?: right now)?)?\b/i,
    },
    {
        reason: 'provider_fallback',
        pattern: /\bi (?:can't|cannot) think\b|\bsomething went wrong in my thinking\b/i,
    },
    {
        reason: 'tool_markup',
        pattern: /<\s*end_(?:call|amy_session)\b|\bend_(?:call|amy_session)\s*\{/i,
    },
];

export function hasAmySpokenEmailAttempt(value: string): boolean {
    return /\b(?:email|e-mail)\b.{0,80}(?:\baddress\b|@|\bat\s+(?:gmail|outlook|hotmail|yahoo)\b)|\b[A-Z](?:[ -][A-Z]){2,}\s+at\s+(?:gmail|outlook|hotmail|yahoo)\b/i
        .test(String(value ?? ''));
}

export function inspectAmyLiveOutput(value: string): AmyLiveOutputInspection | null {
    // Length-preserving normalization keeps safePrefix offsets correct for streaming chunks.
    const normalized = value.replace(/[\u2018\u2019]/g, "'").replace(/[\u00a0\u200b\u202f]/g, ' ');
    let earliest: { reason: AmyUnsafeSpokenOutputReason; index: number } | null = null;

    for (const candidate of UNSAFE_SPOKEN_PATTERNS) {
        const match = candidate.pattern.exec(normalized);
        if (!match || (earliest && match.index >= earliest.index)) continue;
        earliest = { reason: candidate.reason, index: match.index };
    }

    if (!earliest) return null;
    return {
        reason: earliest.reason,
        safePrefix: value.slice(0, earliest.index).trimEnd(),
    };
}
