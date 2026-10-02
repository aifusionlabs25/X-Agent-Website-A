// Model-only update. Never rewrites the owner's prompt, knowledge, or tools.
// ANAM_API_KEY must be supplied securely in this process's environment.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const personaId = '8a991c93-0c95-42c5-8c22-a67428946eb8';
const previousModel = 'a7cf662c-2ace-4de1-a21e-ef0fbf144bb7';
const qualifiedModel = '89649f1a-feb2-4fea-be43-56baec997a93';
const expectedPrompt = '6559610760f561bce8f08b322426fe9938528221b50a9653e653fd58eb9d5cb8';
const apply = process.argv.includes('--apply');
const rollback = process.argv.includes('--rollback');
const key = process.env.ANAM_API_KEY?.trim();
assert(key, 'ANAM_API_KEY is required; it is never printed');
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
        return Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]]));
    }
    return item;
});
const protectedSettings = persona => ({ ...Object.fromEntries([
    'name', 'brain', 'brainType', 'avatar', 'avatarModel', 'voice', 'voiceSpeed', 'initialMessage',
    'skipGreeting', 'uninterruptibleGreeting', 'languageCode', 'zeroDataRetention',
    'voiceDetectionOptions', 'voiceGenerationOptions', 'directorNotes', 'tools', 'enableAudioPassthrough',
].map(k => [k, persona[k] ?? null])),
    // Associated asset URLs contain expiring signatures; compare identities,
    // not the regenerated preview URLs in a GET response.
    avatar: { id: persona.avatar?.id }, voice: { id: persona.voice?.id },
});
async function anam(method, body) {
    const response = await fetch(`https://api.anam.ai/v1/personas/${personaId}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, `Anam ${method} failed (${response.status}); no credential/body logged`);
    return response.status === 204 ? null : response.json();
}
const before = await anam('GET');
assert.equal(before.id, personaId);
assert.equal(hash(before.brain.systemPrompt), expectedPrompt, 'Owner prompt changed; stop for review');
assert.deepEqual(before.tools.map(t => t._toolId).sort(), [
    '1e4e52df-d648-4ea5-86a3-0806e6acb592',
    '4d05849d-329f-4cd3-996f-f2a28d8135f0',
    '7904b2f4-cfc1-4f08-814f-0a0d14ac6643',
].sort(), 'Knowledge or system tool changed; stop for review');
const sourceModel = rollback ? qualifiedModel : previousModel;
const destinationModel = rollback ? previousModel : qualifiedModel;
assert([sourceModel, destinationModel].includes(before.llmId), 'Unreviewed current model; stop');
const protectedHash = hash(stable(protectedSettings(before)));
console.log(JSON.stringify({ personaId, apply, rollback, currentModel: before.llmId,
    destinationModel, promptSha256: expectedPrompt, protectedSettingsSha256: protectedHash }));
if (apply && before.llmId !== destinationModel) {
    await anam('PUT', { llmId: destinationModel });
}
const after = await anam('GET');
assert.equal(after.llmId, apply ? destinationModel : before.llmId);
const changedFields = Object.keys(protectedSettings(before)).filter(k =>
    stable(protectedSettings(before)[k]) !== stable(protectedSettings(after)[k]));
console.log(JSON.stringify({ changedProtectedFields: changedFields }));
assert.equal(hash(stable(protectedSettings(after))), protectedHash,
    'Protected settings changed unexpectedly; do not continue website release');
console.log(JSON.stringify({ verified: true, personaId, llmId: after.llmId,
    publishedAt: after.publishedAt, publishedModel: after.publishedCall?.llmId,
    promptAndKnowledgeAndVoiceAndToolsUnchanged: true }));
