const ANAM_API_BASE = 'https://api.anam.ai/v1';

export const EVAN_PERSONA_ID = '4b7e933a-ea04-4b84-b418-72c0762545e6';
export const EVAN_REQUIRED_TOOL_NAMES = ['Knowledge_Evan_Mullins_Moving', 'skip_turn', 'end_call'] as const;
export const EVAN_REQUIRED_PROMPT_MARKERS = ['<!-- EVAN_ANAM_CORE_START -->', '<!-- EVAN_ANAM_CORE_END -->'] as const;

type PersonaPayload = {
    id?: unknown;
    name?: unknown;
    avatarModel?: unknown;
    tools?: unknown;
    brain?: { systemPrompt?: unknown } | null;
};

export type EvanPersonaReadiness = {
    ready: boolean;
    personaIdMatches: boolean;
    identityMatches: boolean;
    cara4AvatarConfigured: boolean;
    missingToolNames: string[];
    missingPromptMarkers: string[];
};

export function inspectEvanPersonaReadiness(persona: PersonaPayload): EvanPersonaReadiness {
    const names = new Set(Array.isArray(persona.tools) ? persona.tools
        .map((tool: { name?: unknown }) => typeof tool?.name === 'string' ? tool.name.trim() : '')
        .filter(Boolean) : []);
    const prompt = typeof persona.brain?.systemPrompt === 'string' ? persona.brain.systemPrompt : '';
    const personaIdMatches = persona.id === EVAN_PERSONA_ID;
    const identityMatches = typeof persona.name === 'string' && /evan/i.test(persona.name) && /mullins/i.test(persona.name);
    const cara4AvatarConfigured = persona.avatarModel === 'cara-4';
    const missingToolNames = EVAN_REQUIRED_TOOL_NAMES.filter(name => !names.has(name));
    const missingPromptMarkers = EVAN_REQUIRED_PROMPT_MARKERS.filter(marker => !prompt.includes(marker));
    return {
        ready: personaIdMatches && identityMatches && cara4AvatarConfigured
            && missingToolNames.length === 0 && missingPromptMarkers.length === 0,
        personaIdMatches,
        identityMatches,
        cara4AvatarConfigured,
        missingToolNames,
        missingPromptMarkers,
    };
}

export async function readEvanPersonaReadiness(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<EvanPersonaReadiness> {
    const response = await fetchImpl(`${ANAM_API_BASE}/personas/${EVAN_PERSONA_ID}`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        signal: AbortSignal.timeout(5_000),
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Anam Evan readiness request failed (${response.status})`);
    const persona = await response.json().catch(() => null) as PersonaPayload | null;
    if (!persona || typeof persona !== 'object') throw new Error('Anam Evan readiness response was invalid');
    return inspectEvanPersonaReadiness(persona);
}
