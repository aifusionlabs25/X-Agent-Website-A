import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
    access,
    link,
    mkdir,
    readFile,
    readdir,
    rm,
    stat,
    symlink,
    utimes,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
    AMY_ANAM_HERMES_LOCAL_OUTPUT_RETENTION_MS,
    AMY_ANAM_HERMES_LOCAL_OUTPUT_VERSION,
    cleanupAmyAnamHermesLocalOutputs,
    publishAmyAnamHermesLocalOutput,
    readAmyAnamHermesLocalOutputConfig,
} from '../scripts/hermes/amy-anam-shadow-local-output.mjs';
import {
    amyAnamHermesLocalCleanupExitCode,
    runAmyAnamHermesLocalCleanup,
} from '../scripts/hermes/amy-anam-shadow-cleanup.mjs';
import {
    amyAnamHermesShadowWorkerExitCode,
    processOneAmyAnamHermesShadowJob,
} from '../scripts/hermes/amy-anam-shadow-worker.mjs';

const JOB_ID = 'a'.repeat(64);
const CONTENTS = Buffer.from('{"safe":"local shadow output"}\n', 'utf8');
const OUTPUT_SHA256 = createHash('sha256')
    .update(JSON.stringify(JSON.parse(CONTENTS.toString('utf8'))))
    .digest('hex');

async function makeOutputDir(t, create = true) {
    const outputDir = resolve(tmpdir(), `amy-anam-local-output-${randomUUID()}`);
    if (create) await mkdir(outputDir);
    t.after(() => rm(outputDir, { recursive: true, force: true }));
    return outputDir;
}

function finalPath(outputDir, jobId = JOB_ID, outputSha256 = OUTPUT_SHA256) {
    return resolve(outputDir, `${jobId}.${outputSha256}.json`);
}

async function pathExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

test('secret-free local config has a fixed 24-hour maximum', () => {
    assert.equal(AMY_ANAM_HERMES_LOCAL_OUTPUT_RETENTION_MS, 24 * 60 * 60 * 1000);
    assert.equal(readAmyAnamHermesLocalOutputConfig({}).retentionMs, 24 * 60 * 60 * 1000);
    assert.equal(readAmyAnamHermesLocalOutputConfig({
        AMY_ANAM_HERMES_OUTPUT_RETENTION_HOURS: '4',
    }).retentionMs, 4 * 60 * 60 * 1000);
    assert.throws(
        () => readAmyAnamHermesLocalOutputConfig({
            AMY_ANAM_HERMES_OUTPUT_RETENTION_HOURS: '25',
        }),
        error => error.code === 'local_output_config_invalid',
    );
    assert.throws(
        () => readAmyAnamHermesLocalOutputConfig({
            AMY_ANAM_HERMES_WORKER_OUTPUT_DIR: resolve(tmpdir(), '..', 'outside-temp'),
        }),
        error => error.code === 'local_output_config_invalid',
    );
});

test('exclusive synced publication is complete and exact collisions are idempotent', async (t) => {
    const outputDir = await makeOutputDir(t);
    const first = await publishAmyAnamHermesLocalOutput({
        outputDir,
        jobId: JOB_ID,
        outputSha256: OUTPUT_SHA256,
        contents: CONTENTS,
    });
    assert.equal(first.schemaVersion, AMY_ANAM_HERMES_LOCAL_OUTPUT_VERSION);
    assert.equal(first.created, true);
    assert.equal(first.idempotent, false);
    assert.deepEqual(await readFile(first.outputPath), CONTENTS);

    const second = await publishAmyAnamHermesLocalOutput({
        outputDir,
        jobId: JOB_ID,
        outputSha256: OUTPUT_SHA256,
        contents: CONTENTS,
    });
    assert.equal(second.created, false);
    assert.equal(second.idempotent, true);
    assert.deepEqual(await readFile(second.outputPath), CONTENTS);
    assert.deepEqual(
        (await readdir(outputDir)).filter(name => name.endsWith('.tmp')),
        [],
    );
});

test('publication rejects contents that do not match the filename hash', async (t) => {
    const outputDir = await makeOutputDir(t);
    await assert.rejects(
        publishAmyAnamHermesLocalOutput({
            outputDir,
            jobId: JOB_ID,
            outputSha256: 'f'.repeat(64),
            contents: CONTENTS,
        }),
        error => error.code === 'local_output_invalid',
    );
    assert.deepEqual(await readdir(outputDir), []);
});

test('concurrent matching writers yield one atomic publication and one exact idempotent result', async (t) => {
    const outputDir = await makeOutputDir(t);
    const results = await Promise.all([
        publishAmyAnamHermesLocalOutput({
            outputDir,
            jobId: JOB_ID,
            outputSha256: OUTPUT_SHA256,
            contents: CONTENTS,
        }),
        publishAmyAnamHermesLocalOutput({
            outputDir,
            jobId: JOB_ID,
            outputSha256: OUTPUT_SHA256,
            contents: CONTENTS,
        }),
    ]);
    assert.deepEqual(results.map(result => result.created).sort(), [false, true]);
    assert.deepEqual(await readFile(finalPath(outputDir)), CONTENTS);
    assert.equal((await readdir(outputDir)).length, 1);
});

test('wrong bytes, directories, and hard links at the final name fail as collisions', async (t) => {
    const cases = ['wrong-bytes', 'directory', 'hard-link'];
    for (const [index, scenario] of cases.entries()) {
        const outputDir = resolve(tmpdir(), `amy-anam-collision-${randomUUID()}`);
        await mkdir(outputDir);
        t.after(() => rm(outputDir, { recursive: true, force: true }));
        const jobId = String(index + 1).repeat(64);
        const outputSha256 = OUTPUT_SHA256;
        const target = finalPath(outputDir, jobId, outputSha256);
        if (scenario === 'wrong-bytes') await writeFile(target, 'not the expected output', 'utf8');
        if (scenario === 'directory') await mkdir(target);
        if (scenario === 'hard-link') {
            const source = resolve(outputDir, 'source.txt');
            await writeFile(source, CONTENTS);
            await link(source, target);
        }

        await assert.rejects(
            publishAmyAnamHermesLocalOutput({
                outputDir,
                jobId,
                outputSha256,
                contents: CONTENTS,
            }),
            error => error.code === 'local_output_collision',
        );
    }
});

test('a pre-planted directory junction is rejected and its target remains untouched', async (t) => {
    const outputDir = await makeOutputDir(t, false);
    const junctionTarget = resolve(tmpdir(), `amy-anam-junction-target-${randomUUID()}`);
    await mkdir(junctionTarget);
    t.after(() => rm(junctionTarget, { recursive: true, force: true }));
    try {
        await symlink(junctionTarget, outputDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (error?.code === 'EPERM') {
            t.skip('This Windows host does not permit creating a test junction');
            return;
        }
        throw error;
    }

    await assert.rejects(
        publishAmyAnamHermesLocalOutput({
            outputDir,
            jobId: JOB_ID,
            outputSha256: OUTPUT_SHA256,
            contents: CONTENTS,
        }),
        error => error.code === 'local_output_root_unsafe',
    );
    assert.deepEqual(await readdir(junctionTarget), []);
});

test('independent cleanup does not create an absent root', async (t) => {
    const outputDir = await makeOutputDir(t, false);
    const summary = await cleanupAmyAnamHermesLocalOutputs({ outputDir });
    assert.equal(summary.rootPresent, false);
    assert.equal(summary.deleted, 0);
    assert.equal(summary.contentIncluded, false);
    assert.equal(await pathExists(outputDir), false);
});

test('independent cleanup deletes expired final and stale temp artifacts without a worker job', async (t) => {
    const outputDir = await makeOutputDir(t);
    const now = Date.now();
    await publishAmyAnamHermesLocalOutput({
        outputDir,
        jobId: JOB_ID,
        outputSha256: OUTPUT_SHA256,
        contents: CONTENTS,
    });
    const staleTemp = resolve(
        outputDir,
        `.${'c'.repeat(64)}.${'d'.repeat(64)}.${randomUUID()}.tmp`,
    );
    await writeFile(staleTemp, 'stale temporary output', 'utf8');
    const expiredAt = new Date(now - AMY_ANAM_HERMES_LOCAL_OUTPUT_RETENTION_MS - 1);
    const staleTempAt = new Date(now - 2 * 60 * 60 * 1000);
    await utimes(finalPath(outputDir), expiredAt, expiredAt);
    await utimes(staleTemp, staleTempAt, staleTempAt);

    const summary = await cleanupAmyAnamHermesLocalOutputs({ outputDir, now });
    assert.equal(summary.ok, true);
    assert.equal(summary.deleted, 2);
    assert.equal(summary.contentIncluded, false);
    assert.equal(await pathExists(finalPath(outputDir)), false);
    assert.equal(await pathExists(staleTemp), false);
});

test('cleanup recovers an interrupted hard-link publication before retention processing', async (t) => {
    const outputDir = await makeOutputDir(t);
    const tempPath = resolve(
        outputDir,
        `.${JOB_ID}.${OUTPUT_SHA256}.${randomUUID()}.tmp`,
    );
    const publishedPath = finalPath(outputDir);
    await writeFile(tempPath, CONTENTS);
    await link(tempPath, publishedPath);
    const staleLock = resolve(outputDir, '.amy-anam-local-output.lock');
    await writeFile(staleLock, JSON.stringify({
        schemaVersion: 'amy_anam_hermes_local_operation_lock_v1',
        pid: 999999,
        createdAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    }));
    const staleLockAt = new Date(Date.now() - 6 * 60 * 1000);
    await utimes(staleLock, staleLockAt, staleLockAt);
    assert.equal((await stat(tempPath)).nlink, 2);
    assert.equal((await stat(publishedPath)).nlink, 2);

    const recovered = await cleanupAmyAnamHermesLocalOutputs({
        outputDir,
        processAliveImpl: () => false,
    });
    assert.equal(recovered.ok, true);
    assert.equal(recovered.recovered, 1);
    assert.equal(recovered.deleted, 1);
    assert.equal(recovered.unsafe, 0);
    assert.equal(await pathExists(staleLock), false);
    assert.equal(await pathExists(tempPath), false);
    assert.equal((await stat(publishedPath)).nlink, 1);
    assert.deepEqual(await readFile(publishedPath), CONTENTS);

    const expiredAt = new Date(Date.now() - AMY_ANAM_HERMES_LOCAL_OUTPUT_RETENTION_MS - 1);
    await utimes(publishedPath, expiredAt, expiredAt);
    const retainedCleanup = await cleanupAmyAnamHermesLocalOutputs({
        outputDir,
        now: Date.now(),
    });
    assert.equal(retainedCleanup.ok, true);
    assert.equal(retainedCleanup.deleted, 1);
    assert.equal(await pathExists(publishedPath), false);
});

test('independent cleanup skips safely while another local output operation holds the lock', async (t) => {
    const outputDir = await makeOutputDir(t);
    const artifact = finalPath(outputDir);
    await writeFile(artifact, CONTENTS);
    const expiredAt = new Date(Date.now() - AMY_ANAM_HERMES_LOCAL_OUTPUT_RETENTION_MS - 1);
    await utimes(artifact, expiredAt, expiredAt);
    const liveLock = resolve(outputDir, '.amy-anam-local-output.lock');
    await writeFile(liveLock, JSON.stringify({
        schemaVersion: 'amy_anam_hermes_local_operation_lock_v1',
        pid: process.pid,
        createdAt: new Date().toISOString(),
    }));
    const apparentlyStaleAt = new Date(Date.now() - 6 * 60 * 1000);
    await utimes(liveLock, apparentlyStaleAt, apparentlyStaleAt);

    const summary = await cleanupAmyAnamHermesLocalOutputs({ outputDir });
    assert.equal(summary.ok, true);
    assert.equal(summary.busy, true);
    assert.equal(summary.scanned, 0);
    assert.equal(summary.deleted, 0);
    assert.equal(amyAnamHermesLocalCleanupExitCode(summary), 3);
    assert.equal(await pathExists(artifact), true);
    assert.equal(await pathExists(liveLock), true);
});

test('worker refuses to claim or spawn while local output cleanup is busy', async (t) => {
    const outputDir = await makeOutputDir(t);
    const hermesHome = resolve(tmpdir(), `amy-anam-busy-home-${randomUUID()}`);
    t.after(() => rm(hermesHome, { recursive: true, force: true }));
    await writeFile(resolve(outputDir, '.amy-anam-local-output.lock'), JSON.stringify({
        schemaVersion: 'amy_anam_hermes_local_operation_lock_v1',
        pid: process.pid,
        createdAt: new Date().toISOString(),
    }));
    let claimCalls = 0;
    let spawnCalls = 0;
    const env = {
        AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
        AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
        AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
        AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
        AMY_ANAM_HERMES_WORKER_BRIDGE_URL: 'https://preview.example.test/api/anam/hermes/worker',
        AMY_ANAM_HERMES_WORKER_SECRET: 'b'.repeat(32),
        AMY_ANAM_HERMES_WORKER_OUTPUT_DIR: outputDir,
        AMY_ANAM_HERMES_HOME: hermesHome,
        AMY_ANAM_HERMES_PROVIDER: 'openai-codex',
        AMY_ANAM_HERMES_MODEL: 'gpt-5.5',
        AMY_ANAM_HERMES_PYTHON_COMMAND: 'C:\\safe-bin\\python.exe',
        ANAM_API_KEY: 'local-anam-key',
    };

    const result = await processOneAmyAnamHermesShadowJob({
        env,
        bridgeFetchImpl: async () => {
            claimCalls += 1;
            throw new Error('claim must not happen');
        },
        spawnImpl: () => {
            spawnCalls += 1;
            throw new Error('spawn must not happen');
        },
    });
    assert.deepEqual(result, {
        found: false,
        processed: false,
        status: 'local_output_busy',
        contentIncluded: false,
    });
    assert.equal(amyAnamHermesShadowWorkerExitCode(result, true), 3);
    assert.equal(amyAnamHermesShadowWorkerExitCode(result, false), 0);
    assert.equal(claimCalls, 0);
    assert.equal(spawnCalls, 0);
});

test('cleanup retains fresh files and safely reports future, hard-link, symlink, and locked anomalies', async (t) => {
    const outputDir = await makeOutputDir(t);
    const now = Date.now();
    const names = {
        fresh: `${'1'.repeat(64)}.${'2'.repeat(64)}.json`,
        future: `${'3'.repeat(64)}.${'4'.repeat(64)}.json`,
        hard: `${'5'.repeat(64)}.${'6'.repeat(64)}.json`,
        linked: `${'7'.repeat(64)}.${'8'.repeat(64)}.json`,
        locked: `${'9'.repeat(64)}.${'0'.repeat(64)}.json`,
    };
    for (const name of [names.fresh, names.future, names.hard, names.locked]) {
        await writeFile(resolve(outputDir, name), CONTENTS);
    }
    await link(resolve(outputDir, names.hard), resolve(outputDir, 'second-hard-link.txt'));
    const symlinkTarget = resolve(outputDir, 'symlink-target.txt');
    await writeFile(symlinkTarget, CONTENTS);
    let symlinkCreated = true;
    try {
        await symlink(symlinkTarget, resolve(outputDir, names.linked), 'file');
    } catch (error) {
        if (error?.code === 'EPERM') symlinkCreated = false;
        else throw error;
    }
    const old = new Date(now - AMY_ANAM_HERMES_LOCAL_OUTPUT_RETENTION_MS - 1);
    await utimes(resolve(outputDir, names.hard), old, old);
    await utimes(resolve(outputDir, names.locked), old, old);
    await utimes(resolve(outputDir, names.future), new Date(now + 10 * 60 * 1000), new Date(now + 10 * 60 * 1000));

    const summary = await cleanupAmyAnamHermesLocalOutputs({
        outputDir,
        now,
        unlinkImpl: async path => {
            if (path.endsWith(names.locked)) {
                const error = new Error('synthetic lock');
                error.code = 'EPERM';
                throw error;
            }
            return rm(path);
        },
    });
    assert.equal(summary.ok, false);
    assert.equal(summary.retained, 1);
    assert.equal(summary.futureDated, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.unsafe, symlinkCreated ? 2 : 1);
    assert.equal(summary.contentIncluded, false);
    assert.equal(await pathExists(resolve(outputDir, names.fresh)), true);
    assert.equal(await pathExists(resolve(outputDir, names.future)), true);
    assert.equal(await pathExists(resolve(outputDir, names.hard)), true);
    assert.equal(await pathExists(resolve(outputDir, names.locked)), true);
});

test('cleanup CLI adapter reads only local settings and returns a content-free summary', async (t) => {
    const outputDir = await makeOutputDir(t, false);
    const summary = await runAmyAnamHermesLocalCleanup({
        AMY_ANAM_HERMES_WORKER_OUTPUT_DIR: outputDir,
        AMY_ANAM_HERMES_OUTPUT_RETENTION_HOURS: '12',
        ANAM_API_KEY: 'must-not-be-consumed',
        AMY_ANAM_HERMES_WORKER_SECRET: 'must-not-be-consumed',
    });
    assert.deepEqual(summary, {
        schemaVersion: 'amy_anam_hermes_local_cleanup_v1',
        ok: true,
        busy: false,
        rootPresent: false,
        scanned: 0,
        matched: 0,
        deleted: 0,
        retained: 0,
        ignored: 0,
        unsafe: 0,
        futureDated: 0,
        failed: 0,
        recovered: 0,
        contentIncluded: false,
    });
    assert.doesNotMatch(JSON.stringify(summary), /ANAM_API_KEY|WORKER_SECRET|must-not-be-consumed/);
    assert.equal(amyAnamHermesLocalCleanupExitCode(summary), 0);
});
