export type AmyUnsafeSpokenOutputReason = 'provider_fallback' | 'tool_markup';

export type AmyLiveOutputInspection = {
    reason: AmyUnsafeSpokenOutputReason;
    safePrefix: string;
};

const UNSAFE_SPOKEN_PATTERNS: Array<{
    reason: AmyUnsafeSpokenOutputReason;
    pattern: RegExp;
}> = [
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

export function inspectAmyLiveOutput(value: string): AmyLiveOutputInspection | null {
    let earliest: { reason: AmyUnsafeSpokenOutputReason; index: number } | null = null;

    for (const candidate of UNSAFE_SPOKEN_PATTERNS) {
        const match = candidate.pattern.exec(value);
        if (!match || (earliest && match.index >= earliest.index)) continue;
        earliest = { reason: candidate.reason, index: match.index };
    }

    if (!earliest) return null;
    return {
        reason: earliest.reason,
        safePrefix: value.slice(0, earliest.index).trimEnd(),
    };
}
