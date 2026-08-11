import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const EXPECTED_PERSONA_ID = '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08';

const localEnv = await fs.readFile(new URL('../../.env.local', import.meta.url), 'utf8').catch(() => '');
const env = Object.fromEntries(
    localEnv
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
            const at = line.indexOf('=');
            return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
        }),
);
const apiKey = process.env.ANAM_API_KEY?.trim() || env.ANAM_API_KEY?.trim();
const personaId = process.env.ANAM_AMY_CARA4_PERSONA_ID?.trim()
    || env.ANAM_AMY_CARA4_PERSONA_ID?.trim();

if (!apiKey) throw new Error('ANAM_API_KEY is required and is never printed.');
if (personaId !== EXPECTED_PERSONA_ID) {
    throw new Error('Refusing audit: configured Amy persona ID is not the pinned Cara 4 identity.');
}

const response = await fetch(`${API_BASE}/personas/${personaId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
    throw new Error(`Anam persona audit failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
}

const persona = await response.json();
const prompt = String(persona.brain?.systemPrompt ?? '');
const knowledgeTool = (persona.tools ?? []).find(tool => tool.name === 'Knowledge_Amy');
const markers = [...prompt.matchAll(/<!--\s*([^>]+?)\s*-->/g)].map(match => match[1]);
const managedSections = [...prompt.matchAll(/<!--\s*([^>]+?)\s*-->/g)].map(match => ({
    marker: match[1],
    characterOffset: match.index,
}));
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

console.log(JSON.stringify({
    personaId: persona.id,
    name: persona.name,
    avatarModel: persona.avatarModel,
    avatarId: persona.avatar?.id ?? null,
    voiceId: persona.voice?.id ?? null,
    llmId: persona.llmId ?? null,
    promptChars: prompt.length,
    promptWords: prompt.trim() ? prompt.trim().split(/\s+/).length : 0,
    promptSha256: sha256(prompt),
    managedPromptMarkers: markers,
    managedSections,
    legacyBehaviorHeaderOffset: prompt.indexOf('# Amy Cara 4 behavior upgrade'),
    legacyThreeFactRulePresent: /at least three confirmed facts/i.test(prompt),
    toolNames: (persona.tools ?? []).map(tool => tool.name).sort(),
    knowledgeTool: knowledgeTool ? {
        id: knowledgeTool._toolId ?? knowledgeTool.id ?? null,
        type: knowledgeTool.type ?? null,
        documentFolderIds: knowledgeTool.config?.documentFolderIds ?? [],
    } : null,
    initialMessage: persona.initialMessage ?? null,
    voiceDetectionOptions: persona.voiceDetectionOptions ?? null,
    zeroDataRetention: persona.zeroDataRetention ?? null,
    enableAudioPassthrough: persona.enableAudioPassthrough ?? null,
}, null, 2));
