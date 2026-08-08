import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API_BASE = 'https://api.anam.ai/v1';
export const EVAN_ID = '4b7e933a-ea04-4b84-b418-72c0762545e6';
export const JAMES_ID = '8a991c93-0c95-42c5-8c22-a67428946eb8';
export const APPLY_CONFIRMATION = 'CONFIRM_EVAN_PROMPT_ONLY';
export const ROLLBACK_CONFIRMATION = 'CONFIRM_EVAN_PROMPT_ROLLBACK';
export const REQUIRED_PROMPT_MARKERS = [
    '<!-- EVAN_ANAM_CORE_START -->',
    '<!-- EVAN_ANAM_CORE_END -->',
    '<!-- EVAN_AGENTMAIL_START -->',
    '<!-- EVAN_AGENTMAIL_END -->',
];

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const CANONICAL_PROMPT_PATH = path.join(
    PROJECT_ROOT,
    'config',
    'anam',
    'evan',
    'EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md',
);
const VOLATILE_PERSONA_KEYS = new Set([
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

function withoutPromptAndVolatile(value, pathParts = []) {
    if (Array.isArray(value)) return value.map(child => withoutPromptAndVolatile(child, pathParts));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => key !== 'systemPrompt'
                && !VOLATILE_PERSONA_KEYS.has(key)
                && !(pathParts.at(-1) === 'avatar' && VOLATILE_SIGNED_AVATAR_KEYS.has(key)))
            .map(([key, child]) => [key, withoutPromptAndVolatile(child, [...pathParts, key])]),
    );
}

export function nonPromptPersonaFingerprint(persona) {
    return sha256(canonicalJson(withoutPromptAndVolatile(persona)));
}

export function systemPromptOf(persona) {
    if (typeof persona?.brain?.systemPrompt === 'string') return persona.brain.systemPrompt;
    if (typeof persona?.systemPrompt === 'string') return persona.systemPrompt;
    throw new Error('Live Evan persona does not contain a readable system prompt.');
}

export function managedPromptOf(value) {
    return `${normalizeLineEndings(value).split('\n# TOOLS\n', 1)[0].trim()}\n`;
}

function idOf(value) {
    return value?._toolId ?? value?.id ?? null;
}

export function attachedToolIdsOf(persona) {
    if (!Array.isArray(persona?.tools)) {
        throw new Error('Live Evan persona does not contain an attached-tools list.');
    }
    const ids = persona.tools.map(idOf);
    if (ids.some(id => typeof id !== 'string' || !id.trim())) {
        throw new Error('Every attached Evan tool must have a provider ID before repair.');
    }
    if (new Set(ids).size !== ids.length) {
        throw new Error('Evan has duplicate attached tool IDs; refusing prompt repair.');
    }
    return ids;
}

export function buildPromptOnlyPersonaPayload(targetPrompt) {
    if (typeof targetPrompt !== 'string' || !targetPrompt.trim()) {
        throw new Error('Target Evan prompt is empty.');
    }
    return { systemPrompt: targetPrompt };
}

function listData(payload, keys) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
    return [];
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
        throw new Error(`Anam ${method} ${pathname} failed (${response.status}).`);
    }
    if (response.status === 204) return null;
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== 'object') {
        throw new Error(`Anam ${method} ${pathname} returned invalid JSON.`);
    }
    return result;
}

function assertIdentities(evan, james) {
    if (evan?.id !== EVAN_ID || !/evan/i.test(evan?.name ?? '') || !/mullins/i.test(evan?.name ?? '')) {
        throw new Error('Refusing prompt repair: the Evan provider identity did not match.');
    }
    if (james?.id !== JAMES_ID || !/james/i.test(james?.name ?? '') || !/knowles/i.test(james?.name ?? '')) {
        throw new Error('Refusing prompt repair: the protected James identity did not match.');
    }
    if (evan.avatarModel !== 'cara-4') {
        throw new Error('Refusing prompt repair: live Evan is not Cara 4.');
    }
}

export async function collectProviderSnapshot({ apiKey, fetchImpl = fetch, capturedAt }) {
    const [persona, protectedJames, groupsPayload] = await Promise.all([
        requestJson(`/personas/${EVAN_ID}`, { apiKey, fetchImpl }),
        requestJson(`/personas/${JAMES_ID}`, { apiKey, fetchImpl }),
        requestJson('/knowledge/groups', { apiKey, fetchImpl }),
    ]);
    assertIdentities(persona, protectedJames);

    const attachedToolIds = attachedToolIdsOf(persona);
    const attachedTools = await Promise.all(attachedToolIds.map(toolId => requestJson(
        `/tools/${encodeURIComponent(toolId)}`,
        { apiKey, fetchImpl },
    )));
    const returnedToolIds = attachedTools.map(idOf);
    if (canonicalJson(returnedToolIds) !== canonicalJson(attachedToolIds)) {
        throw new Error('Attached Evan tool read-back did not preserve provider ID order.');
    }

    const groupIds = [...new Set(attachedTools.flatMap(tool => {
        const ids = tool?.config?.documentFolderIds;
        return Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && id) : [];
    }))];
    const groups = listData(groupsPayload, ['data', 'groups']);
    const knowledgeGroups = await Promise.all(groupIds.map(async groupId => {
        const metadata = groups.find(group => group?.id === groupId);
        if (!metadata) throw new Error(`Attached Evan knowledge group ${groupId} is missing.`);
        const documentsPayload = await requestJson(
            `/knowledge/groups/${encodeURIComponent(groupId)}/documents`,
            { apiKey, fetchImpl },
        );
        return {
            metadata,
            documents: listData(documentsPayload, ['data', 'documents']),
        };
    }));

    return {
        schemaVersion: 1,
        capturedAt,
        provider: 'Anam',
        persona,
        attachedTools,
        knowledgeGroups,
        protectedJamesIdentity: {
            id: protectedJames.id,
            name: protectedJames.name,
        },
    };
}

function safeTimestamp(value) {
    return value.replace(/[:.]/g, '-');
}

function isPathInside(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function prepareBackupRunDirectory(backupDirectory, capturedAt) {
    if (!backupDirectory || !path.isAbsolute(backupDirectory)) {
        throw new Error('--backup-dir must be an explicit absolute local path.');
    }
    if (isPathInside(PROJECT_ROOT, backupDirectory)) {
        throw new Error('Backup directory must be outside the Git worktree.');
    }
    await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const runDirectory = path.join(backupDirectory, `evan-prompt-repair-${safeTimestamp(capturedAt)}`);
    await fs.mkdir(runDirectory, { recursive: false, mode: 0o700 });
    return runDirectory;
}

async function writeRestrictedFile(filename, content) {
    await fs.writeFile(filename, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

async function writeJson(filename, value) {
    await writeRestrictedFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function rollbackInstructions({ rollbackArtifactPath }) {
    return `# Evan prompt rollback\n\nThis artifact contains the managed provider prompt captured immediately before repair, without any provider-generated # TOOLS suffix. Keep it access-restricted.\n\nFrom the same reviewed Git revision, take a new provider snapshot and restore only the prior prompt:\n\n\`\`\`powershell\nnode scripts/anam/repair-evan-prompt.mjs --backup-dir <NEW_ABSOLUTE_BACKUP_DIRECTORY> --rollback-artifact "${rollbackArtifactPath}" --apply ${ROLLBACK_CONFIRMATION}\n\`\`\`\n\nThe rollback command identity-checks Evan and protected James, snapshots the then-current provider state, preserves the then-current non-prompt persona configuration, restores only the captured prompt, and performs immediate and delayed read-back verification.\n`;
}

function verifyPromptAndConfiguration({
    persona,
    expectedPromptSha256,
    expectedNonPromptFingerprint,
    requireManagedMarkers,
}) {
    if (persona?.id !== EVAN_ID) throw new Error('Evan read-back returned the wrong persona ID.');
    const prompt = managedPromptOf(systemPromptOf(persona));
    if (sha256(prompt) !== expectedPromptSha256) {
        throw new Error('Evan prompt read-back hash did not match the requested prompt.');
    }
    if (requireManagedMarkers) {
        const missing = REQUIRED_PROMPT_MARKERS.filter(marker => !prompt.includes(marker));
        if (missing.length) throw new Error(`Evan prompt read-back is missing ${missing.length} managed markers.`);
    }
    if (nonPromptPersonaFingerprint(persona) !== expectedNonPromptFingerprint) {
        throw new Error('Evan non-prompt persona configuration changed during prompt repair.');
    }
}

async function readRollbackArtifact(rollbackArtifactPath) {
    if (!rollbackArtifactPath || !path.isAbsolute(rollbackArtifactPath)) {
        throw new Error('--rollback-artifact must be an absolute path.');
    }
    const artifact = JSON.parse(await fs.readFile(rollbackArtifactPath, 'utf8'));
    if (artifact?.schemaVersion !== 1 || artifact?.personaId !== EVAN_ID) {
        throw new Error('Rollback artifact does not describe the managed Evan persona.');
    }
    if (typeof artifact.prompt !== 'string' || sha256(artifact.prompt) !== artifact.promptSha256) {
        throw new Error('Rollback artifact prompt hash is invalid.');
    }
    return artifact;
}

export async function executeEvanPromptRepair({
    apiKey,
    backupDirectory,
    applyConfirmation,
    rollbackArtifactPath,
    fetchImpl = fetch,
    delayImpl = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    now = () => new Date(),
    canonicalPromptOverride,
    logger = console,
}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
        throw new Error('ANAM_API_KEY is required and is never printed.');
    }
    const rollbackMode = Boolean(rollbackArtifactPath);
    const expectedConfirmation = rollbackMode ? ROLLBACK_CONFIRMATION : APPLY_CONFIRMATION;
    if (applyConfirmation && applyConfirmation !== expectedConfirmation) {
        throw new Error(`Invalid apply confirmation. Expected ${expectedConfirmation}.`);
    }
    const capturedAt = now().toISOString();
    const snapshot = await collectProviderSnapshot({
        apiKey: apiKey.trim(),
        fetchImpl,
        capturedAt,
    });
    const runDirectory = await prepareBackupRunDirectory(backupDirectory, capturedAt);
    const snapshotPath = path.join(runDirectory, 'provider-snapshot.json');
    await writeJson(snapshotPath, snapshot);

    const targetPrompt = managedPromptOf(rollbackMode
        ? (await readRollbackArtifact(rollbackArtifactPath)).prompt
        : canonicalPromptOverride ?? await fs.readFile(CANONICAL_PROMPT_PATH, 'utf8'));
    const currentPrompt = managedPromptOf(systemPromptOf(snapshot.persona));
    if (!rollbackMode) {
        const missingMarkers = REQUIRED_PROMPT_MARKERS.filter(marker => !targetPrompt.includes(marker));
        if (missingMarkers.length) {
            throw new Error(`Canonical Evan prompt is missing ${missingMarkers.length} managed markers.`);
        }
    }
    const expectedNonPromptFingerprint = nonPromptPersonaFingerprint(snapshot.persona);
    const targetPromptSha256 = sha256(targetPrompt);
    const payload = buildPromptOnlyPersonaPayload(targetPrompt);

    const rollbackArtifact = {
        schemaVersion: 1,
        capturedAt,
        personaId: EVAN_ID,
        sourceSnapshot: path.basename(snapshotPath),
        promptSha256: sha256(currentPrompt),
        prompt: currentPrompt,
        nonPromptPersonaFingerprint: expectedNonPromptFingerprint,
    };
    const rollbackArtifactPathWritten = path.join(runDirectory, 'rollback-artifact.json');
    await writeJson(rollbackArtifactPathWritten, rollbackArtifact);
    await writeRestrictedFile(
        path.join(runDirectory, 'ROLLBACK_INSTRUCTIONS.md'),
        rollbackInstructions({ rollbackArtifactPath: rollbackArtifactPathWritten }),
    );

    const apply = applyConfirmation === expectedConfirmation;
    const plan = {
        schemaVersion: 1,
        capturedAt,
        mode: apply ? (rollbackMode ? 'rollback-apply' : 'repair-apply') : (rollbackMode ? 'rollback-dry-run' : 'repair-dry-run'),
        personaId: EVAN_ID,
        protectedJamesPersonaId: JAMES_ID,
        providerSnapshotPath: snapshotPath,
        rollbackArtifactPath: rollbackArtifactPathWritten,
        targetPromptSha256,
        currentPromptSha256: sha256(currentPrompt),
        nonPromptPersonaFingerprint: expectedNonPromptFingerprint,
        putPayloadKeys: Object.keys(payload),
        attachedToolCount: snapshot.attachedTools.length,
        knowledgeGroupCount: snapshot.knowledgeGroups.length,
        knowledgeDocumentCount: snapshot.knowledgeGroups.reduce((total, group) => total + group.documents.length, 0),
        providerMutationPlanned: apply,
        personaPromptOnly: true,
        toolMutationPlanned: false,
        knowledgeMutationPlanned: false,
    };
    await writeJson(path.join(runDirectory, 'repair-plan.json'), plan);

    if (apply) {
        await requestJson(`/personas/${EVAN_ID}`, {
            apiKey: apiKey.trim(),
            fetchImpl,
            method: 'PUT',
            body: payload,
        });
        const immediate = await requestJson(`/personas/${EVAN_ID}`, { apiKey: apiKey.trim(), fetchImpl });
        verifyPromptAndConfiguration({
            persona: immediate,
            expectedPromptSha256: targetPromptSha256,
            expectedNonPromptFingerprint,
            requireManagedMarkers: !rollbackMode,
        });
        await delayImpl(5_000);
        const delayed = await requestJson(`/personas/${EVAN_ID}`, { apiKey: apiKey.trim(), fetchImpl });
        verifyPromptAndConfiguration({
            persona: delayed,
            expectedPromptSha256: targetPromptSha256,
            expectedNonPromptFingerprint,
            requireManagedMarkers: !rollbackMode,
        });
        plan.immediateReadbackPassed = true;
        plan.delayedReadbackPassed = true;
        await writeJson(path.join(runDirectory, 'apply-result.json'), plan);
    }

    logger.log(JSON.stringify({
        mode: plan.mode,
        personaId: EVAN_ID,
        backupDirectory: runDirectory,
        targetPromptSha256,
        currentPromptSha256: plan.currentPromptSha256,
        nonPromptPersonaFingerprint: expectedNonPromptFingerprint,
        attachedToolCount: plan.attachedToolCount,
        knowledgeGroupCount: plan.knowledgeGroupCount,
        knowledgeDocumentCount: plan.knowledgeDocumentCount,
        providerMutationPerformed: apply,
        immediateReadbackPassed: plan.immediateReadbackPassed ?? false,
        delayedReadbackPassed: plan.delayedReadbackPassed ?? false,
    }, null, 2));
    return { plan, runDirectory, payload };
}

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--backup-dir') result.backupDirectory = argv[++index];
        else if (argument.startsWith('--backup-dir=')) result.backupDirectory = argument.slice('--backup-dir='.length);
        else if (argument === '--apply') result.applyConfirmation = argv[++index];
        else if (argument.startsWith('--apply=')) result.applyConfirmation = argument.slice('--apply='.length);
        else if (argument === '--rollback-artifact') result.rollbackArtifactPath = argv[++index];
        else if (argument.startsWith('--rollback-artifact=')) result.rollbackArtifactPath = argument.slice('--rollback-artifact='.length);
        else if (argument === '--help') result.help = true;
        else throw new Error(`Unknown argument: ${argument}`);
    }
    return result;
}

async function readApiKey() {
    const localEnv = await fs.readFile(path.join(PROJECT_ROOT, '.env.local'), 'utf8').catch(() => '');
    const env = Object.fromEntries(localEnv
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
            const at = line.indexOf('=');
            return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
        }));
    return process.env.ANAM_API_KEY?.trim() || env.ANAM_API_KEY?.trim();
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(`Usage:\n  npm run anam:repair:evan-prompt -- --backup-dir <ABSOLUTE_PATH>\n  npm run anam:repair:evan-prompt -- --backup-dir <ABSOLUTE_PATH> --apply ${APPLY_CONFIRMATION}\n  npm run anam:repair:evan-prompt -- --backup-dir <ABSOLUTE_PATH> --rollback-artifact <ABSOLUTE_ARTIFACT_PATH> --apply ${ROLLBACK_CONFIRMATION}`);
        return;
    }
    await executeEvanPromptRepair({
        apiKey: await readApiKey(),
        backupDirectory: args.backupDirectory,
        applyConfirmation: args.applyConfirmation,
        rollbackArtifactPath: args.rollbackArtifactPath,
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => {
        console.error(`[Evan prompt repair] ${error instanceof Error ? error.message : 'Unknown failure'}`);
        process.exitCode = 1;
    });
}
