const ANAM_API_BASE = 'https://api.anam.ai/v1';

export const JAMES_REQUIRED_TOOL_NAMES = [
    'Knowledge_James_Knowles_Law_Firm_2026_07',
    'end_call',
    'skip_turn',
] as const;

export const JAMES_REQUIRED_PROMPT_MARKERS = [
    '<!-- JAMES_CANONICAL_SP_START -->',
    '<!-- JAMES_CANONICAL_SP_END -->',
    'JAMES_ANAM_SP_2026_07_16',
] as const;

type PersonaPayload = {
    id?: unknown;
    avatarModel?: unknown;
    zeroDataRetention?: unknown;
    initialMessage?: unknown;
    tools?: Array<{ name?: unknown }> | null;
    brain?: { systemPrompt?: unknown } | null;
};

export type JamesPersonaReadiness = {
    ready: boolean;
    personaIdMatches: boolean;
    cara4AvatarConfigured: boolean;
    zeroDataRetentionEnabled: boolean;
    aiDisclosureConfigured: boolean;
    missingToolNames: string[];
    missingPromptMarkers: string[];
};

type ReadinessOptions = {
    apiKey: string;
    fetchImpl?: typeof fetch;
};

export function inspectJamesPersonaReadiness(
    persona: PersonaPayload,
    expectedPersonaId: string,
): JamesPersonaReadiness {
    const toolNames = new Set((persona.tools ?? [])
        .map(tool => typeof tool?.name === 'string' ? tool.name.trim() : '')
        .filter(Boolean));
    const prompt = typeof persona.brain?.systemPrompt === 'string' ? persona.brain.systemPrompt : '';
    const initialMessage = typeof persona.initialMessage === 'string' ? persona.initialMessage : '';
    const personaIdMatches = persona.id === expectedPersonaId;
    const cara4AvatarConfigured = persona.avatarModel === 'cara-4';
    const zeroDataRetentionEnabled = persona.zeroDataRetention === true;
    const aiDisclosureConfigured = /\bAI\b/i.test(initialMessage) && /not a lawyer|not your lawyer/i.test(prompt);
    const missingToolNames = JAMES_REQUIRED_TOOL_NAMES.filter(name => !toolNames.has(name));
    const missingPromptMarkers = JAMES_REQUIRED_PROMPT_MARKERS.filter(marker => !prompt.includes(marker));

    return {
        ready: personaIdMatches
            && cara4AvatarConfigured
            && aiDisclosureConfigured
            && missingToolNames.length === 0
            && missingPromptMarkers.length === 0,
        personaIdMatches,
        cara4AvatarConfigured,
        zeroDataRetentionEnabled,
        aiDisclosureConfigured,
        missingToolNames,
        missingPromptMarkers,
    };
}

export async function readJamesPersonaReadiness(
    personaId: string,
    options: ReadinessOptions,
): Promise<JamesPersonaReadiness> {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error('Anam API key is unavailable');
    const response = await (options.fetchImpl ?? fetch)(
        `${ANAM_API_BASE}/personas/${encodeURIComponent(personaId)}`,
        {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5_000),
            cache: 'no-store',
        },
    );
    if (!response.ok) throw new Error(`Anam James readiness request failed (${response.status})`);
    const persona = await response.json().catch(() => null) as PersonaPayload | null;
    if (!persona || typeof persona !== 'object') throw new Error('Anam James readiness response was invalid');
    return inspectJamesPersonaReadiness(persona, personaId);
}
