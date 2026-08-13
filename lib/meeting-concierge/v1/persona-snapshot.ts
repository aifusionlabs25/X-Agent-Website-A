const ANAM_API_URL = 'https://api.anam.ai/v1';

type SavedPersonaTool = {
    id?: string;
    _toolId?: string;
    name?: string;
    type?: string;
};

type SavedPersona = {
    id?: string;
    name?: string;
    avatar?: { id?: string } | null;
    voice?: { id?: string } | null;
    voiceSpeed?: number | null;
    llmId?: string | null;
    brain?: { systemPrompt?: string | null; personality?: string | null } | null;
    tools?: SavedPersonaTool[];
    skipGreeting?: boolean;
    uninterruptibleGreeting?: boolean;
    initialMessage?: string | null;
    zeroDataRetention?: boolean;
    voiceDetectionOptions?: Record<string, unknown> | null;
    voiceGenerationOptions?: Record<string, unknown> | null;
};

type MeetingPersonaSnapshotInput = {
    persona: SavedPersona;
    availableTools: SavedPersonaTool[];
    expectedPersonaId: string;
    removeToolNames: string[];
    addToolNames: string[];
    addToolTypes?: Record<string, string>;
    systemPromptSuffix: string;
    maxSessionLengthSeconds: number;
};

function toolId(tool: SavedPersonaTool) {
    return tool._toolId ?? tool.id ?? null;
}

function requiredUuid(value: unknown, label: string) {
    const text = typeof value === 'string' ? value : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
        throw new Error(`Saved meeting persona is missing ${label}`);
    }
    return text;
}

export function createMeetingPersonaSnapshot(input: MeetingPersonaSnapshotInput): Record<string, unknown> {
    const { persona } = input;
    if (persona.id !== input.expectedPersonaId) throw new Error('Saved meeting persona identity did not match');
    if (!Number.isInteger(input.maxSessionLengthSeconds) || input.maxSessionLengthSeconds < 60 || input.maxSessionLengthSeconds > 3_600) {
        throw new Error('Meeting duration limit was invalid');
    }
    const systemPrompt = String(persona.brain?.systemPrompt ?? '').trim();
    const suffix = input.systemPromptSuffix.trim();
    if (!systemPrompt || !suffix) throw new Error('Saved meeting persona prompt was unavailable');

    const removedNames = new Set(input.removeToolNames);
    const keptTools = (persona.tools ?? [])
        .filter(tool => !removedNames.has(String(tool.name ?? '')));
    if (keptTools.some(tool => !toolId(tool))) throw new Error('Saved meeting persona contained an unidentified tool');
    const currentIds = keptTools.map(tool => toolId(tool) as string);
    const addedIds = input.addToolNames.map(name => {
        const expectedType = input.addToolTypes?.[name]?.toUpperCase();
        const matches = input.availableTools.filter(tool => tool.name === name
            && toolId(tool)
            && (!expectedType || String(tool.type ?? '').toUpperCase() === expectedType));
        if (matches.length !== 1) throw new Error(`Required meeting tool was unavailable: ${name}`);
        return toolId(matches[0]) as string;
    });

    return {
        name: String(persona.name ?? 'X Agent'),
        avatarId: requiredUuid(persona.avatar?.id, 'avatar identity'),
        voiceId: requiredUuid(persona.voice?.id, 'voice identity'),
        llmId: requiredUuid(persona.llmId, 'LLM identity'),
        systemPrompt: `${systemPrompt}\n\n${suffix}`,
        toolIds: [...new Set([...currentIds, ...addedIds])],
        maxSessionLengthSeconds: input.maxSessionLengthSeconds,
        ...(typeof persona.voiceSpeed === 'number' ? { voiceSpeed: persona.voiceSpeed } : {}),
        ...(typeof persona.brain?.personality === 'string' && persona.brain.personality.trim()
            ? { personality: persona.brain.personality }
            : {}),
        ...(typeof persona.skipGreeting === 'boolean' ? { skipGreeting: persona.skipGreeting } : {}),
        ...(typeof persona.uninterruptibleGreeting === 'boolean' ? { uninterruptibleGreeting: persona.uninterruptibleGreeting } : {}),
        ...(typeof persona.initialMessage === 'string' || persona.initialMessage === null ? { initialMessage: persona.initialMessage } : {}),
        ...(typeof persona.zeroDataRetention === 'boolean' ? { zeroDataRetention: persona.zeroDataRetention } : {}),
        ...(persona.voiceDetectionOptions ? { voiceDetectionOptions: persona.voiceDetectionOptions } : {}),
        ...(persona.voiceGenerationOptions ? { voiceGenerationOptions: persona.voiceGenerationOptions } : {}),
    };
}

function listTools(payload: unknown): SavedPersonaTool[] {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        if (Array.isArray(record.data)) return record.data;
        if (Array.isArray(record.tools)) return record.tools;
    }
    return [];
}

async function anamJson(apiKey: string, pathname: string) {
    const response = await fetch(`${ANAM_API_URL}${pathname}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Anam meeting persona lookup failed (${response.status})`);
    return await response.json() as unknown;
}

export async function resolveMeetingPersonaSnapshot(input: Omit<MeetingPersonaSnapshotInput, 'persona' | 'availableTools'> & { apiKey: string }) {
    const [persona, tools] = await Promise.all([
        anamJson(input.apiKey, `/personas/${encodeURIComponent(input.expectedPersonaId)}`),
        anamJson(input.apiKey, '/tools?perPage=100'),
    ]);
    return createMeetingPersonaSnapshot({
        ...input,
        persona: persona as SavedPersona,
        availableTools: listTools(tools),
    });
}
