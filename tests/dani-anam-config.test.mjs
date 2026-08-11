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
const previousPrompt = prompt
    .replace(/\r\n?/g, '\n')
    .replace(
        /\n\n<!-- DANI_RETURNING_MEMORY_START -->[\s\S]*?<!-- DANI_RETURNING_MEMORY_END -->\n\n/,
        '\n\n',
    );
const identityToolDefinition = JSON.parse(await readFile(
    new URL(manifest.identityToolDefinitionFile, configUrl),
    'utf8',
));
const endSessionToolDefinition = JSON.parse(await readFile(
    new URL(manifest.endSessionToolDefinitionFile, configUrl),
    'utf8',
));

function healthyPersona() {
    return {
        id: DANI_PERSONA_ID,
        name: DANI_EXPECTED_NAME,
        publishedAt: '2026-08-11T01:00:00.000Z',
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
        { ...healthyPersona(), publishedAt: '2026-08-10T01:40:14.102Z' },
        { ...healthyPersona(), publishedAt: DANI_MINIMUM_PUBLISHED_AT },
        { ...healthyPersona(), avatarModel: 'cara-3' },
        { ...healthyPersona(), avatar: { id: 'wrong-avatar' } },
        { ...healthyPersona(), voice: { id: 'wrong-voice' } },
        { ...healthyPersona(), brain: { ...healthyPersona().brain, llm: { id: 'wrong-llm' } } },
        { ...healthyPersona(), brain: { ...healthyPersona().brain, systemPrompt: 'stripped prompt' } },
        { ...healthyPersona(), tools: [{ name: 'Knowledge_Liv' }] },
        { ...healthyPersona(), tools: [...healthyPersona().tools, { name: 'unexpected_tool', id: 'unexpected-tool-id' }] },
        { ...healthyPersona(), tools: healthyPersona().tools.map((tool, index) => index ? tool : { ...tool, id: 'wrong-tool-id' }) },
        { ...healthyPersona(), voiceDetectionOptions: { endOfSpeechSensitivity: 0.8 } },
        { ...healthyPersona(), zeroDataRetention: true },
        { ...healthyPersona(), enableAudioPassthrough: true },
    ];
    for (const persona of drifted) assert.equal(inspectDaniPersonaReadiness(persona).ready, false);

    const republished = { ...healthyPersona(), publishedAt: '2026-08-11T02:00:00.000Z' };
    assert.equal(inspectDaniPersonaReadiness(republished).ready, true);
});

test('Dani readiness accepts Anam generated tool text outside the managed prompt hash', () => {
    const persona = healthyPersona();
    persona.brain.systemPrompt = `${prompt.trim()}\n# TOOLS\nProvider-generated tool instructions`;
    assert.equal(inspectDaniPersonaReadiness(persona).ready, true);
});

test('Dani readiness accepts only the exact published five-tool baseline', () => {
    assert.equal(inspectDaniPersonaReadiness(healthyPersona()).ready, true);
    assert.equal(normalizedSha256(prompt), DANI_EXPECTED_PROMPT_SHA256);
    for (const marker of DANI_REQUIRED_PROMPT_MARKERS) assert.ok(prompt.includes(marker));

    const previousPromptWithCurrentTools = {
        ...healthyPersona(),
        brain: { ...healthyPersona().brain, systemPrompt: previousPrompt },
    };
    const currentPromptWithPreviousTools = {
        ...healthyPersona(),
        tools: healthyPersona().tools.filter(tool => tool.name !== 'confirm_dani_live_identity'),
    };
    const previousBaseline = {
        ...currentPromptWithPreviousTools,
        brain: { ...healthyPersona().brain, systemPrompt: previousPrompt },
    };
    assert.equal(inspectDaniPersonaReadiness(previousPromptWithCurrentTools).ready, false);
    assert.equal(inspectDaniPersonaReadiness(currentPromptWithPreviousTools).ready, false);
    assert.equal(inspectDaniPersonaReadiness(previousBaseline).ready, false);
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
    assert.notEqual(normalizedSha256(previousPrompt), DANI_EXPECTED_PROMPT_SHA256);
    assert.equal(normalizedSha256(prompt), manifest.promptSha256);
    assert.equal(manifest.promptSha256, DANI_EXPECTED_PROMPT_SHA256);
    for (const marker of DANI_REQUIRED_PROMPT_MARKERS) assert.ok(prompt.includes(marker));
    assert.doesNotMatch(prompt, /\bDanny\b|Sales Technician/i);
    assert.match(prompt, /You are Dani, the AI Solutions Director/i);
    assert.match(prompt, /X Agents are AI Fusion Labs' flagship product, but they are not the answer to every problem/i);
    assert.match(prompt, /Use this order of authority/i);
    assert.match(prompt, /Live voice contract - highest priority/i);
    assert.match(prompt, /render your own name as "Dannie"[\s\S]*pronounced "DAN-ee," rhyming with "Annie," never "Donnie\."/i);
    assert.match(prompt, /Avoid the ambiguous noun "lead"[\s\S]*sales prospect[\s\S]*past tense "led\."/i);
    assert.match(prompt, /roughly 15 to 30 spoken words by default/i);
    assert.match(prompt, /Forty words is a hard ceiling/i);
    assert.match(prompt, /Never end two consecutive replies with questions/i);
    assert.match(prompt, /Observed behavior corrections - mandatory/i);
    assert.match(prompt, /If someone is skeptical of avatars, separate the workflow from the interface/i);
    assert.match(prompt, /Treat an in-house build as a credible option/i);
    assert.match(prompt, /Never say an introduction to Rob can move forward/i);
    assert.match(prompt, /honest range.*ballpark.*best guess/is);
    assert.match(prompt, /low five figures.*mid six figures.*a few weeks/is);
    assert.match(prompt, /An ambitious team can combine models, APIs, retrieval, workflow frameworks/i);
    assert.match(prompt, /ends mid-thought.*or did I.*skip_turn/is);
    assert.match(prompt, /Non-negotiable claim gate/i);
    assert.match(prompt, /self-service or no-code X Agent sandbox/i);
    assert.match(prompt, /free pilot or trial/i);
    assert.match(prompt, /implementation in a few hours/i);
    assert.match(prompt, /Never guess a participant's name/i);
    assert.match(prompt, /Do not state that an avatar builds trust/i);
    assert.match(prompt, /Ask at most one meaningful question/i);
    assert.match(prompt, /After a question is answered, prefer a useful statement and silence/i);
    assert.match(prompt, /periodically ask one brief discovery question/i);
    assert.match(prompt, /what kinds of companies the visitor typically connects with/i);
    assert.match(prompt, /I can't confirm the specifics, but I can outline what would need to be scoped/i);
    assert.match(prompt, /If you'd like to explore the fit, I can outline what a discovery call would need to cover/i);
    assert.match(prompt, /let's wrap up.*Call `end_dani_session` without confirmation/is);
    assert.match(prompt, /Knowledge_Dani_AI_Solutions_Director/);
    assert.match(prompt, /Retrieval does not take a business action/i);
    assert.match(prompt, /Anam group-call mode controls joining and name-gated participation/i);
    assert.match(prompt, /do not call `end_dani_session` based on a participant's farewell/i);
    assert.match(prompt, /send_dani_follow_up_email/);
    assert.match(prompt, /confirm_dani_live_identity/);
    assert.match(prompt, /Never call this tool in an Anam group meeting/i);
    assert.match(prompt, /email_queued/);
    const memoryStart = prompt.indexOf('<!-- DANI_RETURNING_MEMORY_START -->');
    const memoryEnd = prompt.indexOf('<!-- DANI_RETURNING_MEMORY_END -->');
    const postCallStart = prompt.indexOf('<!-- DANI_POST_CALL_EMAIL_START -->');
    const managedEnd = prompt.indexOf('<!-- DANI_POST_CALL_EMAIL_END -->');
    assert.ok(memoryStart >= 0 && memoryStart < memoryEnd);
    assert.ok(memoryEnd < postCallStart && postCallStart < managedEnd);
});

test('Dani identity tool is dedicated and uses the exact two-field client schema', () => {
    assert.equal(manifest.identityToolDefinitionFile, '../dani-live-identity-client-tool.json');
    assert.equal(manifest.identityToolName, 'confirm_dani_live_identity');
    assert.equal(identityToolDefinition.name, manifest.identityToolName);
    assert.equal(identityToolDefinition.type, 'CLIENT');
    assert.equal(identityToolDefinition.disableInterruptions, true);
    assert.equal(identityToolDefinition.config.awaitResult, true);
    assert.deepEqual(
        Object.keys(identityToolDefinition.config.parameters.properties).sort(),
        ['memoryAccessConfirmed', 'preferredName'],
    );
    assert.deepEqual(
        [...identityToolDefinition.config.parameters.required].sort(),
        ['memoryAccessConfirmed', 'preferredName'],
    );
    assert.equal(identityToolDefinition.config.parameters.additionalProperties, false);
    assert.equal(identityToolDefinition.config.parameters.properties.preferredName.type, 'string');
    assert.equal(identityToolDefinition.config.parameters.properties.preferredName.minLength, 1);
    assert.equal(identityToolDefinition.config.parameters.properties.preferredName.maxLength, 80);
    assert.equal(identityToolDefinition.config.parameters.properties.memoryAccessConfirmed.type, 'boolean');
    assert.notEqual(identityToolDefinition.name, 'confirm_live_identity');
});

test('Dani end-session tool is dedicated, parameterless, and replaces built-in end_call', () => {
    assert.equal(manifest.endSessionToolDefinitionFile, '../dani-end-session-client-tool.json');
    assert.equal(manifest.endSessionToolName, 'end_dani_session');
    assert.equal(endSessionToolDefinition.name, manifest.endSessionToolName);
    assert.equal(endSessionToolDefinition.type, 'CLIENT');
    assert.equal(endSessionToolDefinition.disableInterruptions, true);
    assert.equal(endSessionToolDefinition.config.awaitResult, true);
    assert.equal(endSessionToolDefinition.config.toolTimeoutSeconds, 15);
    assert.deepEqual(endSessionToolDefinition.config.parameters, {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
    });
    assert.match(endSessionToolDefinition.description, /already confirmation/i);
    assert.match(endSessionToolDefinition.description, /never ask whether to end/i);
    assert.doesNotMatch(manifest.requiredToolNames.join(' '), /\bend_call\b/);
    assert.equal(Object.hasOwn(manifest.systemToolIds, 'end_call'), false);
});

test('managed Dani KB is an exact thirteen-file, hashed, public-safe AI solutions allowlist', async () => {
    const filenames = (await readdir(new URL('knowledge/', knowledgeManifestUrl))).sort();
    assert.deepEqual(filenames, [...knowledgeManifest.documents].sort());
    assert.equal(filenames.length, 13);
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
        assert.match(content, /Verified: 2026-08-(?:09|10)/);
        assert.doesNotMatch(content, /\bDanny\b|Sales Technician/i);
    }
    assert.equal(normalizedSha256(JSON.stringify(fingerprints)), knowledgeManifest.bundleSha256);
    const proof = await readFile(new URL('knowledge/05_demo_portfolio_and_evidence.md', knowledgeManifestUrl), 'utf8');
    assert.doesNotMatch(proof, /Salesforce|Aberdeen|Vidyard|EyeView|Salesloft|Drift|Wistia/i);
    assert.match(proof, /not customer case studies/i);
    const meeting = await readFile(new URL('knowledge/08_meeting_participation_playbook.md', knowledgeManifestUrl), 'utf8');
    const followUp = await readFile(new URL('knowledge/09_post_call_follow_up_boundaries.md', knowledgeManifestUrl), 'utf8');
    const founder = await readFile(new URL('knowledge/10_ai_fusion_labs_founder_public_profile.md', knowledgeManifestUrl), 'utf8');
    const claimControl = await readFile(new URL('knowledge/11_claim_control_and_safe_hypotheticals.md', knowledgeManifestUrl), 'utf8');
    const liveVoice = await readFile(new URL('knowledge/12_live_voice_and_commercial_pressure.md', knowledgeManifestUrl), 'utf8');
    assert.match(meeting, /silent until addressed by its display name/i);
    assert.match(followUp, /native Anam meeting/i);
    assert.match(followUp, /exactly-once/i);
    assert.match(founder, /Rob Vicks is the founder of AI Fusion Labs/);
    assert.match(founder, /professional context statement, not a personal biography/i);
    assert.match(founder, /do not speculate/i);
    assert.match(founder, /family information|health information|private contact information/i);
    assert.doesNotMatch(founder, /founded in \d{4}|headquartered in|graduated from|married to/i);
    assert.match(claimControl, /self-service or no-code X Agent sandbox/i);
    assert.match(claimControl, /free pilot, free trial, or zero-cost/i);
    assert.match(claimControl, /setup, integration, or deployment in a few hours/i);
    assert.match(claimControl, /Never guess a participant's name/i);
    assert.match(claimControl, /Reduced manual effort is a hypothesis/i);
    assert.match(liveVoice, /roughly 15 to 30 spoken words/i);
    assert.match(liveVoice, /Forty words is a hard ceiling/i);
    assert.match(liveVoice, /must not end two consecutive replies with questions/i);
    assert.match(liveVoice, /An internal build is a credible option/i);
    assert.match(liveVoice, /cannot accept the introduction, confirm Rob's availability/i);
    assert.match(liveVoice, /low five figures.*mid six figures.*four to six weeks.*eight to ten weeks/is);
    assert.match(liveVoice, /They could build something similar/i);
    assert.match(liveVoice, /SaaS founder.*conference operator.*healthcare/is);
    assert.match(liveVoice, /proactive does not mean asking a question after every answer/i);
    assert.match(liveVoice, /Professional uncertainty names the boundary and the useful next step/i);
    assert.match(liveVoice, /discovery call would need to cover/i);
    assert.match(liveVoice, /do not fill the answer with an industry estimate/i);
});

test('Dani red-team QA preserves the observed Boardy interview failure cases', async () => {
    const qa = await readFile(new URL('v2/QA_SCENARIOS.md', configUrl), 'utf8');
    assert.match(qa, /no-code X Agent sandbox/i);
    assert.match(qa, /free pilot, trial, or zero-cost/i);
    assert.match(qa, /connect our CRM and FAQ and have it running in a few hours/i);
    assert.match(qa, /human-looking avatar always builds trust and empathy/i);
    assert.match(qa, /Never guesses or invents a name/i);
    assert.match(qa, /honest.*price and delivery range/is);
    assert.match(qa, /ambitious team could reproduce X Agents/i);
    assert.match(qa, /roughly 15 to 30 spoken words/i);
    assert.match(qa, /never exceed 40/i);
    assert.match(qa, /Skeptical-avatar lead qualification/i);
    assert.match(qa, /Credible three-week internal build/i);
    assert.match(qa, /Founder introduction request/i);
    assert.match(qa, /Human question cadence/i);
});

test('manifest and site use the exact published Dani identity and optimized Cara 4 image', async () => {
    assert.equal(manifest.personaId, DANI_PERSONA_ID);
    assert.equal(manifest.rollbackPersonaId, '61f0fd3e-7937-472a-958d-cdba76b33bf1');
    assert.equal(manifest.expectedName, 'Dani AI Solutions Director');
    assert.equal(manifest.verifiedPublishedAt, DANI_MINIMUM_PUBLISHED_AT);
    assert.equal(manifest.transitionPreviousPublishedAt, DANI_MINIMUM_PUBLISHED_AT);
    assert.equal(manifest.expectedAvatarId, DANI_EXPECTED_AVATAR_ID);
    assert.equal(manifest.expectedVoiceId, DANI_EXPECTED_VOICE_ID);
    assert.equal(manifest.expectedLlmId, DANI_EXPECTED_LLM_ID);
    assert.deepEqual(manifest.voiceDetectionOptions, DANI_REQUIRED_VOICE_DETECTION);
    assert.deepEqual(manifest.requiredToolNames, [...DANI_REQUIRED_TOOL_NAMES]);
    assert.equal(manifest.emailToolName, 'send_dani_follow_up_email');
    assert.equal(manifest.identityToolName, 'confirm_dani_live_identity');
    assert.ok(manifest.identityToolId === null || /^[0-9a-f-]{36}$/i.test(manifest.identityToolId));
    assert.equal(manifest.endSessionToolName, 'end_dani_session');
    assert.match(manifest.endSessionToolId, /^[0-9a-f-]{36}$/i);

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
    assert.match(updater, /identityToolDefinitionFile/);
    assert.match(updater, /endSessionToolDefinitionFile/);
    assert.match(updater, /confirm_dani_live_identity/);
    assert.match(updater, /end_dani_session/);
    assert.match(updater, /--prepare-identity-tool/);
    assert.match(updater, /identity_tool_prepared_manifest_pin_required/);
    assert.match(updater, /existingManagedIdentityTool/);
    assert.match(updater, /verifiedIdentityTool/);
    assert.match(updater, /expectedToolPairs\s*=\s*\[[\s\S]{0,500}identityToolDefinition\.name/);
    assert.match(updater, /manifestUpdated: false/);
    assert.match(updater, /personaPromptChanged: false/);
    assert.match(updater, /personaAttachmentsChanged: false/);
    assert.match(updater, /exact two-field schema/i);
    assert.match(updater, /Amy identity tool attachment/);
    assert.match(updater, /emailToolAwaitResult/);
    assert.match(updater, /draft_applied_publish_required/);
    assert.match(updater, /manualPublishRequired: true/);
    assert.match(updater, /process\.exitCode = 2/);
    assert.match(updater, /delayedReadbackPassed: true/);
    assert.match(updater, /protectedRollbackPersonaUnchanged: true/);
    assert.doesNotMatch(updater, /anam\('\/personas',\s*\{[\s\S]{0,80}method:\s*'POST'/);
    assert.doesNotMatch(updater, /method:\s*'DELETE'/);
    assert.doesNotMatch(updater, /writeFile\([^)]*persona-manifest\.json/);
    assert.doesNotMatch(audit, /method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
    assert.match(audit, /verified published revision/);
    assert.match(audit, /pinned managed identity tool ID/);
    assert.match(audit, /unique managed identity tool/);
    assert.match(audit, /forbidden Amy identity tool attachment/);
    assert.match(audit, /identityToolStrictTwoFieldSchemaVerified/);
    assert.match(audit, /endSessionToolParameterlessSchemaVerified/);
    assert.match(audit, /forbidden built-in end_call attachment/);
    assert.match(audit, /expectedToolPairs\s*=\s*\[[\s\S]{0,500}identityToolDefinition\.name/);
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

async function runIdentityToolPreparationMock({ existing }) {
    const originalArgv = process.argv;
    const originalApiKey = process.env.ANAM_API_KEY;
    const originalFetch = globalThis.fetch;
    const originalConsoleLog = console.log;
    const calls = [];
    const logs = [];
    const identityToolId = manifest.identityToolId ?? '22222222-2222-4222-8222-222222222222';
    const knowledgeTool = {
        id: manifest.knowledgeToolId,
        name: manifest.knowledgeToolName,
        type: 'SERVER_RAG',
    };
    const emailTool = {
        id: manifest.emailToolId,
        name: manifest.emailToolName,
        type: 'CLIENT',
    };
    const skipTurnTool = { id: manifest.systemToolIds.skip_turn, name: 'skip_turn', type: 'system' };
    const endSessionTool = { id: manifest.endSessionToolId, ...endSessionToolDefinition };
    let identityTool = existing ? { id: identityToolId, ...identityToolDefinition } : null;
    const targetPersona = {
        id: manifest.personaId,
        name: manifest.expectedName,
        avatarModel: manifest.expectedAvatarModel,
        avatar: { id: manifest.expectedAvatarId },
        voice: { id: manifest.expectedVoiceId },
        brain: { llm: { id: manifest.expectedLlmId }, systemPrompt: prompt },
        tools: [knowledgeTool, skipTurnTool, endSessionTool, emailTool],
    };
    const rollbackPersona = {
        id: manifest.rollbackPersonaId,
        name: 'Dani X Agent Director',
        avatarModel: 'cara-3',
        avatar: { id: '972e0055-4a8a-4ba5-8b77-39bc0dfb6a1c' },
        voice: { id: 'b4f21cc7-97c3-4758-b5c1-19d04259a0a6' },
        brain: {
            llm: { id: '89649f1a-feb2-4fea-be43-56baec997a93' },
            systemPrompt: 'Protected rollback prompt',
        },
        tools: [],
        zeroDataRetention: true,
        enableAudioPassthrough: false,
    };
    const groupId = knowledgeManifest.liveGroupId ?? '33333333-3333-4333-8333-333333333333';
    const group = { id: groupId, name: knowledgeManifest.folderName };
    const json = value => new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });

    globalThis.fetch = async (url, init = {}) => {
        const parsed = new URL(url);
        const method = init.method ?? 'GET';
        calls.push({ method, pathname: parsed.pathname, search: parsed.search, body: init.body });
        if (parsed.pathname === `/v1/personas/${manifest.personaId}` && method === 'GET') {
            return json(structuredClone(targetPersona));
        }
        if (parsed.pathname === `/v1/personas/${manifest.rollbackPersonaId}` && method === 'GET') {
            return json(structuredClone(rollbackPersona));
        }
        if (parsed.pathname === '/v1/knowledge/groups' && method === 'GET') return json({ data: [group] });
        if (
            parsed.pathname === `/v1/knowledge/groups/${groupId}/documents`
            && method === 'GET'
        ) return json({ data: [] });
        if (parsed.pathname === '/v1/tools' && parsed.search === '?perPage=100' && method === 'GET') {
            return json({ data: [knowledgeTool, emailTool, skipTurnTool, endSessionTool, ...(identityTool ? [identityTool] : [])] });
        }
        if (parsed.pathname === '/v1/tools' && method === 'POST') {
            identityTool = { id: identityToolId, ...JSON.parse(init.body) };
            return json(identityTool);
        }
        if (parsed.pathname === `/v1/tools/${identityToolId}` && method === 'PUT') {
            identityTool = { id: identityToolId, ...JSON.parse(init.body) };
            return json(identityTool);
        }
        if (parsed.pathname === `/v1/tools/${identityToolId}` && method === 'GET') {
            return json(identityTool);
        }
        throw new Error(`Unexpected mocked Anam call: ${method} ${parsed.pathname}${parsed.search}`);
    };
    process.argv = [
        process.execPath,
        'scripts/anam/update-dani-persona.mjs',
        '--prepare-identity-tool',
        '--confirm=CONFIRM_DANI_CARA4_SYNC',
    ];
    process.env.ANAM_API_KEY = 'mock-dani-api-key';
    console.log = value => logs.push(String(value));

    try {
        await import(new URL(
            `../scripts/anam/update-dani-persona.mjs?prepare-mock=${existing ? 'update' : 'create'}-${Date.now()}-${Math.random()}`,
            import.meta.url,
        ));
    } finally {
        process.argv = originalArgv;
        if (originalApiKey === undefined) delete process.env.ANAM_API_KEY;
        else process.env.ANAM_API_KEY = originalApiKey;
        globalThis.fetch = originalFetch;
        console.log = originalConsoleLog;
    }

    return { calls, output: JSON.parse(logs.at(-1)), identityToolId };
}

test('identity-tool preparation creates before pinning or updates the pinned tool without mutating Dani persona or manifest', async () => {
    const manifestUrl = new URL('../config/anam/dani/persona-manifest.json', import.meta.url);
    const manifestBefore = await readFile(manifestUrl, 'utf8');

    const scenarios = manifest.identityToolId ? [true] : [false, true];
    for (const existing of scenarios) {
        const result = await runIdentityToolPreparationMock({ existing });
        const mutatingCalls = result.calls.filter(call => call.method !== 'GET');
        assert.equal(mutatingCalls.length, 1);
        assert.equal(mutatingCalls[0].pathname, existing
            ? `/v1/tools/${result.identityToolId}`
            : '/v1/tools');
        assert.equal(mutatingCalls[0].method, existing ? 'PUT' : 'POST');
        assert.equal(result.calls.some(call => (
            call.pathname.startsWith('/v1/personas/') && call.method !== 'GET'
        )), false);
        assert.equal(result.output.mode, 'identity_tool_prepared_manifest_pin_required');
        assert.equal(result.output.identityToolId, result.identityToolId);
        assert.equal(result.output.identityToolCreated, !existing);
        assert.equal(result.output.identityToolDefinitionVerified, true);
        assert.equal(result.output.uniqueIdentityToolVerified, true);
        assert.equal(result.output.personaPromptChanged, false);
        assert.equal(result.output.personaAttachmentsChanged, false);
        assert.equal(result.output.manifestUpdated, false);
        assert.equal(result.output.manualPublishRequired, false);
    }

    assert.equal(await readFile(manifestUrl, 'utf8'), manifestBefore);
});
