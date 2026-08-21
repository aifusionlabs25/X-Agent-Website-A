import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
    APPLY_CONFIRMATION,
    AMY_INITIAL_MESSAGE,
    PINNED_IDENTITY,
    applyWorkbenchSync,
    buildNextToolIds,
    buildWorkbenchSyncPlan,
    fetchCompleteInventories,
    isExactAmyToolAttachmentTransition,
    requireCompleteInventory,
    rollbackWorkbenchSync,
    verifyWorkbenchSync,
} from '../scripts/anam/update-amy-workbench.mjs';

const uuid = suffix => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

function definition(name, description, { disableInterruptions = false } = {}) {
    return {
        name,
        description,
        type: 'CLIENT',
        disableInterruptions,
        config: {
            parameters: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            awaitResult: true,
            toolTimeoutSeconds: 10,
        },
    };
}

function remoteTool(id, desired) {
    return { id, ...structuredClone(desired) };
}

function persona({ id, name, tools, prompt = 'before prompt', initialMessage = 'Old greeting' }) {
    const isAmy = id === PINNED_IDENTITY.id;
    return {
        id,
        name,
        avatar: { id: isAmy ? PINNED_IDENTITY.avatarId : uuid(900) },
        avatarModel: isAmy ? PINNED_IDENTITY.avatarModel : 'cara-4',
        voice: { id: isAmy ? PINNED_IDENTITY.voiceId : uuid(901) },
        brain: {
            llm: { id: isAmy ? PINNED_IDENTITY.llmId : uuid(902) },
            systemPrompt: prompt,
        },
        initialMessage,
        languageCode: 'en-US',
        voiceDetectionOptions: { endOfSpeechSensitivity: 0.05 },
        zeroDataRetention: false,
        enableAudioPassthrough: false,
        // Anam persona details expose attachment summaries, not full /tools definitions.
        tools: tools.map(tool => ({
            id: tool.id,
            name: tool.name,
            type: String(tool.type ?? '').toLowerCase(),
        })),
    };
}

function fixture() {
    const desired = {
        show_live_notes: definition('show_live_notes', 'Unchanged shared notes definition.'),
        confirm_live_identity: definition('confirm_live_identity', 'New production Amy identity definition.', {
            disableInterruptions: true,
        }),
        end_amy_session: definition('end_amy_session', 'New production Amy close definition.'),
        show_visual_brief: definition('show_visual_brief', 'New dedicated visual definition.'),
        show_amy_intelligence: definition('show_amy_intelligence', 'New capability overview definition.'),
        close_amy_intelligence: definition('close_amy_intelligence', 'New capability close definition.'),
    };
    const live = {
        notes: remoteTool(uuid(1), desired.show_live_notes),
        identity: remoteTool(uuid(2), definition('confirm_live_identity', 'Legacy shared identity definition.', {
            disableInterruptions: true,
        })),
        end: remoteTool(uuid(3), definition('end_amy_session', 'Legacy shared close definition.')),
        visual: remoteTool(uuid(4), definition('show_visual_brief', 'Old dedicated visual definition.')),
        search: remoteTool(uuid(5), definition('search_insight_catalog', 'Shared external catalog lookup.')),
        knowledge: {
            id: uuid(6),
            name: 'Knowledge_Amy',
            description: 'Dynamic versioned Amy knowledge attachment.',
            type: 'SERVER_RAG',
            disableInterruptions: false,
            config: { knowledge: { folderIds: [uuid(60)] } },
        },
        globalCapability: remoteTool(uuid(7), desired.show_amy_intelligence),
    };
    const amy = persona({
        id: PINNED_IDENTITY.id,
        name: PINNED_IDENTITY.name,
        tools: [live.notes, live.identity, live.end, live.visual, live.search, live.knowledge],
    });
    const preview = persona({
        id: uuid(101),
        name: 'Amy Preview',
        tools: [live.notes, live.identity, live.end, live.search, live.knowledge],
    });
    const other = persona({
        id: uuid(102),
        name: 'Other agent',
        tools: [live.search],
    });
    return {
        desired,
        live,
        target: amy,
        personas: [amy, preview, other],
        tools: Object.values(live),
        definitions: Object.values(desired),
        expectedPrompt: 'expected prompt',
    };
}

test('shared changed Amy tools are cloned while unchanged shared tools are reused and catalog is detach-only', () => {
    const state = fixture();
    const plan = buildWorkbenchSyncPlan(state);
    const actions = Object.fromEntries(plan.managedTools.map(tool => [tool.name, tool.action]));

    assert.equal(plan.result, 'PASS');
    assert.equal(actions.show_live_notes, 'reuse-shared-unchanged');
    assert.equal(actions.confirm_live_identity, 'clone-and-swap-production-only');
    assert.equal(actions.end_amy_session, 'clone-and-swap-production-only');
    assert.equal(actions.show_visual_brief, 'update-production-only');
    assert.equal(actions.show_amy_intelligence, 'attach-existing-dedicated-unattached');
    assert.equal(actions.close_amy_intelligence, 'create-and-attach');
    assert.equal(plan.forbiddenAttachments.length, 1);
    assert.equal(plan.forbiddenAttachments[0].name, 'search_insight_catalog');
    assert.equal(plan.forbiddenAttachments[0].action, 'detach-production-only');
    assert.equal(plan.forbiddenAttachments[0].usages.length, 3);
    assert.deepEqual(
        plan.managedTools.find(tool => tool.name === 'show_amy_intelligence').sameNameInventoryIds,
        [state.live.globalCapability.id],
        'the complete inventory records the unique exact-definition unattached candidate selected for deterministic recovery',
    );
});

test('attachment planning replaces managed tools in place, preserves unrelated order, and appends only missing tools', () => {
    const state = fixture();
    const resolved = new Map([
        ['show_live_notes', state.live.notes.id],
        ['confirm_live_identity', uuid(201)],
        ['end_amy_session', uuid(202)],
        ['show_visual_brief', state.live.visual.id],
        ['show_amy_intelligence', state.live.globalCapability.id],
        ['close_amy_intelligence', uuid(204)],
    ]);
    const ids = buildNextToolIds(state.target.tools, state.definitions, resolved);

    assert.deepEqual(ids, [
        state.live.notes.id,
        uuid(201),
        uuid(202),
        state.live.visual.id,
        state.live.knowledge.id,
        state.live.globalCapability.id,
        uuid(204),
    ]);
});

test('verification accepts Anam new-tool slot normalization but rejects retained-tool reordering', () => {
    const state = fixture();
    const expected = [state.live.notes.id, uuid(201), uuid(202), state.live.visual.id, state.live.knowledge.id];
    const providerNormalized = [
        state.live.notes,
        state.live.visual,
        state.live.knowledge,
        remoteTool(uuid(201), state.desired.confirm_live_identity),
        remoteTool(uuid(202), state.desired.end_amy_session),
    ];

    assert.equal(isExactAmyToolAttachmentTransition(state.target.tools, expected, providerNormalized), true);
    assert.equal(isExactAmyToolAttachmentTransition(state.target.tools, expected, [
        state.live.visual,
        state.live.notes,
        state.live.knowledge,
        remoteTool(uuid(201), state.desired.confirm_live_identity),
        remoteTool(uuid(202), state.desired.end_amy_session),
    ]), false);
});

test('multiple exact unattached same-name candidates fail closed instead of creating another orphan', () => {
    const state = fixture();
    state.tools.push(remoteTool(uuid(8), state.desired.show_amy_intelligence));
    const plan = buildWorkbenchSyncPlan(state);

    assert.equal(plan.result, 'BLOCKED');
    assert.match(plan.blockers.join(' '), /multiple exact-definition unattached candidates/i);
    assert.equal(
        plan.managedTools.find(tool => tool.name === 'show_amy_intelligence').exactUnattachedCandidateIds.length,
        2,
    );
});

test('post-apply verification proves Preview, shared tools, provider state, and dynamic knowledge attachment stayed unchanged', () => {
    const before = fixture();
    const createdIdentity = remoteTool(uuid(201), before.desired.confirm_live_identity);
    const createdEnd = remoteTool(uuid(202), before.desired.end_amy_session);
    const createdClose = remoteTool(uuid(203), before.desired.close_amy_intelligence);
    const updatedVisual = remoteTool(before.live.visual.id, before.desired.show_visual_brief);
    const afterAmy = persona({
        id: PINNED_IDENTITY.id,
        name: PINNED_IDENTITY.name,
        prompt: before.expectedPrompt,
        initialMessage: AMY_INITIAL_MESSAGE,
        // The provider preserves existing relative order but may append new/replacement slots.
        tools: [
            before.live.notes,
            updatedVisual,
            before.live.knowledge,
            createdIdentity,
            createdEnd,
            before.live.globalCapability,
            createdClose,
        ],
    });
    const after = {
        personas: [afterAmy, structuredClone(before.personas[1]), structuredClone(before.personas[2])],
        tools: [
            before.live.notes,
            before.live.identity,
            before.live.end,
            updatedVisual,
            before.live.search,
            before.live.knowledge,
            before.live.globalCapability,
            createdIdentity,
            createdEnd,
            createdClose,
        ],
    };
    before.live.notes.updatedAt = '2026-08-20T01:00:00.000Z';
    after.tools.find(tool => tool.id === before.live.notes.id).updatedAt = '2026-08-20T02:00:00.000Z';
    after.tools.find(tool => tool.id === before.live.notes.id).providerAttachmentRevision = 2;
    const resolvedToolIds = new Map([
        ['show_live_notes', before.live.notes.id],
        ['confirm_live_identity', createdIdentity.id],
        ['end_amy_session', createdEnd.id],
        ['show_visual_brief', updatedVisual.id],
        ['show_amy_intelligence', before.live.globalCapability.id],
        ['close_amy_intelligence', createdClose.id],
    ]);

    assert.doesNotThrow(() => verifyWorkbenchSync({
        before,
        after,
        definitions: before.definitions,
        expectedPrompt: before.expectedPrompt,
        resolvedToolIds,
        updatedToolIds: new Set([updatedVisual.id]),
        createdToolIds: new Set([createdIdentity.id, createdEnd.id, createdClose.id]),
    }));
    assert.equal(afterAmy.tools.some(tool => tool.id === before.live.knowledge.id), true);
    assert.equal(afterAmy.tools.some(tool => tool.id === before.live.search.id), false);
    assert.equal(after.personas[1].tools.some(tool => tool.id === before.live.search.id), true);
});

test('verification fails closed if Preview or a shared catalog definition changes', () => {
    const before = fixture();
    const resolved = new Map(before.definitions.map(definition => {
        const attached = before.target.tools.find(tool => tool.name === definition.name);
        return [definition.name, attached?.id ?? uuid(700 + before.definitions.indexOf(definition))];
    }));
    const baselineAfter = {
        personas: structuredClone(before.personas),
        tools: structuredClone(before.tools),
    };
    baselineAfter.personas[0].brain.systemPrompt = before.expectedPrompt;
    baselineAfter.personas[0].initialMessage = AMY_INITIAL_MESSAGE;
    // Make every managed attachment match its desired definition for this verifier-only fixture.
    for (const definition of before.definitions) {
        const attached = baselineAfter.personas[0].tools.find(tool => tool.name === definition.name);
        const inventory = baselineAfter.tools.find(tool => tool.id === attached?.id);
        if (attached && inventory) Object.assign(attached, structuredClone(definition));
        if (inventory) Object.assign(inventory, structuredClone(definition));
    }
    // This fixture intentionally keeps the forbidden tool, so remove it from production only.
    baselineAfter.personas[0].tools = baselineAfter.personas[0].tools.filter(tool => tool.name !== 'search_insight_catalog');

    const previewChanged = structuredClone(baselineAfter);
    previewChanged.personas[1].initialMessage = 'Unexpected Preview mutation';
    assert.throws(() => verifyWorkbenchSync({
        before,
        after: previewChanged,
        definitions: before.definitions.filter(definition => resolved.get(definition.name)),
        expectedPrompt: before.expectedPrompt,
        resolvedToolIds: resolved,
        updatedToolIds: new Set([before.live.identity.id, before.live.end.id, before.live.visual.id]),
        createdToolIds: new Set(),
    }), /another persona changed/i);

    const sharedChanged = structuredClone(baselineAfter);
    sharedChanged.tools.find(tool => tool.id === before.live.search.id).description = 'Mutated shared catalog';
    assert.throws(() => verifyWorkbenchSync({
        before,
        after: sharedChanged,
        definitions: before.definitions.filter(definition => resolved.get(definition.name)),
        expectedPrompt: before.expectedPrompt,
        resolvedToolIds: resolved,
        updatedToolIds: new Set([before.live.identity.id, before.live.end.id, before.live.visual.id]),
        createdToolIds: new Set(),
    }), /unexpectedMutation/i);
});

test('a converged rerun is idempotent and plans no Anam writes', () => {
    const state = fixture();
    state.target.brain.systemPrompt = state.expectedPrompt;
    state.target.initialMessage = AMY_INITIAL_MESSAGE;
    state.target.tools = state.target.tools.filter(tool => tool.name !== 'search_insight_catalog');
    for (const definition of state.definitions) {
        let attached = state.target.tools.find(tool => tool.name === definition.name);
        if (!attached) {
            attached = remoteTool(uuid(500 + state.definitions.indexOf(definition)), definition);
            state.target.tools.push(attached);
            state.tools.push(attached);
        } else if (definition.name !== 'show_live_notes') {
            const dedicated = remoteTool(uuid(500 + state.definitions.indexOf(definition)), definition);
            state.target.tools = state.target.tools.filter(tool => tool.name !== definition.name);
            state.target.tools.push(dedicated);
            state.tools.push(dedicated);
        }
    }
    state.personas[0] = state.target;
    const plan = buildWorkbenchSyncPlan(state);

    assert.equal(plan.personaPutRequired, false);
    assert.equal(plan.forbiddenAttachments.length, 0);
    assert.equal(plan.managedTools.every(tool => tool.action.includes('reuse-')), true);
    assert.equal(plan.managedTools.some(tool => tool.action.includes('update') || tool.action.includes('create') || tool.action.includes('clone')), false);
});

test('complete list proof rejects arrays, multi-page metadata, missing next, and duplicate IDs', async () => {
    assert.throws(() => requireCompleteInventory([], 'tool', ['tools']), /no pagination proof/i);
    assert.throws(() => requireCompleteInventory({
        tools: [{ id: uuid(1) }],
        meta: { total: 2, currentPage: 1, lastPage: 2, perPage: 1, next: 2 },
    }, 'tool', ['tools']), /paginated, malformed, or incomplete/i);
    assert.throws(() => requireCompleteInventory({
        tools: [],
        meta: { total: 0, currentPage: 1, lastPage: 1, perPage: 100 },
    }, 'tool', ['tools']), /paginated, malformed, or incomplete/i);

    const target = fixture().target;
    const payloads = new Map([
        ['/personas?perPage=100', {
            personas: [{ id: PINNED_IDENTITY.id }, { id: uuid(101) }],
            meta: { total: 2, currentPage: 1, lastPage: 1, perPage: 100, next: null },
        }],
        ['/tools?perPage=100', {
            tools: [{ id: uuid(1) }, { id: uuid(1) }],
            meta: { total: 2, currentPage: 1, lastPage: 1, perPage: 100, next: null },
        }],
        [`/personas/${PINNED_IDENTITY.id}`, target],
        [`/personas/${uuid(101)}`, persona({ id: uuid(101), name: 'Preview', tools: [] })],
    ]);
    await assert.rejects(() => fetchCompleteInventories(async pathname => payloads.get(pathname)), /duplicate IDs/i);
});

function completePayload(rows, key) {
    return {
        [key]: rows,
        meta: { total: rows.length, currentPage: 1, lastPage: 1, perPage: 100, next: null },
    };
}

function createMutableAnamMock({
    personas,
    tools,
    failToolPutAfterApply = false,
    failPersonaPutAfterApply = false,
    failToolPostAfterCreate = false,
    toolPostCreateCopies = 1,
    nextCreatedToolId = uuid(999),
}) {
    let toolFailureArmed = failToolPutAfterApply;
    let personaFailureArmed = failPersonaPutAfterApply;
    let toolPostFailureArmed = failToolPostAfterCreate;
    const calls = [];
    const anam = async (pathname, init = {}) => {
        calls.push({ pathname, method: init.method ?? 'GET' });
        if (pathname === '/personas?perPage=100') {
            return completePayload(structuredClone(personas.map(({ id, name }) => ({ id, name }))), 'personas');
        }
        if (pathname === '/tools?perPage=100') return completePayload(structuredClone(tools), 'tools');
        if (pathname.startsWith('/personas/') && !init.method) {
            return structuredClone(personas.find(persona => pathname.endsWith(persona.id)));
        }
        if (pathname.startsWith('/tools/') && init.method === 'PUT') {
            const id = pathname.split('/').at(-1);
            const target = tools.find(tool => tool.id === id);
            Object.assign(target, JSON.parse(init.body));
            if (toolFailureArmed) {
                toolFailureArmed = false;
                throw new Error('simulated timeout after tool apply');
            }
            return structuredClone(target);
        }
        if (pathname === '/tools' && init.method === 'POST') {
            const body = JSON.parse(init.body);
            const created = Array.from({ length: toolPostCreateCopies }, (_, index) => remoteTool(
                uuid(Number(nextCreatedToolId.slice(-12)) + index),
                body,
            ));
            tools.push(...created);
            if (toolPostFailureArmed) {
                toolPostFailureArmed = false;
                throw new Error('simulated timeout after tool create');
            }
            return structuredClone(created[0]);
        }
        if (pathname === `/personas/${PINNED_IDENTITY.id}` && init.method === 'PUT') {
            const body = JSON.parse(init.body);
            const target = personas.find(persona => persona.id === PINNED_IDENTITY.id);
            target.brain.systemPrompt = body.systemPrompt;
            target.initialMessage = body.initialMessage;
            target.tools = body.toolIds.map(id => {
                const tool = tools.find(candidate => candidate.id === id);
                return { id, name: tool.name, type: String(tool.type).toLowerCase() };
            });
            if (personaFailureArmed) {
                personaFailureArmed = false;
                throw new Error('simulated timeout after persona apply');
            }
            return structuredClone(target);
        }
        throw new Error(`Unexpected mock request: ${pathname}`);
    };
    return { anam, calls };
}

test('timeout after a tool POST recovers the one new exact unattached tool without retrying creation', async () => {
    const desiredOverview = definition('show_amy_intelligence', 'Desired capability overview.');
    const knowledge = {
        id: uuid(821),
        name: 'Knowledge_Amy',
        type: 'SERVER_RAG',
        description: 'Knowledge',
        disableInterruptions: false,
        config: { knowledge: { folderIds: [uuid(822)] } },
    };
    const target = persona({
        id: PINNED_IDENTITY.id,
        name: PINNED_IDENTITY.name,
        tools: [knowledge],
        prompt: 'stable prompt',
        initialMessage: AMY_INITIAL_MESSAGE,
    });
    const preview = persona({ id: uuid(823), name: 'Preview', tools: [], prompt: 'preview' });
    const state = {
        target,
        personas: [target, preview],
        tools: [knowledge],
        definitions: [desiredOverview],
        expectedPrompt: 'stable prompt',
    };
    const livePersonas = structuredClone(state.personas);
    const liveTools = structuredClone(state.tools);
    const createdId = uuid(824);
    const mock = createMutableAnamMock({
        personas: livePersonas,
        tools: liveTools,
        failToolPostAfterCreate: true,
        nextCreatedToolId: createdId,
    });
    const plan = buildWorkbenchSyncPlan(state);
    const backupDir = await mkdtemp(join(tmpdir(), 'amy-workbench-sync-test-'));
    try {
        const result = await applyWorkbenchSync({
            anam: mock.anam,
            definitions: state.definitions,
            expectedPrompt: state.expectedPrompt,
            plan,
            command: {
                confirmation: APPLY_CONFIRMATION,
                expectedCurrentSha256: plan.currentPersonaStateSha256,
                expectedPersonaInventorySha256: plan.personaInventorySha256,
                expectedToolInventorySha256: plan.toolInventorySha256,
                backupDir,
            },
        });

        assert.equal(result.mode, 'applied-and-verified');
        assert.deepEqual(result.createdToolIds, [createdId]);
        assert.deepEqual(result.recoveredToolCreateIds, [createdId]);
        assert.equal(mock.calls.filter(call => call.pathname === '/tools' && call.method === 'POST').length, 1);
        assert.equal(livePersonas[0].tools.some(tool => tool.id === createdId), true);
        assert.equal(mock.calls.some(call => call.method === 'DELETE'), false);
    } finally {
        await rm(backupDir, { recursive: true, force: true });
    }
});

test('timeout after a tool POST fails closed when multiple new exact unattached tools appear', async () => {
    const desiredOverview = definition('show_amy_intelligence', 'Desired capability overview.');
    const target = persona({
        id: PINNED_IDENTITY.id,
        name: PINNED_IDENTITY.name,
        tools: [],
        prompt: 'stable prompt',
        initialMessage: AMY_INITIAL_MESSAGE,
    });
    const state = {
        target,
        personas: [target],
        tools: [],
        definitions: [desiredOverview],
        expectedPrompt: 'stable prompt',
    };
    const livePersonas = structuredClone(state.personas);
    const liveTools = [];
    const mock = createMutableAnamMock({
        personas: livePersonas,
        tools: liveTools,
        failToolPostAfterCreate: true,
        toolPostCreateCopies: 2,
        nextCreatedToolId: uuid(831),
    });
    const plan = buildWorkbenchSyncPlan(state);
    const backupDir = await mkdtemp(join(tmpdir(), 'amy-workbench-sync-test-'));
    try {
        await assert.rejects(() => applyWorkbenchSync({
            anam: mock.anam,
            definitions: state.definitions,
            expectedPrompt: state.expectedPrompt,
            plan,
            command: {
                confirmation: APPLY_CONFIRMATION,
                expectedCurrentSha256: plan.currentPersonaStateSha256,
                expectedPersonaInventorySha256: plan.personaInventorySha256,
                expectedToolInventorySha256: plan.toolInventorySha256,
                backupDir,
            },
        }), /inventory recovery failed closed: .*found 2/i);
        assert.equal(mock.calls.filter(call => call.pathname === '/tools' && call.method === 'POST').length, 1);
        assert.equal(mock.calls.some(call => call.pathname.startsWith('/personas/') && call.method === 'PUT'), false);
        assert.equal(mock.calls.some(call => call.method === 'DELETE'), false);
        assert.equal(liveTools.length, 2);
    } finally {
        await rm(backupDir, { recursive: true, force: true });
    }
});

test('timeout after a tool POST fails closed without retry when no exact unattached tool appears', async () => {
    const desiredOverview = definition('show_amy_intelligence', 'Desired capability overview.');
    const target = persona({
        id: PINNED_IDENTITY.id,
        name: PINNED_IDENTITY.name,
        tools: [],
        prompt: 'stable prompt',
        initialMessage: AMY_INITIAL_MESSAGE,
    });
    const state = {
        target,
        personas: [target],
        tools: [],
        definitions: [desiredOverview],
        expectedPrompt: 'stable prompt',
    };
    const mock = createMutableAnamMock({
        personas: structuredClone(state.personas),
        tools: [],
        failToolPostAfterCreate: true,
        toolPostCreateCopies: 0,
    });
    const plan = buildWorkbenchSyncPlan(state);
    const backupDir = await mkdtemp(join(tmpdir(), 'amy-workbench-sync-test-'));
    try {
        await assert.rejects(() => applyWorkbenchSync({
            anam: mock.anam,
            definitions: state.definitions,
            expectedPrompt: state.expectedPrompt,
            plan,
            command: {
                confirmation: APPLY_CONFIRMATION,
                expectedCurrentSha256: plan.currentPersonaStateSha256,
                expectedPersonaInventorySha256: plan.personaInventorySha256,
                expectedToolInventorySha256: plan.toolInventorySha256,
                backupDir,
            },
        }), /inventory recovery failed closed: .*found 0/i);
        assert.equal(mock.calls.filter(call => call.pathname === '/tools' && call.method === 'POST').length, 1);
        assert.equal(mock.calls.some(call => call.pathname.startsWith('/personas/') && call.method === 'PUT'), false);
        assert.equal(mock.calls.some(call => call.method === 'DELETE'), false);
    } finally {
        await rm(backupDir, { recursive: true, force: true });
    }
});

async function runApplyExpectingVerifiedRollback(state, mock) {
    const plan = buildWorkbenchSyncPlan(state);
    const backupDir = await mkdtemp(join(tmpdir(), 'amy-workbench-sync-test-'));
    try {
        await assert.rejects(() => applyWorkbenchSync({
            anam: mock.anam,
            before: state,
            definitions: state.definitions,
            expectedPrompt: state.expectedPrompt,
            plan,
            command: {
                confirmation: APPLY_CONFIRMATION,
                expectedCurrentSha256: plan.currentPersonaStateSha256,
                expectedPersonaInventorySha256: plan.personaInventorySha256,
                expectedToolInventorySha256: plan.toolInventorySha256,
                backupDir,
            },
        }), /restored and verified/i);
    } finally {
        await rm(backupDir, { recursive: true, force: true });
    }
}

test('timeout after a dedicated tool PUT is conservatively rolled back and verified', async () => {
    const desiredVisual = definition('show_visual_brief', 'Desired visual definition.');
    const oldVisual = remoteTool(uuid(801), definition('show_visual_brief', 'Original visual definition.'));
    const knowledge = {
        id: uuid(802),
        name: 'Knowledge_Amy',
        type: 'SERVER_RAG',
        description: 'Knowledge',
        disableInterruptions: false,
        config: { knowledge: { folderIds: [uuid(803)] } },
    };
    const target = persona({
        id: PINNED_IDENTITY.id,
        name: PINNED_IDENTITY.name,
        tools: [oldVisual, knowledge],
        prompt: 'stable prompt',
        initialMessage: AMY_INITIAL_MESSAGE,
    });
    const preview = persona({ id: uuid(804), name: 'Preview', tools: [], prompt: 'preview' });
    const state = {
        target,
        personas: [target, preview],
        tools: [oldVisual, knowledge],
        definitions: [desiredVisual],
        expectedPrompt: 'stable prompt',
    };
    const livePersonas = structuredClone(state.personas);
    const liveTools = structuredClone(state.tools);
    const mock = createMutableAnamMock({
        personas: livePersonas,
        tools: liveTools,
        failToolPutAfterApply: true,
    });

    await runApplyExpectingVerifiedRollback(state, mock);
    assert.equal(liveTools.find(tool => tool.id === oldVisual.id).description, oldVisual.description);
    assert.equal(mock.calls.filter(call => call.pathname === `/tools/${oldVisual.id}` && call.method === 'PUT').length, 2);
});

test('timeout after the production persona PUT restores prompt, greeting, and exact tool order', async () => {
    const desiredNotes = definition('show_live_notes', 'Stable notes definition.');
    const notes = remoteTool(uuid(811), desiredNotes);
    const knowledge = {
        id: uuid(812),
        name: 'Knowledge_Amy',
        type: 'SERVER_RAG',
        description: 'Knowledge',
        disableInterruptions: false,
        config: { knowledge: { folderIds: [uuid(813)] } },
    };
    const target = persona({
        id: PINNED_IDENTITY.id,
        name: PINNED_IDENTITY.name,
        tools: [knowledge, notes],
        prompt: 'original prompt',
        initialMessage: 'Original greeting',
    });
    const preview = persona({ id: uuid(814), name: 'Preview', tools: [], prompt: 'preview' });
    const state = {
        target,
        personas: [target, preview],
        tools: [notes, knowledge],
        definitions: [desiredNotes],
        expectedPrompt: 'new prompt',
    };
    const livePersonas = structuredClone(state.personas);
    const liveTools = structuredClone(state.tools);
    const originalIds = target.tools.map(tool => tool.id);
    const mock = createMutableAnamMock({
        personas: livePersonas,
        tools: liveTools,
        failPersonaPutAfterApply: true,
    });

    await runApplyExpectingVerifiedRollback(state, mock);
    const restored = livePersonas.find(persona => persona.id === PINNED_IDENTITY.id);
    assert.equal(restored.brain.systemPrompt, 'original prompt');
    assert.equal(restored.initialMessage, 'Original greeting');
    assert.deepEqual(restored.tools.map(tool => tool.id), originalIds);
    assert.equal(mock.calls.filter(call => call.pathname === `/personas/${PINNED_IDENTITY.id}` && call.method === 'PUT').length, 2);
});

test('apply rechecks full inventory hashes and performs no mutation when production Amy drifts', async () => {
    const before = fixture();
    const plan = buildWorkbenchSyncPlan(before);
    const driftedPersonas = structuredClone(before.personas);
    driftedPersonas[0].initialMessage = 'Concurrent greeting change';
    const mutations = [];
    const anam = async (pathname, init = {}) => {
        if (init.method) mutations.push({ pathname, method: init.method });
        if (pathname === '/personas?perPage=100') {
            return completePayload(driftedPersonas.map(({ id, name }) => ({ id, name })), 'personas');
        }
        if (pathname === '/tools?perPage=100') return completePayload(before.tools, 'tools');
        if (pathname.startsWith('/personas/')) {
            return structuredClone(driftedPersonas.find(persona => pathname.endsWith(persona.id)));
        }
        throw new Error(`Unexpected mock request: ${pathname}`);
    };

    await assert.rejects(() => applyWorkbenchSync({
        anam,
        before,
        definitions: before.definitions,
        expectedPrompt: before.expectedPrompt,
        plan,
        command: {
            confirmation: APPLY_CONFIRMATION,
            expectedCurrentSha256: plan.currentPersonaStateSha256,
            expectedPersonaInventorySha256: plan.personaInventorySha256,
            expectedToolInventorySha256: plan.toolInventorySha256,
            backupDir: 'not-reached',
        },
    }), /changed after dry-run; no Anam write was attempted/i);
    assert.deepEqual(mutations, []);
});

test('rollback restores prompt, greeting, attachment order, and dedicated definitions, and reports rollback failure', async () => {
    const before = fixture();
    const currentPersonas = structuredClone(before.personas);
    const currentTools = structuredClone(before.tools);
    const visual = currentTools.find(tool => tool.id === before.live.visual.id);
    Object.assign(visual, structuredClone(before.desired.show_visual_brief));
    currentPersonas[0].brain.systemPrompt = 'partially applied prompt';
    currentPersonas[0].initialMessage = AMY_INITIAL_MESSAGE;
    currentPersonas[0].tools = currentPersonas[0].tools.filter(tool => tool.name !== 'search_insight_catalog').reverse();

    const anam = async (pathname, init = {}) => {
        if (pathname === '/personas?perPage=100') {
            return completePayload(currentPersonas.map(({ id, name }) => ({ id, name })), 'personas');
        }
        if (pathname === '/tools?perPage=100') return completePayload(currentTools, 'tools');
        if (pathname.startsWith('/personas/') && !init.method) {
            return structuredClone(currentPersonas.find(persona => pathname.endsWith(persona.id)));
        }
        if (pathname === `/tools/${before.live.visual.id}` && init.method === 'PUT') {
            Object.assign(visual, JSON.parse(init.body));
            return structuredClone(visual);
        }
        if (pathname === `/personas/${PINNED_IDENTITY.id}` && init.method === 'PUT') {
            const body = JSON.parse(init.body);
            const target = currentPersonas[0];
            target.brain.systemPrompt = body.systemPrompt;
            target.initialMessage = body.initialMessage;
            target.tools = body.toolIds.map(id => {
                const tool = currentTools.find(candidate => candidate.id === id);
                return { id, name: tool.name, type: String(tool.type).toLowerCase() };
            });
            return structuredClone(target);
        }
        throw new Error(`Unexpected mock request: ${pathname}`);
    };

    const restored = await rollbackWorkbenchSync({
        anam,
        before,
        updatedToolIds: new Set([before.live.visual.id]),
        personaPutPerformed: true,
    });
    assert.equal(restored.rollbackVerified, true);
    assert.deepEqual(currentPersonas[0].tools.map(tool => tool.id), before.target.tools.map(tool => tool.id));
    assert.equal(currentPersonas[0].brain.systemPrompt, before.target.brain.systemPrompt);
    assert.equal(currentPersonas[0].initialMessage, before.target.initialMessage);
    assert.equal(visual.description, before.live.visual.description);

    await assert.rejects(() => rollbackWorkbenchSync({
        anam: async (pathname, init = {}) => {
            if (pathname.startsWith('/tools/') && init.method === 'PUT') throw new Error('provider refused rollback');
            return anam(pathname, init);
        },
        before,
        updatedToolIds: new Set([before.live.visual.id]),
        personaPutPerformed: false,
    }), /rollback request failed/i);
});

test('live updater statically requires identity management, three expected hashes, backup, and no deletion endpoint', async () => {
    const source = await readFile(new URL('../scripts/anam/update-amy-workbench.mjs', import.meta.url), 'utf8');
    assert.match(source, /amy-live-identity-client-tool\.json/);
    assert.match(source, /expected-current-sha256/);
    assert.match(source, /expected-persona-inventory-sha256/);
    assert.match(source, /expected-tool-inventory-sha256/);
    assert.match(source, /backup-dir must be an absolute path outside the repository/);
    assert.match(source, /clone-and-swap-production-only/);
    assert.match(source, /detach-production-only/);
    assert.doesNotMatch(source, /method:\s*['"]DELETE['"]/);
    assert.doesNotMatch(source, /allTools\.find\([^)]*tool\.name/);
});
