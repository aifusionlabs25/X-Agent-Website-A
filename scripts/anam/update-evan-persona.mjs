import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const EVAN_ID = '6097c73e-b6ef-48c5-94c7-9a95d4863b99';
const JAMES_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8';
const PREVIOUS_EVAN_ID = '4b7e933a-ea04-4b84-b418-72c0762545e6';
const CURRENT_KNOWLEDGE_TOOL_ID = 'fc93e067-9254-4635-a4a6-645970d12548';
const KNOWLEDGE_TOOL_NAME = 'Knowledge_Evan_Mullins_Moving';
const INITIAL_MESSAGE = "Hi, I'm Evan with Mullins Moving. Tell me a little about the move you're planning, and I'll help you work through the details.";
const apply = process.argv.includes('--apply');
const confirmedReplacement = process.argv.includes('--confirm-6097-replacement');
if (apply && !confirmedReplacement) {
    throw new Error('Refusing apply without --confirm-6097-replacement. Dry-run is the default.');
}

const localEnv = await fs.readFile(new URL('../../.env.local', import.meta.url), 'utf8').catch(() => '');
const envMap = Object.fromEntries(localEnv.split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
const apiKey = process.env.ANAM_API_KEY?.trim() || envMap.ANAM_API_KEY?.trim();
if (!apiKey) throw new Error('ANAM_API_KEY is required and is never printed.');

const personaManifest = JSON.parse(await fs.readFile(new URL('../../config/anam/evan/persona-manifest.json', import.meta.url), 'utf8'));
if (personaManifest.personaId !== EVAN_ID || personaManifest.replacesPersonaId !== PREVIOUS_EVAN_ID) {
    throw new Error('Refusing update: Evan replacement manifest identity is inconsistent.');
}
const VOICE_DETECTION_OPTIONS = personaManifest.voiceDetectionOptions;
const emailToolDefinition = JSON.parse(await fs.readFile(
    new URL('../../config/anam/evan-agentmail-client-tool.json', import.meta.url),
    'utf8',
));
const endSessionToolDefinition = JSON.parse(await fs.readFile(
    new URL('../../config/anam/evan-end-session-client-tool.json', import.meta.url),
    'utf8',
));
const movePlannerToolDefinition = JSON.parse(await fs.readFile(
    new URL('../../config/anam/evan-move-planner-client-tool.json', import.meta.url),
    'utf8',
));
const normalizeLineEndings = value => String(value).replace(/\r\n?/g, '\n');
const managedPromptOf = value => `${normalizeLineEndings(value).split('\n# TOOLS\n', 1)[0].trim()}\n`;
const prompt = `${normalizeLineEndings(await fs.readFile(new URL('../../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8')).trim()}\n`;
const manifest = JSON.parse(await fs.readFile(new URL('../../config/anam/evan/knowledge-manifest.json', import.meta.url), 'utf8'));
const documents = await Promise.all(manifest.documents.map(async filename => ({
    filename,
    content: await fs.readFile(new URL(`../../config/anam/evan/knowledge/${filename}`, import.meta.url), 'utf8'),
})));
const sha256 = value => crypto.createHash('sha256').update(normalizeLineEndings(value), 'utf8').digest('hex');
const bundleSha256 = sha256(JSON.stringify({
    manifest,
    documents: documents.map(document => ({ filename: document.filename, sha256: sha256(document.content) })),
}));

async function anam(pathname, init = {}) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(!(init.body instanceof FormData) && init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
        },
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Anam ${init.method ?? 'GET'} ${pathname} failed (${response.status}): ${(await response.text()).slice(0, 1500)}`);
    if (response.status === 204) return null;
    return response.json();
}

function listData(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.tools)) return payload.tools;
    if (Array.isArray(payload?.personas)) return payload.personas;
    return [];
}
const idOf = value => value?._toolId ?? value?.id ?? null;
const sortedToolIds = persona => (persona.tools ?? []).map(idOf).filter(Boolean).sort();

async function waitForDocuments(groupId) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
        const current = listData(await anam(`/knowledge/groups/${groupId}/documents`));
        const expected = new Set(manifest.documents);
        const relevant = current.filter(document => expected.has(document.filename));
        const failed = relevant.find(document => document.status === 'FAILED');
        if (failed) throw new Error(`Knowledge processing failed for ${failed.filename}.`);
        if (relevant.length === manifest.documents.length && relevant.every(document => document.status === 'READY')) return relevant;
        await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    throw new Error('Timed out waiting for Evan knowledge documents to become READY.');
}

const [evan, james, previousEvan, groupPayload, toolPayload] = await Promise.all([
    anam(`/personas/${EVAN_ID}`),
    anam(`/personas/${JAMES_ID}`),
    anam(`/personas/${PREVIOUS_EVAN_ID}`),
    anam('/knowledge/groups'),
    anam('/tools?perPage=100'),
]);
if (evan.id !== EVAN_ID || !/evan/i.test(evan.name)) throw new Error(`Refusing update: ${EVAN_ID} is not visibly the Evan candidate.`);
if (!/james/i.test(james.name) || !/knowles/i.test(james.name)) throw new Error('Refusing update: protected James identity could not be verified.');
if (!/evan/i.test(previousEvan.name) || !/mullins/i.test(previousEvan.name)) throw new Error('Refusing update: protected previous Evan identity could not be verified.');
if (evan.avatarModel !== 'cara-4') throw new Error('Refusing update: live Evan is not Cara 4.');

const groups = listData(groupPayload);
const group = groups.find(candidate => candidate.id === manifest.folderId);
if (!group?.id) throw new Error(`Knowledge folder is missing: ${manifest.folderName}`);
const existingDocuments = listData(await anam(`/knowledge/groups/${group.id}/documents`));
const missingDocuments = documents.filter(document => !existingDocuments.some(candidate => candidate.filename === document.filename));

const tools = listData(toolPayload);
const skipTurn = tools.find(item => idOf(item) === personaManifest.toolIds.skip_turn);
const currentKnowledge = tools.find(item => idOf(item) === CURRENT_KNOWLEDGE_TOOL_ID);
if (!idOf(skipTurn) || !currentKnowledge) throw new Error('Required Evan knowledge and skip_turn tools are unavailable.');
const existingEmailTool = tools.find(item => idOf(item) === personaManifest.toolIds[emailToolDefinition.name]);
if (!existingEmailTool) throw new Error('Pinned Evan replacement email tool is unavailable.');
let emailTool = existingEmailTool;
if (apply) {
    emailTool = await anam('/tools/' + idOf(existingEmailTool), {
        method: 'PUT',
        body: JSON.stringify(emailToolDefinition),
    });
}
const existingEndSessionTool = tools.find(item => idOf(item) === personaManifest.toolIds[endSessionToolDefinition.name]);
if (!existingEndSessionTool) throw new Error('Pinned Evan replacement close tool is unavailable.');
let endSessionTool = existingEndSessionTool;
if (apply) {
    endSessionTool = await anam('/tools/' + idOf(existingEndSessionTool), {
        method: 'PUT',
        body: JSON.stringify(endSessionToolDefinition),
    });
}
const existingMovePlannerTool = tools.find(item => idOf(item) === personaManifest.toolIds[movePlannerToolDefinition.name]);
if (!existingMovePlannerTool) throw new Error('Pinned Evan replacement Move Planner tool is unavailable.');
let movePlannerTool = existingMovePlannerTool;
if (apply) {
    movePlannerTool = await anam('/tools/' + idOf(existingMovePlannerTool), {
        method: 'PUT',
        body: JSON.stringify(movePlannerToolDefinition),
    });
}
const emailToolId = idOf(emailTool);
const endSessionToolId = idOf(endSessionTool);
const movePlannerToolId = idOf(movePlannerTool);
if (apply && !emailToolId) throw new Error('Evan AgentMail client tool could not be created.');
if (apply && !endSessionToolId) throw new Error('Evan direct-close client tool could not be created.');
if (apply && !movePlannerToolId) throw new Error('Evan Move Planner client tool could not be created.');
const nextToolIds = [CURRENT_KNOWLEDGE_TOOL_ID, idOf(skipTurn), ...(emailToolId ? [emailToolId] : []), ...(endSessionToolId ? [endSessionToolId] : []), ...(movePlannerToolId ? [movePlannerToolId] : [])].sort();

const plan = {
    mode: apply ? 'apply' : 'dry-run',
    protectedJamesPersonaId: JAMES_ID,
    protectedPreviousEvanPersonaId: PREVIOUS_EVAN_ID,
    evanPersonaId: EVAN_ID,
    knowledgeGroupId: group.id,
    existingKnowledgeDocuments: existingDocuments.length,
    missingKnowledgeDocuments: missingDocuments.map(document => document.filename),
    promptSha256: sha256(prompt),
    knowledgeBundleSha256: bundleSha256,
    toolNames: [KNOWLEDGE_TOOL_NAME, 'skip_turn', emailToolDefinition.name, endSessionToolDefinition.name, movePlannerToolDefinition.name],
    emailToolWillBeCreated: !emailToolId,
    endSessionToolWillBeCreated: !endSessionToolId,
    movePlannerToolWillBeCreated: !movePlannerToolId,
    voiceDetectionOptions: VOICE_DETECTION_OPTIONS,
};
if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
}

const rollbackDir = new URL('../../work/evan-6097-promotion/', import.meta.url);
await fs.mkdir(rollbackDir, { recursive: true });
await fs.writeFile(
    new URL(`anam-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, rollbackDir),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), persona: evan, tools: evan.tools }, null, 2)}\n`,
    'utf8',
);

await anam(`/knowledge/groups/${group.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: manifest.folderName, description: `Curated public-fact Evan KB. Bundle SHA-256: ${bundleSha256}` }),
});
for (const document of missingDocuments) {
    const form = new FormData();
    form.append('file', new Blob([document.content], { type: 'text/markdown' }), document.filename);
    form.append('chunkSize', '800');
    form.append('chunkOverlap', '120');
    await anam(`/knowledge/groups/${group.id}/documents`, { method: 'POST', body: form });
}
const readyDocuments = await waitForDocuments(group.id);

await anam(`/tools/${CURRENT_KNOWLEDGE_TOOL_ID}`, {
    method: 'PUT',
    body: JSON.stringify({
        name: KNOWLEDGE_TOOL_NAME,
        description: 'Search only the curated, current public Mullins Moving facts. This tool does not book, send, submit, save, or complete a human handoff.',
        type: 'SERVER_RAG',
        config: { documentFolderIds: [group.id] },
        disableInterruptions: false,
    }),
});
await anam(`/personas/${EVAN_ID}`, {
    method: 'PUT',
    body: JSON.stringify({
        name: personaManifest.expectedName,
        systemPrompt: prompt,
        initialMessage: INITIAL_MESSAGE,
        skipGreeting: false,
        uninterruptibleGreeting: false,
        toolIds: nextToolIds,
        voiceDetectionOptions: VOICE_DETECTION_OPTIONS,
        zeroDataRetention: false,
        enableAudioPassthrough: false,
    }),
});

async function verifyLive() {
    const [persona, tool] = await Promise.all([anam(`/personas/${EVAN_ID}`), anam(`/tools/${CURRENT_KNOWLEDGE_TOOL_ID}`)]);
    const failures = [];
    if (persona.name !== personaManifest.expectedName) failures.push('name');
    if (persona.avatarModel !== 'cara-4') failures.push('avatarModel');
    if (sha256(managedPromptOf(persona.brain?.systemPrompt ?? '')) !== sha256(prompt)) failures.push('prompt');
    if (persona.initialMessage !== INITIAL_MESSAGE) failures.push('initialMessage');
    if (JSON.stringify(sortedToolIds(persona)) !== JSON.stringify(nextToolIds)) failures.push('tools');
    if (tool.name !== KNOWLEDGE_TOOL_NAME) failures.push('knowledgeToolName');
    if (persona.zeroDataRetention !== false) failures.push('zeroDataRetention');
    if (persona.enableAudioPassthrough !== false) failures.push('enableAudioPassthrough');
    if (JSON.stringify(tool.config?.documentFolderIds ?? []) !== JSON.stringify([group.id])) failures.push('knowledgeFolder');
    for (const [name, value] of Object.entries(VOICE_DETECTION_OPTIONS)) if (persona.voiceDetectionOptions?.[name] !== value) failures.push(`voiceDetectionOptions.${name}`);
    if (failures.length) throw new Error(`Evan live verification failed: ${failures.join(', ')}`);
    return { persona, tool };
}

await verifyLive();
await new Promise(resolve => setTimeout(resolve, 5_000));
const delayed = await verifyLive();
console.log(JSON.stringify({
    ...plan,
    rollbackPersonaCreated: false,
    livePromptSha256: sha256(delayed.persona.brain.systemPrompt),
    liveKnowledgeFolderIds: delayed.tool.config.documentFolderIds,
    liveToolNames: delayed.persona.tools.map(tool => tool.name).sort(),
    liveVoiceDetectionOptions: delayed.persona.voiceDetectionOptions,
    knowledgeDocuments: readyDocuments.map(document => ({ filename: document.filename, status: document.status })),
    delayedReadbackPassed: true,
}, null, 2));

