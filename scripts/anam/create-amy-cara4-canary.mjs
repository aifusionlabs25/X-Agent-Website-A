import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const SOURCE_PERSONA_ID = '8c7d5b42-b17e-4321-8bfa-381c8d93820f';
const CANARY_NAME = 'Amy Insight SDR - Cara 4 Canary';
const CANARY_MODEL = 'cara-4';
const DESCRIPTION_MARKER = `Source persona: ${SOURCE_PERSONA_ID}`;
const apiKey = process.env.ANAM_API_KEY?.trim();

if (!apiKey) {
    throw new Error('ANAM_API_KEY is required. The script never writes or prints the key.');
}

const behaviorUpgrade = (await fs.readFile(
    new URL('../../config/anam/amy-cara4-behavior-upgrade.md', import.meta.url),
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
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Anam ${init.method ?? 'GET'} ${pathname} failed (${response.status}): ${detail}`);
    }

    return response.json();
}

function sha256(value) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function compactObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return Object.keys(value).length > 0 ? value : undefined;
}

function sortedToolIds(persona) {
    return (persona.tools ?? [])
        .map(tool => tool._toolId ?? tool.id)
        .filter(Boolean)
        .sort();
}

function assertCanaryMatches({ source, canary, expectedPrompt }) {
    const checks = [
        ['avatar model', canary.avatarModel, CANARY_MODEL],
        ['avatar ID', canary.avatar?.id, source.avatar?.id],
        ['voice ID', canary.voice?.id, source.voice?.id],
        ['LLM ID', canary.llmId, source.llmId],
        ['language', canary.languageCode, source.languageCode],
        ['skip greeting', canary.skipGreeting, source.skipGreeting],
        ['uninterruptible greeting', canary.uninterruptibleGreeting, source.uninterruptibleGreeting],
        ['initial message', canary.initialMessage, source.initialMessage],
        ['zero data retention', canary.zeroDataRetention, source.zeroDataRetention],
        ['prompt SHA-256', sha256(canary.brain?.systemPrompt ?? ''), sha256(expectedPrompt)],
        ['tool IDs', JSON.stringify(sortedToolIds(canary)), JSON.stringify(sortedToolIds(source))],
    ];

    const failures = checks.filter(([, actual, expected]) => actual !== expected);
    if (failures.length > 0) {
        const summary = failures
            .map(([label, actual, expected]) => `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
            .join('\n');
        throw new Error(`Amy Cara 4 canary verification failed:\n${summary}`);
    }
}

const source = await anam(`/personas/${SOURCE_PERSONA_ID}`);
const availableVersions = source.avatar?.availableVersions ?? [];

if (!availableVersions.includes(CANARY_MODEL)) {
    throw new Error(`Amy's avatar does not report ${CANARY_MODEL} support. Available: ${availableVersions.join(', ')}`);
}

if (!source.brain?.systemPrompt || !source.avatar?.id || !source.voice?.id || !source.llmId) {
    throw new Error('Source Amy is missing a prompt, avatar, voice, or LLM. Refusing to create a partial canary.');
}

const expectedPrompt = `${source.brain.systemPrompt.trim()}\n\n${behaviorUpgrade}\n`;
const list = await anam(`/personas?perPage=100&search=${encodeURIComponent(CANARY_NAME)}`);
const existingSummary = (list.data ?? []).find(persona => persona.name === CANARY_NAME);
let canary;
let created = false;

if (existingSummary) {
    canary = await anam(`/personas/${existingSummary.id}`);
    if (!canary.description?.includes(DESCRIPTION_MARKER)) {
        throw new Error(`A persona named “${CANARY_NAME}” already exists but is not marked as this workflow's canary.`);
    }
} else {
    const payload = {
        name: CANARY_NAME,
        description: `Reversible stable Cara 4 canary for x-agent-website-a. ${DESCRIPTION_MARKER}`,
        avatarId: source.avatar.id,
        avatarModel: CANARY_MODEL,
        voiceId: source.voice.id,
        llmId: source.llmId,
        systemPrompt: expectedPrompt,
        skipGreeting: source.skipGreeting,
        uninterruptibleGreeting: source.uninterruptibleGreeting,
        initialMessage: source.initialMessage,
        zeroDataRetention: source.zeroDataRetention,
        languageCode: source.languageCode,
        toolIds: sortedToolIds(source),
        ...(compactObject(source.voiceDetectionOptions)
            ? { voiceDetectionOptions: source.voiceDetectionOptions }
            : {}),
        ...(compactObject(source.voiceGenerationOptions)
            ? { voiceGenerationOptions: source.voiceGenerationOptions }
            : {}),
    };

    canary = await anam('/personas', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    created = true;

    if (compactObject(source.widgetConfig)) {
        canary = await anam(`/personas/${canary.id}`, {
            method: 'PUT',
            body: JSON.stringify({ widgetConfig: source.widgetConfig }),
        });
    }
}

assertCanaryMatches({ source, canary, expectedPrompt });

console.log(JSON.stringify({
    created,
    canaryPersonaId: canary.id,
    name: canary.name,
    avatarModel: canary.avatarModel,
    avatarId: canary.avatar.id,
    voiceId: canary.voice.id,
    llmId: canary.llmId,
    toolCount: sortedToolIds(canary).length,
    promptSha256: sha256(canary.brain.systemPrompt),
    sourcePromptSha256: sha256(source.brain.systemPrompt),
}, null, 2));
