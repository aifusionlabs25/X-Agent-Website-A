import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
    AMY_ANAM_HERMES_WORKER_BRIDGE_MAX_BODY_BYTES,
    AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
    normalizeAmyAnamHermesWorkerRetirementResponse,
    normalizeAmyAnamHermesWorkerStatusResponse,
    readAmyAnamHermesWorkerBridgeConfig,
} from '../../lib/anam/hermes-worker-bridge.ts';
import { AMY_ANAM_HERMES_STALE_RETIREMENT_CONFIRMATION } from '../../lib/anam/hermes-shadow-store.ts';

const REQUEST_TIMEOUT_MS = 15_000;

function exactArgumentValue(args, prefix) {
    const matches = args.filter(argument => argument.startsWith(prefix));
    if (matches.length > 1) throw new Error(`Duplicate ${prefix.slice(2, -1)} argument`);
    return matches[0]?.slice(prefix.length) ?? '';
}

export function readAmyAnamHermesBacklogCommand(args = process.argv.slice(2)) {
    const allowed = new Set(['--apply']);
    for (const argument of args) {
        if (argument.startsWith('--cutoff=')) continue;
        if (argument.startsWith('--expected-snapshot-digest=')) continue;
        if (argument.startsWith('--confirm=')) continue;
        if (!allowed.has(argument)) throw new Error(`Unsupported argument: ${argument}`);
    }
    const cutoffValue = exactArgumentValue(args, '--cutoff=');
    const cutoffTimestamp = Date.parse(cutoffValue);
    if (!cutoffValue || !Number.isFinite(cutoffTimestamp)) {
        throw new Error('--cutoff=<ISO timestamp> is required');
    }
    const cutoff = new Date(cutoffTimestamp).toISOString();
    const apply = args.includes('--apply');
    const expectedSnapshotDigest = exactArgumentValue(args, '--expected-snapshot-digest=');
    const confirmation = exactArgumentValue(args, '--confirm=');
    if (!apply && (expectedSnapshotDigest || confirmation)) {
        throw new Error('Digest and confirmation are accepted only with --apply');
    }
    if (apply) {
        if (!/^[a-f0-9]{64}$/.test(expectedSnapshotDigest)) {
            throw new Error('--expected-snapshot-digest=<64-character SHA-256> is required with --apply');
        }
        if (confirmation !== AMY_ANAM_HERMES_STALE_RETIREMENT_CONFIRMATION) {
            throw new Error(`--confirm=${AMY_ANAM_HERMES_STALE_RETIREMENT_CONFIRMATION} is required with --apply`);
        }
    }
    return { apply, cutoff, expectedSnapshotDigest, confirmation };
}

async function postBridge(body, options = {}) {
    const config = readAmyAnamHermesWorkerBridgeConfig(options.env ?? process.env);
    if (!config.clientConfigured) {
        throw new Error('Amy Anam Hermes worker bridge is not configured');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await (options.fetchImpl ?? fetch)(config.bridgeUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.secret}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
        });
        if (!response.ok) throw new Error('Amy Anam Hermes backlog request was rejected');
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > AMY_ANAM_HERMES_WORKER_BRIDGE_MAX_BODY_BYTES) {
            throw new Error('Amy Anam Hermes backlog response was too large');
        }
        return JSON.parse(raw);
    } finally {
        clearTimeout(timeout);
    }
}

export async function runAmyAnamHermesBacklogCommand(command, options = {}) {
    if (!command.apply) {
        const response = await postBridge({
            operation: 'status',
            protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
            cutoff: command.cutoff,
        }, options);
        return normalizeAmyAnamHermesWorkerStatusResponse(response);
    }
    const response = await postBridge({
        operation: 'retire_stale',
        protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
        cutoff: command.cutoff,
        expectedSnapshotDigest: command.expectedSnapshotDigest,
        confirmation: command.confirmation,
    }, options);
    return normalizeAmyAnamHermesWorkerRetirementResponse(response);
}

async function main() {
    const command = readAmyAnamHermesBacklogCommand();
    const result = await runAmyAnamHermesBacklogCommand(command);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain = process.argv[1]
    && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'Amy Hermes backlog command failed'}\n`);
        process.exitCode = 1;
    });
}
