import { createHash } from 'node:crypto';
import { DANI_PERSONA_ID, EVAN_PERSONA_ID } from './persona-ids.ts';

export { DANI_PERSONA_ID, EVAN_PERSONA_ID } from './persona-ids.ts';

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

export const EVAN_REQUIRED_TOOL_NAMES = [
    'Knowledge_Evan_Mullins_Moving',
    'skip_turn',
    'send_mullins_follow_up_email',
    'end_mullins_session',
    'show_move_planner',
] as const;

export const EVAN_REQUIRED_PROMPT_MARKERS = [
    '<!-- EVAN_ANAM_CORE_START -->',
    '<!-- EVAN_ANAM_CORE_END -->',
    '<!-- EVAN_AGENTMAIL_START -->',
    '<!-- EVAN_AGENTMAIL_END -->',
] as const;

export const DANI_EXPECTED_NAME = 'Dani AI Solutions Director';
export const DANI_EXPECTED_AVATAR_ID = '58b045b9-ac1d-4ddf-af14-18972618c57b';
export const DANI_EXPECTED_VOICE_ID = '90a1acd3-4fc0-11f1-84b0-52bacf74fa75';
export const DANI_EXPECTED_LLM_ID = 'a7cf662c-2ace-4de1-a21e-ef0fbf144bb7';
export const DANI_EXPECTED_PROMPT_SHA256 = '9da10faa751087237dfb5eb76b25dc937efe78e84197ba874e7f0d96a8e375b3';
export const DANI_MINIMUM_PUBLISHED_AT = '2026-08-09T18:36:27.589Z';

export const DANI_REQUIRED_TOOL_NAMES = [
    'Knowledge_Dani_AI_Solutions_Director',
    'skip_turn',
    'end_call',
    'send_dani_follow_up_email',
] as const;

export const DANI_REQUIRED_TOOL_IDS = {
    Knowledge_Dani_AI_Solutions_Director: '312d939d-8e3f-45f5-aab1-b2b63fb5022b',
    skip_turn: '69a89bda-9e11-443f-84c0-1cbea75e4fcb',
    end_call: '4d05849d-329f-4cd3-996f-f2a28d8135f0',
    send_dani_follow_up_email: '1e44a342-ca25-4c78-bbef-51cded9c8d68',
} as const;

export const DANI_REQUIRED_PROMPT_MARKERS = [
    '<!-- DANI_AI_SOLUTIONS_DIRECTOR_CORE_START -->',
    '<!-- DANI_AI_SOLUTIONS_DIRECTOR_CORE_END -->',
    '<!-- DANI_POST_CALL_EMAIL_START -->',
    '<!-- DANI_POST_CALL_EMAIL_END -->',
] as const;

export const DANI_REQUIRED_VOICE_DETECTION = {
    endOfSpeechSensitivity: 0.05,
    silenceBeforeAutoEndTurnSeconds: 3,
    silenceBeforeSkipTurnSeconds: 0,
    silenceBeforeSessionEndSeconds: 0,
    speechEnhancementLevel: 0.7,
} as const;

type PersonaTool = {
    id?: unknown;
    _toolId?: unknown;
    name?: unknown;
};

type PersonaPayload = {
    id?: unknown;
    name?: unknown;
    publishedAt?: unknown;
    avatarId?: unknown;
    avatarModel?: unknown;
    avatar?: {
        id?: unknown;
    } | null;
    voiceId?: unknown;
    voice?: {
        id?: unknown;
        voiceId?: unknown;
    } | null;
    llmId?: unknown;
    llm?: {
        id?: unknown;
    } | null;
    languageCode?: unknown;
    initialMessage?: unknown;
    tools?: unknown;
    voiceDetectionOptions?: Record<string, unknown> | null;
    zeroDataRetention?: unknown;
    enableAudioPassthrough?: unknown;
    brain?: {
        systemPrompt?: unknown;
        llmId?: unknown;
        llm?: {
            id?: unknown;
        } | null;
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

export type DaniPersonaReadiness = {
    ready: boolean;
    personaIdMatches: boolean;
    identityMatches: boolean;
    publishedRevisionMatches: boolean;
    cara4AvatarConfigured: boolean;
    avatarIdMatches: boolean;
    voiceIdMatches: boolean;
    llmIdMatches: boolean;
    promptHashMatches: boolean;
    voiceDetectionConfigured: boolean;
    sessionDataRetentionConfigured: boolean;
    anamTranscriptionPipelineConfigured: boolean;
    toolAttachmentMatches: boolean;
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

function daniToolAttachmentMatches(persona: PersonaPayload): boolean {
    if (!Array.isArray(persona.tools) || persona.tools.length !== DANI_REQUIRED_TOOL_NAMES.length) return false;
    const actual = new Map<string, string>();
    for (const tool of persona.tools as PersonaTool[]) {
        const name = typeof tool?.name === 'string' ? tool.name.trim() : '';
        const id = typeof tool?._toolId === 'string'
            ? tool._toolId
            : typeof tool?.id === 'string'
                ? tool.id
                : '';
        if (!name || !id || actual.has(name)) return false;
        actual.set(name, id);
    }
    return Object.entries(DANI_REQUIRED_TOOL_IDS)
        .every(([name, id]) => actual.get(name) === id);
}

function avatarIdFromPersona(persona: PersonaPayload): unknown {
    return persona.avatar?.id ?? persona.avatarId;
}

function voiceIdFromPersona(persona: PersonaPayload): unknown {
    return persona.voice?.id ?? persona.voice?.voiceId ?? persona.voiceId;
}

function llmIdFromPersona(persona: PersonaPayload): unknown {
    return persona.brain?.llm?.id
        ?? persona.brain?.llmId
        ?? persona.llm?.id
        ?? persona.llmId;
}

function managedPromptSha256(value: string): string {
    const normalized = value.replace(/\r\n?/g, '\n');
    const marker = '<!-- DANI_POST_CALL_EMAIL_END -->';
    const markerAt = normalized.lastIndexOf(marker);
    const managedSource = markerAt >= 0
        ? normalized.slice(0, markerAt + marker.length)
        : normalized.split('\n# TOOLS\n', 1)[0];
    const managed = `${managedSource.trim()}\n`;
    return createHash('sha256').update(managed, 'utf8').digest('hex');
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

export function inspectDaniPersonaReadiness(
    persona: PersonaPayload,
): DaniPersonaReadiness {
    const toolNames = toolNamesFromPersona(persona);
    const prompt = typeof persona.brain?.systemPrompt === 'string'
        ? persona.brain.systemPrompt
        : '';
    const personaIdMatches = persona.id === DANI_PERSONA_ID;
    const identityMatches = persona.name === DANI_EXPECTED_NAME;
    const publishedAtMs = typeof persona.publishedAt === 'string'
        ? Date.parse(persona.publishedAt)
        : Number.NaN;
    const publishedRevisionMatches = Number.isFinite(publishedAtMs)
        && publishedAtMs >= Date.parse(DANI_MINIMUM_PUBLISHED_AT);
    const cara4AvatarConfigured = persona.avatarModel === 'cara-4';
    const avatarIdMatches = avatarIdFromPersona(persona) === DANI_EXPECTED_AVATAR_ID;
    const voiceIdMatches = voiceIdFromPersona(persona) === DANI_EXPECTED_VOICE_ID;
    const llmIdMatches = llmIdFromPersona(persona) === DANI_EXPECTED_LLM_ID;
    const promptHashMatches = managedPromptSha256(prompt) === DANI_EXPECTED_PROMPT_SHA256;
    const voiceDetectionConfigured = Object.entries(DANI_REQUIRED_VOICE_DETECTION)
        .every(([name, value]) => persona.voiceDetectionOptions?.[name] === value);
    const sessionDataRetentionConfigured = persona.zeroDataRetention === false;
    const anamTranscriptionPipelineConfigured = persona.enableAudioPassthrough === false;
    const toolAttachmentMatches = daniToolAttachmentMatches(persona);
    const missingToolNames = DANI_REQUIRED_TOOL_NAMES.filter(name => !toolNames.has(name));
    const missingPromptMarkers = DANI_REQUIRED_PROMPT_MARKERS.filter(marker => !prompt.includes(marker));

    return {
        ready: personaIdMatches
            && identityMatches
            && publishedRevisionMatches
            && cara4AvatarConfigured
            && avatarIdMatches
            && voiceIdMatches
            && llmIdMatches
            && promptHashMatches
            && voiceDetectionConfigured
            && sessionDataRetentionConfigured
            && anamTranscriptionPipelineConfigured
            && toolAttachmentMatches
            && missingToolNames.length === 0
            && missingPromptMarkers.length === 0,
        personaIdMatches,
        identityMatches,
        publishedRevisionMatches,
        cara4AvatarConfigured,
        avatarIdMatches,
        voiceIdMatches,
        llmIdMatches,
        promptHashMatches,
        voiceDetectionConfigured,
        sessionDataRetentionConfigured,
        anamTranscriptionPipelineConfigured,
        toolAttachmentMatches,
        missingToolNames,
        missingPromptMarkers,
    };
}

export async function readDaniPersonaReadiness(
    apiKey: string,
    fetchImpl: typeof fetch = fetch,
): Promise<DaniPersonaReadiness> {
    const response = await fetchImpl(
        `${ANAM_API_BASE}/personas/${DANI_PERSONA_ID}`,
        {
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
            signal: AbortSignal.timeout(5_000),
            cache: 'no-store',
        },
    );
    if (!response.ok) {
        throw new Error(`Anam Dani readiness request failed (${response.status})`);
    }
    const persona = await response.json().catch(() => null) as PersonaPayload | null;
    if (!persona || typeof persona !== 'object') {
        throw new Error('Anam Dani readiness response was invalid');
    }
    return inspectDaniPersonaReadiness(persona);
}

