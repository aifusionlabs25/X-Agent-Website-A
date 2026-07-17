import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const RELIABILITY_START = '<!-- AMY_CARA4_RELIABILITY_START -->';
const RELIABILITY_END = '<!-- AMY_CARA4_RELIABILITY_END -->';
const PUBLIC_SECTOR_START = '<!-- AMY_PUBLIC_SECTOR_START -->';
const PUBLIC_SECTOR_END = '<!-- AMY_PUBLIC_SECTOR_END -->';
const personaId = process.env.ANAM_AMY_CARA4_PERSONA_ID?.trim();
const apiKey = process.env.ANAM_API_KEY?.trim();

if (!apiKey || !personaId) {
    throw new Error('ANAM_API_KEY and ANAM_AMY_CARA4_PERSONA_ID are required and are never printed.');
}

const reliabilityUpgrade = (await fs.readFile(
    new URL('../../config/anam/amy-cara4-reliability-upgrade.md', import.meta.url),
    'utf8',
)).trim();
const publicSectorUpgrade = (await fs.readFile(
    new URL('../../config/anam/amy-public-sector-upgrade.md', import.meta.url),
    'utf8',
)).trim();
const liveIdentityTool = JSON.parse(await fs.readFile(
    new URL('../../config/anam/amy-live-identity-client-tool.json', import.meta.url),
    'utf8',
));

async function anam(pathname, init = {}) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
        },
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
        const detail = (await response.text()).slice(0, 2_000);
        throw new Error(`Anam ${init.method ?? 'GET'} ${pathname} failed (${response.status}): ${detail}`);
    }
    return response.json();
}

function sha256(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function toolId(tool) {
    return tool?._toolId ?? tool?.id ?? null;
}

function listData(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.tools)) return payload.tools;
    return [];
}

function replaceManagedBlock(prompt, startMarker, endMarker, replacement) {
    const current = String(prompt ?? '').trim();
    const start = current.indexOf(startMarker);
    const end = current.indexOf(endMarker);
    if (start >= 0 && end > start) {
        const after = end + endMarker.length;
        return `${current.slice(0, start).trim()}\n\n${replacement}\n${current.slice(after).trim() ? `\n${current.slice(after).trim()}` : ''}`;
    }
    return `${current}\n\n${replacement}\n`;
}

const [persona, toolListPayload] = await Promise.all([
    anam(`/personas/${personaId}`),
    anam('/tools?perPage=100'),
]);
const allTools = listData(toolListPayload);
let identityTool = allTools.find(tool => tool.name === liveIdentityTool.name);
let identityToolCreated = false;

if (identityTool) {
    identityTool = await anam(`/tools/${toolId(identityTool)}`, {
        method: 'PUT',
        body: JSON.stringify(liveIdentityTool),
    });
} else {
    identityTool = await anam('/tools', {
        method: 'POST',
        body: JSON.stringify(liveIdentityTool),
    });
    identityToolCreated = true;
}

const refreshedTools = listData(await anam('/tools?perPage=100'));
const requiredNames = ['confirm_live_identity', 'skip_turn', 'end_call'];
const requiredTools = requiredNames.map(name => {
    const tool = refreshedTools.find(candidate => candidate.name === name);
    if (!toolId(tool)) throw new Error(`Required Anam tool is unavailable: ${name}`);
    return tool;
});
const preservedToolIds = (persona.tools ?? []).map(toolId).filter(Boolean);
const requiredToolIds = requiredTools.map(toolId);
const forbiddenHandoff = refreshedTools.find(tool => tool.name === 'capture_sales_handoff');
const forbiddenHandoffId = toolId(forbiddenHandoff);
const nextToolIds = [...new Set([...preservedToolIds, ...requiredToolIds])]
    .filter(id => id !== forbiddenHandoffId)
    .sort();
const promptWithReliability = replaceManagedBlock(
    persona.brain?.systemPrompt,
    RELIABILITY_START,
    RELIABILITY_END,
    reliabilityUpgrade,
);
const expectedPrompt = replaceManagedBlock(
    promptWithReliability,
    PUBLIC_SECTOR_START,
    PUBLIC_SECTOR_END,
    publicSectorUpgrade,
);
const voiceDetectionOptions = {
    endOfSpeechSensitivity: 0.15,
    silenceBeforeAutoEndTurnSeconds: 1.8,
    silenceBeforeSkipTurnSeconds: 0,
    silenceBeforeSessionEndSeconds: 180,
};

await anam(`/personas/${personaId}`, {
    method: 'PUT',
    body: JSON.stringify({
        systemPrompt: expectedPrompt,
        initialMessage: "Hi, I'm Amy. It's good to meet you. What would be most useful to talk through today?",
        skipGreeting: false,
        uninterruptibleGreeting: false,
        zeroDataRetention: false,
        enableAudioPassthrough: false,
        voiceDetectionOptions,
        toolIds: nextToolIds,
    }),
});

const verified = await anam(`/personas/${personaId}`);
const verifiedToolIds = (verified.tools ?? []).map(toolId).filter(Boolean).sort();
const prompt = verified.brain?.systemPrompt ?? '';
const failures = [];
if (sha256(prompt) !== sha256(expectedPrompt)) failures.push('prompt');
if (!prompt.includes(PUBLIC_SECTOR_START) || !prompt.includes(PUBLIC_SECTOR_END)) failures.push('publicSectorPrompt');
if (verified.initialMessage !== "Hi, I'm Amy. It's good to meet you. What would be most useful to talk through today?") failures.push('initialMessage');
if (verified.skipGreeting !== false) failures.push('skipGreeting');
if (verified.uninterruptibleGreeting !== false) failures.push('uninterruptibleGreeting');
if (verified.zeroDataRetention !== false) failures.push('zeroDataRetention');
if (verified.enableAudioPassthrough !== false) failures.push('enableAudioPassthrough');
if (JSON.stringify(verifiedToolIds) !== JSON.stringify(nextToolIds)) failures.push('tools');
for (const [name, value] of Object.entries(voiceDetectionOptions)) {
    if (verified.voiceDetectionOptions?.[name] !== value) failures.push(`voiceDetectionOptions.${name}`);
}
if (failures.length > 0) {
    throw new Error(`Amy reliability verification failed: ${failures.join(', ')}`);
}

console.log(JSON.stringify({
    personaId: verified.id,
    identityToolId: toolId(identityTool),
    identityToolCreated,
    attachedToolNames: (verified.tools ?? []).map(tool => tool.name).sort(),
    toolCount: verifiedToolIds.length,
    promptSha256: sha256(prompt),
    voiceDetectionOptions: verified.voiceDetectionOptions,
    initialMessageConfigured: Boolean(verified.initialMessage),
    zeroDataRetention: verified.zeroDataRetention,
    enableAudioPassthrough: verified.enableAudioPassthrough,
    publicSectorConfigured: prompt.includes(PUBLIC_SECTOR_START)
        && prompt.includes(PUBLIC_SECTOR_END),
    captureSalesHandoffAttached: forbiddenHandoffId ? verifiedToolIds.includes(forbiddenHandoffId) : false,
}, null, 2));
