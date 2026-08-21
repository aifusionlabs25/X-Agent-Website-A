export type AmyRuntimeToolPin = {
    name: string;
    id: string | null;
};

export type AmyRuntimeReleaseManifest = {
    schemaVersion: number;
    releaseId: string;
    deploymentStatus: 'draft' | 'published' | string;
    releasedAt: string | null;
    persona: {
        id: string;
        name: string;
        avatarModel: string;
        avatarId: string;
        voiceId: string;
        llmId: string;
        initialMessage: string;
        zeroDataRetention: boolean;
        enableAudioPassthrough: boolean;
    };
    prompt: {
        sha256: string | null;
        managedMarkerPairs: Array<{ start: string; end: string }>;
    };
    requiredTools: AmyRuntimeToolPin[];
    knowledge: {
        toolName: string;
        toolType: string;
        documentFolderIds: string[] | null;
    };
};

export type AmyRuntimeReleaseReadiness = {
    ready: boolean;
    releaseId: string | null;
    deploymentStatus: string | null;
    releaseManifestValid: boolean;
    releaseManifestPublished: boolean;
    releaseManifestComplete: boolean;
    knowledgeManifestCrossPinMatches: boolean;
    personaIdMatches: boolean;
    identityMatches: boolean;
    cara4AvatarConfigured: boolean;
    avatarIdMatches: boolean;
    voiceIdMatches: boolean;
    llmIdMatches: boolean;
    initialMessageMatches: boolean;
    sessionDataRetentionConfigured: boolean;
    anamTranscriptionPipelineConfigured: boolean;
    toolAttachmentMatches: boolean;
    promptMarkerContractMatches: boolean;
    promptHashPinned: boolean;
    promptHashMatches: boolean;
    promptSha256: string;
    expectedPromptSha256: string | null;
    knowledgeToolMatches: boolean;
    knowledgeToolIdMatches: boolean;
    knowledgeToolNameMatches: boolean;
    knowledgeToolTypeMatches: boolean;
    knowledgeDocumentFolderIdsMatch: boolean;
    knowledgeGroupMatches: boolean;
    knowledgeGroupIdMatches: boolean;
    knowledgeGroupNameMatches: boolean;
    knowledgeGroupDescriptionMatches: boolean;
    missingToolNames: string[];
    unexpectedToolNames: string[];
    mismatchedToolNames: string[];
    duplicateToolNames: string[];
    duplicateToolIds: string[];
    missingPromptMarkers: string[];
    duplicatePromptMarkers: string[];
    misorderedPromptMarkerPairs: string[];
    overlappingPromptMarkerPairs: string[];
    manifestFailures: string[];
    failedInvariants: string[];
};

export const AMY_RUNTIME_REQUIRED_TOOL_NAMES: readonly string[];
export const AMY_RUNTIME_MANAGED_PROMPT_MARKER_PAIRS: readonly Readonly<{
    start: string;
    end: string;
}>[];
export const AMY_RUNTIME_RELEASE_MANIFEST: Readonly<AmyRuntimeReleaseManifest>;
export const AMY_KNOWLEDGE_RELEASE_MANIFEST: Readonly<{
    personaId: string;
    toolName: string;
    liveToolId: string | null;
    liveGroupId: string | null;
    folderName: string;
    bundleSha256: string;
    [key: string]: unknown;
}>;

export function inspectAmyRuntimeReleaseManifest(manifest?: unknown, knowledgeManifest?: unknown): {
    valid: boolean;
    published: boolean;
    complete: boolean;
    ready: boolean;
    knowledgeManifestCrossPinMatches: boolean;
    failures: string[];
};

export function inspectAmyRuntimeRelease(input: {
    persona: Record<string, unknown>;
    requestedPersonaId: string;
    knowledgeTool?: Record<string, unknown> | null;
    knowledgeGroup?: Record<string, unknown> | null;
    manifest?: AmyRuntimeReleaseManifest | unknown;
    knowledgeManifest?: unknown;
}): AmyRuntimeReleaseReadiness;

export function readAmyRuntimeReleaseState(
    personaId: string,
    options: {
        apiKey: string;
        fetchImpl?: typeof fetch;
        manifest?: AmyRuntimeReleaseManifest | unknown;
        knowledgeManifest?: unknown;
    },
): Promise<{
    persona: Record<string, unknown>;
    knowledgeTool: Record<string, unknown> | null;
    knowledgeGroup: Record<string, unknown> | null;
    readiness: AmyRuntimeReleaseReadiness;
}>;
