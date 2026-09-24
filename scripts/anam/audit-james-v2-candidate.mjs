import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.anam.ai/v1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const releaseDir = path.join(root, 'config', 'anam', 'james', 'v2');
const runtime = JSON.parse(await fs.readFile(path.join(releaseDir, 'runtime-release-manifest.json'), 'utf8'));
const knowledge = JSON.parse(await fs.readFile(path.join(releaseDir, 'knowledge-manifest.json'), 'utf8'));
const apiKey = process.env.ANAM_API_KEY?.trim();

if (!apiKey) throw new Error('ANAM_API_KEY is required. This read-only audit never prints the key.');

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizePrompt(value) {
    return `${String(value ?? '').replace(/\r\n?/g, '\n').trim()}\n`;
}

async function get(pathname) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Anam GET ${pathname} failed with HTTP ${response.status}`);
    return response.json();
}

function toolView(persona) {
    return (persona?.tools ?? [])
        .map(tool => ({ name: tool.name, id: tool._toolId ?? tool.id }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

function check(checks, condition, label) {
    checks[label] = Boolean(condition);
}

const sourceId = runtime.sourcePersona.id;
const priorCanaryId = runtime.priorCanary.id;
const candidateId = runtime.managedPersona.id;
const groupId = runtime.knowledge.documentFolderIds?.[0];
const knowledgeTool = runtime.requiredTools.find(tool => tool.name === runtime.knowledge.toolName);
const [source, prior, candidate, group, tool, documents] = await Promise.all([
    get(`/personas/${encodeURIComponent(sourceId)}`),
    get(`/personas/${encodeURIComponent(priorCanaryId)}`),
    get(`/personas/${encodeURIComponent(candidateId)}`),
    get(`/knowledge/groups/${encodeURIComponent(groupId)}`),
    get(`/tools/${encodeURIComponent(knowledgeTool.id)}`),
    get(`/knowledge/groups/${encodeURIComponent(groupId)}/documents`),
]);
const actualCandidatePromptHash = sha256(normalizePrompt(candidate.brain?.systemPrompt));
const expectedToolNames = runtime.requiredTools.map(item => item.name)
    .sort((left, right) => left.localeCompare(right));
const actualToolNames = toolView(candidate).map(item => item.name);
const expectedDocumentNames = [...knowledge.documents].sort();
const actualDocumentNames = Array.isArray(documents) ? documents.map(item => item.filename).sort() : [];
const checks = {};

check(checks, source.id === sourceId && source.name === runtime.sourcePersona.name, 'source_identity_matches');
check(checks, source.avatarModel === runtime.sourcePersona.avatarModel
    && source.avatar?.id === runtime.sourcePersona.avatarId
    && source.voice?.id === runtime.sourcePersona.voiceId
    && source.llmId === runtime.sourcePersona.llmId
    && source.zeroDataRetention === runtime.sourcePersona.zeroDataRetention
    && sha256(source.brain?.systemPrompt ?? '') === runtime.sourcePersona.promptSha256,
'source_rollback_snapshot_matches');
check(checks, toolView(source).some(item => item.id === runtime.sourcePersona.knowledgeToolId), 'source_tool_unchanged');
check(checks, prior.id === priorCanaryId && prior.name === runtime.priorCanary.name, 'prior_canary_identity_matches');
check(checks, prior.avatarModel === runtime.priorCanary.avatarModel
    && prior.avatar?.id === runtime.priorCanary.avatarId
    && prior.voice?.id === runtime.priorCanary.voiceId
    && prior.llmId === runtime.priorCanary.llmId
    && prior.zeroDataRetention === runtime.priorCanary.zeroDataRetention
    && sha256(prior.brain?.systemPrompt ?? '') === runtime.priorCanary.promptSha256,
'prior_canary_snapshot_matches');
check(checks, candidate.id === candidateId && candidate.name === runtime.managedPersona.name, 'candidate_identity_matches');
check(checks, candidate.avatarModel === runtime.managedPersona.avatarModel
    && candidate.avatar?.id === runtime.managedPersona.avatarId
    && candidate.voice?.id === runtime.managedPersona.voiceId
    && candidate.llmId === runtime.managedPersona.llmId,
'candidate_assets_match_manifest');
check(checks, candidate.zeroDataRetention === runtime.managedPersona.zeroDataRetention, 'candidate_retention_matches_manifest');
check(checks, candidate.enableAudioPassthrough === false, 'audio_passthrough_disabled');
check(checks, actualCandidatePromptHash === runtime.prompt.sha256, 'candidate_prompt_hash_matches');
check(checks, JSON.stringify(actualToolNames) === JSON.stringify(expectedToolNames), 'candidate_tool_names_exact');
check(checks, JSON.stringify(toolView(candidate)) === JSON.stringify(
    runtime.requiredTools.map(item => ({ name: item.name, id: item.id })).sort((left, right) => left.name.localeCompare(right.name)),
), 'candidate_tool_ids_exact');
check(checks, group.id === groupId && group.name === knowledge.folderName
    && group.description === `James-only public-safe KB. Bundle SHA-256: ${knowledge.bundleSha256}`,
'knowledge_group_matches_manifest');
check(checks, tool.id === knowledgeTool.id && tool.name === knowledgeTool.name
    && tool.type === runtime.knowledge.toolType
    && JSON.stringify(tool.config?.documentFolderIds) === JSON.stringify([groupId]),
'knowledge_tool_matches_manifest');
check(checks, Array.isArray(documents)
    && documents.length === expectedDocumentNames.length
    && JSON.stringify(actualDocumentNames) === JSON.stringify(expectedDocumentNames)
    && documents.every(document => document.status === 'READY'),
'knowledge_documents_ready');
check(checks, JSON.stringify((knowledge.liveDocuments ?? []).map(item => item.filename).sort())
    === JSON.stringify(expectedDocumentNames), 'knowledge_document_manifest_exact');

const readbackSnapshot = {
    candidate: {
        id: candidate.id,
        name: candidate.name,
        avatarModel: candidate.avatarModel,
        avatarId: candidate.avatar?.id,
        voiceId: candidate.voice?.id,
        llmId: candidate.llmId,
        zeroDataRetention: candidate.zeroDataRetention,
        enableAudioPassthrough: candidate.enableAudioPassthrough,
        initialMessage: candidate.initialMessage,
        promptSha256: actualCandidatePromptHash,
        tools: toolView(candidate),
    },
    knowledgeGroup: {
        id: group.id,
        name: group.name,
        description: group.description,
    },
    documents: Array.isArray(documents)
        ? documents.map(({ id, filename, status }) => ({ id, filename, status })).sort((left, right) => left.filename.localeCompare(right.filename))
        : [],
};
const readbackSha256 = sha256(JSON.stringify(readbackSnapshot));

console.log(JSON.stringify({
    checks,
    allChecksPassed: Object.values(checks).every(Boolean),
    candidateReadbackSha256: readbackSha256,
    actualCandidatePromptSha256: actualCandidatePromptHash,
    sourcePromptSha256: runtime.sourcePersona.promptSha256,
    priorCanaryPromptSha256: runtime.priorCanary.promptSha256,
    candidateId,
    groupId,
    knowledgeToolId: knowledgeTool.id,
    documentReadiness: Array.isArray(documents)
        ? documents.map(({ id, filename, status }) => ({ id, filename, status })).sort((left, right) => left.filename.localeCompare(right.filename))
        : [],
    privacyGate: runtime.privacyGate.status,
    productionActivation: 'not performed',
}, null, 2));
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
