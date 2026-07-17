import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const SOURCE_PERSONA_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8';
const CANARY_NAME = 'James Knowles Law Firm - Cara 4';
const CANARY_MODEL = 'cara-4';
const DESCRIPTION_MARKER = `Managed James canary; source persona: ${SOURCE_PERSONA_ID}`;
const INITIAL_MESSAGE = "Hello, I'm James, an AI intake assistant for Knowles Law Firm. I can help organize the basic facts and explain how to reach the firm, but I can't give legal advice. What would you like help with today?";
const VOICE_DETECTION_OPTIONS = {
    endOfSpeechSensitivity: 0.3,
    silenceBeforeAutoEndTurnSeconds: 1.3,
    silenceBeforeSkipTurnSeconds: 0,
    silenceBeforeSessionEndSeconds: 180,
};
const apiKey = process.env.ANAM_API_KEY?.trim();

if (!apiKey) {
    throw new Error('ANAM_API_KEY is required and is never printed.');
}

const prompt = `${(await fs.readFile(new URL('../../config/anam/james-system-prompt.md', import.meta.url), 'utf8')).trim()}\n`;
const manifest = JSON.parse(await fs.readFile(new URL('../../config/anam/james-kb-manifest.json', import.meta.url), 'utf8'));
const documentEntries = await Promise.all(manifest.documents.map(async filename => ({
    filename,
    content: await fs.readFile(new URL(`../../config/anam/james-kb/${filename}`, import.meta.url), 'utf8'),
})));
const bundleSha256 = sha256(JSON.stringify({
    manifest,
    documents: documentEntries.map(document => ({ filename: document.filename, sha256: sha256(document.content) })),
}));
const groupName = `James Knowles Law Firm Knowledge - ${manifest.bundleVersion} - ${bundleSha256.slice(0, 12)}`;

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
    if (!response.ok) {
        const detail = (await response.text()).slice(0, 2_000);
        throw new Error(`Anam ${init.method ?? 'GET'} ${pathname} failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) return null;
    return response.json();
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function listData(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.tools)) return payload.tools;
    if (Array.isArray(payload?.personas)) return payload.personas;
    return [];
}

function idOf(value) {
    return value?._toolId ?? value?.id ?? null;
}

function compactObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
        ? value
        : undefined;
}

async function waitForDocuments(groupId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const documents = listData(await anam(`/knowledge/groups/${groupId}/documents`));
        const expected = new Set(manifest.documents);
        const relevant = documents.filter(document => expected.has(document.filename));
        if (relevant.length === manifest.documents.length && relevant.every(document => document.status === 'READY')) {
            return relevant;
        }
        const failed = relevant.find(document => document.status === 'FAILED');
        if (failed) throw new Error(`Knowledge processing failed for ${failed.filename}.`);
        await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    throw new Error('Timed out waiting for the James knowledge documents to become READY.');
}

const source = await anam(`/personas/${SOURCE_PERSONA_ID}`);
if (!source.avatar?.availableVersions?.includes(CANARY_MODEL)) {
    throw new Error(`James's source avatar does not advertise ${CANARY_MODEL} support.`);
}
if (!source.avatar?.id || !source.voice?.id || !source.llmId) {
    throw new Error('The source James persona is missing its avatar, voice, or LLM. Refusing a partial update.');
}

const groups = listData(await anam('/knowledge/groups'));
let group = groups.find(candidate => candidate.name === groupName);
let groupCreated = false;
if (!group) {
    group = await anam('/knowledge/groups', {
        method: 'POST',
        body: JSON.stringify({
            name: groupName,
            description: `Versioned James legal-intake knowledge. Bundle SHA-256: ${bundleSha256}`,
        }),
    });
    groupCreated = true;
}

let existingDocuments = listData(await anam(`/knowledge/groups/${group.id}/documents`));
for (const document of documentEntries) {
    if (existingDocuments.some(candidate => candidate.filename === document.filename)) continue;
    const form = new FormData();
    form.append('file', new Blob([document.content], { type: 'text/markdown' }), document.filename);
    form.append('chunkSize', '800');
    form.append('chunkOverlap', '120');
    await anam(`/knowledge/groups/${group.id}/documents`, { method: 'POST', body: form });
}
const readyDocuments = await waitForDocuments(group.id);

let tools = listData(await anam('/tools?perPage=100'));
let knowledgeTool = tools.find(candidate => candidate.name === manifest.knowledgeToolName);
const knowledgeToolPayload = {
    name: manifest.knowledgeToolName,
    description: 'Search only the reviewed, versioned Knowles Law Firm facts and James intake-safety guidance. This tool does not submit an intake or create legal representation.',
    type: 'SERVER_RAG',
    config: { documentFolderIds: [group.id] },
};
let knowledgeToolCreated = false;
if (knowledgeTool) {
    knowledgeTool = await anam(`/tools/${idOf(knowledgeTool)}`, {
        method: 'PUT',
        body: JSON.stringify(knowledgeToolPayload),
    });
} else {
    knowledgeTool = await anam('/tools', {
        method: 'POST',
        body: JSON.stringify(knowledgeToolPayload),
    });
    knowledgeToolCreated = true;
}

tools = listData(await anam('/tools?perPage=100'));
const requiredTools = [manifest.knowledgeToolName, 'skip_turn', 'end_call'].map(name => {
    const tool = tools.find(candidate => candidate.name === name);
    if (!idOf(tool)) throw new Error(`Required Anam tool is unavailable: ${name}`);
    return tool;
});
const requiredToolIds = requiredTools.map(idOf).sort();

const personaList = listData(await anam(`/personas?perPage=100&search=${encodeURIComponent(CANARY_NAME)}`));
const existingSummary = personaList.find(candidate => candidate.name === CANARY_NAME);
let canary;
let canaryCreated = false;
const personaPayload = {
    name: CANARY_NAME,
    description: `${DESCRIPTION_MARKER}; prompt ${sha256(prompt)}; knowledge ${bundleSha256}`,
    avatarId: source.avatar.id,
    avatarModel: CANARY_MODEL,
    voiceId: source.voice.id,
    llmId: source.llmId,
    systemPrompt: prompt,
    skipGreeting: false,
    uninterruptibleGreeting: false,
    initialMessage: INITIAL_MESSAGE,
    zeroDataRetention: false,
    languageCode: source.languageCode,
    voiceDetectionOptions: VOICE_DETECTION_OPTIONS,
    toolIds: requiredToolIds,
    ...(compactObject(source.voiceGenerationOptions) ? { voiceGenerationOptions: source.voiceGenerationOptions } : {}),
};

if (existingSummary) {
    const existing = await anam(`/personas/${existingSummary.id}`);
    if (!existing.description?.includes(DESCRIPTION_MARKER)) {
        throw new Error(`A persona named "${CANARY_NAME}" exists but is not owned by this workflow.`);
    }
    canary = await anam(`/personas/${existing.id}`, { method: 'PUT', body: JSON.stringify(personaPayload) });
} else {
    canary = await anam('/personas', { method: 'POST', body: JSON.stringify(personaPayload) });
    canaryCreated = true;
}

if (compactObject(source.widgetConfig)) {
    await anam(`/personas/${canary.id}`, {
        method: 'PUT',
        body: JSON.stringify({ widgetConfig: source.widgetConfig }),
    });
}
canary = await anam(`/personas/${canary.id}`);

const actualToolIds = (canary.tools ?? []).map(idOf).filter(Boolean).sort();
const failures = [];
if (canary.avatarModel !== CANARY_MODEL) failures.push('avatarModel');
if (canary.avatar?.id !== source.avatar.id) failures.push('avatarId');
if (canary.voice?.id !== source.voice.id) failures.push('voiceId');
if (canary.llmId !== source.llmId) failures.push('llmId');
if (sha256(canary.brain?.systemPrompt ?? '') !== sha256(prompt)) failures.push('systemPrompt');
if (canary.initialMessage !== INITIAL_MESSAGE) failures.push('initialMessage');
if (canary.zeroDataRetention !== false) failures.push('zeroDataRetention');
if (JSON.stringify(actualToolIds) !== JSON.stringify(requiredToolIds)) failures.push('tools');
for (const [name, value] of Object.entries(VOICE_DETECTION_OPTIONS)) {
    if (canary.voiceDetectionOptions?.[name] !== value) failures.push(`voiceDetectionOptions.${name}`);
}
if (failures.length > 0) throw new Error(`James canary verification failed: ${failures.join(', ')}`);

console.log(JSON.stringify({
    sourcePersonaId: SOURCE_PERSONA_ID,
    canaryPersonaId: canary.id,
    canaryCreated,
    avatarModel: canary.avatarModel,
    avatarId: canary.avatar.id,
    voiceId: canary.voice.id,
    llmId: canary.llmId,
    zeroDataRetention: canary.zeroDataRetention,
    promptSha256: sha256(prompt),
    knowledgeBundleSha256: bundleSha256,
    knowledgeGroupId: group.id,
    knowledgeGroupCreated: groupCreated,
    knowledgeToolId: idOf(knowledgeTool),
    knowledgeToolCreated,
    knowledgeDocuments: readyDocuments.map(document => ({ filename: document.filename, status: document.status })),
    attachedToolNames: (canary.tools ?? []).map(tool => tool.name).sort(),
}, null, 2));
