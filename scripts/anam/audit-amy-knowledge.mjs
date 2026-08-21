import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    PINNED_AMY,
    captureAmyKnowledgeState,
    createAnamClient,
    describeGroupSnapshot,
    isDedicatedAmyKnowledgeTool,
    loadAmyKnowledgeBundle,
    readApiKey,
} from './amy-knowledge-core.mjs';

export function buildAmyKnowledgeAuditReport(state, bundle) {
    const migrated = Boolean(bundle.manifest.liveToolId && bundle.manifest.liveGroupId);
    const unpinnedSwapped = !migrated && state.currentToolId !== PINNED_AMY.sourceKnowledgeToolId;
    const targetSnapshot = state.targetGroup
        ? state.groupSnapshots.find(group => group.id === state.targetGroup.id)
        : null;
    const allowlist = new Set(bundle.manifest.documents);
    const targetUnexpected = targetSnapshot?.documents.filter(document => !allowlist.has(document.filename)) ?? [];
    const targetMissing = bundle.manifest.documents.filter(filename => (
        !targetSnapshot?.documents.some(document => document.filename === filename)
    ));
    const targetMismatched = targetSnapshot?.documents.filter(document => {
        const expected = bundle.manifest.documentFingerprints[document.filename];
        return expected && (
            document.status !== 'READY'
            || document.bytes !== expected.bytes
            || document.sha256 !== expected.sha256
        );
    }) ?? [];
    const targetExact = Boolean(targetSnapshot)
        && targetSnapshot.duplicateFilenames.length === 0
        && targetUnexpected.length === 0
        && targetMissing.length === 0
        && targetMismatched.length === 0
        && targetSnapshot.documents.length === bundle.documents.length;
    const targetAttached = migrated
        && state.groupLandscape.attachedFolderIds.length === 1
        && state.groupLandscape.attachedFolderIds[0] === bundle.manifest.liveGroupId;
    const sourceExpectedPersonaIds = (migrated || unpinnedSwapped)
        ? [PINNED_AMY.previewPersonaId]
        : [PINNED_AMY.personaId, PINNED_AMY.previewPersonaId];
    const actualSourcePersonaIds = state.sourceToolUsages.map(usage => usage.personaId).sort();
    const sourceUsageExact = JSON.stringify(actualSourcePersonaIds)
        === JSON.stringify([...sourceExpectedPersonaIds].sort());
    const currentDedicated = isDedicatedAmyKnowledgeTool(
        state.currentToolUsages,
        migrated ? bundle.manifest.liveToolId : state.currentToolId,
    );
    const attachedSnapshots = state.groupSnapshots.filter(group => (
        state.groupLandscape.attachedFolderIds.includes(group.id)
    ));
    const attachedDuplicateRisk = attachedSnapshots
        .filter(group => group.duplicateFilenames.length)
        .map(group => ({
            groupId: group.id,
            groupName: group.name,
            duplicateFilenames: group.duplicateFilenames,
        }));
    const legacyDuplicateRisk = state.groupSnapshots
        .filter(group => (
            state.groupLandscape.sourceFolderIds.includes(group.id)
            && group.duplicateFilenames.length
        ))
        .map(group => ({
            groupId: group.id,
            groupName: group.name,
            duplicateFilenames: group.duplicateFilenames,
            retainedForRollback: true,
        }));
    const blockers = [];
    if (!sourceUsageExact) blockers.push('Legacy Knowledge_Amy attachment isolation differs from the expected migration phase.');
    if (migrated && !currentDedicated) blockers.push('The manifest-pinned Knowledge_Amy tool is not dedicated to production Amy.');
    if (migrated && !targetExact) blockers.push('The manifest-pinned Amy knowledge group is not an exact READY bundle.');
    if (migrated && !targetAttached) blockers.push('Production Amy is not attached exclusively to the manifest-pinned group.');
    if (migrated && attachedDuplicateRisk.length) blockers.push('Production Amy has duplicate filenames in its attached group.');

    const finalPass = migrated && !blockers.length && targetExact && targetAttached && currentDedicated;
    return {
        result: blockers.length ? 'BLOCKED' : (finalPass ? 'PASS' : 'MIGRATION_REQUIRED'),
        mutationPerformed: false,
        blockers,
        migrationPhase: migrated
            ? 'manifest_pinned_live_tool'
            : (unpinnedSwapped ? 'un_pinned_dedicated_tool_attached' : 'legacy_shared_tool_requires_clone_and_swap'),
        pinnedIdentity: {
            personaId: PINNED_AMY.personaId,
            previewPersonaId: PINNED_AMY.previewPersonaId,
            personaName: PINNED_AMY.name,
            avatarId: PINNED_AMY.avatarId,
            avatarModel: PINNED_AMY.avatarModel,
            voiceId: PINNED_AMY.voiceId,
            llmId: PINNED_AMY.llmId,
        },
        providerStateSha256: state.providerStateSha256,
        providerProtectedStateSha256: state.providerProtectedStateSha256,
        previewPersonaStateSha256: state.previewPersonaStateSha256,
        sourceKnowledgeTool: {
            id: PINNED_AMY.sourceKnowledgeToolId,
            stateSha256: state.sourceToolStateSha256,
            usages: state.sourceToolUsages,
            expectedPersonaIds: sourceExpectedPersonaIds,
            exactUsageVerified: sourceUsageExact,
        },
        currentKnowledgeTool: {
            id: state.currentToolId,
            name: state.tool.name,
            type: state.tool.type,
            stateSha256: state.toolStateSha256,
            documentFolderIds: state.groupLandscape.attachedFolderIds,
            usages: state.currentToolUsages,
            dedicatedToProductionAmy: currentDedicated,
        },
        personaInventoryProof: {
            total: state.personaInventory.meta.total,
            detailCount: state.personaInventory.details.length,
            currentPage: state.personaInventory.meta.currentPage,
            lastPage: state.personaInventory.meta.lastPage,
            perPage: state.personaInventory.meta.perPage,
            next: state.personaInventory.meta.next,
            complete: state.personaInventory.details.length === state.personaInventory.meta.total,
        },
        knowledgeGroupStateSha256: state.groupStateSha256,
        attachedDuplicateRisk,
        legacyDuplicateRisk,
        groups: state.groupSnapshots.map(describeGroupSnapshot),
        managedBundle: {
            folderName: bundle.manifest.folderName,
            groupId: state.targetGroup?.id ?? null,
            manifestLiveGroupId: bundle.manifest.liveGroupId,
            manifestLiveToolId: bundle.manifest.liveToolId,
            bundleSha256: bundle.bundleSha256,
            documentCount: bundle.documents.length,
            exactRemoteBundleVerified: targetExact,
            attachedExclusively: targetAttached,
            missingDocuments: targetMissing,
            unexpectedDocuments: targetUnexpected.map(document => document.filename),
            mismatchedDocuments: targetMismatched.map(document => document.filename),
        },
        releaseReadiness: {
            ready: finalPass,
            requiresDedicatedToolId: !bundle.manifest.liveToolId,
            requiresVersionedGroupId: !bundle.manifest.liveGroupId,
            requiresPublishAndPostPublishAudit: !finalPass,
            oldGroupRetainedForRollback: true,
        },
    };
}

async function main() {
    const bundle = await loadAmyKnowledgeBundle();
    const apiKey = await readApiKey();
    const anam = createAnamClient({ apiKey });
    const state = await captureAmyKnowledgeState({ anam, apiKey, bundle });
    const report = buildAmyKnowledgeAuditReport(state, bundle);
    console.log(JSON.stringify(report, null, 2));
    if (report.result !== 'PASS') process.exitCode = 2;
}

const isEntrypoint = process.argv[1]
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
