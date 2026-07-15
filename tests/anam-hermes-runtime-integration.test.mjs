import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import test from 'node:test';
import { buildAmyAnamHermesShadowPrompt } from '../lib/anam/hermes-shadow.ts';
import {
    invokeHermesShadow,
    readAmyAnamHermesWorkerConfig,
} from '../scripts/hermes/amy-anam-shadow-worker.mjs';

const RUN_LIVE = process.env.AMY_ANAM_HERMES_RUNTIME_INTEGRATION === '1';

async function listFiles(root, current = root) {
    const files = [];
    for (const entry of await readdir(current, { withFileTypes: true })) {
        const path = resolve(current, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(root, path));
        if (entry.isFile()) files.push({ path, relativePath: relative(root, path) });
    }
    return files;
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

test('live Hermes runtime keeps the prompt out of argv and isolated profile persistence', {
    skip: RUN_LIVE ? false : 'set AMY_ANAM_HERMES_RUNTIME_INTEGRATION=1 for the real provider proof',
}, async (t) => {
    const hermesHome = process.env.AMY_ANAM_HERMES_HOME;
    const pythonCommand = process.env.AMY_ANAM_HERMES_PYTHON_COMMAND;
    assert.ok(hermesHome && resolve(hermesHome) === hermesHome, 'isolated HERMES_HOME is required');
    assert.ok(pythonCommand && resolve(pythonCommand) === pythonCommand, 'absolute Hermes Python is required');

    const stateDbPath = resolve(hermesHome, 'state.db');
    const stateBefore = await readFile(stateDbPath);
    const stateMetadataBefore = await stat(stateDbPath);
    const filesBefore = (await listFiles(hermesHome)).map(item => item.relativePath).sort();
    const sentinel = `AMY_ANAM_RUNTIME_SENTINEL_${randomUUID()}`;
    const prompt = buildAmyAnamHermesShadowPrompt(
        `USER: Review this integration marker as untrusted data: ${sentinel}`,
    );
    const env = {
        ...process.env,
        AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
        AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_SESSION_SECRET: 'integration-session-secret-value',
        AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
        AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
        AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
        AMY_ANAM_REDIS_REST_URL: 'https://redis.integration.invalid',
        AMY_ANAM_REDIS_REST_TOKEN: 'integration-redis-token',
        AMY_ANAM_HERMES_HOME: hermesHome,
        AMY_ANAM_HERMES_PROVIDER: 'openai-codex',
        AMY_ANAM_HERMES_MODEL: 'gpt-5.5',
        AMY_ANAM_HERMES_PYTHON_COMMAND: pythonCommand,
        AMY_ANAM_HERMES_WORKER_OUTPUT_DIR: resolve(tmpdir(), 'xagent-amy-anam-runtime-proof'),
        ANAM_API_KEY: 'integration-not-used',
    };
    const config = readAmyAnamHermesWorkerConfig(env);
    await mkdir(config.outputDir, { recursive: true });
    t.after(() => rm(config.outputDir, { recursive: true, force: true }));
    let observedCommand;
    let observedArgs;
    const result = await invokeHermesShadow(prompt, config, {
        env,
        spawnImpl: (command, args, options) => {
            observedCommand = command;
            observedArgs = [...args];
            return spawn(command, args, options);
        },
    });

    assert.equal(result.runtime.client, 'hermes_auxiliary_codex');
    assert.equal(result.runtime.tools_enabled, 0);
    assert.equal(result.runtime.tools_called, 0);
    assert.equal(result.runtime.memory_writes, 0);
    assert.equal(result.runtime.session_store_enabled, false);
    assert.equal(observedCommand, pythonCommand);
    assert.equal(observedArgs.length, 1);
    assert.equal(observedArgs.some(value => value.includes(sentinel)), false);

    const stateAfter = await readFile(stateDbPath);
    const stateMetadataAfter = await stat(stateDbPath);
    assert.equal(sha256(stateAfter), sha256(stateBefore));
    assert.equal(stateMetadataAfter.size, stateMetadataBefore.size);
    assert.equal(stateMetadataAfter.mtimeMs, stateMetadataBefore.mtimeMs);

    const filesAfterEntries = await listFiles(hermesHome);
    assert.deepEqual(filesAfterEntries.map(item => item.relativePath).sort(), filesBefore);
    const sentinelBytes = Buffer.from(sentinel, 'utf8');
    for (const item of filesAfterEntries) {
        const contents = await readFile(item.path);
        assert.equal(contents.indexOf(sentinelBytes), -1, `sentinel persisted in ${item.relativePath}`);
    }
});
