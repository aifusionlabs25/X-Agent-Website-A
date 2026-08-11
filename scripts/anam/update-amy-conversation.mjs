import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installAmyConversationBlock } from './amy-conversation-prompt.mjs';

const API_BASE = 'https://api.anam.ai/v1';
const APPLY_CONFIRMATION = 'CONFIRM_AMY_CONVERSATION_SYNC';
const REQUIRED_EXISTING_MARKERS = [
    '<!-- AMY_CARA4_RELIABILITY_START -->',
    '<!-- AMY_CARA4_RELIABILITY_END -->',
    '<!-- AMY_PUBLIC_SECTOR_START -->',
    '<!-- AMY_PUBLIC_SECTOR_END -->',
    '<!-- AMY_WORKBENCH_START -->',
    '<!-- AMY_WORKBENCH_END -->',
    '<!-- AMY_AGENTMAIL_START -->',
    '<!-- AMY_AGENTMAIL_END -->',
];
const PINNED_IDENTITY = Object.freeze({
    id: '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08',
    name: 'Amy Insight SDR - Cara 4 Canary',
    avatarId: '36e17abf-ef6c-4bef-99bd-3f925da155eb',
    avatarModel: 'cara-4',
    voiceId: 'b138c2a2-ba66-4887-95d5-1a57093fc92d',
    llmId: 'a7cf662c-2ace-4de1-a21e-ef0fbf144bb7',
});
const normalize = value => String(value ?? '').replace(/\r\n?/g, '\n');
const sha256 = value => crypto.createHash('sha256').update(normalize(value), 'utf8').digest('hex');
const toolId = tool => tool?._toolId ?? tool?.id ?? null;
const readOption = name => process.argv.slice(2)
    .find(argument => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

const localEnv = await fs.readFile(new URL('../../.env.local', import.meta.url), 'utf8').catch(() => '');
const env = Object.fromEntries(localEnv.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
    }));
const apiKey = process.env.ANAM_API_KEY?.trim() || env.ANAM_API_KEY?.trim();
const personaId = process.env.ANAM_AMY_CARA4_PERSONA_ID?.trim()
    || env.ANAM_AMY_CARA4_PERSONA_ID?.trim();
if (!apiKey) throw new Error('ANAM_API_KEY is required and is never printed.');
if (personaId !== PINNED_IDENTITY.id) {
    throw new Error('Refusing update: configured Amy persona ID is not the pinned Cara 4 identity.');
}

async function anam(pathname, init = {}) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
        throw new Error(`Anam ${init.method ?? 'GET'} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }
    return response.json();
}

function protectedState(persona) {
    return {
        id: persona.id,
        name: persona.name,
        avatarId: persona.avatar?.id ?? null,
        avatarModel: persona.avatarModel,
        voiceId: persona.voice?.id ?? null,
        llmId: persona.llmId ?? null,
        toolIds: (persona.tools ?? []).map(toolId).filter(Boolean).sort(),
        toolNames: (persona.tools ?? []).map(tool => tool.name).sort(),
        initialMessage: persona.initialMessage ?? null,
        voiceDetectionOptions: persona.voiceDetectionOptions ?? null,
        zeroDataRetention: persona.zeroDataRetention ?? null,
        enableAudioPassthrough: persona.enableAudioPassthrough ?? null,
    };
}

function assertIdentity(persona) {
    const actual = protectedState(persona);
    for (const [key, expected] of Object.entries(PINNED_IDENTITY)) {
        if (actual[key] !== expected) throw new Error(`Refusing update: Amy ${key} does not match the pinned identity.`);
    }
    const prompt = normalize(persona.brain?.systemPrompt);
    const missing = REQUIRED_EXISTING_MARKERS.filter(marker => !prompt.includes(marker));
    if (missing.length) throw new Error(`Refusing update: Amy is missing ${missing.length} required managed prompt markers.`);
}

const upgrade = (await fs.readFile(
    new URL('../../config/anam/amy-conversation-naturalness-upgrade.md', import.meta.url),
    'utf8',
)).trim();
const before = await anam(`/personas/${personaId}`);
assertIdentity(before);
const beforePrompt = normalize(before.brain?.systemPrompt);
const expectedPrompt = installAmyConversationBlock(beforePrompt, upgrade);
const beforeHash = sha256(beforePrompt);
const expectedHash = sha256(expectedPrompt);
const applying = process.argv.includes('--apply');

if (!applying) {
    console.log(JSON.stringify({
        mode: 'dry-run',
        personaId,
        beforePromptSha256: beforeHash,
        expectedPromptSha256: expectedHash,
        promptChanged: beforeHash !== expectedHash,
        currentPromptChars: beforePrompt.length,
        expectedPromptChars: expectedPrompt.length,
        protectedState: protectedState(before),
        applyConfirmation: APPLY_CONFIRMATION,
    }, null, 2));
} else {
if (readOption('confirm') !== APPLY_CONFIRMATION) {
    throw new Error(`Refusing live update: pass --confirm=${APPLY_CONFIRMATION}.`);
}
const expectedCurrentHash = readOption('expected-current-sha256');
if (!expectedCurrentHash || expectedCurrentHash !== beforeHash) {
    throw new Error('Refusing live update: --expected-current-sha256 must match the freshly fetched Amy prompt.');
}
const backupDir = readOption('backup-dir');
if (!backupDir) throw new Error('Refusing live update: --backup-dir is required.');
await fs.mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.resolve(backupDir, `amy-cara4-pre-conversation-sync-${stamp}.json`);
await fs.writeFile(backupPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), persona: before }, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
});

await anam(`/personas/${personaId}`, {
    method: 'PUT',
    body: JSON.stringify({ systemPrompt: expectedPrompt }),
});
const after = await anam(`/personas/${personaId}`);
assertIdentity(after);
const afterPrompt = normalize(after.brain?.systemPrompt);
if (sha256(afterPrompt) !== expectedHash) throw new Error('Amy live prompt verification failed.');
if (JSON.stringify(protectedState(after)) !== JSON.stringify(protectedState(before))) {
    throw new Error('Amy protected provider configuration changed during prompt update.');
}

console.log(JSON.stringify({
    mode: 'applied-and-verified',
    personaId,
    backupPath,
    beforePromptSha256: beforeHash,
    afterPromptSha256: sha256(afterPrompt),
    protectedConfigurationUnchanged: true,
}, null, 2));
}
