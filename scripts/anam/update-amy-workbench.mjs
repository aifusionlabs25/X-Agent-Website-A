import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const WORKBENCH_START = '<!-- AMY_WORKBENCH_START -->';
const WORKBENCH_END = '<!-- AMY_WORKBENCH_END -->';
const personaId = process.env.ANAM_AMY_CARA4_PERSONA_ID?.trim();
const apiKey = process.env.ANAM_API_KEY?.trim();

if (!apiKey || !personaId) {
    throw new Error('ANAM_API_KEY and ANAM_AMY_CARA4_PERSONA_ID are required and are never printed.');
}

const toolDefinitions = JSON.parse(await fs.readFile(
    new URL('../../config/anam/amy-workbench-client-tools.json', import.meta.url),
    'utf8',
));
const promptUpgrade = (await fs.readFile(
    new URL('../../config/anam/amy-workbench-prompt-upgrade.md', import.meta.url),
    'utf8',
)).trim();

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

function replaceManagedBlock(prompt, replacement) {
    const current = String(prompt ?? '').trim();
    const start = current.indexOf(WORKBENCH_START);
    const end = current.indexOf(WORKBENCH_END);
    if (start >= 0 && end > start) {
        const after = end + WORKBENCH_END.length;
        const tail = current.slice(after).trim();
        return `${current.slice(0, start).trim()}\n\n${replacement}${tail ? `\n\n${tail}` : ''}\n`;
    }
    return `${current}\n\n${replacement}\n`;
}

const [persona, toolListPayload] = await Promise.all([
    anam(`/personas/${personaId}`),
    anam('/tools?perPage=100'),
]);
const allTools = listData(toolListPayload);
const createdNames = [];
const updatedNames = [];

for (const definition of toolDefinitions) {
    const existing = allTools.find((tool) => tool.name === definition.name);
    if (existing && toolId(existing)) {
        await anam(`/tools/${toolId(existing)}`, {
            method: 'PUT',
            body: JSON.stringify(definition),
        });
        updatedNames.push(definition.name);
    } else {
        await anam('/tools', {
            method: 'POST',
            body: JSON.stringify(definition),
        });
        createdNames.push(definition.name);
    }
}

const refreshedTools = listData(await anam('/tools?perPage=100'));
const workbenchNames = toolDefinitions.map((tool) => tool.name);
const workbenchTools = workbenchNames.map((name) => {
    const tool = refreshedTools.find((candidate) => candidate.name === name);
    if (!toolId(tool)) throw new Error(`Required Anam workbench tool is unavailable: ${name}`);
    return tool;
});
const forbiddenHandoff = refreshedTools.find((tool) => tool.name === 'capture_sales_handoff');
const forbiddenHandoffId = toolId(forbiddenHandoff);
const nextToolIds = [...new Set([
    ...(persona.tools ?? []).map(toolId).filter(Boolean),
    ...workbenchTools.map(toolId),
])].filter((id) => id !== forbiddenHandoffId).sort();
const expectedPrompt = replaceManagedBlock(persona.brain?.systemPrompt, promptUpgrade);

await anam(`/personas/${personaId}`, {
    method: 'PUT',
    body: JSON.stringify({
        systemPrompt: expectedPrompt,
        toolIds: nextToolIds,
    }),
});

const verified = await anam(`/personas/${personaId}`);
const verifiedToolIds = (verified.tools ?? []).map(toolId).filter(Boolean).sort();
const verifiedToolNames = (verified.tools ?? []).map((tool) => tool.name).sort();
const verifiedPrompt = String(verified.brain?.systemPrompt ?? '');
const failures = [];
if (sha256(verifiedPrompt) !== sha256(expectedPrompt)) failures.push('prompt');
if (!verifiedPrompt.includes(WORKBENCH_START) || !verifiedPrompt.includes(WORKBENCH_END)) failures.push('promptMarkers');
if (JSON.stringify(verifiedToolIds) !== JSON.stringify(nextToolIds)) failures.push('tools');
for (const name of workbenchNames) {
    if (!verifiedToolNames.includes(name)) failures.push(`tool.${name}`);
}
if (forbiddenHandoffId && verifiedToolIds.includes(forbiddenHandoffId)) failures.push('capture_sales_handoff');
if (failures.length) throw new Error(`Amy Workbench verification failed: ${failures.join(', ')}`);

console.log(JSON.stringify({
    personaId: verified.id,
    createdNames,
    updatedNames,
    attachedToolNames: verifiedToolNames,
    toolCount: verifiedToolIds.length,
    promptSha256: sha256(verifiedPrompt),
    workbenchPromptConfigured: true,
    captureSalesHandoffAttached: false,
}, null, 2));
