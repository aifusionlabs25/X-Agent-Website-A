import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const EVAN_ID = '4b7e933a-ea04-4b84-b418-72c0762545e6';
const JAMES_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8';
const CURRENT_KNOWLEDGE_TOOL_ID = 'ad2e09f5-1360-4f4e-b692-8aaaa55cc976';
const KNOWLEDGE_TOOL_NAME = 'Knowledge_Evan_Mullins_Moving';
const INITIAL_MESSAGE = "Hi, I'm Evan with Mullins Moving. I can help answer questions and get the right move details to the team. What kind of move are you planning?";
const VOICE_DETECTION_OPTIONS = {
    endOfSpeechSensitivity: 0.3,
    silenceBeforeAutoEndTurnSeconds: 1.3,
    silenceBeforeSkipTurnSeconds: 0,
    silenceBeforeSessionEndSeconds: 180,
};
const apply = process.argv.includes('--apply');

const localEnv = await fs.readFile(new URL('../../.env.local', import.meta.url), 'utf8').catch(() => '');
const envMap = Object.fromEntries(localEnv.split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
const apiKey = process.env.ANAM_API_KEY?.trim() || envMap.ANAM_API_KEY?.trim();
if (!apiKey) throw new Error('ANAM_API_KEY is required and is never printed.');

const prompt = `${(await fs.readFile(new URL('../../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8')).trim()}\n`;
const manifest = JSON.parse(await fs.readFile(new URL('../../config/anam/evan/knowledge-manifest.json', import.meta.url), 'utf8'));
const documents = await Promise.all(manifest.documents.map(async filename => ({
    filename,
    content: await fs.readFile(new URL(`../../config/anam/evan/knowledge/${filename}`, import.meta.url), 'utf8'),
})));
const sha256 = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
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
const compactObject = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length ? value : undefined;

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

const [evan, james, groupPayload, toolPayload] = await Promise.all([
    anam(`/personas/${EVAN_ID}`),
    anam(`/personas/${JAMES_ID}`),
    anam('/knowledge/groups'),
    anam('/tools?perPage=100'),
]);
if (!/evan/i.test(evan.name) || !/mullins/i.test(evan.name)) throw new Error(`Refusing update: ${EVAN_ID} is not visibly Evan/Mullins.`);
if (!/james/i.test(james.name) || !/knowles/i.test(james.name)) throw new Error('Refusing update: protected James identity could not be verified.');
if (evan.avatarModel !== 'cara-4') throw new Error('Refusing update: live Evan is not Cara 4.');

const groups = listData(groupPayload);
const group = groups.find(candidate => candidate.name === manifest.folderName);
if (!group?.id) throw new Error(`Knowledge folder is missing: ${manifest.folderName}`);
const existingDocuments = listData(await anam(`/knowledge/groups/${group.id}/documents`));
const missingDocuments = documents.filter(document => !existingDocuments.some(candidate => candidate.filename === document.filename));

const tools = listData(toolPayload);
const skipTurn = tools.find(item => item.name === 'skip_turn');
const endCall = tools.find(item => item.name === 'end_call');
const currentKnowledge = tools.find(item => idOf(item) === CURRENT_KNOWLEDGE_TOOL_ID);
if (!idOf(skipTurn) || !idOf(endCall) || !currentKnowledge) throw new Error('Required Evan knowledge/skip_turn/end_call tools are unavailable.');
const nextToolIds = [CURRENT_KNOWLEDGE_TOOL_ID, idOf(skipTurn), idOf(endCall)].sort();

const plan = {
    mode: apply ? 'apply' : 'dry-run',
    protectedJamesPersonaId: JAMES_ID,
    evanPersonaId: EVAN_ID,
    knowledgeGroupId: group.id,
    existingKnowledgeDocuments: existingDocuments.length,
    missingKnowledgeDocuments: missingDocuments.map(document => document.filename),
    promptSha256: sha256(prompt),
    knowledgeBundleSha256: bundleSha256,
    toolNames: [KNOWLEDGE_TOOL_NAME, 'skip_turn', 'end_call'],
};
if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
}

const rollbackName = `Evan Mullins Moving - rollback ${new Date().toISOString().slice(0, 10)}`;
const personaList = listData(await anam(`/personas?perPage=100&search=${encodeURIComponent(rollbackName)}`));
let rollback = personaList.find(item => item.name === rollbackName);
if (!rollback) {
    rollback = await anam('/personas', {
        method: 'POST',
        body: JSON.stringify({
            name: rollbackName,
            description: `Pre-update rollback copy of ${EVAN_ID}. Do not publish.`,
            avatarId: evan.avatar.id,
            avatarModel: evan.avatarModel,
            voiceId: evan.voice.id,
            llmId: evan.llmId,
            systemPrompt: evan.brain.systemPrompt,
            initialMessage: evan.initialMessage,
            skipGreeting: evan.skipGreeting,
            uninterruptibleGreeting: evan.uninterruptibleGreeting,
            zeroDataRetention: evan.zeroDataRetention,
            languageCode: evan.languageCode,
            toolIds: sortedToolIds(evan),
            ...(compactObject(evan.voiceDetectionOptions) ? { voiceDetectionOptions: evan.voiceDetectionOptions } : {}),
            ...(compactObject(evan.voiceGenerationOptions) ? { voiceGenerationOptions: evan.voiceGenerationOptions } : {}),
        }),
    });
}

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
        name: 'Evan Mullins Moving Concierge',
        systemPrompt: prompt,
        initialMessage: INITIAL_MESSAGE,
        skipGreeting: false,
        uninterruptibleGreeting: false,
        toolIds: nextToolIds,
        voiceDetectionOptions: VOICE_DETECTION_OPTIONS,
    }),
});

async function verifyLive() {
    const [persona, tool] = await Promise.all([anam(`/personas/${EVAN_ID}`), anam(`/tools/${CURRENT_KNOWLEDGE_TOOL_ID}`)]);
    const failures = [];
    if (persona.name !== 'Evan Mullins Moving Concierge') failures.push('name');
    if (persona.avatarModel !== 'cara-4') failures.push('avatarModel');
    if (sha256(persona.brain?.systemPrompt ?? '') !== sha256(prompt)) failures.push('prompt');
    if (persona.initialMessage !== INITIAL_MESSAGE) failures.push('initialMessage');
    if (JSON.stringify(sortedToolIds(persona)) !== JSON.stringify(nextToolIds)) failures.push('tools');
    if (tool.name !== KNOWLEDGE_TOOL_NAME) failures.push('knowledgeToolName');
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
    rollbackPersonaId: rollback.id,
    livePromptSha256: sha256(delayed.persona.brain.systemPrompt),
    liveKnowledgeFolderIds: delayed.tool.config.documentFolderIds,
    liveToolNames: delayed.persona.tools.map(tool => tool.name).sort(),
    knowledgeDocuments: readyDocuments.map(document => ({ filename: document.filename, status: document.status })),
    delayedReadbackPassed: true,
}, null, 2));
