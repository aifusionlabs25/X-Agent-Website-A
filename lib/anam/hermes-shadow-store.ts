import { randomUUID } from 'node:crypto';
import {
    AMY_ANAM_HERMES_SHADOW_RECEIPT_VERSION,
    buildAmyAnamHermesShadowReceipt,
    normalizeAmyAnamHermesShadowPointer,
    normalizeAmyAnamSessionRecordForHermes,
    readAmyAnamHermesShadowConfig,
} from './hermes-shadow.ts';
import type {
    AmyAnamHermesShadowFailureCode,
    AmyAnamHermesShadowOutput,
    AmyAnamHermesShadowPointer,
    AmyAnamHermesShadowReceipt,
} from './hermes-shadow.ts';
import type { AmyAnamSessionRecord } from './session-spine.ts';

export const AMY_ANAM_HERMES_SHADOW_DUE_KEY = 'xagent:amy:anam:hermes-shadow:due:v1';
export const AMY_ANAM_HERMES_SHADOW_DEAD_KEY = 'xagent:amy:anam:hermes-shadow:dead:v1';

type StoreOptions = {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    now?: number;
};

type RedisPipelineItem = {
    result?: unknown;
    error?: string;
};

export type AmyAnamHermesShadowJob = {
    schemaVersion: 'amy_anam_hermes_shadow_job_v1';
    pointer: AmyAnamHermesShadowPointer;
    attempts: number;
};

export type AmyAnamHermesShadowLease = {
    job: AmyAnamHermesShadowJob;
    leaseToken: string;
    leaseUntil: number;
};

export type AmyAnamHermesShadowQueuedEnvelope = {
    keys: {
        dedupe: string;
        job: string;
        due: typeof AMY_ANAM_HERMES_SHADOW_DUE_KEY;
        jobReceipt: string;
        sessionReceipt: string;
    };
    job: AmyAnamHermesShadowJob;
    receipt: AmyAnamHermesShadowReceipt;
    jobJson: string;
    receiptJson: string;
    dueAt: number;
    ttlSeconds: number;
};

export function amyAnamHermesShadowJobKey(jobId: string): string {
    return `xagent:amy:anam:hermes-shadow:job:v1:${jobId}`;
}

export function amyAnamHermesShadowDeadJobKey(jobId: string): string {
    return `xagent:amy:anam:hermes-shadow:dead-job:v1:${jobId}`;
}

export function amyAnamHermesShadowLeaseKey(jobId: string): string {
    return `xagent:amy:anam:hermes-shadow:lease:v1:${jobId}`;
}

export function amyAnamHermesShadowDedupeKey(jobId: string): string {
    return `xagent:amy:anam:hermes-shadow:dedupe:v1:${jobId}`;
}

export function amyAnamHermesShadowJobReceiptKey(jobId: string): string {
    return `xagent:amy:anam:hermes-shadow:receipt:v1:${jobId}`;
}

export function amyAnamHermesShadowSessionReceiptKey(externalSessionId: string): string {
    return `xagent:amy:anam:hermes-shadow:session-receipt:v1:${externalSessionId}`;
}

function sessionRecordKey(externalSessionId: string): string {
    return `xagent:amy:anam:session:v1:${externalSessionId}`;
}

async function redisPipeline(
    commands: Array<Array<string | number>>,
    options: StoreOptions = {},
): Promise<RedisPipelineItem[]> {
    const config = readAmyAnamHermesShadowConfig(options.env ?? process.env);
    if (!config.gatesOpen) throw new Error('Amy Anam Hermes shadow queue gates are closed');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
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
        if (!response.ok) throw new Error('queue status');
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('queue size');
        payload = JSON.parse(raw) as unknown;
    } catch {
        throw new Error('Amy Anam Hermes shadow store request failed');
    } finally {
        clearTimeout(timeout);
    }

    if (!Array.isArray(payload) || payload.length !== commands.length) {
        throw new Error('Amy Anam Hermes shadow store returned an invalid response');
    }
    for (const item of payload as RedisPipelineItem[]) {
        if (item?.error) throw new Error('Amy Anam Hermes shadow store rejected a command');
    }
    return payload as RedisPipelineItem[];
}

async function redisCommand(
    command: Array<string | number>,
    options: StoreOptions = {},
): Promise<unknown> {
    return (await redisPipeline([command], options))[0]?.result ?? null;
}

function parseStoredJson(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(String(value)) as unknown;
    } catch {
        throw new Error('Amy Anam Hermes shadow store contained invalid JSON');
    }
}

export function normalizeAmyAnamHermesShadowJob(value: unknown): AmyAnamHermesShadowJob {
    const parsed = parseStoredJson(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Amy Anam Hermes shadow job is invalid');
    }
    const record = parsed as Record<string, unknown>;
    if (
        Object.keys(record).length !== 3
        || record.schemaVersion !== 'amy_anam_hermes_shadow_job_v1'
        || !Number.isInteger(record.attempts)
        || Number(record.attempts) < 0
        || Number(record.attempts) > 8
    ) {
        throw new Error('Amy Anam Hermes shadow job failed validation');
    }
    return {
        schemaVersion: 'amy_anam_hermes_shadow_job_v1',
        pointer: normalizeAmyAnamHermesShadowPointer(record.pointer),
        attempts: Number(record.attempts),
    };
}

function validateReceiptForCloud(receipt: AmyAnamHermesShadowReceipt): void {
    const expectedKeys = [
        'schemaVersion', 'jobId', 'externalSessionId', 'status', 'attempts', 'updatedAt',
        'nextAttemptAt', 'failureCode', 'hermesExecutionHappened', 'outputContractValid',
        'outputSha256', 'risks', 'toolsetRestricted', 'toolsCalled', 'emailsSent',
        'memoryWrites', 'outboundActions', 'rawTranscriptPersisted',
        'redactedTranscriptPersisted', 'generatedContentPersistedInCloud', 'contentIncluded',
    ].sort();
    const actualKeys = Object.keys(receipt).sort();
    if (
        actualKeys.length !== expectedKeys.length
        || actualKeys.some((key, index) => key !== expectedKeys[index])
        || receipt.schemaVersion !== AMY_ANAM_HERMES_SHADOW_RECEIPT_VERSION
        || !/^[a-f0-9]{64}$/.test(receipt.jobId)
        || typeof receipt.externalSessionId !== 'string'
        || !['queued', 'leased', 'retry_scheduled', 'completed', 'dead_letter'].includes(receipt.status)
        || !Number.isInteger(receipt.attempts)
        || receipt.attempts < 0
        || receipt.attempts > 8
        || !Number.isFinite(Date.parse(receipt.updatedAt))
        || (receipt.nextAttemptAt !== null && !Number.isFinite(Date.parse(receipt.nextAttemptAt)))
        || (receipt.failureCode !== null && ![
            'session_record_invalid',
            'provider_identity_mismatch',
            'transcript_not_ready',
            'transcript_integrity_mismatch',
            'hermes_timeout',
            'hermes_execution_failed',
            'output_contract_invalid',
            'local_output_failed',
        ].includes(receipt.failureCode))
        || typeof receipt.hermesExecutionHappened !== 'boolean'
        || typeof receipt.outputContractValid !== 'boolean'
        || (receipt.outputSha256 !== null && !/^[a-f0-9]{64}$/.test(receipt.outputSha256))
        || receipt.toolsetRestricted !== true
        || receipt.rawTranscriptPersisted !== false
        || receipt.redactedTranscriptPersisted !== false
        || receipt.generatedContentPersistedInCloud !== false
        || receipt.contentIncluded !== false
        || receipt.toolsCalled !== 0
        || receipt.emailsSent !== 0
        || receipt.memoryWrites !== 0
        || receipt.outboundActions !== 0
    ) {
        throw new Error('Hermes shadow receipt attempted to persist action or content state');
    }
    if (receipt.risks !== null) {
        const riskKeys = Object.keys(receipt.risks).sort();
        const expectedRiskKeys = [
            'repeatedQuestion',
            'unsupportedClaim',
            'pricingOrInventoryClaim',
            'technicalTerm',
            'privacy',
        ].sort();
        if (
            riskKeys.length !== expectedRiskKeys.length
            || riskKeys.some((key, index) => key !== expectedRiskKeys[index])
            || Object.values(receipt.risks).some(value => typeof value !== 'boolean')
        ) {
            throw new Error('Hermes shadow receipt risks were invalid');
        }
    }
    if (receipt.status === 'completed') {
        if (!receipt.outputContractValid || !receipt.outputSha256 || !receipt.risks) {
            throw new Error('Completed Hermes shadow receipt was incomplete');
        }
    } else if (receipt.outputContractValid || receipt.outputSha256 !== null || receipt.risks !== null) {
        throw new Error('Incomplete Hermes shadow receipt contained output state');
    }
}

export function normalizeAmyAnamHermesShadowReceiptForCloud(
    value: unknown,
): AmyAnamHermesShadowReceipt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Amy Anam Hermes shadow receipt is invalid');
    }
    const receipt = value as AmyAnamHermesShadowReceipt;
    validateReceiptForCloud(receipt);
    return receipt;
}

export function normalizeAmyAnamHermesShadowLease(
    value: unknown,
): AmyAnamHermesShadowLease {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Amy Anam Hermes shadow lease is invalid');
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (
        keys.length !== 3
        || keys[0] !== 'job'
        || keys[1] !== 'leaseToken'
        || keys[2] !== 'leaseUntil'
        || typeof record.leaseToken !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(record.leaseToken)
        || typeof record.leaseUntil !== 'number'
        || !Number.isFinite(record.leaseUntil)
    ) {
        throw new Error('Amy Anam Hermes shadow lease failed validation');
    }
    return {
        job: normalizeAmyAnamHermesShadowJob(record.job),
        leaseToken: record.leaseToken,
        leaseUntil: record.leaseUntil,
    };
}

export function buildAmyAnamHermesShadowJob(
    pointerValue: AmyAnamHermesShadowPointer,
): AmyAnamHermesShadowJob {
    return {
        schemaVersion: 'amy_anam_hermes_shadow_job_v1',
        pointer: normalizeAmyAnamHermesShadowPointer(pointerValue),
        attempts: 0,
    };
}

export function buildAmyAnamHermesShadowQueuedReceipt(
    pointerValue: AmyAnamHermesShadowPointer,
    now = Date.now(),
): AmyAnamHermesShadowReceipt {
    const receipt = buildAmyAnamHermesShadowReceipt({
        pointer: normalizeAmyAnamHermesShadowPointer(pointerValue),
        status: 'queued',
        attempts: 0,
        now,
    });
    validateReceiptForCloud(receipt);
    return receipt;
}

export function buildAmyAnamHermesShadowQueuedEnvelope(
    pointerValue: AmyAnamHermesShadowPointer,
    options: Pick<StoreOptions, 'env' | 'now'> = {},
): AmyAnamHermesShadowQueuedEnvelope {
    const pointer = normalizeAmyAnamHermesShadowPointer(pointerValue);
    const config = readAmyAnamHermesShadowConfig(options.env ?? process.env);
    if (!config.gatesOpen) throw new Error('Amy Anam Hermes shadow queue gates are closed');
    const dueAt = options.now ?? Date.now();
    const job = buildAmyAnamHermesShadowJob(pointer);
    const receipt = buildAmyAnamHermesShadowQueuedReceipt(pointer, dueAt);
    return {
        keys: {
            dedupe: amyAnamHermesShadowDedupeKey(pointer.jobId),
            job: amyAnamHermesShadowJobKey(pointer.jobId),
            due: AMY_ANAM_HERMES_SHADOW_DUE_KEY,
            jobReceipt: amyAnamHermesShadowJobReceiptKey(pointer.jobId),
            sessionReceipt: amyAnamHermesShadowSessionReceiptKey(pointer.externalSessionId),
        },
        job,
        receipt,
        jobJson: JSON.stringify(job),
        receiptJson: JSON.stringify(receipt),
        dueAt,
        ttlSeconds: config.ttlSeconds,
    };
}

export async function enqueueAmyAnamHermesShadowPointer(
    pointerValue: AmyAnamHermesShadowPointer,
    options: StoreOptions = {},
): Promise<{ queued: boolean; duplicate: boolean; contentPersisted: false }> {
    const pointer = normalizeAmyAnamHermesShadowPointer(pointerValue);
    const envelope = buildAmyAnamHermesShadowQueuedEnvelope(pointer, options);

    const script = [
        "if redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[4]) ~= 'OK' then return 0 end",
        "redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[4])",
        "redis.call('ZADD', KEYS[3], ARGV[2], ARGV[3])",
        "redis.call('EXPIRE', KEYS[3], ARGV[4])",
        "redis.call('SET', KEYS[4], ARGV[5], 'EX', ARGV[4])",
        "redis.call('SET', KEYS[5], ARGV[5], 'EX', ARGV[4])",
        'return 1',
    ].join(' ');
    const result = await redisCommand([
        'EVAL',
        script,
        5,
        envelope.keys.dedupe,
        envelope.keys.job,
        envelope.keys.due,
        envelope.keys.jobReceipt,
        envelope.keys.sessionReceipt,
        envelope.jobJson,
        envelope.dueAt,
        pointer.jobId,
        envelope.ttlSeconds,
        envelope.receiptJson,
    ], options);
    const queued = Number(result) === 1;
    if (!queued && Number(result) !== 0) {
        throw new Error('Amy Anam Hermes shadow pointer could not be queued');
    }
    return { queued, duplicate: !queued, contentPersisted: false };
}

async function listDueJobIds(options: StoreOptions = {}): Promise<string[]> {
    const now = options.now ?? Date.now();
    const result = await redisCommand([
        'ZRANGEBYSCORE',
        AMY_ANAM_HERMES_SHADOW_DUE_KEY,
        '-inf',
        now,
        'LIMIT',
        0,
        8,
    ], options);
    if (!Array.isArray(result)) throw new Error('Hermes shadow due queue response was invalid');
    return result.map(item => String(item)).filter(item => /^[a-f0-9]{64}$/.test(item));
}

async function leaseJobById(
    jobId: string,
    options: StoreOptions = {},
): Promise<AmyAnamHermesShadowLease | null> {
    const config = readAmyAnamHermesShadowConfig(options.env ?? process.env);
    if (!config.gatesOpen) throw new Error('Amy Anam Hermes shadow queue gates are closed');
    const now = options.now ?? Date.now();
    const leaseUntil = now + config.leaseSeconds * 1000;
    const leaseToken = randomUUID();
    const prefetched = await redisCommand(['GET', amyAnamHermesShadowJobKey(jobId)], options);
    if (!prefetched) {
        await redisCommand(['ZREM', AMY_ANAM_HERMES_SHADOW_DUE_KEY, jobId], options);
        return null;
    }
    const prefetchedJob = normalizeAmyAnamHermesShadowJob(prefetched);
    if (prefetchedJob.pointer.jobId !== jobId) {
        throw new Error('Amy Anam Hermes shadow job identity did not match its queue entry');
    }
    const script = [
        "local score = redis.call('ZSCORE', KEYS[2], ARGV[1])",
        'if not score or tonumber(score) > tonumber(ARGV[2]) then return nil end',
        "if redis.call('SET', KEYS[3], ARGV[3], 'NX', 'EX', ARGV[4]) ~= 'OK' then return nil end",
        "local raw = redis.call('GET', KEYS[1])",
        "if not raw then redis.call('DEL', KEYS[3]); redis.call('ZREM', KEYS[2], ARGV[1]); return nil end",
        'local job = cjson.decode(raw)',
        "if job.pointer.jobId ~= ARGV[1] or job.pointer.externalSessionId ~= ARGV[8] then redis.call('DEL', KEYS[3]); return nil end",
        'job.attempts = (tonumber(job.attempts) or 0) + 1',
        'local updated = cjson.encode(job)',
        "redis.call('SET', KEYS[1], updated, 'EX', ARGV[5])",
        "redis.call('ZADD', KEYS[2], ARGV[6], ARGV[1])",
        "redis.call('EXPIRE', KEYS[2], ARGV[5])",
        "local receiptRaw = redis.call('GET', KEYS[4])",
        'if receiptRaw then',
        '  local receipt = cjson.decode(receiptRaw)',
        "  receipt.status = 'leased'",
        '  receipt.attempts = job.attempts',
        '  receipt.updatedAt = ARGV[7]',
        '  receipt.nextAttemptAt = cjson.null',
        '  local encodedReceipt = cjson.encode(receipt)',
        "  redis.call('SET', KEYS[4], encodedReceipt, 'EX', ARGV[5])",
        "  redis.call('SET', KEYS[5], encodedReceipt, 'EX', ARGV[5])",
        'end',
        'return updated',
    ].join(' ');
    const raw = await redisCommand([
        'EVAL',
        script,
        5,
        amyAnamHermesShadowJobKey(jobId),
        AMY_ANAM_HERMES_SHADOW_DUE_KEY,
        amyAnamHermesShadowLeaseKey(jobId),
        amyAnamHermesShadowJobReceiptKey(jobId),
        amyAnamHermesShadowSessionReceiptKey(prefetchedJob.pointer.externalSessionId),
        jobId,
        now,
        leaseToken,
        config.leaseSeconds,
        config.ttlSeconds,
        leaseUntil,
        new Date(now).toISOString(),
        prefetchedJob.pointer.externalSessionId,
    ], options);
    if (!raw) return null;
    const job = normalizeAmyAnamHermesShadowJob(raw);

    return { job, leaseToken, leaseUntil };
}

export async function leaseNextAmyAnamHermesShadowJob(
    options: StoreOptions = {},
): Promise<AmyAnamHermesShadowLease | null> {
    for (const jobId of await listDueJobIds(options)) {
        const lease = await leaseJobById(jobId, options);
        if (lease) return lease;
    }
    return null;
}

export async function readAmyAnamSessionRecordForHermes(
    externalSessionId: string,
    options: StoreOptions = {},
): Promise<AmyAnamSessionRecord> {
    const raw = await redisCommand(['GET', sessionRecordKey(externalSessionId)], options);
    return normalizeAmyAnamSessionRecordForHermes(
        parseStoredJson(raw),
        externalSessionId,
    );
}

export async function acknowledgeAmyAnamHermesShadowJob(input: {
    lease: AmyAnamHermesShadowLease;
    output: AmyAnamHermesShadowOutput;
}, options: StoreOptions = {}): Promise<boolean> {
    const pointer = normalizeAmyAnamHermesShadowPointer(input.lease.job.pointer);
    const receipt = buildAmyAnamHermesShadowReceipt({
        pointer,
        status: 'completed',
        attempts: input.lease.job.attempts,
        now: options.now,
        output: input.output,
        hermesExecutionHappened: true,
    });
    return acknowledgeAmyAnamHermesShadowReceipt({
        lease: input.lease,
        receipt,
    }, options);
}

export async function acknowledgeAmyAnamHermesShadowReceipt(input: {
    lease: AmyAnamHermesShadowLease;
    receipt: AmyAnamHermesShadowReceipt;
}, options: StoreOptions = {}): Promise<boolean> {
    const config = readAmyAnamHermesShadowConfig(options.env ?? process.env);
    const lease = normalizeAmyAnamHermesShadowLease(input.lease);
    const pointer = normalizeAmyAnamHermesShadowPointer(lease.job.pointer);
    const receipt = normalizeAmyAnamHermesShadowReceiptForCloud(input.receipt);
    if (
        receipt.status !== 'completed'
        || receipt.jobId !== pointer.jobId
        || receipt.externalSessionId !== pointer.externalSessionId
        || receipt.attempts !== lease.job.attempts
        || receipt.nextAttemptAt !== null
        || receipt.failureCode !== null
        || receipt.hermesExecutionHappened !== true
        || receipt.outputContractValid !== true
    ) {
        throw new Error('Amy Anam Hermes shadow completion receipt did not match its lease');
    }
    const script = [
        "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end",
        "local raw = redis.call('GET', KEYS[2])",
        'if not raw then return 0 end',
        'local job = cjson.decode(raw)',
        'if job.pointer.jobId ~= ARGV[5] or job.pointer.externalSessionId ~= ARGV[6] or tonumber(job.attempts) ~= tonumber(ARGV[7]) then return 0 end',
        "redis.call('DEL', KEYS[1])",
        "redis.call('DEL', KEYS[2])",
        "redis.call('ZREM', KEYS[3], ARGV[2])",
        "redis.call('EXPIRE', KEYS[3], ARGV[3])",
        "redis.call('SET', KEYS[4], ARGV[4], 'EX', ARGV[3])",
        "redis.call('SET', KEYS[5], ARGV[4], 'EX', ARGV[3])",
        'return 1',
    ].join(' ');
    const result = await redisCommand([
        'EVAL',
        script,
        5,
        amyAnamHermesShadowLeaseKey(pointer.jobId),
        amyAnamHermesShadowJobKey(pointer.jobId),
        AMY_ANAM_HERMES_SHADOW_DUE_KEY,
        amyAnamHermesShadowJobReceiptKey(pointer.jobId),
        amyAnamHermesShadowSessionReceiptKey(pointer.externalSessionId),
        lease.leaseToken,
        pointer.jobId,
        config.ttlSeconds,
        JSON.stringify(receipt),
        pointer.jobId,
        pointer.externalSessionId,
        lease.job.attempts,
    ], options);
    return Number(result) === 1;
}

export async function retryOrDeadLetterAmyAnamHermesShadowJob(input: {
    lease: AmyAnamHermesShadowLease;
    failureCode: AmyAnamHermesShadowFailureCode;
    hermesExecutionHappened: boolean;
}, options: StoreOptions = {}): Promise<'retry_scheduled' | 'dead_letter' | 'stale'> {
    const config = readAmyAnamHermesShadowConfig(options.env ?? process.env);
    const pointer = normalizeAmyAnamHermesShadowPointer(input.lease.job.pointer);
    const now = options.now ?? Date.now();
    const retryDelayMs = Math.min(30 * 60_000, 60_000 * (2 ** Math.max(0, input.lease.job.attempts - 1)));
    const nextAttemptAtMs = now + retryDelayMs;
    const retryReceipt = buildAmyAnamHermesShadowReceipt({
        pointer,
        status: 'retry_scheduled',
        attempts: input.lease.job.attempts,
        now,
        nextAttemptAt: new Date(nextAttemptAtMs).toISOString(),
        failureCode: input.failureCode,
        hermesExecutionHappened: input.hermesExecutionHappened,
    });
    const deadReceipt = buildAmyAnamHermesShadowReceipt({
        pointer,
        status: 'dead_letter',
        attempts: input.lease.job.attempts,
        now,
        failureCode: input.failureCode,
        hermesExecutionHappened: input.hermesExecutionHappened,
    });
    validateReceiptForCloud(retryReceipt);
    validateReceiptForCloud(deadReceipt);

    const script = [
        "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 'stale' end",
        "local raw = redis.call('GET', KEYS[2])",
        "if not raw then redis.call('DEL', KEYS[1]); redis.call('ZREM', KEYS[3], ARGV[2]); return 'stale' end",
        'local job = cjson.decode(raw)',
        "if job.pointer.jobId ~= ARGV[2] or job.pointer.externalSessionId ~= ARGV[9] or tonumber(job.attempts) ~= tonumber(ARGV[10]) then return 'stale' end",
        'if tonumber(job.attempts) >= tonumber(ARGV[3]) then',
        "  redis.call('SET', KEYS[6], raw, 'EX', ARGV[4])",
        "  redis.call('ZADD', KEYS[7], ARGV[5], ARGV[2])",
        "  redis.call('EXPIRE', KEYS[7], ARGV[4])",
        "  redis.call('DEL', KEYS[1])",
        "  redis.call('DEL', KEYS[2])",
        "  redis.call('ZREM', KEYS[3], ARGV[2])",
        "  redis.call('SET', KEYS[4], ARGV[7], 'EX', ARGV[4])",
        "  redis.call('SET', KEYS[5], ARGV[7], 'EX', ARGV[4])",
        "  return 'dead_letter'",
        'end',
        "redis.call('DEL', KEYS[1])",
        "redis.call('ZADD', KEYS[3], ARGV[6], ARGV[2])",
        "redis.call('EXPIRE', KEYS[3], ARGV[4])",
        "redis.call('EXPIRE', KEYS[2], ARGV[4])",
        "redis.call('SET', KEYS[4], ARGV[8], 'EX', ARGV[4])",
        "redis.call('SET', KEYS[5], ARGV[8], 'EX', ARGV[4])",
        "return 'retry_scheduled'",
    ].join(' ');
    const result = String(await redisCommand([
        'EVAL',
        script,
        7,
        amyAnamHermesShadowLeaseKey(pointer.jobId),
        amyAnamHermesShadowJobKey(pointer.jobId),
        AMY_ANAM_HERMES_SHADOW_DUE_KEY,
        amyAnamHermesShadowJobReceiptKey(pointer.jobId),
        amyAnamHermesShadowSessionReceiptKey(pointer.externalSessionId),
        amyAnamHermesShadowDeadJobKey(pointer.jobId),
        AMY_ANAM_HERMES_SHADOW_DEAD_KEY,
        input.lease.leaseToken,
        pointer.jobId,
        config.maxAttempts,
        config.ttlSeconds,
        now,
        nextAttemptAtMs,
        JSON.stringify(deadReceipt),
        JSON.stringify(retryReceipt),
        pointer.externalSessionId,
        input.lease.job.attempts,
    ], options));
    if (result !== 'retry_scheduled' && result !== 'dead_letter' && result !== 'stale') {
        throw new Error('Amy Anam Hermes shadow retry transition was invalid');
    }
    return result;
}

export async function readAmyAnamHermesShadowReceipt(
    externalSessionId: string,
    options: StoreOptions = {},
): Promise<AmyAnamHermesShadowReceipt | null> {
    const raw = await redisCommand(['GET', amyAnamHermesShadowSessionReceiptKey(externalSessionId)], options);
    const parsed = parseStoredJson(raw);
    if (parsed === null) return null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Amy Anam Hermes shadow receipt is invalid');
    }
    return normalizeAmyAnamHermesShadowReceiptForCloud(parsed);
}
