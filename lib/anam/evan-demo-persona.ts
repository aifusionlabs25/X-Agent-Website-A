import checkpoint from '../../config/anam/evan/demo-checkpoint.json' with { type: 'json' };

/** Pure, fail-closed preparation for duration-only copies of checkpoint Evan.
 * Creating/publishing a persona is deliberately outside this module. The caller
 * must GET the resulting clone and verify it before allowing any sessions.
 */
export const EVAN_DEMO_SOURCE_PERSONA_ID = '6097c73e-b6ef-48c5-94c7-9a95d4863b99';
export const EVAN_DEMO_ORIGINAL_PERSONA_ID = '4b7e933a-ea04-4b84-b418-72c0762545e6';
export const EVAN_DEMO_PUBLIC_PERSONA_ID = '3720fcf6-f9fd-4b7c-b384-af559d0c84b2';
export const EVAN_DEMO_EXTENDED_PERSONA_ID = '3934e7dc-b966-44f3-b19b-a453f147d22c';
export const EVAN_PUBLIC_DEMO_SECONDS = 180;
export const EVAN_EXTENDED_DEMO_SECONDS = 1_800;
export type EvanDemoDuration = typeof EVAN_PUBLIC_DEMO_SECONDS | typeof EVAN_EXTENDED_DEMO_SECONDS;

type JsonRecord = Record<string, unknown>;
export type EvanDemoSavedPersona = JsonRecord & {
    id?: string;
    name?: string;
    description?: string | null;
    avatar?: (JsonRecord & { id?: string }) | null;
    voice?: (JsonRecord & { id?: string }) | null;
    avatarId?: string;
    avatarModel?: string | null;
    voiceId?: string;
    llmId?: string | null;
    brain?: (JsonRecord & { systemPrompt?: string | null; personality?: string | null }) | null;
    tools?: JsonRecord[];
    maxSessionLengthSeconds?: number | null;
};

export type EvanDemoClonePayload = JsonRecord & {
    name: string;
    description: string;
    avatarId: string;
    avatarModel: string;
    voiceId: string;
    llmId: string;
    systemPrompt: string;
    toolIds: string[];
    maxSessionLengthSeconds: EvanDemoDuration;
};

const READ_ONLY_FIELDS = new Set([
    'id', 'name', 'description', 'createdAt', 'updatedAt', 'publishedAt',
    'publishedCall', 'createdByOrganizationId', 'organizationId', 'isDefaultPersona',
    // A new persona must not inherit a source persona's public access links.
    'shareLinks', 'primaryShareLink',
]);
const BEHAVIOR_FIELDS = new Set([
    'avatar', 'avatarId', 'avatarModel', 'voice', 'voiceId', 'llmId', 'brain',
    'tools', 'maxSessionLengthSeconds', 'voiceSpeed', 'directorNotes', 'brainType',
    'skipGreeting', 'uninterruptibleGreeting', 'initialMessage', 'zeroDataRetention',
    'voiceDetectionOptions', 'voiceGenerationOptions', 'languageCode',
    'enableAudioPassthrough', 'knowledge', 'widgetConfig', 'personaPreset',
]);
const COPY_FIELDS = [
    'skipGreeting', 'uninterruptibleGreeting', 'initialMessage', 'zeroDataRetention',
    'voiceDetectionOptions', 'voiceGenerationOptions', 'languageCode',
    // These legacy fields are returned by the provider but are not all listed
    // in its current create schema. Send them explicitly, and never accept a
    // clone if the provider ignores or changes them on readback.
    'voiceSpeed', 'directorNotes', 'widgetConfig',
] as const;

function fail(message: string): never {
    // Only field names are exposed, never prompts, contact data or access links.
    throw new Error(`Evan duration clone: ${message}`);
}

function record(value: unknown, field: string): JsonRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid ${field}`);
    return value as JsonRecord;
}

function identifier(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        fail(`invalid ${field}`);
    }
    return value;
}

function sameId(primary: unknown, alias: unknown, field: string): string {
    if (primary != null && alias != null && primary !== alias) fail(`conflicting ${field}`);
    return identifier(primary ?? alias, field);
}

function absentOrEmpty(value: unknown): boolean {
    return value == null || value === '' || value === false || value === 0
        || (Array.isArray(value) && value.length === 0)
        || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);
}

function stable(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
        }
        return item;
    });
}

/** Anam generates the # TOOLS appendix from attached definitions. It is not an
 * authored prompt and must never be submitted back as a second prompt layer. */
export function managedEvanDemoPrompt(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) fail('missing systemPrompt');
    return `${value.replace(/\r\n?/g, '\n').split('\n# TOOLS\n', 1)[0].trim()}\n`;
}

const TOOL_METADATA = new Set(['id', '_toolId', 'createdAt', 'updatedAt', 'usageCount', 'organizationId', 'createdByOrganizationId']);
const TOOL_ENVELOPE = new Set(['name', 'description', 'type', 'subtype', 'config', 'disableInterruptions']);

/** The persona API flattens tool config; the tools API wraps it in config. */
export function evanDemoToolBehavior(value: unknown): JsonRecord {
    const tool = record(value, 'tool');
    if (typeof tool.name !== 'string' || !tool.name.trim()) fail('invalid tool name');
    let type = String(tool.type ?? '').toUpperCase();
    if (type === 'SERVER' && String(tool.subtype).toUpperCase() === 'RAG') type = 'SERVER_RAG';
    if (!['SYSTEM', 'CLIENT', 'SERVER_RAG', 'SERVER_WEBHOOK'].includes(type)) fail('unsupported tool type');
    if (typeof tool.description !== 'string') fail('invalid tool description');
    const config = tool.config == null ? {} : structuredClone(record(tool.config, 'tool config'));
    for (const [key, item] of Object.entries(tool)) {
        if (TOOL_METADATA.has(key) || TOOL_ENVELOPE.has(key)) continue;
        if (Object.hasOwn(config, key) && stable(config[key]) !== stable(item)) fail(`conflicting tool config.${key}`);
        config[key] = structuredClone(item);
    }
    if (tool.disableInterruptions != null && typeof tool.disableInterruptions !== 'boolean') fail('invalid tool interruptions');
    return { name: tool.name, description: tool.description, type, disableInterruptions: tool.disableInterruptions ?? false, config };
}

export function assertEvanDemoToolMatches(expected: unknown, actual: unknown): void {
    if (stable(evanDemoToolBehavior(expected)) !== stable(evanDemoToolBehavior(actual))) fail('readback changed tool definition');
}

export const EVAN_DEMO_CHECKPOINT = Object.freeze({
    ref: checkpoint.checkpointRef,
    sourceCommit: checkpoint.sourceCommit,
    testedApplicationCommit: checkpoint.testedApplicationCommit,
    managedPromptSha256: checkpoint.managedPromptSha256,
});

export function expectedEvanDemoCheckpoint(): EvanDemoSavedPersona {
    if (checkpoint.schemaVersion !== 1 || checkpoint.persona.id !== EVAN_DEMO_SOURCE_PERSONA_ID) fail('invalid frozen checkpoint');
    const source = structuredClone(checkpoint.persona) as EvanDemoSavedPersona;
    evanDemoPersonaBehavior(source);
    return source;
}

export function buildEvanDemoPlannerToolPayload(source: EvanDemoSavedPersona = expectedEvanDemoCheckpoint()): JsonRecord {
    if (source.id !== EVAN_DEMO_SOURCE_PERSONA_ID) fail('source identity did not match checkpoint Evan');
    const planner = source.tools?.filter(tool => tool.name === 'show_move_planner');
    if (planner?.length !== 1) fail('missing unique planner tool');
    const behavior = evanDemoToolBehavior(planner[0]);
    if (behavior.type !== 'CLIENT') fail('planner must be a client tool');
    return structuredClone(behavior);
}

function duration(value: unknown): EvanDemoDuration {
    if (value !== EVAN_PUBLIC_DEMO_SECONDS && value !== EVAN_EXTENDED_DEMO_SECONDS) {
        fail('duration must be the public or protected demo policy');
    }
    return value;
}

/** Returns behavior only. Asset preview URLs and publish bookkeeping are not
 * behavior; asset/tool identities point to the exact same existing resources.
 */
export function evanDemoPersonaBehavior(persona: EvanDemoSavedPersona): JsonRecord {
    record(persona, 'persona');
    for (const [field, value] of Object.entries(persona)) {
        if (!READ_ONLY_FIELDS.has(field) && !BEHAVIOR_FIELDS.has(field) && value != null) {
            fail(`unsupported nondefault field ${field}`);
        }
    }
    const brain = record(persona.brain, 'brain');
    for (const [field, value] of Object.entries(brain)) {
        if (!['systemPrompt', 'personality', 'llmId'].includes(field) && value != null) {
            fail(`unsupported nondefault brain.${field}`);
        }
    }
    if (typeof brain.systemPrompt !== 'string' || !brain.systemPrompt.trim()) fail('missing systemPrompt');
    if (brain.personality != null && typeof brain.personality !== 'string') fail('invalid brain.personality');
    if (!Array.isArray(persona.tools)) fail('missing tools');
    const toolIds = persona.tools.map((tool) => {
        record(tool, 'tool');
        return identifier(tool._toolId ?? tool.id, 'tool identity');
    }).sort();
    if (new Set(toolIds).size !== toolIds.length) fail('duplicate tool identity');
    if (typeof persona.avatarModel !== 'string' || !persona.avatarModel.trim()) fail('missing avatarModel');
    for (const field of ['enableAudioPassthrough', 'knowledge', 'personaPreset']) {
        if (!absentOrEmpty(persona[field])) fail(`unsupported nondefault field ${field}`);
    }
    for (const field of ['skipGreeting', 'uninterruptibleGreeting', 'zeroDataRetention', 'enableAudioPassthrough']) {
        if (persona[field] != null && typeof persona[field] !== 'boolean') fail(`invalid ${field}`);
    }
    for (const field of ['initialMessage', 'languageCode']) {
        if (persona[field] != null && typeof persona[field] !== 'string') fail(`invalid ${field}`);
    }
    for (const field of ['voiceDetectionOptions', 'voiceGenerationOptions', 'widgetConfig']) {
        if (persona[field] != null) record(persona[field], field);
    }
    if (persona.voiceSpeed != null && (typeof persona.voiceSpeed !== 'number' || !Number.isFinite(persona.voiceSpeed))) fail('invalid voiceSpeed');
    const behavior: JsonRecord = {
        avatarId: sameId(persona.avatar?.id, persona.avatarId, 'avatar identity'),
        avatarModel: persona.avatarModel,
        voiceId: sameId(persona.voice?.id, persona.voiceId, 'voice identity'),
        llmId: sameId(persona.llmId, brain.llmId, 'LLM identity'),
        systemPrompt: managedEvanDemoPrompt(brain.systemPrompt),
        personality: brain.personality ?? null,
        toolIds,
        tools: persona.tools.map(evanDemoToolBehavior).sort((a, b) => String(a.name).localeCompare(String(b.name))),
        brainType: persona.brainType ?? null,
        enableAudioPassthrough: persona.enableAudioPassthrough ?? false,
        knowledge: persona.knowledge ?? [],
        personaPreset: persona.personaPreset ?? '',
    };
    for (const field of COPY_FIELDS) {
        const value = persona[field];
        // Preserve false, zero, null and empty strings rather than truthy-copying.
        behavior[field] = value === undefined ? null : structuredClone(value);
    }
    return behavior;
}

export function buildEvanDemoClonePayload(input: {
    source: EvanDemoSavedPersona;
    name: string;
    description: string;
    maxSessionLengthSeconds: EvanDemoDuration;
    plannerToolId?: string;
}): EvanDemoClonePayload {
    if (input.source.id !== EVAN_DEMO_SOURCE_PERSONA_ID) fail('source identity did not match checkpoint Evan');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 191) fail('invalid clone name');
    if (typeof input.description !== 'string') fail('invalid clone description');
    const behavior = evanDemoPersonaBehavior(input.source);
    const payload: EvanDemoClonePayload = {
        name: input.name,
        description: input.description,
        avatarId: behavior.avatarId as string,
        avatarModel: behavior.avatarModel as string,
        voiceId: behavior.voiceId as string,
        llmId: behavior.llmId as string,
        systemPrompt: behavior.systemPrompt as string,
        toolIds: [...behavior.toolIds as string[]],
        maxSessionLengthSeconds: duration(input.maxSessionLengthSeconds),
    };
    for (const field of COPY_FIELDS) {
        if (Object.hasOwn(input.source, field)) payload[field] = structuredClone(input.source[field]);
    }
    if (Object.hasOwn(input.source.brain as JsonRecord, 'personality')) payload.personality = behavior.personality;
    if (!absentOrEmpty(behavior.brainType)) payload.brainType = behavior.brainType;
    if (input.plannerToolId !== undefined) {
        const replacement = identifier(input.plannerToolId, 'planner tool identity');
        const planner = input.source.tools?.find(tool => tool.name === 'show_move_planner');
        if (!planner) fail('missing planner tool');
        const original = identifier(planner._toolId ?? planner.id, 'original planner tool identity');
        payload.toolIds = payload.toolIds.map(id => id === original ? replacement : id).sort();
        if (new Set(payload.toolIds).size !== payload.toolIds.length) fail('duplicate mapped tool identity');
    }
    payload.enableAudioPassthrough = behavior.enableAudioPassthrough;
    return payload;
}

export function assertEvanDemoCloneMatches(input: {
    source: EvanDemoSavedPersona;
    clone: EvanDemoSavedPersona;
    expectedCloneId: string;
    maxSessionLengthSeconds: EvanDemoDuration;
    plannerToolId?: string;
}): void {
    if (input.source.id !== EVAN_DEMO_SOURCE_PERSONA_ID) fail('source identity did not match checkpoint Evan');
    if ([input.source.id, EVAN_DEMO_ORIGINAL_PERSONA_ID].includes(input.expectedCloneId)) fail('clone must not be a protected source persona');
    identifier(input.expectedCloneId, 'expected clone identity');
    if (input.clone.id !== input.expectedCloneId) fail('clone identity did not match');
    if (input.clone.maxSessionLengthSeconds !== duration(input.maxSessionLengthSeconds)) fail('duration readback did not match');
    const sourceBehavior = evanDemoPersonaBehavior(input.source);
    const cloneBehavior = evanDemoPersonaBehavior(input.clone);
    for (const field of Object.keys(sourceBehavior)) {
        if (field === 'toolIds') continue;
        if (stable(sourceBehavior[field]) !== stable(cloneBehavior[field])) fail(`readback changed ${field}`);
    }
    const expectedTools = input.source.tools!;
    const actualTools = input.clone.tools!;
    if (new Set(actualTools.map(tool => tool.name)).size !== actualTools.length) fail('duplicate tool name');
    for (const expected of expectedTools) {
        const actual = actualTools.find(tool => tool.name === expected.name);
        if (!actual) fail('readback changed tools');
        const originalId = identifier(expected._toolId ?? expected.id, 'original tool identity');
        const actualId = identifier(actual._toolId ?? actual.id, 'clone tool identity');
        // This is the only historically changed tool. A remapped identity is
        // allowed only because the complete definition was compared above.
        const allowedId = expected.name === 'show_move_planner' ? input.plannerToolId : originalId;
        if (allowedId !== undefined && actualId !== allowedId) fail('readback changed tool identity');
        if (expected.name !== 'show_move_planner' && actualId !== originalId) fail('readback changed tool identity');
    }
}
