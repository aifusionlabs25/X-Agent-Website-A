import runtimeReleaseManifest from '../../config/anam/amy/v1/runtime-release-manifest.json' with { type: 'json' };
import knowledgeReleaseManifest from '../../config/anam/amy/v1/knowledge-manifest.json' with { type: 'json' };
import { createHash } from 'node:crypto';

const ANAM_API_BASE = 'https://api.anam.ai/v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const AMY_KNOWLEDGE_GROUP_DESCRIPTION_PREFIX = 'Amy-only public-safe KB. Bundle SHA-256: ';

export const AMY_RUNTIME_REQUIRED_TOOL_NAMES = Object.freeze([
    'Knowledge_Amy',
    'skip_turn',
    'confirm_live_identity',
    'send_follow_up_email',
    'show_live_notes',
    'show_session_brief',
    'show_solution_roadmap',
    'show_amy_intelligence',
    'show_visual_brief',
    'show_solution_catalog',
    'close_amy_intelligence',
    'end_amy_session',
]);

export const AMY_RUNTIME_MANAGED_PROMPT_MARKER_PAIRS = Object.freeze([
    Object.freeze({
        start: '<!-- AMY_CONVERSATION_NATURALNESS_START -->',
        end: '<!-- AMY_CONVERSATION_NATURALNESS_END -->',
    }),
    Object.freeze({
        start: '<!-- AMY_CORE_START -->',
        end: '<!-- AMY_CORE_END -->',
    }),
    Object.freeze({
        start: '<!-- AMY_WORKBENCH_START -->',
        end: '<!-- AMY_WORKBENCH_END -->',
    }),
    Object.freeze({
        start: '<!-- AMY_CARA4_RELIABILITY_START -->',
        end: '<!-- AMY_CARA4_RELIABILITY_END -->',
    }),
    Object.freeze({
        start: '<!-- AMY_PUBLIC_SECTOR_START -->',
        end: '<!-- AMY_PUBLIC_SECTOR_END -->',
    }),
    Object.freeze({
        start: '<!-- AMY_AGENTMAIL_START -->',
        end: '<!-- AMY_AGENTMAIL_END -->',
    }),
]);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
}

export const AMY_RUNTIME_RELEASE_MANIFEST = deepFreeze(runtimeReleaseManifest);
export const AMY_KNOWLEDGE_RELEASE_MANIFEST = deepFreeze(knowledgeReleaseManifest);

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function normalizePrompt(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n');
}

function sha256(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function idOf(value) {
    return typeof value?._toolId === 'string'
        ? value._toolId
        : typeof value?.id === 'string'
            ? value.id
            : '';
}

function avatarIdOf(persona) {
    return persona?.avatar?.id ?? persona?.avatarId ?? null;
}

function voiceIdOf(persona) {
    return persona?.voice?.id ?? persona?.voice?.voiceId ?? persona?.voiceId ?? null;
}

function llmIdOf(persona) {
    return persona?.brain?.llm?.id
        ?? persona?.brain?.llmId
        ?? persona?.llm?.id
        ?? persona?.llmId
        ?? null;
}

function positionsOf(value, marker) {
    const positions = [];
    let cursor = 0;
    while (cursor <= value.length) {
        const position = value.indexOf(marker, cursor);
        if (position < 0) break;
        positions.push(position);
        cursor = position + marker.length;
    }
    return positions;
}

export function inspectAmyRuntimeReleaseManifest(
    manifest = AMY_RUNTIME_RELEASE_MANIFEST,
    knowledgeManifest = AMY_KNOWLEDGE_RELEASE_MANIFEST,
) {
    const failures = [];
    if (!isRecord(manifest)) {
        return {
            valid: false,
            published: false,
            complete: false,
            ready: false,
            knowledgeManifestCrossPinMatches: false,
            failures: ['manifest.object'],
        };
    }

    const expectedTopLevel = [
        'schemaVersion',
        'releaseId',
        'deploymentStatus',
        'releasedAt',
        'persona',
        'prompt',
        'requiredTools',
        'knowledge',
    ].sort();
    if (!sameJson(Object.keys(manifest).sort(), expectedTopLevel)) failures.push('manifest.fields');
    if (manifest.schemaVersion !== 1) failures.push('manifest.schemaVersion');
    if (manifest.releaseId !== 'amy-anam-runtime-v1') failures.push('manifest.releaseId');
    if (!['draft', 'published'].includes(manifest.deploymentStatus)) failures.push('manifest.deploymentStatus');
    if (manifest.releasedAt !== null && (
        typeof manifest.releasedAt !== 'string'
        || !Number.isFinite(Date.parse(manifest.releasedAt))
    )) failures.push('manifest.releasedAt');

    const persona = isRecord(manifest.persona) ? manifest.persona : {};
    const expectedPersonaFields = [
        'id',
        'name',
        'avatarModel',
        'avatarId',
        'voiceId',
        'llmId',
        'initialMessage',
        'zeroDataRetention',
        'enableAudioPassthrough',
    ].sort();
    if (!sameJson(Object.keys(persona).sort(), expectedPersonaFields)) failures.push('manifest.persona.fields');
    for (const field of ['id', 'avatarId', 'voiceId', 'llmId']) {
        if (!UUID_PATTERN.test(String(persona[field] ?? ''))) failures.push(`manifest.persona.${field}`);
    }
    if (persona.name !== 'Amy Insight SDR - Cara 4 Canary') failures.push('manifest.persona.name');
    if (persona.avatarModel !== 'cara-4') failures.push('manifest.persona.avatarModel');
    if (persona.initialMessage !== "Hi, I'm Amy with Insight Enterprises. Who am I speaking with today?") {
        failures.push('manifest.persona.initialMessage');
    }
    if (persona.zeroDataRetention !== false) failures.push('manifest.persona.zeroDataRetention');
    if (persona.enableAudioPassthrough !== false) failures.push('manifest.persona.enableAudioPassthrough');

    const prompt = isRecord(manifest.prompt) ? manifest.prompt : {};
    if (!sameJson(Object.keys(prompt).sort(), ['managedMarkerPairs', 'sha256'])) failures.push('manifest.prompt.fields');
    if (prompt.sha256 !== null && !SHA256_PATTERN.test(String(prompt.sha256 ?? ''))) {
        failures.push('manifest.prompt.sha256');
    }
    if (!sameJson(prompt.managedMarkerPairs, AMY_RUNTIME_MANAGED_PROMPT_MARKER_PAIRS)) {
        failures.push('manifest.prompt.managedMarkerPairs');
    }

    const requiredTools = Array.isArray(manifest.requiredTools) ? manifest.requiredTools : [];
    const manifestToolNames = requiredTools.map(tool => isRecord(tool) ? tool.name : null);
    if (!sameJson(manifestToolNames, AMY_RUNTIME_REQUIRED_TOOL_NAMES)) {
        failures.push('manifest.requiredTools.names');
    }
    if (requiredTools.some(tool => (
        !isRecord(tool)
        || !sameJson(Object.keys(tool).sort(), ['id', 'name'])
        || (tool.id !== null && !UUID_PATTERN.test(String(tool.id ?? '')))
    ))) failures.push('manifest.requiredTools.entries');
    const manifestToolIds = requiredTools.map(tool => isRecord(tool) ? tool.id : null);
    const pinnedToolIds = manifestToolIds.filter(id => typeof id === 'string');
    if (new Set(pinnedToolIds).size !== pinnedToolIds.length) failures.push('manifest.requiredTools.uniqueIds');

    const knowledge = isRecord(manifest.knowledge) ? manifest.knowledge : {};
    if (!sameJson(Object.keys(knowledge).sort(), ['documentFolderIds', 'toolName', 'toolType'])) {
        failures.push('manifest.knowledge.fields');
    }
    if (knowledge.toolName !== 'Knowledge_Amy') failures.push('manifest.knowledge.toolName');
    if (knowledge.toolType !== 'SERVER_RAG') failures.push('manifest.knowledge.toolType');
    if (knowledge.documentFolderIds !== null && (
        !Array.isArray(knowledge.documentFolderIds)
        || knowledge.documentFolderIds.length !== 1
        || !UUID_PATTERN.test(String(knowledge.documentFolderIds[0] ?? ''))
    )) failures.push('manifest.knowledge.documentFolderIds');
    const knowledgeToolPin = requiredTools.find(tool => tool?.name === knowledge.toolName)?.id ?? null;
    const knowledgeManifestToolId = isRecord(knowledgeManifest)
        ? knowledgeManifest.liveToolId ?? null
        : null;
    const knowledgeManifestGroupId = isRecord(knowledgeManifest)
        ? knowledgeManifest.liveGroupId ?? null
        : null;
    const knowledgeManifestIdentityMatches = isRecord(knowledgeManifest)
        && knowledgeManifest.personaId === persona.id
        && knowledgeManifest.toolName === knowledge.toolName;
    const knowledgeManifestBundleMetadataValid = isRecord(knowledgeManifest)
        && typeof knowledgeManifest.folderName === 'string'
        && knowledgeManifest.folderName.length > 0
        && SHA256_PATTERN.test(String(knowledgeManifest.bundleSha256 ?? ''));
    if (!knowledgeManifestBundleMetadataValid) failures.push('manifest.knowledge.bundleMetadata');
    const allKnowledgePinsNull = knowledgeManifestIdentityMatches
        && knowledgeToolPin === null
        && knowledge.documentFolderIds === null
        && knowledgeManifestToolId === null
        && knowledgeManifestGroupId === null;
    const knowledgeManifestCrossPinMatches = allKnowledgePinsNull || (knowledgeManifestIdentityMatches
        && UUID_PATTERN.test(String(knowledgeToolPin ?? ''))
        && UUID_PATTERN.test(String(knowledgeManifestToolId ?? ''))
        && UUID_PATTERN.test(String(knowledgeManifestGroupId ?? ''))
        && knowledgeToolPin === knowledgeManifestToolId
        && sameJson(knowledge.documentFolderIds, [knowledgeManifestGroupId])
    );
    if (!knowledgeManifestCrossPinMatches) failures.push('manifest.knowledge.crossPin');

    const valid = failures.length === 0;
    const promptHashPinned = SHA256_PATTERN.test(String(prompt.sha256 ?? ''));
    const published = manifest.deploymentStatus === 'published'
        && typeof manifest.releasedAt === 'string'
        && promptHashPinned;
    const complete = valid
        && requiredTools.length === AMY_RUNTIME_REQUIRED_TOOL_NAMES.length
        && requiredTools.every(tool => UUID_PATTERN.test(String(tool.id ?? '')))
        && promptHashPinned
        && Array.isArray(knowledge.documentFolderIds)
        && knowledge.documentFolderIds.length === 1
        && knowledgeManifestCrossPinMatches;
    return {
        valid,
        published,
        complete,
        ready: valid && published && complete,
        knowledgeManifestCrossPinMatches,
        failures,
    };
}

function inspectManagedPrompt(prompt, markerPairs) {
    const missingPromptMarkers = [];
    const duplicatePromptMarkers = [];
    const misorderedPromptMarkerPairs = [];
    const overlappingPromptMarkerPairs = [];
    let previousEnd = -1;

    for (const pair of markerPairs) {
        const starts = positionsOf(prompt, pair.start);
        const ends = positionsOf(prompt, pair.end);
        if (starts.length === 0) missingPromptMarkers.push(pair.start);
        if (ends.length === 0) missingPromptMarkers.push(pair.end);
        if (starts.length > 1) duplicatePromptMarkers.push(pair.start);
        if (ends.length > 1) duplicatePromptMarkers.push(pair.end);
        if (starts.length !== 1 || ends.length !== 1) continue;
        if (ends[0] <= starts[0]) {
            misorderedPromptMarkerPairs.push(`${pair.start} -> ${pair.end}`);
            continue;
        }
        if (starts[0] <= previousEnd) {
            overlappingPromptMarkerPairs.push(`${pair.start} -> ${pair.end}`);
        }
        previousEnd = ends[0] + pair.end.length - 1;
    }

    return {
        matches: missingPromptMarkers.length === 0
            && duplicatePromptMarkers.length === 0
            && misorderedPromptMarkerPairs.length === 0
            && overlappingPromptMarkerPairs.length === 0,
        missingPromptMarkers,
        duplicatePromptMarkers,
        misorderedPromptMarkerPairs,
        overlappingPromptMarkerPairs,
    };
}

export function inspectAmyRuntimeRelease({
    persona,
    requestedPersonaId,
    knowledgeTool = null,
    knowledgeGroup = null,
    manifest = AMY_RUNTIME_RELEASE_MANIFEST,
    knowledgeManifest = AMY_KNOWLEDGE_RELEASE_MANIFEST,
}) {
    const manifestInspection = inspectAmyRuntimeReleaseManifest(manifest, knowledgeManifest);
    const expectedPersona = isRecord(manifest?.persona) ? manifest.persona : {};
    const expectedTools = Array.isArray(manifest?.requiredTools) ? manifest.requiredTools : [];
    const expectedKnowledge = isRecord(manifest?.knowledge) ? manifest.knowledge : {};
    const expectedToolNames = expectedTools
        .map(tool => isRecord(tool) && typeof tool.name === 'string' ? tool.name : '')
        .filter(Boolean);
    const expectedToolIds = new Map(expectedTools.map(tool => [tool?.name, tool?.id]));
    const actualTools = Array.isArray(persona?.tools) ? persona.tools : [];
    const actualToolNames = actualTools
        .map(tool => typeof tool?.name === 'string' ? tool.name.trim() : '')
        .filter(Boolean);
    const duplicateToolNames = [...new Set(actualToolNames.filter((name, index) => (
        actualToolNames.indexOf(name) !== index
    )))].sort();
    const actualToolIds = actualTools.map(idOf).filter(Boolean);
    const duplicateToolIds = [...new Set(actualToolIds.filter((id, index) => (
        actualToolIds.indexOf(id) !== index
    )))].sort();
    const missingToolNames = expectedToolNames.filter(name => !actualToolNames.includes(name));
    const unexpectedToolNames = actualToolNames.filter(name => !expectedToolNames.includes(name));
    const mismatchedToolNames = expectedToolNames.filter(name => {
        const matches = actualTools.filter(tool => tool?.name === name);
        return matches.length !== 1 || idOf(matches[0]) !== expectedToolIds.get(name);
    });
    const toolAttachmentMatches = manifestInspection.ready
        && actualTools.length === expectedTools.length
        && duplicateToolNames.length === 0
        && duplicateToolIds.length === 0
        && missingToolNames.length === 0
        && unexpectedToolNames.length === 0
        && mismatchedToolNames.length === 0;

    const prompt = normalizePrompt(persona?.brain?.systemPrompt);
    const markerPairs = Array.isArray(manifest?.prompt?.managedMarkerPairs)
        ? manifest.prompt.managedMarkerPairs
        : [];
    const markerInspection = inspectManagedPrompt(prompt, markerPairs);
    const expectedPromptSha256 = typeof manifest?.prompt?.sha256 === 'string'
        ? manifest.prompt.sha256
        : null;
    const promptSha256 = sha256(prompt);
    const promptHashPinned = SHA256_PATTERN.test(String(expectedPromptSha256 ?? ''));
    const promptHashMatches = promptHashPinned && promptSha256 === expectedPromptSha256;

    const knowledgeAttachment = actualTools.find(tool => tool?.name === expectedKnowledge.toolName) ?? null;
    const expectedKnowledgeToolId = expectedToolIds.get(expectedKnowledge.toolName) ?? null;
    const knowledgeToolIdMatches = manifestInspection.ready
        && idOf(knowledgeAttachment) === expectedKnowledgeToolId
        && idOf(knowledgeTool) === expectedKnowledgeToolId;
    const knowledgeToolNameMatches = knowledgeTool?.name === expectedKnowledge.toolName;
    const knowledgeToolTypeMatches = knowledgeTool?.type === expectedKnowledge.toolType;
    const knowledgeDocumentFolderIdsMatch = sameJson(
        knowledgeTool?.config?.documentFolderIds ?? null,
        expectedKnowledge.documentFolderIds ?? null,
    );
    const knowledgeToolMatches = knowledgeToolIdMatches
        && knowledgeToolNameMatches
        && knowledgeToolTypeMatches
        && knowledgeDocumentFolderIdsMatch;
    const expectedKnowledgeGroupId = isRecord(knowledgeManifest)
        ? knowledgeManifest.liveGroupId ?? null
        : null;
    const expectedKnowledgeGroupName = isRecord(knowledgeManifest)
        && typeof knowledgeManifest.folderName === 'string'
        ? knowledgeManifest.folderName
        : null;
    const expectedKnowledgeGroupDescription = isRecord(knowledgeManifest)
        && SHA256_PATTERN.test(String(knowledgeManifest.bundleSha256 ?? ''))
        ? `${AMY_KNOWLEDGE_GROUP_DESCRIPTION_PREFIX}${knowledgeManifest.bundleSha256}`
        : null;
    const knowledgeGroupIdMatches = manifestInspection.ready
        && knowledgeGroup?.id === expectedKnowledgeGroupId
        && sameJson(expectedKnowledge.documentFolderIds, [expectedKnowledgeGroupId]);
    const knowledgeGroupNameMatches = typeof expectedKnowledgeGroupName === 'string'
        && knowledgeGroup?.name === expectedKnowledgeGroupName;
    const knowledgeGroupDescriptionMatches = typeof expectedKnowledgeGroupDescription === 'string'
        && knowledgeGroup?.description === expectedKnowledgeGroupDescription;
    const knowledgeGroupMatches = knowledgeGroupIdMatches
        && knowledgeGroupNameMatches
        && knowledgeGroupDescriptionMatches;

    const personaIdMatches = persona?.id === requestedPersonaId
        && requestedPersonaId === expectedPersona.id;
    const identityMatches = persona?.name === expectedPersona.name;
    const cara4AvatarConfigured = persona?.avatarModel === expectedPersona.avatarModel;
    const avatarIdMatches = avatarIdOf(persona) === expectedPersona.avatarId;
    const voiceIdMatches = voiceIdOf(persona) === expectedPersona.voiceId;
    const llmIdMatches = llmIdOf(persona) === expectedPersona.llmId;
    const initialMessageMatches = persona?.initialMessage === expectedPersona.initialMessage;
    const sessionDataRetentionConfigured = persona?.zeroDataRetention === expectedPersona.zeroDataRetention;
    const anamTranscriptionPipelineConfigured = persona?.enableAudioPassthrough
        === expectedPersona.enableAudioPassthrough;

    const invariants = {
        releaseManifestValid: manifestInspection.valid,
        releaseManifestPublished: manifestInspection.published,
        releaseManifestComplete: manifestInspection.complete,
        knowledgeManifestCrossPinMatches: manifestInspection.knowledgeManifestCrossPinMatches,
        personaIdMatches,
        identityMatches,
        cara4AvatarConfigured,
        avatarIdMatches,
        voiceIdMatches,
        llmIdMatches,
        initialMessageMatches,
        sessionDataRetentionConfigured,
        anamTranscriptionPipelineConfigured,
        toolAttachmentMatches,
        promptMarkerContractMatches: markerInspection.matches,
        promptHashMatches,
        knowledgeToolMatches,
        knowledgeToolIdMatches,
        knowledgeToolNameMatches,
        knowledgeToolTypeMatches,
        knowledgeDocumentFolderIdsMatch,
        knowledgeGroupMatches,
        knowledgeGroupIdMatches,
        knowledgeGroupNameMatches,
        knowledgeGroupDescriptionMatches,
    };
    const failedInvariants = Object.entries(invariants)
        .filter(([, matches]) => !matches)
        .map(([name]) => name);

    return {
        ready: failedInvariants.length === 0,
        releaseId: typeof manifest?.releaseId === 'string' ? manifest.releaseId : null,
        deploymentStatus: typeof manifest?.deploymentStatus === 'string'
            ? manifest.deploymentStatus
            : null,
        ...invariants,
        promptHashPinned,
        promptSha256,
        expectedPromptSha256,
        missingToolNames,
        unexpectedToolNames,
        mismatchedToolNames,
        duplicateToolNames,
        duplicateToolIds,
        missingPromptMarkers: markerInspection.missingPromptMarkers,
        duplicatePromptMarkers: markerInspection.duplicatePromptMarkers,
        misorderedPromptMarkerPairs: markerInspection.misorderedPromptMarkerPairs,
        overlappingPromptMarkerPairs: markerInspection.overlappingPromptMarkerPairs,
        manifestFailures: manifestInspection.failures,
        failedInvariants,
    };
}

async function fetchJson(url, apiKey, fetchImpl, label) {
    const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5_000),
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`${label} request failed (${response.status})`);
    const payload = await response.json().catch(() => null);
    if (!isRecord(payload)) throw new Error(`${label} response was invalid`);
    return payload;
}

export async function readAmyRuntimeReleaseState(personaId, {
    apiKey,
    fetchImpl = fetch,
    manifest = AMY_RUNTIME_RELEASE_MANIFEST,
    knowledgeManifest = AMY_KNOWLEDGE_RELEASE_MANIFEST,
}) {
    const normalizedApiKey = String(apiKey ?? '').trim();
    if (!normalizedApiKey) throw new Error('Anam API key is unavailable');
    const persona = await fetchJson(
        `${ANAM_API_BASE}/personas/${encodeURIComponent(personaId)}`,
        normalizedApiKey,
        fetchImpl,
        'Anam persona readiness',
    );
    const manifestInspection = inspectAmyRuntimeReleaseManifest(manifest, knowledgeManifest);
    const knowledgeEntry = Array.isArray(manifest?.requiredTools)
        ? manifest.requiredTools.find(tool => tool?.name === manifest?.knowledge?.toolName)
        : null;
    const knowledgeTool = manifestInspection.ready && typeof knowledgeEntry?.id === 'string'
        ? fetchJson(
            `${ANAM_API_BASE}/tools/${encodeURIComponent(knowledgeEntry.id)}`,
            normalizedApiKey,
            fetchImpl,
            'Anam Amy knowledge-tool readiness',
        )
        : Promise.resolve(null);
    const knowledgeGroupId = manifestInspection.ready && isRecord(knowledgeManifest)
        ? knowledgeManifest.liveGroupId
        : null;
    const knowledgeGroup = typeof knowledgeGroupId === 'string'
        ? fetchJson(
            `${ANAM_API_BASE}/knowledge/groups/${encodeURIComponent(knowledgeGroupId)}`,
            normalizedApiKey,
            fetchImpl,
            'Anam Amy knowledge-group readiness',
        )
        : Promise.resolve(null);
    const [resolvedKnowledgeTool, resolvedKnowledgeGroup] = await Promise.all([
        knowledgeTool,
        knowledgeGroup,
    ]);
    return {
        persona,
        knowledgeTool: resolvedKnowledgeTool,
        knowledgeGroup: resolvedKnowledgeGroup,
        readiness: inspectAmyRuntimeRelease({
            persona,
            requestedPersonaId: personaId,
            knowledgeTool: resolvedKnowledgeTool,
            knowledgeGroup: resolvedKnowledgeGroup,
            manifest,
            knowledgeManifest,
        }),
    };
}
