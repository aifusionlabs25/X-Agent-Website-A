import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const API_BASE = 'https://api.anam.ai/v1';
export const DANI_PERSONA_ID = '61f0fd3e-7937-472a-958d-cdba76b33bf1';
export const DANI_PERSONA_NAME = 'Dani X Agent Director';
export const LEGACY_IDENTITY_CLAUSE = 'You are Danny, an X Agents Sales Technician at AI Fusion Labs.';
export const CANONICAL_IDENTITY_CLAUSE = 'You are Dani, the X Agent Director at AI Fusion Labs.';
export const LEGACY_FIRST_SENTENCE_CLAUSE = 'In a new conversation, your first sentence must be exactly: Hi, I am Danny from AI Fusion Labs.';
export const CANONICAL_FIRST_SENTENCE_CLAUSE = 'In a new conversation, your first sentence must be exactly: Hi, I am Dani, the X Agent Director at AI Fusion Labs.';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const READBACK_DELAY_MS = 5_000;
const VOLATILE_KEYS = new Set([
    'createdAt',
    'created_at',
    'modifiedAt',
    'modified_at',
    'updatedAt',
    'updated_at',
]);
const VOLATILE_SIGNED_AVATAR_KEYS = new Set(['idleVideoUrl', 'videoUrl']);

export const normalizeLineEndings = value => String(value).replace(/\r\n?/g, '\n');
export const sha256 = value => crypto
    .createHash('sha256')
    .update(normalizeLineEndings(value), 'utf8')
    .digest('hex');
export const managedPromptOf = value => `${normalizeLineEndings(value).split('\n# TOOLS\n', 1)[0].trim()}\n`;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map(key => [key, canonicalize(value[key])]),
    );
}

export function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function withoutVolatile(value, pathParts = []) {
    if (Array.isArray(value)) return value.map(child => withoutVolatile(child, pathParts));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !VOLATILE_KEYS.has(key)
                && !(pathParts.at(-1) === 'avatar' && VOLATILE_SIGNED_AVATAR_KEYS.has(key)))
            .map(([key, child]) => [key, withoutVolatile(child, [...pathParts, key])]),
    );
}

function idOf(value) {
    return value?._toolId ?? value?.id ?? null;
}

function listData(payload, keys) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
    return [];
}

function sortedUniqueStrings(values) {
    return [...new Set(values.filter(value => typeof value === 'string' && value.trim()))].sort();
}

export function systemPromptOf(persona) {
    if (typeof persona?.brain?.systemPrompt === 'string' && persona.brain.systemPrompt.trim()) {
        return persona.brain.systemPrompt;
    }
    throw new Error('The Dani persona does not contain a readable system prompt.');
}

export function assertDaniIdentity(persona) {
    if (persona?.id !== DANI_PERSONA_ID) {
        throw new Error('Refusing Dani stability work: provider persona ID did not match the canonical target.');
    }
    if (persona?.name !== DANI_PERSONA_NAME) {
        throw new Error('Refusing Dani stability work: provider persona name was not exactly Dani.');
    }
    systemPromptOf(persona);
}

export function assertInitialMessageIsPromptOnlySafe(persona) {
    const initialMessage = String(persona?.initialMessage ?? '');
    if (/\bDanny\b/i.test(initialMessage) || /\bSales Technician\b/i.test(initialMessage)) {
        throw new Error('Prompt-only repair is unsafe: Dani initialMessage contains a stale identity or role.');
    }
}

function replaceExactlyOnce(prompt, legacyClause, canonicalClause, label) {
    const parts = prompt.split(legacyClause);
    if (parts.length !== 2) {
        throw new Error(`Refusing Dani prompt repair: expected exactly one ${label} legacy clause.`);
    }
    return `${parts[0]}${canonicalClause}${parts[1]}`;
}

export function deriveCorrectedPrompt(currentPrompt) {
    let corrected = replaceExactlyOnce(
        currentPrompt,
        LEGACY_IDENTITY_CLAUSE,
        CANONICAL_IDENTITY_CLAUSE,
        'identity',
    );
    corrected = replaceExactlyOnce(
        corrected,
        LEGACY_FIRST_SENTENCE_CLAUSE,
        CANONICAL_FIRST_SENTENCE_CLAUSE,
        'first-sentence',
    );
    if (/\bDanny\b/.test(corrected) || /\bSales Technician\b/i.test(corrected)) {
        throw new Error('Refusing Dani prompt repair: unrecognized legacy identity wording remains.');
    }
    return corrected;
}

export function attachedToolIdsOf(persona) {
    if (!Array.isArray(persona?.tools)) {
        throw new Error('The Dani persona does not contain an attached-tools list.');
    }
    const ids = persona.tools.map(idOf);
    if (ids.some(id => typeof id !== 'string' || !id.trim())) {
        throw new Error('Every attached Dani tool must have a provider ID.');
    }
    if (new Set(ids).size !== ids.length) {
        throw new Error('Dani has duplicate attached tool IDs.');
    }
    return [...ids].sort();
}

export function nonPromptPersonaProjection(persona) {
    const projection = clone(persona);
    if (projection?.brain && typeof projection.brain === 'object') {
        delete projection.brain.systemPrompt;
    }
    projection.attachedToolIds = attachedToolIdsOf(persona);
    delete projection.tools;
    return withoutVolatile(projection);
}

function toolProjection(attachedTools) {
    return attachedTools
        .map(tool => withoutVolatile(tool))
        .sort((left, right) => String(idOf(left)).localeCompare(String(idOf(right))));
}

function knowledgeProjection(knowledgeGroups) {
    return knowledgeGroups
        .map(group => ({
            metadata: withoutVolatile(group.metadata),
            documents: group.documents
                .map(document => withoutVolatile(document))
                .sort((left, right) => String(left?.id ?? left?.filename ?? '').localeCompare(String(right?.id ?? right?.filename ?? ''))),
        }))
        .sort((left, right) => String(left.metadata?.id ?? '').localeCompare(String(right.metadata?.id ?? '')));
}

export function fingerprintsOf(snapshot) {
    return {
        promptSha256: sha256(managedPromptOf(systemPromptOf(snapshot.persona))),
        nonPromptSha256: sha256(canonicalJson(nonPromptPersonaProjection(snapshot.persona))),
        toolsSha256: sha256(canonicalJson(toolProjection(snapshot.attachedTools))),
        knowledgeSha256: sha256(canonicalJson(knowledgeProjection(snapshot.knowledgeGroups))),
    };
}

async function requestJson(pathname, { apiKey, fetchImpl, method = 'GET', body } = {}) {
    const response = await fetchImpl(`${API_BASE}${pathname}`, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`Anam ${method} ${pathname} failed (${response.status}); response body suppressed.`);
    }
    if (response.status === 204) return {};
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== 'object') {
        throw new Error(`Anam ${method} ${pathname} returned invalid JSON.`);
    }
    return result;
}

export async function collectDaniProviderSnapshot({ apiKey, fetchImpl = fetch, capturedAt }) {
    const [persona, groupsResponse] = await Promise.all([
        requestJson(`/personas/${DANI_PERSONA_ID}`, { apiKey, fetchImpl }),
        requestJson('/knowledge/groups', { apiKey, fetchImpl }),
    ]);
    assertDaniIdentity(persona);

    const attachedToolIds = attachedToolIdsOf(persona);
    const attachedTools = await Promise.all(attachedToolIds.map(toolId => requestJson(
        `/tools/${encodeURIComponent(toolId)}`,
        { apiKey, fetchImpl },
    )));
    const returnedToolIds = attachedTools.map(idOf).sort();
    if (canonicalJson(returnedToolIds) !== canonicalJson(attachedToolIds)) {
        throw new Error('Attached Dani tool metadata did not match the persona tool IDs.');
    }

    const knowledgeFolderIds = sortedUniqueStrings(attachedTools.flatMap(tool => {
        const folderIds = tool?.config?.documentFolderIds;
        return Array.isArray(folderIds) ? folderIds : [];
    }));
    const groups = listData(groupsResponse, ['data', 'groups']);
    const knowledgeGroups = await Promise.all(knowledgeFolderIds.map(async groupId => {
        const metadata = groups.find(group => group?.id === groupId);
        if (!metadata) throw new Error(`Attached Dani knowledge group ${groupId} is missing.`);
        const documentsResponse = await requestJson(
            `/knowledge/groups/${encodeURIComponent(groupId)}/documents`,
            { apiKey, fetchImpl },
        );
        return {
            metadata,
            documentsResponse,
            documents: listData(documentsResponse, ['data', 'documents']),
        };
    }));

    return {
        schemaVersion: 1,
        capturedAt,
        provider: 'Anam',
        apiBase: API_BASE,
        persona,
        attachedTools,
        knowledgeGroupsResponse: groupsResponse,
        knowledgeGroups,
    };
}

function isPathInside(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeTimestamp(value) {
    return value.replace(/[:.]/g, '-');
}

async function prepareBackupRunDirectory(backupDirectory, capturedAt) {
    assertBackupDirectoryPath(backupDirectory);
    const runDirectory = path.join(backupDirectory, `dani-prompt-stability-${safeTimestamp(capturedAt)}`);
    await fs.mkdir(runDirectory, { recursive: false, mode: 0o700 });
    return runDirectory;
}

function assertBackupDirectoryPath(backupDirectory) {
    if (!backupDirectory || !path.isAbsolute(backupDirectory)) {
        throw new Error('--backup-dir must be an explicit absolute local path.');
    }
    if (isPathInside(PROJECT_ROOT, backupDirectory)) {
        throw new Error('Backup directory must be outside the Git worktree.');
    }
}

async function writeRestrictedFile(filename, content) {
    await fs.writeFile(filename, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

async function writeJson(filename, value) {
    await writeRestrictedFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function rollbackInstructions({ snapshotPath, promptSha256 }) {
    return `# Dani Anam prompt rollback\n\nThe protected provider snapshot at \`${snapshotPath}\` contains the complete original Dani response. The managed prompt is the portion of \`persona.brain.systemPrompt\` before the provider-generated \`\\n# TOOLS\\n\` delimiter and has SHA-256 \`${promptSha256}\`.\n\nAfter explicit external-mutation approval, restore that exact managed prompt with a sparse request only:\n\n- Endpoint: \`PUT ${API_BASE}/personas/${DANI_PERSONA_ID}\`\n- JSON body keys: exactly \`systemPrompt\`\n- Source: only the managed prompt portion from the protected snapshot; do not write the generated tools suffix back\n\nBefore rollback, take another protected snapshot. After rollback, perform immediate and delayed GET read-backs and require the restored managed-prompt hash plus unchanged non-prompt, tool, and knowledge fingerprints. Never paste or print the prompt or API credential in a shell command, log, ticket, or committed file.\n`;
}

function assertReadback({ beforeFingerprints, afterSnapshot, expectedPromptSha256, phase }) {
    assertDaniIdentity(afterSnapshot.persona);
    assertInitialMessageIsPromptOnlySafe(afterSnapshot.persona);
    const afterFingerprints = fingerprintsOf(afterSnapshot);
    if (afterFingerprints.promptSha256 !== expectedPromptSha256) {
        throw new Error(`Dani ${phase} prompt fingerprint did not match the corrected prompt.`);
    }
    for (const key of ['nonPromptSha256', 'toolsSha256', 'knowledgeSha256']) {
        if (afterFingerprints[key] !== beforeFingerprints[key]) {
            throw new Error(`Dani ${phase} changed ${key}; use the protected snapshot for recovery.`);
        }
    }
    return afterFingerprints;
}

export async function executeDaniPromptStability({
    apiKey,
    backupDirectory,
    applyPromptOnly = false,
    fetchImpl = fetch,
    delayImpl = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    now = () => new Date(),
    logger = console,
}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
        throw new Error('ANAM_API_KEY is required and is never printed.');
    }
    assertBackupDirectoryPath(backupDirectory);
    const capturedAt = now().toISOString();
    const snapshot = await collectDaniProviderSnapshot({
        apiKey: apiKey.trim(),
        fetchImpl,
        capturedAt,
    });
    const beforeFingerprints = fingerprintsOf(snapshot);
    const runDirectory = await prepareBackupRunDirectory(backupDirectory, capturedAt);
    const snapshotPath = path.join(runDirectory, 'provider-snapshot.json');
    const snapshotArtifact = {
        ...snapshot,
        fingerprints: beforeFingerprints,
        rollback: {
            method: 'PUT',
            endpoint: `${API_BASE}/personas/${DANI_PERSONA_ID}`,
            bodyKeys: ['systemPrompt'],
            promptSource: 'managed portion of persona.brain.systemPrompt before \\n# TOOLS\\n',
            originalPromptSha256: beforeFingerprints.promptSha256,
        },
    };
    await writeJson(snapshotPath, snapshotArtifact);
    await writeRestrictedFile(
        path.join(runDirectory, 'ROLLBACK_INSTRUCTIONS.md'),
        rollbackInstructions({ snapshotPath, promptSha256: beforeFingerprints.promptSha256 }),
    );

    assertInitialMessageIsPromptOnlySafe(snapshot.persona);
    const currentPrompt = managedPromptOf(systemPromptOf(snapshot.persona));
    const correctedPrompt = deriveCorrectedPrompt(currentPrompt);
    const correctedPromptSha256 = sha256(correctedPrompt);
    const plan = {
        schemaVersion: 1,
        capturedAt,
        mode: applyPromptOnly ? 'apply-prompt-only' : 'dry-run',
        personaId: DANI_PERSONA_ID,
        personaName: DANI_PERSONA_NAME,
        providerSnapshotPath: snapshotPath,
        currentPromptSha256: beforeFingerprints.promptSha256,
        correctedPromptSha256,
        nonPromptSha256: beforeFingerprints.nonPromptSha256,
        toolsSha256: beforeFingerprints.toolsSha256,
        knowledgeSha256: beforeFingerprints.knowledgeSha256,
        attachedToolCount: snapshot.attachedTools.length,
        knowledgeGroupCount: snapshot.knowledgeGroups.length,
        knowledgeDocumentCount: snapshot.knowledgeGroups.reduce((sum, group) => sum + group.documents.length, 0),
        providerMutationPlanned: applyPromptOnly,
        putBodyKeys: ['systemPrompt'],
        immediateReadbackPassed: false,
        delayedReadbackPassed: false,
    };
    await writeJson(path.join(runDirectory, 'stability-plan.json'), plan);

    if (applyPromptOnly) {
        const promptOnlyPayload = { systemPrompt: correctedPrompt };
        await requestJson(`/personas/${DANI_PERSONA_ID}`, {
            apiKey: apiKey.trim(),
            fetchImpl,
            method: 'PUT',
            body: promptOnlyPayload,
        });
        const immediate = await collectDaniProviderSnapshot({
            apiKey: apiKey.trim(),
            fetchImpl,
            capturedAt: now().toISOString(),
        });
        assertReadback({
            beforeFingerprints,
            afterSnapshot: immediate,
            expectedPromptSha256: correctedPromptSha256,
            phase: 'immediate read-back',
        });
        plan.immediateReadbackPassed = true;

        await delayImpl(READBACK_DELAY_MS);
        const delayed = await collectDaniProviderSnapshot({
            apiKey: apiKey.trim(),
            fetchImpl,
            capturedAt: now().toISOString(),
        });
        assertReadback({
            beforeFingerprints,
            afterSnapshot: delayed,
            expectedPromptSha256: correctedPromptSha256,
            phase: 'delayed read-back',
        });
        plan.delayedReadbackPassed = true;
        await writeJson(path.join(runDirectory, 'apply-result.json'), plan);
    }

    const publicResult = {
        mode: plan.mode,
        personaId: DANI_PERSONA_ID,
        personaName: DANI_PERSONA_NAME,
        backupDirectory: runDirectory,
        currentPromptSha256: plan.currentPromptSha256,
        correctedPromptSha256,
        nonPromptSha256: plan.nonPromptSha256,
        toolsSha256: plan.toolsSha256,
        knowledgeSha256: plan.knowledgeSha256,
        attachedToolCount: plan.attachedToolCount,
        knowledgeGroupCount: plan.knowledgeGroupCount,
        knowledgeDocumentCount: plan.knowledgeDocumentCount,
        providerMutationPerformed: applyPromptOnly,
        immediateReadbackPassed: plan.immediateReadbackPassed,
        delayedReadbackPassed: plan.delayedReadbackPassed,
    };
    logger.log(JSON.stringify(publicResult, null, 2));
    return { plan, publicResult, runDirectory };
}

export function parseArgs(argv) {
    const result = { applyPromptOnly: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--backup-dir') {
            result.backupDirectory = argv[++index];
            if (!result.backupDirectory) throw new Error('--backup-dir requires a path.');
        } else if (argument.startsWith('--backup-dir=')) {
            result.backupDirectory = argument.slice('--backup-dir='.length);
        } else if (argument === '--apply-prompt-only') {
            result.applyPromptOnly = true;
        } else if (argument === '--help') {
            result.help = true;
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    return result;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log('Usage:\n  npm run anam:stability:dani -- --backup-dir <ABSOLUTE_NON_REPO_PATH>\n  npm run anam:stability:dani -- --backup-dir <ABSOLUTE_NON_REPO_PATH> --apply-prompt-only');
        return;
    }
    await executeDaniPromptStability({
        apiKey: process.env.ANAM_API_KEY,
        backupDirectory: args.backupDirectory,
        applyPromptOnly: args.applyPromptOnly,
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => {
        console.error(`[Dani prompt stability] ${error instanceof Error ? error.message : 'Unknown failure'}`);
        process.exitCode = 1;
    });
}
