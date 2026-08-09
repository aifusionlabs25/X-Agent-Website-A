import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.anam.ai/v1';
const APPLY_CONFIRMATION = 'CONFIRM_DANI_CARA4_SYNC';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PINNED_TARGET_IDENTITY = Object.freeze({
    id: '120cf627-59a6-4a35-8e70-97959a89a4da',
    name: 'Dani AI Solutions Director',
    avatarId: '58b045b9-ac1d-4ddf-af14-18972618c57b',
    avatarModel: 'cara-4',
    voiceId: '90a1acd3-4fc0-11f1-84b0-52bacf74fa75',
    llmId: 'a7cf662c-2ace-4de1-a21e-ef0fbf144bb7',
});
const PROTECTED_ROLLBACK_IDENTITY = Object.freeze({
    id: '61f0fd3e-7937-472a-958d-cdba76b33bf1',
    name: 'Dani X Agent Director',
    avatarId: '972e0055-4a8a-4ba5-8b77-39bc0dfb6a1c',
    avatarModel: 'cara-3',
    voiceId: 'b4f21cc7-97c3-4758-b5c1-19d04259a0a6',
    llmId: '89649f1a-feb2-4fea-be43-56baec997a93',
});
const KNOWLEDGE_TOOL_DESCRIPTION = 'Search only the curated public-safe AI Fusion Labs, AI solution-design, X Agents, meeting, and follow-up knowledge approved for Dani. This tool retrieves information only; it does not send, submit, book, save, or complete a handoff.';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const confirmation = args.find(value => value.startsWith('--confirm='))?.slice('--confirm='.length) ?? '';
const backupArgument = args.find(value => value.startsWith('--backup-dir='))?.slice('--backup-dir='.length) ?? '';
const repositoryRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const normalizeLineEndings = value => String(value).replace(/\r\n?/g, '\n');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizedSha256 = value => sha256(Buffer.from(normalizeLineEndings(value), 'utf8'));
const DANI_PROMPT_END_MARKER = '<!-- DANI_POST_CALL_EMAIL_END -->';
const managedPromptOf = value => {
    const normalized = normalizeLineEndings(value);
    const markerAt = normalized.lastIndexOf(DANI_PROMPT_END_MARKER);
    const managed = markerAt >= 0
        ? normalized.slice(0, markerAt + DANI_PROMPT_END_MARKER.length)
        : normalized.split('\n# TOOLS\n', 1)[0];
    return `${managed.trim()}\n`;
};
const idOf = value => value?._toolId ?? value?.id ?? null;
const documentIdOf = value => value?._documentId ?? value?.documentId ?? value?.id ?? null;
const avatarIdOf = persona => persona?.avatar?.id ?? persona?.avatarId ?? null;
const voiceIdOf = persona => persona?.voice?.id ?? persona?.voice?.voiceId ?? persona?.voiceId ?? null;
const llmIdOf = persona => persona?.brain?.llm?.id ?? persona?.brain?.llmId ?? persona?.llm?.id ?? persona?.llmId ?? null;
const listData = payload => {
    if (Array.isArray(payload)) return payload;
    for (const key of ['data', 'items', 'tools', 'personas', 'groups', 'documents']) {
        if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
};
const sortedToolIds = persona => (persona?.tools ?? []).map(idOf).filter(Boolean).sort();
const sortedToolNames = persona => (persona?.tools ?? []).map(tool => tool?.name).filter(Boolean).sort();
const sortJson = value => {
    if (Array.isArray(value)) return value.map(sortJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, sortJson(value[key])]),
    );
};
const sameJson = (left, right) => JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
const emailToolManagedView = tool => ({
    name: tool?.name ?? null,
    description: tool?.description ?? null,
    type: tool?.type ?? null,
    disableInterruptions: tool?.disableInterruptions ?? null,
    config: tool?.config ?? null,
});
const providerIdentityView = persona => ({
    id: persona?.id ?? null,
    name: persona?.name ?? null,
    avatarId: avatarIdOf(persona),
    avatarModel: persona?.avatarModel ?? null,
    voiceId: voiceIdOf(persona),
    llmId: llmIdOf(persona),
});
const protectedRollbackState = persona => ({
    ...providerIdentityView(persona),
    promptSha256: normalizedSha256(managedPromptOf(persona?.brain?.systemPrompt ?? '')),
    zeroDataRetention: persona?.zeroDataRetention ?? null,
    enableAudioPassthrough: persona?.enableAudioPassthrough ?? null,
    toolIds: sortedToolIds(persona),
    toolNames: sortedToolNames(persona),
});

function assertUuid(label, value, { optional = false } = {}) {
    if (optional && (value === null || value === undefined)) return;
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        throw new Error(`Refusing update: ${label} is not a pinned UUID.`);
    }
}

function assertExactToolAttachments(persona, expectedPairs, label = 'Dani persona') {
    const attached = Array.isArray(persona?.tools) ? persona.tools : [];
    const actualPairs = attached.map(tool => ({ name: tool?.name ?? null, id: idOf(tool) }));
    const expectedNames = expectedPairs.map(pair => pair.name);
    const expectedIds = expectedPairs.map(pair => pair.id);
    if (
        attached.length !== expectedPairs.length
        || actualPairs.some(pair => typeof pair.name !== 'string' || !pair.id)
        || new Set(actualPairs.map(pair => pair.name)).size !== actualPairs.length
        || new Set(actualPairs.map(pair => pair.id)).size !== actualPairs.length
        || new Set(expectedNames).size !== expectedNames.length
        || new Set(expectedIds).size !== expectedIds.length
        || !sameJson(
            actualPairs.sort((a, b) => a.name.localeCompare(b.name)),
            [...expectedPairs].sort((a, b) => a.name.localeCompare(b.name)),
        )
    ) {
        throw new Error(`${label} does not have the exact pinned tool name/ID set.`);
    }
}

const localEnv = await fs.readFile(new URL('../../.env.local', import.meta.url), 'utf8').catch(() => '');
const env = Object.fromEntries(
    localEnv
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
            const at = line.indexOf('=');
            return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
        }),
);
const apiKey = process.env.ANAM_API_KEY?.trim() || env.ANAM_API_KEY?.trim();
if (!apiKey) throw new Error('ANAM_API_KEY is required and is never printed.');

const configRootUrl = new URL('../../config/anam/dani/', import.meta.url);
const personaManifest = JSON.parse(await fs.readFile(
    new URL('persona-manifest.json', configRootUrl),
    'utf8',
));
const knowledgeManifestUrl = new URL(personaManifest.knowledgeManifestFile, configRootUrl);
const knowledgeManifest = JSON.parse(await fs.readFile(knowledgeManifestUrl, 'utf8'));
const emailToolDefinition = JSON.parse(await fs.readFile(
    new URL(personaManifest.emailToolDefinitionFile, configRootUrl),
    'utf8',
));
const prompt = `${normalizeLineEndings(await fs.readFile(
    new URL(personaManifest.promptFile, configRootUrl),
    'utf8',
)).trim()}\n`;
const documents = await Promise.all(knowledgeManifest.documents.map(async filename => {
    const content = await fs.readFile(
        new URL(`knowledge/${filename}`, knowledgeManifestUrl),
        'utf8',
    );
    return {
        filename,
        content,
        bytes: Buffer.byteLength(content, 'utf8'),
        sha256: sha256(Buffer.from(content, 'utf8')),
    };
}));
const bundleSha256 = normalizedSha256(JSON.stringify(
    documents.map(({ filename, bytes, sha256: documentSha256 }) => ({
        filename,
        bytes,
        sha256: documentSha256,
    })),
));

for (const [label, value] of Object.entries({
    'target persona ID': personaManifest.personaId,
    'rollback persona ID': personaManifest.rollbackPersonaId,
    'target avatar ID': personaManifest.expectedAvatarId,
    'target voice ID': personaManifest.expectedVoiceId,
    'target LLM ID': personaManifest.expectedLlmId,
    'skip_turn tool ID': personaManifest.systemToolIds?.skip_turn,
    'end_call tool ID': personaManifest.systemToolIds?.end_call,
})) {
    assertUuid(label, value);
}
assertUuid('managed knowledge tool ID', personaManifest.knowledgeToolId, { optional: true });
assertUuid('managed email tool ID', personaManifest.emailToolId, { optional: true });
assertUuid('managed knowledge group ID', knowledgeManifest.liveGroupId, { optional: true });
if (personaManifest.personaId === personaManifest.rollbackPersonaId) {
    throw new Error('Refusing update: target and rollback persona IDs must be different.');
}
if (!sameJson({
    id: personaManifest.personaId,
    name: personaManifest.expectedName,
    avatarId: personaManifest.expectedAvatarId,
    avatarModel: personaManifest.expectedAvatarModel,
    voiceId: personaManifest.expectedVoiceId,
    llmId: personaManifest.expectedLlmId,
}, PINNED_TARGET_IDENTITY)) {
    throw new Error('Refusing update: target Dani identity does not match the code-pinned persona/avatar/voice/LLM identity.');
}
if (personaManifest.rollbackPersonaId !== PROTECTED_ROLLBACK_IDENTITY.id) {
    throw new Error('Refusing update: rollback persona ID does not match the code-pinned identity.');
}
if (typeof personaManifest.expectedName !== 'string' || !/^Dani\b/.test(personaManifest.expectedName)) {
    throw new Error('Refusing update: expected Dani name is invalid.');
}
if (personaManifest.knowledgeToolName !== knowledgeManifest.toolName) {
    throw new Error('Refusing update: knowledge tool names differ between manifests.');
}
if (personaManifest.emailToolName !== emailToolDefinition.name) {
    throw new Error('Refusing update: email tool name differs from its managed definition.');
}
const expectedRequiredToolNames = [
    personaManifest.knowledgeToolName,
    'skip_turn',
    'end_call',
    emailToolDefinition.name,
].sort();
if (
    !Array.isArray(personaManifest.requiredToolNames)
    || new Set(personaManifest.requiredToolNames).size !== personaManifest.requiredToolNames.length
    || !sameJson([...personaManifest.requiredToolNames].sort(), expectedRequiredToolNames)
) {
    throw new Error('Refusing update: required tool names are not the exact managed set.');
}
const emailParameters = emailToolDefinition.config?.parameters;
if (
    emailToolDefinition.type !== 'CLIENT'
    || emailToolDefinition.disableInterruptions !== true
    || typeof emailToolDefinition.description !== 'string'
    || !emailToolDefinition.description.trim()
    || emailToolDefinition.config?.awaitResult !== true
    || !Number.isFinite(emailToolDefinition.config?.toolTimeoutSeconds)
    || emailToolDefinition.config.toolTimeoutSeconds <= 0
    || emailParameters?.type !== 'object'
    || !sameJson(Object.keys(emailParameters.properties ?? {}).sort(), ['userConfirmed'])
    || emailParameters.properties?.userConfirmed?.type !== 'boolean'
    || typeof emailParameters.properties.userConfirmed.description !== 'string'
    || !emailParameters.properties.userConfirmed.description.trim()
    || !sameJson(emailParameters.required, ['userConfirmed'])
    || emailParameters.additionalProperties !== false
) {
    throw new Error('Refusing update: managed Dani email client-tool definition is incomplete or unsafe.');
}

if (normalizedSha256(prompt) !== personaManifest.promptSha256) {
    throw new Error('Local Dani prompt hash does not match persona-manifest.json.');
}
if (bundleSha256 !== knowledgeManifest.bundleSha256) {
    throw new Error('Local Dani knowledge bundle hash does not match knowledge-manifest.json.');
}
for (const document of documents) {
    const expected = knowledgeManifest.documentFingerprints?.[document.filename];
    if (!expected || expected.bytes !== document.bytes || expected.sha256 !== document.sha256) {
        throw new Error(`Local Dani knowledge fingerprint mismatch: ${document.filename}`);
    }
}

async function anam(pathname, init = {}) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(!(init.body instanceof FormData) && init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(`Anam ${init.method ?? 'GET'} ${pathname} failed (${response.status}): ${(await response.text()).slice(0, 1200)}`);
    }
    if (response.status === 204) return null;
    return response.json();
}

async function downloadDocument(document) {
    const documentId = documentIdOf(document);
    if (!documentId) throw new Error(`Dani knowledge document has no ID: ${document.filename ?? 'unknown'}`);
    const response = await fetch(`${API_BASE}/knowledge/documents/${encodeURIComponent(documentId)}/download`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Anam document download failed (${response.status}) for ${document.filename}.`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return Buffer.from(await response.arrayBuffer());
    const payload = await response.json();
    const downloadUrl = payload?.downloadUrl ?? payload?.url ?? payload?.signedUrl;
    if (typeof downloadUrl !== 'string' || !/^https:\/\//i.test(downloadUrl)) {
        throw new Error(`Anam document download response was invalid for ${document.filename}.`);
    }
    const download = await fetch(downloadUrl, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    if (!download.ok) throw new Error(`Anam signed document download failed (${download.status}) for ${document.filename}.`);
    return Buffer.from(await download.arrayBuffer());
}

async function verifyDocumentBytes(documentList) {
    const expectedNames = new Set(knowledgeManifest.documents);
    const relevant = documentList.filter(document => expectedNames.has(document.filename));
    const unexpected = documentList.filter(document => !expectedNames.has(document.filename));
    if (unexpected.length) {
        throw new Error(`Dani knowledge folder contains unexpected documents: ${unexpected.map(document => document.filename ?? 'unknown').join(', ')}`);
    }
    if (relevant.length !== documents.length) {
        throw new Error(`Dani knowledge document count mismatch: expected ${documents.length}, found ${relevant.length}.`);
    }
    if (new Set(relevant.map(document => document.filename)).size !== relevant.length) {
        throw new Error('Dani knowledge folder contains duplicate managed filenames.');
    }
    for (const remote of relevant) {
        if (remote.status !== 'READY') throw new Error(`Dani knowledge document is not READY: ${remote.filename}`);
        const local = documents.find(document => document.filename === remote.filename);
        const bytes = await downloadDocument(remote);
        if (bytes.length !== local.bytes || sha256(bytes) !== local.sha256) {
            throw new Error(`Dani live knowledge content mismatch: ${remote.filename}`);
        }
    }
    return relevant;
}

async function waitForDocuments(groupId) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
        const current = listData(await anam(`/knowledge/groups/${encodeURIComponent(groupId)}/documents`));
        const expectedNames = new Set(knowledgeManifest.documents);
        const relevant = current.filter(document => expectedNames.has(document.filename));
        const failed = relevant.find(document => document.status === 'FAILED');
        if (failed) throw new Error(`Knowledge processing failed for ${failed.filename}.`);
        if (relevant.length === documents.length && relevant.every(document => document.status === 'READY')) {
            return verifyDocumentBytes(current);
        }
        await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    throw new Error('Timed out waiting for Dani knowledge documents to become READY.');
}

function assertPinnedProviderIdentity(persona, rollbackPersona) {
    const allowedTargetNames = new Set([
        'Dani X Agent Director',
        personaManifest.expectedName,
    ]);
    if (persona?.id !== personaManifest.personaId || !allowedTargetNames.has(persona?.name)) {
        throw new Error('Refusing update: target persona is not the pinned Dani identity.');
    }
    if (persona.avatarModel !== personaManifest.expectedAvatarModel) {
        throw new Error('Refusing update: target Dani persona is not Cara 4.');
    }
    if (avatarIdOf(persona) !== personaManifest.expectedAvatarId) {
        throw new Error('Refusing update: target Dani avatar asset does not match the manifest.');
    }
    if (voiceIdOf(persona) !== personaManifest.expectedVoiceId) {
        throw new Error('Refusing update: target Dani voice does not match the manifest.');
    }
    if (llmIdOf(persona) !== personaManifest.expectedLlmId) {
        throw new Error('Refusing update: target Dani LLM does not match the manifest.');
    }
    if (!sameJson(providerIdentityView(rollbackPersona), PROTECTED_ROLLBACK_IDENTITY)) {
        throw new Error('Refusing update: protected rollback Dani identity could not be verified.');
    }
}

const [targetPersona, rollbackPersona, groupPayload, toolPayload] = await Promise.all([
    anam(`/personas/${personaManifest.personaId}`),
    anam(`/personas/${personaManifest.rollbackPersonaId}`),
    anam('/knowledge/groups'),
    anam('/tools?perPage=100'),
]);
assertPinnedProviderIdentity(targetPersona, rollbackPersona);
const protectedRollbackBeforeApply = protectedRollbackState(rollbackPersona);

const groups = listData(groupPayload);
const matchingGroups = groups.filter(candidate => candidate.name === knowledgeManifest.folderName);
if (matchingGroups.length > 1) throw new Error('Multiple Dani managed knowledge groups have the same name.');
let group = matchingGroups[0] ?? null;
if (knowledgeManifest.liveGroupId && group?.id !== knowledgeManifest.liveGroupId) {
    throw new Error('Pinned Dani knowledge group is unavailable or changed.');
}
let existingDocuments = group?.id
    ? listData(await anam(`/knowledge/groups/${encodeURIComponent(group.id)}/documents`))
    : [];
const duplicateExistingNames = knowledgeManifest.documents.filter(filename => (
    existingDocuments.filter(document => document.filename === filename).length > 1
));
if (duplicateExistingNames.length) {
    throw new Error(`Duplicate Dani knowledge documents detected: ${duplicateExistingNames.join(', ')}`);
}
const missingDocuments = documents.filter(document => (
    !existingDocuments.some(candidate => candidate.filename === document.filename)
));

const tools = listData(toolPayload);
const matchingKnowledgeTools = tools.filter(tool => tool.name === personaManifest.knowledgeToolName);
if (matchingKnowledgeTools.length > 1) throw new Error('Multiple Dani managed knowledge tools have the same name.');
let knowledgeTool = matchingKnowledgeTools[0] ?? null;
if (personaManifest.knowledgeToolId && idOf(knowledgeTool) !== personaManifest.knowledgeToolId) {
    throw new Error('Pinned Dani knowledge tool is unavailable or changed.');
}
const matchingEmailTools = tools.filter(tool => tool.name === emailToolDefinition.name);
if (matchingEmailTools.length > 1) throw new Error('Multiple Dani managed email tools have the same name.');
let emailTool = matchingEmailTools[0] ?? null;
if (personaManifest.emailToolId && idOf(emailTool) !== personaManifest.emailToolId) {
    throw new Error('Pinned Dani email tool is unavailable or changed.');
}
const matchingSkipTurnTools = tools.filter(tool => tool.name === 'skip_turn');
const matchingEndCallTools = tools.filter(tool => tool.name === 'end_call');
const skipTurn = matchingSkipTurnTools[0] ?? null;
const endCall = matchingEndCallTools[0] ?? null;
if (
    matchingSkipTurnTools.length !== 1
    || idOf(skipTurn) !== personaManifest.systemToolIds.skip_turn
    || String(skipTurn?.type ?? '').toLowerCase() !== 'system'
) {
    throw new Error('Pinned Anam skip_turn tool is unavailable or changed.');
}
if (
    matchingEndCallTools.length !== 1
    || idOf(endCall) !== personaManifest.systemToolIds.end_call
    || String(endCall?.type ?? '').toLowerCase() !== 'system'
) {
    throw new Error('Pinned Anam end_call tool is unavailable or changed.');
}

const plan = {
    mode: apply ? 'apply' : 'dry-run',
    targetPersonaId: personaManifest.personaId,
    protectedRollbackPersonaId: personaManifest.rollbackPersonaId,
    pinnedAvatarId: personaManifest.expectedAvatarId,
    pinnedVoiceId: personaManifest.expectedVoiceId,
    pinnedLlmId: personaManifest.expectedLlmId,
    promptSha256: personaManifest.promptSha256,
    knowledgeBundleSha256: knowledgeManifest.bundleSha256,
    knowledgeGroupId: group?.id ?? null,
    knowledgeGroupWillBeCreated: !group?.id,
    knowledgeToolId: idOf(knowledgeTool),
    knowledgeToolWillBeCreated: !idOf(knowledgeTool),
    emailToolId: idOf(emailTool),
    emailToolWillBeCreated: !idOf(emailTool),
    existingAttachedTools: (targetPersona.tools ?? []).map(tool => ({
        name: tool?.name ?? null,
        id: idOf(tool),
    })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    toolIdsReplaceAllExistingAssociations: true,
    missingKnowledgeDocuments: missingDocuments.map(document => document.filename),
    requiredToolNames: personaManifest.requiredToolNames,
    voiceDetectionOptions: personaManifest.voiceDetectionOptions,
};

if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
}
if (confirmation !== APPLY_CONFIRMATION) {
    throw new Error(`--apply requires --confirm=${APPLY_CONFIRMATION}.`);
}
if (!backupArgument || !path.isAbsolute(backupArgument)) {
    throw new Error('--apply requires an absolute --backup-dir outside the repository.');
}
const backupRoot = path.resolve(backupArgument);
const relativeBackupPath = path.relative(repositoryRoot, backupRoot);
const backupIsOutsideRepository = path.isAbsolute(relativeBackupPath)
    || relativeBackupPath === '..'
    || relativeBackupPath.startsWith(`..${path.sep}`);
if (!relativeBackupPath || !backupIsOutsideRepository) {
    throw new Error('The Dani Anam backup directory must be outside the repository.');
}
await fs.mkdir(backupRoot, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupRoot, `dani-cara4-pre-sync-${timestamp}.json`);
await fs.writeFile(backupPath, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    targetPersona,
    protectedRollbackPersona: rollbackPersona,
    existingManagedKnowledgeGroup: group,
    existingManagedKnowledgeDocuments: existingDocuments,
    existingManagedKnowledgeTool: knowledgeTool,
    existingManagedEmailTool: emailTool,
}, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

if (!group?.id) {
    group = await anam('/knowledge/groups', {
        method: 'POST',
        body: JSON.stringify({
            name: knowledgeManifest.folderName,
            description: `Reviewed public-safe Dani KB. Bundle SHA-256: ${knowledgeManifest.bundleSha256}`,
        }),
    });
}
if (!group?.id) throw new Error('Dani managed knowledge group could not be created.');
await anam(`/knowledge/groups/${encodeURIComponent(group.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
        name: knowledgeManifest.folderName,
        description: `Reviewed public-safe Dani KB. Bundle SHA-256: ${knowledgeManifest.bundleSha256}`,
    }),
});

existingDocuments = listData(await anam(`/knowledge/groups/${encodeURIComponent(group.id)}/documents`));
for (const document of documents) {
    if (existingDocuments.some(candidate => candidate.filename === document.filename)) continue;
    const form = new FormData();
    form.append('file', new Blob([document.content], { type: 'text/markdown' }), document.filename);
    form.append('chunkSize', '800');
    form.append('chunkOverlap', '120');
    await anam(`/knowledge/groups/${encodeURIComponent(group.id)}/documents`, {
        method: 'POST',
        body: form,
    });
}
const readyDocuments = await waitForDocuments(group.id);

const knowledgeToolDefinition = {
    name: personaManifest.knowledgeToolName,
    description: KNOWLEDGE_TOOL_DESCRIPTION,
    type: 'SERVER_RAG',
    disableInterruptions: false,
    config: { documentFolderIds: [group.id] },
};
knowledgeTool = idOf(knowledgeTool)
    ? await anam(`/tools/${idOf(knowledgeTool)}`, {
        method: 'PUT',
        body: JSON.stringify(knowledgeToolDefinition),
    })
    : await anam('/tools', {
        method: 'POST',
        body: JSON.stringify(knowledgeToolDefinition),
    });
const knowledgeToolId = idOf(knowledgeTool);
if (!knowledgeToolId) throw new Error('Dani managed knowledge tool could not be created.');

emailTool = idOf(emailTool)
    ? await anam(`/tools/${idOf(emailTool)}`, {
        method: 'PUT',
        body: JSON.stringify(emailToolDefinition),
    })
    : await anam('/tools', {
        method: 'POST',
        body: JSON.stringify(emailToolDefinition),
    });
const emailToolId = idOf(emailTool);
if (!emailToolId) throw new Error('Dani managed email tool could not be created.');

const expectedToolPairs = [
    { name: personaManifest.knowledgeToolName, id: knowledgeToolId },
    { name: 'skip_turn', id: personaManifest.systemToolIds.skip_turn },
    { name: 'end_call', id: personaManifest.systemToolIds.end_call },
    { name: emailToolDefinition.name, id: emailToolId },
];
if (
    new Set(expectedToolPairs.map(tool => tool.name)).size !== expectedToolPairs.length
    || new Set(expectedToolPairs.map(tool => tool.id)).size !== expectedToolPairs.length
) {
    throw new Error('Refusing update: managed Dani tool names or IDs are not unique.');
}
const nextToolIds = expectedToolPairs.map(tool => tool.id).sort();
const managedPersonaDescription = `Managed Cara 4 Dani for x-agent-website-a. Protected rollback persona: ${personaManifest.rollbackPersonaId}`;
await anam(`/personas/${personaManifest.personaId}`, {
    method: 'PUT',
    body: JSON.stringify({
        name: personaManifest.expectedName,
        description: managedPersonaDescription,
        systemPrompt: prompt,
        initialMessage: personaManifest.initialMessage,
        skipGreeting: false,
        uninterruptibleGreeting: false,
        languageCode: personaManifest.expectedLanguageCode,
        toolIds: nextToolIds,
        voiceDetectionOptions: personaManifest.voiceDetectionOptions,
        zeroDataRetention: personaManifest.zeroDataRetention,
        enableAudioPassthrough: personaManifest.enableAudioPassthrough,
    }),
});

async function verifyProviderReadback() {
    const [
        persona,
        verifiedRollbackPersona,
        tool,
        verifiedEmailTool,
        verifiedGroup,
        remoteDocuments,
        verifiedToolPayload,
        verifiedGroupPayload,
    ] = await Promise.all([
        anam(`/personas/${personaManifest.personaId}`),
        anam(`/personas/${personaManifest.rollbackPersonaId}`),
        anam(`/tools/${knowledgeToolId}`),
        anam(`/tools/${emailToolId}`),
        anam(`/knowledge/groups/${encodeURIComponent(group.id)}`),
        anam(`/knowledge/groups/${encodeURIComponent(group.id)}/documents`),
        anam('/tools?perPage=100'),
        anam('/knowledge/groups'),
    ]);
    const failures = [];
    const verifiedTools = listData(verifiedToolPayload);
    const verifiedGroups = listData(verifiedGroupPayload);
    const namedKnowledgeTools = verifiedTools.filter(candidate => candidate.name === personaManifest.knowledgeToolName);
    const namedEmailTools = verifiedTools.filter(candidate => candidate.name === emailToolDefinition.name);
    const namedSkipTurnTools = verifiedTools.filter(candidate => candidate.name === 'skip_turn');
    const namedEndCallTools = verifiedTools.filter(candidate => candidate.name === 'end_call');
    const namedKnowledgeGroups = verifiedGroups.filter(candidate => candidate.name === knowledgeManifest.folderName);
    if (persona.id !== personaManifest.personaId) failures.push('personaId');
    if (persona.name !== personaManifest.expectedName) failures.push('name');
    if (persona.description !== managedPersonaDescription) failures.push('description');
    if (avatarIdOf(persona) !== personaManifest.expectedAvatarId) failures.push('avatarId');
    if (persona.avatarModel !== personaManifest.expectedAvatarModel) failures.push('avatarModel');
    if (voiceIdOf(persona) !== personaManifest.expectedVoiceId) failures.push('voiceId');
    if (llmIdOf(persona) !== personaManifest.expectedLlmId) failures.push('llmId');
    if (normalizedSha256(managedPromptOf(persona.brain?.systemPrompt ?? '')) !== personaManifest.promptSha256) failures.push('prompt');
    if (persona.initialMessage !== personaManifest.initialMessage) failures.push('initialMessage');
    if (persona.skipGreeting !== false) failures.push('skipGreeting');
    if (persona.uninterruptibleGreeting !== false) failures.push('uninterruptibleGreeting');
    if (persona.languageCode !== personaManifest.expectedLanguageCode) failures.push('languageCode');
    if (persona.zeroDataRetention !== personaManifest.zeroDataRetention) failures.push('zeroDataRetention');
    if (persona.enableAudioPassthrough !== personaManifest.enableAudioPassthrough) failures.push('enableAudioPassthrough');
    try {
        assertExactToolAttachments(persona, expectedToolPairs);
    } catch {
        failures.push('exact tool name/ID attachments');
    }
    if (idOf(tool) !== knowledgeToolId) failures.push('knowledgeToolId');
    if (namedKnowledgeTools.length !== 1 || idOf(namedKnowledgeTools[0]) !== knowledgeToolId) failures.push('uniqueKnowledgeTool');
    if (tool.name !== personaManifest.knowledgeToolName) failures.push('knowledgeToolName');
    if (tool.description !== KNOWLEDGE_TOOL_DESCRIPTION) failures.push('knowledgeToolDescription');
    if (tool.type !== 'SERVER_RAG') failures.push('knowledgeToolType');
    if (tool.disableInterruptions !== false) failures.push('knowledgeToolInterruptions');
    if (!sameJson(tool.config?.documentFolderIds ?? [], [group.id])) failures.push('knowledgeFolder');
    if (idOf(verifiedEmailTool) !== emailToolId) failures.push('emailToolId');
    if (namedEmailTools.length !== 1 || idOf(namedEmailTools[0]) !== emailToolId) failures.push('uniqueEmailTool');
    if (!sameJson(emailToolManagedView(verifiedEmailTool), emailToolManagedView(emailToolDefinition))) {
        failures.push('exact email client-tool definition');
    }
    if (
        namedSkipTurnTools.length !== 1
        || idOf(namedSkipTurnTools[0]) !== personaManifest.systemToolIds.skip_turn
        || String(namedSkipTurnTools[0]?.type ?? '').toLowerCase() !== 'system'
    ) failures.push('uniquePinnedSkipTurnTool');
    if (
        namedEndCallTools.length !== 1
        || idOf(namedEndCallTools[0]) !== personaManifest.systemToolIds.end_call
        || String(namedEndCallTools[0]?.type ?? '').toLowerCase() !== 'system'
    ) failures.push('uniquePinnedEndCallTool');
    if (verifiedGroup?.id !== group.id) failures.push('knowledgeGroupId');
    if (namedKnowledgeGroups.length !== 1 || namedKnowledgeGroups[0]?.id !== group.id) failures.push('uniqueKnowledgeGroup');
    if (verifiedGroup?.name !== knowledgeManifest.folderName) failures.push('knowledgeGroupName');
    if (verifiedGroup?.description !== `Reviewed public-safe Dani KB. Bundle SHA-256: ${knowledgeManifest.bundleSha256}`) {
        failures.push('knowledgeGroupDescription');
    }
    try {
        assertPinnedProviderIdentity(persona, verifiedRollbackPersona);
    } catch {
        failures.push('pinned provider identity');
    }
    if (!sameJson(protectedRollbackState(verifiedRollbackPersona), protectedRollbackBeforeApply)) {
        failures.push('protected rollback changed');
    }
    for (const [name, value] of Object.entries(personaManifest.voiceDetectionOptions)) {
        if (persona.voiceDetectionOptions?.[name] !== value) failures.push(`voiceDetectionOptions.${name}`);
    }
    if (failures.length) throw new Error(`Dani provider draft read-back failed: ${failures.join(', ')}`);
    const verifiedDocuments = await verifyDocumentBytes(listData(remoteDocuments));
    return {
        persona,
        rollbackPersona: verifiedRollbackPersona,
        tool,
        emailTool: verifiedEmailTool,
        group: verifiedGroup,
        verifiedDocuments,
    };
}

await verifyProviderReadback();
await new Promise(resolve => setTimeout(resolve, 5_000));
const delayed = await verifyProviderReadback();
console.log(JSON.stringify({
    ...plan,
    mode: 'draft_applied_publish_required',
    backupPath,
    knowledgeGroupId: group.id,
    knowledgeToolId,
    emailToolId,
    providerReadbackPromptSha256: normalizedSha256(managedPromptOf(delayed.persona.brain?.systemPrompt ?? '')),
    priorPublishedAt: targetPersona.publishedAt ?? null,
    providerReportedPublishedAt: delayed.persona.publishedAt ?? null,
    publicationVerified: false,
    manualPublishRequired: true,
    nextStep: 'Publish the draft in Anam, record the new publishedAt in persona-manifest.json, then run npm run anam:audit:dani.',
    providerReadbackToolNames: sortedToolNames(delayed.persona),
    providerReadbackToolIds: sortedToolIds(delayed.persona),
    providerReadbackVoiceDetectionOptions: delayed.persona.voiceDetectionOptions,
    knowledgeDocuments: readyDocuments.map(document => ({
        filename: document.filename,
        status: document.status,
    })).sort((a, b) => a.filename.localeCompare(b.filename)),
    delayedReadbackPassed: true,
    protectedRollbackPersonaUnchanged: true,
    exactToolReplacementVerified: true,
    emailToolDefinitionVerified: true,
    emailToolAwaitResultVerified: true,
    temporaryDirectory: os.tmpdir(),
}, null, 2));
process.exitCode = 2;
