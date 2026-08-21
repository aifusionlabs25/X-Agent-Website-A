import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_BASE = 'https://api.anam.ai/v1';
export const AMY_KNOWLEDGE_APPLY_CONFIRMATION = 'CONFIRM_AMY_KNOWLEDGE_V1_MIGRATION';
export const PINNED_AMY = Object.freeze({
    personaId: '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08',
    name: 'Amy Insight SDR - Cara 4 Canary',
    avatarId: '36e17abf-ef6c-4bef-99bd-3f925da155eb',
    avatarModel: 'cara-4',
    voiceId: 'b138c2a2-ba66-4887-95d5-1a57093fc92d',
    llmId: '65421f1c-c7de-4bc4-ac27-d171c16ef41f',
    previewPersonaId: '37e9bf19-0236-4935-be50-f3a1fd4faf00',
    sourceKnowledgeToolId: '9163bee5-493c-4552-97b4-4d32e6356872',
    knowledgeToolName: 'Knowledge_Amy',
});

export const repositoryRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const manifestUrl = new URL('../../config/anam/amy/v1/knowledge-manifest.json', import.meta.url);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export function sortJson(value) {
    if (Array.isArray(value)) return value.map(sortJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]));
}

export const stableJson = value => JSON.stringify(sortJson(value));
export const hashJson = value => sha256(Buffer.from(stableJson(value), 'utf8'));
export const idOf = value => value?._toolId ?? value?.id ?? null;
export const documentIdOf = value => value?._documentId ?? value?.documentId ?? value?.id ?? null;
export const avatarIdOf = persona => persona?.avatar?.id ?? persona?.avatarId ?? null;
export const voiceIdOf = persona => persona?.voice?.id ?? persona?.voice?.voiceId ?? persona?.voiceId ?? null;
export const llmIdOf = persona => persona?.brain?.llm?.id ?? persona?.brain?.llmId ?? persona?.llm?.id ?? persona?.llmId ?? null;

export function listData(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ['data', 'items', 'tools', 'personas', 'groups', 'documents']) {
        if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
}

export function assertUuid(label, value) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        throw new Error(`${label} is not a pinned UUID.`);
    }
}

export async function loadLocalEnvironment() {
    const localEnv = await fs.readFile(new URL('../../.env.local', import.meta.url), 'utf8').catch(() => '');
    return Object.fromEntries(
        localEnv
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#') && line.includes('='))
            .map(line => {
                const at = line.indexOf('=');
                return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
            }),
    );
}

export async function readApiKey() {
    const local = await loadLocalEnvironment();
    const apiKey = process.env.ANAM_API_KEY?.trim() || local.ANAM_API_KEY?.trim();
    if (!apiKey) throw new Error('ANAM_API_KEY is required and is never printed.');
    return apiKey;
}

export async function loadAmyKnowledgeBundle({ manifestFileUrl = manifestUrl } = {}) {
    const manifest = JSON.parse(await fs.readFile(manifestFileUrl, 'utf8'));
    const expectedTopLevel = [
        'agent',
        'bundleSha256',
        'company',
        'deploymentStatus',
        'documentFingerprints',
        'documents',
        'excludedClasses',
        'folderName',
        'liveToolId',
        'personaId',
        'schemaVersion',
        'sourceToolId',
        'sourcePolicy',
        'toolName',
        'verifiedAt',
    ];
    const allowedTopLevel = new Set([...expectedTopLevel, 'liveGroupId']);
    const actualTopLevel = Object.keys(manifest);
    if (actualTopLevel.some(key => !allowedTopLevel.has(key))) {
        throw new Error('Amy knowledge manifest contains an unrecognized field.');
    }
    if (expectedTopLevel.some(key => !actualTopLevel.includes(key))) {
        throw new Error('Amy knowledge manifest is missing a required field.');
    }
    if (
        manifest.schemaVersion !== 1
        || manifest.agent !== 'Amy'
        || manifest.company !== 'Insight Enterprises'
        || manifest.personaId !== PINNED_AMY.personaId
        || manifest.toolName !== PINNED_AMY.knowledgeToolName
        || manifest.sourceToolId !== PINNED_AMY.sourceKnowledgeToolId
        || typeof manifest.folderName !== 'string'
        || !/^Amy Insight SDR Anam KB \d{4}-\d{2}-\d{2} v\d+$/.test(manifest.folderName)
        || (manifest.liveGroupId != null && !UUID_PATTERN.test(manifest.liveGroupId))
        || (manifest.liveToolId != null && !UUID_PATTERN.test(manifest.liveToolId))
        || !Array.isArray(manifest.excludedClasses)
        || !manifest.excludedClasses.length
        || manifest.excludedClasses.some(value => typeof value !== 'string' || !value.trim())
        || typeof manifest.sourcePolicy !== 'string'
        || !manifest.sourcePolicy.trim()
        || !SHA256_PATTERN.test(manifest.bundleSha256)
    ) {
        throw new Error('Amy knowledge manifest identity, version, or policy fields are invalid.');
    }
    if (!Array.isArray(manifest.documents) || !manifest.documents.length) {
        throw new Error('Amy knowledge manifest must contain at least one allowlisted document.');
    }
    if (new Set(manifest.documents).size !== manifest.documents.length) {
        throw new Error('Amy knowledge manifest contains duplicate filenames.');
    }
    for (const filename of manifest.documents) {
        if (
            typeof filename !== 'string'
            || path.basename(filename) !== filename
            || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(filename)
        ) {
            throw new Error(`Unsafe Amy knowledge filename: ${String(filename)}`);
        }
    }

    const knowledgeDirectoryUrl = new URL('./knowledge/', manifestFileUrl);
    const directoryEntries = await fs.readdir(knowledgeDirectoryUrl, { withFileTypes: true });
    const actualNames = directoryEntries.map(entry => entry.name).sort();
    const expectedNames = [...manifest.documents].sort();
    if (
        directoryEntries.some(entry => !entry.isFile())
        || stableJson(actualNames) !== stableJson(expectedNames)
    ) {
        throw new Error('Amy knowledge directory must contain exactly the regular files in the manifest allowlist.');
    }

    const documents = await Promise.all(manifest.documents.map(async filename => {
        const bytes = await fs.readFile(new URL(`./knowledge/${filename}`, manifestFileUrl));
        return {
            filename,
            bytes,
            byteLength: bytes.length,
            sha256: sha256(bytes),
        };
    }));
    for (const document of documents) {
        const fingerprint = manifest.documentFingerprints?.[document.filename];
        if (
            !fingerprint
            || fingerprint.bytes !== document.byteLength
            || fingerprint.sha256 !== document.sha256
            || !SHA256_PATTERN.test(fingerprint.sha256)
        ) {
            throw new Error(`Amy knowledge fingerprint mismatch: ${document.filename}`);
        }
    }
    if (Object.keys(manifest.documentFingerprints ?? {}).sort().join('\0') !== expectedNames.join('\0')) {
        throw new Error('Amy knowledge fingerprints must exactly match the document allowlist.');
    }
    const bundleSha256 = sha256(Buffer.from(JSON.stringify(
        documents.map(document => ({
            filename: document.filename,
            bytes: document.byteLength,
            sha256: document.sha256,
        })),
    ), 'utf8'));
    if (bundleSha256 !== manifest.bundleSha256) {
        throw new Error('Amy local knowledge bundle hash does not match the manifest.');
    }
    return { manifest, documents, bundleSha256 };
}

export function createAnamClient({ apiKey, fetchImpl = fetch } = {}) {
    if (!apiKey) throw new Error('Anam API key is required.');
    return async function anam(pathname, init = {}) {
        const response = await fetchImpl(`${API_BASE}${pathname}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                ...(!(init.body instanceof FormData) && init.body ? { 'Content-Type': 'application/json' } : {}),
                ...init.headers,
            },
            redirect: 'follow',
            signal: init.signal ?? AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`Anam ${init.method ?? 'GET'} ${pathname} failed (${response.status}): ${detail.slice(0, 800)}`);
        }
        if (response.status === 204) return null;
        return response.json();
    };
}

export async function downloadKnowledgeDocument(document, { apiKey, fetchImpl = fetch } = {}) {
    const documentId = documentIdOf(document);
    if (!documentId) throw new Error(`Knowledge document has no ID: ${document?.filename ?? 'unknown'}`);
    const response = await fetchImpl(`${API_BASE}/knowledge/documents/${encodeURIComponent(documentId)}/download`, {
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
    const download = await fetchImpl(downloadUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
    });
    if (!download.ok) {
        throw new Error(`Anam signed document download failed (${download.status}) for ${document.filename}.`);
    }
    return Buffer.from(await download.arrayBuffer());
}

function assertCompleteFirstPage(payload, label) {
    const rows = listData(payload);
    const meta = payload?.meta;
    if (
        !meta
        || !Number.isInteger(meta.total)
        || !Number.isInteger(meta.lastPage)
        || !Number.isInteger(meta.currentPage)
        || !Number.isInteger(meta.perPage)
        || meta.total !== rows.length
        || meta.lastPage !== 1
        || meta.currentPage !== 1
        || meta.perPage < meta.total
        || meta.next !== null
    ) {
        throw new Error(`Anam ${label} inventory is paginated or incomplete; refusing to infer isolation.`);
    }
    if (new Set(rows.map(row => row?.id)).size !== rows.length || rows.some(row => !UUID_PATTERN.test(row?.id ?? ''))) {
        throw new Error(`Anam ${label} inventory contains missing or duplicate IDs.`);
    }
    return { rows, meta };
}

export function requireCompleteList(payload, label) {
    if (Array.isArray(payload)) return payload;
    if (payload?.meta) return assertCompleteFirstPage(payload, label).rows;
    throw new Error(`Anam ${label} response is not a provably complete list.`);
}

export async function fetchCompletePersonaInventory(anam) {
    const payload = await anam('/personas?perPage=100');
    const { rows, meta } = assertCompleteFirstPage(payload, 'persona');
    const details = await Promise.all(rows.map(row => anam(`/personas/${encodeURIComponent(row.id)}`)));
    if (
        details.length !== meta.total
        || new Set(details.map(persona => persona?.id)).size !== details.length
        || details.some(persona => !UUID_PATTERN.test(persona?.id ?? '') || !Array.isArray(persona?.tools))
    ) {
        throw new Error('Anam persona detail inventory is incomplete; refusing to infer tool isolation.');
    }
    return { meta, summaries: rows, details };
}

export async function fetchCompleteToolInventory(anam) {
    const payload = await anam('/tools?perPage=100');
    const { rows, meta } = assertCompleteFirstPage(payload, 'tool');
    const details = await Promise.all(rows.map(tool => (
        anam(`/tools/${encodeURIComponent(tool.id)}`)
    )));
    const summaryIds = [...rows.map(tool => tool.id)].sort();
    const detailIds = [...details.map(tool => tool?.id)].sort();
    if (
        details.length !== meta.total
        || new Set(detailIds).size !== details.length
        || details.some(tool => !UUID_PATTERN.test(tool?.id ?? ''))
        || stableJson(detailIds) !== stableJson(summaryIds)
    ) {
        throw new Error('Anam tool detail inventory is incomplete; refusing to infer knowledge-group isolation.');
    }
    return { meta, summaries: rows, tools: details };
}

export function assertPinnedProviderIdentity(persona) {
    if (
        persona?.id !== PINNED_AMY.personaId
        || persona?.name !== PINNED_AMY.name
        || avatarIdOf(persona) !== PINNED_AMY.avatarId
        || persona?.avatarModel !== PINNED_AMY.avatarModel
        || voiceIdOf(persona) !== PINNED_AMY.voiceId
        || llmIdOf(persona) !== PINNED_AMY.llmId
    ) {
        throw new Error('Live Amy provider identity does not match the pinned persona/avatar/voice/Qwen state.');
    }
}

export function toolStateView(tool) {
    return {
        id: idOf(tool),
        name: tool?.name ?? null,
        description: tool?.description ?? null,
        type: tool?.type ?? null,
        disableInterruptions: tool?.disableInterruptions ?? null,
        config: tool?.config ?? null,
    };
}

export function amyManagedKnowledgeToolDescription(bundleSha256) {
    return `Retrieve only Amy's reviewed public-safe Insight SDR knowledge. This is curated grounding, not live inventory, SKU or part-number, pricing, availability, CRM, contract, or partner-portal search. If the exact fact is absent, Amy must say she cannot confirm it and capture the facts for an authorized Insight specialist. Managed bundle SHA-256: ${bundleSha256}`;
}

export function providerFullView(persona) {
    return {
        id: persona?.id ?? null,
        name: persona?.name ?? null,
        description: persona?.description ?? null,
        personaPreset: persona?.personaPreset ?? null,
        avatarId: avatarIdOf(persona),
        avatarModel: persona?.avatarModel ?? null,
        voiceId: voiceIdOf(persona),
        voiceSpeed: persona?.voiceSpeed ?? null,
        llmId: llmIdOf(persona),
        systemPromptSha256: sha256(Buffer.from(String(persona?.brain?.systemPrompt ?? ''), 'utf8')),
        initialMessage: persona?.initialMessage ?? null,
        skipGreeting: persona?.skipGreeting ?? null,
        uninterruptibleGreeting: persona?.uninterruptibleGreeting ?? null,
        languageCode: persona?.languageCode ?? null,
        isDefaultPersona: persona?.isDefaultPersona ?? null,
        zeroDataRetention: persona?.zeroDataRetention ?? null,
        enableAudioPassthrough: persona?.enableAudioPassthrough ?? null,
        voiceDetectionOptions: persona?.voiceDetectionOptions ?? null,
        publishedAt: persona?.publishedAt ?? null,
        tools: (persona?.tools ?? [])
            .map(toolStateView)
            .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    };
}

export function providerProtectedView(persona) {
    const tools = (persona?.tools ?? []).map(tool => {
        if (
            tool?.name === PINNED_AMY.knowledgeToolName
            && ['server', 'SERVER_RAG'].includes(tool?.type)
        ) {
            return { slot: 'amyKnowledge', name: tool.name, type: 'server_knowledge' };
        }
        return toolStateView(tool);
    }).sort((left, right) => String(left.id ?? left.slot).localeCompare(String(right.id ?? right.slot)));
    return {
        id: persona?.id ?? null,
        name: persona?.name ?? null,
        description: persona?.description ?? null,
        personaPreset: persona?.personaPreset ?? null,
        avatarId: avatarIdOf(persona),
        avatarModel: persona?.avatarModel ?? null,
        voiceId: voiceIdOf(persona),
        voiceSpeed: persona?.voiceSpeed ?? null,
        llmId: llmIdOf(persona),
        systemPromptSha256: sha256(Buffer.from(String(persona?.brain?.systemPrompt ?? ''), 'utf8')),
        initialMessage: persona?.initialMessage ?? null,
        skipGreeting: persona?.skipGreeting ?? null,
        uninterruptibleGreeting: persona?.uninterruptibleGreeting ?? null,
        languageCode: persona?.languageCode ?? null,
        isDefaultPersona: persona?.isDefaultPersona ?? null,
        zeroDataRetention: persona?.zeroDataRetention ?? null,
        enableAudioPassthrough: persona?.enableAudioPassthrough ?? null,
        voiceDetectionOptions: persona?.voiceDetectionOptions ?? null,
        publishedAt: persona?.publishedAt ?? null,
        tools,
    };
}

export function knowledgeToolUsages(personas, { toolId, toolName } = {}) {
    const usages = [];
    for (const persona of personas) {
        for (const tool of persona.tools ?? []) {
            if ((toolId && idOf(tool) === toolId) || (!toolId && toolName && tool?.name === toolName)) {
                usages.push({
                    personaId: persona.id,
                    personaName: persona.name ?? null,
                    toolId: idOf(tool),
                    toolName: tool?.name ?? null,
                });
            }
        }
    }
    return usages.sort((left, right) => `${left.personaId}:${left.toolId}`.localeCompare(`${right.personaId}:${right.toolId}`));
}

export function isDedicatedAmyKnowledgeTool(usages, toolId) {
    return usages.length === 1
        && usages[0].personaId === PINNED_AMY.personaId
        && usages[0].toolId === toolId
        && usages[0].toolName === PINNED_AMY.knowledgeToolName;
}

export async function snapshotKnowledgeGroup(anam, group, { apiKey, fetchImpl = fetch } = {}) {
    if (!group?.id) throw new Error('Cannot snapshot a knowledge group without an ID.');
    const documents = requireCompleteList(
        await anam(`/knowledge/groups/${encodeURIComponent(group.id)}/documents`),
        `knowledge documents for ${group.id}`,
    );
    if (
        new Set(documents.map(documentIdOf)).size !== documents.length
        || documents.some(document => !UUID_PATTERN.test(documentIdOf(document) ?? ''))
    ) {
        throw new Error(`Knowledge group ${group.id} contains missing or duplicate document IDs.`);
    }
    const snapshots = await Promise.all(documents.map(async document => {
        const bytes = document?.status === 'READY'
            ? await downloadKnowledgeDocument(document, { apiKey, fetchImpl })
            : null;
        return {
            id: documentIdOf(document),
            filename: document?.filename ?? null,
            status: document?.status ?? null,
            bytes: bytes?.length ?? null,
            sha256: bytes ? sha256(bytes) : null,
        };
    }));
    snapshots.sort((left, right) => (
        `${left.filename ?? ''}:${left.id ?? ''}`.localeCompare(`${right.filename ?? ''}:${right.id ?? ''}`)
    ));
    const duplicateFilenames = [...new Set(
        snapshots
            .map(document => document.filename)
            .filter((filename, index, values) => values.indexOf(filename) !== index),
    )].sort();
    return {
        id: group.id,
        name: group.name ?? null,
        description: group.description ?? null,
        documents: snapshots,
        duplicateFilenames,
        stateSha256: hashJson({
            id: group.id,
            name: group.name ?? null,
            description: group.description ?? null,
            documents: snapshots,
        }),
    };
}

export async function captureAmyKnowledgeState({ anam, apiKey, bundle, fetchImpl = fetch } = {}) {
    const [persona, personaInventory, toolInventory, groupPayload] = await Promise.all([
        anam(`/personas/${PINNED_AMY.personaId}`),
        fetchCompletePersonaInventory(anam),
        fetchCompleteToolInventory(anam),
        anam('/knowledge/groups'),
    ]);
    assertPinnedProviderIdentity(persona);
    const knowledgeAttachments = (persona.tools ?? []).filter(tool => (
        tool?.name === PINNED_AMY.knowledgeToolName
        && ['server', 'SERVER_RAG'].includes(tool?.type)
    ));
    if (knowledgeAttachments.length !== 1 || !idOf(knowledgeAttachments[0])) {
        throw new Error('Pinned Amy must have exactly one Knowledge_Amy SERVER_RAG attachment.');
    }
    const currentToolId = idOf(knowledgeAttachments[0]);
    if (bundle.manifest.liveToolId && currentToolId !== bundle.manifest.liveToolId) {
        throw new Error('Pinned Amy knowledge attachment does not match the manifest migration phase.');
    }
    const [sourceTool, currentTool] = await Promise.all([
        anam(`/tools/${PINNED_AMY.sourceKnowledgeToolId}`),
        currentToolId === PINNED_AMY.sourceKnowledgeToolId
            ? Promise.resolve(null)
            : anam(`/tools/${currentToolId}`),
    ]);
    const tool = currentTool ?? sourceTool;
    const namedTools = toolInventory.tools.filter(candidate => candidate?.name === PINNED_AMY.knowledgeToolName);
    if (
        !namedTools.some(candidate => idOf(candidate) === PINNED_AMY.sourceKnowledgeToolId)
        || idOf(sourceTool) !== PINNED_AMY.sourceKnowledgeToolId
        || sourceTool?.name !== PINNED_AMY.knowledgeToolName
        || sourceTool?.type !== 'SERVER_RAG'
        || idOf(tool) !== currentToolId
        || tool?.name !== PINNED_AMY.knowledgeToolName
        || tool?.type !== 'SERVER_RAG'
    ) {
        throw new Error('The source or current Knowledge_Amy tool is missing, changed, or not SERVER_RAG.');
    }
    if (bundle.manifest.liveToolId && !namedTools.some(candidate => idOf(candidate) === bundle.manifest.liveToolId)) {
        throw new Error('Manifest-pinned dedicated Knowledge_Amy tool is unavailable.');
    }
    const managedDescription = amyManagedKnowledgeToolDescription(bundle.bundleSha256);
    if (
        !bundle.manifest.liveToolId
        && currentToolId !== PINNED_AMY.sourceKnowledgeToolId
        && tool.description !== managedDescription
    ) {
        throw new Error('Production Amy uses an unpinned knowledge tool that does not match the managed bundle.');
    }
    const managedToolCandidates = namedTools.filter(candidate => (
        idOf(candidate) !== PINNED_AMY.sourceKnowledgeToolId
        && candidate?.type === 'SERVER_RAG'
        && candidate?.description === managedDescription
    ));
    if (managedToolCandidates.length > 1) {
        throw new Error('Multiple unpinned managed Amy knowledge tools match the bundle.');
    }
    if (
        bundle.manifest.liveToolId
        && idOf(managedToolCandidates[0]) !== bundle.manifest.liveToolId
    ) {
        throw new Error('Manifest-pinned Amy tool does not match the managed bundle contract.');
    }
    const attachedFolderIds = tool?.config?.documentFolderIds;
    const sourceFolderIds = sourceTool?.config?.documentFolderIds;
    if (!Array.isArray(attachedFolderIds) || attachedFolderIds.some(id => !UUID_PATTERN.test(id))) {
        throw new Error('Knowledge_Amy has an invalid documentFolderIds configuration.');
    }
    if (!Array.isArray(sourceFolderIds) || sourceFolderIds.some(id => !UUID_PATTERN.test(id))) {
        throw new Error('The source Knowledge_Amy tool has an invalid documentFolderIds configuration.');
    }
    const groups = requireCompleteList(groupPayload, 'knowledge groups');
    if (
        new Set(groups.map(group => group?.id)).size !== groups.length
        || groups.some(group => !UUID_PATTERN.test(group?.id ?? ''))
    ) {
        throw new Error('Anam knowledge group list contains missing or duplicate IDs.');
    }
    const targetGroups = groups.filter(group => group?.name === bundle.manifest.folderName);
    if (targetGroups.length > 1) throw new Error('Multiple Amy versioned target knowledge groups have the same name.');
    if (bundle.manifest.liveGroupId && targetGroups[0]?.id !== bundle.manifest.liveGroupId) {
        throw new Error('Manifest-pinned Amy target group is missing or changed.');
    }
    const snapshotIds = [...new Set([
        ...attachedFolderIds,
        ...sourceFolderIds,
        ...targetGroups.map(group => group.id),
    ])];
    const snapshotGroups = groups.filter(group => snapshotIds.includes(group.id));
    if (snapshotGroups.length !== snapshotIds.length) {
        throw new Error('One or more Knowledge_Amy folder IDs are unavailable.');
    }
    const groupSnapshots = await Promise.all(snapshotGroups.map(group => (
        snapshotKnowledgeGroup(anam, group, { apiKey, fetchImpl })
    )));
    groupSnapshots.sort((left, right) => left.id.localeCompare(right.id));
    const sourceToolUsages = knowledgeToolUsages(personaInventory.details, {
        toolId: PINNED_AMY.sourceKnowledgeToolId,
    });
    const currentToolUsages = knowledgeToolUsages(personaInventory.details, { toolId: currentToolId });
    const previewPersona = personaInventory.details.find(candidate => candidate.id === PINNED_AMY.previewPersonaId);
    if (!previewPersona) throw new Error('Pinned Amy preview persona is unavailable for isolation proof.');
    const groupLandscape = {
        attachedFolderIds: [...attachedFolderIds].sort(),
        sourceFolderIds: [...sourceFolderIds].sort(),
        targetFolderName: bundle.manifest.folderName,
        targetGroupIds: targetGroups.map(group => group.id).sort(),
        groups: groupSnapshots.map(group => ({
            id: group.id,
            name: group.name,
            description: group.description,
            documents: group.documents,
        })),
    };
    return {
        persona,
        tool,
        sourceTool,
        currentToolId,
        managedToolCandidate: managedToolCandidates[0] ?? null,
        personaInventory,
        toolInventory,
        groups,
        targetGroup: targetGroups[0] ?? null,
        groupSnapshots,
        sourceToolUsages,
        currentToolUsages,
        currentToolIsDedicated: isDedicatedAmyKnowledgeTool(currentToolUsages, currentToolId),
        providerStateSha256: hashJson(providerFullView(persona)),
        providerProtectedStateSha256: hashJson(providerProtectedView(persona)),
        previewPersonaStateSha256: hashJson(providerFullView(previewPersona)),
        sourceToolStateSha256: hashJson(toolStateView(sourceTool)),
        toolStateSha256: hashJson(toolStateView(tool)),
        groupStateSha256: hashJson(groupLandscape),
        groupLandscape,
    };
}

export function assertExpectedHash(label, actual, expected) {
    if (!SHA256_PATTERN.test(expected ?? '') || actual !== expected) {
        throw new Error(`${label} does not match the current live state.`);
    }
}

export function describeGroupSnapshot(snapshot) {
    return {
        id: snapshot.id,
        name: snapshot.name,
        description: snapshot.description,
        documentCount: snapshot.documents.length,
        duplicateFilenames: snapshot.duplicateFilenames,
        stateSha256: snapshot.stateSha256,
        documents: snapshot.documents.map(document => ({
            id: document.id,
            filename: document.filename,
            status: document.status,
            bytes: document.bytes,
            sha256: document.sha256,
        })),
    };
}
