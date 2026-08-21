import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    installAmyConversationBlock,
    removeDeprecatedAmyBehaviorBlock,
} from './amy-conversation-prompt.mjs';

export const API_BASE = 'https://api.anam.ai/v1';
export const APPLY_CONFIRMATION = 'CONFIRM_AMY_WORKBENCH_SYNC';
export const AMY_INITIAL_MESSAGE = "Hi, I'm Amy with Insight Enterprises. Who am I speaking with today?";
export const FORBIDDEN_TOOL_NAMES = new Set(['capture_sales_handoff', 'end_call', 'search_insight_catalog']);
export const PINNED_IDENTITY = Object.freeze({
    id: '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08',
    name: 'Amy Insight SDR - Cara 4 Canary',
    avatarId: '36e17abf-ef6c-4bef-99bd-3f925da155eb',
    avatarModel: 'cara-4',
    voiceId: 'b138c2a2-ba66-4887-95d5-1a57093fc92d',
    llmId: '65421f1c-c7de-4bc4-ac27-d171c16ef41f',
});

const RELIABILITY_START = '<!-- AMY_CARA4_RELIABILITY_START -->';
const RELIABILITY_END = '<!-- AMY_CARA4_RELIABILITY_END -->';
const PUBLIC_SECTOR_START = '<!-- AMY_PUBLIC_SECTOR_START -->';
const PUBLIC_SECTOR_END = '<!-- AMY_PUBLIC_SECTOR_END -->';
const WORKBENCH_START = '<!-- AMY_WORKBENCH_START -->';
const WORKBENCH_END = '<!-- AMY_WORKBENCH_END -->';
export const AMY_CORE_START = '<!-- AMY_CORE_START -->';
export const AMY_CORE_END = '<!-- AMY_CORE_END -->';
const LEGACY_CORE_START = 'AMY — INSIGHT ENTERPRISE SDR\nANAM SYSTEM PROMPT\nVERSION: AMY_ANAM_V2_2026_07_15';
const REQUIRED_MANAGED_MARKER_PAIRS = [
    ['<!-- AMY_CONVERSATION_NATURALNESS_START -->', '<!-- AMY_CONVERSATION_NATURALNESS_END -->'],
    [RELIABILITY_START, RELIABILITY_END],
    [PUBLIC_SECTOR_START, PUBLIC_SECTOR_END],
    [WORKBENCH_START, WORKBENCH_END],
    ['<!-- AMY_AGENTMAIL_START -->', '<!-- AMY_AGENTMAIL_END -->'],
];
const DEPRECATED_AMY_PROMPT_INSTRUCTIONS = [
    ['legacy Cara behavior header', /#\s*Amy\s+Cara\s+4\s+behavior\s+upgrade/i],
    ['contact solicitation', /Earn\s+the\s+right\s+to\s+ask\s+for\s+contact\s+information/i],
    ['legacy live catalog tool', /\bsearch_insight_catalog\b/i],
    ['legacy search helper', /\bsearch_assist\b/i],
    ['legacy Tavus close path', /\bbuilt-in\s+Tavus\b|\b(?:use|call|retry)\s+(?:the\s+)?end_call\b/i],
    ['legacy two-call close receipt', /\bclosing_motion_required\b/i],
    ['routine second name request', /What\s+name\s+would\s+you\s+like\s+me\s+to\s+use\?/i],
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const normalize = value => String(value ?? '').replace(/\r\n?/g, '\n');
export const sha256 = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
export const toolId = tool => tool?._toolId ?? tool?.id ?? null;
const avatarId = persona => persona?.avatar?.id ?? persona?.avatarId ?? null;
const voiceId = persona => persona?.voice?.id ?? persona?.voice?.voiceId ?? persona?.voiceId ?? null;
const llmId = persona => persona?.brain?.llm?.id ?? persona?.brain?.llmId ?? persona?.llm?.id ?? persona?.llmId ?? null;

export function normalizedJson(value) {
    if (Array.isArray(value)) return value.map(normalizedJson);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value)
            .filter(key => value[key] !== undefined)
            .sort()
            .map(key => [key, normalizedJson(value[key])]));
    }
    return typeof value === 'string' ? normalize(value) : value;
}

export const stableJson = value => JSON.stringify(normalizedJson(value));
export const hashJson = value => sha256(stableJson(value));

export function toolDefinitionView(tool) {
    return {
        name: String(tool?.name ?? '').trim(),
        description: normalize(tool?.description).trim(),
        type: String(tool?.type ?? '').trim(),
        disableInterruptions: Boolean(tool?.disableInterruptions),
        config: normalizedJson(tool?.config ?? null),
    };
}

function toolInventoryView(tools) {
    return [...tools]
        // Persona attachment changes can rewrite provider bookkeeping on tool rows.
        // Concurrency must pin the executable definition; persona inventories below
        // independently pin every attachment and usage relationship.
        .map(tool => ({ id: toolId(tool), definition: toolDefinitionView(tool) }))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function personaInventoryView(personas) {
    return [...personas]
        .map(persona => ({ id: persona?.id ?? null, state: canonicalPersonaStateView(persona) }))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function withoutProviderEphemera(value) {
    if (Array.isArray(value)) return value.map(withoutProviderEphemera);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        // Anam returns newly signed avatar delivery URLs on every GET. They are transport
        // credentials, not persona configuration, and cannot participate in stable drift proof.
        .filter(([key]) => ![
            'updatedAt',
            '_updatedAt',
            'modifiedAt',
            'videoUrl',
            'idleVideoUrl',
        ].includes(key))
        .map(([key, nested]) => [key, withoutProviderEphemera(nested)]));
}

export function canonicalToolStateView(tool) {
    return normalizedJson(withoutProviderEphemera(structuredClone(tool ?? {})));
}

export function canonicalPersonaStateView(persona) {
    return normalizedJson(withoutProviderEphemera(structuredClone(persona ?? {})));
}

export function protectedPersonaView(persona) {
    const clone = structuredClone(persona ?? {});
    delete clone.tools;
    delete clone.initialMessage;
    if (clone.brain && typeof clone.brain === 'object') delete clone.brain.systemPrompt;
    return normalizedJson(withoutProviderEphemera(clone));
}

export function personaConcurrencyView(persona) {
    return {
        protected: protectedPersonaView(persona),
        promptSha256: sha256(normalize(persona?.brain?.systemPrompt)),
        initialMessage: persona?.initialMessage ?? null,
        tools: (persona?.tools ?? [])
            .map(tool => ({ id: toolId(tool), name: tool?.name ?? null }))
            .sort((left, right) => `${left.name}:${left.id}`.localeCompare(`${right.name}:${right.id}`)),
    };
}

export function personaCurrentStateView(persona) {
    return {
        ...personaConcurrencyView(persona),
        toolDefinitions: (persona?.tools ?? [])
            .map(tool => ({ id: toolId(tool), definition: toolDefinitionView(tool) }))
            .sort((left, right) => String(left.id).localeCompare(String(right.id))),
    };
}

export function assertIdentity(persona) {
    const actual = {
        id: persona?.id ?? null,
        name: persona?.name ?? null,
        avatarId: avatarId(persona),
        avatarModel: persona?.avatarModel ?? null,
        voiceId: voiceId(persona),
        llmId: llmId(persona),
    };
    for (const [key, expected] of Object.entries(PINNED_IDENTITY)) {
        if (actual[key] !== expected) {
            throw new Error(`Refusing update: Amy ${key} does not match the pinned identity.`);
        }
    }
}

function listData(payload, keys) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) {
        if (Array.isArray(payload?.[key])) return payload[key];
    }
    return null;
}

export function requireCompleteInventory(payload, label, keys) {
    if (Array.isArray(payload)) {
        throw new Error(`Anam ${label} response has no pagination proof; refusing an incomplete inventory.`);
    }
    const rows = listData(payload, keys);
    const meta = payload?.meta;
    if (
        !rows
        || !meta
        || !Number.isInteger(meta.total)
        || !Number.isInteger(meta.lastPage)
        || !Number.isInteger(meta.currentPage)
        || !Number.isInteger(meta.perPage)
        || meta.total !== rows.length
        || meta.currentPage !== 1
        || meta.lastPage !== 1
        || meta.perPage < meta.total
        || meta.next !== null
    ) {
        throw new Error(`Anam ${label} inventory is paginated, malformed, or incomplete; refusing to infer isolation.`);
    }
    return { rows, meta };
}

function assertUniqueUuidInventory(rows, label, idReader) {
    const ids = rows.map(idReader);
    if (
        ids.some(id => typeof id !== 'string' || !UUID_PATTERN.test(id))
        || new Set(ids).size !== ids.length
    ) {
        throw new Error(`Anam ${label} inventory contains missing, invalid, or duplicate IDs.`);
    }
}

export async function fetchCompleteInventories(anam) {
    const [personaPayload, toolPayload] = await Promise.all([
        anam('/personas?perPage=100'),
        anam('/tools?perPage=100'),
    ]);
    const personaPage = requireCompleteInventory(personaPayload, 'persona', ['data', 'items', 'personas']);
    const toolPage = requireCompleteInventory(toolPayload, 'tool', ['data', 'items', 'tools']);
    assertUniqueUuidInventory(personaPage.rows, 'persona', persona => persona?.id ?? null);
    assertUniqueUuidInventory(toolPage.rows, 'tool', toolId);
    const personas = await Promise.all(personaPage.rows.map(persona => (
        anam(`/personas/${encodeURIComponent(persona.id)}`)
    )));
    assertUniqueUuidInventory(personas, 'persona detail', persona => persona?.id ?? null);
    if (
        personas.length !== personaPage.meta.total
        || personas.some(persona => !Array.isArray(persona?.tools))
        || !personas.some(persona => persona.id === PINNED_IDENTITY.id)
    ) {
        throw new Error('Anam persona detail inventory is incomplete; refusing to infer tool isolation.');
    }
    return {
        personas,
        tools: toolPage.rows,
        personaMeta: personaPage.meta,
        toolMeta: toolPage.meta,
    };
}

function markerCount(prompt, marker) {
    return prompt.split(marker).length - 1;
}

export function assertManagedPrompt(prompt) {
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

export function assertNoDeprecatedAmyPromptInstructions(prompt) {
    const normalizedPrompt = normalize(prompt);
    const matches = DEPRECATED_AMY_PROMPT_INSTRUCTIONS
        .filter(([, pattern]) => pattern.test(normalizedPrompt))
        .map(([label]) => label);
    if (matches.length) {
        throw new Error(`Refusing update: deprecated Amy prompt instructions remain: ${matches.join(', ')}.`);
    }
}

export function replaceManagedBlock(prompt, replacement, startMarker, endMarker) {
    const current = normalize(prompt).trim();
    assertManagedPrompt(current);
    const start = current.indexOf(startMarker);
    const end = current.indexOf(endMarker);
    const after = end + endMarker.length;
    const beforeBlock = current.slice(0, start).trim();
    const afterBlock = current.slice(after).trim();
    return `${beforeBlock}${beforeBlock ? '\n\n' : ''}${replacement}${afterBlock ? `\n\n${afterBlock}` : ''}\n`;
}

export function installAmyCoreBlock(prompt, replacement) {
    const current = normalize(prompt).trim();
    const managed = normalize(replacement).trim();
    const managedStarts = markerCount(managed, AMY_CORE_START);
    const managedEnds = markerCount(managed, AMY_CORE_END);
    if (
        managedStarts !== 1
        || managedEnds !== 1
        || !managed.startsWith(AMY_CORE_START)
        || !managed.endsWith(AMY_CORE_END)
    ) {
        throw new Error('Refusing update: local Amy core prompt markers are malformed or missing.');
    }

    const currentStarts = markerCount(current, AMY_CORE_START);
    const currentEnds = markerCount(current, AMY_CORE_END);
    if (currentStarts || currentEnds) {
        if (currentStarts !== 1 || currentEnds !== 1) {
            throw new Error('Refusing update: live Amy core prompt markers are malformed.');
        }
        const start = current.indexOf(AMY_CORE_START);
        const end = current.indexOf(AMY_CORE_END);
        if (end <= start) throw new Error('Refusing update: live Amy core prompt markers are malformed.');
        const after = end + AMY_CORE_END.length;
        return {
            prompt: `${current.slice(0, start).trim()}\n\n${managed}\n\n${current.slice(after).trim()}\n`,
            legacyCoreReplaced: false,
        };
    }

    if (markerCount(current, LEGACY_CORE_START) !== 1) {
        throw new Error('Refusing update: reviewed Amy legacy core anchor is missing or duplicated.');
    }
    const legacyStart = current.indexOf(LEGACY_CORE_START);
    const legacyEnd = current.indexOf(WORKBENCH_START, legacyStart);
    if (legacyEnd <= legacyStart || markerCount(current, WORKBENCH_START) !== 1) {
        throw new Error('Refusing update: reviewed Amy legacy core boundary is malformed.');
    }
    return {
        prompt: `${current.slice(0, legacyStart).trim()}\n\n${managed}\n\n${current.slice(legacyEnd).trim()}\n`,
        legacyCoreReplaced: true,
    };
}

function toolUsages(personas, id) {
    return personas.flatMap(persona => (persona.tools ?? [])
        .filter(tool => toolId(tool) === id)
        .map(tool => ({
            personaId: persona.id,
            personaName: persona.name ?? null,
            toolId: id,
            toolName: tool.name ?? null,
        })))
        .sort((left, right) => left.personaId.localeCompare(right.personaId));
}

function validateDefinitions(definitions) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
        throw new Error('Refusing update: local Amy Workbench tool definitions are missing.');
    }
    const names = definitions.map(definition => String(definition?.name ?? '').trim());
    if (names.some(name => !name) || new Set(names).size !== names.length) {
        throw new Error('Refusing update: local Amy Workbench tool names are missing or duplicated.');
    }
    for (const definition of definitions) {
        const view = toolDefinitionView(definition);
        if (!view.description || view.description.length > 1_024) {
            throw new Error(`Refusing update: ${view.name || 'Workbench tool'} description must contain 1 to 1024 characters.`);
        }
        if (!view.type || !definition?.config || typeof definition.config !== 'object') {
            throw new Error(`Refusing update: ${view.name} is not a complete managed tool definition.`);
        }
    }
    return names;
}

export function buildWorkbenchSyncPlan({ target, personas, tools, definitions, expectedPrompt }) {
    assertIdentity(target);
    validateDefinitions(definitions);
    const targetAttachments = target.tools ?? [];
    const blockers = [];
    const managedTools = definitions.map(definition => {
        const name = definition.name;
        const attached = targetAttachments.filter(tool => tool?.name === name);
        if (attached.length > 1) blockers.push(`Production Amy has multiple attached ${name} tools.`);
        const current = attached[0] ?? null;
        const currentId = toolId(current);
        const inventoryMatches = currentId ? tools.filter(tool => toolId(tool) === currentId) : [];
        if (currentId && inventoryMatches.length !== 1) {
            blockers.push(`Attached ${name} tool is absent or duplicated in the complete tool inventory.`);
        }
        const inventoryTool = inventoryMatches[0] ?? null;
        // Persona attachments are intentionally treated as ID/name summaries. The complete
        // /tools inventory is the only definition surface; comparing the two would falsely
        // reject Anam's normal {id,name,type} persona attachment shape.
        const usages = currentId ? toolUsages(personas, currentId) : [];
        const externalUsages = usages.filter(usage => usage.personaId !== PINNED_IDENTITY.id);
        const definitionChanged = inventoryTool
            ? stableJson(toolDefinitionView(inventoryTool)) !== stableJson(toolDefinitionView(definition))
            : true;
        const exactUnattachedCandidates = tools.filter(tool => (
            tool.name === name
            && toolId(tool) !== currentId
            && stableJson(toolDefinitionView(tool)) === stableJson(toolDefinitionView(definition))
            && toolUsages(personas, toolId(tool)).length === 0
        ));
        if ((!currentId || (definitionChanged && externalUsages.length)) && exactUnattachedCandidates.length > 1) {
            blockers.push(`${name} has multiple exact-definition unattached candidates; refusing ambiguous orphan reuse.`);
        }
        let action;
        if (!currentId) {
            action = exactUnattachedCandidates.length === 1
                ? 'attach-existing-dedicated-unattached'
                : 'create-and-attach';
        }
        else if (!definitionChanged) action = externalUsages.length ? 'reuse-shared-unchanged' : 'reuse-dedicated-unchanged';
        else if (externalUsages.length) {
            action = exactUnattachedCandidates.length === 1
                ? 'swap-to-existing-dedicated-unattached'
                : 'clone-and-swap-production-only';
        }
        else action = 'update-production-only';
        const sameNameInventoryIds = tools
            .filter(tool => tool?.name === name)
            .map(toolId)
            .filter(Boolean)
            .sort();
        return {
            name,
            action,
            currentToolId: currentId,
            currentDefinitionSha256: inventoryTool ? hashJson(toolDefinitionView(inventoryTool)) : null,
            expectedDefinitionSha256: hashJson(toolDefinitionView(definition)),
            usages,
            externalUsages,
            sameNameInventoryIds,
            exactUnattachedCandidateIds: exactUnattachedCandidates.map(toolId).sort(),
        };
    });
    const forbiddenAttachments = targetAttachments
        .filter(tool => FORBIDDEN_TOOL_NAMES.has(tool?.name))
        .map(tool => ({
            id: toolId(tool),
            name: tool.name,
            action: 'detach-production-only',
            usages: toolUsages(personas, toolId(tool)),
        }));
    if (forbiddenAttachments.some(item => !item.id)) {
        blockers.push('A forbidden production Amy tool attachment has no stable ID.');
    }
    const expectedPromptSha256 = sha256(expectedPrompt);
    const beforePromptSha256 = sha256(normalize(target.brain?.systemPrompt));
    const attachmentChange = managedTools.some(tool => [
        'create-and-attach',
        'clone-and-swap-production-only',
        'attach-existing-dedicated-unattached',
        'swap-to-existing-dedicated-unattached',
    ].includes(tool.action)) || forbiddenAttachments.length > 0;
    return {
        result: blockers.length ? 'BLOCKED' : 'PASS',
        blockers,
        targetPersonaId: target.id,
        beforePromptSha256,
        expectedPromptSha256,
        promptChanged: beforePromptSha256 !== expectedPromptSha256,
        initialMessageChanged: target.initialMessage !== AMY_INITIAL_MESSAGE,
        managedTools,
        forbiddenAttachments,
        attachmentChange,
        personaPutRequired: attachmentChange
            || beforePromptSha256 !== expectedPromptSha256
            || target.initialMessage !== AMY_INITIAL_MESSAGE,
        currentPersonaStateSha256: hashJson(personaCurrentStateView(target)),
        personaInventorySha256: hashJson(personaInventoryView(personas)),
        toolInventorySha256: hashJson(toolInventoryView(tools)),
    };
}

export function buildNextToolIds(currentAttachments, definitions, resolvedToolIds) {
    const managedNames = new Set(definitions.map(definition => definition.name));
    const emittedManagedNames = new Set();
    const nextToolIds = [];
    for (const attachment of currentAttachments ?? []) {
        const name = attachment?.name;
        if (FORBIDDEN_TOOL_NAMES.has(name)) continue;
        if (managedNames.has(name)) {
            if (emittedManagedNames.has(name)) continue;
            const replacementId = resolvedToolIds.get(name);
            if (!replacementId) throw new Error(`No resolved tool ID is available for ${name}.`);
            nextToolIds.push(replacementId);
            emittedManagedNames.add(name);
            continue;
        }
        const id = toolId(attachment);
        if (!id) throw new Error(`Unmanaged Amy tool ${name ?? 'unknown'} has no stable ID.`);
        nextToolIds.push(id);
    }
    for (const definition of definitions) {
        if (emittedManagedNames.has(definition.name)) continue;
        const id = resolvedToolIds.get(definition.name);
        if (!id) throw new Error(`No resolved tool ID is available for ${definition.name}.`);
        nextToolIds.push(id);
        emittedManagedNames.add(definition.name);
    }
    if (new Set(nextToolIds).size !== nextToolIds.length) {
        throw new Error('The planned Amy tool attachment sequence contains a duplicate ID.');
    }
    return nextToolIds;
}

export function isExactAmyToolAttachmentTransition(beforeAttachments, expectedIds, afterAttachments) {
    const beforeIds = (beforeAttachments ?? []).map(toolId).filter(Boolean);
    const afterIds = (afterAttachments ?? []).map(toolId).filter(Boolean);
    if (
        expectedIds.length !== afterIds.length
        || new Set(afterIds).size !== afterIds.length
        || expectedIds.some(id => !afterIds.includes(id))
    ) {
        return false;
    }

    // Anam may place newly attached tools in a different slot after a persona PUT.
    // Prove that every expected ID is present exactly once and that all retained
    // pre-existing attachments keep their relative order.
    const retained = new Set(beforeIds.filter(id => expectedIds.includes(id)));
    const expectedRetainedOrder = beforeIds.filter(id => retained.has(id));
    const actualRetainedOrder = afterIds.filter(id => retained.has(id));
    return stableJson(expectedRetainedOrder) === stableJson(actualRetainedOrder);
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

function readOption(name, argv = process.argv.slice(2)) {
    return argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
}

function assertExpectedHash(label, expected, supplied) {
    if (!supplied || supplied !== expected) {
        throw new Error(`Refusing live update: --${label} must match the freshly fetched dry-run hash.`);
    }
}

function assertOtherPersonasUnchanged(beforePersonas, afterPersonas) {
    const before = new Map(beforePersonas
        .filter(persona => persona.id !== PINNED_IDENTITY.id)
        .map(persona => [persona.id, hashJson(canonicalPersonaStateView(persona))]));
    const after = new Map(afterPersonas
        .filter(persona => persona.id !== PINNED_IDENTITY.id)
        .map(persona => [persona.id, hashJson(canonicalPersonaStateView(persona))]));
    if (stableJson([...before]) !== stableJson([...after])) {
        throw new Error('Amy Workbench verification failed: another persona changed during the scoped apply.');
    }
}

export function verifyWorkbenchSync({ before, after, definitions, expectedPrompt, resolvedToolIds, updatedToolIds, createdToolIds }) {
    const failures = [];
    const afterTarget = after.personas.find(persona => persona.id === PINNED_IDENTITY.id);
    if (!afterTarget) throw new Error('Amy Workbench verification failed: production Amy disappeared.');
    assertIdentity(afterTarget);
    if (sha256(normalize(afterTarget.brain?.systemPrompt)) !== sha256(expectedPrompt)) failures.push('prompt');
    if (afterTarget.initialMessage !== AMY_INITIAL_MESSAGE) failures.push('initialMessage');
    if (stableJson(protectedPersonaView(afterTarget)) !== stableJson(protectedPersonaView(before.target))) {
        failures.push('protectedPersonaState');
    }
    const attachedByName = new Map((afterTarget.tools ?? []).map(tool => [tool.name, tool]));
    for (const definition of definitions) {
        const attached = attachedByName.get(definition.name);
        const expectedId = resolvedToolIds.get(definition.name);
        if (!attached || toolId(attached) !== expectedId) failures.push(`tool.${definition.name}.attachment`);
        const inventoryTool = after.tools.find(tool => toolId(tool) === expectedId);
        if (
            !inventoryTool
            || stableJson(toolDefinitionView(inventoryTool)) !== stableJson(toolDefinitionView(definition))
        ) {
            failures.push(`tool.${definition.name}.definition`);
        }
    }
    for (const forbiddenName of FORBIDDEN_TOOL_NAMES) {
        if ((afterTarget.tools ?? []).some(tool => tool.name === forbiddenName)) failures.push(`forbidden.${forbiddenName}`);
    }
    const expectedTargetToolIds = buildNextToolIds(before.target.tools, definitions, resolvedToolIds);
    if (!isExactAmyToolAttachmentTransition(before.target.tools, expectedTargetToolIds, afterTarget.tools)) {
        failures.push('unrelatedToolAttachments');
    }
    assertOtherPersonasUnchanged(before.personas, after.personas);
    const beforeToolById = new Map(before.tools.map(tool => [toolId(tool), tool]));
    const afterToolById = new Map(after.tools.map(tool => [toolId(tool), tool]));
    for (const [id, beforeTool] of beforeToolById) {
        const afterTool = afterToolById.get(id);
        if (!afterTool) {
            failures.push(`tool.${id}.missing`);
            continue;
        }
        if (updatedToolIds.has(id)) continue;
        if (stableJson(toolDefinitionView(beforeTool)) !== stableJson(toolDefinitionView(afterTool))) {
            failures.push(`tool.${id}.unexpectedMutation`);
        }
    }
    for (const id of updatedToolIds) {
        const action = [...resolvedToolIds.entries()].find(([, toolIdValue]) => toolIdValue === id);
        const definition = definitions.find(item => item.name === action?.[0]);
        const afterTool = afterToolById.get(id);
        if (!definition || !afterTool || stableJson(toolDefinitionView(afterTool)) !== stableJson(toolDefinitionView(definition))) {
            failures.push(`tool.${id}.dedicatedUpdate`);
        }
    }
    for (const id of createdToolIds) {
        if (beforeToolById.has(id) || !afterToolById.has(id)) failures.push(`tool.${id}.creation`);
    }
    if (failures.length) throw new Error(`Amy Workbench verification failed: ${failures.join(', ')}`);
    return { target: afterTarget, failures };
}

export async function resolveCreatedTool(anam, definition, beforeIds, response) {
    const responseCandidates = [response, response?.data, response?.tool].filter(Boolean);
    const responseId = responseCandidates.map(toolId).find(Boolean) ?? null;
    const inventory = await fetchCompleteInventories(anam);
    const candidates = inventory.tools.filter(tool => (
        !beforeIds.has(toolId(tool))
        && tool.name === definition.name
        && stableJson(toolDefinitionView(tool)) === stableJson(toolDefinitionView(definition))
        && toolUsages(inventory.personas, toolId(tool)).length === 0
    ));
    if (candidates.length !== 1) {
        throw new Error(
            `Created ${definition.name} tool could not be uniquely proven as exactly one new exact-definition unattached candidate in the complete inventory (found ${candidates.length}).`,
        );
    }
    const candidateId = toolId(candidates[0]);
    if (responseId && responseId !== candidateId) {
        throw new Error(
            `Created ${definition.name} response ID did not match the unique new exact-definition unattached inventory candidate.`,
        );
    }
    return { id: candidateId, inventory };
}

async function createToolWithInventoryRecovery(anam, definition, beforeIds) {
    let response = null;
    let createError = null;
    try {
        response = await anam('/tools', {
            method: 'POST',
            body: JSON.stringify(definition),
        });
    } catch (error) {
        // A provider timeout can arrive after the POST committed. Never retry the POST:
        // re-read the complete inventories and recover only one exact, still-unattached
        // tool that was not present before this create attempt.
        createError = error;
    }

    try {
        const created = await resolveCreatedTool(anam, definition, beforeIds, response);
        return { ...created, recoveredAfterCreateError: createError !== null };
    } catch (recoveryError) {
        if (!createError) throw recoveryError;
        throw new AggregateError(
            [createError, recoveryError],
            `The ${definition.name} tool POST returned an error and inventory recovery failed closed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
        );
    }
}

function assertFreshPlanState(inventory, plan) {
    const target = inventory.personas.find(persona => persona.id === PINNED_IDENTITY.id);
    if (!target) throw new Error('Refusing live update: production Amy disappeared before mutation.');
    assertIdentity(target);
    if (
        hashJson(personaCurrentStateView(target)) !== plan.currentPersonaStateSha256
        || hashJson(personaInventoryView(inventory.personas)) !== plan.personaInventorySha256
        || hashJson(toolInventoryView(inventory.tools)) !== plan.toolInventorySha256
    ) {
        throw new Error('Refusing live update: Amy, another persona, or the tool inventory changed after dry-run; no Anam write was attempted.');
    }
    return target;
}

async function assertDedicatedToolStillProductionOnly(anam, beforeTarget, item) {
    const inventory = await fetchCompleteInventories(anam);
    const target = inventory.personas.find(persona => persona.id === PINNED_IDENTITY.id);
    assertIdentity(target);
    if (stableJson(personaConcurrencyView(target)) !== stableJson(personaConcurrencyView(beforeTarget))) {
        throw new Error(`Refusing ${item.name} update: production Amy changed before the dedicated tool mutation.`);
    }
    const remote = inventory.tools.find(tool => toolId(tool) === item.currentToolId);
    if (!remote || hashJson(toolDefinitionView(remote)) !== item.currentDefinitionSha256) {
        throw new Error(`Refusing ${item.name} update: its live definition changed after planning.`);
    }
    const usages = toolUsages(inventory.personas, item.currentToolId);
    if (
        usages.length !== 1
        || usages[0].personaId !== PINNED_IDENTITY.id
        || usages[0].toolName !== item.name
    ) {
        throw new Error(`Refusing ${item.name} update: the tool is no longer dedicated to production Amy.`);
    }
}

export async function rollbackWorkbenchSync({
    anam,
    before,
    updatedToolIds,
    personaPutPerformed,
}) {
    const rollbackFailures = [];
    for (const id of updatedToolIds) {
        const original = before.tools.find(tool => toolId(tool) === id);
        if (!original) {
            rollbackFailures.push(`tool.${id}.backupMissing`);
            continue;
        }
        try {
            await anam(`/tools/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(toolDefinitionView(original)),
            });
        } catch (error) {
            rollbackFailures.push(`tool.${id}.${error instanceof Error ? error.message : 'rollbackFailed'}`);
        }
    }
    if (personaPutPerformed) {
        try {
            await anam(`/personas/${encodeURIComponent(PINNED_IDENTITY.id)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    systemPrompt: normalize(before.target.brain?.systemPrompt),
                    initialMessage: before.target.initialMessage,
                    toolIds: (before.target.tools ?? []).map(toolId),
                }),
            });
        } catch (error) {
            rollbackFailures.push(`persona.${error instanceof Error ? error.message : 'rollbackFailed'}`);
        }
    }
    if (rollbackFailures.length) {
        throw new Error(`Amy Workbench rollback request failed: ${rollbackFailures.join(', ')}`);
    }
    const restored = await fetchCompleteInventories(anam);
    const restoredTarget = restored.personas.find(persona => persona.id === PINNED_IDENTITY.id);
    if (
        !restoredTarget
        || stableJson(personaConcurrencyView(restoredTarget)) !== stableJson(personaConcurrencyView(before.target))
    ) {
        rollbackFailures.push('persona.verification');
    }
    for (const id of updatedToolIds) {
        const original = before.tools.find(tool => toolId(tool) === id);
        const current = restored.tools.find(tool => toolId(tool) === id);
        if (
            !original
            || !current
            || stableJson(toolDefinitionView(current)) !== stableJson(toolDefinitionView(original))
        ) {
            rollbackFailures.push(`tool.${id}.verification`);
        }
    }
    if (rollbackFailures.length) {
        throw new Error(`Amy Workbench rollback verification failed: ${rollbackFailures.join(', ')}`);
    }
    return {
        rollbackVerified: true,
        createdToolsRetainedUnattached: true,
    };
}

export async function applyWorkbenchSync({ anam, definitions, expectedPrompt, plan, command }) {
    if (plan.blockers.length) throw new Error(`Refusing live update: ${plan.blockers.join(' ')}`);
    if (command.confirmation !== APPLY_CONFIRMATION) {
        throw new Error(`Refusing live update: pass --confirm=${APPLY_CONFIRMATION}.`);
    }
    assertExpectedHash('expected-current-sha256', plan.currentPersonaStateSha256, command.expectedCurrentSha256);
    assertExpectedHash('expected-persona-inventory-sha256', plan.personaInventorySha256, command.expectedPersonaInventorySha256);
    assertExpectedHash('expected-tool-inventory-sha256', plan.toolInventorySha256, command.expectedToolInventorySha256);
    // Re-fetch and prove all three guarded inventories before the first live mutation.
    const preMutationInventory = await fetchCompleteInventories(anam);
    const preMutationTarget = assertFreshPlanState(preMutationInventory, plan);
    const workingBefore = { ...preMutationInventory, target: preMutationTarget };
    const backupDir = await resolveBackupDirectory(command.backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.resolve(backupDir, `amy-cara4-pre-workbench-sync-${stamp}.json`);
    await fs.writeFile(backupPath, `${JSON.stringify({
        capturedAt: new Date().toISOString(),
        targetPersona: workingBefore.target,
        completePersonaInventory: workingBefore.personas,
        completeToolInventory: workingBefore.tools,
        plan,
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

    const definitionByName = new Map(definitions.map(definition => [definition.name, definition]));
    const resolvedToolIds = new Map();
    const updatedToolIds = new Set();
    const createdToolIds = new Set();
    const recoveredToolCreateIds = new Set();
    const knownToolIds = new Set(workingBefore.tools.map(toolId));
    let personaPutPerformed = false;
    try {
        for (const item of plan.managedTools) {
            const definition = definitionByName.get(item.name);
            if (['reuse-shared-unchanged', 'reuse-dedicated-unchanged'].includes(item.action)) {
                resolvedToolIds.set(item.name, item.currentToolId);
                continue;
            }
            if (['attach-existing-dedicated-unattached', 'swap-to-existing-dedicated-unattached'].includes(item.action)) {
                const candidateId = item.exactUnattachedCandidateIds[0];
                if (!candidateId) throw new Error(`No deterministic unattached candidate exists for ${item.name}.`);
                resolvedToolIds.set(item.name, candidateId);
                continue;
            }
            if (item.action === 'update-production-only') {
                await assertDedicatedToolStillProductionOnly(anam, workingBefore.target, item);
                // Mark the write before awaiting it: a provider timeout can occur after the
                // mutation committed, so rollback must treat an unknown outcome as applied.
                updatedToolIds.add(item.currentToolId);
                await anam(`/tools/${encodeURIComponent(item.currentToolId)}`, {
                    method: 'PUT',
                    body: JSON.stringify(definition),
                });
                resolvedToolIds.set(item.name, item.currentToolId);
                continue;
            }
            const created = await createToolWithInventoryRecovery(anam, definition, knownToolIds);
            resolvedToolIds.set(item.name, created.id);
            createdToolIds.add(created.id);
            if (created.recoveredAfterCreateError) recoveredToolCreateIds.add(created.id);
            knownToolIds.add(created.id);
        }

        const preparedInventory = await fetchCompleteInventories(anam);
        const freshTarget = preparedInventory.personas.find(persona => persona.id === PINNED_IDENTITY.id);
        assertIdentity(freshTarget);
        if (stableJson(personaConcurrencyView(freshTarget)) !== stableJson(personaConcurrencyView(workingBefore.target))) {
            throw new Error('Refusing persona update: production Amy changed after tool preparation; rollback is required.');
        }
        assertOtherPersonasUnchanged(workingBefore.personas, preparedInventory.personas);
        for (const definition of definitions) {
            const resolvedId = resolvedToolIds.get(definition.name);
            const remote = preparedInventory.tools.find(tool => toolId(tool) === resolvedId);
            if (
                !remote
                || stableJson(toolDefinitionView(remote)) !== stableJson(toolDefinitionView(definition))
            ) {
                throw new Error(`Refusing persona update: ${definition.name} is not the exact managed definition.`);
            }
            const planned = plan.managedTools.find(item => item.name === definition.name);
            if (
                ['attach-existing-dedicated-unattached', 'swap-to-existing-dedicated-unattached'].includes(planned?.action)
                && toolUsages(preparedInventory.personas, resolvedId).length !== 0
            ) {
                throw new Error(`Refusing persona update: ${definition.name} unattached candidate acquired another persona usage.`);
            }
        }
        const nextToolIds = buildNextToolIds(freshTarget.tools, definitions, resolvedToolIds);
        const currentToolIds = (freshTarget.tools ?? []).map(toolId).filter(Boolean);
        const personaPutRequired = (
            sha256(normalize(freshTarget.brain?.systemPrompt)) !== sha256(expectedPrompt)
            || freshTarget.initialMessage !== AMY_INITIAL_MESSAGE
            || stableJson(currentToolIds) !== stableJson(nextToolIds)
        );
        if (personaPutRequired) {
            // Conservatively arm rollback before awaiting the persona PUT for the same
            // timeout-after-commit ambiguity as tool updates.
            personaPutPerformed = true;
            await anam(`/personas/${encodeURIComponent(PINNED_IDENTITY.id)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    systemPrompt: expectedPrompt,
                    initialMessage: AMY_INITIAL_MESSAGE,
                    toolIds: nextToolIds,
                }),
            });
        }

        const afterInventory = await fetchCompleteInventories(anam);
        const after = {
            ...afterInventory,
            target: afterInventory.personas.find(persona => persona.id === PINNED_IDENTITY.id),
        };
        verifyWorkbenchSync({
            before: workingBefore,
            after,
            definitions,
            expectedPrompt,
            resolvedToolIds,
            updatedToolIds,
            createdToolIds,
        });
        return {
            mode: 'applied-and-verified',
            mutationPerformed: personaPutPerformed || updatedToolIds.size > 0 || createdToolIds.size > 0,
            personaPutPerformed,
            backupPath,
            targetPersonaId: PINNED_IDENTITY.id,
            resolvedToolIds: Object.fromEntries(resolvedToolIds),
            updatedToolIds: [...updatedToolIds],
            createdToolIds: [...createdToolIds],
            recoveredToolCreateIds: [...recoveredToolCreateIds],
            detachedToolNames: plan.forbiddenAttachments.map(item => item.name),
            afterPersonaStateSha256: hashJson(personaCurrentStateView(after.target)),
            otherPersonasVerifiedUnchanged: true,
            unrelatedAndSharedToolsVerifiedUnchanged: true,
            protectedPersonaStateVerifiedUnchanged: true,
        };
    } catch (error) {
        const mutationPerformed = personaPutPerformed || updatedToolIds.size > 0 || createdToolIds.size > 0;
        if (!mutationPerformed) throw error;
        try {
            await rollbackWorkbenchSync({
                anam,
                before: workingBefore,
                updatedToolIds,
                personaPutPerformed,
            });
        } catch (rollbackError) {
            throw new AggregateError(
                [error, rollbackError],
                'Amy Workbench apply failed and automatic rollback could not be fully verified. Use the external backup immediately.',
            );
        }
        throw new Error(
            `Amy Workbench apply failed; the original persona and updated dedicated tools were restored and verified. Created unattached tool IDs retained for deterministic reuse: ${[...createdToolIds].join(', ') || 'none'}. ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
}

export function buildExpectedAmyPrompt({
    beforePrompt,
    naturalnessUpgrade,
    corePrompt,
    deprecatedBehavior,
    replacements,
}) {
    const normalizedBeforePrompt = normalize(beforePrompt);
    const deprecatedBehaviorResult = removeDeprecatedAmyBehaviorBlock(
        normalizedBeforePrompt,
        deprecatedBehavior,
    );
    const withFrontLoadedNaturalness = installAmyConversationBlock(
        deprecatedBehaviorResult.prompt,
        naturalnessUpgrade,
    );
    const coreResult = installAmyCoreBlock(withFrontLoadedNaturalness, corePrompt);
    const expectedPrompt = replacements.reduce(
        (prompt, [, replacement, startMarker, endMarker]) => replaceManagedBlock(
            prompt,
            replacement,
            startMarker,
            endMarker,
        ),
        coreResult.prompt,
    );
    assertManagedPrompt(expectedPrompt);
    assertNoDeprecatedAmyPromptInstructions(expectedPrompt);
    if (!expectedPrompt.startsWith(normalize(naturalnessUpgrade).trim())) {
        throw new Error('Refusing update: Amy naturalness block is not front-loaded.');
    }
    return {
        expectedPrompt,
        deprecatedLegacyBehaviorRemoved: deprecatedBehaviorResult.removed,
        legacyCoreReplaced: coreResult.legacyCoreReplaced,
    };
}

async function loadLocalInputs() {
    const [workbenchToolDefinitions, agentMailToolDefinition, identityToolDefinition] = await Promise.all([
        fs.readFile(new URL('../../config/anam/amy-workbench-client-tools.json', import.meta.url), 'utf8').then(JSON.parse),
        fs.readFile(new URL('../../config/anam/amy-agentmail-client-tool.json', import.meta.url), 'utf8').then(JSON.parse),
        fs.readFile(new URL('../../config/anam/amy-live-identity-client-tool.json', import.meta.url), 'utf8').then(JSON.parse),
    ]);
    const [
        naturalnessUpgrade,
        corePrompt,
        deprecatedBehavior,
        promptUpgrade,
        reliabilityUpgrade,
        publicSectorUpgrade,
        agentMailUpgrade,
    ] = await Promise.all([
        fs.readFile(new URL('../../config/anam/amy-conversation-naturalness-upgrade.md', import.meta.url), 'utf8').then(normalize),
        fs.readFile(new URL('../../config/anam/amy-core-system-prompt.md', import.meta.url), 'utf8').then(normalize),
        fs.readFile(new URL('../../config/anam/amy-cara4-behavior-upgrade.md', import.meta.url), 'utf8').then(normalize),
        fs.readFile(new URL('../../config/anam/amy-workbench-prompt-upgrade.md', import.meta.url), 'utf8').then(normalize),
        fs.readFile(new URL('../../config/anam/amy-cara4-reliability-upgrade.md', import.meta.url), 'utf8').then(normalize),
        fs.readFile(new URL('../../config/anam/amy-public-sector-upgrade.md', import.meta.url), 'utf8').then(normalize),
        fs.readFile(new URL('../../config/anam/amy-agentmail-prompt-upgrade.md', import.meta.url), 'utf8').then(normalize),
    ]);
    const replacements = [
        ['reliability', reliabilityUpgrade.trim(), RELIABILITY_START, RELIABILITY_END],
        ['public-sector', publicSectorUpgrade.trim(), PUBLIC_SECTOR_START, PUBLIC_SECTOR_END],
        ['Workbench', promptUpgrade.trim(), WORKBENCH_START, WORKBENCH_END],
        ['AgentMail', agentMailUpgrade.trim(), '<!-- AMY_AGENTMAIL_START -->', '<!-- AMY_AGENTMAIL_END -->'],
    ];
    for (const [label, replacement, startMarker, endMarker] of [
        ['naturalness', naturalnessUpgrade.trim(), '<!-- AMY_CONVERSATION_NATURALNESS_START -->', '<!-- AMY_CONVERSATION_NATURALNESS_END -->'],
        ['core', corePrompt.trim(), AMY_CORE_START, AMY_CORE_END],
        ...replacements,
    ]) {
        if (!replacement.includes(startMarker) || !replacement.includes(endMarker)) {
            throw new Error(`Refusing update: local Amy ${label} prompt markers are malformed or missing.`);
        }
    }
    return {
        definitions: [...workbenchToolDefinitions, agentMailToolDefinition, identityToolDefinition],
        naturalnessUpgrade: naturalnessUpgrade.trim(),
        corePrompt: corePrompt.trim(),
        deprecatedBehavior: deprecatedBehavior.trim(),
        replacements,
    };
}

function createAnamClient(apiKey, fetchImpl = fetch) {
    return async (pathname, init = {}) => {
        const response = await fetchImpl(`${API_BASE}${pathname}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                ...init.headers,
            },
            cache: 'no-store',
            signal: init.signal ?? AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 2_000);
            throw new Error(`Anam ${init.method ?? 'GET'} ${pathname} failed (${response.status}): ${detail}`);
        }
        if (response.status === 204) return null;
        return response.json();
    };
}

export async function main(argv = process.argv.slice(2)) {
    const apiKey = process.env.ANAM_API_KEY?.trim();
    const personaId = process.env.ANAM_AMY_CARA4_PERSONA_ID?.trim();
    if (!apiKey || !personaId) {
        throw new Error('ANAM_API_KEY and ANAM_AMY_CARA4_PERSONA_ID are required and are never printed.');
    }
    if (personaId !== PINNED_IDENTITY.id) {
        throw new Error('Refusing update: configured Amy persona ID is not the pinned Cara 4 identity.');
    }
    const anam = createAnamClient(apiKey);
    const local = await loadLocalInputs();
    const inventory = await fetchCompleteInventories(anam);
    const target = inventory.personas.find(persona => persona.id === PINNED_IDENTITY.id);
    assertIdentity(target);
    const beforePrompt = normalize(target.brain?.systemPrompt);
    const promptBuild = buildExpectedAmyPrompt({
        beforePrompt,
        naturalnessUpgrade: local.naturalnessUpgrade,
        corePrompt: local.corePrompt,
        deprecatedBehavior: local.deprecatedBehavior,
        replacements: local.replacements,
    });
    const { expectedPrompt } = promptBuild;
    const before = { ...inventory, target };
    const plan = buildWorkbenchSyncPlan({
        ...before,
        definitions: local.definitions,
        expectedPrompt,
    });
    const applying = argv.includes('--apply');
    if (!applying) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            mutationPerformed: false,
            ...plan,
            deprecatedLegacyBehaviorRemoved: promptBuild.deprecatedLegacyBehaviorRemoved,
            legacyCoreReplaced: promptBuild.legacyCoreReplaced,
            promptSize: {
                beforeChars: beforePrompt.length,
                expectedChars: expectedPrompt.length,
                beforeWords: beforePrompt.trim().split(/\s+/).filter(Boolean).length,
                expectedWords: expectedPrompt.trim().split(/\s+/).filter(Boolean).length,
            },
            expectedInitialMessage: AMY_INITIAL_MESSAGE,
            completeInventoryProof: {
                personas: inventory.personaMeta,
                personaDetailCount: inventory.personas.length,
                tools: inventory.toolMeta,
            },
            applyRequirements: {
                confirmation: APPLY_CONFIRMATION,
                expectedCurrentSha256: plan.currentPersonaStateSha256,
                expectedPersonaInventorySha256: plan.personaInventorySha256,
                expectedToolInventorySha256: plan.toolInventorySha256,
                absoluteBackupOutsideRepository: true,
            },
            safety: {
                changedSharedToolsAreCloned: true,
                forbiddenToolsAreDetachedOnly: true,
                globalFirstByNameSelectionAllowed: false,
                otherPersonasMayBeUpdated: false,
                toolDeletionAllowed: false,
                knowledgeToolIdIsDynamicallyPreserved: true,
                volatileSignedAvatarUrlsExcludedFromSemanticHashes: true,
            },
        }, null, 2));
        return;
    }
    const result = await applyWorkbenchSync({
        anam,
        before,
        definitions: local.definitions,
        expectedPrompt,
        plan,
        command: {
            confirmation: readOption('confirm', argv),
            expectedCurrentSha256: readOption('expected-current-sha256', argv),
            expectedPersonaInventorySha256: readOption('expected-persona-inventory-sha256', argv),
            expectedToolInventorySha256: readOption('expected-tool-inventory-sha256', argv),
            backupDir: readOption('backup-dir', argv),
        },
    });
    console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
    await main();
}
