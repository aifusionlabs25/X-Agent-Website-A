import fs from 'node:fs/promises';
import {
    AMY_RUNTIME_RELEASE_MANIFEST,
    readAmyRuntimeReleaseState,
} from '../../lib/anam/amy-runtime-release-contract.mjs';

const EXPECTED_PERSONA_ID = AMY_RUNTIME_RELEASE_MANIFEST.persona.id;
const EXPECTED_LLM = Object.freeze({
    id: AMY_RUNTIME_RELEASE_MANIFEST.persona.llmId,
    name: 'Qwen 3.8 27b',
    releaseStage: 'Beta',
});

const localEnv = await fs.readFile(new URL('../../.env.local', import.meta.url), 'utf8').catch(() => '');
const env = Object.fromEntries(
    localEnv
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
            const at = line.indexOf('=');
            return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
        }),
);
const apiKey = process.env.ANAM_API_KEY?.trim() || env.ANAM_API_KEY?.trim();
const personaId = process.env.ANAM_AMY_CARA4_PERSONA_ID?.trim()
    || env.ANAM_AMY_CARA4_PERSONA_ID?.trim();

if (!apiKey) throw new Error('ANAM_API_KEY is required and is never printed.');
if (personaId !== EXPECTED_PERSONA_ID) {
    throw new Error('Refusing audit: configured Amy persona ID is not the pinned runtime-release identity.');
}

const {
    persona,
    knowledgeTool,
    knowledgeGroup,
    readiness,
} = await readAmyRuntimeReleaseState(personaId, { apiKey });
const prompt = String(persona.brain?.systemPrompt ?? '').replace(/\r\n?/g, '\n');
const managedSections = [...prompt.matchAll(/<!--\s*([^>]+?)\s*-->/g)].map(match => ({
    marker: match[1],
    characterOffset: match.index,
}));
const llmCheckpointMatches = readiness.llmIdMatches;
const attachedTools = Array.isArray(persona.tools) ? persona.tools : [];
const knowledgeToolId = knowledgeTool?._toolId ?? knowledgeTool?.id ?? null;

console.log(JSON.stringify({
    result: readiness.ready ? 'PASS' : 'FAIL',
    runtimeRelease: {
        releaseId: readiness.releaseId,
        deploymentStatus: readiness.deploymentStatus,
        manifestValid: readiness.releaseManifestValid,
        manifestPublished: readiness.releaseManifestPublished,
        manifestComplete: readiness.releaseManifestComplete,
        knowledgeManifestCrossPinMatches: readiness.knowledgeManifestCrossPinMatches,
    },
    personaId: persona.id ?? null,
    name: persona.name ?? null,
    avatarModel: persona.avatarModel ?? null,
    avatarId: persona.avatar?.id ?? persona.avatarId ?? null,
    voiceId: persona.voice?.id ?? persona.voiceId ?? null,
    llmId: persona.llmId ?? persona.brain?.llmId ?? persona.brain?.llm?.id ?? null,
    llmCheckpoint: {
        expectedId: EXPECTED_LLM.id,
        expectedName: EXPECTED_LLM.name,
        releaseStage: EXPECTED_LLM.releaseStage,
        matchesExpected: llmCheckpointMatches,
    },
    promptChars: prompt.length,
    promptWords: prompt.trim() ? prompt.trim().split(/\s+/).length : 0,
    promptSha256: readiness.promptSha256,
    expectedPromptSha256: readiness.expectedPromptSha256,
    promptHashPinned: readiness.promptHashPinned,
    promptHashMatches: readiness.promptHashMatches,
    managedSections,
    promptMarkerContract: {
        matches: readiness.promptMarkerContractMatches,
        missing: readiness.missingPromptMarkers,
        duplicate: readiness.duplicatePromptMarkers,
        misorderedPairs: readiness.misorderedPromptMarkerPairs,
        overlappingPairs: readiness.overlappingPromptMarkerPairs,
    },
    toolCount: attachedTools.length,
    toolNames: attachedTools.map(tool => tool?.name ?? null),
    toolAttachmentContract: {
        matches: readiness.toolAttachmentMatches,
        missing: readiness.missingToolNames,
        unexpected: readiness.unexpectedToolNames,
        mismatchedIds: readiness.mismatchedToolNames,
        duplicateNames: readiness.duplicateToolNames,
        duplicateIds: readiness.duplicateToolIds,
    },
    knowledgeTool: {
        id: knowledgeToolId,
        name: knowledgeTool?.name ?? null,
        type: knowledgeTool?.type ?? null,
        documentFolderIds: knowledgeTool?.config?.documentFolderIds ?? null,
        matches: readiness.knowledgeToolMatches,
        idMatches: readiness.knowledgeToolIdMatches,
        nameMatches: readiness.knowledgeToolNameMatches,
        typeMatches: readiness.knowledgeToolTypeMatches,
        documentFolderIdsMatch: readiness.knowledgeDocumentFolderIdsMatch,
    },
    knowledgeGroup: {
        id: knowledgeGroup?.id ?? null,
        name: knowledgeGroup?.name ?? null,
        description: knowledgeGroup?.description ?? null,
        matches: readiness.knowledgeGroupMatches,
        idMatches: readiness.knowledgeGroupIdMatches,
        nameMatches: readiness.knowledgeGroupNameMatches,
        descriptionMatches: readiness.knowledgeGroupDescriptionMatches,
    },
    initialMessage: persona.initialMessage ?? null,
    zeroDataRetention: persona.zeroDataRetention ?? null,
    enableAudioPassthrough: persona.enableAudioPassthrough ?? null,
    manifestFailures: readiness.manifestFailures,
    failedInvariants: readiness.failedInvariants,
}, null, 2));

if (!readiness.ready) {
    const llmFailure = llmCheckpointMatches
        ? ''
        : ` Amy LLM checkpoint mismatch: expected ${EXPECTED_LLM.name} (${EXPECTED_LLM.id}).`;
    throw new Error(
        `Amy runtime release audit failed: ${readiness.failedInvariants.join(', ') || 'unknown invariant'}.${llmFailure}`,
    );
}
