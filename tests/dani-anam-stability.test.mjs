import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    CANONICAL_FIRST_SENTENCE_CLAUSE,
    CANONICAL_IDENTITY_CLAUSE,
    DANI_PERSONA_ID,
    LEGACY_FIRST_SENTENCE_CLAUSE,
    LEGACY_IDENTITY_CLAUSE,
    deriveCorrectedPrompt,
    executeDaniPromptStability,
    fingerprintsOf,
} from '../scripts/anam/stabilize-dani-prompt.mjs';

const TEST_API_KEY = 'test-only-anam-key-never-log';
const LEGACY_PROMPT = [
    'DANI X AGENT SYSTEM PROMPT V18C',
    '',
    'Identity',
    LEGACY_IDENTITY_CLAUSE,
    '',
    LEGACY_FIRST_SENTENCE_CLAUSE,
    '',
    'Keep every other instruction unchanged.',
].join('\n');
const PROVIDER_TOOLS_SUFFIX = '\n# TOOLS\nProvider-generated tool instructions that must never be written back.';
const FULL_PROVIDER_PROMPT = `${LEGACY_PROMPT}${PROVIDER_TOOLS_SUFFIX}`;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function response(value, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return clone(value);
        },
    };
}

function providerFixture(overrides = {}) {
    return {
        persona: {
            id: DANI_PERSONA_ID,
            name: 'Dani X Agent Director',
            description: 'Public X Agent Director demonstration persona.',
            avatarModel: 'cara-3',
            avatar: { id: 'avatar-dani' },
            voice: { id: 'voice-dani' },
            llmId: 'llm-dani',
            languageCode: 'en',
            initialMessage: 'Hey, welcome. I am Dani. What are you most curious about today?',
            skipGreeting: false,
            uninterruptibleGreeting: false,
            zeroDataRetention: false,
            enableAudioPassthrough: false,
            voiceDetectionOptions: { endOfSpeechSensitivity: 0.2 },
            voiceGenerationOptions: { speed: 1 },
            widgetConfig: { accentColor: '#6366f1' },
            brain: { systemPrompt: FULL_PROVIDER_PROMPT, temperature: 0.2 },
            tools: [{ _toolId: 'tool-dani-kb', name: 'Knowledge_Dani' }],
            ...overrides,
        },
        tool: {
            id: 'tool-dani-kb',
            name: 'Knowledge_Dani',
            type: 'SERVER_RAG',
            config: { documentFolderIds: ['group-dani'] },
        },
        group: {
            id: 'group-dani',
            name: 'Dani approved public knowledge',
        },
        documents: [{ id: 'document-dani-1', filename: 'DANI_KB_00.md', status: 'READY' }],
    };
}

function createProviderMock({ personaOverrides, driftAfterPut = false } = {}) {
    const fixture = providerFixture(personaOverrides);
    const calls = [];
    const putBodies = [];
    let putPerformed = false;

    const fetchImpl = async (url, init = {}) => {
        const parsed = new URL(url);
        const method = init.method ?? 'GET';
        calls.push({ pathname: parsed.pathname, method, headers: init.headers });
        assert.equal(init.headers.Authorization, `Bearer ${TEST_API_KEY}`);

        if (parsed.pathname === `/v1/personas/${DANI_PERSONA_ID}` && method === 'PUT') {
            const body = JSON.parse(init.body);
            putBodies.push(body);
            fixture.persona.brain.systemPrompt = `${body.systemPrompt.trimEnd()}${PROVIDER_TOOLS_SUFFIX}`;
            putPerformed = true;
            return response(fixture.persona);
        }
        if (parsed.pathname === `/v1/personas/${DANI_PERSONA_ID}` && method === 'GET') {
            const persona = clone(fixture.persona);
            if (putPerformed && driftAfterPut) persona.voice.id = 'unexpected-voice-drift';
            return response(persona);
        }
        if (parsed.pathname === '/v1/knowledge/groups' && method === 'GET') {
            return response([fixture.group]);
        }
        if (parsed.pathname === '/v1/tools/tool-dani-kb' && method === 'GET') {
            return response(fixture.tool);
        }
        if (parsed.pathname === '/v1/knowledge/groups/group-dani/documents' && method === 'GET') {
            return response({ data: fixture.documents });
        }
        throw new Error(`Unexpected mocked Anam request: ${method} ${parsed.pathname}`);
    };

    return { calls, fetchImpl, fixture, putBodies };
}

async function temporaryBackupRoot(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dani-anam-stability-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}

const fixedNow = () => new Date('2026-08-08T03:04:05.678Z');

test('derives the canonical Dani identity with only the two expected literal replacements', () => {
    const corrected = deriveCorrectedPrompt(LEGACY_PROMPT);
    assert.equal(corrected.includes(CANONICAL_IDENTITY_CLAUSE), true);
    assert.equal(corrected.includes(CANONICAL_FIRST_SENTENCE_CLAUSE), true);
    assert.equal(corrected.includes(LEGACY_IDENTITY_CLAUSE), false);
    assert.equal(corrected.includes(LEGACY_FIRST_SENTENCE_CLAUSE), false);
    assert.equal(corrected.includes('Keep every other instruction unchanged.'), true);
    assert.throws(
        () => deriveCorrectedPrompt(LEGACY_PROMPT.replace(LEGACY_IDENTITY_CLAUSE, 'You are Dani.')),
        /expected exactly one identity legacy clause/,
    );
    assert.throws(
        () => deriveCorrectedPrompt(`${LEGACY_PROMPT}\n${LEGACY_IDENTITY_CLAUSE}`),
        /expected exactly one identity legacy clause/,
    );
});

test('fingerprints ignore rotating signed avatar delivery URLs but retain avatar identity', () => {
    const before = providerFixture();
    before.persona.avatar.idleVideoUrl = 'https://signed.example/idle?token=before';
    before.persona.avatar.videoUrl = 'https://signed.example/video?token=before';
    const after = clone(before);
    after.persona.avatar.idleVideoUrl = 'https://signed.example/idle?token=after';
    after.persona.avatar.videoUrl = 'https://signed.example/video?token=after';
    const beforeSnapshot = { persona: before.persona, attachedTools: [before.tool], knowledgeGroups: [{ metadata: before.group, documents: before.documents }] };
    const afterSnapshot = { persona: after.persona, attachedTools: [after.tool], knowledgeGroups: [{ metadata: after.group, documents: after.documents }] };
    assert.deepEqual(fingerprintsOf(afterSnapshot), fingerprintsOf(beforeSnapshot));
    afterSnapshot.persona.avatar.id = 'different-avatar';
    assert.notEqual(fingerprintsOf(afterSnapshot).nonPromptSha256, fingerprintsOf(beforeSnapshot).nonPromptSha256);
});

test('dry-run writes a complete protected snapshot and redacted plan without a provider PUT', async t => {
    const backupDirectory = await temporaryBackupRoot(t);
    const provider = createProviderMock();
    const logLines = [];
    const result = await executeDaniPromptStability({
        apiKey: TEST_API_KEY,
        backupDirectory,
        fetchImpl: provider.fetchImpl,
        now: fixedNow,
        logger: { log: line => logLines.push(line) },
    });

    assert.equal(result.plan.mode, 'dry-run');
    assert.equal(provider.putBodies.length, 0);
    assert.equal(provider.calls.some(call => call.method === 'PUT'), false);
    const snapshot = JSON.parse(await fs.readFile(path.join(result.runDirectory, 'provider-snapshot.json'), 'utf8'));
    assert.equal(snapshot.persona.brain.systemPrompt, FULL_PROVIDER_PROMPT);
    assert.equal(snapshot.attachedTools[0].id, 'tool-dani-kb');
    assert.equal(snapshot.knowledgeGroups[0].documents[0].status, 'READY');
    assert.equal(snapshot.rollback.bodyKeys.length, 1);
    assert.equal(snapshot.rollback.bodyKeys[0], 'systemPrompt');
    const rollback = await fs.readFile(path.join(result.runDirectory, 'ROLLBACK_INSTRUCTIONS.md'), 'utf8');
    const publicOutput = logLines.join('\n');
    assert.equal(publicOutput.includes(LEGACY_PROMPT), false);
    assert.equal(publicOutput.includes(CANONICAL_IDENTITY_CLAUSE), false);
    assert.equal(publicOutput.includes(TEST_API_KEY), false);
    assert.equal(rollback.includes(LEGACY_PROMPT), false);
    assert.equal(JSON.stringify(snapshot).includes(TEST_API_KEY), false);
});

test('requires an explicit absolute non-repository backup path before any provider request', async () => {
    let fetchCalled = false;
    await assert.rejects(
        executeDaniPromptStability({
            apiKey: TEST_API_KEY,
            fetchImpl: async () => {
                fetchCalled = true;
                throw new Error('must not fetch');
            },
            now: fixedNow,
            logger: { log() {} },
        }),
        /--backup-dir must be an explicit absolute local path/,
    );
    assert.equal(fetchCalled, false);
});

test('exact identity and initial-message guards fail closed before any provider mutation', async t => {
    const wrongNameBackup = await temporaryBackupRoot(t);
    const wrongName = createProviderMock({ personaOverrides: { name: 'Dani' } });
    await assert.rejects(
        executeDaniPromptStability({
            apiKey: TEST_API_KEY,
            backupDirectory: wrongNameBackup,
            applyPromptOnly: true,
            fetchImpl: wrongName.fetchImpl,
            now: fixedNow,
            logger: { log() {} },
        }),
        /name was not exactly Dani/,
    );
    assert.equal(wrongName.putBodies.length, 0);

    const staleGreetingBackup = await temporaryBackupRoot(t);
    const staleGreeting = createProviderMock({
        personaOverrides: { initialMessage: 'Hi, I am Danny, your Sales Technician.' },
    });
    await assert.rejects(
        executeDaniPromptStability({
            apiKey: TEST_API_KEY,
            backupDirectory: staleGreetingBackup,
            applyPromptOnly: true,
            fetchImpl: staleGreeting.fetchImpl,
            now: fixedNow,
            logger: { log() {} },
        }),
        /initialMessage contains a stale identity or role/,
    );
    assert.equal(staleGreeting.putBodies.length, 0);
});

test('apply mode sends exactly one systemPrompt field and verifies immediate and delayed fingerprints', async t => {
    const backupDirectory = await temporaryBackupRoot(t);
    const provider = createProviderMock();
    const delays = [];
    const result = await executeDaniPromptStability({
        apiKey: TEST_API_KEY,
        backupDirectory,
        applyPromptOnly: true,
        fetchImpl: provider.fetchImpl,
        delayImpl: async milliseconds => delays.push(milliseconds),
        now: fixedNow,
        logger: { log() {} },
    });

    assert.equal(provider.putBodies.length, 1);
    assert.deepEqual(Object.keys(provider.putBodies[0]), ['systemPrompt']);
    assert.equal(provider.putBodies[0].systemPrompt.includes(CANONICAL_IDENTITY_CLAUSE), true);
    assert.equal(provider.putBodies[0].systemPrompt.includes(CANONICAL_FIRST_SENTENCE_CLAUSE), true);
    assert.equal(provider.putBodies[0].systemPrompt.includes('# TOOLS'), false);
    assert.deepEqual(delays, [5_000]);
    assert.equal(result.plan.immediateReadbackPassed, true);
    assert.equal(result.plan.delayedReadbackPassed, true);
});

test('apply mode detects non-prompt provider drift during read-back', async t => {
    const backupDirectory = await temporaryBackupRoot(t);
    const provider = createProviderMock({ driftAfterPut: true });
    await assert.rejects(
        executeDaniPromptStability({
            apiKey: TEST_API_KEY,
            backupDirectory,
            applyPromptOnly: true,
            fetchImpl: provider.fetchImpl,
            delayImpl: async () => {},
            now: fixedNow,
            logger: { log() {} },
        }),
        /changed nonPromptSha256/,
    );
    assert.equal(provider.putBodies.length, 1);
    assert.deepEqual(Object.keys(provider.putBodies[0]), ['systemPrompt']);
});
