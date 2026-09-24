import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.anam.ai/v1';
const SOURCE_PERSONA_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8';
const PRIOR_CANARY_ID = 'ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const releaseDir = path.join(root, 'config', 'anam', 'james', 'v2');
const runtime = JSON.parse(await fs.readFile(path.join(releaseDir, 'runtime-release-manifest.json'), 'utf8'));
const knowledge = JSON.parse(await fs.readFile(path.join(releaseDir, 'knowledge-manifest.json'), 'utf8'));
const apply = process.argv.includes('--apply');
const apiKey = process.env.ANAM_API_KEY?.trim();
const created = {};

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedPrompt(value) {
    return `${value.replace(/\r\n?/g, '\n').trim()}\n`;
}

async function request(pathname, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body instanceof FormData ? {} : body ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`${method} ${pathname} failed with HTTP ${response.status}`);
    return response.json();
}

function idOfTool(tool) {
    return tool?._toolId ?? tool?.id ?? null;
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function loadAndVerifyBundle() {
    const prompt = await fs.readFile(path.join(releaseDir, runtime.prompt.file), 'utf8');
    assert(sha256(normalizedPrompt(prompt)) === runtime.prompt.sha256, 'Local prompt hash does not match runtime manifest.');
    const documents = [];
    for (const filename of knowledge.documents) {
        const source = await fs.readFile(path.join(releaseDir, 'knowledge', filename), 'utf8');
        const buffer = Buffer.from(source.replace(/\r\n?/g, '\n'), 'utf8');
        const expected = knowledge.documentFingerprints[filename];
        assert(buffer.byteLength === expected.bytes, `${filename} byte count does not match knowledge manifest.`);
        assert(sha256(buffer) === expected.sha256, `${filename} SHA-256 does not match knowledge manifest.`);
        documents.push({ filename, buffer });
    }
    const bundleHashInput = JSON.stringify({
        bundleVersion: knowledge.bundleVersion,
        documents: knowledge.documents.map(filename => ({
            filename,
            ...knowledge.documentFingerprints[filename],
        })),
    });
    assert(sha256(bundleHashInput) === knowledge.bundleSha256, 'Knowledge bundle digest does not match manifest.');
    return { prompt, documents };
}

async function ensureNoSameNameResources() {
    const [groups, tools, personas] = await Promise.all([
        request('/knowledge/groups'),
        request('/tools'),
        request(`/personas?perPage=100&search=${encodeURIComponent(runtime.managedPersona.name)}`),
    ]);
    const groupList = Array.isArray(groups) ? groups : groups?.data ?? [];
    const toolList = Array.isArray(tools) ? tools : tools?.data ?? [];
    const personaList = Array.isArray(personas) ? personas : personas?.data ?? [];
    const matches = {
        groups: groupList.filter(item => item?.name === knowledge.folderName).map(item => item.id),
        tools: toolList.filter(item => item?.name === knowledge.toolName).map(item => item.id),
        personas: personaList.filter(item => item?.name === runtime.managedPersona.name).map(item => item.id),
    };
    assert(!matches.groups.length && !matches.tools.length && !matches.personas.length,
        `A resource with this release name already exists. Inspect before retrying: ${JSON.stringify(matches)}`);
}

async function waitForDocuments(groupId, expectedFilenames) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
        const documents = await request(`/knowledge/groups/${encodeURIComponent(groupId)}/documents`);
        assert(Array.isArray(documents), 'Anam returned an unexpected document-list shape.');
        const exactFiles = documents.filter(document => expectedFilenames.includes(document.filename));
        const failed = exactFiles.filter(document => document.status === 'FAILED');
        if (failed.length) throw new Error(`Anam failed to process ${failed.map(document => document.filename).join(', ')}.`);
        const complete = exactFiles.length === expectedFilenames.length
            && new Set(exactFiles.map(document => document.filename)).size === expectedFilenames.length
            && exactFiles.every(document => document.status === 'READY');
        if (complete) {
            assert(documents.length === expectedFilenames.length, 'New knowledge group contains unexpected documents.');
            return exactFiles.map(({ id, filename, status }) => ({ id, filename, status }));
        }
        await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    throw new Error('Timed out waiting for every James v2 knowledge document to reach READY.');
}

async function main() {
    const { prompt, documents } = await loadAndVerifyBundle();
    if (!apply) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            sourcePersonaId: SOURCE_PERSONA_ID,
            protectedPriorCanaryId: PRIOR_CANARY_ID,
            candidateName: runtime.managedPersona.name,
            knowledgeGroupName: knowledge.folderName,
            toolName: knowledge.toolName,
            documentCount: documents.length,
            productionActivation: 'not performed',
            note: 'Pass --apply to create only new, versioned Anam resources. This script has no PUT or DELETE operations.',
        }, null, 2));
        return;
    }
    assert(apiKey, 'ANAM_API_KEY is required. The script never writes or prints the key.');
    await ensureNoSameNameResources();

    const [source, priorCanary] = await Promise.all([
        request(`/personas/${SOURCE_PERSONA_ID}`),
        request(`/personas/${PRIOR_CANARY_ID}`),
    ]);
    assert(source.id === SOURCE_PERSONA_ID && source.name === 'James Knowles Law Firm', 'James source persona identity changed; refusing to proceed.');
    assert(priorCanary.id === PRIOR_CANARY_ID && priorCanary.name === 'James Knowles Law Firm - Cara 4', 'July canary identity changed; refusing to proceed.');
    assert(source.zeroDataRetention === false, 'Source retention changed; re-audit privacy before preparing this candidate.');
    assert(priorCanary.avatarModel === 'cara-4', 'Prior canary is not the expected Cara 4 model.');
    assert(priorCanary.avatar?.id === source.avatar?.id
        && priorCanary.voice?.id === source.voice?.id
        && priorCanary.llmId === source.llmId, 'Source and prior canary assets differ; explicit model approval is required.');

    const oldKnowledgeTool = priorCanary.tools?.find(tool => tool.name === 'Knowledge_James_Knowles_Law_Firm_2026_07');
    const systemTools = priorCanary.tools?.filter(tool => ['skip_turn', 'end_call'].includes(tool.name)) ?? [];
    assert(oldKnowledgeTool && systemTools.length === 2, 'Prior canary does not have the expected knowledge and system tools.');
    const oldKnowledge = await request(`/tools/${encodeURIComponent(idOfTool(oldKnowledgeTool))}`);
    assert(oldKnowledge.type === 'SERVER_RAG' && oldKnowledge.config?.parameters,
        'Existing versioned knowledge tool does not have the expected SERVER_RAG contract.');

    const group = await request('/knowledge/groups', {
        method: 'POST',
        body: {
            name: knowledge.folderName,
            description: `James-only public-safe KB. Bundle SHA-256: ${knowledge.bundleSha256}`,
        },
    });
    created.knowledgeGroupId = group.id;
    assert(typeof group.id === 'string', 'Anam did not return the new knowledge group ID.');

    for (const document of documents) {
        const form = new FormData();
        form.append('file', new Blob([document.buffer], { type: 'text/markdown' }), document.filename);
        form.append('chunkSize', '1000');
        form.append('chunkOverlap', '200');
        await request(`/knowledge/groups/${encodeURIComponent(group.id)}/documents`, { method: 'POST', body: form });
    }
    const readyDocuments = await waitForDocuments(group.id, knowledge.documents);
    created.documents = readyDocuments;

    const knowledgeTool = await request('/tools', {
        method: 'POST',
        body: {
            name: knowledge.toolName,
            description: 'Search only the James v2 allowlisted public firm facts and approved privacy/intake boundaries. Do not give legal advice or treat a search as an intake submission.',
            type: 'SERVER_RAG',
            config: {
                parameters: oldKnowledge.config.parameters,
                documentFolderIds: [group.id],
            },
        },
    });
    created.knowledgeToolId = knowledgeTool.id;
    assert(knowledgeTool.type === 'SERVER_RAG' && knowledgeTool.config?.documentFolderIds?.[0] === group.id,
        'New knowledge tool did not bind to the isolated James v2 group.');

    const toolIds = [
        ...systemTools.map(idOfTool),
        knowledgeTool.id,
    ];
    assert(new Set(toolIds).size === 3 && toolIds.every(id => typeof id === 'string'), 'James candidate tool IDs are missing or duplicated.');
    const candidate = await request('/personas', {
        method: 'POST',
        body: {
            name: runtime.managedPersona.name,
            description: `Isolated James v2 release candidate. Source persona ${SOURCE_PERSONA_ID}; not production-routed; privacy gate remains closed.`,
            avatarId: source.avatar.id,
            avatarModel: runtime.managedPersona.avatarModel,
            voiceId: source.voice.id,
            llmId: source.llmId,
            systemPrompt: prompt,
            initialMessage: runtime.managedPersona.initialMessage,
            skipGreeting: source.skipGreeting,
            uninterruptibleGreeting: source.uninterruptibleGreeting,
            zeroDataRetention: false,
            enableAudioPassthrough: false,
            languageCode: source.languageCode,
            toolIds,
            ...(source.voiceDetectionOptions ? { voiceDetectionOptions: source.voiceDetectionOptions } : {}),
            ...(source.voiceGenerationOptions ? { voiceGenerationOptions: source.voiceGenerationOptions } : {}),
        },
    });
    created.managedPersonaId = candidate.id;
    assert(typeof candidate.id === 'string', 'Anam did not return the new candidate persona ID.');

    const [personaReadback, toolReadback, groupReadback, documentReadback] = await Promise.all([
        request(`/personas/${encodeURIComponent(candidate.id)}`),
        request(`/tools/${encodeURIComponent(knowledgeTool.id)}`),
        request(`/knowledge/groups/${encodeURIComponent(group.id)}`),
        request(`/knowledge/groups/${encodeURIComponent(group.id)}/documents`),
    ]);
    const actualPromptHash = sha256(normalizedPrompt(personaReadback.brain?.systemPrompt ?? ''));
    const actualToolNames = (personaReadback.tools ?? []).map(tool => tool.name).sort();
    const expectedToolNames = [knowledge.toolName, 'skip_turn', 'end_call'].sort();
    const mismatches = [];
    if (personaReadback.id !== candidate.id) mismatches.push('persona_id');
    if (personaReadback.avatarModel !== 'cara-4') mismatches.push('avatar_model');
    if (personaReadback.avatar?.id !== source.avatar?.id) mismatches.push('avatar_id');
    if (personaReadback.voice?.id !== source.voice?.id) mismatches.push('voice_id');
    if (personaReadback.llmId !== source.llmId) mismatches.push('llm_id');
    if (personaReadback.zeroDataRetention !== false) mismatches.push('zero_data_retention');
    if (personaReadback.enableAudioPassthrough !== false) mismatches.push('audio_passthrough');
    if (actualPromptHash !== runtime.prompt.sha256) mismatches.push('prompt_hash');
    if (JSON.stringify(actualToolNames) !== JSON.stringify(expectedToolNames)) mismatches.push('tool_names');
    if (toolReadback.id !== knowledgeTool.id
        || toolReadback.config?.documentFolderIds?.length !== 1
        || toolReadback.config.documentFolderIds[0] !== group.id) mismatches.push('rag_tool_group');
    if (groupReadback.id !== group.id || groupReadback.name !== knowledge.folderName) mismatches.push('knowledge_group');
    if (!Array.isArray(documentReadback)
        || documentReadback.length !== knowledge.documents.length
        || documentReadback.some(document => document.status !== 'READY')) mismatches.push('knowledge_documents');

    console.log(JSON.stringify({
        createdResources: created,
        runtimeReadback: {
            candidateId: candidate.id,
            avatarModel: personaReadback.avatarModel,
            avatarMatchesSource: personaReadback.avatar?.id === source.avatar?.id,
            voiceMatchesSource: personaReadback.voice?.id === source.voice?.id,
            llmMatchesSource: personaReadback.llmId === source.llmId,
            zeroDataRetention: personaReadback.zeroDataRetention,
            promptHashMatches: actualPromptHash === runtime.prompt.sha256,
            attachedToolNames: actualToolNames,
            documentStatuses: Array.isArray(documentReadback)
                ? documentReadback.map(document => ({ filename: document.filename, status: document.status }))
                : [],
            mismatches,
        },
        productionActivation: 'not performed',
        oldSourceOrCanaryMutated: false,
        shareLinkCreated: false,
        privacyGateRemainsClosed: true,
    }, null, 2));
    if (mismatches.length) process.exitCode = 1;
}

try {
    await main();
} catch (error) {
    console.error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        partialResourcesCreated: created,
        oldSourceOrCanaryMutated: false,
        productionActivation: 'not performed',
        note: 'This create-only workflow performs no automatic deletion or rollback. Inspect the listed partial IDs before retrying.',
    }, null, 2));
    process.exitCode = 1;
}
