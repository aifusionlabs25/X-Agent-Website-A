import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
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
const KNOWLEDGE_TOOL_DESCRIPTION = 'Mandatory grounding before Dani answers any substantive question about AI Fusion Labs, X Agents, capabilities, proof, metrics, security, privacy, hosting, retention, pricing, timing, integrations, architecture, or delivery. Search only the curated public-safe knowledge approved for Dani. If the result does not support the exact detail, Dani must say she cannot confirm it. This tool retrieves information only; it does not send, submit, book, save, or complete a handoff.';
const normalizeLineEndings = value => String(value).replace(/\r\n?/g, '\n');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizedSha256 = value => sha256(Buffer.from(normalizeLineEndings(value), 'utf8'));
const DANI_MEMORY_START_MARKER = '<!-- DANI_RETURNING_MEMORY_START -->';
const DANI_MEMORY_END_MARKER = '<!-- DANI_RETURNING_MEMORY_END -->';
const DANI_POST_CALL_START_MARKER = '<!-- DANI_POST_CALL_EMAIL_START -->';
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
const sortJson = value => {
    if (Array.isArray(value)) return value.map(sortJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]));
};
const sameJson = (left, right) => JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
const clientToolManagedView = tool => ({
    name: tool?.name ?? null,
    description: tool?.description ?? null,
    type: tool?.type ?? null,
    disableInterruptions: tool?.disableInterruptions ?? null,
    config: tool?.config ?? null,
});
const emailToolManagedView = clientToolManagedView;
const identityToolManagedView = clientToolManagedView;
const endSessionToolManagedView = clientToolManagedView;
const providerIdentityView = persona => ({
    id: persona?.id ?? null,
    name: persona?.name ?? null,
    avatarId: avatarIdOf(persona),
    avatarModel: persona?.avatarModel ?? null,
    voiceId: voiceIdOf(persona),
    llmId: llmIdOf(persona),
});

function validUuid(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

function exactToolAttachments(persona, expectedPairs) {
    const attached = Array.isArray(persona?.tools) ? persona.tools : [];
    const actualPairs = attached.map(tool => ({ name: tool?.name ?? null, id: idOf(tool) }));
    return attached.length === expectedPairs.length
        && actualPairs.every(pair => typeof pair.name === 'string' && validUuid(pair.id))
        && expectedPairs.every(pair => typeof pair.name === 'string' && validUuid(pair.id))
        && new Set(actualPairs.map(pair => pair.name)).size === actualPairs.length
        && new Set(actualPairs.map(pair => pair.id)).size === actualPairs.length
        && new Set(expectedPairs.map(pair => pair.name)).size === expectedPairs.length
        && new Set(expectedPairs.map(pair => pair.id)).size === expectedPairs.length
        && sameJson(
            actualPairs.sort((a, b) => a.name.localeCompare(b.name)),
            [...expectedPairs].sort((a, b) => a.name.localeCompare(b.name)),
        );
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
const identityToolDefinition = JSON.parse(await fs.readFile(
    new URL(personaManifest.identityToolDefinitionFile, configRootUrl),
    'utf8',
));
const endSessionToolDefinition = JSON.parse(await fs.readFile(
    new URL(personaManifest.endSessionToolDefinitionFile, configRootUrl),
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
        bytes: Buffer.byteLength(content, 'utf8'),
        sha256: sha256(Buffer.from(content, 'utf8')),
    };
}));
const bundleSha256 = normalizedSha256(JSON.stringify(documents));

const localFailures = [];
for (const [label, value] of Object.entries({
    'target persona ID': personaManifest.personaId,
    'rollback persona ID': personaManifest.rollbackPersonaId,
    'target avatar ID': personaManifest.expectedAvatarId,
    'target voice ID': personaManifest.expectedVoiceId,
    'target LLM ID': personaManifest.expectedLlmId,
    'skip_turn tool ID': personaManifest.systemToolIds?.skip_turn,
    'end-session tool ID': personaManifest.endSessionToolId,
})) {
    if (!validUuid(value)) localFailures.push(label);
}
for (const [label, value] of Object.entries({
    'managed knowledge tool ID': personaManifest.knowledgeToolId,
    'managed email tool ID': personaManifest.emailToolId,
    'managed knowledge group ID': knowledgeManifest.liveGroupId,
})) {
    if (value !== null && value !== undefined && !validUuid(value)) localFailures.push(label);
}
if (!validUuid(personaManifest.identityToolId)) localFailures.push('pinned managed identity tool ID');
if (!sameJson({
    id: personaManifest.personaId,
    name: personaManifest.expectedName,
    avatarId: personaManifest.expectedAvatarId,
    avatarModel: personaManifest.expectedAvatarModel,
    voiceId: personaManifest.expectedVoiceId,
    llmId: personaManifest.expectedLlmId,
}, PINNED_TARGET_IDENTITY)) localFailures.push('code-pinned target identity');
if (personaManifest.rollbackPersonaId !== PROTECTED_ROLLBACK_IDENTITY.id) localFailures.push('code-pinned rollback persona ID');
if (personaManifest.personaId === personaManifest.rollbackPersonaId) localFailures.push('distinct target and rollback identities');
if (personaManifest.knowledgeToolName !== knowledgeManifest.toolName) localFailures.push('knowledge tool manifest name');
if (personaManifest.emailToolName !== emailToolDefinition.name) localFailures.push('email tool manifest name');
if (
    personaManifest.identityToolName !== 'confirm_dani_live_identity'
    || identityToolDefinition.name !== 'confirm_dani_live_identity'
    || personaManifest.identityToolName !== identityToolDefinition.name
) localFailures.push('dedicated identity tool manifest name');
if (
    personaManifest.endSessionToolName !== 'end_dani_session'
    || endSessionToolDefinition.name !== 'end_dani_session'
    || personaManifest.endSessionToolName !== endSessionToolDefinition.name
) localFailures.push('dedicated end-session tool manifest name');
const expectedRequiredToolNames = [
    personaManifest.knowledgeToolName,
    'skip_turn',
    endSessionToolDefinition.name,
    emailToolDefinition.name,
    identityToolDefinition.name,
].sort();
if (
    !Array.isArray(personaManifest.requiredToolNames)
    || new Set(personaManifest.requiredToolNames).size !== personaManifest.requiredToolNames.length
    || !sameJson([...personaManifest.requiredToolNames].sort(), expectedRequiredToolNames)
) localFailures.push('exact required tool names');
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
) localFailures.push('exact managed email client-tool definition');
const identityParameters = identityToolDefinition.config?.parameters;
if (
    identityToolDefinition.type !== 'CLIENT'
    || identityToolDefinition.disableInterruptions !== true
    || typeof identityToolDefinition.description !== 'string'
    || !identityToolDefinition.description.trim()
    || identityToolDefinition.config?.awaitResult !== true
    || !Number.isFinite(identityToolDefinition.config?.toolTimeoutSeconds)
    || identityToolDefinition.config.toolTimeoutSeconds <= 0
    || identityParameters?.type !== 'object'
    || !sameJson(
        Object.keys(identityParameters.properties ?? {}).sort(),
        ['memoryAccessConfirmed', 'preferredName'],
    )
    || identityParameters.properties?.preferredName?.type !== 'string'
    || identityParameters.properties.preferredName.minLength !== 1
    || identityParameters.properties.preferredName.maxLength !== 80
    || typeof identityParameters.properties.preferredName.description !== 'string'
    || !identityParameters.properties.preferredName.description.trim()
    || identityParameters.properties?.memoryAccessConfirmed?.type !== 'boolean'
    || typeof identityParameters.properties.memoryAccessConfirmed.description !== 'string'
    || !identityParameters.properties.memoryAccessConfirmed.description.trim()
    || !Array.isArray(identityParameters.required)
    || !sameJson(
        [...identityParameters.required].sort(),
        ['memoryAccessConfirmed', 'preferredName'],
    )
    || identityParameters.additionalProperties !== false
) localFailures.push('exact managed identity client-tool two-field definition');
const endSessionParameters = endSessionToolDefinition.config?.parameters;
if (
    endSessionToolDefinition.type !== 'CLIENT'
    || endSessionToolDefinition.disableInterruptions !== true
    || typeof endSessionToolDefinition.description !== 'string'
    || !endSessionToolDefinition.description.trim()
    || endSessionToolDefinition.config?.awaitResult !== true
    || !Number.isFinite(endSessionToolDefinition.config?.toolTimeoutSeconds)
    || endSessionToolDefinition.config.toolTimeoutSeconds <= 0
    || endSessionParameters?.type !== 'object'
    || !sameJson(Object.keys(endSessionParameters.properties ?? {}), [])
    || !sameJson(endSessionParameters.required, [])
    || endSessionParameters.additionalProperties !== false
) localFailures.push('exact managed end-session client-tool parameterless definition');
const promptMarkerPositions = [
    prompt.indexOf(DANI_MEMORY_START_MARKER),
    prompt.indexOf(DANI_MEMORY_END_MARKER),
    prompt.indexOf(DANI_POST_CALL_START_MARKER),
    prompt.indexOf(DANI_PROMPT_END_MARKER),
];
const managedPromptMarkers = [
    DANI_MEMORY_START_MARKER,
    DANI_MEMORY_END_MARKER,
    DANI_POST_CALL_START_MARKER,
    DANI_PROMPT_END_MARKER,
];
if (
    promptMarkerPositions.some(position => position < 0)
    || promptMarkerPositions.some((position, index) => index > 0 && position <= promptMarkerPositions[index - 1])
    || managedPromptMarkers.some(marker => prompt.indexOf(marker) !== prompt.lastIndexOf(marker))
) localFailures.push('returning-memory block inside managed post-call prompt boundary');
if (
    !Array.isArray(knowledgeManifest.documents)
    || knowledgeManifest.documents.length === 0
    || new Set(knowledgeManifest.documents).size !== knowledgeManifest.documents.length
    || knowledgeManifest.documents.some(filename => (
        typeof filename !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(filename)
        || filename.includes('..')
    ))
) localFailures.push('safe unique knowledge document allowlist');
if (!sameJson(Object.keys(knowledgeManifest.documentFingerprints ?? {}).sort(), [...knowledgeManifest.documents].sort())) {
    localFailures.push('exact knowledge fingerprint allowlist');
}
if (normalizedSha256(prompt) !== personaManifest.promptSha256) localFailures.push('local prompt hash');
if (bundleSha256 !== knowledgeManifest.bundleSha256) localFailures.push('local knowledge bundle hash');
for (const document of documents) {
    const expected = knowledgeManifest.documentFingerprints?.[document.filename];
    if (!expected || expected.bytes !== document.bytes || expected.sha256 !== document.sha256) {
        localFailures.push(`local knowledge ${document.filename}`);
    }
}
if (localFailures.length) throw new Error(`Dani local managed configuration failed: ${localFailures.join(', ')}`);

async function anam(pathname) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(`Anam GET ${pathname} failed (${response.status}): ${(await response.text()).slice(0, 1000)}`);
    }
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

const [persona, rollbackPersona, toolPayload, groupPayload] = await Promise.all([
    anam(`/personas/${personaManifest.personaId}`),
    anam(`/personas/${personaManifest.rollbackPersonaId}`),
    anam('/tools?perPage=100'),
    anam('/knowledge/groups'),
]);
const tools = listData(toolPayload);
const groups = listData(groupPayload);
const matchingTools = tools.filter(tool => tool.name === personaManifest.knowledgeToolName);
const matchingEmailTools = tools.filter(tool => tool.name === emailToolDefinition.name);
const matchingIdentityTools = tools.filter(tool => tool.name === identityToolDefinition.name);
const matchingEndSessionTools = tools.filter(tool => tool.name === endSessionToolDefinition.name);
const matchingGroups = groups.filter(group => group.name === knowledgeManifest.folderName);
const matchingSkipTurnTools = tools.filter(tool => tool.name === 'skip_turn');
const listedTool = matchingTools[0];
const listedEmailTool = matchingEmailTools[0];
const listedIdentityTool = matchingIdentityTools[0];
const listedEndSessionTool = matchingEndSessionTools[0];
const skipTurn = matchingSkipTurnTools[0];
const group = matchingGroups[0];
const [tool, emailTool, identityTool, endSessionTool, verifiedGroup, remoteDocuments] = await Promise.all([
    idOf(listedTool) ? anam(`/tools/${encodeURIComponent(idOf(listedTool))}`) : Promise.resolve(null),
    idOf(listedEmailTool) ? anam(`/tools/${encodeURIComponent(idOf(listedEmailTool))}`) : Promise.resolve(null),
    idOf(listedIdentityTool) ? anam(`/tools/${encodeURIComponent(idOf(listedIdentityTool))}`) : Promise.resolve(null),
    idOf(listedEndSessionTool) ? anam(`/tools/${encodeURIComponent(idOf(listedEndSessionTool))}`) : Promise.resolve(null),
    group?.id ? anam(`/knowledge/groups/${encodeURIComponent(group.id)}`) : Promise.resolve(null),
    group?.id
        ? anam(`/knowledge/groups/${encodeURIComponent(group.id)}/documents`).then(listData)
        : Promise.resolve([]),
]);
const failures = [];
const managedPersonaDescription = `Managed Cara 4 Dani for x-agent-website-a. Protected rollback persona: ${personaManifest.rollbackPersonaId}`;
const liveRawPrompt = normalizeLineEndings(persona.brain?.systemPrompt ?? '');
const liveManagedPrompt = managedPromptOf(liveRawPrompt);
const livePromptSha256 = normalizedSha256(liveManagedPrompt);
const liveToolHeadingLines = liveRawPrompt
    .split('\n')
    .filter(line => /^#{1,3}\s*tools?\b/i.test(line.trim()))
    .slice(0, 5);

if (persona.id !== personaManifest.personaId) failures.push('persona ID');
if (persona.name !== personaManifest.expectedName) failures.push('persona name');
const livePublishedAtMs = typeof persona.publishedAt === 'string'
    ? Date.parse(persona.publishedAt)
    : Number.NaN;
const minimumPublishedAtMs = Date.parse(personaManifest.verifiedPublishedAt);
const transitionPreviousPublishedAtMs = personaManifest.transitionPreviousPublishedAt
    ? Date.parse(personaManifest.transitionPreviousPublishedAt)
    : Number.NaN;
if (
    !Number.isFinite(livePublishedAtMs)
    || !Number.isFinite(minimumPublishedAtMs)
    || livePublishedAtMs < minimumPublishedAtMs
    || (
        Number.isFinite(transitionPreviousPublishedAtMs)
        && livePublishedAtMs <= transitionPreviousPublishedAtMs
    )
) failures.push('verified published revision');
if (persona.description !== managedPersonaDescription) failures.push('persona description');
if (avatarIdOf(persona) !== personaManifest.expectedAvatarId) failures.push('avatar ID');
if (persona.avatarModel !== personaManifest.expectedAvatarModel) failures.push('Cara 4 model');
if (voiceIdOf(persona) !== personaManifest.expectedVoiceId) failures.push('voice ID');
if (llmIdOf(persona) !== personaManifest.expectedLlmId) failures.push('LLM ID');
if (livePromptSha256 !== personaManifest.promptSha256) {
    failures.push(`prompt hash ${livePromptSha256}; raw=${liveRawPrompt.length}; managed=${liveManagedPrompt.length}; headings=${JSON.stringify(liveToolHeadingLines)}`);
}
if (persona.initialMessage !== personaManifest.initialMessage) failures.push('initial message');
if (persona.skipGreeting !== false) failures.push('skip greeting');
if (persona.uninterruptibleGreeting !== false) failures.push('interruptible greeting');
if (persona.languageCode !== personaManifest.expectedLanguageCode) failures.push('language');
if (persona.zeroDataRetention !== personaManifest.zeroDataRetention) failures.push('session data retention');
if (persona.enableAudioPassthrough !== personaManifest.enableAudioPassthrough) failures.push('Anam transcription pipeline');
for (const [name, value] of Object.entries(personaManifest.voiceDetectionOptions)) {
    if (persona.voiceDetectionOptions?.[name] !== value) failures.push(`voiceDetectionOptions.${name}`);
}

if (!sameJson(providerIdentityView(persona), PINNED_TARGET_IDENTITY)) failures.push('code-pinned target provider identity');
if (!sameJson(providerIdentityView(rollbackPersona), PROTECTED_ROLLBACK_IDENTITY)) failures.push('protected rollback provider identity');
if (matchingTools.length !== 1 || !idOf(tool)) failures.push('unique managed knowledge tool');
if (matchingEmailTools.length !== 1 || !idOf(emailTool)) failures.push('unique managed email tool');
if (matchingIdentityTools.length !== 1 || !idOf(identityTool)) failures.push('unique managed identity tool');
if (matchingEndSessionTools.length !== 1 || !idOf(endSessionTool)) failures.push('unique managed end-session tool');
if (matchingGroups.length !== 1 || !group?.id) failures.push('unique managed knowledge group');
if (matchingSkipTurnTools.length !== 1 || idOf(skipTurn) !== personaManifest.systemToolIds.skip_turn || String(skipTurn?.type ?? '').toLowerCase() !== 'system') failures.push('pinned skip_turn system tool');
if (knowledgeManifest.liveGroupId && group?.id !== knowledgeManifest.liveGroupId) failures.push('pinned knowledge group ID');
if (personaManifest.knowledgeToolId && idOf(tool) !== personaManifest.knowledgeToolId) failures.push('pinned knowledge tool ID');
if (personaManifest.emailToolId && idOf(emailTool) !== personaManifest.emailToolId) failures.push('pinned email tool ID');
if (idOf(identityTool) !== personaManifest.identityToolId) failures.push('pinned identity tool ID');
if (idOf(endSessionTool) !== personaManifest.endSessionToolId) failures.push('pinned end-session tool ID');
if (idOf(tool) !== idOf(listedTool)) failures.push('knowledge tool detail ID');
if (tool?.name !== personaManifest.knowledgeToolName) failures.push('knowledge tool name');
if (tool?.description !== KNOWLEDGE_TOOL_DESCRIPTION) failures.push('knowledge tool description');
if (tool?.type !== 'SERVER_RAG') failures.push('knowledge tool type');
if (tool?.disableInterruptions !== false) failures.push('knowledge tool interruptions');
if (!sameJson(tool?.config?.documentFolderIds ?? [], group?.id ? [group.id] : [])) failures.push('knowledge group isolation');
if (idOf(emailTool) !== idOf(listedEmailTool)) failures.push('email tool detail ID');
if (!sameJson(emailToolManagedView(emailTool), emailToolManagedView(emailToolDefinition))) failures.push('exact email client-tool definition');
if (idOf(identityTool) !== idOf(listedIdentityTool)) failures.push('identity tool detail ID');
if (!sameJson(
    identityToolManagedView(identityTool),
    identityToolManagedView(identityToolDefinition),
)) failures.push('exact identity client-tool definition');
if (idOf(endSessionTool) !== idOf(listedEndSessionTool)) failures.push('end-session tool detail ID');
if (!sameJson(
    endSessionToolManagedView(endSessionTool),
    endSessionToolManagedView(endSessionToolDefinition),
)) failures.push('exact end-session client-tool definition');
if (verifiedGroup?.id !== group?.id) failures.push('knowledge group detail ID');
if (verifiedGroup?.name !== knowledgeManifest.folderName) failures.push('knowledge group name');
if (verifiedGroup?.description !== `Reviewed public-safe Dani KB. Bundle SHA-256: ${knowledgeManifest.bundleSha256}`) failures.push('knowledge group description');

const attachedTools = persona.tools ?? [];
const attachedNames = attachedTools.map(item => item?.name).filter(Boolean).sort();
const expectedToolPairs = [
    { name: personaManifest.knowledgeToolName, id: idOf(tool) },
    { name: 'skip_turn', id: personaManifest.systemToolIds.skip_turn },
    { name: endSessionToolDefinition.name, id: idOf(endSessionTool) },
    { name: emailToolDefinition.name, id: idOf(emailTool) },
    { name: identityToolDefinition.name, id: idOf(identityTool) },
];
if (!exactToolAttachments(persona, expectedToolPairs)) failures.push('exact attached tool name/ID replacement set');
if (attachedTools.some(item => item?.name === 'confirm_live_identity')) {
    failures.push('forbidden Amy identity tool attachment');
}
if (attachedTools.some(item => item?.name === 'end_call')) {
    failures.push('forbidden built-in end_call attachment');
}

const expectedDocumentNames = new Set(knowledgeManifest.documents);
const relevantDocuments = remoteDocuments.filter(document => expectedDocumentNames.has(document.filename));
if (relevantDocuments.length !== documents.length) failures.push('knowledge document count');
if (new Set(relevantDocuments.map(document => document.filename)).size !== relevantDocuments.length) failures.push('unique knowledge filenames');
if (relevantDocuments.some(document => document.status !== 'READY')) failures.push('knowledge readiness');
if (remoteDocuments.some(document => !expectedDocumentNames.has(document.filename))) failures.push('unexpected knowledge document');
for (const remote of relevantDocuments) {
    const local = documents.find(document => document.filename === remote.filename);
    const bytes = await downloadDocument(remote);
    if (!local || bytes.length !== local.bytes || sha256(bytes) !== local.sha256) {
        failures.push(`knowledge hash ${remote.filename}`);
    }
}

if (failures.length) throw new Error(`Dani live audit failed: ${failures.join(', ')}`);

console.log(JSON.stringify({
    ready: true,
    personaId: persona.id,
    publishedAt: persona.publishedAt,
    protectedRollbackPersonaId: rollbackPersona.id,
    avatarId: avatarIdOf(persona),
    avatarModel: persona.avatarModel,
    voiceId: voiceIdOf(persona),
    llmId: llmIdOf(persona),
    promptSha256: livePromptSha256,
    voiceDetectionOptions: persona.voiceDetectionOptions,
    knowledgeBundleSha256: knowledgeManifest.bundleSha256,
    knowledgeGroupId: group.id,
    knowledgeToolId: idOf(tool),
    emailToolId: idOf(emailTool),
    identityToolId: idOf(identityTool),
    endSessionToolId: idOf(endSessionTool),
    exactToolReplacementVerified: true,
    emailToolDefinitionVerified: true,
    identityToolDefinitionVerified: true,
    identityToolStrictTwoFieldSchemaVerified: true,
    endSessionToolDefinitionVerified: true,
    endSessionToolParameterlessSchemaVerified: true,
    forbiddenBuiltInEndCallRejected: true,
    forbiddenAmyIdentityToolRejected: true,
    knowledgeDocuments: relevantDocuments.map(document => ({
        filename: document.filename,
        status: document.status,
    })).sort((a, b) => a.filename.localeCompare(b.filename)),
    attachedToolNames: attachedNames,
    attachedToolIds: attachedTools.map(item => ({
        name: item.name,
        id: idOf(item),
    })).sort((a, b) => a.name.localeCompare(b.name)),
}, null, 2));
