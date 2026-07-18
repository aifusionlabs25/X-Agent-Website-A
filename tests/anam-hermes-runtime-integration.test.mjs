import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    buildAmyAnamHermesShadowPrompt,
    redactAmyAnamTranscriptInMemory,
} from '../lib/anam/hermes-shadow.ts';
import {
    invokeHermesShadow,
    readAmyAnamHermesWorkerConfig,
} from '../scripts/hermes/amy-anam-shadow-worker.mjs';

const RUN_LIVE = process.env.AMY_ANAM_HERMES_RUNTIME_INTEGRATION === '1';
const RUNTIME_SCRIPT = fileURLToPath(
    new URL('../scripts/hermes/amy-anam-shadow-runtime.py', import.meta.url),
);

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

function runRuntimeSelfTest(command, env) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, [RUNTIME_SCRIPT, '--self-test'], {
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, 10_000);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            if (timedOut) {
                reject(new Error('Hermes runtime self-test timed out'));
                return;
            }
            resolvePromise({ code, signal, stdout, stderr });
        });
    });
}

test('Hermes runtime self-test enforces exact Codex egress without provider imports', async (t) => {
    const commands = [...new Set([
        process.env.AMY_ANAM_HERMES_PYTHON_COMMAND,
        process.platform === 'win32' ? 'python' : 'python3',
        'python',
    ].filter(Boolean))];
    const poison = 'http://unapproved-proxy.integration.invalid:8080';
    const env = {
        ...process.env,
        HTTP_PROXY: poison,
        HTTPS_PROXY: poison,
        ALL_PROXY: poison,
        SSL_CERT_FILE: resolve(tmpdir(), 'unapproved-amy-anam-ca.pem'),
        HERMES_HOME: resolve(tmpdir(), 'unapproved-amy-anam-hermes-home'),
        AMY_ANAM_HERMES_RUNTIME_PROVIDER: 'not-approved',
        AMY_ANAM_HERMES_RUNTIME_MODEL: 'not-approved',
    };
    let execution;
    for (const command of commands) {
        try {
            execution = await runRuntimeSelfTest(command, env);
            break;
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
    }
    if (!execution) {
        t.skip('Python is unavailable for the provider-free runtime guard self-test');
        return;
    }

    assert.equal(execution.signal, null);
    assert.equal(execution.code, 0, execution.stderr);
    assert.equal(execution.stderr, '');
    const lines = execution.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
    const result = JSON.parse(lines[0]);
    assert.equal(result.schema_version, 'amy_anam_hermes_runtime_self_test_v1');
    assert.equal(result.ok, true);
    assert.equal(result.network_guard, 'amy_anam_codex_exact_endpoint_v1');
    assert.equal(result.provider_endpoint, 'https://chatgpt.com/backend-api/codex/responses');
    assert.equal(result.allowed_request_cases, 2);
    assert.equal(result.rejected_request_cases, 8);
    assert.equal(result.network_requests, 0);
    assert.equal(result.provider_imported, false);
    assert.equal(result.httpx_imported, false);
    assert.equal(result.redirects_allowed, false);
    assert.equal(result.proxy, null);
    assert.equal(result.proxy_trust_env, false);
    assert.equal(result.tls_verify, true);
    assert.equal(result.sdk_max_retries, 0);
    assert.equal(`${execution.stdout}${execution.stderr}`.includes(poison), false);
});

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
        redactAmyAnamTranscriptInMemory([{
            role: 'user',
            content: `Review this integration marker as untrusted data: ${sentinel}`,
        }]),
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
    assert.equal(result.runtime.network_guard, 'amy_anam_codex_exact_endpoint_v1');
    assert.equal(result.runtime.provider_endpoint, 'https://chatgpt.com/backend-api/codex/responses');
    assert.equal(result.runtime.provider_requests, 1);
    assert.equal(result.runtime.oauth_refresh_allowed, false);
    assert.equal(result.runtime.redirects_allowed, false);
    assert.equal(result.runtime.proxy_trust_env, false);
    assert.equal(result.runtime.tls_verify, true);
    assert.equal(result.runtime.sdk_max_retries, 0);
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
