import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    cleanupAmyAnamHermesLocalOutputs,
    readAmyAnamHermesLocalOutputConfig,
} from './amy-anam-shadow-local-output.mjs';

const SAFE_FAILURE_MESSAGE = 'Amy Anam Hermes local cleanup failed safely';

export async function runAmyAnamHermesLocalCleanup(source = process.env, options = {}) {
    // Only these two non-secret values enter the cleanup configuration. The
    // cleanup path does not load Anam, Redis, Hermes, email, or worker secrets.
    const config = readAmyAnamHermesLocalOutputConfig({
        AMY_ANAM_HERMES_WORKER_OUTPUT_DIR: source.AMY_ANAM_HERMES_WORKER_OUTPUT_DIR,
        AMY_ANAM_HERMES_OUTPUT_RETENTION_HOURS: source.AMY_ANAM_HERMES_OUTPUT_RETENTION_HOURS,
    });
    return cleanupAmyAnamHermesLocalOutputs({
        outputDir: config.outputDir,
        retentionMs: config.retentionMs,
        now: options.now,
        unlinkImpl: options.unlinkImpl,
    });
}

export function amyAnamHermesLocalCleanupExitCode(summary) {
    if (!summary?.ok) return 2;
    // A concurrent writer is safe to skip, but it is not a completed retention
    // pass. A scheduler can use this distinct code to retry shortly.
    if (summary.busy) return 3;
    return 0;
}

async function main() {
    const summary = await runAmyAnamHermesLocalCleanup();
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    const exitCode = amyAnamHermesLocalCleanupExitCode(summary);
    if (exitCode !== 0) process.exitCode = exitCode;
}

// Registration with Windows Task Scheduler is deliberately outside this CLI.
// It is an approval-gated machine-state change. A powered-off machine or a
// disabled scheduler also remains outside any enforceable wall-clock guarantee.
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
    main().catch(() => {
        process.stderr.write(`${SAFE_FAILURE_MESSAGE}\n`);
        process.exitCode = 1;
    });
}
