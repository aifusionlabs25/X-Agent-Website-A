import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const PROMPT_START = '<!-- AMY_AGENTMAIL_START -->';
const PROMPT_END = '<!-- AMY_AGENTMAIL_END -->';
const personaId = process.env.ANAM_AMY_CARA4_PERSONA_ID?.trim();
const apiKey = process.env.ANAM_API_KEY?.trim();

if (!apiKey || !personaId) {
    throw new Error('ANAM_API_KEY and ANAM_AMY_CARA4_PERSONA_ID are required and are never printed.');
}

const toolDefinition = JSON.parse(await fs.readFile(
    new URL('../../config/anam/amy-agentmail-client-tool.json', import.meta.url),
    'utf8',
));
const promptUpgrade = (await fs.readFile(
    new URL('../../config/anam/amy-agentmail-prompt-upgrade.md', import.meta.url),
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
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
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
    const start = current.indexOf(PROMPT_START);
    const end = current.indexOf(PROMPT_END);
    if (start >= 0 && end > start) {
        const after = end + PROMPT_END.length;
        return `${current.slice(0, start).trim()}\n\n${replacement}${current.slice(after).trim() ? `\n\n${current.slice(after).trim()}` : ''}\n`;
    }
    return `${current}\n\n${replacement}\n`;
}

const [persona, toolListPayload] = await Promise.all([
    anam(`/personas/${personaId}`),
    anam('/tools?perPage=100'),
]);
const allTools = listData(toolListPayload);
const existing = allTools.find(tool => tool.name === toolDefinition.name);
const emailTool = existing && toolId(existing)
    ? await anam(`/tools/${toolId(existing)}`, {
        method: 'PUT',
        body: JSON.stringify(toolDefinition),
    })
    : await anam('/tools', {
        method: 'POST',
        body: JSON.stringify(toolDefinition),
    });
const emailToolId = toolId(emailTool);
if (!emailToolId) throw new Error('Anam did not return an AgentMail client-tool ID.');

const nextToolIds = [...new Set([
    ...(persona.tools ?? []).map(toolId).filter(Boolean),
    emailToolId,
])].sort();
const expectedPrompt = replaceManagedBlock(persona.brain?.systemPrompt, promptUpgrade);

await anam(`/personas/${personaId}`, {
    method: 'PUT',
    body: JSON.stringify({
        systemPrompt: expectedPrompt,
        toolIds: nextToolIds,
    }),
});

const verified = await anam(`/personas/${personaId}`);
const verifiedNames = (verified.tools ?? []).map(tool => tool.name);
const failures = [];
if (!verifiedNames.includes(toolDefinition.name)) failures.push('tool');
if (!String(verified.brain?.systemPrompt ?? '').includes(PROMPT_START)) failures.push('promptStart');
if (!String(verified.brain?.systemPrompt ?? '').includes(PROMPT_END)) failures.push('promptEnd');
if (sha256(verified.brain?.systemPrompt ?? '') !== sha256(expectedPrompt)) failures.push('promptHash');
if (failures.length) throw new Error(`Amy AgentMail verification failed: ${failures.join(', ')}`);

console.log(JSON.stringify({
    personaId: verified.id,
    toolName: toolDefinition.name,
    toolAttached: true,
    promptSha256: sha256(verified.brain?.systemPrompt ?? ''),
    rawEmailIncluded: false,
}, null, 2));
