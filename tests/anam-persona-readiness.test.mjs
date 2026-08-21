import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    AMY_KNOWLEDGE_RELEASE_MANIFEST,
    AMY_RUNTIME_MANAGED_PROMPT_MARKER_PAIRS,
    AMY_RUNTIME_RELEASE_MANIFEST,
} from '../lib/anam/amy-runtime-release-contract.mjs';
import {
    AMY_CARA4_REQUIRED_PROMPT_MARKERS,
    AMY_CARA4_REQUIRED_TOOL_NAMES,
    inspectAmyCara4PersonaReadiness,
    readAmyCara4PersonaReadiness,
} from '../lib/anam/persona-readiness.ts';

const PERSONA_ID = '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08';
const KNOWLEDGE_GROUP_ID = '90000000-0000-4000-8000-000000000001';

function syntheticToolId(index) {
    return `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function publishedManifest() {
    const manifest = structuredClone(AMY_RUNTIME_RELEASE_MANIFEST);
    manifest.deploymentStatus = 'published';
    manifest.releasedAt = '2026-08-20T12:00:00.000Z';
    manifest.requiredTools = manifest.requiredTools.map((tool, index) => ({
        ...tool,
        id: syntheticToolId(index),
    }));
    manifest.prompt.sha256 = createHash('sha256').update(managedPrompt(), 'utf8').digest('hex');
    manifest.knowledge.documentFolderIds = [KNOWLEDGE_GROUP_ID];
    return manifest;
}

function draftManifest() {
    const manifest = structuredClone(AMY_RUNTIME_RELEASE_MANIFEST);
    manifest.deploymentStatus = 'draft';
    manifest.releasedAt = null;
    manifest.prompt.sha256 = null;
    manifest.requiredTools = manifest.requiredTools.map(tool => ({ ...tool, id: null }));
    manifest.knowledge.documentFolderIds = null;
    return manifest;
}

function draftKnowledgeManifest() {
    const manifest = structuredClone(AMY_KNOWLEDGE_RELEASE_MANIFEST);
    manifest.liveToolId = null;
    manifest.liveGroupId = null;
    return manifest;
}

function publishedKnowledgeManifest(runtimeManifest = publishedManifest()) {
    const manifest = structuredClone(AMY_KNOWLEDGE_RELEASE_MANIFEST);
    manifest.liveToolId = runtimeManifest.requiredTools
        .find(tool => tool.name === 'Knowledge_Amy').id;
    manifest.liveGroupId = runtimeManifest.knowledge.documentFolderIds[0];
    return manifest;
}

function managedPrompt() {
    return AMY_RUNTIME_MANAGED_PROMPT_MARKER_PAIRS
        .map((pair, index) => `${pair.start}\nmanaged block ${index + 1}\n${pair.end}`)
        .join('\n\n');
}

function healthyPersona(manifest = publishedManifest()) {
    return {
        id: PERSONA_ID,
        name: 'Amy Insight SDR - Cara 4 Canary',
        avatarModel: 'cara-4',
        avatar: { id: '36e17abf-ef6c-4bef-99bd-3f925da155eb' },
        voice: { id: 'b138c2a2-ba66-4887-95d5-1a57093fc92d' },
        llmId: '65421f1c-c7de-4bc4-ac27-d171c16ef41f',
        initialMessage: "Hi, I'm Amy with Insight Enterprises. Who am I speaking with today?",
        zeroDataRetention: false,
        enableAudioPassthrough: false,
        tools: manifest.requiredTools.map(tool => ({
            name: tool.name,
            _toolId: tool.id,
        })),
        brain: {
            systemPrompt: managedPrompt(),
        },
    };
}

function healthyKnowledgeTool(manifest = publishedManifest()) {
    const pin = manifest.requiredTools.find(tool => tool.name === 'Knowledge_Amy');
    return {
        id: pin.id,
        name: 'Knowledge_Amy',
        type: 'SERVER_RAG',
        config: { documentFolderIds: [...manifest.knowledge.documentFolderIds] },
    };
}

function healthyKnowledgeGroup(
    manifest = publishedManifest(),
    knowledgeManifest = publishedKnowledgeManifest(manifest),
) {
    return {
        id: knowledgeManifest.liveGroupId,
        name: knowledgeManifest.folderName,
        description: `Amy-only public-safe KB. Bundle SHA-256: ${knowledgeManifest.bundleSha256}`,
    };
}

function inspectWithManifest(
    persona,
    manifest = publishedManifest(),
    knowledgeTool = healthyKnowledgeTool(manifest),
    knowledgeManifest = publishedKnowledgeManifest(manifest),
    knowledgeGroup = healthyKnowledgeGroup(manifest, knowledgeManifest),
) {
    return inspectAmyCara4PersonaReadiness(persona, PERSONA_ID, {
        manifest,
        knowledgeTool,
        knowledgeGroup,
        knowledgeManifest,
    });
}

test('Cara 4 preflight fails closed while the runtime release manifest is draft and nullable', () => {
    const manifest = draftManifest();
    const result = inspectAmyCara4PersonaReadiness(healthyPersona(), PERSONA_ID, {
        manifest,
        knowledgeManifest: draftKnowledgeManifest(),
    });
    assert.equal(result.ready, false);
    assert.equal(result.releaseManifestValid, true);
    assert.equal(result.releaseManifestPublished, false);
    assert.equal(result.releaseManifestComplete, false);
    assert.ok(result.failedInvariants.includes('releaseManifestPublished'));
    assert.ok(result.failedInvariants.includes('releaseManifestComplete'));
    assert.ok(manifest.requiredTools.every(tool => tool.id === null));
    assert.equal(manifest.knowledge.documentFolderIds, null);
});

test('Cara 4 preflight accepts an exact synthetic published runtime release', () => {
    const manifest = publishedManifest();
    const result = inspectWithManifest(healthyPersona(manifest), manifest);
    assert.equal(result.ready, true);
    assert.equal(result.releaseManifestValid, true);
    assert.equal(result.releaseManifestPublished, true);
    assert.equal(result.releaseManifestComplete, true);
    assert.equal(result.toolAttachmentMatches, true);
    assert.equal(result.promptMarkerContractMatches, true);
    assert.equal(result.knowledgeToolMatches, true);
    assert.equal(result.knowledgeGroupMatches, true);
    assert.deepEqual(result.failedInvariants, []);
    assert.ok(AMY_CARA4_REQUIRED_TOOL_NAMES.includes('send_follow_up_email'));
});

test('a published runtime release remains incomplete until prompt SHA-256 is pinned', () => {
    const manifest = publishedManifest();
    manifest.prompt.sha256 = null;
    const result = inspectWithManifest(healthyPersona(manifest), manifest);
    assert.equal(result.releaseManifestValid, true);
    assert.equal(result.releaseManifestPublished, false);
    assert.equal(result.releaseManifestComplete, false);
    assert.equal(result.promptHashPinned, false);
    assert.equal(result.promptHashMatches, false);
    assert.equal(result.ready, false);
});

test('Cara 4 preflight detects the exact stripped configuration from the failed session', () => {
    const manifest = publishedManifest();
    const result = inspectAmyCara4PersonaReadiness({
        id: PERSONA_ID,
        avatarModel: 'cara-4',
        tools: [
            { name: 'Knowledge_Amy' },
            { name: 'search_insight_catalog' },
        ],
        brain: { systemPrompt: 'Base prompt without managed blocks.' },
    }, PERSONA_ID, {
        manifest,
        knowledgeManifest: publishedKnowledgeManifest(manifest),
    });

    assert.equal(result.ready, false);
    assert.ok(result.missingToolNames.includes('send_follow_up_email'));
    assert.ok(result.missingToolNames.includes('end_amy_session'));
    assert.deepEqual(result.unexpectedToolNames, ['search_insight_catalog']);
    assert.deepEqual(result.missingPromptMarkers, AMY_CARA4_REQUIRED_PROMPT_MARKERS);
});

test('Cara 4 preflight rejects extra tools, duplicate names, and wrong pinned IDs', () => {
    const manifest = publishedManifest();
    const persona = healthyPersona(manifest);
    const result = inspectAmyCara4PersonaReadiness({
        ...persona,
        tools: [
            ...persona.tools.map(tool => tool.name === 'end_amy_session'
                ? { ...tool, _toolId: syntheticToolId(99) }
                : tool),
            { ...persona.tools[0] },
            { name: 'search_insight_catalog', _toolId: syntheticToolId(100) },
        ],
    }, PERSONA_ID, {
        manifest,
        knowledgeTool: healthyKnowledgeTool(manifest),
        knowledgeManifest: publishedKnowledgeManifest(manifest),
    });

    assert.equal(result.ready, false);
    assert.deepEqual(result.duplicateToolNames, ['Knowledge_Amy']);
    assert.deepEqual(result.unexpectedToolNames, ['search_insight_catalog']);
    assert.ok(result.mismatchedToolNames.includes('Knowledge_Amy'));
    assert.ok(result.mismatchedToolNames.includes('end_amy_session'));
    assert.equal(result.toolAttachmentMatches, false);
});

test('Cara 4 preflight also rejects identity, greeting, avatar, and voice drift', () => {
    const manifest = publishedManifest();
    const persona = healthyPersona(manifest);
    const inspect = value => inspectWithManifest(value, manifest);
    assert.equal(inspect({
        ...persona,
        id: 'different-persona',
    }).personaIdMatches, false);
    assert.equal(inspect({
        ...persona,
        avatarModel: 'cara-3',
    }).cara4AvatarConfigured, false);
    assert.equal(inspect({
        ...persona,
        name: 'Another Amy',
    }).identityMatches, false);
    assert.equal(inspect({
        ...persona,
        initialMessage: 'How can I help?',
    }).initialMessageMatches, false);
    assert.equal(inspect({
        ...persona,
        avatar: { id: 'different-avatar' },
    }).avatarIdMatches, false);
    assert.equal(inspect({
        ...persona,
        voice: { id: 'different-voice' },
    }).voiceIdMatches, false);
});

test('Cara 4 preflight fails closed when Amy drifts from the pinned Qwen checkpoint', () => {
    const manifest = publishedManifest();
    const result = inspectWithManifest({
        ...healthyPersona(manifest),
        llmId: 'a7cf662c-2ace-4de1-a21e-ef0fbf144bb7',
    }, manifest);

    assert.equal(result.ready, false);
    assert.equal(result.llmIdMatches, false);
});

test('Cara 4 preflight rejects zero-data retention and audio passthrough', () => {
    const manifest = publishedManifest();
    const persona = healthyPersona(manifest);
    const zeroDataRetention = inspectWithManifest({
        ...persona,
        zeroDataRetention: true,
    }, manifest);
    assert.equal(zeroDataRetention.ready, false);
    assert.equal(zeroDataRetention.sessionDataRetentionConfigured, false);

    const audioPassthrough = inspectWithManifest({
        ...persona,
        enableAudioPassthrough: true,
    }, manifest);
    assert.equal(audioPassthrough.ready, false);
    assert.equal(audioPassthrough.anamTranscriptionPipelineConfigured, false);
});

test('Cara 4 preflight requires each managed prompt pair exactly once, in order, and without overlap', () => {
    const manifest = publishedManifest();
    const persona = healthyPersona(manifest);
    const firstPair = AMY_RUNTIME_MANAGED_PROMPT_MARKER_PAIRS[0];
    const duplicate = inspectWithManifest({
        ...persona,
        brain: {
            systemPrompt: `${managedPrompt()}\n${firstPair.start}\nduplicate\n${firstPair.end}`,
        },
    }, manifest);
    assert.equal(duplicate.promptMarkerContractMatches, false);
    assert.deepEqual(duplicate.duplicatePromptMarkers, [firstPair.start, firstPair.end]);

    const blocks = AMY_RUNTIME_MANAGED_PROMPT_MARKER_PAIRS
        .map((pair, index) => `${pair.start}\nblock ${index}\n${pair.end}`);
    [blocks[0], blocks[1]] = [blocks[1], blocks[0]];
    const reordered = inspectWithManifest({
        ...persona,
        brain: { systemPrompt: blocks.join('\n') },
    }, manifest);
    assert.equal(reordered.promptMarkerContractMatches, false);
    assert.equal(reordered.overlappingPromptMarkerPairs.length, 1);

    const reversed = inspectWithManifest({
        ...persona,
        brain: {
            systemPrompt: managedPrompt().replace(
                `${firstPair.start}\nmanaged block 1\n${firstPair.end}`,
                `${firstPair.end}\nmanaged block 1\n${firstPair.start}`,
            ),
        },
    }, manifest);
    assert.equal(reversed.promptMarkerContractMatches, false);
    assert.equal(reversed.misorderedPromptMarkerPairs.length, 1);
});

test('Cara 4 preflight enforces the pinned prompt hash required by a published release', () => {
    const manifest = publishedManifest();
    manifest.prompt.sha256 = createHash('sha256').update(managedPrompt(), 'utf8').digest('hex');
    assert.equal(inspectWithManifest(healthyPersona(manifest), manifest).promptHashMatches, true);
    const drifted = inspectWithManifest({
        ...healthyPersona(manifest),
        brain: { systemPrompt: `${managedPrompt()}\nunaudited tail` },
    }, manifest);
    assert.equal(drifted.ready, false);
    assert.equal(drifted.promptHashMatches, false);
});

test('Cara 4 preflight requires exact Knowledge_Amy detail ID, type, and documentFolderIds', () => {
    const manifest = publishedManifest();
    const persona = healthyPersona(manifest);
    const wrong = inspectWithManifest(persona, manifest, {
        ...healthyKnowledgeTool(manifest),
        type: 'CLIENT',
        config: { documentFolderIds: ['90000000-0000-4000-8000-000000000002'] },
    });
    assert.equal(wrong.ready, false);
    assert.equal(wrong.knowledgeToolIdMatches, true);
    assert.equal(wrong.knowledgeToolTypeMatches, false);
    assert.equal(wrong.knowledgeDocumentFolderIdsMatch, false);
    assert.equal(wrong.knowledgeToolMatches, false);
});

test('Cara 4 preflight requires the exact versioned knowledge-group name and bundle-hash description', () => {
    const manifest = publishedManifest();
    const knowledgeManifest = publishedKnowledgeManifest(manifest);
    const persona = healthyPersona(manifest);
    const wrongName = inspectWithManifest(
        persona,
        manifest,
        healthyKnowledgeTool(manifest),
        knowledgeManifest,
        {
            ...healthyKnowledgeGroup(manifest, knowledgeManifest),
            name: 'Unversioned Amy knowledge',
        },
    );
    assert.equal(wrongName.ready, false);
    assert.equal(wrongName.knowledgeGroupIdMatches, true);
    assert.equal(wrongName.knowledgeGroupNameMatches, false);
    assert.equal(wrongName.knowledgeGroupDescriptionMatches, true);

    const wrongBundle = inspectWithManifest(
        persona,
        manifest,
        healthyKnowledgeTool(manifest),
        knowledgeManifest,
        {
            ...healthyKnowledgeGroup(manifest, knowledgeManifest),
            description: 'Amy-only public-safe KB. Bundle SHA-256: stale-bundle',
        },
    );
    assert.equal(wrongBundle.ready, false);
    assert.equal(wrongBundle.knowledgeGroupNameMatches, true);
    assert.equal(wrongBundle.knowledgeGroupDescriptionMatches, false);
    assert.equal(wrongBundle.knowledgeGroupMatches, false);
});

test('Cara 4 preflight rejects invalid knowledge bundle metadata before remote comparison', () => {
    const manifest = publishedManifest();
    const knowledgeManifest = publishedKnowledgeManifest(manifest);
    knowledgeManifest.bundleSha256 = 'not-a-sha256';
    const result = inspectWithManifest(
        healthyPersona(manifest),
        manifest,
        healthyKnowledgeTool(manifest),
        knowledgeManifest,
        healthyKnowledgeGroup(manifest, knowledgeManifest),
    );
    assert.equal(result.ready, false);
    assert.equal(result.releaseManifestValid, false);
    assert.ok(result.manifestFailures.includes('manifest.knowledge.bundleMetadata'));
    assert.equal(result.knowledgeGroupDescriptionMatches, false);
});

test('Cara 4 preflight cross-pins runtime knowledge IDs to the knowledge release manifest', () => {
    const manifest = publishedManifest();
    const knowledgeManifest = publishedKnowledgeManifest(manifest);
    knowledgeManifest.liveGroupId = '90000000-0000-4000-8000-000000000002';
    const result = inspectWithManifest(
        healthyPersona(manifest),
        manifest,
        healthyKnowledgeTool(manifest),
        knowledgeManifest,
    );
    assert.equal(result.ready, false);
    assert.equal(result.knowledgeManifestCrossPinMatches, false);
    assert.ok(result.manifestFailures.includes('manifest.knowledge.crossPin'));
});

test('live readiness fetch is no-store, bounded, and returns only configuration status', async () => {
    const manifest = publishedManifest();
    const persona = healthyPersona(manifest);
    const knowledgeTool = healthyKnowledgeTool(manifest);
    const knowledgeManifest = publishedKnowledgeManifest(manifest);
    const knowledgeGroup = healthyKnowledgeGroup(manifest, knowledgeManifest);
    const calls = [];
    const result = await readAmyCara4PersonaReadiness(PERSONA_ID, {
        apiKey: 'secret-test-key',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            const requestUrl = String(url);
            const payload = requestUrl.includes('/tools/')
                ? knowledgeTool
                : requestUrl.includes('/knowledge/groups/')
                    ? knowledgeGroup
                    : persona;
            return new Response(JSON.stringify(payload), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
        manifest,
        knowledgeManifest,
    });

    assert.equal(result.ready, true);
    assert.equal(calls.length, 3);
    assert.match(calls[0].url, new RegExp(`/personas/${PERSONA_ID}$`));
    assert.match(calls[1].url, new RegExp(`/tools/${knowledgeTool.id}$`));
    assert.match(calls[2].url, new RegExp(`/knowledge/groups/${knowledgeGroup.id}$`));
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[1].init.cache, 'no-store');
    assert.equal(calls[2].init.cache, 'no-store');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-test-key');
    assert.equal(calls[1].init.headers.Authorization, 'Bearer secret-test-key');
    assert.equal(calls[2].init.headers.Authorization, 'Bearer secret-test-key');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.doesNotMatch(JSON.stringify(result), /secret-test-key/);
});

test('live readiness fails closed without requesting nullable tool or group IDs from a draft manifest', async () => {
    const calls = [];
    const manifest = draftManifest();
    const result = await readAmyCara4PersonaReadiness(PERSONA_ID, {
        apiKey: 'secret-test-key',
        manifest,
        knowledgeManifest: draftKnowledgeManifest(),
        fetchImpl: async (url, init) => {
            calls.push({ url: String(url), init });
            return new Response(JSON.stringify(healthyPersona()), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });

    assert.equal(result.ready, false);
    assert.equal(result.releaseManifestPublished, false);
    assert.equal(result.releaseManifestComplete, false);
    assert.equal(result.knowledgeToolMatches, false);
    assert.equal(result.knowledgeGroupMatches, false);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, new RegExp(`/personas/${PERSONA_ID}$`));
});

test('the token route fails closed before reserving or authenticating a stripped Amy session', async () => {
    const route = await readFile(new URL('../app/api/anam-token/route.ts', import.meta.url), 'utf8');
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const audit = await readFile(new URL('../scripts/anam/audit-amy-persona.mjs', import.meta.url), 'utf8');
    const preflight = route.indexOf('readAmyCara4PersonaReadiness(');
    const reserve = route.indexOf('storeAmyAnamLaunch(');
    const sessionToken = route.indexOf("fetch('https://api.anam.ai/v1/auth/session-token'");

    assert.ok(preflight > 0);
    assert.ok(preflight < reserve);
    assert.ok(preflight < sessionToken);
    assert.match(route, /Amy configuration is out of sync/);
    assert.match(route, /releaseManifestPublished: personaReadiness\.releaseManifestPublished/);
    assert.match(route, /knowledgeManifestCrossPinMatches: personaReadiness\.knowledgeManifestCrossPinMatches/);
    assert.match(route, /llmIdMatches: personaReadiness\.llmIdMatches/);
    assert.match(route, /toolAttachmentMatches: personaReadiness\.toolAttachmentMatches/);
    assert.match(route, /promptMarkerContractMatches: personaReadiness\.promptMarkerContractMatches/);
    assert.match(route, /knowledgeToolMatches: personaReadiness\.knowledgeToolMatches/);
    assert.match(route, /knowledgeGroupMatches: personaReadiness\.knowledgeGroupMatches/);
    assert.match(route, /knowledgeGroupDescriptionMatches: personaReadiness\.knowledgeGroupDescriptionMatches/);
    assert.match(route, /failedInvariants: personaReadiness\.failedInvariants/);
    assert.match(route, /status: 503/);
    assert.doesNotMatch(route, /missingToolNames[^\n]*error:/);
    const tokenRequest = route.slice(sessionToken, route.indexOf('const data =', sessionToken));
    assert.match(tokenRequest, /personaConfig:\s*\{\s*personaId: resolution\.personaId/);
    assert.doesNotMatch(tokenRequest, /zeroDataRetention|enableAudioPassthrough|livekit/i);
    assert.match(player, /const errorPayload = await tokenRes\.json\(\)\.catch/);
    assert.match(player, /serverMessage \|\| 'Failed to start the agent session'/);
    assert.match(player, /err instanceof Error \? err\.message/);
    assert.match(audit, /readAmyRuntimeReleaseState/);
    assert.match(audit, /knowledgeGroupDescriptionMatches/);
    assert.match(audit, /readiness\.failedInvariants\.join/);
    assert.match(audit, /Amy runtime release audit failed/);
});
