import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    AMY_KNOWLEDGE_APPLY_CONFIRMATION,
    PINNED_AMY,
    amyManagedKnowledgeToolDescription,
    assertExpectedHash,
    assertPinnedProviderIdentity,
    captureAmyKnowledgeState,
    createAnamClient,
    describeGroupSnapshot,
    fetchCompletePersonaInventory,
    hashJson,
    idOf,
    isDedicatedAmyKnowledgeTool,
    knowledgeToolUsages,
    loadAmyKnowledgeBundle,
    providerFullView,
    providerProtectedView,
    readApiKey,
    requireCompleteList,
    repositoryRoot,
    snapshotKnowledgeGroup,
    stableJson,
    toolStateView,
} from './amy-knowledge-core.mjs';

const TARGET_GROUP_DESCRIPTION_PREFIX = 'Amy-only public-safe KB. Bundle SHA-256: ';
const ALLOWED_APPLY_STATUSES = new Set(['approved', 'publish_ready']);

export function readAmyKnowledgeCommand(args = []) {
    const valueOf = name => args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
    const known = [
        '--confirm=',
        '--backup-dir=',
        '--expected-provider-sha256=',
        '--expected-preview-sha256=',
        '--expected-source-tool-sha256=',
        '--expected-managed-tool-sha256=',
        '--expected-group-sha256=',
    ];
    const unknown = args.filter(value => value !== '--apply' && !known.some(prefix => value.startsWith(prefix)));
    if (unknown.length) throw new Error(`Unknown Amy knowledge migration argument: ${unknown[0]}`);
    return {
        apply: args.includes('--apply'),
        confirmation: valueOf('--confirm'),
        backupDirectory: valueOf('--backup-dir'),
        expectedProviderSha256: valueOf('--expected-provider-sha256'),
        expectedPreviewSha256: valueOf('--expected-preview-sha256'),
        expectedSourceToolSha256: valueOf('--expected-source-tool-sha256'),
        expectedManagedToolSha256: valueOf('--expected-managed-tool-sha256'),
        expectedGroupSha256: valueOf('--expected-group-sha256'),
    };
}

function sameIds(left, right) {
    return stableJson([...left].sort()) === stableJson([...right].sort());
}

function expectedSourceUsages(state, migrated) {
    const expectedPersonaIds = migrated
        ? [PINNED_AMY.previewPersonaId]
        : [PINNED_AMY.personaId, PINNED_AMY.previewPersonaId];
    return state.sourceToolUsages.every(usage => (
        usage.toolId === PINNED_AMY.sourceKnowledgeToolId
        && usage.toolName === PINNED_AMY.knowledgeToolName
    )) && sameIds(state.sourceToolUsages.map(usage => usage.personaId), expectedPersonaIds);
}

function inspectTargetSnapshot(state, bundle) {
    const snapshot = state.targetGroup
        ? state.groupSnapshots.find(group => group.id === state.targetGroup.id)
        : null;
    if (!snapshot) return { snapshot: null, unexpected: [], missing: bundle.manifest.documents, mismatched: [] };
    const allowlist = new Set(bundle.manifest.documents);
    const unexpected = snapshot.documents.filter(document => !allowlist.has(document.filename));
    const missing = bundle.manifest.documents.filter(filename => (
        !snapshot.documents.some(document => document.filename === filename)
    ));
    const mismatched = snapshot.documents.filter(document => {
        const expected = bundle.manifest.documentFingerprints[document.filename];
        return expected && document.status === 'READY'
            && (document.bytes !== expected.bytes || document.sha256 !== expected.sha256);
    });
    return { snapshot, unexpected, missing, mismatched };
}

export function buildAmyKnowledgeMigrationPlan(state, bundle, command) {
    const migrated = Boolean(bundle.manifest.liveToolId);
    const unpinnedSwapped = !migrated && state.currentToolId !== PINNED_AMY.sourceKnowledgeToolId;
    const firstIsolationApply = !migrated && !unpinnedSwapped;
    const blockers = [];
    const target = inspectTargetSnapshot(state, bundle);
    const expectedTargetDescription = `${TARGET_GROUP_DESCRIPTION_PREFIX}${bundle.bundleSha256}`;
    if (!expectedSourceUsages(state, migrated || unpinnedSwapped)) {
        blockers.push('The legacy Knowledge_Amy tool is attached outside the exact production/Preview isolation contract.');
    }
    if (migrated && !state.currentToolIsDedicated) {
        blockers.push('The manifest-pinned dedicated Knowledge_Amy tool is not isolated to production Amy.');
    }
    if (unpinnedSwapped && !state.currentToolIsDedicated) {
        blockers.push('Production Amy uses an unpinned managed knowledge tool that is not dedicated.');
    }
    let managedCandidateUsages = [];
    let managedCandidateExact = false;
    if (state.managedToolCandidate) {
        const candidateId = idOf(state.managedToolCandidate);
        managedCandidateUsages = knowledgeToolUsages(state.personaInventory.details, { toolId: candidateId });
        if (firstIsolationApply && managedCandidateUsages.length) {
            blockers.push('An unpinned managed Knowledge_Amy candidate is already attached to a persona.');
        }
        if (firstIsolationApply) {
            if (!state.targetGroup || !state.sourceTool) {
                blockers.push('The managed Knowledge_Amy orphan cannot be tied to the exact versioned group and source contract.');
            } else {
                managedCandidateExact = stableJson(toolStateView(state.managedToolCandidate)) === stableJson({
                    id: candidateId,
                    ...buildAmyDedicatedKnowledgeToolPayload(
                        state.sourceTool,
                        state.targetGroup.id,
                        bundle.bundleSha256,
                    ),
                });
                if (!managedCandidateExact) {
                    blockers.push('The managed Knowledge_Amy orphan differs from the exact clone-and-group contract.');
                }
            }
        }
    }
    const targetGroupToolReferences = state.targetGroup
        ? state.toolInventory.tools.filter(tool => (
            Array.isArray(tool?.config?.documentFolderIds)
            && tool.config.documentFolderIds.includes(state.targetGroup.id)
        )).map(tool => ({ id: idOf(tool), name: tool.name, type: tool.type }))
        : [];
    const allowedTargetToolIds = new Set([
        idOf(state.managedToolCandidate),
        migrated || unpinnedSwapped ? state.currentToolId : null,
    ].filter(Boolean));
    const foreignTargetGroupReferences = targetGroupToolReferences.filter(tool => !allowedTargetToolIds.has(tool.id));
    if (foreignTargetGroupReferences.length) {
        blockers.push('The versioned Amy target group is referenced by a foreign or pre-existing tool.');
    }
    if (target.snapshot?.duplicateFilenames.length) blockers.push('The versioned target group contains duplicate filenames.');
    if (target.unexpected.length) blockers.push('The versioned target group contains files outside the manifest allowlist.');
    if (target.mismatched.length) blockers.push('The versioned target group contains content that does not match the manifest.');
    if (state.targetGroup && state.targetGroup.description !== expectedTargetDescription) {
        blockers.push('The versioned target group description does not pin the exact managed bundle.');
    }

    const duplicateGroups = state.groupSnapshots
        .filter(snapshot => snapshot.duplicateFilenames.length)
        .map(snapshot => ({
            groupId: snapshot.id,
            groupName: snapshot.name,
            attachedToProduction: state.groupLandscape.attachedFolderIds.includes(snapshot.id),
            attachedToLegacySource: state.groupLandscape.sourceFolderIds.includes(snapshot.id),
            duplicateFilenames: snapshot.duplicateFilenames,
        }));
    const sameNameProviderEvidence = Object.values(
        state.toolInventory.tools.reduce((groups, tool) => {
            if (!groups[tool.name]) groups[tool.name] = [];
            groups[tool.name].push(idOf(tool));
            return groups;
        }, {}),
    ).filter(ids => ids.length > 1);
    const managedCandidateSha256 = state.managedToolCandidate
        ? hashJson(toolStateView(state.managedToolCandidate))
        : 'ABSENT';
    const finalReady = migrated
        && state.currentToolIsDedicated
        && target.snapshot
        && target.snapshot.duplicateFilenames.length === 0
        && target.unexpected.length === 0
        && target.missing.length === 0
        && target.mismatched.length === 0
        && state.groupLandscape.attachedFolderIds.length === 1
        && state.groupLandscape.attachedFolderIds[0] === state.targetGroup.id;
    return {
        result: blockers.length
            ? 'BLOCKED'
            : (finalReady ? 'PASS' : (unpinnedSwapped ? 'MANIFEST_PIN_REQUIRED' : 'MIGRATION_REQUIRED')),
        mode: command.apply ? 'apply' : 'dry-run',
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
            voiceId: PINNED_AMY.voiceId,
            llmId: PINNED_AMY.llmId,
            sourceKnowledgeToolId: PINNED_AMY.sourceKnowledgeToolId,
            liveKnowledgeToolId: bundle.manifest.liveToolId,
        },
        providerStateSha256: state.providerStateSha256,
        providerProtectedStateSha256: state.providerProtectedStateSha256,
        previewPersonaStateSha256: state.previewPersonaStateSha256,
        sourceKnowledgeToolStateSha256: state.sourceToolStateSha256,
        currentKnowledgeToolStateSha256: state.toolStateSha256,
        managedKnowledgeToolStateSha256: managedCandidateSha256,
        knowledgeGroupStateSha256: state.groupStateSha256,
        personaInventoryProof: {
            total: state.personaInventory.meta.total,
            currentPage: state.personaInventory.meta.currentPage,
            lastPage: state.personaInventory.meta.lastPage,
            perPage: state.personaInventory.meta.perPage,
            next: state.personaInventory.meta.next,
            detailCount: state.personaInventory.details.length,
            complete: state.personaInventory.details.length === state.personaInventory.meta.total,
        },
        sourceKnowledgeToolUsages: state.sourceToolUsages,
        currentKnowledgeToolUsages: state.currentToolUsages,
        targetGroup: {
            folderName: bundle.manifest.folderName,
            id: state.targetGroup?.id ?? null,
            willCreate: !state.targetGroup,
            manifestPinnedId: bundle.manifest.liveGroupId ?? null,
            missingDocuments: target.missing,
            toolReferences: targetGroupToolReferences,
        },
        ambiguityRecovery: {
            versionedGroup: state.targetGroup
                ? {
                    action: 'reuse_exact_named_isolated_group',
                    id: state.targetGroup.id,
                    isolated: foreignTargetGroupReferences.length === 0,
                    exactDescription: state.targetGroup.description === expectedTargetDescription,
                    unexpectedDocumentCount: target.unexpected.length,
                    duplicateFilenameCount: target.snapshot?.duplicateFilenames.length ?? 0,
                    mismatchedDocumentCount: target.mismatched.length,
                }
                : { action: 'create_versioned_group', id: null, isolated: true, exactDescription: null },
            managedTool: state.managedToolCandidate
                ? (firstIsolationApply ? {
                    action: managedCandidateExact && managedCandidateUsages.length === 0
                        ? 'reuse_exact_unattached_tool'
                        : 'block_non_exact_or_attached_candidate',
                    id: idOf(state.managedToolCandidate),
                    exactContract: managedCandidateExact,
                    personaAttachmentCount: managedCandidateUsages.length,
                } : {
                    action: 'not_applicable_tool_already_attached',
                    id: idOf(state.managedToolCandidate),
                    exactContract: null,
                    personaAttachmentCount: managedCandidateUsages.length,
                })
                : { action: 'create_dedicated_tool', id: null, exactContract: null, personaAttachmentCount: 0 },
            postTimeoutRerunIsIdempotent: true,
            deletesOrCleanupPerformed: false,
            legacyAndPreexistingStateRetained: true,
        },
        bundle: {
            sha256: bundle.bundleSha256,
            documentCount: bundle.documents.length,
            documents: bundle.documents.map(document => ({
                filename: document.filename,
                bytes: document.byteLength,
                sha256: document.sha256,
            })),
        },
        liveGroups: state.groupSnapshots.map(describeGroupSnapshot),
        liveDuplicateRisk: duplicateGroups,
        providerAllowsDuplicateToolNamesEvidence: sameNameProviderEvidence.length > 0,
        isolationAction: migrated
            ? 'verify_dedicated_attachment'
            : (unpinnedSwapped ? 'pin_live_tool_and_group_then_publish_and_audit' : 'create_new_tool_then_swap_production_attachment_only'),
        applyRequirements: {
            manifestDeploymentStatuses: [...ALLOWED_APPLY_STATUSES],
            confirmation: AMY_KNOWLEDGE_APPLY_CONFIRMATION,
            expectedProviderSha256: state.providerStateSha256,
            expectedPreviewSha256: state.previewPersonaStateSha256,
            expectedSourceToolSha256: state.sourceToolStateSha256,
            expectedManagedToolSha256: managedCandidateSha256,
            expectedGroupSha256: state.groupStateSha256,
            absoluteBackupOutsideRepository: true,
        },
        safety: {
            legacySharedToolPutAllowed: false,
            previewPersonaPutAllowed: false,
            productionPersonaToolSwapOnly: true,
            groupDeleteAllowed: false,
            documentDeleteAllowed: false,
            oldGroupsRetainedForRollback: true,
            agentMailContactAndCloseToolsPreserved: true,
        },
    };
}

function isOutsideDirectory(candidate, parent) {
    const relative = path.relative(parent, candidate);
    return Boolean(relative)
        && (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`));
}

export async function validateAmyKnowledgeApplyCommand(command, state, bundle, {
    fsImpl = fs,
    repositoryDirectory = repositoryRoot,
} = {}) {
    if (!ALLOWED_APPLY_STATUSES.has(bundle.manifest.deploymentStatus)) {
        throw new Error('Amy knowledge manifest deploymentStatus must be approved or publish_ready before --apply.');
    }
    if (/no external knowledge sync is authorized/i.test(bundle.manifest.sourcePolicy)) {
        throw new Error('Amy knowledge sourcePolicy still forbids external sync.');
    }
    if (command.confirmation !== AMY_KNOWLEDGE_APPLY_CONFIRMATION) {
        throw new Error(`--apply requires --confirm=${AMY_KNOWLEDGE_APPLY_CONFIRMATION}.`);
    }
    assertExpectedHash('Expected Amy provider hash', state.providerStateSha256, command.expectedProviderSha256);
    assertExpectedHash('Expected Amy Preview hash', state.previewPersonaStateSha256, command.expectedPreviewSha256);
    assertExpectedHash('Expected legacy Knowledge_Amy tool hash', state.sourceToolStateSha256, command.expectedSourceToolSha256);
    assertExpectedHash('Expected Amy knowledge group hash', state.groupStateSha256, command.expectedGroupSha256);
    const managedActual = state.managedToolCandidate
        ? hashJson(toolStateView(state.managedToolCandidate))
        : 'ABSENT';
    if (command.expectedManagedToolSha256 !== managedActual) {
        throw new Error('Expected managed Knowledge_Amy candidate hash does not match the current live state.');
    }
    if (!command.backupDirectory || !path.isAbsolute(command.backupDirectory)) {
        throw new Error('--apply requires an absolute --backup-dir outside the repository.');
    }
    const backupRoot = path.resolve(command.backupDirectory);
    if (!isOutsideDirectory(backupRoot, path.resolve(repositoryDirectory))) {
        throw new Error('Amy knowledge backup directory must be outside the repository.');
    }
    await fsImpl.mkdir(backupRoot, { recursive: true });
    const [realRepository, realBackupRoot] = await Promise.all([
        fsImpl.realpath(repositoryDirectory),
        fsImpl.realpath(backupRoot),
    ]);
    if (!isOutsideDirectory(realBackupRoot, realRepository)) {
        throw new Error('Amy knowledge backup directory resolves inside the repository.');
    }
    return realBackupRoot;
}

async function validateExistingTarget(snapshot, bundle, { allowPending }) {
    const allowlist = new Set(bundle.manifest.documents);
    const unexpected = snapshot.documents.filter(document => !allowlist.has(document.filename));
    if (unexpected.length) throw new Error('Target Amy group contains files outside the allowlist.');
    if (snapshot.duplicateFilenames.length) {
        throw new Error(`Target Amy group contains duplicate files: ${snapshot.duplicateFilenames.join(', ')}`);
    }
    for (const remote of snapshot.documents) {
        const expected = bundle.manifest.documentFingerprints[remote.filename];
        if (remote.status === 'FAILED') throw new Error(`Target Amy document processing failed: ${remote.filename}`);
        if (remote.status !== 'READY') {
            if (allowPending) continue;
            throw new Error(`Target Amy document is not READY: ${remote.filename}`);
        }
        if (remote.bytes !== expected.bytes || remote.sha256 !== expected.sha256) {
            throw new Error(`Target Amy document bytes differ from the manifest: ${remote.filename}`);
        }
    }
}

async function waitForExactTargetGroup({ anam, apiKey, fetchImpl, group, bundle }) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        const documents = requireCompleteList(
            await anam(`/knowledge/groups/${encodeURIComponent(group.id)}/documents`),
            `knowledge documents for ${group.id}`,
        );
        const allowlist = new Set(bundle.manifest.documents);
        if (documents.some(document => !allowlist.has(document.filename))) {
            throw new Error('Target Amy group gained a document outside the allowlist.');
        }
        const duplicateNames = bundle.manifest.documents.filter(filename => (
            documents.filter(document => document.filename === filename).length > 1
        ));
        if (duplicateNames.length) throw new Error(`Target Amy group gained duplicate files: ${duplicateNames.join(', ')}`);
        const failed = documents.find(document => document.status === 'FAILED');
        if (failed) throw new Error(`Target Amy knowledge processing failed: ${failed.filename}`);
        if (documents.length === bundle.documents.length && documents.every(document => document.status === 'READY')) {
            const snapshot = await snapshotKnowledgeGroup(anam, group, { apiKey, fetchImpl });
            await validateExistingTarget(snapshot, bundle, { allowPending: false });
            return snapshot;
        }
        await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    throw new Error('Timed out waiting for the exact Amy knowledge bundle to become READY.');
}

export function buildAmyDedicatedKnowledgeToolPayload(sourceTool, targetGroupId, bundleSha256) {
    const description = amyManagedKnowledgeToolDescription(bundleSha256);
    return {
        name: PINNED_AMY.knowledgeToolName,
        description,
        type: 'SERVER_RAG',
        disableInterruptions: sourceTool.disableInterruptions,
        config: {
            ...(sourceTool.config ?? {}),
            name: PINNED_AMY.knowledgeToolName,
            description,
            documentFolderIds: [targetGroupId],
        },
    };
}

export function buildAmyPersonaToolSwapPayload(persona, newKnowledgeToolId) {
    const currentIds = (persona.tools ?? []).map(idOf);
    if (
        currentIds.some(id => !id)
        || currentIds.filter(id => id === PINNED_AMY.sourceKnowledgeToolId).length !== 1
        || currentIds.includes(newKnowledgeToolId)
    ) {
        throw new Error('Production Amy tool attachments cannot be safely swapped.');
    }
    return {
        name: persona.name,
        description: persona.description,
        systemPrompt: persona.brain?.systemPrompt ?? '',
        initialMessage: persona.initialMessage,
        skipGreeting: persona.skipGreeting,
        uninterruptibleGreeting: persona.uninterruptibleGreeting,
        languageCode: persona.languageCode,
        toolIds: currentIds.map(id => (
            id === PINNED_AMY.sourceKnowledgeToolId ? newKnowledgeToolId : id
        )),
        voiceDetectionOptions: persona.voiceDetectionOptions,
        zeroDataRetention: persona.zeroDataRetention,
        enableAudioPassthrough: persona.enableAudioPassthrough,
    };
}

export function isExactProductionKnowledgeSwap(beforePersona, afterPersona, dedicatedToolId) {
    const beforeIds = (beforePersona?.tools ?? []).map(idOf);
    const afterIds = (afterPersona?.tools ?? []).map(idOf);
    const expectedIds = beforeIds.map(toolId => (
        toolId === PINNED_AMY.sourceKnowledgeToolId ? dedicatedToolId : toolId
    ));
    const knowledgeSlots = (afterPersona?.tools ?? []).filter(tool => (
        tool?.name === PINNED_AMY.knowledgeToolName
    ));
    return sameIds(afterIds, expectedIds)
        && knowledgeSlots.length === 1
        && idOf(knowledgeSlots[0]) === dedicatedToolId
        && ['server', 'SERVER_RAG'].includes(knowledgeSlots[0]?.type)
        && hashJson(providerProtectedView(afterPersona)) === hashJson(providerProtectedView(beforePersona));
}

async function fetchCompleteDetails(anam) {
    return (await fetchCompletePersonaInventory(anam)).details;
}

export async function executeAmyPersonaSwapTransaction({
    anam,
    swapPayload,
    rollbackPayload,
    verifyCommitted,
    verifyRollback,
}) {
    let commitError;
    try {
        // The rollback guard starts before awaiting this request. A provider may
        // commit the persona update even if the client observes a timeout.
        await anam(`/personas/${PINNED_AMY.personaId}`, {
            method: 'PUT',
            body: JSON.stringify(swapPayload),
        });
        return await verifyCommitted();
    } catch (error) {
        commitError = error;
    }

    let rollbackWriteError = null;
    try {
        await anam(`/personas/${PINNED_AMY.personaId}`, {
            method: 'PUT',
            body: JSON.stringify(rollbackPayload),
        });
    } catch (error) {
        // A rollback PUT can have the same ambiguous timeout semantics. Always
        // perform the authoritative read-back before declaring rollback failure.
        rollbackWriteError = error;
    }

    try {
        await verifyRollback();
    } catch (rollbackReadbackError) {
        const rollbackDetail = rollbackWriteError
            ? `${rollbackWriteError instanceof Error ? rollbackWriteError.message : String(rollbackWriteError)}; read-back: ${rollbackReadbackError instanceof Error ? rollbackReadbackError.message : String(rollbackReadbackError)}`
            : (rollbackReadbackError instanceof Error ? rollbackReadbackError.message : String(rollbackReadbackError));
        throw new Error(`Amy knowledge post-swap verification failed and automatic rollback also failed: ${commitError instanceof Error ? commitError.message : String(commitError)}; rollback: ${rollbackDetail}`);
    }

    throw new Error(`Amy knowledge post-swap verification failed; production Amy was automatically restored to the legacy tool: ${commitError instanceof Error ? commitError.message : String(commitError)}`);
}

export async function runAmyKnowledgeMigration(command, {
    apiKey,
    fetchImpl = fetch,
    manifestFileUrl,
    now = () => new Date(),
} = {}) {
    const bundle = await loadAmyKnowledgeBundle({ manifestFileUrl });
    const effectiveApiKey = apiKey ?? await readApiKey();
    const anam = createAnamClient({ apiKey: effectiveApiKey, fetchImpl });
    const before = await captureAmyKnowledgeState({ anam, apiKey: effectiveApiKey, bundle, fetchImpl });
    const plan = buildAmyKnowledgeMigrationPlan(before, bundle, command);
    if (!command.apply) return plan;
    if (plan.result === 'BLOCKED') throw new Error(`Amy knowledge migration is blocked: ${plan.blockers.join(' ')}`);
    if (before.currentToolId !== PINNED_AMY.sourceKnowledgeToolId) {
        throw new Error('Production Amy already uses an unpinned dedicated tool; pin liveToolId/liveGroupId and audit instead of applying again.');
    }
    if (bundle.manifest.liveToolId || bundle.manifest.liveGroupId) {
        throw new Error('This apply path is only for the guarded first clone-and-swap; pinned live IDs require audit-only verification.');
    }
    const backupRoot = await validateAmyKnowledgeApplyCommand(command, before, bundle);
    const timestamp = now().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupRoot, `amy-knowledge-pre-isolation-${timestamp}.json`);
    const previewPersona = before.personaInventory.details.find(persona => persona.id === PINNED_AMY.previewPersonaId);
    await fs.writeFile(backupPath, `${JSON.stringify({
        capturedAt: now().toISOString(),
        productionPersona: before.persona,
        previewPersona,
        legacySharedKnowledgeTool: before.sourceTool,
        managedToolCandidate: before.managedToolCandidate,
        sourceKnowledgeToolUsages: before.sourceToolUsages,
        groupLandscape: before.groupLandscape,
        rollback: {
            productionPersonaId: PINNED_AMY.personaId,
            restoreKnowledgeToolId: PINNED_AMY.sourceKnowledgeToolId,
            preservedLegacyFolderIds: before.groupLandscape.sourceFolderIds,
        },
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

    const groupDescription = `${TARGET_GROUP_DESCRIPTION_PREFIX}${bundle.bundleSha256}`;
    let targetGroup = before.targetGroup;
    if (!targetGroup) {
        targetGroup = await anam('/knowledge/groups', {
            method: 'POST',
            body: JSON.stringify({ name: bundle.manifest.folderName, description: groupDescription }),
        });
    } else {
        const snapshot = before.groupSnapshots.find(group => group.id === targetGroup.id);
        await validateExistingTarget(snapshot, bundle, { allowPending: true });
        if (targetGroup.description !== groupDescription) {
            throw new Error('Existing Amy target group is not the exact managed bundle identity; refusing to mutate it.');
        }
    }
    if (!targetGroup?.id) throw new Error('Anam did not return the versioned Amy group ID.');

    const existingDocuments = requireCompleteList(
        await anam(`/knowledge/groups/${encodeURIComponent(targetGroup.id)}/documents`),
        `knowledge documents for ${targetGroup.id}`,
    );
    for (const document of bundle.documents) {
        if (existingDocuments.some(candidate => candidate.filename === document.filename)) continue;
        const form = new FormData();
        form.append('file', new Blob([document.bytes], { type: 'text/markdown' }), document.filename);
        form.append('chunkSize', '800');
        form.append('chunkOverlap', '120');
        await anam(`/knowledge/groups/${encodeURIComponent(targetGroup.id)}/documents`, {
            method: 'POST',
            body: form,
        });
    }
    const targetSnapshot = await waitForExactTargetGroup({
        anam,
        apiKey: effectiveApiKey,
        fetchImpl,
        group: targetGroup,
        bundle,
    });

    // No persona or tool mutation occurs until all eight bytes/hashes are verified READY.
    const beforeToolCreation = await captureAmyKnowledgeState({
        anam,
        apiKey: effectiveApiKey,
        bundle,
        fetchImpl,
    });
    if (
        beforeToolCreation.providerStateSha256 !== before.providerStateSha256
        || beforeToolCreation.previewPersonaStateSha256 !== before.previewPersonaStateSha256
        || beforeToolCreation.sourceToolStateSha256 !== before.sourceToolStateSha256
        || !expectedSourceUsages(beforeToolCreation, false)
    ) throw new Error('Amy or the shared legacy tool changed while the target bundle was processing.');

    const toolPayload = buildAmyDedicatedKnowledgeToolPayload(
        before.sourceTool,
        targetGroup.id,
        bundle.bundleSha256,
    );
    let dedicatedTool = beforeToolCreation.managedToolCandidate;
    if (dedicatedTool) {
        const usages = knowledgeToolUsages(beforeToolCreation.personaInventory.details, { toolId: idOf(dedicatedTool) });
        if (usages.length || stableJson(toolStateView(dedicatedTool)) !== stableJson({
            id: idOf(dedicatedTool),
            ...toolPayload,
        })) {
            throw new Error('The reusable managed Knowledge_Amy candidate is attached or differs from the exact contract.');
        }
    } else {
        dedicatedTool = await anam('/tools', {
            method: 'POST',
            body: JSON.stringify(toolPayload),
        });
    }
    const dedicatedToolId = idOf(dedicatedTool);
    if (!dedicatedToolId || dedicatedToolId === PINNED_AMY.sourceKnowledgeToolId) {
        throw new Error('Anam did not create a distinct dedicated Amy knowledge tool.');
    }
    const verifiedDedicatedTool = await anam(`/tools/${encodeURIComponent(dedicatedToolId)}`);
    if (stableJson(toolStateView(verifiedDedicatedTool)) !== stableJson({
        id: dedicatedToolId,
        ...toolPayload,
    })) throw new Error('Dedicated Knowledge_Amy tool read-back differs from the exact contract.');

    const immediatelyBeforeSwap = await fetchCompleteDetails(anam);
    const productionBeforeSwap = immediatelyBeforeSwap.find(persona => persona.id === PINNED_AMY.personaId);
    const previewBeforeSwap = immediatelyBeforeSwap.find(persona => persona.id === PINNED_AMY.previewPersonaId);
    assertPinnedProviderIdentity(productionBeforeSwap);
    if (
        hashJson(providerFullView(productionBeforeSwap)) !== before.providerStateSha256
        || hashJson(providerFullView(previewBeforeSwap)) !== before.previewPersonaStateSha256
        || !expectedSourceUsages({
            sourceToolUsages: knowledgeToolUsages(immediatelyBeforeSwap, {
                toolId: PINNED_AMY.sourceKnowledgeToolId,
            }),
        }, false)
        || knowledgeToolUsages(immediatelyBeforeSwap, { toolId: dedicatedToolId }).length
    ) throw new Error('Final pre-swap persona isolation proof failed.');

    const swapPayload = buildAmyPersonaToolSwapPayload(productionBeforeSwap, dedicatedToolId);
    const rollbackPayload = {
        ...swapPayload,
        toolIds: (productionBeforeSwap.tools ?? []).map(idOf),
    };
    await executeAmyPersonaSwapTransaction({
        anam,
        swapPayload,
        rollbackPayload,
        verifyCommitted: async () => {
            const [afterPersonas, afterProduction, afterPreview, afterSourceTool, afterDedicatedTool] = await Promise.all([
                fetchCompleteDetails(anam),
                anam(`/personas/${PINNED_AMY.personaId}`),
                anam(`/personas/${PINNED_AMY.previewPersonaId}`),
                anam(`/tools/${PINNED_AMY.sourceKnowledgeToolId}`),
                anam(`/tools/${dedicatedToolId}`),
            ]);
            assertPinnedProviderIdentity(afterProduction);
            const sourceUsagesAfter = knowledgeToolUsages(afterPersonas, { toolId: PINNED_AMY.sourceKnowledgeToolId });
            const dedicatedUsagesAfter = knowledgeToolUsages(afterPersonas, { toolId: dedicatedToolId });
            if (!sameIds(sourceUsagesAfter.map(usage => usage.personaId), [PINNED_AMY.previewPersonaId])) {
                throw new Error('Legacy shared Knowledge_Amy attachment was not preserved exclusively on Preview.');
            }
            if (!isDedicatedAmyKnowledgeTool(dedicatedUsagesAfter, dedicatedToolId)) {
                throw new Error('New Knowledge_Amy tool is not isolated exclusively to production Amy.');
            }
            const beforeNonKnowledgeToolIds = (productionBeforeSwap.tools ?? [])
                .map(idOf)
                .filter(toolId => toolId !== PINNED_AMY.sourceKnowledgeToolId);
            const afterNonKnowledgeToolIds = (afterProduction.tools ?? [])
                .map(idOf)
                .filter(toolId => toolId !== dedicatedToolId);
            if (stableJson(afterNonKnowledgeToolIds) !== stableJson(beforeNonKnowledgeToolIds)) {
                throw new Error('A non-knowledge Amy tool attachment or its relative order changed during the swap.');
            }
            if (hashJson(providerProtectedView(afterProduction)) !== before.providerProtectedStateSha256) {
                throw new Error('Amy provider identity, prompt, settings, or non-knowledge tools changed during the swap.');
            }
            if (!isExactProductionKnowledgeSwap(before.persona, afterProduction, dedicatedToolId)) {
                throw new Error('Production Amy read-back differs from the exact one-tool-ID swap.');
            }
            if (hashJson(providerFullView(afterPreview)) !== before.previewPersonaStateSha256) {
                throw new Error('Amy Preview changed during production knowledge isolation.');
            }
            if (hashJson(toolStateView(afterSourceTool)) !== before.sourceToolStateSha256) {
                throw new Error('Legacy shared Knowledge_Amy tool changed during isolation.');
            }
            if (stableJson(toolStateView(afterDedicatedTool)) !== stableJson({
                id: dedicatedToolId,
                ...toolPayload,
            })) throw new Error('Dedicated Knowledge_Amy tool changed after attachment.');

            const verifiedTarget = await snapshotKnowledgeGroup(anam, targetGroup, {
                apiKey: effectiveApiKey,
                fetchImpl,
            });
            await validateExistingTarget(verifiedTarget, bundle, { allowPending: false });
            for (const oldGroupId of before.groupLandscape.sourceFolderIds) {
                const oldBefore = before.groupSnapshots.find(group => group.id === oldGroupId);
                const oldGroup = before.groups.find(group => group.id === oldGroupId);
                const oldAfter = await snapshotKnowledgeGroup(anam, oldGroup, {
                    apiKey: effectiveApiKey,
                    fetchImpl,
                });
                if (oldAfter.stateSha256 !== oldBefore.stateSha256) {
                    throw new Error(`Legacy rollback knowledge group changed unexpectedly: ${oldGroupId}`);
                }
            }
        },
        verifyRollback: async () => {
            const [rolledBackProduction, rolledBackPreview, rolledBackSourceTool] = await Promise.all([
                anam(`/personas/${PINNED_AMY.personaId}`),
                anam(`/personas/${PINNED_AMY.previewPersonaId}`),
                anam(`/tools/${PINNED_AMY.sourceKnowledgeToolId}`),
            ]);
            if (
                hashJson(providerFullView(rolledBackProduction)) !== before.providerStateSha256
                || hashJson(providerFullView(rolledBackPreview)) !== before.previewPersonaStateSha256
                || hashJson(toolStateView(rolledBackSourceTool)) !== before.sourceToolStateSha256
            ) throw new Error('automatic rollback read-back did not match the pre-apply state');
        },
    });

    return {
        ...plan,
        result: 'DRAFT_APPLIED_PUBLISH_AND_MANIFEST_PIN_REQUIRED',
        mutationPerformed: true,
        backupPath,
        targetGroupId: targetGroup.id,
        dedicatedKnowledgeToolId: dedicatedToolId,
        manifestUpdatesRequired: {
            liveGroupId: targetGroup.id,
            liveToolId: dedicatedToolId,
            deploymentStatus: 'live_verified_after_publish_and_audit',
        },
        providerStatePreservedExceptKnowledgeToolId: true,
        qwenAvatarVoicePromptAndSettingsPreserved: true,
        agentMailContactCloseAndAllNonKnowledgeToolsPreserved: true,
        previewPersonaUnchanged: true,
        legacySharedToolUnchanged: true,
        oldGroupsRetainedAndUnchanged: true,
        automaticPersonaRollbackArmed: true,
        verifiedDownloadedDocumentCount: targetSnapshot.documents.length,
        manualPublishRequired: true,
        nextStep: 'Pin liveGroupId/liveToolId in the manifest, publish Amy in Anam, then run the Amy knowledge audit before website release.',
    };
}

async function main() {
    const command = readAmyKnowledgeCommand(process.argv.slice(2));
    const result = await runAmyKnowledgeMigration(command);
    console.log(JSON.stringify(result, null, 2));
    if (result.result === 'BLOCKED') process.exitCode = 2;
}

const isEntrypoint = process.argv[1]
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
