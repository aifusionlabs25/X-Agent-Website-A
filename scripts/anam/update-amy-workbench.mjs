import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.anam.ai/v1';
const APPLY_CONFIRMATION = 'CONFIRM_AMY_WORKBENCH_SYNC';
const RELIABILITY_START = '<!-- AMY_CARA4_RELIABILITY_START -->';
const RELIABILITY_END = '<!-- AMY_CARA4_RELIABILITY_END -->';
const PUBLIC_SECTOR_START = '<!-- AMY_PUBLIC_SECTOR_START -->';
const PUBLIC_SECTOR_END = '<!-- AMY_PUBLIC_SECTOR_END -->';
const WORKBENCH_START = '<!-- AMY_WORKBENCH_START -->';
const WORKBENCH_END = '<!-- AMY_WORKBENCH_END -->';
const FORBIDDEN_TOOL_NAMES = new Set(['capture_sales_handoff', 'end_call']);
const REQUIRED_MANAGED_MARKER_PAIRS = [
    ['<!-- AMY_CONVERSATION_NATURALNESS_START -->', '<!-- AMY_CONVERSATION_NATURALNESS_END -->'],
    ['<!-- AMY_CARA4_RELIABILITY_START -->', '<!-- AMY_CARA4_RELIABILITY_END -->'],
    ['<!-- AMY_PUBLIC_SECTOR_START -->', '<!-- AMY_PUBLIC_SECTOR_END -->'],
    [WORKBENCH_START, WORKBENCH_END],
    ['<!-- AMY_AGENTMAIL_START -->', '<!-- AMY_AGENTMAIL_END -->'],
];
const PINNED_IDENTITY = Object.freeze({
    id: '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08',
    name: 'Amy Insight SDR - Cara 4 Canary',
    avatarId: '36e17abf-ef6c-4bef-99bd-3f925da155eb',
    avatarModel: 'cara-4',
    voiceId: 'b138c2a2-ba66-4887-95d5-1a57093fc92d',
    llmId: 'a7cf662c-2ace-4de1-a21e-ef0fbf144bb7',
});
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const normalize = (value) => String(value ?? '').replace(/\r\n?/g, '\n');
const personaId = process.env.ANAM_AMY_CARA4_PERSONA_ID?.trim();
const apiKey = process.env.ANAM_API_KEY?.trim();

if (!apiKey || !personaId) {
    throw new Error('ANAM_API_KEY and ANAM_AMY_CARA4_PERSONA_ID are required and are never printed.');
}
if (personaId !== PINNED_IDENTITY.id) {
    throw new Error('Refusing update: configured Amy persona ID is not the pinned Cara 4 identity.');
}

const toolDefinitions = JSON.parse(await fs.readFile(
    new URL('../../config/anam/amy-workbench-client-tools.json', import.meta.url),
    'utf8',
));
const promptUpgrade = normalize(await fs.readFile(
    new URL('../../config/anam/amy-workbench-prompt-upgrade.md', import.meta.url),
    'utf8',
)).trim();
const reliabilityUpgrade = normalize(await fs.readFile(
    new URL('../../config/anam/amy-cara4-reliability-upgrade.md', import.meta.url),
    'utf8',
)).trim();
const publicSectorUpgrade = normalize(await fs.readFile(
    new URL('../../config/anam/amy-public-sector-upgrade.md', import.meta.url),
    'utf8',
)).trim();

if (!Array.isArray(toolDefinitions) || toolDefinitions.length === 0) {
    throw new Error('Refusing update: local Amy Workbench tool definitions are missing.');
}
const workbenchNames = toolDefinitions.map((tool) => String(tool?.name ?? '').trim());
if (workbenchNames.some((name) => !name) || new Set(workbenchNames).size !== workbenchNames.length) {
    throw new Error('Refusing update: local Amy Workbench tool names are missing or duplicated.');
}
const invalidDescription = toolDefinitions.find((tool) => {
    const description = String(tool?.description ?? '').trim();
    return !description || description.length > 1_024;
});
if (invalidDescription) {
    throw new Error(`Refusing update: ${invalidDescription.name || 'Workbench tool'} description must contain 1 to 1024 characters.`);
}
for (const [label, replacement, startMarker, endMarker] of [
    ['reliability', reliabilityUpgrade, RELIABILITY_START, RELIABILITY_END],
    ['public-sector', publicSectorUpgrade, PUBLIC_SECTOR_START, PUBLIC_SECTOR_END],
    ['Workbench', promptUpgrade, WORKBENCH_START, WORKBENCH_END],
]) {
    if (!replacement.includes(startMarker) || !replacement.includes(endMarker)) {
        throw new Error(`Refusing update: local Amy ${label} prompt markers are malformed or missing.`);
    }
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const toolId = (tool) => tool?._toolId ?? tool?.id ?? null;
const readOption = (name) => process.argv.slice(2)
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

function listData(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.tools)) return payload.tools;
    return [];
}

function normalizedJson(value) {
    if (Array.isArray(value)) return value.map(normalizedJson);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value)
            .filter((key) => value[key] !== undefined)
            .sort()
            .map((key) => [key, normalizedJson(value[key])]));
    }
    return typeof value === 'string' ? normalize(value) : value;
}

function normalizedToolDefinition(tool) {
    return {
        description: normalize(tool?.description).trim(),
        type: String(tool?.type ?? '').trim(),
        config: normalizedJson(tool?.config ?? null),
    };
}

function stableJson(value) {
    return JSON.stringify(normalizedJson(value));
}

function toolDefinitionDelta(existing, expected) {
    if (!existing || !toolId(existing)) {
        return {
            name: expected.name,
            action: 'create',
            changedFields: ['description', 'type', 'config'],
            beforeDefinitionSha256: null,
            expectedDefinitionSha256: sha256(stableJson(normalizedToolDefinition(expected))),
        };
    }
    const before = normalizedToolDefinition(existing);
    const after = normalizedToolDefinition(expected);
    const changedFields = ['description', 'type', 'config']
        .filter((field) => stableJson(before[field]) !== stableJson(after[field]));
    return {
        name: expected.name,
        action: changedFields.length ? 'update' : 'unchanged',
        changedFields,
        beforeDefinitionSha256: sha256(stableJson(before)),
        expectedDefinitionSha256: sha256(stableJson(after)),
    };
}

function protectedProviderState(persona) {
    return {
        id: persona.id,
        name: persona.name,
        avatarId: persona.avatar?.id ?? null,
        avatarModel: persona.avatarModel,
        voiceId: persona.voice?.id ?? null,
        llmId: persona.llmId ?? null,
        initialMessage: persona.initialMessage ?? null,
        voiceDetectionOptions: persona.voiceDetectionOptions ?? null,
        zeroDataRetention: persona.zeroDataRetention ?? null,
        enableAudioPassthrough: persona.enableAudioPassthrough ?? null,
    };
}

function assertIdentity(persona) {
    const actual = protectedProviderState(persona);
    for (const [key, expected] of Object.entries(PINNED_IDENTITY)) {
        if (actual[key] !== expected) {
            throw new Error(`Refusing update: Amy ${key} does not match the pinned identity.`);
        }
    }
}

function markerCount(prompt, marker) {
    return prompt.split(marker).length - 1;
}

function assertManagedPrompt(prompt) {
    const normalizedPrompt = normalize(prompt);
    const failures = [];
    const spans = [];
    for (const [startMarker, endMarker] of REQUIRED_MANAGED_MARKER_PAIRS) {
        const start = normalizedPrompt.indexOf(startMarker);
        const end = normalizedPrompt.indexOf(endMarker);
        if (
            markerCount(normalizedPrompt, startMarker) !== 1
            || markerCount(normalizedPrompt, endMarker) !== 1
            || start < 0
            || end <= start
        ) {
            failures.push(startMarker.replace(/^<!--\s*|\s*-->$/g, ''));
        } else {
            spans.push({ start, end: end + endMarker.length, marker: startMarker });
        }
    }
    spans.sort((left, right) => left.start - right.start);
    for (let index = 1; index < spans.length; index += 1) {
        if (spans[index].start < spans[index - 1].end) {
            failures.push(spans[index].marker.replace(/^<!--\s*|\s*-->$/g, ''));
        }
    }
    if (failures.length) {
        throw new Error(`Refusing update: Amy required managed prompt markers are malformed or missing: ${failures.join(', ')}.`);
    }
}

function replaceManagedBlock(prompt, replacement, startMarker, endMarker) {
    const current = normalize(prompt).trim();
    assertManagedPrompt(current);
    const start = current.indexOf(startMarker);
    const end = current.indexOf(endMarker);
    const after = end + endMarker.length;
    const beforeBlock = current.slice(0, start).trim();
    const afterBlock = current.slice(after).trim();
    return `${beforeBlock}${beforeBlock ? '\n\n' : ''}${replacement}${afterBlock ? `\n\n${afterBlock}` : ''}\n`;
}

function isInside(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveBackupDirectory(rawBackupDir) {
    if (!rawBackupDir || !path.isAbsolute(rawBackupDir)) {
        throw new Error('Refusing live update: --backup-dir must be an absolute path outside the repository.');
    }
    const repositoryRoot = await fs.realpath(REPOSITORY_ROOT).catch(() => REPOSITORY_ROOT);
    const resolvedBackupDir = path.resolve(rawBackupDir);
    if (isInside(repositoryRoot, resolvedBackupDir)) {
        throw new Error('Refusing live update: --backup-dir must be outside the repository.');
    }
    await fs.mkdir(resolvedBackupDir, { recursive: true });
    const realBackupDir = await fs.realpath(resolvedBackupDir);
    if (isInside(repositoryRoot, realBackupDir)) {
        throw new Error('Refusing live update: resolved --backup-dir must be outside the repository.');
    }
    return realBackupDir;
}

async function anam(pathname, init = {}) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
        const detail = (await response.text()).slice(0, 2_000);
        throw new Error(`Anam ${init.method ?? 'GET'} ${pathname} failed (${response.status}): ${detail}`);
    }
    return response.json();
}

const [before, toolListPayload] = await Promise.all([
    anam(`/personas/${personaId}`),
    anam('/tools?perPage=100'),
]);
assertIdentity(before);
const beforePrompt = normalize(before.brain?.systemPrompt);
assertManagedPrompt(beforePrompt);
const expectedPrompt = [
    [reliabilityUpgrade, RELIABILITY_START, RELIABILITY_END],
    [publicSectorUpgrade, PUBLIC_SECTOR_START, PUBLIC_SECTOR_END],
    [promptUpgrade, WORKBENCH_START, WORKBENCH_END],
].reduce(
    (prompt, [replacement, startMarker, endMarker]) => replaceManagedBlock(
        prompt,
        replacement,
        startMarker,
        endMarker,
    ),
    beforePrompt,
);
assertManagedPrompt(expectedPrompt);
const beforePromptHash = sha256(beforePrompt);
const expectedPromptHash = sha256(expectedPrompt);
const allTools = listData(toolListPayload);
const matchingWorkbenchTools = allTools.filter((tool) => workbenchNames.includes(tool.name));
const toolDeltas = toolDefinitions.map((definition) => toolDefinitionDelta(
    allTools.find((tool) => tool.name === definition.name),
    definition,
));
const currentPersonaToolIds = (before.tools ?? []).map(toolId).filter(Boolean);
const currentPersonaToolNames = (before.tools ?? []).map((tool) => tool.name);
const forbiddenAttachedToolNames = currentPersonaToolNames
    .filter((name) => FORBIDDEN_TOOL_NAMES.has(name));
const applying = process.argv.includes('--apply');

if (!applying) {
    console.log(JSON.stringify({
        mode: 'dry-run',
        personaId,
        beforePromptSha256: beforePromptHash,
        expectedPromptSha256: expectedPromptHash,
        promptChanged: beforePromptHash !== expectedPromptHash,
        currentPromptChars: beforePrompt.length,
        expectedPromptChars: expectedPrompt.length,
        toolDeltas,
        wouldAttachToolNames: workbenchNames.filter((name) => !currentPersonaToolNames.includes(name)),
        wouldRemoveToolNames: forbiddenAttachedToolNames,
        protectedProviderStateSha256: sha256(stableJson(protectedProviderState(before))),
        applyConfirmation: APPLY_CONFIRMATION,
        backupRequired: true,
        backupMustBeAbsoluteOutsideRepository: true,
    }, null, 2));
} else {
    if (readOption('confirm') !== APPLY_CONFIRMATION) {
        throw new Error(`Refusing live update: pass --confirm=${APPLY_CONFIRMATION}.`);
    }
    const expectedCurrentHash = readOption('expected-current-sha256');
    if (!expectedCurrentHash || expectedCurrentHash !== beforePromptHash) {
        throw new Error('Refusing live update: --expected-current-sha256 must match the freshly fetched Amy prompt.');
    }
    const backupDir = await resolveBackupDirectory(readOption('backup-dir'));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.resolve(backupDir, `amy-cara4-pre-workbench-sync-${stamp}.json`);
    await fs.writeFile(backupPath, `${JSON.stringify({
        capturedAt: new Date().toISOString(),
        persona: before,
        matchingWorkbenchTools,
    }, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
    });

    const createdNames = [];
    const updatedNames = [];
    const unchangedNames = [];
    for (const definition of toolDefinitions) {
        const existing = allTools.find((tool) => tool.name === definition.name);
        const delta = toolDeltas.find((item) => item.name === definition.name);
        if (existing && toolId(existing)) {
            if (delta?.action === 'unchanged') {
                unchangedNames.push(definition.name);
                continue;
            }
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
    const workbenchTools = workbenchNames.map((name) => {
        const tool = refreshedTools.find((candidate) => candidate.name === name);
        if (!toolId(tool)) throw new Error(`Required Anam workbench tool is unavailable: ${name}`);
        return tool;
    });
    const forbiddenToolIds = new Set([
        ...refreshedTools,
        ...(before.tools ?? []),
    ].filter((tool) => FORBIDDEN_TOOL_NAMES.has(tool.name)).map(toolId).filter(Boolean));
    const nextToolIds = [...new Set([
        ...currentPersonaToolIds,
        ...workbenchTools.map(toolId),
    ])].filter((id) => !forbiddenToolIds.has(id)).sort();

    await anam(`/personas/${personaId}`, {
        method: 'PUT',
        body: JSON.stringify({
            systemPrompt: expectedPrompt,
            toolIds: nextToolIds,
        }),
    });

    const [verified, verifiedToolsPayload] = await Promise.all([
        anam(`/personas/${personaId}`),
        anam('/tools?perPage=100'),
    ]);
    assertIdentity(verified);
    const verifiedPrompt = normalize(verified.brain?.systemPrompt);
    assertManagedPrompt(verifiedPrompt);
    const verifiedToolIds = (verified.tools ?? []).map(toolId).filter(Boolean).sort();
    const verifiedToolNames = (verified.tools ?? []).map((tool) => tool.name).sort();
    const verifiedTools = listData(verifiedToolsPayload);
    const failures = [];
    if (sha256(verifiedPrompt) !== expectedPromptHash) failures.push('prompt');
    if (JSON.stringify(verifiedToolIds) !== JSON.stringify(nextToolIds)) failures.push('attachedToolIds');
    for (const forbiddenName of FORBIDDEN_TOOL_NAMES) {
        if (verifiedToolNames.includes(forbiddenName)) failures.push(forbiddenName);
    }
    if (stableJson(protectedProviderState(verified)) !== stableJson(protectedProviderState(before))) {
        failures.push('protectedPersonaProviderState');
    }
    for (const definition of toolDefinitions) {
        const remoteTool = verifiedTools.find((tool) => tool.name === definition.name);
        if (!remoteTool || !toolId(remoteTool)) {
            failures.push(`tool.${definition.name}.missing`);
            continue;
        }
        if (stableJson(normalizedToolDefinition(remoteTool)) !== stableJson(normalizedToolDefinition(definition))) {
            failures.push(`tool.${definition.name}.descriptionTypeConfig`);
        }
        if (!verifiedToolNames.includes(definition.name)) failures.push(`tool.${definition.name}.attachment`);
    }
    if (failures.length) throw new Error(`Amy Workbench verification failed: ${failures.join(', ')}`);

    console.log(JSON.stringify({
        mode: 'applied-and-verified',
        personaId: verified.id,
        backupPath,
        createdNames,
        updatedNames,
        unchangedNames,
        attachedToolNames: verifiedToolNames,
        toolCount: verifiedToolIds.length,
        beforePromptSha256: beforePromptHash,
        afterPromptSha256: sha256(verifiedPrompt),
        workbenchPromptConfigured: true,
        workbenchToolDefinitionsVerified: true,
        protectedPersonaProviderStateUnchanged: true,
        captureSalesHandoffAttached: false,
        legacyEndCallAttached: false,
    }, null, 2));
}
