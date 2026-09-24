const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export const JAMES_SOURCE_PERSONA_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8';

type JamesReleaseManifest = {
    deploymentStatus?: unknown;
    sourcePersona?: { id?: unknown; preserveAsRollback?: unknown };
    managedPersona?: { id?: unknown; zeroDataRetention?: unknown };
    prompt?: { sha256?: unknown };
    requiredTools?: Array<{ name?: unknown; id?: unknown }>;
    knowledge?: {
        toolName?: unknown;
        documentFolderIds?: unknown;
        documentsReady?: unknown;
    };
    privacyGate?: {
        status?: unknown;
        providerZeroDataRetention?: {
            verified?: unknown;
            verifiedAt?: unknown;
            evidenceReference?: unknown;
        };
        retainedTranscriptApproval?: {
            status?: unknown;
            approvedBy?: unknown;
            approvedAt?: unknown;
            evidenceReference?: unknown;
            scopeConfirmed?: unknown;
        };
    };
    liveVerification?: {
        status?: unknown;
        verifiedAt?: unknown;
        personaReadbackSha256?: unknown;
        knowledgeToolReadbackId?: unknown;
        knowledgeGroupReadbackId?: unknown;
        allDocumentsReady?: unknown;
        toolAttachmentsMatch?: unknown;
        promptHashMatches?: unknown;
        smokeTestsPassed?: unknown;
        sourcePersonaUnchanged?: unknown;
        priorCanaryUnchanged?: unknown;
    };
};

function hasTimestamp(value: unknown): boolean {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function hasEvidence(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length >= 8;
}

export function inspectJamesReleasePolicy(manifest: JamesReleaseManifest) {
    const failures: string[] = [];
    const sourceId = manifest?.sourcePersona?.id;
    const managedId = manifest?.managedPersona?.id;
    const privacyGate = manifest?.privacyGate;
    const providerZdr = privacyGate?.providerZeroDataRetention;
    const transcriptApproval = privacyGate?.retainedTranscriptApproval;
    const verification = manifest?.liveVerification;
    const requiredTools = Array.isArray(manifest?.requiredTools) ? manifest.requiredTools : [];
    const toolNames = requiredTools.map(tool => tool?.name);
    const toolIds = requiredTools.map(tool => tool?.id);
    const folderIds = manifest?.knowledge?.documentFolderIds;

    if (manifest?.deploymentStatus !== 'published') failures.push('release_not_published');
    if (sourceId !== JAMES_SOURCE_PERSONA_ID || manifest?.sourcePersona?.preserveAsRollback !== true) {
        failures.push('source_rollback_not_pinned');
    }
    if (!UUID_PATTERN.test(String(managedId ?? '')) || managedId === sourceId) {
        failures.push('managed_persona_not_isolated');
    }
    if (!SHA256_PATTERN.test(String(manifest?.prompt?.sha256 ?? ''))) failures.push('prompt_hash_not_pinned');
    if (toolNames.length !== 3 || new Set(toolNames).size !== 3
        || !toolNames.includes('Knowledge_James_Knowles_Law_Firm_2026_09')
        || !toolNames.includes('skip_turn')
        || !toolNames.includes('end_call')) {
        failures.push('required_tools_incomplete');
    }
    if (toolIds.length !== 3 || toolIds.some(id => !UUID_PATTERN.test(String(id ?? '')))
        || new Set(toolIds).size !== toolIds.length) {
        failures.push('tool_ids_not_pinned');
    }
    if (manifest?.knowledge?.toolName !== 'Knowledge_James_Knowles_Law_Firm_2026_09'
        || manifest?.knowledge?.documentsReady !== true
        || !Array.isArray(folderIds)
        || folderIds.length !== 1
        || !UUID_PATTERN.test(String(folderIds[0] ?? ''))) {
        failures.push('knowledge_bundle_not_ready');
    }

    const zeroRetentionApproved = manifest?.managedPersona?.zeroDataRetention === true
        && providerZdr?.verified === true
        && hasTimestamp(providerZdr.verifiedAt)
        && hasEvidence(providerZdr.evidenceReference);
    const retainedTranscriptApproved = transcriptApproval?.status === 'approved'
        && typeof transcriptApproval.approvedBy === 'string'
        && transcriptApproval.approvedBy.trim().length > 0
        && hasTimestamp(transcriptApproval.approvedAt)
        && hasEvidence(transcriptApproval.evidenceReference)
        && transcriptApproval.scopeConfirmed === true;
    if (privacyGate?.status !== 'approved' || (!zeroRetentionApproved && !retainedTranscriptApproved)) {
        failures.push('privacy_release_gate_closed');
    }

    const knowledgeToolId = requiredTools.find(tool => tool.name === manifest?.knowledge?.toolName)?.id;
    const knowledgeGroupId = Array.isArray(folderIds) ? folderIds[0] : null;
    if (verification?.status !== 'verified'
        || !hasTimestamp(verification.verifiedAt)
        || !SHA256_PATTERN.test(String(verification.personaReadbackSha256 ?? ''))
        || verification.knowledgeToolReadbackId !== knowledgeToolId
        || verification.knowledgeGroupReadbackId !== knowledgeGroupId
        || verification.allDocumentsReady !== true
        || verification.toolAttachmentsMatch !== true
        || verification.promptHashMatches !== true
        || verification.smokeTestsPassed !== true
        || verification.sourcePersonaUnchanged !== true
        || verification.priorCanaryUnchanged !== true) {
        failures.push('live_verification_incomplete');
    }

    return {
        ready: failures.length === 0,
        privacyMode: zeroRetentionApproved
            ? 'provider_zero_data_retention'
            : retainedTranscriptApproved
                ? 'documented_retained_transcript_approval'
                : 'blocked',
        failures,
    } as const;
}
