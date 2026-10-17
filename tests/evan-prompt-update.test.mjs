import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
    ACTIVE_SESSIONS_PATH, CANDIDATE_ID, CANDIDATE_NAME, assertNoActiveSessions,
    createAnamRequest, managedPromptOf, normalizePrompt, parseArgs, preservedConfiguration,
    promptSha256, savePersonaBackup, updateEvanPrompt, validateManifest,
} from '../scripts/anam/update-evan-prompt.mjs';

const prompt = '# Evan\nRespond to completed answers.\n';
const manifest = {
    personaId: CANDIDATE_ID, expectedName: CANDIDATE_NAME,
    expectedPromptSha256: promptSha256(prompt), expectedAvatarModel: 'cara-4',
    expectedAvatarId: 'avatar-id', expectedVoiceId: 'voice-id', expectedLlmId: 'llm-id',
    voiceDetectionOptions: { endOfSpeechSensitivity: 0.05, silenceBeforeSkipTurnSeconds: 0 },
    zeroDataRetention: false, enableAudioPassthrough: false,
    requiredToolNames: ['skip_turn', 'show_move_planner'],
    toolIds: { skip_turn: 'skip-id', show_move_planner: 'planner-id' },
};
const makePersona = () => ({
    id: CANDIDATE_ID, name: CANDIDATE_NAME, avatarModel: 'cara-4',
    avatar: { id: 'avatar-id', model: 'cara-4' }, voice: { id: 'voice-id', speed: 1 },
    brain: { systemPrompt: '# Old prompt\n', llm: { id: 'llm-id', temperature: 0.5 } },
    voiceDetectionOptions: structuredClone(manifest.voiceDetectionOptions),
    voiceGenerationOptions: { speed: 1 }, zeroDataRetention: false, enableAudioPassthrough: false,
    initialMessage: 'Hello', skipGreeting: false, uninterruptibleGreeting: false,
    tools: [{ id: 'skip-id', name: 'skip_turn', config: {} },
        { _toolId: 'planner-id', name: 'show_move_planner', config: { awaitResult: true }, disableInterruptions: true }],
});
const idle = () => ({ data: [], meta: { total: 0, next: null } });

function fixture(overrides = {}) {
    const events = [];
    let persona = makePersona();
    let sessionChecks = 0;
    let personaReads = 0;
    let applied = false;
    const request = async (pathname, init = {}) => {
        const method = init.method ?? 'GET';
        events.push({ type: 'request', pathname, method, body: init.body });
        if (pathname === ACTIVE_SESSIONS_PATH) {
            sessionChecks += 1;
            return overrides.sessions?.(sessionChecks) ?? idle();
        }
        assert.equal(pathname, `/personas/${CANDIDATE_ID}`);
        if (method === 'PUT') {
            if (overrides.putError) throw overrides.putError;
            applied = true;
            persona.brain.systemPrompt = `${JSON.parse(init.body).systemPrompt}\n# TOOLS\nProvider-generated tools\n`;
            return structuredClone(persona);
        }
        personaReads += 1;
        const result = structuredClone(persona);
        overrides.persona?.(result, { applied, personaReads });
        return result;
    };
    const options = { manifest: structuredClone(manifest), prompt, request,
        saveBackup: async previous => {
            events.push({ type: 'backup', previous: structuredClone(previous) });
            if (overrides.backupError) throw overrides.backupError;
            return '/private/prompt-before.json';
        },
        sleep: async ms => { events.push({ type: 'sleep', ms }); },
    };
    return { events, options };
}

test('import is inert and CLI defaults to dry-run, with explicit apply only', () => {
    assert.deepEqual(parseArgs([]), { apply: false, help: false });
    assert.deepEqual(parseArgs(['--apply']), { apply: true, help: false });
    assert.throws(() => parseArgs(['--persona', 'another-id']), /Only --apply/);
    assert.throws(() => parseArgs(['--apply', '--apply']), /Only --apply/);
});

test('normalization matches the existing audit and strips only generated tool suffix', () => {
    assert.equal(normalizePrompt('  # Evan\r\nAnswer.\r\n'), '# Evan\nAnswer.\n');
    assert.equal(managedPromptOf('# Evan\r\nAnswer.\r\n\r\n# TOOLS\r\nprovider suffix'), '# Evan\nAnswer.\n');
    assert.equal(promptSha256('# Evan\r\n'), promptSha256('# Evan\n'));
});

test('real managed prompt agrees with pinned manifest', async () => {
    const realManifest = JSON.parse(await fs.readFile(new URL('../config/anam/evan/persona-manifest.json', import.meta.url), 'utf8'));
    const realPrompt = await fs.readFile(new URL('../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8');
    assert.doesNotThrow(() => validateManifest(realManifest, realPrompt));
});

test('dry-run performs no write or local backup', async () => {
    const { events, options } = fixture();
    const result = await updateEvanPrompt(options);
    assert.equal(result.mode, 'dry-run');
    assert.equal(result.applied, false);
    assert.equal(result.promptChangeRequired, true);
    assert.deepEqual(events.map(event => event.method), ['GET', 'GET']);
    assert.equal(result.otherPersonasChanged, false);
});

test('manifest ID, name, and prompt mismatch fail before any provider request', async () => {
    for (const change of [{ personaId: '4b7e933a-ea04-4b84-b418-72c0762545e6' },
        { expectedName: 'Evan' }, { expectedPromptSha256: 'f'.repeat(64) }]) {
        const { events, options } = fixture();
        Object.assign(options.manifest, change);
        await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /Refusing update/);
        assert.equal(events.length, 0);
    }
});

test('live candidate identity and configuration mismatches fail before backup or write', async () => {
    for (const mutate of [persona => { persona.id = 'other'; }, persona => { persona.name = 'other'; },
        persona => { persona.voice.id = 'other'; }, persona => { persona.brain.llm.id = 'other'; },
        persona => { persona.voiceDetectionOptions.endOfSpeechSensitivity = 1; },
        persona => { persona.tools.pop(); }]) {
        const { events, options } = fixture({ persona: mutate });
        await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /candidate validation failed/);
        assert.equal(events.some(event => event.type === 'backup' || event.method === 'PUT'), false);
    }
});

test('active-session responses fail closed, including malformed or contradictory empty results', () => {
    for (const payload of [null, [], { data: [] }, { data: [], meta: { total: '0' } },
        { data: [], meta: { total: -1 } }, { data: [], meta: { total: 1 } },
        { data: [{ id: 'active' }], meta: { total: 0 } },
        { data: [], meta: { total: 0, next: 2 } }]) {
        assert.throws(() => assertNoActiveSessions(payload), /Refusing update/);
    }
    assert.doesNotThrow(() => assertNoActiveSessions(idle()));
});

test('active candidate blocks apply before backup or mutation', async () => {
    const { events, options } = fixture({ sessions: () => ({ data: [{ id: 'active' }], meta: { total: 1 } }) });
    await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /sessions may still be active/);
    assert.equal(events.some(event => event.type === 'backup' || event.method === 'PUT'), false);
});

test('apply backs up, rechecks idle state and config, then PUTs only systemPrompt once', async () => {
    const { events, options } = fixture();
    const result = await updateEvanPrompt({ ...options, apply: true });
    const writes = events.filter(event => event.method === 'PUT');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].pathname, `/personas/${CANDIDATE_ID}`);
    assert.deepEqual(JSON.parse(writes[0].body), { systemPrompt: prompt });
    const backupAt = events.findIndex(event => event.type === 'backup');
    const writeAt = events.findIndex(event => event.method === 'PUT');
    assert.ok(backupAt > 0 && backupAt < writeAt);
    assert.deepEqual(events.slice(backupAt + 1, writeAt).map(event => event.pathname), [ACTIVE_SESSIONS_PATH, `/personas/${CANDIDATE_ID}`]);
    assert.deepEqual(events.filter(event => event.type === 'sleep').map(event => event.ms), [2_000, 5_000]);
    assert.equal(result.applied, true);
    assert.equal(result.verified, true);
    assert.equal(result.preservedConfigurationVerified, true);
    assert.equal(events.filter(event => event.type === 'backup')[0].previous.brain.systemPrompt, '# Old prompt\n');
});

test('an active session appearing after backup still blocks the write', async () => {
    const { events, options } = fixture({ sessions: count => count === 2 ? { data: [{ id: 'new' }], meta: { total: 1 } } : idle() });
    await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /sessions may still be active/);
    assert.equal(events.some(event => event.type === 'backup'), true);
    assert.equal(events.some(event => event.method === 'PUT'), false);
});

test('concurrent prompt or non-prompt change after backup blocks the write', async () => {
    for (const mutate of [persona => { persona.brain.systemPrompt = 'A concurrent edit'; },
        persona => { persona.initialMessage = 'A concurrent greeting'; }]) {
        const { events, options } = fixture({ persona: (persona, { personaReads }) => { if (personaReads === 2) mutate(persona); } });
        await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /changed after the backup/);
        assert.equal(events.some(event => event.method === 'PUT'), false);
    }
});

test('a backup write failure prevents the remote mutation', async () => {
    const { events, options } = fixture({ backupError: new Error('Disk unavailable') });
    await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /Disk unavailable/);
    assert.equal(events.some(event => event.method === 'PUT'), false);
});

test('unchanged target prompt is a no-op even with apply', async () => {
    const { events, options } = fixture({ persona: persona => { persona.brain.systemPrompt = prompt; } });
    const result = await updateEvanPrompt({ ...options, apply: true });
    assert.equal(result.applied, false);
    assert.equal(result.promptChangeRequired, false);
    assert.equal(events.some(event => event.type === 'backup' || event.method === 'PUT'), false);
});

test('post-write avatar, voice, LLM, tools and speech option drift is rejected', async () => {
    for (const mutate of [persona => { persona.avatar.model = 'changed'; },
        persona => { persona.voice.speed = 2; }, persona => { persona.brain.llm.temperature = 1; },
        persona => { persona.tools[1].config.awaitResult = false; },
        persona => { persona.voiceGenerationOptions.speed = 2; },
        persona => { persona.voiceDetectionOptions.additionalSetting = 1; }]) {
        const { events, options } = fixture({ persona: (persona, { applied }) => { if (applied) mutate(persona); } });
        await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /non-prompt configuration changed/);
        assert.equal(events.filter(event => event.method === 'PUT').length, 1);
    }
});

test('the final read-back must match the managed hash; no automatic rollback or write retry', async () => {
    const { events, options } = fixture({ persona: (persona, { applied }) => { if (applied) persona.brain.systemPrompt = '# Stale prompt'; } });
    await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /final read-back hash did not match/);
    assert.equal(events.filter(event => event.method === 'PUT').length, 1);
});

test('a successful immediate read-back cannot hide a later prompt regression', async () => {
    const { events, options } = fixture({ persona: (persona, { applied, personaReads }) => {
        if (applied && personaReads > 3) persona.brain.systemPrompt = '# Later unexpected prompt';
    } });
    await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /final read-back hash did not match/);
    assert.equal(events.filter(event => event.method === 'PUT').length, 1);
});

test('ambiguous PUT failure is never automatically retried', async () => {
    const { events, options } = fixture({ putError: new Error('Timed out') });
    await assert.rejects(updateEvanPrompt({ ...options, apply: true }), /Timed out/);
    assert.equal(events.filter(event => event.method === 'PUT').length, 1);
});

test('backup uses the ignored candidate folder with exclusive creation and mode 0600', async () => {
    const writes = [];
    const mkdirs = [];
    const backupPath = await savePersonaBackup(makePersona(), {
        root: path.resolve('test-workspace'), now: () => new Date('2026-10-17T19:30:00Z'), uuid: () => 'unique',
        fsImpl: { mkdir: async (...args) => mkdirs.push(args), writeFile: async (...args) => writes.push(args) },
    });
    assert.equal(mkdirs[0][0], path.resolve('test-workspace', 'work', 'evan-6097-promotion'));
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], backupPath);
    assert.deepEqual(writes[0][2], { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    assert.equal(JSON.parse(writes[0][1]).persona.id, CANDIDATE_ID);
    assert.match(backupPath, /prompt-before-2026-10-17T19-30-00-000Z-unique\.json$/);
});

test('preservation comparison ignores object-key and tool order, not tool content', () => {
    const before = makePersona();
    const after = structuredClone(before);
    after.brain.systemPrompt = prompt;
    after.tools.reverse();
    after.voiceDetectionOptions = { silenceBeforeSkipTurnSeconds: 0, endOfSpeechSensitivity: 0.05 };
    assert.deepEqual(preservedConfiguration(before), preservedConfiguration(after));
    after.tools[0].disableInterruptions = false;
    assert.notDeepEqual(preservedConfiguration(before), preservedConfiguration(after));
});

const mediaHost = 'anam-prod.3b4e2c62766b488dfadbba0f05120797.r2.cloudflarestorage.com';
const signedMediaUrl = (filename, signature) => `https://${mediaHost}/avatars/evan/${filename}?quality=high&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=temporary-${signature}&X-Amz-Date=${signature}&X-Amz-Expires=3600&X-Amz-Signature=${signature}&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject#preview`;

test('fresh signing parameters in the two avatar media URLs do not look like a configuration change', () => {
    const before = makePersona();
    before.avatar.idleVideoUrl = signedMediaUrl('idle.mp4', 'first');
    before.avatar.videoUrl = signedMediaUrl('talking.mp4', 'first');
    const original = structuredClone(before);
    const after = structuredClone(before);
    after.avatar.idleVideoUrl = signedMediaUrl('idle.mp4', 'second');
    after.avatar.videoUrl = signedMediaUrl('talking.mp4', 'second');
    assert.deepEqual(preservedConfiguration(before), preservedConfiguration(after));
    assert.deepEqual(before, original, 'comparison must not alter the backup or source persona');
});

test('avatar media path, host, scheme, fragment, identity and non-signing query changes still fail preservation', () => {
    const before = makePersona();
    before.avatar.idleVideoUrl = signedMediaUrl('idle.mp4', 'first');
    before.avatar.videoUrl = signedMediaUrl('talking.mp4', 'first');
    for (const field of ['idleVideoUrl', 'videoUrl']) {
        for (const transform of [value => value.replace('.mp4?', '-different.mp4?'),
            value => value.replace(mediaHost, 'other.example.com'),
            value => value.replace('https:', 'http:'), value => value.replace('#preview', '#different'),
            value => value.replace('quality=high', 'quality=low'),
            value => value.replace('quality=high', 'quality=high&unknown-option=new'),
            value => value.replace('quality=high', 'quality=high&X-Amz-Unknown=new')]) {
            const after = structuredClone(before);
            after.avatar[field] = transform(after.avatar[field]);
            assert.notDeepEqual(preservedConfiguration(before), preservedConfiguration(after));
        }
    }
    const after = structuredClone(before);
    after.avatar.id = 'different-avatar';
    assert.notDeepEqual(preservedConfiguration(before), preservedConfiguration(after));
});

test('presigned values elsewhere and unrecognized media hosts are never normalized', () => {
    for (const field of ['thumbnailUrl', 'previewUrl']) {
        const before = makePersona();
        before.avatar[field] = signedMediaUrl('still.jpg', 'first');
        const after = structuredClone(before);
        after.avatar[field] = signedMediaUrl('still.jpg', 'second');
        assert.notDeepEqual(preservedConfiguration(before), preservedConfiguration(after));
    }
    const before = makePersona();
    before.avatar.videoUrl = signedMediaUrl('talking.mp4', 'first').replace(mediaHost, 'other.example.com');
    const after = structuredClone(before);
    after.avatar.videoUrl = signedMediaUrl('talking.mp4', 'second').replace(mediaHost, 'other.example.com');
    assert.notDeepEqual(preservedConfiguration(before), preservedConfiguration(after));
});

test('apply verification tolerates rotating signatures but not changed avatar media filenames', async () => {
    const { options } = fixture({ persona: (persona, { personaReads }) => {
        persona.avatar.videoUrl = signedMediaUrl('talking.mp4', String(personaReads));
        persona.avatar.idleVideoUrl = signedMediaUrl('idle.mp4', String(personaReads));
    } });
    const result = await updateEvanPrompt({ ...options, apply: true });
    assert.equal(result.preservedConfigurationVerified, true);
    const changed = fixture({ persona: (persona, { personaReads, applied }) => {
        persona.avatar.videoUrl = signedMediaUrl(applied ? 'different.mp4' : 'talking.mp4', String(personaReads));
    } });
    await assert.rejects(updateEvanPrompt({ ...changed.options, apply: true }), /non-prompt configuration changed/);
});

test('transport refuses other personas, tools, creation, deletion, or additional PUT fields', async () => {
    const fetchCalls = [];
    const request = createAnamRequest('test-key-never-print', async (...args) => {
        fetchCalls.push(args); return { ok: true, status: 204 };
    });
    for (const [pathname, init] of [['/personas/other', {}], ['/tools/tool', { method: 'PUT' }],
        [`/personas/${CANDIDATE_ID}`, { method: 'DELETE' }], ['/personas', { method: 'POST' }],
        [`/personas/${CANDIDATE_ID}`, { method: 'PUT', body: JSON.stringify({ systemPrompt: prompt, name: 'other' }) }],
        [`/personas/${CANDIDATE_ID}`, { method: 'PUT', body: 'null' }]]) {
        await assert.rejects(request(pathname, init), /Refusing request|Only systemPrompt/);
    }
    assert.equal(fetchCalls.length, 0);
    await request(`/personas/${CANDIDATE_ID}`, { method: 'PUT', body: JSON.stringify({ systemPrompt: prompt }) });
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0][1].redirect, 'error');
});

test('transport errors never echo response content, credentials, or raw error messages', async () => {
    const secret = 'do-not-print-test-key-or-transcript';
    for (const fetchImpl of [async () => { throw new Error(secret); },
        async () => ({ ok: false, status: 403, text: async () => secret }),
        async () => ({ ok: true, status: 200, json: async () => { throw new Error(secret); } })]) {
        const request = createAnamRequest(secret, fetchImpl);
        await assert.rejects(request(`/personas/${CANDIDATE_ID}`), error => !error.message.includes(secret));
    }
});
