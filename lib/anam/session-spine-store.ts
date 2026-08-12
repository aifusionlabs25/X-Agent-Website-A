import {
    AMY_ANAM_LAUNCH_TTL_SECONDS,
    AMY_ANAM_RECORD_TTL_SECONDS,
    DANI_AI_SOLUTIONS_VARIANT,
    readAmyAnamSpineConfig,
    resolveAnamSessionAgentSlug,
    resolveAnamSessionVariant,
} from './session-spine.ts';
import type {
    AmyAnamFinalizationRecord,
    AmyAnamLaunchRecord,
    AmyAnamSessionReceipt,
    AmyAnamSessionRecord,
} from './session-spine.ts';
import type { AmyAnamHermesShadowQueuedEnvelope } from './hermes-shadow-store.ts';
import {
    assertDaniAnamMemoryReviewArtifact,
    type DaniAnamMemoryReviewArtifact,
} from './dani-memory-candidate.ts';
import type { DaniAnamMemoryCandidateEligibility } from './dani-user-memory.ts';
import { DANI_PERSONA_ID } from './persona-ids.ts';

type StoreOptions = {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
};

type ReceiptWriteOptions = StoreOptions & {
    hermesShadowEnvelope?: AmyAnamHermesShadowQueuedEnvelope;
    daniMemoryReviewArtifact?: DaniAnamMemoryReviewArtifact;
    daniMemoryEligibility?: DaniAnamMemoryCandidateEligibility;
};

export type AmyAnamReceiptWriteStatus =
    | 'stored'
    | 'duplicate'
    | 'stale'
    | 'candidate_stored'
    | 'candidate_duplicate'
    | 'candidate_conflict';

type RedisPipelineItem = {
    result?: unknown;
    error?: string;
};

const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function launchKey(launchId: string): string {
    return `xagent:amy:anam:launch:v1:${launchId}`;
}

function sessionKey(sessionId: string): string {
    return `xagent:amy:anam:session:v1:${sessionId}`;
}

function receiptKey(sessionId: string): string {
    return `xagent:amy:anam:receipt:v1:${sessionId}`;
}

function daniMemoryReviewCandidateKey(externalSessionId: string, jobId: string): string {
    return `xagent:dani:anam:memory-review-candidate:v1:${externalSessionId}:${jobId}`;
}

function finalizationKey(sessionId: string): string {
    return `xagent:amy:anam:finalization:v1:${sessionId}`;
}

function finalizationDueKey(): string {
    return 'xagent:amy:anam:finalization-due:v1';
}

function daniEmailRetryDueKey(): string {
    return 'xagent:dani:anam:agentmail:retry-due:v1';
}

function recoveryDrainLockKey(): string {
    return 'xagent:amy:anam:recovery-drain-lock:v1';
}

function completionByLaunchKey(launchId: string): string {
    return `xagent:amy:anam:completion-launch:v1:${launchId}`;
}

function completionLockKey(sessionId: string): string {
    return `xagent:amy:anam:complete-lock:v1:${sessionId}`;
}

function rateLimitKey(fingerprint: string): string {
    return `xagent:amy:anam:rate:v1:${fingerprint}`;
}

async function redisPipeline(
    commands: Array<Array<string | number>>,
    options: StoreOptions = {},
): Promise<RedisPipelineItem[]> {
    const config = readAmyAnamSpineConfig(options.env ?? process.env);
    if (!config.gatesOpen) {
        throw new Error('Amy Anam session spine is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    let payload: unknown;
    try {
        const response = await (options.fetchImpl ?? fetch)(`${config.redisUrl}/pipeline`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.redisToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(commands),
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error('Store returned an error status');
        }
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) {
            throw new Error('Store response was too large');
        }
        payload = JSON.parse(raw) as unknown;
    } catch {
        throw new Error('Amy Anam session store request failed');
    } finally {
        clearTimeout(timeout);
    }

    if (!Array.isArray(payload) || payload.length !== commands.length) {
        throw new Error('Amy Anam session store returned an invalid response');
    }

    for (const item of payload as RedisPipelineItem[]) {
        if (item?.error) throw new Error('Amy Anam session store rejected a command');
    }
    return payload as RedisPipelineItem[];
}

async function redisCommand(
    command: Array<string | number>,
    options: StoreOptions = {},
): Promise<unknown> {
    return (await redisPipeline([command], options))[0]?.result ?? null;
}

function parseRecord<T>(value: unknown): T | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') return value as T;
    try {
        return JSON.parse(String(value)) as T;
    } catch {
        throw new Error('Amy Anam session store contained an invalid record');
    }
}

export async function storeAmyAnamLaunch(
    launch: AmyAnamLaunchRecord,
    options: StoreOptions = {},
): Promise<boolean> {
    const result = await redisCommand([
        'SET',
        launchKey(launch.launchId),
        JSON.stringify(launch),
        'NX',
        'EX',
        AMY_ANAM_LAUNCH_TTL_SECONDS,
    ], options);
    return result === 'OK';
}

export async function deleteAmyAnamLaunch(
    launchId: string,
    options: StoreOptions = {},
): Promise<void> {
    await redisCommand(['DEL', launchKey(launchId)], options);
}

export async function readAmyAnamLaunch(
    launchId: string,
    options: StoreOptions = {},
): Promise<AmyAnamLaunchRecord | null> {
    return parseRecord<AmyAnamLaunchRecord>(
        await redisCommand(['GET', launchKey(launchId)], options),
    );
}

export type AmyAnamBindStatus =
    | 'bound'
    | 'duplicate'
    | 'missing'
    | 'owner_mismatch'
    | 'persona_mismatch'
    | 'launch_conflict'
    | 'session_conflict';

export async function bindAmyAnamLaunch(input: {
    launch: AmyAnamLaunchRecord;
    browserSessionId: string;
    externalSessionId: string;
    now?: number;
}, options: StoreOptions = {}): Promise<AmyAnamBindStatus> {
    const now = input.now ?? Date.now();
    const boundAt = new Date(now).toISOString();
    const agentSlug = resolveAnamSessionAgentSlug(
        input.launch.resolvedPersonaId,
        input.launch.agentSlug,
    );
    const variant = resolveAnamSessionVariant(
        input.launch.resolvedPersonaId,
        input.launch.variant,
    );
    const updatedLaunch: AmyAnamLaunchRecord = {
        ...input.launch,
        agentSlug,
        variant,
        state: 'bound',
        boundSessionId: input.externalSessionId,
        boundAt,
    };
    const session: AmyAnamSessionRecord = {
        schemaVersion: 'amy_anam_session_v1',
        browserSessionId: input.browserSessionId,
        launchId: input.launch.launchId,
        externalSessionId: input.externalSessionId,
        clientLabel: input.launch.clientLabel,
        resolvedPersonaId: input.launch.resolvedPersonaId,
        provider: 'anam',
        agentSlug,
        variant,
        state: 'bound',
        createdAt: input.launch.createdAt,
        boundAt,
    };
    const script = [
        "local launchRaw = redis.call('GET', KEYS[1])",
        "if not launchRaw then return 'missing' end",
        'local launch = cjson.decode(launchRaw)',
        "if launch.browserSessionId ~= ARGV[1] then return 'owner_mismatch' end",
        "if launch.resolvedPersonaId ~= ARGV[2] then return 'persona_mismatch' end",
        "if launch.boundSessionId and launch.boundSessionId ~= ARGV[3] then return 'launch_conflict' end",
        "local sessionRaw = redis.call('GET', KEYS[2])",
        'if sessionRaw then',
        '  local session = cjson.decode(sessionRaw)',
        "  if session.browserSessionId == ARGV[1] and session.launchId == ARGV[4] then return 'duplicate' end",
        "  return 'session_conflict'",
        'end',
        "redis.call('SET', KEYS[1], ARGV[5], 'EX', ARGV[7])",
        "redis.call('SET', KEYS[2], ARGV[6], 'EX', ARGV[7])",
        "return 'bound'",
    ].join(' ');
    const result = await redisCommand([
        'EVAL',
        script,
        2,
        launchKey(input.launch.launchId),
        sessionKey(input.externalSessionId),
        input.browserSessionId,
        input.launch.resolvedPersonaId,
        input.externalSessionId,
        input.launch.launchId,
        JSON.stringify(updatedLaunch),
        JSON.stringify(session),
        AMY_ANAM_RECORD_TTL_SECONDS,
    ], options);
    return String(result) as AmyAnamBindStatus;
}

export async function readAmyAnamSession(
    externalSessionId: string,
    options: StoreOptions = {},
): Promise<AmyAnamSessionRecord | null> {
    return parseRecord<AmyAnamSessionRecord>(
        await redisCommand(['GET', sessionKey(externalSessionId)], options),
    );
}

export async function readAmyAnamReceipt(
    externalSessionId: string,
    options: StoreOptions = {},
): Promise<AmyAnamSessionReceipt | null> {
    return parseRecord<AmyAnamSessionReceipt>(
        await redisCommand(['GET', receiptKey(externalSessionId)], options),
    );
}

function candidateMatchesReceipt(
    artifact: DaniAnamMemoryReviewArtifact,
    receipt: AmyAnamSessionReceipt,
): boolean {
    return artifact.externalSessionId === receipt.externalSessionId
        && artifact.sourceReceiptId === receipt.receiptId
        && artifact.sourceTranscriptSha256 === receipt.transcript.contentSha256
        && artifact.sourceMessageCount === receipt.transcript.messageCount
        && receipt.schemaVersion === 'amy_anam_session_receipt_v1'
        && receipt.provider === 'anam'
        && receipt.status === 'completed'
        && receipt.transcript.source === 'anam_api'
        && receipt.transcript.rawTranscriptPersisted === false
        && Object.values(receipt.actions).every(value => value === false);
}

export async function readDaniAnamMemoryReviewCandidate(input: {
    externalSessionId: string;
    jobId: string;
}, options: StoreOptions = {}): Promise<DaniAnamMemoryReviewArtifact | null> {
    const externalSessionId = String(input.externalSessionId ?? '').trim();
    const jobId = String(input.jobId ?? '').trim().toLowerCase();
    if (!SAFE_SESSION_ID_PATTERN.test(externalSessionId) || !SHA256_PATTERN.test(jobId)) {
        throw new Error('Dani memory review candidate identity was invalid');
    }
    const [candidateResult, receiptResult] = await redisPipeline([
        ['GET', daniMemoryReviewCandidateKey(externalSessionId, jobId)],
        ['GET', receiptKey(externalSessionId)],
    ], options);
    const rawCandidate = candidateResult?.result;
    const rawReceipt = receiptResult?.result;
    if (rawCandidate === null || rawCandidate === undefined || rawReceipt === null || rawReceipt === undefined) {
        return null;
    }
    const artifact = assertDaniAnamMemoryReviewArtifact(parseRecord<unknown>(rawCandidate));
    const receipt = parseRecord<AmyAnamSessionReceipt>(rawReceipt);
    if (
        !receipt
        || artifact.externalSessionId !== externalSessionId
        || artifact.jobId !== jobId
        || !candidateMatchesReceipt(artifact, receipt)
    ) {
        throw new Error('Dani memory review candidate did not match its canonical receipt');
    }
    return artifact;
}

export async function readAmyAnamFinalization(
    externalSessionId: string,
    options: StoreOptions = {},
): Promise<AmyAnamFinalizationRecord | null> {
    return parseRecord<AmyAnamFinalizationRecord>(
        await redisCommand(['GET', finalizationKey(externalSessionId)], options),
    );
}

export async function listDueAmyAnamFinalizationIds(input: {
    dueAt?: number;
    limit: number;
}, options: StoreOptions = {}): Promise<string[]> {
    const dueAt = Number.isFinite(input.dueAt) ? Math.trunc(input.dueAt as number) : Date.now();
    const limit = Math.max(1, Math.min(16, Math.trunc(input.limit) || 1));
    const result = await redisCommand([
        'ZRANGEBYSCORE',
        finalizationDueKey(),
        '-inf',
        dueAt,
        'LIMIT',
        0,
        limit,
    ], options);
    if (!Array.isArray(result)) {
        throw new Error('Amy Anam finalization queue returned an invalid response');
    }
    return result.map(value => String(value));
}

export async function removeAmyAnamFinalizationDueEntry(
    externalSessionId: string,
    options: StoreOptions = {},
): Promise<void> {
    await redisCommand(['ZREM', finalizationDueKey(), externalSessionId], options);
}

export async function scheduleAmyAnamFinalizationDueEntry(input: {
    externalSessionId: string;
    dueAt: number;
}, options: StoreOptions = {}): Promise<void> {
    const externalSessionId = String(input.externalSessionId ?? '').trim();
    if (!SAFE_SESSION_ID_PATTERN.test(externalSessionId) || !Number.isFinite(input.dueAt)) {
        throw new Error('Amy Anam finalization retry schedule was invalid');
    }
    await redisPipeline([
        ['ZADD', finalizationDueKey(), Math.trunc(input.dueAt), externalSessionId],
        ['EXPIRE', finalizationDueKey(), AMY_ANAM_RECORD_TTL_SECONDS],
    ], options);
}

export async function scheduleDaniAnamEmailRetryDueEntry(input: {
    externalSessionId: string;
    dueAt: number;
}, options: StoreOptions = {}): Promise<void> {
    const externalSessionId = String(input.externalSessionId ?? '').trim();
    if (!SAFE_SESSION_ID_PATTERN.test(externalSessionId) || !Number.isFinite(input.dueAt)) {
        throw new Error('Dani AgentMail retry schedule was invalid');
    }
    await redisPipeline([
        ['ZADD', daniEmailRetryDueKey(), Math.trunc(input.dueAt), externalSessionId],
        ['EXPIRE', daniEmailRetryDueKey(), AMY_ANAM_RECORD_TTL_SECONDS],
    ], options);
}

export async function listDueDaniAnamEmailRetryIds(input: {
    dueAt?: number;
    limit: number;
}, options: StoreOptions = {}): Promise<string[]> {
    const dueAt = Number.isFinite(input.dueAt) ? Math.trunc(input.dueAt as number) : Date.now();
    const limit = Math.max(1, Math.min(16, Math.trunc(input.limit) || 1));
    const result = await redisCommand([
        'ZRANGEBYSCORE',
        daniEmailRetryDueKey(),
        '-inf',
        dueAt,
        'LIMIT',
        0,
        limit,
    ], options);
    if (!Array.isArray(result)) {
        throw new Error('Dani AgentMail retry queue returned an invalid response');
    }
    return result.map(value => String(value));
}

export async function hasDaniAnamEmailRetryDueEntry(
    externalSessionId: string,
    options: StoreOptions = {},
): Promise<boolean> {
    if (!SAFE_SESSION_ID_PATTERN.test(String(externalSessionId ?? '').trim())) return false;
    return await redisCommand([
        'ZSCORE', daniEmailRetryDueKey(), externalSessionId,
    ], options) !== null;
}

export async function removeDaniAnamEmailRetryDueEntry(
    externalSessionId: string,
    options: StoreOptions = {},
): Promise<void> {
    await redisCommand(['ZREM', daniEmailRetryDueKey(), externalSessionId], options);
}

export async function acquireAmyAnamRecoveryDrainLock(
    lockToken: string,
    options: StoreOptions = {},
): Promise<boolean> {
    const result = await redisCommand([
        'SET',
        recoveryDrainLockKey(),
        lockToken,
        'NX',
        'EX',
        55,
    ], options);
    return result === 'OK';
}

export async function releaseAmyAnamRecoveryDrainLock(
    lockToken: string,
    options: StoreOptions = {},
): Promise<void> {
    const script = [
        "if redis.call('GET', KEYS[1]) == ARGV[1] then",
        "  return redis.call('DEL', KEYS[1])",
        'end',
        'return 0',
    ].join(' ');
    await redisCommand([
        'EVAL',
        script,
        1,
        recoveryDrainLockKey(),
        lockToken,
    ], options);
}

export type AmyAnamCompletionRecordStatus =
    | 'queued'
    | 'duplicate'
    | 'missing'
    | 'owner_mismatch'
    | 'launch_conflict'
    | 'session_conflict'
    | 'terminal';

export async function recordAmyAnamCompletion(input: {
    launch: AmyAnamLaunchRecord;
    browserSessionId: string;
    externalSessionId: string;
    closeReason: string;
    now?: number;
}, options: StoreOptions = {}): Promise<AmyAnamCompletionRecordStatus> {
    const now = input.now ?? Date.now();
    const receivedAt = new Date(now).toISOString();
    const finalization: AmyAnamFinalizationRecord = {
        schemaVersion: 'amy_anam_finalization_v1',
        browserSessionId: input.browserSessionId,
        launchId: input.launch.launchId,
        externalSessionId: input.externalSessionId,
        state: 'verification_pending',
        closeReason: input.closeReason,
        receivedAt,
        updatedAt: receivedAt,
        attempts: 0,
        nextAttemptAt: receivedAt,
    };
    const script = [
        "local launchRaw = redis.call('GET', KEYS[1])",
        "if not launchRaw then return 'missing' end",
        'local launch = cjson.decode(launchRaw)',
        "if launch.browserSessionId ~= ARGV[1] then return 'owner_mismatch' end",
        "if launch.boundSessionId and launch.boundSessionId ~= ARGV[3] then return 'launch_conflict' end",
        "local claimedSessionId = redis.call('GET', KEYS[6])",
        "if claimedSessionId and claimedSessionId ~= ARGV[3] then return 'launch_conflict' end",
        "local sessionRaw = redis.call('GET', KEYS[2])",
        'if sessionRaw then',
        '  local session = cjson.decode(sessionRaw)',
        "  if session.browserSessionId ~= ARGV[1] or session.launchId ~= ARGV[2] then return 'session_conflict' end",
        'end',
        "if redis.call('EXISTS', KEYS[5]) == 1 then",
        "  if not sessionRaw then return 'session_conflict' end",
        "  redis.call('ZREM', KEYS[4], ARGV[3])",
        "  return 'terminal'",
        'end',
        "local finalRaw = redis.call('GET', KEYS[3])",
        'if finalRaw then',
        '  local finalization = cjson.decode(finalRaw)',
        "  if finalization.browserSessionId == ARGV[1] and finalization.launchId == ARGV[2] then return 'duplicate' end",
        "  return 'session_conflict'",
        'end',
        'if sessionRaw then',
        '  local session = cjson.decode(sessionRaw)',
        "  session.state = 'close_received'",
        '  session.closeReceivedAt = session.closeReceivedAt or ARGV[4]',
        '  session.closeReason = session.closeReason or ARGV[5]',
        "  redis.call('SET', KEYS[2], cjson.encode(session), 'EX', ARGV[8])",
        'end',
        "redis.call('SET', KEYS[3], ARGV[6], 'EX', ARGV[8])",
        "redis.call('SET', KEYS[6], ARGV[3], 'EX', ARGV[8])",
        "redis.call('ZADD', KEYS[4], ARGV[7], ARGV[3])",
        "redis.call('EXPIRE', KEYS[4], ARGV[8])",
        "return 'queued'",
    ].join(' ');
    const result = await redisCommand([
        'EVAL',
        script,
        6,
        launchKey(input.launch.launchId),
        sessionKey(input.externalSessionId),
        finalizationKey(input.externalSessionId),
        finalizationDueKey(),
        receiptKey(input.externalSessionId),
        completionByLaunchKey(input.launch.launchId),
        input.browserSessionId,
        input.launch.launchId,
        input.externalSessionId,
        receivedAt,
        input.closeReason,
        JSON.stringify(finalization),
        now,
        AMY_ANAM_RECORD_TTL_SECONDS,
    ], options);
    return String(result) as AmyAnamCompletionRecordStatus;
}

export async function markAmyAnamVerificationPending(input: {
    finalization: AmyAnamFinalizationRecord;
    retryAfterMs: number;
    now?: number;
}, options: StoreOptions = {}): Promise<void> {
    const now = input.now ?? Date.now();
    const nextAttemptAt = now + Math.max(1_000, input.retryAfterMs);
    const finalization: AmyAnamFinalizationRecord = {
        ...input.finalization,
        state: 'verification_pending',
        attempts: input.finalization.attempts + 1,
        updatedAt: new Date(now).toISOString(),
        nextAttemptAt: new Date(nextAttemptAt).toISOString(),
    };
    const script = [
        "if redis.call('EXISTS', KEYS[3]) == 1 then redis.call('ZREM', KEYS[2], ARGV[4]); return 'terminal' end",
        "local currentRaw = redis.call('GET', KEYS[1])",
        "if not currentRaw then return 'stale' end",
        'local current = cjson.decode(currentRaw)',
        "if current.updatedAt ~= ARGV[5] then return 'stale' end",
        "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])",
        "redis.call('ZADD', KEYS[2], ARGV[2], ARGV[4])",
        "redis.call('EXPIRE', KEYS[2], ARGV[3])",
        "return 'OK'",
    ].join(' ');
    const result = await redisCommand([
        'EVAL',
        script,
        3,
        finalizationKey(input.finalization.externalSessionId),
        finalizationDueKey(),
        receiptKey(input.finalization.externalSessionId),
        JSON.stringify(finalization),
        nextAttemptAt,
        AMY_ANAM_RECORD_TTL_SECONDS,
        input.finalization.externalSessionId,
        input.finalization.updatedAt,
    ], options);
    if (result !== 'OK' && result !== 'terminal' && result !== 'stale') {
        throw new Error('Amy Anam verification state could not be stored');
    }
}

export async function markAmyAnamFinalizationPending(input: {
    session: AmyAnamSessionRecord;
    finalization: AmyAnamFinalizationRecord;
    retryAfterMs: number;
    now?: number;
}, options: StoreOptions = {}): Promise<void> {
    const now = input.now ?? Date.now();
    const nextAttemptAt = now + Math.max(1_000, input.retryAfterMs);
    const session: AmyAnamSessionRecord = {
        ...input.session,
        state: 'awaiting_transcript',
    };
    const finalization: AmyAnamFinalizationRecord = {
        ...input.finalization,
        state: 'awaiting_transcript',
        attempts: input.finalization.attempts + 1,
        updatedAt: new Date(now).toISOString(),
        nextAttemptAt: new Date(nextAttemptAt).toISOString(),
    };
    const script = [
        "if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('ZREM', KEYS[3], ARGV[5]); return 'terminal' end",
        "local currentRaw = redis.call('GET', KEYS[2])",
        "if not currentRaw then return 'stale' end",
        'local current = cjson.decode(currentRaw)',
        "if current.updatedAt ~= ARGV[6] then return 'stale' end",
        "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])",
        "redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])",
        "redis.call('ZADD', KEYS[3], ARGV[3], ARGV[5])",
        "redis.call('EXPIRE', KEYS[3], ARGV[4])",
        "return 'OK'",
    ].join(' ');
    const result = await redisCommand([
        'EVAL',
        script,
        4,
        sessionKey(session.externalSessionId),
        finalizationKey(session.externalSessionId),
        finalizationDueKey(),
        receiptKey(session.externalSessionId),
        JSON.stringify(session),
        JSON.stringify(finalization),
        nextAttemptAt,
        AMY_ANAM_RECORD_TTL_SECONDS,
        session.externalSessionId,
        input.finalization.updatedAt,
    ], options);
    if (result !== 'OK' && result !== 'terminal' && result !== 'stale') {
        throw new Error('Amy Anam finalization state could not be stored');
    }
}

export async function markAmyAnamFinalizationFailed(input: {
    session: AmyAnamSessionRecord | null;
    finalization: AmyAnamFinalizationRecord;
    failureCode: NonNullable<AmyAnamFinalizationRecord['failureCode']>;
    now?: number;
}, options: StoreOptions = {}): Promise<void> {
    const now = input.now ?? Date.now();
    const session: AmyAnamSessionRecord | null = input.session
        ? { ...input.session, state: 'finalization_failed' }
        : null;
    const finalization: AmyAnamFinalizationRecord = {
        ...input.finalization,
        state: 'failed',
        attempts: input.finalization.attempts + 1,
        updatedAt: new Date(now).toISOString(),
        nextAttemptAt: null,
        failureCode: input.failureCode,
    };
    const script = [
        "if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('ZREM', KEYS[3], ARGV[4]); return 'terminal' end",
        "local currentRaw = redis.call('GET', KEYS[2])",
        "if not currentRaw then return 'stale' end",
        'local current = cjson.decode(currentRaw)',
        "if current.updatedAt ~= ARGV[5] then return 'stale' end",
        "if ARGV[1] ~= '' then redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3]) end",
        "redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])",
        "redis.call('ZREM', KEYS[3], ARGV[4])",
        "return 'OK'",
    ].join(' ');
    const result = await redisCommand([
        'EVAL',
        script,
        4,
        sessionKey(input.finalization.externalSessionId),
        finalizationKey(input.finalization.externalSessionId),
        finalizationDueKey(),
        receiptKey(input.finalization.externalSessionId),
        session ? JSON.stringify(session) : '',
        JSON.stringify(finalization),
        AMY_ANAM_RECORD_TTL_SECONDS,
        input.finalization.externalSessionId,
        input.finalization.updatedAt,
    ], options);
    if (result !== 'OK' && result !== 'terminal' && result !== 'stale') {
        throw new Error('Amy Anam finalization failure could not be stored');
    }
}

export type AmyAnamFailedFinalizationRetryStatus =
    | 'completed'
    | 'missing'
    | 'not_retryable'
    | 'requeued'
    | 'stale';

export async function requeueAmyAnamProviderResponseFailure(
    externalSessionId: string,
    options: StoreOptions = {},
): Promise<AmyAnamFailedFinalizationRetryStatus> {
    const existingReceipt = await readAmyAnamReceipt(externalSessionId, options);
    if (existingReceipt) return 'completed';

    const [currentSession, currentFinalization] = await Promise.all([
        readAmyAnamSession(externalSessionId, options),
        readAmyAnamFinalization(externalSessionId, options),
    ]);
    if (!currentSession || !currentFinalization) return 'missing';
    if (
        currentFinalization.state !== 'failed'
        || currentFinalization.failureCode !== 'provider_response'
    ) {
        return 'not_retryable';
    }

    const now = Date.now();
    const retryAt = new Date(now).toISOString();
    const session: AmyAnamSessionRecord = {
        ...currentSession,
        state: 'awaiting_transcript',
    };
    const finalization: AmyAnamFinalizationRecord = {
        ...currentFinalization,
        state: 'awaiting_transcript',
        attempts: currentFinalization.attempts + 1,
        updatedAt: retryAt,
        nextAttemptAt: retryAt,
        failureCode: undefined,
    };
    const script = [
        "if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('ZREM', KEYS[3], ARGV[5]); return 'terminal' end",
        "local currentRaw = redis.call('GET', KEYS[2])",
        "if not currentRaw then return 'missing' end",
        'local current = cjson.decode(currentRaw)',
        "if current.updatedAt ~= ARGV[6] then return 'stale' end",
        "if current.state ~= 'failed' or current.failureCode ~= 'provider_response' then return 'not_retryable' end",
        "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])",
        "redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])",
        "redis.call('ZADD', KEYS[3], ARGV[3], ARGV[5])",
        "redis.call('EXPIRE', KEYS[3], ARGV[4])",
        "return 'OK'",
    ].join(' ');
    const result = await redisCommand([
        'EVAL',
        script,
        4,
        sessionKey(externalSessionId),
        finalizationKey(externalSessionId),
        finalizationDueKey(),
        receiptKey(externalSessionId),
        JSON.stringify(session),
        JSON.stringify(finalization),
        now,
        AMY_ANAM_RECORD_TTL_SECONDS,
        externalSessionId,
        currentFinalization.updatedAt,
    ], options);

    if (result === 'OK') return 'requeued';
    if (result === 'terminal') return 'completed';
    if (result === 'missing') return 'missing';
    if (result === 'not_retryable') return 'not_retryable';
    if (result === 'stale') return 'stale';
    throw new Error('Amy Anam failed finalization could not be requeued');
}
export async function acquireAmyAnamCompletionLock(
    externalSessionId: string,
    lockToken: string,
    options: StoreOptions = {},
): Promise<boolean> {
    const result = await redisCommand([
        'SET',
        completionLockKey(externalSessionId),
        lockToken,
        'NX',
        'EX',
        55,
    ], options);
    return result === 'OK';
}

export async function releaseAmyAnamCompletionLock(
    externalSessionId: string,
    lockToken: string,
    options: StoreOptions = {},
): Promise<void> {
    const script = [
        "if redis.call('GET', KEYS[1]) == ARGV[1] then",
        "  return redis.call('DEL', KEYS[1])",
        'end',
        'return 0',
    ].join(' ');
    await redisCommand([
        'EVAL',
        script,
        1,
        completionLockKey(externalSessionId),
        lockToken,
    ], options);
}

export async function writeAmyAnamReceipt(
    session: AmyAnamSessionRecord,
    finalization: AmyAnamFinalizationRecord,
    receipt: AmyAnamSessionReceipt,
    options: ReceiptWriteOptions = {},
): Promise<AmyAnamReceiptWriteStatus> {
    const hasReviewArtifact = Boolean(options.daniMemoryReviewArtifact);
    const hasMemoryEligibility = Boolean(options.daniMemoryEligibility);
    if (hasReviewArtifact !== hasMemoryEligibility) {
        throw new Error('Dani memory candidate requires an active session eligibility binding');
    }
    const reviewArtifact = options.daniMemoryReviewArtifact
        ? assertDaniAnamMemoryReviewArtifact(options.daniMemoryReviewArtifact)
        : undefined;
    const eligibility = options.daniMemoryEligibility;
    if (reviewArtifact && eligibility) {
        if (
            session.schemaVersion !== 'amy_anam_session_v1'
            || session.provider !== 'anam'
            || session.agentSlug !== 'dani'
            || session.resolvedPersonaId !== DANI_PERSONA_ID
            || session.variant !== DANI_AI_SOLUTIONS_VARIANT
            || reviewArtifact.personaId !== DANI_PERSONA_ID
            || reviewArtifact.externalSessionId !== session.externalSessionId
            || eligibility.externalSessionId !== session.externalSessionId
            || !SAFE_SESSION_ID_PATTERN.test(eligibility.browserSessionId)
            || !SHA256_PATTERN.test(eligibility.emailIdentityHash)
            || !SAFE_SESSION_ID_PATTERN.test(eligibility.consentEpoch)
            || receipt.variant !== DANI_AI_SOLUTIONS_VARIANT
            || !candidateMatchesReceipt(reviewArtifact, receipt)
        ) {
            throw new Error('Dani memory candidate did not match the canonical session receipt');
        }
    }
    const completedSession: AmyAnamSessionRecord = {
        ...session,
        state: 'completed',
        completedAt: receipt.completedAt,
    };
    const completedFinalization: AmyAnamFinalizationRecord = {
        ...finalization,
        state: receipt.status,
        attempts: finalization.attempts + 1,
        updatedAt: receipt.completedAt,
        nextAttemptAt: null,
    };
    const envelope = options.hermesShadowEnvelope;
    if (envelope && (
        envelope.job.pointer.externalSessionId !== session.externalSessionId
        || envelope.job.pointer.receiptId !== receipt.receiptId
        || envelope.job.pointer.expectedMessageCount !== receipt.transcript.messageCount
        || envelope.job.pointer.expectedTranscriptSha256 !== receipt.transcript.contentSha256
        || envelope.job.attempts !== 0
        || envelope.receipt.status !== 'queued'
        || envelope.receipt.jobId !== envelope.job.pointer.jobId
        || envelope.receipt.externalSessionId !== session.externalSessionId
        || envelope.receipt.contentIncluded !== false
        || envelope.receipt.outboundActions !== 0
    )) {
        throw new Error('Amy Anam Hermes shadow envelope did not match the canonical receipt');
    }

    const keys: string[] = [
        receiptKey(session.externalSessionId),
        sessionKey(session.externalSessionId),
        finalizationKey(session.externalSessionId),
        finalizationDueKey(),
    ];
    const args: Array<string | number> = [
        JSON.stringify(receipt),
        JSON.stringify(completedSession),
        JSON.stringify(completedFinalization),
        AMY_ANAM_RECORD_TTL_SECONDS,
        session.externalSessionId,
        finalization.updatedAt,
    ];
    const scriptParts = [
        "if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('ZREM', KEYS[4], ARGV[5]); return 'duplicate' end",
        "local currentRaw = redis.call('GET', KEYS[3])",
        "if not currentRaw then return 'stale' end",
        'local current = cjson.decode(currentRaw)',
        "if current.updatedAt ~= ARGV[6] then return 'stale' end",
        "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])",
        "redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])",
        "redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])",
        "redis.call('ZREM', KEYS[4], ARGV[5])",
    ];
    if (envelope) {
        const envelopeKeyStart = keys.length + 1;
        const envelopeArgStart = args.length + 1;
        keys.push(
            envelope.keys.dedupe,
            envelope.keys.job,
            envelope.keys.due,
            envelope.keys.jobReceipt,
            envelope.keys.sessionReceipt,
        );
        args.push(
            envelope.jobJson,
            envelope.dueAt,
            envelope.job.pointer.jobId,
            envelope.receiptJson,
            envelope.ttlSeconds,
        );
        scriptParts.push(
            `if redis.call('SET', KEYS[${envelopeKeyStart}], '1', 'NX', 'EX', ARGV[${envelopeArgStart + 4}]) then`,
            `  redis.call('SET', KEYS[${envelopeKeyStart + 1}], ARGV[${envelopeArgStart}], 'EX', ARGV[${envelopeArgStart + 4}])`,
            `  redis.call('ZADD', KEYS[${envelopeKeyStart + 2}], ARGV[${envelopeArgStart + 1}], ARGV[${envelopeArgStart + 2}])`,
            `  redis.call('EXPIRE', KEYS[${envelopeKeyStart + 2}], ARGV[${envelopeArgStart + 4}])`,
            `  redis.call('SET', KEYS[${envelopeKeyStart + 3}], ARGV[${envelopeArgStart + 3}], 'EX', ARGV[${envelopeArgStart + 4}])`,
            `  redis.call('SET', KEYS[${envelopeKeyStart + 4}], ARGV[${envelopeArgStart + 3}], 'EX', ARGV[${envelopeArgStart + 4}])`,
            'end',
        );
    }
    if (reviewArtifact && eligibility) {
        const candidateKeyIndex = keys.length + 1;
        const candidateArgStart = args.length + 1;
        keys.push(daniMemoryReviewCandidateKey(reviewArtifact.externalSessionId, reviewArtifact.jobId));
        args.push(
            JSON.stringify(reviewArtifact),
        );
        scriptParts.push(
            `local existingCandidate = redis.call('GET', KEYS[${candidateKeyIndex}])`,
            `if not existingCandidate then redis.call('SET', KEYS[${candidateKeyIndex}], ARGV[${candidateArgStart}], 'EX', ARGV[4]); return 'candidate_stored' end`,
            `if existingCandidate == ARGV[${candidateArgStart}] then return 'candidate_duplicate' end`,
            "return 'candidate_conflict'",
        );
    } else {
        scriptParts.push("return 'OK'");
    }

    const command: Array<string | number> = [
        'EVAL',
        scriptParts.join(' '),
        keys.length,
        ...keys,
        ...args,
    ];
    const result = await redisCommand(command, options);
    if (!options.env && !options.fetchImpl) {
        console.info('[Amy Anam Receipt] Store transition', {
            result: String(result),
            hermesEnvelopeRequested: Boolean(envelope),
            daniMemoryCandidateRequested: Boolean(reviewArtifact),
            contentIncluded: false,
            outboundActions: 0,
        });
    }
    if (result === 'OK') return 'stored';
    if (
        result === 'duplicate'
        || result === 'stale'
        || result === 'candidate_stored'
        || result === 'candidate_duplicate'
        || result === 'candidate_conflict'
    ) return result;
    throw new Error('Amy Anam receipt could not be stored');
}

export async function consumeAmyAnamDistributedRateLimit(input: {
    fingerprint: string;
    limit: number;
    windowSeconds: number;
}, options: StoreOptions = {}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const script = [
        "local count = redis.call('INCR', KEYS[1])",
        "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
        "local ttl = redis.call('TTL', KEYS[1])",
        'return { count, ttl }',
    ].join(' ');
    const result = await redisCommand([
        'EVAL',
        script,
        1,
        rateLimitKey(input.fingerprint),
        input.windowSeconds,
    ], options);
    const [countValue, ttlValue] = Array.isArray(result) ? result : [0, input.windowSeconds];
    const count = Number(countValue);
    const ttl = Math.max(1, Number(ttlValue) || input.windowSeconds);
    return {
        allowed: count > 0 && count <= input.limit,
        retryAfterSeconds: count > input.limit ? ttl : 0,
    };
}
