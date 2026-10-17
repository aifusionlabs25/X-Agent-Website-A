import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CANDIDATE_ID = '6097c73e-b6ef-48c5-94c7-9a95d4863b99';
export const CANDIDATE_NAME = 'Evan Mullins Moving Concierge - Replacement Candidate';
const API_BASE = 'https://api.anam.ai/v1';
const PERSONA_PATH = `/personas/${CANDIDATE_ID}`;
// Official API: https://anam.ai/docs/api-reference/sessions/list-sessions
export const ACTIVE_SESSIONS_PATH = `/sessions?personaId=${CANDIDATE_ID}&active=true&perPage=100`;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const normalizePrompt = value => `${String(value).replace(/\r\n?/g, '\n').trim()}\n`;
// Anam appends its own tool instructions; the local manifest owns only this prefix.
export const managedPromptOf = value => normalizePrompt(String(value).replace(/\r\n?/g, '\n').split('\n# TOOLS\n', 1)[0]);
export const promptSha256 = value => crypto.createHash('sha256').update(normalizePrompt(value), 'utf8').digest('hex');
const toolId = tool => tool?._toolId ?? tool?.id ?? null;

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
}

function same(left, right) {
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function parseArgs(args) {
    if (args.some(arg => arg !== '--apply' && arg !== '--help') || new Set(args).size !== args.length) {
        throw new Error('Only --apply or --help are supported. Dry-run is the default.');
    }
    return { apply: args.includes('--apply'), help: args.includes('--help') };
}

export function validateManifest(manifest, prompt) {
    if (manifest?.personaId !== CANDIDATE_ID || manifest?.expectedName !== CANDIDATE_NAME) {
        throw new Error('Refusing update: manifest must pin the 6097 Evan replacement candidate and exact name.');
    }
    if (!prompt.trim() || !/^[a-f0-9]{64}$/.test(manifest.expectedPromptSha256 ?? '')
        || promptSha256(prompt) !== manifest.expectedPromptSha256) {
        throw new Error('Refusing update: local prompt does not match the manifest SHA-256.');
    }
    if (managedPromptOf(prompt) !== normalizePrompt(prompt)) {
        throw new Error('Refusing update: the local prompt must not contain Anam-generated # TOOLS instructions.');
    }
    for (const field of ['expectedAvatarModel', 'expectedAvatarId', 'expectedVoiceId', 'expectedLlmId']) {
        if (typeof manifest[field] !== 'string' || !manifest[field]) throw new Error(`Manifest is missing ${field}.`);
    }
    if (!manifest.voiceDetectionOptions || !Object.keys(manifest.voiceDetectionOptions).length
        || !Array.isArray(manifest.requiredToolNames) || !manifest.requiredToolNames.length
        || manifest.requiredToolNames.some(name => !manifest.toolIds?.[name])) {
        throw new Error('Manifest speech settings or tool pins are incomplete.');
    }
}

export function validateCandidate(persona, manifest) {
    const failures = [];
    if (persona?.id !== CANDIDATE_ID) failures.push('persona ID');
    if (persona?.name !== CANDIDATE_NAME) failures.push('persona name');
    if (persona?.avatarModel !== manifest.expectedAvatarModel) failures.push('avatar model');
    if ((persona?.avatar?.id ?? persona?.avatarId) !== manifest.expectedAvatarId) failures.push('avatar ID');
    if ((persona?.voice?.id ?? persona?.voice?.voiceId ?? persona?.voiceId) !== manifest.expectedVoiceId) failures.push('voice ID');
    if ((persona?.brain?.llm?.id ?? persona?.brain?.llmId ?? persona?.llm?.id ?? persona?.llmId) !== manifest.expectedLlmId) failures.push('LLM ID');
    for (const [name, value] of Object.entries(manifest.voiceDetectionOptions)) {
        if (persona?.voiceDetectionOptions?.[name] !== value) failures.push(`voiceDetectionOptions.${name}`);
    }
    if (persona?.zeroDataRetention !== manifest.zeroDataRetention) failures.push('data retention');
    if (persona?.enableAudioPassthrough !== manifest.enableAudioPassthrough) failures.push('audio passthrough');
    const tools = persona?.tools;
    if (!Array.isArray(tools) || tools.length !== manifest.requiredToolNames.length
        || manifest.requiredToolNames.some(name => tools.filter(tool => tool.name === name && toolId(tool) === manifest.toolIds[name]).length !== 1)) {
        failures.push('tool pins');
    }
    if (typeof persona?.brain?.systemPrompt !== 'string' || !persona.brain.systemPrompt.trim()) failures.push('existing prompt');
    if (failures.length) throw new Error(`Refusing update: candidate validation failed (${failures.join(', ')}).`);
}

export function preservedConfiguration(persona) {
    const brain = { ...(persona.brain ?? {}) };
    delete brain.systemPrompt;
    const fields = ['id', 'name', 'avatarModel', 'avatar', 'avatarId', 'voice', 'voiceId', 'llm', 'llmId',
        'initialMessage', 'skipGreeting', 'uninterruptibleGreeting', 'voiceDetectionOptions',
        'voiceGenerationOptions', 'zeroDataRetention', 'enableAudioPassthrough', 'languageCode'];
    return canonical({
        ...Object.fromEntries(fields.map(field => [field, persona[field] ?? null])),
        brain,
        tools: [...(persona.tools ?? [])].sort((a, b) => String(toolId(a)).localeCompare(String(toolId(b)))),
    });
}

export function assertNoActiveSessions(payload) {
    if (!Array.isArray(payload?.data) || !Number.isInteger(payload?.meta?.total) || payload.meta.total < 0) {
        throw new Error('Refusing update: active-session response is invalid; no safe idle state was established.');
    }
    if (payload.meta.total !== 0 || payload.data.length !== 0 || payload.meta.next != null) {
        throw new Error('Refusing update: candidate sessions may still be active. End them and retry.');
    }
}

export function createAnamRequest(apiKey, fetchImpl = fetch) {
    if (!apiKey?.trim()) throw new Error('ANAM_API_KEY is required and is never printed.');
    return async (pathname, init = {}) => {
        const method = init.method ?? 'GET';
        if (!((method === 'GET' && [PERSONA_PATH, ACTIVE_SESSIONS_PATH].includes(pathname))
            || (method === 'PUT' && pathname === PERSONA_PATH))) {
            throw new Error('Refusing request outside the candidate prompt-update scope.');
        }
        if (method === 'PUT') {
            let body;
            try { body = JSON.parse(init.body); } catch { throw new Error('Prompt update body must be JSON.'); }
            if (!body || typeof body !== 'object' || Array.isArray(body)
                || !same(Object.keys(body), ['systemPrompt']) || typeof body.systemPrompt !== 'string' || !body.systemPrompt.trim()) {
                throw new Error('Only systemPrompt may be changed by this updater.');
            }
        }
        let response;
        try {
            response = await fetchImpl(`${API_BASE}${pathname}`, {
                method,
                ...(init.body ? { body: init.body } : {}),
                headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json',
                    ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
                signal: AbortSignal.timeout(30_000),
                redirect: 'error',
                cache: 'no-store',
            });
        } catch {
            throw new Error(`Anam ${method} request failed or timed out. No automatic write retry was attempted.`);
        }
        // Deliberately exclude response bodies and raw transport errors from logs.
        if (!response.ok) throw new Error(`Anam ${method} request failed (HTTP ${response.status}).`);
        if (response.status === 204) return null;
        try { return await response.json(); } catch { throw new Error(`Anam ${method} response was not valid JSON.`); }
    };
}

export async function savePersonaBackup(persona, { fsImpl = fs, root = ROOT, now = () => new Date(), uuid = crypto.randomUUID } = {}) {
    const directory = path.join(root, 'work', 'evan-6097-promotion');
    await fsImpl.mkdir(directory, { recursive: true });
    const capturedAt = now().toISOString();
    const backupPath = path.join(directory, `prompt-before-${capturedAt.replace(/[:.]/g, '-')}-${uuid()}.json`);
    await fsImpl.writeFile(backupPath, `${JSON.stringify({ capturedAt, persona }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return backupPath;
}

export async function updateEvanPrompt({ manifest, prompt, apply = false, request, saveBackup = savePersonaBackup,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), verifyDelays = [0, 2_000, 5_000] }) {
    validateManifest(manifest, prompt);
    const nextPrompt = normalizePrompt(prompt);
    const before = await request(PERSONA_PATH);
    validateCandidate(before, manifest);
    assertNoActiveSessions(await request(ACTIVE_SESSIONS_PATH));
    const currentHash = promptSha256(managedPromptOf(before.brain.systemPrompt));
    const plan = { mode: apply ? 'apply' : 'dry-run', personaId: CANDIDATE_ID,
        currentPromptSha256: currentHash, expectedPromptSha256: manifest.expectedPromptSha256,
        promptChangeRequired: currentHash !== manifest.expectedPromptSha256, activeCandidateSessions: 0,
        mutationFields: ['systemPrompt'], otherPersonasChanged: false, toolsChanged: false };
    if (!apply || !plan.promptChangeRequired) return { ...plan, applied: false };
    if (!Array.isArray(verifyDelays) || !verifyDelays.length || verifyDelays.some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error('Read-back verification delays are invalid.');
    }

    const preserved = preservedConfiguration(before);
    const backupPath = await saveBackup(before);
    if (!backupPath) throw new Error('Refusing update: backup was not saved.');
    // Recheck immediately before the single write. This is not a provider-side lock;
    // the operator must keep the candidate idle throughout the maintenance window.
    assertNoActiveSessions(await request(ACTIVE_SESSIONS_PATH));
    const latest = await request(PERSONA_PATH);
    validateCandidate(latest, manifest);
    if (!same(preservedConfiguration(latest), preserved)
        || promptSha256(managedPromptOf(latest.brain.systemPrompt)) !== currentHash) {
        throw new Error('Refusing update: the candidate changed after the backup. Review the concurrent change and retry.');
    }
    await request(PERSONA_PATH, { method: 'PUT', body: JSON.stringify({ systemPrompt: nextPrompt }) });
    let verified = false;
    for (const delay of verifyDelays) {
        if (delay) await sleep(delay);
        const after = await request(PERSONA_PATH);
        validateCandidate(after, manifest);
        if (!same(preservedConfiguration(after), preserved)) {
            throw new Error('Prompt was submitted, but non-prompt configuration changed. Stop and review the saved backup; no automatic rollback was attempted.');
        }
        verified = promptSha256(managedPromptOf(after.brain.systemPrompt)) === manifest.expectedPromptSha256;
        if (verified && delay === verifyDelays.at(-1)) break;
    }
    if (!verified) throw new Error('Prompt was submitted, but the final read-back hash did not match. Review the saved backup; no automatic rollback was attempted.');
    return { ...plan, applied: true, backupPath, verified: true, preservedConfigurationVerified: true };
}

export async function main(args = process.argv.slice(2)) {
    const options = parseArgs(args);
    if (options.help) {
        console.log('Usage: node scripts/anam/update-evan-prompt.mjs [--apply]\nDry-run by default. Applies only the pinned Evan candidate systemPrompt after an idle-session check and local backup.');
        return;
    }
    const localEnv = await fs.readFile(path.join(ROOT, '.env.local'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw new Error('Could not read the local environment file.');
    });
    const localKey = localEnv.split(/\r?\n/).map(line => line.trim()).find(line => /^ANAM_API_KEY\s*=/.test(line));
    const apiKey = process.env.ANAM_API_KEY?.trim() || localKey?.slice(localKey.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'config', 'anam', 'evan', 'persona-manifest.json'), 'utf8'));
    if (manifest.promptFile !== 'EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md') throw new Error('Unexpected managed Evan prompt file.');
    const prompt = await fs.readFile(path.join(ROOT, 'config', 'anam', 'evan', manifest.promptFile), 'utf8');
    console.log(JSON.stringify(await updateEvanPrompt({ manifest, prompt, apply: options.apply, request: createAnamRequest(apiKey) }), null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
