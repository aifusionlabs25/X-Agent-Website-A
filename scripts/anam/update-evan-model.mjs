// Candidate-only model switch. Run with --env-file=.env.local; dry-run by default.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'config/anam/evan/persona-manifest.json'), 'utf8'));
const candidateId = '6097c73e-b6ef-48c5-94c7-9a95d4863b99';
const previousModel = 'a7cf662c-2ace-4de1-a21e-ef0fbf144bb7';
const qualifiedModel = '2032d289-6faa-46e6-819c-fbe4dd79a37a';
const apply = process.argv.includes('--apply');
const key = process.env.ANAM_API_KEY?.trim();
assert(key, 'ANAM_API_KEY is required; it is never printed');
assert.equal(manifest.personaId, candidateId);
assert.equal(manifest.expectedLlmId, qualifiedModel);

const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(field => [field, item[field]])) : item);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const managedPrompt = value => `${String(value).replace(/\r\n?/g, '\n').split('\n# TOOLS\n', 1)[0].trim()}\n`;
const llmIdOf = persona => persona?.brain?.llm?.id ?? persona?.brain?.llmId ?? persona?.llm?.id ?? persona?.llmId;
const toolIdOf = tool => tool?._toolId ?? tool?.id;

async function anam(pathname, method = 'GET', body) {
    const response = await fetch(`https://api.anam.ai/v1${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
        cache: 'no-store',
    });
    assert(response.ok, `Anam ${method} failed (HTTP ${response.status}); no response body logged`);
    return response.status === 204 ? null : response.json();
}

const personaPath = `/personas/${candidateId}`;
const sessionsPath = `/sessions?personaId=${candidateId}&active=true&perPage=100`;
async function requireIdle() {
    const sessions = await anam(sessionsPath);
    assert(Array.isArray(sessions?.data) && Number.isInteger(sessions?.meta?.total)
        && sessions.meta.total === 0 && sessions.data.length === 0 && sessions.meta.next == null,
    'Evan candidate has active sessions or the active-session check is inconclusive');
}

function validateIdentity(persona, allowedModels) {
    assert.equal(persona?.id, candidateId);
    assert.equal(persona.name, manifest.expectedName);
    assert.equal(persona.avatarModel, manifest.expectedAvatarModel);
    assert.equal(persona.avatar?.id, manifest.expectedAvatarId);
    assert.equal(persona.voice?.id, manifest.expectedVoiceId);
    assert(allowedModels.includes(llmIdOf(persona)), 'Evan has an unreviewed model; stop');
    assert.equal(hash(managedPrompt(persona.brain?.systemPrompt ?? '')), manifest.expectedPromptSha256);
    assert.equal(persona.tools?.length, manifest.requiredToolNames.length);
    for (const name of manifest.requiredToolNames) {
        assert.equal(persona.tools.filter(tool => tool.name === name && toolIdOf(tool) === manifest.toolIds[name]).length, 1);
    }
}

function protectedSettings(persona) {
    const brain = { ...persona.brain };
    delete brain.llm;
    delete brain.llmId;
    return {
        id: persona.id, name: persona.name, avatarModel: persona.avatarModel,
        avatarId: persona.avatar?.id, voiceId: persona.voice?.id,
        brain, brainType: persona.brainType, initialMessage: persona.initialMessage,
        skipGreeting: persona.skipGreeting, uninterruptibleGreeting: persona.uninterruptibleGreeting,
        voiceSpeed: persona.voiceSpeed, languageCode: persona.languageCode,
        voiceDetectionOptions: persona.voiceDetectionOptions,
        voiceGenerationOptions: persona.voiceGenerationOptions,
        zeroDataRetention: persona.zeroDataRetention,
        enableAudioPassthrough: persona.enableAudioPassthrough,
        directorNotes: persona.directorNotes,
        tools: [...persona.tools].sort((left, right) => String(toolIdOf(left)).localeCompare(String(toolIdOf(right)))),
    };
}

const [before, model] = await Promise.all([anam(personaPath), anam(`/llms/${qualifiedModel}`)]);
validateIdentity(before, [previousModel, qualifiedModel]);
assert.equal(model.id, qualifiedModel);
assert.equal(model.modelName, 'qwen/qwen3.6-27b');
assert.equal(model.isDeprecated, false);
await requireIdle();
const protectedHash = hash(stable(protectedSettings(before)));
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', personaId: candidateId,
    currentModel: llmIdOf(before), destinationModel: qualifiedModel,
    modelName: model.modelName, activeSessions: 0,
    mutationFields: ['llmId'], promptSha256: manifest.expectedPromptSha256 }));
if (apply && llmIdOf(before) !== qualifiedModel) {
    const backupDir = path.join(root, 'work/evan-6097-promotion');
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir,
        `model-before-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`);
    await fs.writeFile(backupPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), persona: before }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await requireIdle();
    const latest = await anam(personaPath);
    validateIdentity(latest, [previousModel]);
    assert.equal(hash(stable(protectedSettings(latest))), protectedHash,
        'Evan candidate changed after backup; stop');
    await anam(personaPath, 'PUT', { llmId: qualifiedModel });
    console.log(JSON.stringify({ backupPath, modelUpdateSubmitted: true }));
}
const after = await anam(personaPath);
validateIdentity(after, apply ? [qualifiedModel] : [previousModel, qualifiedModel]);
assert.equal(hash(stable(protectedSettings(after))), protectedHash,
    'Non-model persona configuration changed; review the backup');
if (apply) {
    assert.equal(after.publishedCall?.llmId, qualifiedModel,
        'Published model did not match Qwen after update');
}
console.log(JSON.stringify({ verified: true, personaId: candidateId,
    llmId: llmIdOf(after), publishedModel: after.publishedCall?.llmId,
    otherPersonaSettingsPreserved: true }));
