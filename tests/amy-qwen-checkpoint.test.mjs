import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const LEGACY_GPT_OSS_ID = 'a7cf662c-2ace-4de1-a21e-ef0fbf144bb7';

const [audit, conversationUpdater, workbenchUpdater, runtimeManifestSource] = await Promise.all([
    readFile(new URL('../scripts/anam/audit-amy-persona.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/anam/update-amy-conversation.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/anam/update-amy-workbench.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../config/anam/amy/v1/runtime-release-manifest.json', import.meta.url), 'utf8'),
]);
const runtimeManifest = JSON.parse(runtimeManifestSource);
const QWEN_ID = runtimeManifest.persona.llmId;

test('Amy live audit treats Qwen 3.8 27b as the required LLM checkpoint', () => {
    assert.equal(runtimeManifest.persona.llmId, QWEN_ID);
    assert.match(audit, /AMY_RUNTIME_RELEASE_MANIFEST\.persona\.llmId/);
    assert.match(audit, /Qwen 3\.8 27b/);
    assert.match(audit, /matchesExpected: llmCheckpointMatches/);
    assert.match(audit, /Amy LLM checkpoint mismatch/);
});

test('the single Amy managed sync pins Qwen and never submits an llmId', () => {
    assert.match(workbenchUpdater, new RegExp(QWEN_ID));
    assert.doesNotMatch(workbenchUpdater, new RegExp(LEGACY_GPT_OSS_ID));
    const putBodies = [...workbenchUpdater.matchAll(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)/g)]
        .map(match => match[1]);
    assert.ok(putBodies.length > 0, 'Expected at least one guarded update payload');
    for (const body of putBodies) assert.doesNotMatch(body, /\bllmId\s*:/);
    assert.match(conversationUpdater.trim(), /^throw new Error\(/);
    assert.doesNotMatch(conversationUpdater, /process\.env|fetch\s*\(/);
});

test('Amy managed sync verifies protected provider state after applying', () => {
    assert.match(workbenchUpdater, /protectedPersonaStateVerifiedUnchanged: true/);
});
