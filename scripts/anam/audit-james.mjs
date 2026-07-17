import crypto from 'node:crypto';

const API_BASE = 'https://api.anam.ai/v1';
const DEFAULT_PERSONA_ID = 'ff9c480e-44d1-4a8c-8ae6-b5666fd2a92d';
const personaId = process.env.ANAM_JAMES_PERSONA_ID?.trim() || DEFAULT_PERSONA_ID;
const apiKey = process.env.ANAM_API_KEY?.trim();

if (!apiKey) {
    throw new Error('ANAM_API_KEY is required and is never printed.');
}

async function anam(pathname) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
        const detail = (await response.text()).slice(0, 1_000);
        throw new Error(`Anam GET ${pathname} failed (${response.status}): ${detail}`);
    }
    return response.json();
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function toolId(tool) {
    return tool?._toolId ?? tool?.id ?? null;
}

const [persona, groups] = await Promise.all([
    anam(`/personas/${personaId}`),
    anam('/knowledge/groups'),
]);

const attachedKnowledgeGroupIds = [...new Set(
    (persona.tools ?? [])
        .flatMap(tool => tool?.config?.documentFolderIds ?? tool?.documentFolderIds ?? [])
        .filter(Boolean),
)];
const knowledgeGroups = [];

for (const groupId of attachedKnowledgeGroupIds) {
    const group = Array.isArray(groups) ? groups.find(candidate => candidate.id === groupId) : null;
    const documents = await anam(`/knowledge/groups/${groupId}/documents`);
    knowledgeGroups.push({
        id: groupId,
        name: group?.name ?? null,
        description: group?.description ?? null,
        documentCount: group?.documentCount ?? documents.length,
        documents: documents.map(document => ({
            id: document.id,
            filename: document.filename,
            fileType: document.fileType,
            fileSize: document.fileSize,
            status: document.status,
            updatedAt: document.updatedAt,
        })),
    });
}

const prompt = String(persona.brain?.systemPrompt ?? '');
console.log(JSON.stringify({
    persona: {
        id: persona.id,
        name: persona.name,
        description: persona.description ?? null,
        avatarId: persona.avatar?.id ?? null,
        avatarModel: persona.avatarModel ?? null,
        avatarActiveVersion: persona.avatar?.activeVersion ?? null,
        avatarAvailableVersions: persona.avatar?.availableVersions ?? [],
        voiceId: persona.voice?.id ?? null,
        voiceName: persona.voice?.displayName ?? null,
        llmId: persona.llmId ?? null,
        initialMessage: persona.initialMessage ?? null,
        skipGreeting: persona.skipGreeting ?? null,
        uninterruptibleGreeting: persona.uninterruptibleGreeting ?? null,
        zeroDataRetention: persona.zeroDataRetention ?? null,
        voiceDetectionOptions: persona.voiceDetectionOptions ?? null,
        promptCharacters: prompt.length,
        promptSha256: sha256(prompt),
        promptSignals: {
            criminalDefense: /criminal defense/i.test(prompt),
            dui: /\bDUI\b/i.test(prompt),
            personalInjury: /personal injury/i.test(prompt),
            legalAdviceBoundary: /legal advice|not (?:a|your) lawyer/i.test(prompt),
            aiDisclosure: /\bAI\b|artificial intelligence/i.test(prompt),
            tavusSpecific: /tavus|replica|conversation_id/i.test(prompt),
            anamSpecific: /anam/i.test(prompt),
        },
    },
    tools: (persona.tools ?? []).map(tool => ({
        id: toolId(tool),
        name: tool.name,
        type: tool.type,
        description: tool.description ?? null,
        documentFolderIds: tool?.config?.documentFolderIds ?? tool?.documentFolderIds ?? [],
    })),
    knowledgeGroups,
}, null, 2));
