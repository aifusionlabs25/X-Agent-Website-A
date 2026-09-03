const LIVE_PRODUCT_DATA_REQUEST = /\b(?:sku|part(?:\s+number)?|inventory|price|pricing|availability|lead[- ]?time|contract[- ]?eligibility|live\s+(?:catalog|search|product\s+data))\b/i;

const CAPABILITY_OVERVIEW_REQUESTS = [
    /\btell me\b.{0,35}\bwhat you are\b/i,
    /\b(?:see|learn|understand)\b.{0,25}\bwhat (?:we|you) can do\b/i,
    /\b(?:asked|invited|told) me to (?:check|try) (?:this|you|amy) out\b/i,
    /\bhow (?:exactly )?would (?:you|that|this) help (?:my|our|the) team\b/i,
    /\bwhat(?:'s| is) your role\b/i,
    /\bhow (?:exactly )?(?:would|does|can) (?:you|that|this) (?:help|improve|support) (?:my|our|the) (?:team|sellers?|sales team)\b/i,
    /\bwhat\s+(?:do|can)\s+you\s+do\b/i,
    /\bwhat\s+you\s+can\s+do\b/i,
    /\bhow\s+do\s+you\s+work\b/i,
    /\b(?:explain|understand|learn)\s+(?:more\s+)?(?:about\s+)?how\s+you\s+work\b/i,
    /\btell\s+me\s+(?:more\s+)?about\s+yourself\b/i,
    /\bwhat\s+(?:exactly\s+)?are\s+your\s+capabilities\b/i,
    /\bwhat\s+are\s+you\s+capable\s+of\b/i,
    /\bwhy\s+do\s+you\s+matter\b/i,
    /\b(?:learn|understand)\s+(?:more\s+)?about\s+amy\b/i,
    /\b(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+(?:evaluating|interviewing)\s+(?:you|amy)\b/i,
    /\b(?:show|open|walk\s+me\s+through)\s+(?:me\s+)?(?:your\s+|amy(?:'s)?\s+)?(?:features|capabilities|tools|amy\s+intelligence|(?:the\s+)?insight\s+intelligence(?:\s+layer)?)\b/i,
    /\bwhat\s+(?:features|capabilities|tools)\s+(?:do\s+you\s+have|are\s+available|can\s+you\s+use)\b/i,
    /\bwhat\s+is\s+(?:amy\s+intelligence|(?:the\s+)?insight\s+intelligence(?:\s+layer)?)\b/i,
];

export function normalizeAmyCapabilityTurn(value: string): string {
    return String(value ?? '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

export function hasAmyCapabilityOverviewIntent(value: string): boolean {
    const normalized = normalizeAmyCapabilityTurn(value);
    if (!normalized || LIVE_PRODUCT_DATA_REQUEST.test(normalized)) return false;
    return CAPABILITY_OVERVIEW_REQUESTS.some((pattern) => pattern.test(normalized));
}
