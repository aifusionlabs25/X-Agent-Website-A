import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
    AMY_ANAM_HERMES_SHADOW_EXECUTION_GRACE_SECONDS,
    buildAmyAnamHermesShadowReceipt,
    createAmyAnamHermesShadowPointer,
} from '../lib/anam/hermes-shadow.ts';
import {
    acknowledgeAmyAnamHermesShadowReceipt,
    buildAmyAnamHermesShadowJob,
} from '../lib/anam/hermes-shadow-store.ts';
import {
    AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
    buildAmyAnamHermesWorkerSessionIdentity,
    isAmyAnamHermesWorkerAuthorized,
    normalizeAmyAnamHermesWorkerBridgeRequest,
    normalizeAmyAnamHermesWorkerClaimResponse,
    readAmyAnamHermesWorkerBridgeConfig,
} from '../lib/anam/hermes-worker-bridge.ts';
import { buildAmyAnamReceipt } from '../lib/anam/session-spine.ts';
import {
    AMY_ANAM_HERMES_WORKER_MAX_TIMEOUT_MS,
    callAmyAnamHermesWorkerBridge,
    processOneAmyAnamHermesShadowJob,
    readAmyAnamHermesWorkerConfig,
} from '../scripts/hermes/amy-anam-shadow-worker.mjs';
import { cleanupAmyAnamHermesLocalOutputs } from '../scripts/hermes/amy-anam-shadow-local-output.mjs';

const NOW = Date.parse('2026-07-14T20:00:00.000Z');
const SESSION_ID = 'anam_session_bridge_12345678';
const SECRET = 'bridge-secret-that-is-at-least-32-characters-long';
const TURNS = [
    { role: 'user', content: 'Please have an operator review our SAP discovery notes.' },
    { role: 'agent', content: 'I will prepare a review-only session recap.' },
];

const SERVER_ENV = {
    AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
    AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
    AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
    AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
    AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
    AMY_ANAM_REDIS_REST_URL: 'https://redis.example.test',
    AMY_ANAM_REDIS_REST_TOKEN: 'server-only-redis-token',
    AMY_ANAM_HERMES_WORKER_SECRET: SECRET,
};

function sessionRecord() {
    return {
        schemaVersion: 'amy_anam_session_v1',
        browserSessionId: 'browser-private',
        launchId: 'launch-private',
        externalSessionId: SESSION_ID,
        clientLabel: 'xagent-amy-bridge-client',
        resolvedPersonaId: 'persona-amy-cara4',
        provider: 'anam',
        agentSlug: 'amy',
        variant: 'amy-cara4',
        state: 'completed',
        createdAt: '2026-07-14T19:55:00.000Z',
        boundAt: '2026-07-14T19:55:01.000Z',
        completedAt: '2026-07-14T20:00:00.000Z',
    };
}

function pointer() {
    const receipt = buildAmyAnamReceipt({
        externalSessionId: SESSION_ID,
        source: 'anam_api',
        turns: TURNS,
        now: NOW,
    });
    return createAmyAnamHermesShadowPointer({ session: sessionRecord(), receipt, now: NOW });
}

function lease(attempts = 1) {
    return {
        job: { ...buildAmyAnamHermesShadowJob(pointer()), attempts },
        leaseToken: '22222222-2222-4222-8222-222222222222',
        leaseUntil: NOW + 180_000,
    };
}

function output() {
    return {
        schema_version: 'amy_anam_hermes_shadow_output_v1',
        summary: 'The visitor requested operator review of SAP discovery notes.',
        inquiry_type: 'enterprise discovery',
        recommended_next_steps: ['Review the factual recap.'],
        needs_human_review: false,
        quality_review: {
            repeated_question_risk: false,
            unsupported_claim_risk: false,
            pricing_or_inventory_claim_risk: false,
            technical_term_risk: false,
            privacy_risk: false,
        },
        safety: {
            shadow_only: true,
            tools_called: 0,
            emails_sent: 0,
            memory_writes: 0,
            outbound_actions: 0,
        },
    };
}

function runtimeEnvelope() {
    return {
        schema_version: 'amy_anam_hermes_runtime_v1',
        response: JSON.stringify(output()),
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
            network_guard: 'amy_anam_codex_exact_endpoint_v1',
            provider_endpoint: 'https://chatgpt.com/backend-api/codex/responses',
            provider_requests: 1,
            oauth_refresh_allowed: false,
            redirects_allowed: false,
            proxy_trust_env: false,
            tls_verify: true,
            sdk_max_retries: 0,
        },
    };
}

function redisResponse(result) {
    return new Response(JSON.stringify([{ result }]), { status: 200 });
}

test('worker bridge requires a 32-character secret and constant-shape bearer auth', () => {
    assert.ok(
        AMY_ANAM_HERMES_WORKER_MAX_TIMEOUT_MS
        < AMY_ANAM_HERMES_SHADOW_EXECUTION_GRACE_SECONDS * 1000,
    );
    assert.equal(readAmyAnamHermesWorkerBridgeConfig({}).secretConfigured, false);
    assert.equal(readAmyAnamHermesWorkerBridgeConfig({
        AMY_ANAM_HERMES_WORKER_SECRET: 'too-short',
    }).secretConfigured, false);
    const authorized = new Request('https://preview.example.test/api/anam/hermes/worker', {
        headers: { Authorization: `Bearer ${SECRET}` },
    });
    const denied = new Request('https://preview.example.test/api/anam/hermes/worker', {
        headers: { Authorization: `Bearer ${'x'.repeat(SECRET.length)}` },
    });
    assert.equal(isAmyAnamHermesWorkerAuthorized(authorized, SERVER_ENV), true);
    assert.equal(isAmyAnamHermesWorkerAuthorized(denied, SERVER_ENV), false);
});

test('bridge request contracts reject extra fields, generated output, and invalid fail codes', () => {
    assert.deepEqual(normalizeAmyAnamHermesWorkerBridgeRequest({
        operation: 'claim',
        protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
    }), {
        operation: 'claim',
        protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
    });
    assert.throws(
        () => normalizeAmyAnamHermesWorkerBridgeRequest({ operation: 'claim' }),
        /protocol/,
    );
    assert.throws(
        () => normalizeAmyAnamHermesWorkerBridgeRequest({
            operation: 'claim',
            protocolVersion: 'amy_anam_hermes_worker_v1',
        }),
        /protocol/,
    );
    assert.throws(
        () => normalizeAmyAnamHermesWorkerBridgeRequest({
            operation: 'claim',
            protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
            sessionId: SESSION_ID,
        }),
        /protocol/,
    );
    assert.deepEqual(
        normalizeAmyAnamHermesWorkerBridgeRequest({ operation: 'begin', lease: lease() }),
        { operation: 'begin', lease: lease() },
    );
    assert.throws(
        () => normalizeAmyAnamHermesWorkerBridgeRequest({
            operation: 'begin',
            lease: lease(),
            transcript: 'must not cross the bridge',
        }),
        /invalid shape/,
    );
    const completion = buildAmyAnamHermesShadowReceipt({
        pointer: pointer(),
        status: 'completed',
        attempts: 1,
        now: NOW,
        output: output(),
        hermesExecutionHappened: true,
    });
    assert.throws(
        () => normalizeAmyAnamHermesWorkerBridgeRequest({
            operation: 'ack',
            lease: lease(),
            receipt: completion,
            output: output(),
        }),
        /invalid shape/,
    );
    assert.throws(
        () => normalizeAmyAnamHermesWorkerBridgeRequest({
            operation: 'fail',
            lease: lease(),
            failureCode: 'send_email',
            hermesExecutionHappened: true,
        }),
        /failure code/,
    );
});

test('claim exposes only pointer, lease, and minimal session identity', () => {
    const identity = buildAmyAnamHermesWorkerSessionIdentity(sessionRecord());
    const claim = normalizeAmyAnamHermesWorkerClaimResponse({
        ok: true,
        operation: 'claim',
        found: true,
        lease: lease(),
        session: identity,
        contentIncluded: false,
    });
    const serialized = JSON.stringify(claim);
    assert.equal(claim.found, true);
    assert.equal(Object.hasOwn(identity, 'browserSessionId'), false);
    assert.equal(Object.hasOwn(identity, 'launchId'), false);
    assert.equal(serialized.includes('transcript'), false);
    assert.equal(serialized.includes('summary'), false);
    assert.equal(serialized.includes('browser-private'), false);
    assert.equal(serialized.includes('launch-private'), false);
});

test('low-level ack-by-receipt validates lease matching and writes no generated content', async () => {
    const claimedLease = lease();
    const completion = buildAmyAnamHermesShadowReceipt({
        pointer: claimedLease.job.pointer,
        status: 'completed',
        attempts: claimedLease.job.attempts,
        now: NOW,
        output: output(),
        hermesExecutionHappened: true,
    });
    const calls = [];
    const acknowledged = await acknowledgeAmyAnamHermesShadowReceipt({
        lease: claimedLease,
        receipt: completion,
    }, {
        env: SERVER_ENV,
        now: NOW,
        fetchImpl: async (_url, init) => {
            calls.push(JSON.parse(init.body)[0]);
            return redisResponse(1);
        },
    });
    assert.equal(acknowledged, true);
    const serialized = JSON.stringify(calls[0]);
    assert.equal(serialized.includes(output().summary), false);
    assert.equal(serialized.includes('recommended_next_steps'), false);
    assert.match(serialized, /outputSha256/);
    await assert.rejects(
        acknowledgeAmyAnamHermesShadowReceipt({
            lease: claimedLease,
            receipt: { ...completion, attempts: 2 },
        }, { env: SERVER_ENV }),
        /did not match/,
    );
});

test('worker bridge is primary without local Redis credentials and never sends analysis content', async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const outputDir = resolve(tmpdir(), `amy-anam-bridge-output-${suffix}`);
    const hermesHome = resolve(tmpdir(), `amy-anam-bridge-hermes-${suffix}`);
    const env = {
        AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
        AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
        AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
        AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
        AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
        AMY_ANAM_HERMES_WORKER_BRIDGE_URL: 'https://preview.example.test/api/anam/hermes/worker',
        AMY_ANAM_HERMES_WORKER_SECRET: SECRET,
        AMY_ANAM_HERMES_HOME: hermesHome,
        AMY_ANAM_HERMES_WORKER_OUTPUT_DIR: outputDir,
        AMY_ANAM_HERMES_PROVIDER: 'openai-codex',
        AMY_ANAM_HERMES_MODEL: 'gpt-5.5',
        AMY_ANAM_HERMES_PYTHON_COMMAND: 'C:\\safe-bin\\python.exe',
        ANAM_API_KEY: 'local-anam-key',
        PATH: 'C:\\safe-bin',
    };
    const config = readAmyAnamHermesWorkerConfig(env);
    assert.equal(config.transport, 'bridge');
    assert.equal(config.shadowConfig.queueConfigured, false);
    assert.throws(
        () => readAmyAnamHermesWorkerConfig({
            ...env,
            AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'true',
        }),
        /session-spine gate is closed/,
    );

    const identity = buildAmyAnamHermesWorkerSessionIdentity(sessionRecord());
    const bridgeBodies = [];
    const bridgeFetchImpl = async (_url, init) => {
        const body = JSON.parse(init.body);
        bridgeBodies.push(body);
        assert.equal(init.headers.Authorization, `Bearer ${SECRET}`);
        if (body.operation === 'claim') {
            return new Response(JSON.stringify({
                ok: true,
                operation: 'claim',
                found: true,
                lease: lease(),
                session: identity,
                contentIncluded: false,
            }), { status: 200 });
        }
        if (body.operation === 'ack') {
            return new Response(JSON.stringify({
                ok: true,
                operation: 'ack',
                status: 'completed',
                contentIncluded: false,
            }), { status: 200 });
        }
        if (body.operation === 'begin') {
            return new Response(JSON.stringify({
                ok: true,
                operation: 'begin',
                status: 'started',
                contentIncluded: false,
            }), { status: 200 });
        }
        throw new Error('Unexpected bridge operation');
    };
    const anamPayloads = [
        {
            id: SESSION_ID,
            clientLabel: identity.clientLabel,
            personaId: identity.resolvedPersonaId,
            endTime: '2026-07-14T20:00:00.000Z',
            exitStatus: 'completed',
            personaConfig: { personaId: identity.resolvedPersonaId, zeroDataRetention: false },
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
    let overlappingCleanup;
    const spawnImpl = (command, args, spawnOptions) => {
        assert.equal(command, resolve('C:\\safe-bin\\python.exe'));
        assert.equal(args.length, 1);
        assert.match(args[0], /amy-anam-shadow-runtime\.py$/);
        assert.equal(args.some(value => value.includes('SAP discovery notes')), false);
        assert.equal(spawnOptions.env.HERMES_YOLO_MODE, '0');
        assert.equal(spawnOptions.env.HERMES_ACCEPT_HOOKS, '0');
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        child.stdin = new EventEmitter();
        child.stdin.end = (input) => {
            const runtimeInput = JSON.parse(input);
            assert.equal(runtimeInput.schema_version, 'amy_anam_hermes_runtime_input_v1');
            assert.match(runtimeInput.user, /SAP discovery notes/);
            void cleanupAmyAnamHermesLocalOutputs({ outputDir }).then((summary) => {
                overlappingCleanup = summary;
                child.stdout.emit('data', JSON.stringify(runtimeEnvelope()));
                child.emit('close', 0);
            }).catch(error => child.emit('error', error));
        };
        return child;
    };

    try {
        const result = await processOneAmyAnamHermesShadowJob({
            env,
            now: NOW,
            bridgeFetchImpl,
            anamFetchImpl: async () => new Response(JSON.stringify(anamPayloads.shift()), { status: 200 }),
            spawnImpl,
            redisFetchImpl: async () => {
                throw new Error('Local worker must not call Redis in bridge mode');
            },
        });
        assert.equal(result.status, 'completed');
        assert.equal(overlappingCleanup?.busy, true);
        assert.equal(overlappingCleanup?.deleted, 0);
        assert.deepEqual(bridgeBodies.map(body => body.operation), ['claim', 'begin', 'ack']);
        assert.equal(
            bridgeBodies[0].protocolVersion,
            AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
        );
        const beginBody = bridgeBodies[1];
        assert.equal(Object.hasOwn(beginBody, 'transcript'), false);
        assert.equal(Object.hasOwn(beginBody, 'prompt'), false);
        const ackBody = bridgeBodies[2];
        const serializedAck = JSON.stringify(ackBody);
        assert.equal(Object.hasOwn(ackBody, 'output'), false);
        assert.equal(serializedAck.includes(output().summary), false);
        assert.equal(serializedAck.includes('recommended_next_steps'), false);
        assert.match(serializedAck, /outputSha256/);
        assert.equal(ackBody.receipt.toolsCalled, 0);
        assert.equal(ackBody.receipt.emailsSent, 0);
        assert.equal(ackBody.receipt.memoryWrites, 0);
        assert.equal(ackBody.receipt.outboundActions, 0);
    } finally {
        await rm(outputDir, { recursive: true, force: true });
        await rm(hermesHome, { recursive: true, force: true });
    }
});

test('begin refusal or lost response never reaches the provider process', async (t) => {
    const scenarios = [
        {
            beginStatus: 'already_started',
            failStatus: 'dead_letter',
            failureCode: 'provider_execution_ambiguous',
            hermesExecutionHappened: true,
        },
        {
            beginStatus: 'stale',
            failStatus: 'stale',
            failureCode: 'hermes_execution_failed',
            hermesExecutionHappened: false,
        },
        {
            beginStatus: 'response_lost',
            failStatus: 'retry_scheduled',
            failureCode: 'hermes_execution_failed',
            hermesExecutionHappened: false,
        },
    ];

    for (const [index, scenario] of scenarios.entries()) {
        const suffix = `${process.pid}-${Date.now()}-${index}`;
        const outputDir = resolve(tmpdir(), `amy-anam-begin-guard-output-${suffix}`);
        const hermesHome = resolve(tmpdir(), `amy-anam-begin-guard-home-${suffix}`);
        t.after(() => rm(outputDir, { recursive: true, force: true }));
        t.after(() => rm(hermesHome, { recursive: true, force: true }));
        const env = {
            AMY_ANAM_SESSION_SPINE_ENABLED: 'true',
            AMY_ANAM_SESSION_SPINE_KILL_SWITCH: 'false',
            AMY_ANAM_HERMES_SHADOW_ENABLED: 'true',
            AMY_ANAM_HERMES_SHADOW_KILL_SWITCH: 'false',
            AMY_ANAM_HERMES_SHADOW_MODE: 'shadow',
            AMY_ANAM_HERMES_WORKER_BRIDGE_URL: 'https://preview.example.test/api/anam/hermes/worker',
            AMY_ANAM_HERMES_WORKER_SECRET: SECRET,
            AMY_ANAM_HERMES_HOME: hermesHome,
            AMY_ANAM_HERMES_WORKER_OUTPUT_DIR: outputDir,
            AMY_ANAM_HERMES_PROVIDER: 'openai-codex',
            AMY_ANAM_HERMES_MODEL: 'gpt-5.5',
            AMY_ANAM_HERMES_PYTHON_COMMAND: 'C:\\safe-bin\\python.exe',
            ANAM_API_KEY: 'local-anam-key',
        };
        const identity = buildAmyAnamHermesWorkerSessionIdentity(sessionRecord());
        const bridgeBodies = [];
        const bridgeFetchImpl = async (_url, init) => {
            const body = JSON.parse(init.body);
            bridgeBodies.push(body);
            if (body.operation === 'claim') {
                return new Response(JSON.stringify({
                    ok: true,
                    operation: 'claim',
                    found: true,
                    lease: lease(),
                    session: identity,
                    contentIncluded: false,
                }), { status: 200 });
            }
            if (body.operation === 'begin') {
                if (scenario.beginStatus === 'response_lost') {
                    throw new Error('synthetic response loss after durable begin');
                }
                return new Response(JSON.stringify({
                    ok: true,
                    operation: 'begin',
                    status: scenario.beginStatus,
                    contentIncluded: false,
                }), { status: 200 });
            }
            if (body.operation === 'fail') {
                return new Response(JSON.stringify({
                    ok: true,
                    operation: 'fail',
                    status: scenario.failStatus,
                    contentIncluded: false,
                }), { status: 200 });
            }
            throw new Error('Provider acknowledgement must not be reached');
        };
        const anamPayloads = [
            {
                id: SESSION_ID,
                clientLabel: identity.clientLabel,
                personaId: identity.resolvedPersonaId,
                endTime: '2026-07-14T20:00:00.000Z',
                exitStatus: 'completed',
                personaConfig: { personaId: identity.resolvedPersonaId, zeroDataRetention: false },
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
        let spawnCalls = 0;
        const result = await processOneAmyAnamHermesShadowJob({
            env,
            now: NOW,
            bridgeFetchImpl,
            anamFetchImpl: async () => new Response(JSON.stringify(anamPayloads.shift()), { status: 200 }),
            spawnImpl: () => {
                spawnCalls += 1;
                throw new Error('Provider process must not start');
            },
        });

        assert.equal(spawnCalls, 0);
        assert.equal(result.status, scenario.failStatus);
        assert.equal(result.failureCode, scenario.failureCode);
        assert.equal(result.hermesExecutionHappened, scenario.hermesExecutionHappened);
        assert.deepEqual(bridgeBodies.map(body => body.operation), ['claim', 'begin', 'fail']);
        assert.equal(bridgeBodies[2].failureCode, scenario.failureCode);
        assert.equal(
            bridgeBodies[2].hermesExecutionHappened,
            scenario.hermesExecutionHappened,
        );
    }
});

test('bridge client validates responses and route is POST-only with bounded auth-first parsing', async () => {
    const env = {
        ...SERVER_ENV,
        AMY_ANAM_HERMES_WORKER_BRIDGE_URL: 'https://preview.example.test/api/anam/hermes/worker',
        AMY_ANAM_HERMES_HOME: resolve(tmpdir(), 'bridge-config-test-home'),
        AMY_ANAM_HERMES_PROVIDER: 'openai-codex',
        AMY_ANAM_HERMES_MODEL: 'gpt-5.5',
        AMY_ANAM_HERMES_PYTHON_COMMAND: 'C:\\safe-bin\\python.exe',
        ANAM_API_KEY: 'local-anam-key',
    };
    const config = readAmyAnamHermesWorkerConfig(env);
    const response = await callAmyAnamHermesWorkerBridge(
        {
            operation: 'claim',
            protocolVersion: AMY_ANAM_HERMES_WORKER_PROTOCOL_VERSION,
        },
        config,
        {
            fetchImpl: async () => new Response(JSON.stringify({
                ok: true,
                operation: 'claim',
                found: false,
                contentIncluded: false,
            }), { status: 200 }),
        },
    );
    assert.equal(response.found, false);

    const routeSource = await readFile(
        new URL('../app/api/anam/hermes/worker/route.ts', import.meta.url),
        'utf8',
    );
    assert.match(routeSource, /export async function POST/);
    assert.doesNotMatch(routeSource, /export async function GET/);
    assert.match(routeSource, /isAmyAnamHermesWorkerAuthorized\(request\)/);
    assert.match(routeSource, /AMY_ANAM_HERMES_WORKER_BRIDGE_MAX_BODY_BYTES/);
    assert.match(routeSource, /readBoundedJsonObject/);
    assert.match(routeSource, /readAmyAnamSpineConfig/);
    assert.match(routeSource, /!shadowConfig\.gatesOpen \|\| !spineConfig\.gatesOpen/);
    assert.doesNotMatch(routeSource, /console\.(?:log|info|warn|error)/);
});
