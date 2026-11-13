import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    EVAN_DEMO_SOURCE_PERSONA_ID,
    buildEvanDemoClonePayload,
    assertEvanDemoCloneMatches,
    managedEvanDemoPrompt, expectedEvanDemoCheckpoint, EVAN_DEMO_CHECKPOINT,
    evanDemoToolBehavior, assertEvanDemoToolMatches, buildEvanDemoPlannerToolPayload,
    EVAN_DEMO_ORIGINAL_PERSONA_ID, EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID,
} from '../lib/anam/evan-demo-persona.ts';
import { prepareEvanDurationCopies, parseEvanDemoPreparationArgs } from '../scripts/anam/prepare-evan-duration-clones.mjs';

const cloneId = '1c90766e-0f4f-422c-9c42-dd387ca6c60a';
const fixture = () => ({
    id: EVAN_DEMO_SOURCE_PERSONA_ID,
    name: 'Evan', description: 'Live source',
    avatar: { id: '80055346-0c7a-47d5-aa7c-cf9ca8557b32', videoUrl: 'https://example.com/temporary-source' },
    avatarModel: 'cara-4',
    voice: { id: 'a5914fd1-e3f2-4efd-8007-fbc4ea4eec79' },
    voiceSpeed: 0,
    llmId: '04ab6639-80f7-4ca5-a5c0-b6f1645a98fc',
    brain: { systemPrompt: '  Original prompt\r\nKeep every byte.\n', personality: null },
    brainType: null, directorNotes: { expressivity: 0.1 },
    tools: [
        { _toolId: '6bb66844-82df-449e-98ce-4fccaa326ce0', id: 'association-one', name: 'knowledge', type: 'server', subtype: 'rag', description: 'Read the source.', documentFolderIds: [] },
        { id: 'd33657ee-b5b0-4645-a55c-35449281b5e7', name: 'end_mullins_session', type: 'client', description: 'End the call.', awaitResult: true },
    ],
    skipGreeting: false, uninterruptibleGreeting: false, initialMessage: 'Hello!',
    zeroDataRetention: false, languageCode: 'inherit',
    voiceDetectionOptions: { silenceBeforeSkipTurnSeconds: 4, endOfSpeechSensitivity: 0.6 },
    voiceGenerationOptions: { speed: 1, stability: 0.5 },
    enableAudioPassthrough: false, knowledge: [], widgetConfig: { position: 'right' }, personaPreset: '', isDefaultPersona: true,
    maxSessionLengthSeconds: null,
    createdAt: 'old', updatedAt: 'old', publishedAt: 'old',
    shareLinks: [{ token: 'do-not-copy' }], primaryShareLink: { token: 'do-not-copy' },
});
const cloneOf = (source, seconds = 180) => ({
    ...structuredClone(source), id: cloneId, name: 'Evan public demo', description: 'Duration-only copy',
    maxSessionLengthSeconds: seconds, createdAt: 'new', updatedAt: 'new', publishedAt: 'new',
    shareLinks: [], primaryShareLink: null,
    avatar: { id: source.avatar.id, videoUrl: 'https://example.com/temporary-clone' },
});

test('builds public and protected payloads preserving the managed prompt and shared resources', () => {
    for (const seconds of [180, 1800]) {
        const source = fixture();
        const before = structuredClone(source);
        const payload = buildEvanDemoClonePayload({ source, name: 'Demo', description: 'Duration-only', maxSessionLengthSeconds: seconds });
        assert.equal(payload.maxSessionLengthSeconds, seconds);
        assert.equal(payload.systemPrompt, managedEvanDemoPrompt(source.brain.systemPrompt));
        assert.equal(payload.avatarId, source.avatar.id);
        assert.equal(payload.voiceId, source.voice.id);
        assert.equal(payload.llmId, source.llmId);
        assert.equal(payload.voiceSpeed, 0);
        assert.deepEqual(payload.directorNotes, { expressivity: 0.1 });
        assert.equal(payload.personality, null);
        assert.equal(payload.skipGreeting, false);
        assert.deepEqual(payload.toolIds, source.tools.map(t => t._toolId ?? t.id).sort());
        assert.equal('id' in payload, false);
        assert.equal('shareLinks' in payload, false);
        assert.equal('publishedAt' in payload, false);
        assert.equal('isDefaultPersona' in payload, false);
        assert.deepEqual(payload.widgetConfig, source.widgetConfig);
        payload.voiceDetectionOptions.silenceBeforeSkipTurnSeconds = 99;
        assert.deepEqual(source, before);
    }
});

test('readback permits identity/bookkeeping/duration changes and exact same behavior only', () => {
    const source = fixture();
    const clone = cloneOf(source);
    clone.tools.reverse();
    clone.voiceDetectionOptions = { endOfSpeechSensitivity: 0.6, silenceBeforeSkipTurnSeconds: 4 };
    assert.doesNotThrow(() => assertEvanDemoCloneMatches({ source, clone, expectedCloneId: cloneId, maxSessionLengthSeconds: 180 }));
});

test('ignored legacy fields and changed prompt/model/tools fail readback without revealing their values', () => {
    const source = fixture();
    for (const alter of [
        c => { c.voiceSpeed = 1; },
        c => { c.brain.personality = 'Different'; },
        c => { c.directorNotes = 'Different'; },
        c => { c.brain.systemPrompt = 'private secret prompt'; },
        c => { c.llmId = 'be9fd33f-99ce-4878-adc5-02177c430f7b'; },
        c => { c.tools.pop(); },
        c => { c.voiceGenerationOptions.speed = 0.8; },
        c => { c.voiceDetectionOptions.silenceBeforeSkipTurnSeconds = 9; },
        c => { c.languageCode = 'fr'; },
        c => { c.skipGreeting = true; },
        c => { c.initialMessage = 'Different'; },
        c => { c.zeroDataRetention = true; },
    ]) {
        const clone = cloneOf(source);
        alter(clone);
        assert.throws(() => assertEvanDemoCloneMatches({ source, clone, expectedCloneId: cloneId, maxSessionLengthSeconds: 180 }), e => /readback changed/.test(e.message) && !e.message.includes('private secret'));
    }
});

test('rejects missing identities, source mutations, duplicate tools and unsupported nondefault settings', () => {
    for (const alter of [
        s => { s.id = cloneId; },
        s => { delete s.avatar; },
        s => { s.avatarId = cloneId; },
        s => { s.brain.systemPrompt = ''; },
        s => { delete s.tools; },
        s => { s.tools.push(s.tools[0]); },
        s => { s.tools[0] = { name: 'unidentified' }; },
        s => { s.enableAudioPassthrough = true; },
        s => { s.knowledge = [{ id: cloneId }]; },
        s => { s.personaPreset = 'legacy'; },
        s => { s.widgetConfig = 'invalid'; },
        s => { s.unknownBehavior = { active: true }; },
        s => { s.unknownBehavior = 0; },
        s => { s.brain.temperature = 0.6; },
    ]) {
        const source = fixture(); alter(source);
        assert.throws(() => buildEvanDemoClonePayload({ source, name: 'Demo', description: '', maxSessionLengthSeconds: 180 }));
    }
});

test('duration and clone identity validation reject arbitrary limits and the production persona', () => {
    const source = fixture();
    for (const seconds of [0, 60, 179, 181, 180.1, 7200, '180', NaN, null]) {
        assert.throws(() => buildEvanDemoClonePayload({ source, name: 'Demo', description: '', maxSessionLengthSeconds: seconds }));
    }
    for (const [id, seconds] of [[EVAN_DEMO_SOURCE_PERSONA_ID, 180], [cloneId, 181], ['invalid', 180]]) {
        assert.throws(() => assertEvanDemoCloneMatches({ source, clone: cloneOf(source, seconds), expectedCloneId: id, maxSessionLengthSeconds: 180 }));
    }
});

test('frozen Run57 checkpoint has the exact verified prompt and excludes authentication/media/share fields', () => {
    const source = expectedEvanDemoCheckpoint();
    assert.equal(source.id, '6097c73e-b6ef-48c5-94c7-9a95d4863b99');
    assert.equal(EVAN_DEMO_CHECKPOINT.sourceCommit, '2bc24b18c555acb2dce1ed098d3cc932690976bc');
    assert.equal(createHash('sha256').update(managedEvanDemoPrompt(source.brain.systemPrompt)).digest('hex'), EVAN_DEMO_CHECKPOINT.managedPromptSha256);
    assert.equal(EVAN_DEMO_CHECKPOINT.managedPromptSha256, '39ec515166edc8a88c305ba1e0274eb416e0aae3494e46101a298439bd5e0c2b');
    assert.equal(source.llmId, '2032d289-6faa-46e6-819c-fbe4dd79a37a');
    assert.equal(source.voiceSpeed, 0);
    assert.deepEqual(source.directorNotes, { expressivity: 0.1 });
    assert.equal(source.tools.length, 5);
    const forbidden = /^(?:shareLinks|primaryShareLink|.*(?:Token|Secret|Password|Cookie)|authorization|headers|videoUrl|idleVideoUrl)$/i;
    const inspect = value => {
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) { assert.equal(forbidden.test(key), false, key); inspect(item); }
    };
    inspect(source);
    source.tools.pop();
    assert.equal(expectedEvanDemoCheckpoint().tools.length, 5, 'callers cannot mutate the frozen import');
});

test('generated tool appendix is not copied into the authored prompt', () => {
    const source = expectedEvanDemoCheckpoint();
    const base = source.brain.systemPrompt;
    source.brain.systemPrompt += '\n# TOOLS\nProvider-generated instructions.';
    const payload = buildEvanDemoClonePayload({ source, name: 'Demo', description: '', maxSessionLengthSeconds: 180 });
    assert.equal(payload.systemPrompt, base);
    assert.equal(payload.systemPrompt.includes('# TOOLS'), false);
    const clone = structuredClone(source);
    clone.id = cloneId; clone.maxSessionLengthSeconds = 180;
    clone.brain.systemPrompt = base + '\n# TOOLS\nRegenerated appendix for the same tool definitions.';
    assert.doesNotThrow(() => assertEvanDemoCloneMatches({ source, clone, expectedCloneId: cloneId, maxSessionLengthSeconds: 180 }));
});

test('planner tool remapping requires identical full semantics; other tool identities stay pinned', () => {
    const source = expectedEvanDemoCheckpoint();
    const clone = structuredClone(source);
    clone.id = cloneId; clone.maxSessionLengthSeconds = 180;
    const isolatedId = '05af215e-3f7f-4c5e-a9d7-7eb7fa20412a';
    const planner = clone.tools.find(t => t.name === 'show_move_planner');
    planner._toolId = isolatedId;
    assert.doesNotThrow(() => assertEvanDemoCloneMatches({ source, clone, expectedCloneId: cloneId, maxSessionLengthSeconds: 180, plannerToolId: isolatedId }));
    assert.throws(() => assertEvanDemoCloneMatches({ source, clone, expectedCloneId: cloneId, maxSessionLengthSeconds: 180, plannerToolId: cloneId }), /identity/);
    const payload = buildEvanDemoClonePayload({ source, name: 'Demo', description: '', maxSessionLengthSeconds: 180, plannerToolId: isolatedId });
    assert.ok(payload.toolIds.includes(isolatedId));
    assert.ok(!payload.toolIds.includes(source.tools.find(t => t.name === 'show_move_planner')._toolId));
    planner.parameters.properties.view.enum.push('phone_readback');
    assert.throws(() => assertEvanDemoCloneMatches({ source, clone, expectedCloneId: cloneId, maxSessionLengthSeconds: 180 }), /readback changed tools/);
    const other = structuredClone(source); other.id = cloneId; other.maxSessionLengthSeconds = 180;
    other.tools.find(t => t.name === 'end_mullins_session')._toolId = isolatedId;
    assert.throws(() => assertEvanDemoCloneMatches({ source, clone: other, expectedCloneId: cloneId, maxSessionLengthSeconds: 180 }), /identity/);
});

test('tool semantics reconcile flattened persona and wrapped tools API shapes', () => {
    const source = expectedEvanDemoCheckpoint();
    const planner = source.tools.find(t => t.name === 'show_move_planner');
    const payload = buildEvanDemoPlannerToolPayload(source);
    assert.equal(payload.type, 'CLIENT');
    assert.equal(payload.name, 'show_move_planner');
    assert.deepEqual(payload.config.parameters.properties.view.enum, ['brief', 'route', 'inventory', 'readiness']);
    assert.doesNotThrow(() => assertEvanDemoToolMatches(planner, { id: cloneId, ...payload, createdAt: 'new', usageCount: 0 }));
    assert.equal('_toolId' in payload, false);
    const conflict = { ...payload, awaitResult: false };
    assert.throws(() => evanDemoToolBehavior(conflict), /conflicting/);
});

function provisioningFixture() {
    const frozen = expectedEvanDemoCheckpoint();
    const current = structuredClone(frozen);
    current.brain.systemPrompt = 'Later candidate prompt.\n';
    current.tools.find(t => t.name === 'show_move_planner').parameters.properties.view.enum.push('phone_readback');
    const personas = new Map([
        [current.id, current],
        [EVAN_DEMO_ORIGINAL_PERSONA_ID, { ...structuredClone(frozen), id: EVAN_DEMO_ORIGINAL_PERSONA_ID }],
        [EVAN_DEMO_PUBLIC_PERSONA_ID, { ...structuredClone(current), id: EVAN_DEMO_PUBLIC_PERSONA_ID, updatedAt: '2026-11-13T00:00:00Z' }],
        [EVAN_DEMO_EXTENDED_PERSONA_ID, { ...structuredClone(current), id: EVAN_DEMO_EXTENDED_PERSONA_ID, updatedAt: '2026-11-13T00:00:00Z' }],
    ]);
    const tools = new Map(current.tools.map(t => [t._toolId, { id: t._toolId, ...evanDemoToolBehavior(t) }]));
    const calls = [];
    const isolatedId = '05af215e-3f7f-4c5e-a9d7-7eb7fa20412a';
    const fetchImpl = async (url, options) => {
        const path = new URL(url).pathname.replace('/v1', '');
        const body = options.body ? JSON.parse(options.body) : undefined;
        calls.push({ path, method: options.method, body });
        let result;
        if (options.method === 'GET' && path.startsWith('/personas/')) result = personas.get(path.split('/').at(-1));
        else if (options.method === 'GET' && path.startsWith('/tools/')) result = tools.get(path.split('/').at(-1));
        else if (options.method === 'POST' && path === '/tools') { result = { id: isolatedId, ...body }; tools.set(isolatedId, result); }
        else if (options.method === 'PUT' && path.startsWith('/personas/')) {
            const id = path.split('/').at(-1);
            assert.ok([EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID].includes(id));
            const { toolIds, systemPrompt, personality, expectedUpdatedAt, ...rest } = body;
            assert.equal(expectedUpdatedAt, personas.get(id).updatedAt);
            result = { id, ...rest, brain: { systemPrompt: `${systemPrompt}\n# TOOLS\nGenerated by provider.`, personality },
                tools: toolIds.map(toolId => ({ ...structuredClone(tools.get(toolId)), _toolId: toolId })), updatedAt: '2026-11-13T00:01:00Z' };
            personas.set(id, result);
        }
        assert.ok(result, `Unexpected request ${options.method} ${path}`);
        return { ok: true, status: options.method === 'POST' ? 201 : 200, json: async () => structuredClone(result) };
    };
    return { calls, personas, fetchImpl };
}

test('provisioning dry-run is read-only and reports exactly two pinned copy updates', async () => {
    const fixture = provisioningFixture();
    const temp = mkdtempSync(join(tmpdir(), 'evan-demo-provision-'));
    try {
        const logs = [];
        await prepareEvanDurationCopies({ apiKey: 'fictional-test-key', fetchImpl: fixture.fetchImpl, receiptFile: join(temp, 'receipt.json'), log: x => logs.push(x) });
        assert.ok(fixture.calls.every(call => call.method === 'GET'));
        assert.equal(logs.filter(row => row.operation === 'update-existing-isolated-copy').length, 2);
        assert.equal(logs[0].createHistoricalPlannerTool, true);
        assert.equal(JSON.stringify(logs).includes('fictional-test-key'), false);
    } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('apply creates one isolated historical tool, changes only pinned copies, and reruns without duplicate writes', async () => {
    const fixture = provisioningFixture();
    const temp = mkdtempSync(join(tmpdir(), 'evan-demo-provision-'));
    const receiptFile = join(temp, 'receipt.json');
    try {
        await prepareEvanDurationCopies({ apply: true, apiKey: 'fictional-test-key', fetchImpl: fixture.fetchImpl, receiptFile, log: () => {} });
        assert.equal(fixture.calls.filter(c => c.method === 'POST').length, 1);
        assert.deepEqual(fixture.calls.filter(c => c.method === 'PUT').map(c => c.path).sort(), [`/personas/${EVAN_DEMO_PUBLIC_PERSONA_ID}`, `/personas/${EVAN_DEMO_EXTENDED_PERSONA_ID}`].sort());
        const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
        assert.equal(receipt.clones.length, 2);
        assert.ok(receipt.clones.every(row => row.verified));
        fixture.calls.length = 0;
        await prepareEvanDurationCopies({ apply: true, apiKey: 'fictional-test-key', fetchImpl: fixture.fetchImpl, receiptFile, log: () => {} });
        assert.ok(fixture.calls.every(call => call.method === 'GET'));
    } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('pending ambiguous tool creation cannot duplicate on retry; malformed arguments fail closed', async () => {
    for (const args of [['--prod'], ['--apply', '--apply'], ['--source', EVAN_DEMO_ORIGINAL_PERSONA_ID]]) assert.throws(() => parseEvanDemoPreparationArgs(args));
    assert.deepEqual(parseEvanDemoPreparationArgs([]), { apply: false, help: false });
    const fixture = provisioningFixture();
    const temp = mkdtempSync(join(tmpdir(), 'evan-demo-provision-'));
    const receiptFile = join(temp, 'receipt.json');
    try {
        await assert.rejects(prepareEvanDurationCopies({ apply: true, apiKey: 'fictional-test-key', receiptFile,
            fetchImpl: async (url, options) => { if (options.method === 'POST') throw new Error('Unknown network outcome'); return fixture.fetchImpl(url, options); }, log: () => {} }), /Unknown network outcome/);
        const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
        assert.equal(receipt.pendingToolCreation, true);
        fixture.calls.length = 0;
        await assert.rejects(prepareEvanDurationCopies({ apply: true, apiKey: 'fictional-test-key', receiptFile, fetchImpl: fixture.fetchImpl, log: () => {} }), /unknown outcome/);
        assert.equal(fixture.calls.length, 0);
        receipt.checkpointHash = 'tampered'; writeFileSync(receiptFile, JSON.stringify(receipt));
        await assert.rejects(prepareEvanDurationCopies({ apply: true, apiKey: 'fictional-test-key', receiptFile, fetchImpl: fixture.fetchImpl, log: () => {} }), /does not match/);
    } finally { rmSync(temp, { recursive: true, force: true }); }
});
