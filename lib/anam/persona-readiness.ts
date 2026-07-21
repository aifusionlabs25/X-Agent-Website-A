const ANAM_API_BASE = 'https://api.anam.ai/v1';

export const AMY_CARA4_REQUIRED_TOOL_NAMES = [
    'Knowledge_Amy',
    'confirm_live_identity',
    'end_call',
    'search_insight_catalog',
    'show_live_notes',
    'show_session_brief',
    'show_solution_catalog',
    'show_solution_roadmap',
    'show_visual_brief',
    'skip_turn',
] as const;

export const AMY_CARA4_REQUIRED_PROMPT_MARKERS = [
    '<!-- AMY_CARA4_RELIABILITY_START -->',
    '<!-- AMY_CARA4_RELIABILITY_END -->',
    '<!-- AMY_PUBLIC_SECTOR_START -->',
    '<!-- AMY_PUBLIC_SECTOR_END -->',
    '<!-- AMY_WORKBENCH_START -->',
    '<!-- AMY_WORKBENCH_END -->',
] as const;

export const EVAN_PERSONA_ID = '4b7e933a-ea04-4b84-b418-72c0762545e6';

export const EVAN_REQUIRED_TOOL_NAMES = [
    'Knowledge_Evan_Mullins_Moving',
    'skip_turn',
    'send_mullins_follow_up_email',
    'end_mullins_session',
] as const;

export const EVAN_REQUIRED_PROMPT_MARKERS = [
    '<!-- EVAN_ANAM_CORE_START -->',
    '<!-- EVAN_ANAM_CORE_END -->',
    '<!-- EVAN_AGENTMAIL_START -->',
    '<!-- EVAN_AGENTMAIL_END -->',
] as const;

type PersonaTool = {
    name?: unknown;
};

type PersonaPayload = {
    id?: unknown;
    name?: unknown;
    avatarModel?: unknown;
    tools?: unknown;
    zeroDataRetention?: unknown;
    enableAudioPassthrough?: unknown;
    brain?: {
        systemPrompt?: unknown;
    } | null;
};

export type AmyCara4PersonaReadiness = {
    ready: boolean;
    personaIdMatches: boolean;
    cara4AvatarConfigured: boolean;
    sessionDataRetentionConfigured: boolean;
    anamTranscriptionPipelineConfigured: boolean;
    missingToolNames: string[];
    missingPromptMarkers: string[];
};

export type EvanPersonaReadiness = {
    ready: boolean;
    personaIdMatches: boolean;
    identityMatches: boolean;
    cara4AvatarConfigured: boolean;
    sessionDataRetentionConfigured: boolean;
    anamTranscriptionPipelineConfigured: boolean;
    missingToolNames: string[];
    missingPromptMarkers: string[];
};

type ReadinessOptions = {
    apiKey: string;
    fetchImpl?: typeof fetch;
};

function toolNamesFromPersona(persona: PersonaPayload): Set<string> {
    if (!Array.isArray(persona.tools)) return new Set();
    return new Set(
        persona.tools
            .map((tool: PersonaTool) => typeof tool?.name === 'string' ? tool.name.trim() : '')
            .filter(Boolean),
    );
}

export function inspectAmyCara4PersonaReadiness(
    persona: PersonaPayload,
    expectedPersonaId: string,
): AmyCara4PersonaReadiness {
    const toolNames = toolNamesFromPersona(persona);
    const prompt = typeof persona.brain?.systemPrompt === 'string'
        ? persona.brain.systemPrompt
        : '';
    const personaIdMatches = persona.id === expectedPersonaId;
    const cara4AvatarConfigured = persona.avatarModel === 'cara-4';
    const sessionDataRetentionConfigured = persona.zeroDataRetention === false;
    const anamTranscriptionPipelineConfigured = persona.enableAudioPassthrough === false;
    const missingToolNames = AMY_CARA4_REQUIRED_TOOL_NAMES
        .filter(name => !toolNames.has(name));
    const missingPromptMarkers = AMY_CARA4_REQUIRED_PROMPT_MARKERS
        .filter(marker => !prompt.includes(marker));

    return {
        ready: personaIdMatches
            && cara4AvatarConfigured
            && sessionDataRetentionConfigured
            && anamTranscriptionPipelineConfigured
            && missingToolNames.length === 0
            && missingPromptMarkers.length === 0,
        personaIdMatches,
        cara4AvatarConfigured,
        sessionDataRetentionConfigured,
        anamTranscriptionPipelineConfigured,
        missingToolNames,
        missingPromptMarkers,
    };
}

export async function readAmyCara4PersonaReadiness(
    personaId: string,
    options: ReadinessOptions,
): Promise<AmyCara4PersonaReadiness> {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error('Anam API key is unavailable');
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(
        `${ANAM_API_BASE}/personas/${encodeURIComponent(personaId)}`,
        {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5_000),
            cache: 'no-store',
        },
    );
    if (!response.ok) {
        throw new Error(`Anam persona readiness request failed (${response.status})`);
    }
    const persona = await response.json().catch(() => null) as PersonaPayload | null;
    if (!persona || typeof persona !== 'object') {
        throw new Error('Anam persona readiness response was invalid');
    }
    return inspectAmyCara4PersonaReadiness(persona, personaId);
}

export function inspectEvanPersonaReadiness(
    persona: PersonaPayload,
): EvanPersonaReadiness {
    const toolNames = toolNamesFromPersona(persona);
    const prompt = typeof persona.brain?.systemPrompt === 'string'
        ? persona.brain.systemPrompt
        : '';
    const personaIdMatches = persona.id === EVAN_PERSONA_ID;
    const identityMatches = typeof persona.name === 'string'
        && /evan/i.test(persona.name)
        && /mullins/i.test(persona.name);
    const sessionDataRetentionConfigured = persona.zeroDataRetention === false;
    const anamTranscriptionPipelineConfigured = persona.enableAudioPassthrough === false;
    const cara4AvatarConfigured = persona.avatarModel === 'cara-4';
    const missingToolNames = EVAN_REQUIRED_TOOL_NAMES
        .filter(name => !toolNames.has(name));
    const missingPromptMarkers = EVAN_REQUIRED_PROMPT_MARKERS
        .filter(marker => !prompt.includes(marker));

    return {
        ready: personaIdMatches
            && identityMatches
            && cara4AvatarConfigured
            && missingToolNames.length === 0
            && sessionDataRetentionConfigured
            && anamTranscriptionPipelineConfigured
            && missingPromptMarkers.length === 0,
        personaIdMatches,
        identityMatches,
        cara4AvatarConfigured,
        missingToolNames,
        missingPromptMarkers,
        sessionDataRetentionConfigured,
        anamTranscriptionPipelineConfigured,
    };
}

export async function readEvanPersonaReadiness(
    apiKey: string,
    fetchImpl: typeof fetch = fetch,
): Promise<EvanPersonaReadiness> {
    const response = await fetchImpl(
        `${ANAM_API_BASE}/personas/${EVAN_PERSONA_ID}`,
        {
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            signal: AbortSignal.timeout(5_000),
            cache: 'no-store',
        },
    );
    if (!response.ok) {
        throw new Error(`Anam Evan readiness request failed (${response.status})`);
    }
    const persona = await response.json().catch(() => null) as PersonaPayload | null;
    if (!persona || typeof persona !== 'object') {
        throw new Error('Anam Evan readiness response was invalid');
    }
    return inspectEvanPersonaReadiness(persona);
}
