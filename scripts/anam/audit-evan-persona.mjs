import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const EVAN_ID = '4b7e933a-ea04-4b84-b418-72c0762545e6';
const JAMES_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8';
const TOOL_NAME = 'Knowledge_Evan_Mullins_Moving';
const REQUIRED_TOOLS = [TOOL_NAME, 'skip_turn', 'end_mullins_session', 'send_mullins_follow_up_email'];
const localEnv = await fs.readFile(new URL('../../.env.local', import.meta.url), 'utf8').catch(() => '');
const env = Object.fromEntries(localEnv.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => { const at = line.indexOf('='); return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
const apiKey = process.env.ANAM_API_KEY?.trim() || env.ANAM_API_KEY?.trim();
if (!apiKey) throw new Error('ANAM_API_KEY is required and is never printed.');

const normalizeLineEndings = value => String(value).replace(/\r\n?/g, '\n');
const managedPromptOf = value => `${normalizeLineEndings(value).split('\n# TOOLS\n', 1)[0].trim()}\n`;
const prompt = `${normalizeLineEndings(await fs.readFile(new URL('../../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8')).trim()}\n`;
const manifest = JSON.parse(await fs.readFile(new URL('../../config/anam/evan/knowledge-manifest.json', import.meta.url), 'utf8'));
const personaManifest = JSON.parse(await fs.readFile(new URL('../../config/anam/evan/persona-manifest.json', import.meta.url), 'utf8'));
const sha256 = value => crypto.createHash('sha256').update(normalizeLineEndings(value), 'utf8').digest('hex');
const idOf = value => value?._toolId ?? value?.id ?? null;

async function anam(pathname) {
    const response = await fetch(`${API_BASE}${pathname}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Anam GET ${pathname} failed (${response.status}): ${(await response.text()).slice(0, 1000)}`);
    return response.json();
}

const [evan, james, tools, groups] = await Promise.all([
    anam(`/personas/${EVAN_ID}`),
    anam(`/personas/${JAMES_ID}`),
    anam('/tools?perPage=100'),
    anam('/knowledge/groups'),
]);
const toolList = Array.isArray(tools) ? tools : tools.data ?? tools.tools ?? [];
const groupList = Array.isArray(groups) ? groups : groups.data ?? [];
const knowledgeTool = toolList.find(tool => tool.name === TOOL_NAME);
const group = groupList.find(candidate => candidate.name === manifest.folderName);
if (!group?.id) throw new Error('Managed Evan knowledge folder is missing.');
const documents = await anam(`/knowledge/groups/${group.id}/documents`);
const names = new Set((evan.tools ?? []).map(tool => tool.name));
const failures = [];
if (!/evan/i.test(evan.name) || !/mullins/i.test(evan.name)) failures.push('Evan identity');
if (!/james/i.test(james.name) || !/knowles/i.test(james.name)) failures.push('protected James identity');
if (evan.avatarModel !== 'cara-4') failures.push('Cara 4');
if (sha256(managedPromptOf(evan.brain?.systemPrompt ?? '')) !== sha256(prompt)) failures.push('prompt hash');
if (evan.zeroDataRetention !== false) failures.push('session data retention');
if (evan.enableAudioPassthrough !== false) failures.push('Anam transcription pipeline');
for (const [name, value] of Object.entries(personaManifest.voiceDetectionOptions)) {
    if (evan.voiceDetectionOptions?.[name] !== value) failures.push(`voiceDetectionOptions.${name}`);
}
for (const name of REQUIRED_TOOLS) if (!names.has(name)) failures.push(`tool ${name}`);
if (!idOf(knowledgeTool)) failures.push('managed knowledge tool');
if (JSON.stringify(knowledgeTool?.config?.documentFolderIds ?? []) !== JSON.stringify([group.id])) failures.push('knowledge folder isolation');
const expected = new Set(manifest.documents);
const relevant = documents.filter(document => expected.has(document.filename));
if (relevant.length !== manifest.documents.length || relevant.some(document => document.status !== 'READY')) failures.push('knowledge readiness');
if (failures.length) throw new Error(`Evan live audit failed: ${failures.join(', ')}`);

console.log(JSON.stringify({
    ready: true,
    evanPersonaId: evan.id,
    protectedJamesPersonaId: james.id,
    avatarModel: evan.avatarModel,
    promptSha256: sha256(managedPromptOf(evan.brain.systemPrompt)),
    voiceDetectionOptions: evan.voiceDetectionOptions,
    knowledgeGroupId: group.id,
    knowledgeToolId: idOf(knowledgeTool),
    knowledgeDocuments: relevant.map(document => ({ filename: document.filename, status: document.status })).sort((a, b) => a.filename.localeCompare(b.filename)),
    attachedToolNames: [...names].sort(),
}, null, 2));
