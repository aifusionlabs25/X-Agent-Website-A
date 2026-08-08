import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    APPLY_CONFIRMATION,
    EVAN_ID,
    JAMES_ID,
    REQUIRED_PROMPT_MARKERS,
    ROLLBACK_CONFIRMATION,
    buildPromptOnlyPersonaPayload,
    executeEvanPromptRepair,
    nonPromptPersonaFingerprint,
} from '../scripts/anam/repair-evan-prompt.mjs';

const API_BASE = 'https://api.anam.ai/v1';
const TEST_API_KEY = 'not-a-live-anam-key';
const OLD_PROMPT = 'provider prompt before the managed repair';
const MANAGED_PROMPT = `${REQUIRED_PROMPT_MARKERS.join('\n')}\nManaged Evan prompt body.\n`;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function providerState() {
    return {
        persona: {
            id: EVAN_ID,
            name: 'Evan Mullins Moving Concierge',
            avatarModel: 'cara-4',
            brain: {
                id: 'brain-evan',
                model: 'provider-managed-model',
                systemPrompt: OLD_PROMPT,
            },
            initialMessage: 'Hello from Evan.',
            skipGreeting: false,
            uninterruptibleGreeting: true,
            voiceDetectionOptions: {
                endOfSpeechSensitivity: 0.05,
                silenceBeforeAutoEndTurnSeconds: 3,
            },
            zeroDataRetention: false,
            enableAudioPassthrough: false,
            tools: [
                { _toolId: 'knowledge-tool', name: 'Knowledge_Evan_Mullins_Moving' },
                { _toolId: 'skip-tool', name: 'skip_turn' },
            ],
            createdAt: '2026-07-16T00:00:00.000Z',
            updatedAt: '2026-07-19T00:00:00.000Z',
        },
        james: {
            id: JAMES_ID,
            name: 'James Knowles Law Firm',
            avatarModel: 'cara-4',
        },
        tools: {
            'knowledge-tool': {
                id: 'knowledge-tool',
                name: 'Knowledge_Evan_Mullins_Moving',
                type: 'SERVER_RAG',
                config: { documentFolderIds: ['evan-group'] },
                disableInterruptions: false,
            },
            'skip-tool': {
                id: 'skip-tool',
                name: 'skip_turn',
                type: 'CLIENT',
                config: { parameters: { type: 'object' } },
            },
        },
        groups: [{
            id: 'evan-group',
            name: 'Evan Mullins Moving Curated Knowledge',
            description: 'Provider group metadata',
            updatedAt: '2026-07-16T00:00:00.000Z',
        }],
        documents: {
            'evan-group': [{
                id: 'document-1',
                filename: 'mullins-overview.md',
                status: 'READY',
                size: 1234,
            }],
        },
    };
}

function fakeProvider(initialState = providerState(), { decoratePromptReadback = false } = {}) {
    const state = clone(initialState);
    const calls = [];
    const putBodies = [];
    const fetchImpl = async (url, init = {}) => {
        const parsedUrl = new URL(url);
        assert.equal(parsedUrl.origin, new URL(API_BASE).origin);
        assert.equal(init.headers.Authorization, `Bearer ${TEST_API_KEY}`);
        calls.push({ pathname: parsedUrl.pathname, method: init.method ?? 'GET' });

        if ((init.method ?? 'GET') === 'PUT' && parsedUrl.pathname === `/v1/personas/${EVAN_ID}`) {
            const body = JSON.parse(init.body);
            putBodies.push(body);
            const toolById = new Map(state.persona.tools.map(tool => [tool._toolId, tool]));
            state.persona = {
                ...state.persona,
                ...Object.fromEntries(Object.entries(body).filter(([key]) => !['systemPrompt', 'toolIds'].includes(key))),
                brain: { ...state.persona.brain, systemPrompt: body.systemPrompt },
                tools: Array.isArray(body.toolIds)
                    ? body.toolIds.map(toolId => clone(toolById.get(toolId)))
                    : state.persona.tools,
                updatedAt: '2026-08-07T12:34:56.000Z',
            };
            return Response.json({ updated: true });
        }
        if ((init.method ?? 'GET') !== 'GET') return new Response(null, { status: 405 });
        if (parsedUrl.pathname === `/v1/personas/${EVAN_ID}`) {
            const persona = clone(state.persona);
            if (decoratePromptReadback) {
                persona.brain.systemPrompt = `${persona.brain.systemPrompt.trim()}\n# TOOLS\nProvider-generated tool instructions.`;
            }
            return Response.json(persona);
        }
        if (parsedUrl.pathname === `/v1/personas/${JAMES_ID}`) return Response.json(clone(state.james));
        if (parsedUrl.pathname === '/v1/knowledge/groups') return Response.json({ data: clone(state.groups) });
        if (parsedUrl.pathname.startsWith('/v1/tools/')) {
            const toolId = decodeURIComponent(parsedUrl.pathname.slice('/v1/tools/'.length));
            const tool = state.tools[toolId];
            return tool ? Response.json(clone(tool)) : new Response(null, { status: 404 });
        }
        const documentsMatch = parsedUrl.pathname.match(/^\/v1\/knowledge\/groups\/([^/]+)\/documents$/);
        if (documentsMatch) {
            const groupId = decodeURIComponent(documentsMatch[1]);
            return Response.json({ documents: clone(state.documents[groupId] ?? []) });
        }
        return new Response(null, { status: 404 });
    };
    return { state, calls, putBodies, fetchImpl };
}

function quietLogger() {
    const messages = [];
    return {
        messages,
        logger: { log: message => messages.push(String(message)) },
    };
}

async function backupParent() {
    return mkdtemp(path.join(os.tmpdir(), 'evan-prompt-repair-test-'));
}

test('prompt-only payload is an exact sparse systemPrompt update', () => {
    const payload = buildPromptOnlyPersonaPayload(MANAGED_PROMPT);
    assert.deepEqual(payload, { systemPrompt: MANAGED_PROMPT });
    assert.deepEqual(Object.keys(payload), ['systemPrompt']);
});

test('non-prompt fingerprint ignores prompt, timestamps, and rotating signed avatar URLs', () => {
    const persona = providerState().persona;
    const promptAndTimestampChanged = clone(persona);
    persona.avatar = {
        id: 'avatar-evan',
        idleVideoUrl: 'https://signed.example/idle?token=original',
        videoUrl: 'https://signed.example/video?token=original',
    };
    promptAndTimestampChanged.avatar = {
        id: 'avatar-evan',
        idleVideoUrl: 'https://signed.example/idle?token=rotated',
        videoUrl: 'https://signed.example/video?token=rotated',
    };
    promptAndTimestampChanged.brain.systemPrompt = MANAGED_PROMPT;
    promptAndTimestampChanged.updatedAt = '2099-01-01T00:00:00.000Z';
    assert.equal(
        nonPromptPersonaFingerprint(promptAndTimestampChanged),
        nonPromptPersonaFingerprint(persona),
    );
    promptAndTimestampChanged.voiceDetectionOptions.endOfSpeechSensitivity = 0.9;
    assert.notEqual(
        nonPromptPersonaFingerprint(promptAndTimestampChanged),
        nonPromptPersonaFingerprint(persona),
    );
    promptAndTimestampChanged.voiceDetectionOptions.endOfSpeechSensitivity = persona.voiceDetectionOptions.endOfSpeechSensitivity;
    promptAndTimestampChanged.avatar.id = 'different-avatar';
    assert.notEqual(
        nonPromptPersonaFingerprint(promptAndTimestampChanged),
        nonPromptPersonaFingerprint(persona),
    );
});

test('default dry-run snapshots complete provider state without a PUT or console disclosure', async () => {
    const provider = fakeProvider();
    const output = quietLogger();
    const result = await executeEvanPromptRepair({
        apiKey: TEST_API_KEY,
        backupDirectory: path.join(await backupParent(), 'new-sensitive-backup-directory'),
        canonicalPromptOverride: MANAGED_PROMPT,
        fetchImpl: provider.fetchImpl,
        now: () => new Date('2026-08-07T01:02:03.000Z'),
        logger: output.logger,
    });

    assert.equal(result.plan.mode, 'repair-dry-run');
    assert.equal(result.plan.providerMutationPlanned, false);
    assert.equal(provider.putBodies.length, 0);
    assert.equal(provider.calls.filter(call => call.method !== 'GET').length, 0);

    const snapshot = JSON.parse(await readFile(path.join(result.runDirectory, 'provider-snapshot.json'), 'utf8'));
    assert.deepEqual(snapshot.persona, providerState().persona);
    assert.deepEqual(snapshot.attachedTools, Object.values(providerState().tools));
    assert.deepEqual(snapshot.knowledgeGroups, [{
        metadata: providerState().groups[0],
        documents: providerState().documents['evan-group'],
    }]);
    const rollback = JSON.parse(await readFile(path.join(result.runDirectory, 'rollback-artifact.json'), 'utf8'));
    assert.equal(rollback.prompt, `${OLD_PROMPT}\n`);

    const logged = output.messages.join('\n');
    assert.doesNotMatch(logged, new RegExp(TEST_API_KEY));
    assert.doesNotMatch(logged, new RegExp(OLD_PROMPT));
    assert.doesNotMatch(logged, new RegExp('Managed Evan prompt body'));
});

test('exact apply confirmation changes one persona prompt and verifies immediate and delayed state', async () => {
    const provider = fakeProvider();
    const output = quietLogger();
    let delayedMilliseconds = 0;
    const result = await executeEvanPromptRepair({
        apiKey: TEST_API_KEY,
        backupDirectory: await backupParent(),
        applyConfirmation: APPLY_CONFIRMATION,
        canonicalPromptOverride: MANAGED_PROMPT,
        fetchImpl: provider.fetchImpl,
        delayImpl: async milliseconds => { delayedMilliseconds = milliseconds; },
        now: () => new Date('2026-08-07T02:03:04.000Z'),
        logger: output.logger,
    });

    assert.equal(provider.putBodies.length, 1);
    assert.deepEqual(provider.putBodies[0], result.payload);
    assert.equal(provider.putBodies[0].systemPrompt, MANAGED_PROMPT);
    assert.deepEqual(Object.keys(provider.putBodies[0]), ['systemPrompt']);
    assert.equal(provider.state.persona.brain.systemPrompt, MANAGED_PROMPT);
    assert.equal(delayedMilliseconds, 5_000);
    assert.equal(result.plan.immediateReadbackPassed, true);
    assert.equal(result.plan.delayedReadbackPassed, true);
    assert.deepEqual(
        provider.calls.filter(call => call.method === 'PUT'),
        [{ pathname: `/v1/personas/${EVAN_ID}`, method: 'PUT' }],
    );
    assert.equal(provider.calls.some(call => call.pathname.startsWith('/v1/tools/') && call.method !== 'GET'), false);
    assert.equal(provider.calls.some(call => call.pathname.startsWith('/v1/knowledge/') && call.method !== 'GET'), false);
});

test('protected James mismatch fails closed before backup creation or provider mutation', async () => {
    const state = providerState();
    state.james.name = 'Unexpected protected persona';
    const provider = fakeProvider(state);
    await assert.rejects(
        executeEvanPromptRepair({
            apiKey: TEST_API_KEY,
            backupDirectory: await backupParent(),
            applyConfirmation: APPLY_CONFIRMATION,
            canonicalPromptOverride: MANAGED_PROMPT,
            fetchImpl: provider.fetchImpl,
            logger: quietLogger().logger,
        }),
        /protected James identity did not match/,
    );
    assert.equal(provider.putBodies.length, 0);
});

test('incorrect apply confirmation fails before any provider request', async () => {
    const provider = fakeProvider();
    await assert.rejects(
        executeEvanPromptRepair({
            apiKey: TEST_API_KEY,
            backupDirectory: await backupParent(),
            applyConfirmation: 'yes-really-apply',
            canonicalPromptOverride: MANAGED_PROMPT,
            fetchImpl: provider.fetchImpl,
            logger: quietLogger().logger,
        }),
        new RegExp(APPLY_CONFIRMATION),
    );
    assert.equal(provider.calls.length, 0);
    assert.equal(provider.putBodies.length, 0);
});

test('decorated provider readback verifies while rollback excludes generated tool text', async () => {
    const provider = fakeProvider(providerState(), { decoratePromptReadback: true });
    const dryRun = await executeEvanPromptRepair({
        apiKey: TEST_API_KEY,
        backupDirectory: await backupParent(),
        canonicalPromptOverride: MANAGED_PROMPT,
        fetchImpl: provider.fetchImpl,
        now: () => new Date('2026-08-07T03:04:05.000Z'),
        logger: quietLogger().logger,
    });
    const artifactPath = path.join(dryRun.runDirectory, 'rollback-artifact.json');
    const capturedArtifact = JSON.parse(await readFile(artifactPath, 'utf8'));
    assert.equal(capturedArtifact.prompt, `${OLD_PROMPT}\n`);
    assert.doesNotMatch(capturedArtifact.prompt, /# TOOLS|Provider-generated tool instructions/);
    provider.state.persona.brain.systemPrompt = MANAGED_PROMPT;
    provider.putBodies.length = 0;

    const rollback = await executeEvanPromptRepair({
        apiKey: TEST_API_KEY,
        backupDirectory: await backupParent(),
        applyConfirmation: ROLLBACK_CONFIRMATION,
        rollbackArtifactPath: artifactPath,
        fetchImpl: provider.fetchImpl,
        delayImpl: async () => {},
        now: () => new Date('2026-08-07T04:05:06.000Z'),
        logger: quietLogger().logger,
    });

    assert.equal(rollback.plan.mode, 'rollback-apply');
    assert.equal(provider.putBodies.length, 1);
    assert.equal(provider.putBodies[0].systemPrompt, `${OLD_PROMPT}\n`);
    assert.equal(provider.state.persona.brain.systemPrompt, `${OLD_PROMPT}\n`);
    assert.deepEqual(Object.keys(provider.putBodies[0]), ['systemPrompt']);
});
