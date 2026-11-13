import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    buildEvanDemoClonePayload, assertEvanDemoCloneMatches, evanDemoPersonaBehavior,
    evanDemoToolBehavior, assertEvanDemoToolMatches, buildEvanDemoPlannerToolPayload,
    expectedEvanDemoCheckpoint, EVAN_DEMO_CHECKPOINT, EVAN_DEMO_SOURCE_PERSONA_ID,
    EVAN_DEMO_ORIGINAL_PERSONA_ID, EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID,
} from '../../lib/anam/evan-demo-persona.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_RECEIPT = resolve(ROOT, '.vercel/evan-6097-duration-release.json');
const PROTECTED_IDS = [EVAN_DEMO_SOURCE_PERSONA_ID, EVAN_DEMO_ORIGINAL_PERSONA_ID];
export const EVAN_DEMO_TARGETS = Object.freeze([
    Object.freeze({ id: EVAN_DEMO_PUBLIC_PERSONA_ID, seconds: 180, name: 'Evan — public three-minute demo' }),
    Object.freeze({ id: EVAN_DEMO_EXTENDED_PERSONA_ID, seconds: 1800, name: 'Evan — protected longer demo' }),
]);

function stable(value) {
    return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const sourceFingerprint = persona => hash({
    behavior: evanDemoPersonaBehavior(persona),
    fullPrompt: persona.brain?.systemPrompt,
    maxSessionLengthSeconds: persona.maxSessionLengthSeconds ?? null,
});
const idOf = value => value?._toolId ?? value?.id;
const validId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

export function parseEvanDemoPreparationArgs(args) {
    if (args.some(arg => arg !== '--apply' && arg !== '--help') || new Set(args).size !== args.length) {
        throw new Error('Only --apply or --help are supported. Dry-run is the default.');
    }
    return { apply: args.includes('--apply'), help: args.includes('--help') };
}

function saveReceipt(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
}

/** Only the two explicitly created, unused Lab copies can be written. This
 * script never writes a source persona, shared tool, knowledge file, or alias. */
export async function prepareEvanDurationCopies({
    apply = false, apiKey, fetchImpl = fetch, receiptFile = DEFAULT_RECEIPT,
    log = value => console.log(JSON.stringify(value)),
} = {}) {
    if (!apiKey) throw new Error('ANAM_API_KEY is required');
    const source = expectedEvanDemoCheckpoint();
    const checkpointHash = hash({ metadata: EVAN_DEMO_CHECKPOINT, behavior: evanDemoPersonaBehavior(source) });
    const receipt = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, 'utf8')) : {
        schemaVersion: 1, checkpointHash, sourceId: EVAN_DEMO_SOURCE_PERSONA_ID,
        protectedSources: {}, plannerToolId: null, pendingToolCreation: false, clones: [],
    };
    if (receipt.schemaVersion !== 1 || receipt.checkpointHash !== checkpointHash || receipt.sourceId !== source.id) {
        throw new Error('Provisioning receipt does not match the frozen checkpoint; review before applying');
    }
    if (!Array.isArray(receipt.clones) || receipt.clones.some(item => !EVAN_DEMO_TARGETS.some(target => target.id === item.id && target.seconds === item.seconds))) {
        throw new Error('Provisioning receipt contains an unapproved target');
    }
    if (receipt.plannerToolId != null && !validId(receipt.plannerToolId)) throw new Error('Invalid isolated planner receipt');
    if (receipt.pendingToolCreation && !receipt.plannerToolId) {
        throw new Error('A tool creation has an unknown outcome; inspect Anam before retrying to avoid duplicates');
    }

    const allowedGets = new Set([
        ...PROTECTED_IDS.map(id => `/personas/${id}`),
        ...EVAN_DEMO_TARGETS.map(target => `/personas/${target.id}`),
        ...source.tools.map(tool => `/tools/${idOf(tool)}`),
        ...(receipt.plannerToolId ? [`/tools/${receipt.plannerToolId}`] : []),
    ]);
    async function request(path, { method = 'GET', body } = {}) {
        if (method === 'GET' && !allowedGets.has(path)) throw new Error('Unapproved lookup target');
        if (method === 'PUT' && !EVAN_DEMO_TARGETS.some(target => path === `/personas/${target.id}`)) throw new Error('Refusing protected persona mutation');
        if (method === 'POST' && (path !== '/tools' || stable(body) !== stable(buildEvanDemoPlannerToolPayload(source)))) throw new Error('Refusing unapproved tool creation');
        if (!['GET', 'POST', 'PUT'].includes(method)) throw new Error('Unsupported operation');
        if (method !== 'GET' && !apply) throw new Error('Dry-run cannot mutate Anam');
        const response = await fetchImpl(`https://api.anam.ai/v1${path}`, {
            method, headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`Anam ${method} failed (${response.status})`);
        return response.json();
    }

    const protectedBefore = new Map();
    for (const id of PROTECTED_IDS) {
        const persona = await request(`/personas/${id}`);
        if (persona.id !== id) throw new Error('Protected source lookup identity mismatch');
        protectedBefore.set(id, persona);
        const currentHash = sourceFingerprint(persona);
        if (receipt.protectedSources[id] && receipt.protectedSources[id] !== currentHash) {
            throw new Error('A protected source changed since the previous provisioning run; review required');
        }
        receipt.protectedSources[id] = currentHash;
    }
    async function verifySourcesUnchanged() {
        for (const id of PROTECTED_IDS) {
            if (sourceFingerprint(await request(`/personas/${id}`)) !== receipt.protectedSources[id]) {
                throw new Error('A protected source changed during preparation; stop and inspect');
            }
        }
    }
    const expectedPlanner = source.tools.find(tool => tool.name === 'show_move_planner');
    const currentPlanner = protectedBefore.get(EVAN_DEMO_SOURCE_PERSONA_ID).tools?.find(tool => tool.name === 'show_move_planner');
    const plannerChanged = !currentPlanner || stable(evanDemoToolBehavior(currentPlanner)) !== stable(evanDemoToolBehavior(expectedPlanner));
    let plannerToolId = receipt.plannerToolId;
    try {
        if (plannerToolId) {
            assertEvanDemoToolMatches(expectedPlanner, await request(`/tools/${plannerToolId}`));
        } else if (!plannerChanged) {
            if (idOf(currentPlanner) !== idOf(expectedPlanner)) throw new Error('Current planner identity differs from the checkpoint');
            plannerToolId = idOf(expectedPlanner);
        } else if (apply) {
            await verifySourcesUnchanged();
            receipt.pendingToolCreation = true;
            saveReceipt(receiptFile, receipt);
            const created = await request('/tools', { method: 'POST', body: buildEvanDemoPlannerToolPayload(source) });
            if (!validId(created.id) || source.tools.some(tool => idOf(tool) === created.id)) throw new Error('Provider returned invalid isolated tool identity');
            plannerToolId = created.id;
            receipt.plannerToolId = plannerToolId;
            receipt.pendingToolCreation = false;
            saveReceipt(receiptFile, receipt);
            allowedGets.add(`/tools/${plannerToolId}`);
            assertEvanDemoToolMatches(expectedPlanner, await request(`/tools/${plannerToolId}`));
        }
        if (!apply) log({ mode: 'dry-run', checkpoint: EVAN_DEMO_CHECKPOINT.sourceCommit, createHistoricalPlannerTool: plannerChanged && !plannerToolId });

        for (const target of EVAN_DEMO_TARGETS) {
            const before = await request(`/personas/${target.id}`);
            if (before.id !== target.id) throw new Error('Target copy identity mismatch');
            const payload = buildEvanDemoClonePayload({ source, name: target.name,
                description: `Isolated Run57 Evan ${target.seconds}s demo; not website production.`,
                maxSessionLengthSeconds: target.seconds,
                ...(plannerToolId ? { plannerToolId } : {}),
            });
            let alreadyVerified = false;
            if (plannerToolId) {
                try { assertEvanDemoCloneMatches({ source, clone: before, expectedCloneId: target.id,
                    maxSessionLengthSeconds: target.seconds, plannerToolId }); alreadyVerified = true; } catch { /* Planned repair below. */ }
            }
            if (!apply) {
                log({ mode: 'dry-run', id: target.id, seconds: target.seconds, operation: alreadyVerified ? 'verify-only' : 'update-existing-isolated-copy', checkpointHash, toolCount: payload.toolIds.length });
                continue;
            }
            let after = before;
            if (!alreadyVerified) {
                await verifySourcesUnchanged();
                const row = receipt.clones.find(item => item.id === target.id);
                if (!row) receipt.clones.push({ id: target.id, seconds: target.seconds, verified: false });
                else row.verified = false;
                saveReceipt(receiptFile, receipt);
                await request(`/personas/${target.id}`, { method: 'PUT', body: {
                    ...payload, ...(typeof before.updatedAt === 'string' ? { expectedUpdatedAt: before.updatedAt } : {}),
                } });
                after = await request(`/personas/${target.id}`);
            }
            assertEvanDemoCloneMatches({ source, clone: after, expectedCloneId: target.id, maxSessionLengthSeconds: target.seconds, plannerToolId });
            const row = receipt.clones.find(item => item.id === target.id);
            if (row) row.verified = true;
            else receipt.clones.push({ id: target.id, seconds: target.seconds, verified: true });
            receipt.plannerToolId = plannerToolId;
            saveReceipt(receiptFile, receipt);
            log({ id: target.id, seconds: target.seconds, verified: true, operation: alreadyVerified ? 'verify-only' : 'updated-isolated-copy' });
        }
    } finally {
        await verifySourcesUnchanged();
        log({ protectedSourcesUnchanged: true, mode: apply ? 'apply' : 'dry-run' });
    }
    return { checkpointHash, plannerToolId, clones: structuredClone(receipt.clones) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const options = parseEvanDemoPreparationArgs(process.argv.slice(2));
    if (options.help) console.log('Usage: node scripts/anam/prepare-evan-duration-clones.mjs [--apply]\nDry-run by default. Only updates the two pinned unused copies; never a source persona.');
    else await prepareEvanDurationCopies({ apply: options.apply, apiKey: process.env.ANAM_API_KEY });
}
