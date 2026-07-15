import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
    AMY_ANAM_HERMES_SHADOW_OUTPUT_VERSION,
    buildAmyAnamHermesShadowPrompt,
    buildAmyAnamHermesShadowReceipt,
    createAmyAnamHermesShadowPointer,
    parseAmyAnamHermesShadowOutput,
    redactAmyAnamTranscriptInMemory,
    readAmyAnamHermesShadowConfig,
} from '../lib/anam/hermes-shadow.ts';
import {
    acknowledgeAmyAnamHermesShadowJob,
    amyAnamHermesShadowSessionReceiptKey,
    buildAmyAnamHermesShadowJob,
    buildAmyAnamHermesShadowQueuedEnvelope,
    enqueueAmyAnamHermesShadowPointer,
    leaseNextAmyAnamHermesShadowJob,
    readAmyAnamHermesShadowReceipt,
    retryOrDeadLetterAmyAnamHermesShadowJob,
} from '../lib/anam/hermes-shadow-store.ts';
import {
    AMY_ANAM_RECORD_TTL_SECONDS,
    buildAmyAnamReceipt,
    transcriptSha256,
} from '../lib/anam/session-spine.ts';
import {
    buildMinimalHermesChildEnv,
    fetchAuthoritativeAmyAnamTranscript,
    invokeHermesShadow,
    parseAmyAnamHermesRuntimeOutput,
    readAmyAnamHermesWorkerConfig,
} from '../scripts/hermes/amy-anam-shadow-worker.mjs';

const NOW = Date.parse('2026-07-14T20:00:00.000Z');
const SESSION_ID = 'anam_session_12345678';
const PERSONA_ID = 'persona_amy_cara4';
const CLIENT_LABEL = 'xagent-amy-launch-12345678';
const TURNS = [
    { role: 'user', content: 'Email me at pat@example.com or call 602-555-0123.' },
    { role: 'agent', content: 'I can prepare a factual recap for review.' },
];

const OPEN_ENV = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_SESSION_SECRET: 's'.repeat(32),
    AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
    AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
    AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
    AMY_ANAM_REDIS_REST_URL: 'https://redis.example.test',
    AMY_ANAM_REDIS_REST_TOKEN: 'redis-secret',
};

function fixtureSession() {
    return {
        schemaVersion: 'amy_anam_session_v1',
        browserSessionId: 'browser-123',
        launchId: 'launch-123',
        externalSessionId: SESSION_ID,
        clientLabel: CLIENT_LABEL,
        resolvedPersonaId: PERSONA_ID,
        provider: 'anam',
        agentSlug: 'amy',
        variant: 'amy-cara4',
        state: 'completed',
        createdAt: '2026-07-14T19:55:00.000Z',
        boundAt: '2026-07-14T19:55:01.000Z',
        closeReceivedAt: '2026-07-14T19:59:00.000Z',
        completedAt: '2026-07-14T20:00:00.000Z',
    };
}

function fixturePointer() {
    const receipt = buildAmyAnamReceipt({
        externalSessionId: SESSION_ID,
        source: 'anam_api',
        turns: TURNS,
        now: NOW,
    });
    return createAmyAnamHermesShadowPointer({
        session: fixtureSession(),
        receipt,
        now: NOW,
    });
}

function validOutput(overrides = {}) {
    return {
        schema_version: AMY_ANAM_HERMES_SHADOW_OUTPUT_VERSION,
        summary: 'The visitor asked for a reviewed follow-up.',
        inquiry_type: 'enterprise discovery',
        recommended_next_steps: ['Have an operator review the factual recap.'],
        needs_human_review: false,
        quality_review: {
            repeated_question_risk: false,
            unsupported_claim_risk: false,
            pricing_or_inventory_claim_risk: false,
            technical_term_risk: true,
            privacy_risk: false,
        },
        safety: {
            shadow_only: true,
            tools_called: 0,
            emails_sent: 0,
            memory_writes: 0,
            outbound_actions: 0,
        },
        ...overrides,
    };
}

function runtimeEnvelope(response = validOutput(), overrides = {}) {
    return {
        schema_version: 'amy_anam_hermes_runtime_v1',
        response: JSON.stringify(response),
        runtime: {
            client: 'hermes_auxiliary_codex',
            provider: 'openai-codex',
            model: 'gpt-5.5',
            prompt_transport: 'stdin',
            provider_store: false,
            tools_enabled: 0,
            tools_called: 0,
            memory_enabled: false,
            memory_writes: 0,
            session_store_enabled: false,
            ...overrides,
        },
    };
}

function redisResponse(result) {
    return new Response(JSON.stringify([{ result }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

test('Hermes shadow is fail-closed behind an off|shadow triple gate', () => {
    assert.equal(readAmyAnamHermesShadowConfig({}).gatesOpen, false);
    assert.equal(readAmyAnamHermesShadowConfig({ ...OPEN_ENV, AMY_ANAM_HERMES_SHADOW_ENABLED: 'false' }).gatesOpen, false);
    assert.equal(readAmyAnamHermesShadowConfig({ ...OPEN_ENV, AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'true' }).gatesOpen, false);
    assert.equal(readAmyAnamHermesShadowConfig({ ...OPEN_ENV, AMY_ANAM_HERMES_SHADOW_MODE: 'off' }).gatesOpen, false);
    assert.equal(readAmyAnamHermesShadowConfig(OPEN_ENV).gatesOpen, true);
    assert.throws(
        () => readAmyAnamHermesShadowConfig({ ...OPEN_ENV, AMY_ANAM_HERMES_SHADOW_MODE: 'active' }),
        /off or shadow/,
    );
});

test('queue, dedupe, and terminal receipt TTLs cannot undercut the canonical receipt lifetime', async () => {
    const lowTtlEnv = {
        ...OPEN_ENV,
        AMY_ANAM_HERMES_SHADOW_TTL_SECONDS: '1',
    };
    const config = readAmyAnamHermesShadowConfig(lowTtlEnv);
    assert.equal(config.ttlSeconds, AMY_ANAM_RECORD_TTL_SECONDS);

    const pointer = fixturePointer();
    const envelope = buildAmyAnamHermesShadowQueuedEnvelope(pointer, {
        env: lowTtlEnv,
        now: NOW,
    });
    assert.equal(envelope.ttlSeconds, AMY_ANAM_RECORD_TTL_SECONDS);

    const enqueueCommands = [];
    await enqueueAmyAnamHermesShadowPointer(pointer, {
        env: lowTtlEnv,
        now: NOW,
        fetchImpl: async (_url, init) => {
            enqueueCommands.push(JSON.parse(init.body)[0]);
            return redisResponse(1);
        },
    });
    assert.ok(enqueueCommands[0].includes(AMY_ANAM_RECORD_TTL_SECONDS));

    const lease = {
        job: { ...buildAmyAnamHermesShadowJob(pointer), attempts: 1 },
        leaseToken: '11111111-1111-4111-8111-111111111111',
        leaseUntil: NOW + 180_000,
    };
    const terminalCommands = [];
    await acknowledgeAmyAnamHermesShadowJob({ lease, output: validOutput() }, {
        env: lowTtlEnv,
        now: NOW,
        fetchImpl: async (_url, init) => {
            terminalCommands.push(JSON.parse(init.body)[0]);
            return redisResponse(1);
        },
    });
    assert.ok(terminalCommands[0].includes(AMY_ANAM_RECORD_TTL_SECONDS));
});

test('pointer, queued job, and cloud receipt are content-free metadata', () => {
    const pointer = fixturePointer();
    const envelope = buildAmyAnamHermesShadowQueuedEnvelope(pointer, { env: OPEN_ENV, now: NOW });
    const serialized = JSON.stringify(envelope);
    assert.equal(envelope.job.pointer.externalSessionId, SESSION_ID);
    assert.equal(envelope.job.attempts, 0);
    assert.equal(envelope.receipt.rawTranscriptPersisted, false);
    assert.equal(envelope.receipt.redactedTranscriptPersisted, false);
    assert.equal(envelope.receipt.generatedContentPersistedInCloud, false);
    assert.equal(envelope.receipt.toolsCalled, 0);
    assert.equal(envelope.receipt.emailsSent, 0);
    assert.equal(envelope.receipt.memoryWrites, 0);
    assert.equal(envelope.receipt.outboundActions, 0);
    assert.equal(serialized.includes('pat@example.com'), false);
    assert.equal(serialized.includes('factual recap'), false);
    assert.equal(serialized.includes('redactedTranscript'), true); // false-only receipt evidence
    assert.equal(Object.hasOwn(pointer, 'transcript'), false);
    assert.equal(Object.hasOwn(envelope.job, 'output'), false);
});

test('transcript is redacted and bounded only after local authoritative retrieval', () => {
    const redacted = redactAmyAnamTranscriptInMemory([
        ...TURNS,
        { role: 'user', content: 'Temporary token sk_abcdefghijklmnop.' },
    ]);
    assert.match(redacted, /\[email redacted\]/);
    assert.match(redacted, /\[phone redacted\]/);
    assert.match(redacted, /\[token redacted\]/);
    assert.equal(redacted.includes('pat@example.com'), false);
    const prompt = buildAmyAnamHermesShadowPrompt(redacted);
    assert.match(prompt, /Do not call or request tools/);
    assert.match(prompt, /"tools_called":0/);
    assert.match(prompt, /"outbound_actions":0/);
});

test('Hermes output parser enforces exact bounded JSON and zero actions', () => {
    const parsed = parseAmyAnamHermesShadowOutput(JSON.stringify(validOutput()));
    assert.equal(parsed.quality_review.technical_term_risk, true);
    assert.equal(parsed.safety.tools_called, 0);
    assert.throws(
        () => parseAmyAnamHermesShadowOutput(`\`\`\`json\n${JSON.stringify(validOutput())}\n\`\`\``),
        /unwrapped JSON/,
    );
    assert.throws(
        () => parseAmyAnamHermesShadowOutput(JSON.stringify(validOutput({ extra: 'content' }))),
        /top-level contract/,
    );
    assert.throws(
        () => parseAmyAnamHermesShadowOutput(JSON.stringify(validOutput({
            safety: { ...validOutput().safety, emails_sent: 1 },
        }))),
        /safety contract/,
    );
});

test('enqueue uses one atomic EVAL, durable due ZSET, finite TTL, and pointer-only payload', async () => {
    const calls = [];
    const result = await enqueueAmyAnamHermesShadowPointer(fixturePointer(), {
        env: OPEN_ENV,
        now: NOW,
        fetchImpl: async (_url, init) => {
            calls.push(JSON.parse(init.body));
            return redisResponse(1);
        },
    });
    assert.deepEqual(result, { queued: true, duplicate: false, contentPersisted: false });
    assert.equal(calls.length, 1);
    const command = calls[0][0];
    assert.equal(command[0], 'EVAL');
    assert.match(command[1], /ZADD/);
    assert.match(command[1], /EXPIRE/);
    assert.match(command[1], /SET.*NX/);
    assert.doesNotMatch(command[1], /redis\.call\('SET'[^;]*(?:==|~=)\s*'OK'/);
    const payload = JSON.stringify(command);
    assert.equal(payload.includes('pat@example.com'), false);
    assert.equal(payload.includes('summary'), false);
});

test('lease is atomic and updates the real owner-visible session receipt key', async () => {
    const pointer = fixturePointer();
    const queuedJob = buildAmyAnamHermesShadowJob(pointer);
    const leasedJob = { ...queuedJob, attempts: 1 };
    const commands = [];
    const results = [[pointer.jobId], JSON.stringify(queuedJob), JSON.stringify(leasedJob)];
    const lease = await leaseNextAmyAnamHermesShadowJob({
        env: OPEN_ENV,
        now: NOW,
        fetchImpl: async (_url, init) => {
            commands.push(JSON.parse(init.body)[0]);
            return redisResponse(results.shift());
        },
    });
    assert.equal(lease.job.attempts, 1);
    const evalCommand = commands.find(command => command[0] === 'EVAL');
    assert.ok(evalCommand);
    assert.match(evalCommand[1], /ZSCORE/);
    assert.match(evalCommand[1], /'NX'/);
    assert.match(evalCommand[1], /ZADD/);
    assert.doesNotMatch(evalCommand[1], /redis\.call\('SET'[^;]*(?:==|~=)\s*'OK'/);
    assert.ok(evalCommand.includes(amyAnamHermesShadowSessionReceiptKey(SESSION_ID)));
    assert.equal(JSON.stringify(evalCommand).includes('placeholder'), false);
});

test('ack stores only output hash and risk booleans; failure path atomically dead-letters', async () => {
    const pointer = fixturePointer();
    const lease = {
        job: { ...buildAmyAnamHermesShadowJob(pointer), attempts: 3 },
        leaseToken: '11111111-1111-4111-8111-111111111111',
        leaseUntil: NOW + 180_000,
    };
    const output = validOutput();
    const ackCommands = [];
    assert.equal(await acknowledgeAmyAnamHermesShadowJob({ lease, output }, {
        env: OPEN_ENV,
        now: NOW,
        fetchImpl: async (_url, init) => {
            ackCommands.push(JSON.parse(init.body)[0]);
            return redisResponse(1);
        },
    }), true);
    const ackPayload = JSON.stringify(ackCommands);
    assert.equal(ackPayload.includes(output.summary), false);
    assert.equal(ackPayload.includes('recommended_next_steps'), false);
    assert.match(ackPayload, /outputSha256/);
    assert.match(ackPayload, /technicalTerm/);

    const retryCommands = [];
    const transition = await retryOrDeadLetterAmyAnamHermesShadowJob({
        lease,
        failureCode: 'output_contract_invalid',
        hermesExecutionHappened: true,
    }, {
        env: OPEN_ENV,
        now: NOW,
        fetchImpl: async (_url, init) => {
            retryCommands.push(JSON.parse(init.body)[0]);
            return redisResponse('dead_letter');
        },
    });
    assert.equal(transition, 'dead_letter');
    assert.match(retryCommands[0][1], /dead_letter/);
    assert.match(retryCommands[0][1], /ZADD/);
    assert.match(retryCommands[0][1], /EXPIRE/);
    const deadReceipt = JSON.parse(retryCommands[0][16]);
    assert.equal(deadReceipt.hermesExecutionHappened, true);
});

test('receipt reads reject extra cloud fields instead of leaking content', async () => {
    const receipt = buildAmyAnamHermesShadowReceipt({
        pointer: fixturePointer(),
        status: 'queued',
        now: NOW,
    });
    await assert.rejects(
        readAmyAnamHermesShadowReceipt(SESSION_ID, {
            env: OPEN_ENV,
            fetchImpl: async () => redisResponse(JSON.stringify({ ...receipt, summary: 'leak' })),
        }),
        /action or content state/,
    );
});

test('local worker re-fetches Anam metadata and transcript and verifies canonical hash/count', async () => {
    const pointer = fixturePointer();
    const requests = [];
    const config = {
        anamApiKey: 'anam-secret',
    };
    const payloads = [
        {
            id: SESSION_ID,
            clientLabel: CLIENT_LABEL,
            personaId: PERSONA_ID,
            endTime: '2026-07-14T20:00:00.000Z',
            exitStatus: 'completed',
            personaConfig: { personaId: PERSONA_ID, zeroDataRetention: false },
        },
        {
            sessionId: SESSION_ID,
            transcriptsEnabled: true,
            totalMessages: TURNS.length,
            endTime: '2026-07-14T20:00:00.000Z',
            messages: TURNS.map(turn => ({
                role: turn.role === 'agent' ? 'persona' : 'user',
                message: turn.content,
            })),
        },
    ];
    const turns = await fetchAuthoritativeAmyAnamTranscript(
        pointer,
        fixtureSession(),
        config,
        {
            fetchImpl: async (url, init) => {
                requests.push({ url, init });
                return new Response(JSON.stringify(payloads.shift()), { status: 200 });
            },
        },
    );
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, new RegExp(`/sessions/${SESSION_ID}$`));
    assert.match(requests[1].url, new RegExp(`/sessions/${SESSION_ID}/transcript$`));
    assert.equal(transcriptSha256(turns), pointer.expectedTranscriptSha256);

    await assert.rejects(
        fetchAuthoritativeAmyAnamTranscript(
            { ...pointer, expectedMessageCount: pointer.expectedMessageCount + 1 },
            fixtureSession(),
            config,
            {
                fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
            },
        ),
        /provider identity|canonical receipt/,
    );
});

test('Hermes runtime uses stdin, no tools/memory/session store, and a minimal environment', async () => {
    const hermesHome = resolve(tmpdir(), 'amy-anam-hermes-test-home');
    const outputDir = resolve(tmpdir(), 'amy-anam-hermes-test-output');
    const env = {
        ...OPEN_ENV,
        ANAM_API_KEY: 'anam-secret',
        AMY_ANAM_HERMES_HOME: hermesHome,
        AMY_ANAM_HERMES_PROVIDER: 'openai-codex',
        AMY_ANAM_HERMES_MODEL: 'gpt-5.5',
        AMY_ANAM_HERMES_PYTHON_COMMAND: 'C:\\safe-bin\\python.exe',
        PATH: 'C:\\safe-bin',
        HERMES_KANBAN_TASK: 'must-not-leak',
        AGENTMAIL_API_KEY: 'must-not-leak',
        OPENAI_API_KEY: 'must-not-leak',
    };
    const workerConfig = readAmyAnamHermesWorkerConfig(env);
    assert.equal(workerConfig.outputDir, resolve(tmpdir(), 'xagent-amy-anam-hermes-shadow'));
    const minimal = buildMinimalHermesChildEnv(env, workerConfig);
    assert.equal(minimal.HERMES_HOME, hermesHome);
    assert.equal(Object.hasOwn(minimal, 'HERMES_KANBAN_TASK'), false);
    assert.equal(Object.hasOwn(minimal, 'AGENTMAIL_API_KEY'), false);
    assert.equal(Object.hasOwn(minimal, 'OPENAI_API_KEY'), false);
    assert.equal(minimal.HERMES_SAFE_MODE, '1');
    assert.equal(minimal.HERMES_ACCEPT_HOOKS, '0');
    assert.equal(minimal.HERMES_YOLO_MODE, '0');
    assert.equal(minimal.AMY_ANAM_HERMES_RUNTIME_PROVIDER, 'openai-codex');

    let invocation;
    const spawnImpl = (command, args, options) => {
        invocation = { command, args, options };
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        child.stdin = new EventEmitter();
        child.stdin.end = (input) => {
            invocation.stdin = input;
            queueMicrotask(() => {
                child.stdout.emit('data', JSON.stringify(runtimeEnvelope()));
                child.emit('close', 0);
            });
        };
        return child;
    };
    const prompt = buildAmyAnamHermesShadowPrompt('USER: A fully redacted request.');
    const result = await invokeHermesShadow(
        prompt,
        { ...workerConfig, outputDir },
        { env, spawnImpl },
    );
    assert.equal(result.output.safety.outbound_actions, 0);
    assert.equal(result.runtime.tools_called, 0);
    assert.equal(invocation.command, resolve('C:\\safe-bin\\python.exe'));
    assert.equal(invocation.args.length, 1);
    assert.match(invocation.args[0], /amy-anam-shadow-runtime\.py$/);
    assert.equal(invocation.args.some(value => value.includes('fully redacted request')), false);
    const stdin = JSON.parse(invocation.stdin);
    assert.equal(stdin.schema_version, 'amy_anam_hermes_runtime_input_v1');
    assert.equal(stdin.user, prompt);
    assert.match(stdin.system, /no tools/i);
    assert.equal(invocation.options.shell, false);
    assert.deepEqual(invocation.options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(invocation.options.cwd, outputDir);
    assert.equal(Object.hasOwn(invocation.options.env, 'AGENTMAIL_API_KEY'), false);
});

test('Hermes runtime telemetry fails closed if tools, memory, storage, or provider persistence appear', () => {
    const config = { provider: 'openai-codex', model: 'gpt-5.5' };
    for (const override of [
        { tools_enabled: 1 },
        { tools_called: 1 },
        { memory_enabled: true },
        { memory_writes: 1 },
        { session_store_enabled: true },
        { provider_store: true },
        { prompt_transport: 'argv' },
    ]) {
        assert.throws(
            () => parseAmyAnamHermesRuntimeOutput(
                JSON.stringify(runtimeEnvelope(validOutput(), override)),
                config,
            ),
            /safety contract/,
        );
    }
});

test('Hermes Python runtime is stdin-only and does not construct the agent/session/tool machinery', async () => {
    const source = await readFile(
        new URL('../scripts/hermes/amy-anam-shadow-runtime.py', import.meta.url),
        'utf8',
    );
    assert.match(source, /sys\.stdin\.buffer\.read/);
    assert.match(source, /resolve_provider_client/);
    assert.match(source, /client\.chat\.completions\.create/);
    assert.doesNotMatch(source, /\bAIAgent\b|\bSessionDB\b|--oneshot/);
    const providerCall = source.slice(
        source.indexOf('response = client.chat.completions.create'),
        source.indexOf('text = extract_content_or_reasoning'),
    );
    assert.doesNotMatch(providerCall, /\btools\s*=/);
    assert.match(source, /kwargs\.get\("store"\) is not False or tools/);
});
