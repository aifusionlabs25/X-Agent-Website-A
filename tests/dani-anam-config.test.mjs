import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';
import {
    DANI_EXPECTED_AVATAR_ID,
    DANI_EXPECTED_LLM_ID,
    DANI_EXPECTED_NAME,
    DANI_MINIMUM_PUBLISHED_AT,
    DANI_EXPECTED_PROMPT_SHA256,
    DANI_EXPECTED_VOICE_ID,
    DANI_PERSONA_ID,
    DANI_REQUIRED_PROMPT_MARKERS,
    DANI_REQUIRED_TOOL_IDS,
    DANI_REQUIRED_TOOL_NAMES,
    DANI_REQUIRED_VOICE_DETECTION,
    inspectDaniPersonaReadiness,
    readDaniPersonaReadiness,
} from '../lib/anam/persona-readiness.ts';

const normalizeLineEndings = value => String(value).replace(/\r\n?/g, '\n');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizedSha256 = value => sha256(Buffer.from(normalizeLineEndings(value), 'utf8'));
const configUrl = new URL('../config/anam/dani/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('persona-manifest.json', configUrl), 'utf8'));
const knowledgeManifestUrl = new URL(manifest.knowledgeManifestFile, configUrl);
const knowledgeManifest = JSON.parse(await readFile(knowledgeManifestUrl, 'utf8'));
const prompt = await readFile(new URL(manifest.promptFile, configUrl), 'utf8');

function healthyPersona() {
    return {
        id: DANI_PERSONA_ID,
        name: DANI_EXPECTED_NAME,
        publishedAt: DANI_MINIMUM_PUBLISHED_AT,
        avatarModel: 'cara-4',
        avatar: { id: DANI_EXPECTED_AVATAR_ID },
        voice: { id: DANI_EXPECTED_VOICE_ID },
        zeroDataRetention: false,
        enableAudioPassthrough: false,
        voiceDetectionOptions: { ...DANI_REQUIRED_VOICE_DETECTION },
        tools: DANI_REQUIRED_TOOL_NAMES.map(name => ({ name, id: DANI_REQUIRED_TOOL_IDS[name] })),
        brain: {
            llm: { id: DANI_EXPECTED_LLM_ID },
            systemPrompt: prompt,
        },
    };
}

test('Dani readiness pins identity, Cara 4 avatar, Rachel voice, GPT OSS 120B, v2 prompt, tools, and voice behavior', () => {
    const result = inspectDaniPersonaReadiness(healthyPersona());
    assert.deepEqual(result, {
        ready: true,
        personaIdMatches: true,
        identityMatches: true,
        publishedRevisionMatches: true,
        cara4AvatarConfigured: true,
        avatarIdMatches: true,
        voiceIdMatches: true,
        llmIdMatches: true,
        promptHashMatches: true,
        voiceDetectionConfigured: true,
        sessionDataRetentionConfigured: true,
        anamTranscriptionPipelineConfigured: true,
        toolAttachmentMatches: true,
        missingToolNames: [],
        missingPromptMarkers: [],
    });

    const drifted = [
        { ...healthyPersona(), id: 'wrong-persona' },
        { ...healthyPersona(), name: 'Dani NEW' },
        { ...healthyPersona(), publishedAt: '2026-08-09T18:00:00.000Z' },
        { ...healthyPersona(), avatarModel: 'cara-3' },
        { ...healthyPersona(), avatar: { id: 'wrong-avatar' } },
        { ...healthyPersona(), voice: { id: 'wrong-voice' } },
        { ...healthyPersona(), brain: { ...healthyPersona().brain, llm: { id: 'wrong-llm' } } },
        { ...healthyPersona(), brain: { ...healthyPersona().brain, systemPrompt: 'stripped prompt' } },
        { ...healthyPersona(), tools: [{ name: 'Knowledge_Liv' }] },
        { ...healthyPersona(), tools: healthyPersona().tools.map((tool, index) => index ? tool : { ...tool, id: 'wrong-tool-id' }) },
        { ...healthyPersona(), voiceDetectionOptions: { endOfSpeechSensitivity: 0.8 } },
        { ...healthyPersona(), zeroDataRetention: true },
        { ...healthyPersona(), enableAudioPassthrough: true },
    ];
    for (const persona of drifted) assert.equal(inspectDaniPersonaReadiness(persona).ready, false);

    const republished = { ...healthyPersona(), publishedAt: '2026-08-09T19:30:00.000Z' };
    assert.equal(inspectDaniPersonaReadiness(republished).ready, true);
});

test('Dani readiness accepts Anam generated tool text outside the managed prompt hash', () => {
    const persona = healthyPersona();
    persona.brain.systemPrompt = `${prompt.trim()}\n# TOOLS\nProvider-generated tool instructions`;
    assert.equal(inspectDaniPersonaReadiness(persona).ready, true);
});

test('Dani live readiness is bounded, no-store, and does not expose the API key', async () => {
    const calls = [];
    const result = await readDaniPersonaReadiness('dani-test-secret', async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(healthyPersona()), { status: 200 });
    });
    assert.equal(result.ready, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, new RegExp(`${DANI_PERSONA_ID}$`));
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer dani-test-secret');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.doesNotMatch(JSON.stringify(result), /dani-test-secret/);
});

test('managed Dani prompt covers AI solution discovery, native meeting behavior, action honesty, and website email boundaries', () => {
    assert.equal(normalizedSha256(prompt), DANI_EXPECTED_PROMPT_SHA256);
    assert.equal(manifest.promptSha256, DANI_EXPECTED_PROMPT_SHA256);
    for (const marker of DANI_REQUIRED_PROMPT_MARKERS) assert.ok(prompt.includes(marker));
    assert.doesNotMatch(prompt, /\bDanny\b|Sales Technician/i);
    assert.match(prompt, /You are Dani, the AI Solutions Director/i);
    assert.match(prompt, /X Agents are AI Fusion Labs' flagship product, but they are not the answer to every problem/i);
    assert.match(prompt, /Use this order of authority/i);
    assert.match(prompt, /Ask at most one meaningful question/i);
    assert.match(prompt, /Do not end every turn with a question/i);
    assert.match(prompt, /Knowledge_Dani_AI_Solutions_Director/);
    assert.match(prompt, /Retrieval does not take a business action/i);
    assert.match(prompt, /Anam group-call mode controls joining and name-gated participation/i);
    assert.match(prompt, /do not call `end_call` based on a participant's farewell/i);
    assert.match(prompt, /send_dani_follow_up_email/);
    assert.match(prompt, /Never call this tool in an Anam group meeting/i);
    assert.match(prompt, /email_queued/);
});

test('managed Dani KB is an exact ten-file, hashed, public-safe AI solutions allowlist', async () => {
    const filenames = (await readdir(new URL('knowledge/', knowledgeManifestUrl))).sort();
    assert.deepEqual(filenames, [...knowledgeManifest.documents].sort());
    assert.equal(filenames.length, 10);
    const fingerprints = [];
    for (const filename of knowledgeManifest.documents) {
        const content = await readFile(new URL(`knowledge/${filename}`, knowledgeManifestUrl), 'utf8');
        const fingerprint = {
            filename,
            bytes: Buffer.byteLength(content, 'utf8'),
            sha256: sha256(Buffer.from(content, 'utf8')),
        };
        fingerprints.push(fingerprint);
        assert.deepEqual(
            { bytes: fingerprint.bytes, sha256: fingerprint.sha256 },
            knowledgeManifest.documentFingerprints[filename],
        );
        assert.match(content, /Verified: 2026-08-09/);
        assert.doesNotMatch(content, /\bDanny\b|Sales Technician/i);
    }
    assert.equal(normalizedSha256(JSON.stringify(fingerprints)), knowledgeManifest.bundleSha256);
    const proof = await readFile(new URL('knowledge/05_demo_portfolio_and_evidence.md', knowledgeManifestUrl), 'utf8');
    assert.doesNotMatch(proof, /Salesforce|Aberdeen|Vidyard|EyeView|Salesloft|Drift|Wistia/i);
    assert.match(proof, /not customer case studies/i);
    const meeting = await readFile(new URL('knowledge/08_meeting_participation_playbook.md', knowledgeManifestUrl), 'utf8');
    const followUp = await readFile(new URL('knowledge/09_post_call_follow_up_boundaries.md', knowledgeManifestUrl), 'utf8');
    assert.match(meeting, /silent until addressed by its display name/i);
    assert.match(followUp, /native Anam meeting/i);
    assert.match(followUp, /exactly-once/i);
});

test('manifest and site use the exact published Dani identity and optimized Cara 4 image', async () => {
    assert.equal(manifest.personaId, DANI_PERSONA_ID);
    assert.equal(manifest.rollbackPersonaId, '61f0fd3e-7937-472a-958d-cdba76b33bf1');
    assert.equal(manifest.expectedName, 'Dani AI Solutions Director');
    assert.equal(manifest.verifiedPublishedAt, DANI_MINIMUM_PUBLISHED_AT);
    assert.equal(manifest.expectedAvatarId, DANI_EXPECTED_AVATAR_ID);
    assert.equal(manifest.expectedVoiceId, DANI_EXPECTED_VOICE_ID);
    assert.equal(manifest.expectedLlmId, DANI_EXPECTED_LLM_ID);
    assert.deepEqual(manifest.voiceDetectionOptions, DANI_REQUIRED_VOICE_DETECTION);
    assert.deepEqual(manifest.requiredToolNames, DANI_REQUIRED_TOOL_NAMES);
    assert.equal(manifest.emailToolName, 'send_dani_follow_up_email');

    const agents = await readFile(new URL('../lib/agents.ts', import.meta.url), 'utf8');
    const hero = await readFile(new URL('../components/home/HeroBillboard.tsx', import.meta.url), 'utf8');
    assert.match(agents, new RegExp(`slug: "dani"[\\s\\S]{0,300}personaId: "${DANI_PERSONA_ID}"`));
    assert.match(hero, new RegExp(`personaId="${DANI_PERSONA_ID}"`));
    assert.match(agents, /dani-x-agent-director-cara4-2026\.jpg/);
    assert.match(hero, /dani-x-agent-director-cara4-2026\.jpg/);
    assert.doesNotMatch(agents.match(/slug: "dani"[\s\S]{0,300}/)?.[0] ?? '', /Dani landing page hero 1|61f0fd3e/);

    const imageUrl = new URL('../public/agents/thumbnails/dani-x-agent-director-cara4-2026.jpg', import.meta.url);
    const image = await readFile(imageUrl);
    const imageStat = await stat(imageUrl);
    assert.deepEqual([...image.subarray(0, 2)], [0xff, 0xd8]);
    assert.ok(imageStat.size < 350_000, 'optimized Dani image should remain below 350 KB');
});

test('Dani updater is guarded, reversible, idempotent, and manages the dedicated RAG and client tools', async () => {
    const updater = await readFile(new URL('../scripts/anam/update-dani-persona.mjs', import.meta.url), 'utf8');
    const audit = await readFile(new URL('../scripts/anam/audit-dani-persona.mjs', import.meta.url), 'utf8');
    assert.match(updater, /const apply = args\.includes\('--apply'\)/);
    assert.match(updater, /CONFIRM_DANI_CARA4_SYNC/);
    assert.match(updater, /absolute --backup-dir outside the repository/i);
    assert.match(updater, /protectedRollbackPersona/);
    assert.match(updater, /missingDocuments/);
    assert.match(updater, /waitForDocuments/);
    assert.match(updater, /verifyDocumentBytes/);
    assert.match(updater, /emailToolDefinition/);
    assert.match(updater, /emailToolAwaitResult/);
    assert.match(updater, /draft_applied_publish_required/);
    assert.match(updater, /manualPublishRequired: true/);
    assert.match(updater, /process\.exitCode = 2/);
    assert.match(updater, /delayedReadbackPassed: true/);
    assert.match(updater, /protectedRollbackPersonaUnchanged: true/);
    assert.doesNotMatch(updater, /anam\('\/personas',\s*\{[\s\S]{0,80}method:\s*'POST'/);
    assert.doesNotMatch(updater, /method:\s*'DELETE'/);
    assert.doesNotMatch(audit, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
    assert.match(audit, /verified published revision/);
});

test('token route fails closed on Dani drift before session token minting', async () => {
    const route = await readFile(new URL('../app/api/anam-token/route.ts', import.meta.url), 'utf8');
    const readiness = route.indexOf('readDaniPersonaReadiness(anamApiKey)');
    const token = route.indexOf("fetch('https://api.anam.ai/v1/auth/session-token'");
    assert.ok(readiness > 0 && readiness < token);
    assert.match(route, /Dani is temporarily unavailable while her configuration is restored/);
    assert.match(route, /promptHashMatches/);
    assert.match(route, /voiceDetectionConfigured/);
    assert.match(route, /status: 503/);
});
