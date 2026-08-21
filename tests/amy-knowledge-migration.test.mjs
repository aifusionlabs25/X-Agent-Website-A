import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
    AMY_KNOWLEDGE_APPLY_CONFIRMATION,
    PINNED_AMY,
    fetchCompletePersonaInventory,
    fetchCompleteToolInventory,
    hashJson,
    isDedicatedAmyKnowledgeTool,
    loadAmyKnowledgeBundle,
    providerFullView,
    providerProtectedView,
    requireCompleteList,
    repositoryRoot,
    toolStateView,
} from '../scripts/anam/amy-knowledge-core.mjs';
import {
    buildAmyKnowledgeMigrationPlan,
    buildAmyDedicatedKnowledgeToolPayload,
    buildAmyPersonaToolSwapPayload,
    executeAmyPersonaSwapTransaction,
    isExactProductionKnowledgeSwap,
    readAmyKnowledgeCommand,
    validateAmyKnowledgeApplyCommand,
} from '../scripts/anam/update-amy-knowledge.mjs';
import { buildAmyKnowledgeAuditReport } from '../scripts/anam/audit-amy-knowledge.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('Amy knowledge bundle is an exact, versioned, Amy-only allowlist', async () => {
    const bundle = await loadAmyKnowledgeBundle();
    assert.equal(bundle.manifest.schemaVersion, 1);
    assert.equal(bundle.manifest.personaId, PINNED_AMY.personaId);
    assert.equal(bundle.manifest.sourceToolId, PINNED_AMY.sourceKnowledgeToolId);
    if (bundle.manifest.deploymentStatus === 'draft') {
        assert.equal(bundle.manifest.liveToolId, null);
        assert.equal(bundle.manifest.liveGroupId, null);
    } else {
        assert.match(bundle.manifest.liveToolId, /^[0-9a-f-]{36}$/i);
        assert.match(bundle.manifest.liveGroupId, /^[0-9a-f-]{36}$/i);
    }
    assert.equal(bundle.manifest.toolName, PINNED_AMY.knowledgeToolName);
    assert.match(bundle.manifest.folderName, /^Amy Insight SDR Anam KB \d{4}-\d{2}-\d{2} v\d+$/);
    assert.equal(bundle.documents.length, bundle.manifest.documents.length);
    assert.equal(bundle.bundleSha256, bundle.manifest.bundleSha256);
});

test('apply command requires approval status, confirmation, live hashes, and a real outside backup', async () => {
    const state = {
        providerStateSha256: HASH_A,
        previewPersonaStateSha256: HASH_A,
        sourceToolStateSha256: HASH_A,
        groupStateSha256: HASH_A,
        managedToolCandidate: null,
    };
    const bundle = {
        manifest: {
            deploymentStatus: 'approved',
            sourcePolicy: 'Approved for guarded external knowledge sync.',
        },
    };
    const outsideBackup = path.resolve(repositoryRoot, '..', 'amy-anam-knowledge-backups');
    const fsImpl = {
        mkdir: async () => undefined,
        realpath: async value => path.resolve(value),
    };
    const valid = readAmyKnowledgeCommand([
        '--apply',
        `--confirm=${AMY_KNOWLEDGE_APPLY_CONFIRMATION}`,
        `--expected-provider-sha256=${HASH_A}`,
        `--expected-preview-sha256=${HASH_A}`,
        `--expected-source-tool-sha256=${HASH_A}`,
        '--expected-managed-tool-sha256=ABSENT',
        `--expected-group-sha256=${HASH_A}`,
        `--backup-dir=${outsideBackup}`,
    ]);
    assert.equal(await validateAmyKnowledgeApplyCommand(valid, state, bundle, { fsImpl }), outsideBackup);
    await assert.rejects(
        () => validateAmyKnowledgeApplyCommand({ ...valid, confirmation: '' }, state, bundle),
        /requires --confirm/,
    );
    await assert.rejects(
        () => validateAmyKnowledgeApplyCommand({ ...valid, expectedSourceToolSha256: HASH_B }, state, bundle),
        /legacy Knowledge_Amy tool hash does not match/,
    );
    await assert.rejects(
        () => validateAmyKnowledgeApplyCommand({ ...valid, backupDirectory: repositoryRoot }, state, bundle),
        /outside the repository/,
    );
    await assert.rejects(
        () => validateAmyKnowledgeApplyCommand(valid, state, {
            manifest: { deploymentStatus: 'draft', sourcePolicy: bundle.manifest.sourcePolicy },
        }),
        /deploymentStatus must be approved/,
    );
    await assert.rejects(
        () => validateAmyKnowledgeApplyCommand(valid, state, {
            manifest: { deploymentStatus: 'approved', sourcePolicy: 'No external knowledge sync is authorized.' },
        }),
        /sourcePolicy still forbids/,
    );
    await assert.rejects(
        () => validateAmyKnowledgeApplyCommand(valid, state, bundle, {
            fsImpl: {
                mkdir: async () => undefined,
                realpath: async value => (
                    path.resolve(value) === path.resolve(outsideBackup)
                        ? path.join(repositoryRoot, 'junction-target')
                        : path.resolve(value)
                ),
            },
        }),
        /resolves inside the repository/,
    );
    assert.throws(() => readAmyKnowledgeCommand(['--delete-old-group']), /Unknown/);
});

test('dedicated knowledge clone preserves provider config while setting managed description and folder', () => {
    const groupId = '11111111-1111-4111-8111-111111111111';
    const payload = buildAmyDedicatedKnowledgeToolPayload({
        name: PINNED_AMY.knowledgeToolName,
        description: 'Grounded Amy knowledge.',
        type: 'SERVER_RAG',
        disableInterruptions: false,
        config: {
            name: PINNED_AMY.knowledgeToolName,
            type: 'server',
            subtype: 'knowledge',
            parameters: { type: 'object' },
            retrievalMode: 'hybrid',
            documentFolderIds: ['22222222-2222-4222-8222-222222222222'],
        },
    }, groupId, HASH_A);
    assert.equal(payload.name, PINNED_AMY.knowledgeToolName);
    assert.equal(payload.type, 'SERVER_RAG');
    assert.match(payload.description, new RegExp(HASH_A));
    assert.equal(payload.config.description, payload.description);
    assert.equal(payload.config.retrievalMode, 'hybrid');
    assert.deepEqual(payload.config.parameters, { type: 'object' });
    assert.deepEqual(payload.config.documentFolderIds, [groupId]);
    assert.equal('toolIds' in payload, false);
    assert.equal('systemPrompt' in payload, false);
});

test('provider preservation hash ignores only Knowledge_Amy folder config', () => {
    const persona = {
        id: PINNED_AMY.personaId,
        name: PINNED_AMY.name,
        description: 'Amy production',
        avatar: { id: PINNED_AMY.avatarId },
        avatarModel: PINNED_AMY.avatarModel,
        voice: { id: PINNED_AMY.voiceId },
        brain: { llm: { id: PINNED_AMY.llmId }, systemPrompt: 'prompt' },
        tools: [
            {
                id: PINNED_AMY.sourceKnowledgeToolId,
                name: PINNED_AMY.knowledgeToolName,
                type: 'SERVER_RAG',
                config: { documentFolderIds: ['old'] },
            },
            { id: 'other', name: 'end_amy_session', type: 'CLIENT', config: { awaitResult: true } },
        ],
    };
    const original = hashJson(providerProtectedView(persona));
    const migrated = hashJson(providerProtectedView({
        ...persona,
        tools: [
            { ...persona.tools[0], config: { documentFolderIds: ['new'] } },
            persona.tools[1],
        ],
    }));
    assert.equal(migrated, original);
    assert.notEqual(hashJson(providerProtectedView({
        ...persona,
        brain: { ...persona.brain, llm: { id: 'wrong-llm' } },
    })), original);
    assert.notEqual(hashJson(providerProtectedView({
        ...persona,
        tools: [persona.tools[0], { ...persona.tools[1], config: { awaitResult: false } }],
    })), original);
});

test('dedicated-tool proof distinguishes a safe clone from the intentionally shared legacy source', async () => {
    const dedicated = [{
        personaId: PINNED_AMY.personaId,
        personaName: PINNED_AMY.name,
        toolId: PINNED_AMY.sourceKnowledgeToolId,
        toolName: PINNED_AMY.knowledgeToolName,
    }];
    assert.equal(isDedicatedAmyKnowledgeTool(dedicated, PINNED_AMY.sourceKnowledgeToolId), true);
    assert.equal(isDedicatedAmyKnowledgeTool([
        ...dedicated,
        { ...dedicated[0], personaId: '33333333-3333-4333-8333-333333333333' },
    ], PINNED_AMY.sourceKnowledgeToolId), false);

    const rows = [
        { id: PINNED_AMY.personaId },
        { id: '33333333-3333-4333-8333-333333333333' },
    ];
    const complete = await fetchCompletePersonaInventory(async pathname => {
        if (pathname === '/personas?perPage=100') {
            return {
                data: rows,
                meta: { total: 2, lastPage: 1, currentPage: 1, perPage: 100, prev: null, next: null },
            };
        }
        const id = decodeURIComponent(pathname.split('/').at(-1));
        return { id, tools: [] };
    });
    assert.equal(complete.details.length, 2);
    await assert.rejects(
        fetchCompletePersonaInventory(async pathname => {
            if (pathname === '/personas?perPage=100') {
                return {
                    data: rows,
                    meta: { total: 3, lastPage: 2, currentPage: 1, perPage: 2, prev: null, next: 2 },
                };
            }
            return { id: PINNED_AMY.personaId, tools: [] };
        }),
        /paginated or incomplete/,
    );
    await assert.rejects(
        fetchCompletePersonaInventory(async pathname => {
            if (pathname === '/personas?perPage=100') {
                return {
                    data: rows,
                    meta: { total: 2, lastPage: 1, currentPage: 1, perPage: 100, prev: null, next: null },
                };
            }
            return { id: PINNED_AMY.personaId, tools: [] };
        }),
        /detail inventory is incomplete/,
    );
    await assert.rejects(
        fetchCompletePersonaInventory(async pathname => {
            if (pathname === '/personas?perPage=100') {
                return {
                    data: rows,
                    meta: { total: 2, lastPage: 1, currentPage: 1, perPage: 100, prev: null, next: null },
                };
            }
            const id = decodeURIComponent(pathname.split('/').at(-1));
            return { id };
        }),
        /detail inventory is incomplete/,
    );
});

test('knowledge group and document inventories reject incomplete wrappers', () => {
    assert.deepEqual(requireCompleteList([{ id: 'one' }], 'groups'), [{ id: 'one' }]);
    assert.throws(
        () => requireCompleteList({ data: [{ id: 'one' }] }, 'groups'),
        /not a provably complete list/,
    );
    assert.throws(
        () => requireCompleteList({
            data: [{ id: 'one' }],
            meta: { total: 2, lastPage: 2, currentPage: 1, perPage: 1, next: 2 },
        }, 'documents'),
        /paginated or incomplete/,
    );
});

test('tool isolation uses complete authoritative tool details, not list summaries', async () => {
    const rows = [
        { id: PINNED_AMY.sourceKnowledgeToolId },
        { id: '44444444-4444-4444-8444-444444444444' },
    ];
    const complete = await fetchCompleteToolInventory(async pathname => {
        if (pathname === '/tools?perPage=100') {
            return {
                data: rows,
                meta: { total: 2, lastPage: 1, currentPage: 1, perPage: 100, prev: null, next: null },
            };
        }
        const id = decodeURIComponent(pathname.split('/').at(-1));
        return { id, config: { documentFolderIds: [] } };
    });
    assert.equal(complete.tools.length, 2);
    assert.equal(complete.summaries.length, 2);

    await assert.rejects(
        fetchCompleteToolInventory(async pathname => {
            if (pathname === '/tools?perPage=100') {
                return {
                    data: rows,
                    meta: { total: 2, lastPage: 1, currentPage: 1, perPage: 100, prev: null, next: null },
                };
            }
            return { id: PINNED_AMY.sourceKnowledgeToolId, config: { documentFolderIds: [] } };
        }),
        /tool detail inventory is incomplete/,
    );
});

test('dry-run plans a safe clone-and-swap while surfacing legacy duplicate risk', () => {
    const state = {
        currentToolId: PINNED_AMY.sourceKnowledgeToolId,
        currentToolIsDedicated: false,
        providerStateSha256: HASH_A,
        providerProtectedStateSha256: HASH_A,
        previewPersonaStateSha256: HASH_A,
        sourceToolStateSha256: HASH_A,
        toolStateSha256: HASH_A,
        groupStateSha256: HASH_A,
        managedToolCandidate: null,
        toolInventory: { tools: [{ id: 'a', name: 'duplicate' }, { id: 'b', name: 'duplicate' }] },
        personaInventory: {
            meta: { total: 2, currentPage: 1, lastPage: 1, perPage: 100, next: null },
            details: [{}, {}],
        },
        sourceToolUsages: [
            { personaId: PINNED_AMY.personaId, toolId: PINNED_AMY.sourceKnowledgeToolId, toolName: PINNED_AMY.knowledgeToolName },
            { personaId: PINNED_AMY.previewPersonaId, toolId: PINNED_AMY.sourceKnowledgeToolId, toolName: PINNED_AMY.knowledgeToolName },
        ],
        currentToolUsages: [],
        groupLandscape: { attachedFolderIds: ['legacy'], sourceFolderIds: ['legacy'] },
        targetGroup: null,
        groupSnapshots: [{
            id: 'legacy',
            name: 'Amy Insight SDR A',
            description: null,
            duplicateFilenames: ['same.md'],
            stateSha256: HASH_A,
            documents: [],
        }],
    };
    const bundle = {
        bundleSha256: HASH_B,
        manifest: {
            folderName: 'Amy Insight SDR Anam KB 2026-08-20 v1',
            liveGroupId: null,
            documents: ['one.md'],
            documentFingerprints: { 'one.md': { bytes: 1, sha256: HASH_B } },
        },
        documents: [{ filename: 'one.md', byteLength: 1, sha256: HASH_B }],
    };
    const plan = buildAmyKnowledgeMigrationPlan(state, bundle, { apply: false });
    assert.equal(plan.result, 'MIGRATION_REQUIRED');
    assert.equal(plan.mutationPerformed, false);
    assert.equal(plan.isolationAction, 'create_new_tool_then_swap_production_attachment_only');
    assert.deepEqual(plan.liveDuplicateRisk[0].duplicateFilenames, ['same.md']);
});

test('dry-run deterministically reuses only exact isolated group and unattached tool orphans', () => {
    const targetGroupId = '55555555-5555-4555-8555-555555555555';
    const managedToolId = '44444444-4444-4444-8444-444444444444';
    const bundle = {
        bundleSha256: HASH_B,
        manifest: {
            folderName: 'Amy Insight SDR Anam KB 2026-08-20 v1',
            liveGroupId: null,
            liveToolId: null,
            documents: ['one.md'],
            documentFingerprints: { 'one.md': { bytes: 1, sha256: HASH_A } },
        },
        documents: [{ filename: 'one.md', byteLength: 1, sha256: HASH_A }],
    };
    const sourceTool = {
        id: PINNED_AMY.sourceKnowledgeToolId,
        name: PINNED_AMY.knowledgeToolName,
        description: 'legacy shared tool',
        type: 'SERVER_RAG',
        disableInterruptions: false,
        config: { retrievalMode: 'hybrid', documentFolderIds: ['legacy'] },
    };
    const managedToolCandidate = {
        id: managedToolId,
        ...buildAmyDedicatedKnowledgeToolPayload(sourceTool, targetGroupId, HASH_B),
    };
    const targetGroup = {
        id: targetGroupId,
        name: bundle.manifest.folderName,
        description: `Amy-only public-safe KB. Bundle SHA-256: ${HASH_B}`,
    };
    const sourceUsage = personaId => ({
        personaId,
        toolId: PINNED_AMY.sourceKnowledgeToolId,
        toolName: PINNED_AMY.knowledgeToolName,
    });
    const state = {
        currentToolId: PINNED_AMY.sourceKnowledgeToolId,
        currentToolIsDedicated: false,
        providerStateSha256: HASH_A,
        providerProtectedStateSha256: HASH_A,
        previewPersonaStateSha256: HASH_A,
        sourceToolStateSha256: HASH_A,
        toolStateSha256: HASH_A,
        groupStateSha256: HASH_A,
        sourceTool,
        managedToolCandidate,
        toolInventory: { tools: [sourceTool, managedToolCandidate] },
        personaInventory: {
            meta: { total: 2, currentPage: 1, lastPage: 1, perPage: 100, next: null },
            details: [
                { id: PINNED_AMY.personaId, tools: [sourceTool] },
                { id: PINNED_AMY.previewPersonaId, tools: [sourceTool] },
            ],
        },
        sourceToolUsages: [sourceUsage(PINNED_AMY.personaId), sourceUsage(PINNED_AMY.previewPersonaId)],
        currentToolUsages: [],
        groupLandscape: { attachedFolderIds: ['legacy'], sourceFolderIds: ['legacy'] },
        targetGroup,
        groupSnapshots: [{
            ...targetGroup,
            duplicateFilenames: [],
            stateSha256: HASH_A,
            documents: [{ id: 'doc', filename: 'one.md', status: 'READY', bytes: 1, sha256: HASH_A }],
        }],
    };

    const plan = buildAmyKnowledgeMigrationPlan(state, bundle, { apply: false });
    assert.equal(plan.result, 'MIGRATION_REQUIRED');
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.ambiguityRecovery.versionedGroup.action, 'reuse_exact_named_isolated_group');
    assert.equal(plan.ambiguityRecovery.versionedGroup.id, targetGroupId);
    assert.equal(plan.ambiguityRecovery.managedTool.action, 'reuse_exact_unattached_tool');
    assert.equal(plan.ambiguityRecovery.managedTool.id, managedToolId);
    assert.equal(plan.ambiguityRecovery.deletesOrCleanupPerformed, false);
    assert.equal(plan.ambiguityRecovery.legacyAndPreexistingStateRetained, true);

    const wrongToolPlan = buildAmyKnowledgeMigrationPlan({
        ...state,
        managedToolCandidate: {
            ...managedToolCandidate,
            config: { ...managedToolCandidate.config, retrievalMode: 'changed' },
        },
    }, bundle, { apply: false });
    assert.equal(wrongToolPlan.result, 'BLOCKED');
    assert.match(wrongToolPlan.blockers.join(' '), /differs from the exact clone-and-group contract/);

    const foreignToolPlan = buildAmyKnowledgeMigrationPlan({
        ...state,
        toolInventory: {
            tools: [
                sourceTool,
                managedToolCandidate,
                {
                    id: '66666666-6666-4666-8666-666666666666',
                    name: 'foreign',
                    type: 'SERVER_RAG',
                    config: { documentFolderIds: [targetGroupId] },
                },
            ],
        },
    }, bundle, { apply: false });
    assert.equal(foreignToolPlan.result, 'BLOCKED');
    assert.match(foreignToolPlan.blockers.join(' '), /referenced by a foreign or pre-existing tool/);
});

test('production persona payload swaps one knowledge ID and preserves every other attachment in order', () => {
    const newToolId = '44444444-4444-4444-8444-444444444444';
    const persona = {
        name: PINNED_AMY.name,
        description: 'Amy',
        brain: { systemPrompt: 'prompt' },
        initialMessage: 'Hello',
        skipGreeting: false,
        uninterruptibleGreeting: false,
        languageCode: 'en-US',
        voiceDetectionOptions: { endOfSpeechSensitivity: 0.05 },
        zeroDataRetention: false,
        enableAudioPassthrough: false,
        tools: [
            { id: '11111111-1111-4111-8111-111111111111' },
            { id: PINNED_AMY.sourceKnowledgeToolId },
            { id: '22222222-2222-4222-8222-222222222222' },
        ],
    };
    const payload = buildAmyPersonaToolSwapPayload(persona, newToolId);
    assert.deepEqual(payload.toolIds, [
        '11111111-1111-4111-8111-111111111111',
        newToolId,
        '22222222-2222-4222-8222-222222222222',
    ]);
    assert.equal(payload.systemPrompt, 'prompt');
    assert.equal(payload.initialMessage, 'Hello');
});

test('timeout after committed persona PUT triggers exact rollback and leaves Preview/source unchanged', async () => {
    const managedToolId = '44444444-4444-4444-8444-444444444444';
    const otherTool = {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'amy_visual',
        type: 'CLIENT',
        config: { awaitResult: true },
    };
    const sourceTool = {
        id: PINNED_AMY.sourceKnowledgeToolId,
        name: PINNED_AMY.knowledgeToolName,
        description: 'legacy shared knowledge',
        type: 'SERVER_RAG',
        disableInterruptions: false,
        config: { retrievalMode: 'hybrid', documentFolderIds: ['legacy'] },
    };
    const dedicatedTool = {
        id: managedToolId,
        ...buildAmyDedicatedKnowledgeToolPayload(
            sourceTool,
            '55555555-5555-4555-8555-555555555555',
            HASH_B,
        ),
    };
    const production = {
        id: PINNED_AMY.personaId,
        name: PINNED_AMY.name,
        description: 'Amy production',
        avatar: { id: PINNED_AMY.avatarId },
        avatarModel: PINNED_AMY.avatarModel,
        voice: { id: PINNED_AMY.voiceId },
        voiceSpeed: 1,
        brain: { llm: { id: PINNED_AMY.llmId }, systemPrompt: 'same prompt' },
        initialMessage: 'Hello',
        skipGreeting: false,
        uninterruptibleGreeting: false,
        languageCode: 'en-US',
        zeroDataRetention: false,
        enableAudioPassthrough: false,
        voiceDetectionOptions: { endOfSpeechSensitivity: 0.05 },
        tools: [otherTool, sourceTool],
    };
    const preview = {
        ...structuredClone(production),
        id: PINNED_AMY.previewPersonaId,
        name: 'Amy Preview',
        tools: [sourceTool],
    };
    const state = {
        production: structuredClone(production),
        preview: structuredClone(preview),
        sourceTool: structuredClone(sourceTool),
    };
    const beforeProduction = hashJson(providerFullView(state.production));
    const beforePreview = hashJson(providerFullView(state.preview));
    const beforeSourceTool = hashJson(toolStateView(state.sourceTool));
    const putPayloads = [];
    let verifyCommittedCalled = false;
    const anam = async (pathname, init = {}) => {
        if (pathname === `/personas/${PINNED_AMY.personaId}` && init.method === 'PUT') {
            const payload = JSON.parse(init.body);
            putPayloads.push(payload);
            state.production.tools = payload.toolIds.map(toolId => {
                if (toolId === PINNED_AMY.sourceKnowledgeToolId) return structuredClone(sourceTool);
                if (toolId === managedToolId) return structuredClone(dedicatedTool);
                if (toolId === otherTool.id) return structuredClone(otherTool);
                throw new Error(`unexpected tool ID ${toolId}`);
            });
            if (putPayloads.length === 1) throw new Error('ETIMEDOUT after provider committed update');
            return structuredClone(state.production);
        }
        if (pathname === `/personas/${PINNED_AMY.personaId}`) return structuredClone(state.production);
        if (pathname === `/personas/${PINNED_AMY.previewPersonaId}`) return structuredClone(state.preview);
        if (pathname === `/tools/${PINNED_AMY.sourceKnowledgeToolId}`) return structuredClone(state.sourceTool);
        throw new Error(`unexpected request ${init.method ?? 'GET'} ${pathname}`);
    };
    const swapPayload = buildAmyPersonaToolSwapPayload(production, managedToolId);
    const rollbackPayload = {
        ...swapPayload,
        toolIds: production.tools.map(tool => tool.id),
    };

    await assert.rejects(
        executeAmyPersonaSwapTransaction({
            anam,
            swapPayload,
            rollbackPayload,
            verifyCommitted: async () => {
                verifyCommittedCalled = true;
            },
            verifyRollback: async () => {
                const [rolledBackProduction, unchangedPreview, unchangedSourceTool] = await Promise.all([
                    anam(`/personas/${PINNED_AMY.personaId}`),
                    anam(`/personas/${PINNED_AMY.previewPersonaId}`),
                    anam(`/tools/${PINNED_AMY.sourceKnowledgeToolId}`),
                ]);
                assert.equal(hashJson(providerFullView(rolledBackProduction)), beforeProduction);
                assert.equal(hashJson(providerFullView(unchangedPreview)), beforePreview);
                assert.equal(hashJson(toolStateView(unchangedSourceTool)), beforeSourceTool);
            },
        }),
        /automatically restored to the legacy tool: ETIMEDOUT after provider committed update/,
    );
    assert.equal(verifyCommittedCalled, false);
    assert.equal(putPayloads.length, 2);
    assert.deepEqual(putPayloads[0].toolIds, [otherTool.id, managedToolId]);
    assert.deepEqual(putPayloads[1].toolIds, [otherTool.id, PINNED_AMY.sourceKnowledgeToolId]);
    assert.equal(hashJson(providerFullView(state.production)), beforeProduction);
    assert.equal(hashJson(providerFullView(state.preview)), beforePreview);
    assert.equal(hashJson(toolStateView(state.sourceTool)), beforeSourceTool);
});

test('persona summary slot and authoritative tool detail are verified on their separate provider surfaces', () => {
    const newToolId = '44444444-4444-4444-8444-444444444444';
    const oldPersona = {
        id: PINNED_AMY.personaId,
        name: PINNED_AMY.name,
        avatar: { id: PINNED_AMY.avatarId },
        avatarModel: PINNED_AMY.avatarModel,
        voice: { id: PINNED_AMY.voiceId },
        brain: { llm: { id: PINNED_AMY.llmId }, systemPrompt: 'same prompt' },
        tools: [
            { id: PINNED_AMY.sourceKnowledgeToolId, name: 'Knowledge_Amy', type: 'server' },
            { id: '55555555-5555-4555-8555-555555555555', name: 'other_one', type: 'client' },
            { id: '66666666-6666-4666-8666-666666666666', name: 'other_two', type: 'client' },
        ],
    };
    const newPersona = {
        ...oldPersona,
        tools: [
            { id: '55555555-5555-4555-8555-555555555555', name: 'other_one', type: 'client' },
            { id: '66666666-6666-4666-8666-666666666666', name: 'other_two', type: 'client' },
            { id: newToolId, name: 'Knowledge_Amy', type: 'SERVER_RAG' },
        ],
    };
    assert.equal(
        hashJson(providerProtectedView(newPersona)),
        hashJson(providerProtectedView(oldPersona)),
        'the provider persona surface proves only the knowledge slot ID changed',
    );
    const detail = buildAmyDedicatedKnowledgeToolPayload({
        disableInterruptions: false,
        config: { retrievalMode: 'hybrid', documentFolderIds: ['old'] },
    }, '55555555-5555-4555-8555-555555555555', HASH_A);
    assert.equal(
        isExactProductionKnowledgeSwap(oldPersona, newPersona, newToolId),
        true,
        'the committed persona may normalize the knowledge summary type while changing only the tool ID',
    );
    assert.equal(
        isExactProductionKnowledgeSwap(oldPersona, {
            ...newPersona,
            tools: [{ id: newToolId, name: 'Knowledge_Amy', type: 'SERVER_RAG' }, { id: 'extra', name: 'extra' }],
        }, newToolId),
        false,
        'any extra attachment must fail the exact swap proof',
    );
    assert.equal(detail.config.retrievalMode, 'hybrid');
    assert.deepEqual(detail.config.documentFolderIds, ['55555555-5555-4555-8555-555555555555']);
    assert.match(detail.description, /not live inventory/i);
});

test('final audit passes only for pinned dedicated tool plus exact attached bundle', () => {
    const liveToolId = '44444444-4444-4444-8444-444444444444';
    const liveGroupId = '55555555-5555-4555-8555-555555555555';
    const bundle = {
        bundleSha256: HASH_B,
        documents: [{ filename: 'one.md' }],
        manifest: {
            liveToolId,
            liveGroupId,
            folderName: 'Amy Insight SDR Anam KB 2026-08-20 v1',
            documents: ['one.md'],
            documentFingerprints: { 'one.md': { bytes: 1, sha256: HASH_A } },
        },
    };
    const exactGroup = {
        id: liveGroupId,
        name: bundle.manifest.folderName,
        description: `Bundle ${HASH_B}`,
        duplicateFilenames: [],
        stateSha256: HASH_A,
        documents: [{ id: 'doc', filename: 'one.md', status: 'READY', bytes: 1, sha256: HASH_A }],
    };
    const state = {
        providerStateSha256: HASH_A,
        providerProtectedStateSha256: HASH_A,
        previewPersonaStateSha256: HASH_A,
        sourceToolStateSha256: HASH_A,
        toolStateSha256: HASH_B,
        currentToolId: liveToolId,
        tool: { name: PINNED_AMY.knowledgeToolName, type: 'SERVER_RAG' },
        sourceToolUsages: [{
            personaId: PINNED_AMY.previewPersonaId,
            toolId: PINNED_AMY.sourceKnowledgeToolId,
            toolName: PINNED_AMY.knowledgeToolName,
        }],
        currentToolUsages: [{
            personaId: PINNED_AMY.personaId,
            toolId: liveToolId,
            toolName: PINNED_AMY.knowledgeToolName,
        }],
        groupStateSha256: HASH_A,
        targetGroup: { id: liveGroupId },
        groupSnapshots: [exactGroup],
        groupLandscape: { attachedFolderIds: [liveGroupId], sourceFolderIds: ['legacy'] },
        personaInventory: {
            meta: { total: 2, currentPage: 1, lastPage: 1, perPage: 100, next: null },
            details: [{}, {}],
        },
    };
    assert.equal(buildAmyKnowledgeAuditReport(state, bundle).result, 'PASS');
    assert.equal(buildAmyKnowledgeAuditReport({
        ...state,
        groupLandscape: { ...state.groupLandscape, attachedFolderIds: ['wrong'] },
    }, bundle).result, 'BLOCKED');
    assert.equal(buildAmyKnowledgeAuditReport({
        ...state,
        groupSnapshots: [{ ...exactGroup, duplicateFilenames: ['one.md'] }],
    }, bundle).result, 'BLOCKED');
    assert.equal(buildAmyKnowledgeAuditReport({
        ...state,
        currentToolId: PINNED_AMY.sourceKnowledgeToolId,
        sourceToolUsages: [
            state.sourceToolUsages[0],
            {
                personaId: PINNED_AMY.personaId,
                toolId: PINNED_AMY.sourceKnowledgeToolId,
                toolName: PINNED_AMY.knowledgeToolName,
            },
        ],
        currentToolUsages: [
            state.sourceToolUsages[0],
            {
                personaId: PINNED_AMY.personaId,
                toolId: PINNED_AMY.sourceKnowledgeToolId,
                toolName: PINNED_AMY.knowledgeToolName,
            },
        ],
        groupLandscape: { ...state.groupLandscape, attachedFolderIds: ['legacy'] },
    }, {
        ...bundle,
        manifest: { ...bundle.manifest, liveToolId: null, liveGroupId: null },
    }).result, 'MIGRATION_REQUIRED');
    assert.equal(buildAmyKnowledgeAuditReport(state, {
        ...bundle,
        manifest: { ...bundle.manifest, liveToolId: null, liveGroupId: null },
    }).result, 'MIGRATION_REQUIRED', 'an applied but unpinned dedicated tool can never pass release audit');
});

test('updater can swap only production Amy while never mutating shared rollback data', async () => {
    const source = await fs.readFile(
        new URL('../scripts/anam/update-amy-knowledge.mjs', import.meta.url),
        'utf8',
    );
    assert.doesNotMatch(source, /method:\s*['"]DELETE['"]/);
    assert.doesNotMatch(source, /AgentMail|contactToken|send_follow_up_email|end_amy_session/);
    assert.match(source, /legacySharedToolPutAllowed:\s*false/);
    assert.match(source, /previewPersonaPutAllowed:\s*false/);
    assert.match(source, /productionPersonaToolSwapOnly:\s*true/);
    assert.match(source, /method:\s*'POST'[\s\S]*?body:\s*JSON\.stringify\(toolPayload\)/);
    assert.equal((source.match(/method:\s*'PUT'/g) ?? []).length, 2, 'production swap and production rollback only');
    assert.match(source, /refusing to mutate it/);
    assert.match(source, /production Amy was automatically restored to the legacy tool/);
});
