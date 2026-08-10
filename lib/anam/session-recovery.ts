import { randomUUID, timingSafeEqual } from 'node:crypto';
import { finalizeAmyAnamSession } from './session-finalizer.ts';
import type { AmyAnamFinalizationResult } from './session-finalizer.ts';
import { isValidAnamSessionId } from './session-spine.ts';
import {
    acquireAmyAnamRecoveryDrainLock,
    listDueDaniAnamEmailRetryIds,
    listDueAmyAnamFinalizationIds,
    releaseAmyAnamRecoveryDrainLock,
    removeDaniAnamEmailRetryDueEntry,
    removeAmyAnamFinalizationDueEntry,
} from './session-spine-store.ts';

export const AMY_ANAM_RECOVERY_BATCH_SIZE = 8;
export const AMY_ANAM_RECOVERY_CONCURRENCY = 2;
export const AMY_ANAM_RECOVERY_DISPATCH_WINDOW_MS = 10_000;

const RECOVERY_SECRET_MIN_LENGTH = 16;

export type AmyAnamRecoveryConfig = {
    enabled: boolean;
    killSwitchActive: boolean;
    authenticationConfigured: boolean;
    productionApprovalRequired: boolean;
    productionPromotionApproved: boolean;
    gatesOpen: boolean;
};

export type DaniAnamEmailRecoveryConfig = AmyAnamRecoveryConfig;

type RecoveryDependencies = {
    acquireDrainLock: (lockToken: string) => Promise<boolean>;
    releaseDrainLock: (lockToken: string) => Promise<void>;
    listDue: (input: { dueAt: number; limit: number }) => Promise<string[]>;
    listDaniEmailDue: (input: { dueAt: number; limit: number }) => Promise<string[]>;
    removeDue: (externalSessionId: string) => Promise<void>;
    removeDaniEmailDue: (externalSessionId: string) => Promise<void>;
    finalize: (externalSessionId: string) => Promise<AmyAnamFinalizationResult>;
    now: () => number;
    createLockToken: () => string;
};

export type AmyAnamRecoverySummary = {
    status: 'busy' | 'drained';
    selected: number;
    attempted: number;
    cleaned: number;
    invalid: number;
    skippedDueToDeadline: number;
    errors: number;
    durationMs: number;
    results: Record<AmyAnamFinalizationResult, number>;
};

type DrainOptions = {
    batchSize?: number;
    concurrency?: number;
    dispatchWindowMs?: number;
    dependencies?: Partial<RecoveryDependencies>;
};

type RecoverySources = {
    finalizations: boolean;
    daniEmailRetries: boolean;
};

const defaultDependencies: RecoveryDependencies = {
    acquireDrainLock: acquireAmyAnamRecoveryDrainLock,
    releaseDrainLock: releaseAmyAnamRecoveryDrainLock,
    listDue: listDueAmyAnamFinalizationIds,
    listDaniEmailDue: listDueDaniAnamEmailRetryIds,
    removeDue: removeAmyAnamFinalizationDueEntry,
    removeDaniEmailDue: removeDaniAnamEmailRetryDueEntry,
    finalize: finalizeAmyAnamSession,
    now: Date.now,
    createLockToken: randomUUID,
};

function cleanEnvValue(value: string | undefined): string {
    return String(value ?? '')
        .trim()
        .replace(/^(?:\uFEFF|\u00EF\u00BB\u00BF|\u00C3\u00AF\u00C2\u00BB\u00C2\u00BF)+/, '')
        .replace(/(?:\\r|\\n)+$/, '')
        .trim();
}

function recoverySecrets(source: NodeJS.ProcessEnv): string[] {
    return [
        cleanEnvValue(source.AMY_ANAM_RECOVERY_SECRET),
        cleanEnvValue(source.CRON_SECRET),
    ].filter((secret, index, values) => (
        secret.length >= RECOVERY_SECRET_MIN_LENGTH
        && values.indexOf(secret) === index
    ));
}

function daniEmailRecoverySecrets(source: NodeJS.ProcessEnv): string[] {
    return [
        cleanEnvValue(source.DANI_ANAM_EMAIL_RECOVERY_SECRET),
        cleanEnvValue(source.CRON_SECRET),
    ].filter((secret, index, values) => (
        secret.length >= RECOVERY_SECRET_MIN_LENGTH
        && values.indexOf(secret) === index
    ));
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length
        && timingSafeEqual(leftBuffer, rightBuffer);
}

export function readAmyAnamRecoveryConfig(
    source: NodeJS.ProcessEnv = process.env,
): AmyAnamRecoveryConfig {
    const enabled = cleanEnvValue(source.AMY_ANAM_RECOVERY_ENABLED) === 'true';
    const killSwitchActive = cleanEnvValue(source.AMY_ANAM_RECOVERY_KILL_SWITCH) !== 'false';
    const authenticationConfigured = recoverySecrets(source).length > 0;
    const productionApprovalRequired = cleanEnvValue(source.VERCEL_ENV) === 'production';
    const productionPromotionApproved = productionApprovalRequired
        && cleanEnvValue(source.AMY_ANAM_PRODUCTION_PROMOTION_APPROVED) === 'true';
    return {
        enabled,
        killSwitchActive,
        authenticationConfigured,
        productionApprovalRequired,
        productionPromotionApproved,
        gatesOpen: enabled
            && !killSwitchActive
            && authenticationConfigured
            && (!productionApprovalRequired || productionPromotionApproved),
    };
}

export function isAmyAnamRecoveryRequestAuthorized(
    request: Request,
    source: NodeJS.ProcessEnv = process.env,
): boolean {
    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return false;
    const presentedSecret = authorization.slice('Bearer '.length).trim();
    if (!presentedSecret) return false;
    return recoverySecrets(source).some(secret => safeEqual(presentedSecret, secret));
}

export function readDaniAnamEmailRecoveryConfig(
    source: NodeJS.ProcessEnv = process.env,
): DaniAnamEmailRecoveryConfig {
    const enabled = cleanEnvValue(source.DANI_ANAM_EMAIL_RECOVERY_ENABLED) === 'true';
    const killSwitchActive = cleanEnvValue(source.DANI_ANAM_EMAIL_RECOVERY_KILL_SWITCH) !== 'false';
    const authenticationConfigured = daniEmailRecoverySecrets(source).length > 0;
    const productionApprovalRequired = cleanEnvValue(source.VERCEL_ENV) === 'production';
    const productionPromotionApproved = productionApprovalRequired
        && cleanEnvValue(source.DANI_ANAM_EMAIL_RECOVERY_PRODUCTION_APPROVED) === 'true';
    return {
        enabled,
        killSwitchActive,
        authenticationConfigured,
        productionApprovalRequired,
        productionPromotionApproved,
        gatesOpen: enabled
            && !killSwitchActive
            && authenticationConfigured
            && (!productionApprovalRequired || productionPromotionApproved),
    };
}

export function isDaniAnamEmailRecoveryRequestAuthorized(
    request: Request,
    source: NodeJS.ProcessEnv = process.env,
): boolean {
    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return false;
    const presentedSecret = authorization.slice('Bearer '.length).trim();
    if (!presentedSecret) return false;
    return daniEmailRecoverySecrets(source).some(secret => safeEqual(presentedSecret, secret));
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function emptyResults(): Record<AmyAnamFinalizationResult, number> {
    return {
        busy: 0,
        bound: 0,
        completed: 0,
        failed: 0,
        missing: 0,
        pending: 0,
    };
}

async function drainDueAnamRecoveryWork(
    options: DrainOptions = {},
    sources: RecoverySources,
): Promise<AmyAnamRecoverySummary> {
    const dependencies: RecoveryDependencies = {
        ...defaultDependencies,
        ...options.dependencies,
    };
    const batchSize = boundedInteger(
        options.batchSize,
        AMY_ANAM_RECOVERY_BATCH_SIZE,
        1,
        AMY_ANAM_RECOVERY_BATCH_SIZE,
    );
    const concurrency = boundedInteger(
        options.concurrency,
        AMY_ANAM_RECOVERY_CONCURRENCY,
        1,
        AMY_ANAM_RECOVERY_CONCURRENCY,
    );
    const dispatchWindowMs = boundedInteger(
        options.dispatchWindowMs,
        AMY_ANAM_RECOVERY_DISPATCH_WINDOW_MS,
        1_000,
        AMY_ANAM_RECOVERY_DISPATCH_WINDOW_MS,
    );
    const startedAt = dependencies.now();
    const lockToken = dependencies.createLockToken();
    const acquired = await dependencies.acquireDrainLock(lockToken);
    if (!acquired) {
        return {
            status: 'busy',
            selected: 0,
            attempted: 0,
            cleaned: 0,
            invalid: 0,
            skippedDueToDeadline: 0,
            errors: 0,
            durationMs: Math.max(0, dependencies.now() - startedAt),
            results: emptyResults(),
        };
    }

    let summary: AmyAnamRecoverySummary | undefined;
    try {
        const [finalizationDueIds, daniEmailDueIds] = await Promise.all([
            sources.finalizations
                ? dependencies.listDue({ dueAt: startedAt, limit: batchSize })
                : Promise.resolve([]),
            sources.daniEmailRetries
                ? dependencies.listDaniEmailDue({ dueAt: startedAt, limit: batchSize })
                : Promise.resolve([]),
        ]);
        const finalizationDueSet = new Set(finalizationDueIds);
        const daniEmailDueSet = new Set(daniEmailDueIds);
        const dueIds: string[] = [];
        const seenDueIds = new Set<string>();
        const maxSourceLength = Math.max(finalizationDueIds.length, daniEmailDueIds.length);
        for (let index = 0; index < maxSourceLength && dueIds.length < batchSize; index += 1) {
            for (const candidate of [finalizationDueIds[index], daniEmailDueIds[index]]) {
                if (!candidate || seenDueIds.has(candidate)) continue;
                seenDueIds.add(candidate);
                dueIds.push(candidate);
                if (dueIds.length >= batchSize) break;
            }
        }
        const queue = [...dueIds];
        const results = emptyResults();
        let attempted = 0;
        let cleaned = 0;
        let invalid = 0;
        let errors = 0;

        const worker = async () => {
            while (queue.length > 0) {
                if (dependencies.now() - startedAt >= dispatchWindowMs) return;
                const externalSessionId = queue.shift();
                if (!externalSessionId) return;

                if (!isValidAnamSessionId(externalSessionId)) {
                    invalid += 1;
                    try {
                        await Promise.all([
                            ...(finalizationDueSet.has(externalSessionId)
                                ? [dependencies.removeDue(externalSessionId)]
                                : []),
                            ...(daniEmailDueSet.has(externalSessionId)
                                ? [dependencies.removeDaniEmailDue(externalSessionId)]
                                : []),
                        ]);
                        cleaned += 1;
                    } catch {
                        errors += 1;
                    }
                    continue;
                }

                attempted += 1;
                try {
                    const result = await dependencies.finalize(externalSessionId);
                    results[result] += 1;
                    if (result === 'completed' || result === 'failed' || result === 'missing') {
                        try {
                            await Promise.all([
                                ...(finalizationDueSet.has(externalSessionId)
                                    ? [dependencies.removeDue(externalSessionId)]
                                    : []),
                                ...(daniEmailDueSet.has(externalSessionId)
                                    ? [dependencies.removeDaniEmailDue(externalSessionId)]
                                    : []),
                            ]);
                            cleaned += 1;
                        } catch {
                            errors += 1;
                        }
                    }
                } catch {
                    errors += 1;
                }
            }
        };

        await Promise.all(Array.from(
            { length: Math.min(concurrency, Math.max(1, queue.length)) },
            () => worker(),
        ));

        summary = {
            status: 'drained',
            selected: dueIds.length,
            attempted,
            cleaned,
            invalid,
            skippedDueToDeadline: queue.length,
            errors,
            durationMs: Math.max(0, dependencies.now() - startedAt),
            results,
        };
        return summary;
    } finally {
        try {
            await dependencies.releaseDrainLock(lockToken);
        } catch {
            if (summary) summary.errors += 1;
        }
        if (summary) {
            summary.durationMs = Math.max(0, dependencies.now() - startedAt);
        }
    }
}

export async function drainDueAmyAnamFinalizations(
    options: DrainOptions = {},
): Promise<AmyAnamRecoverySummary> {
    return drainDueAnamRecoveryWork(options, {
        finalizations: true,
        daniEmailRetries: false,
    });
}

export async function drainDueDaniAnamEmailRetries(
    options: DrainOptions = {},
): Promise<AmyAnamRecoverySummary> {
    return drainDueAnamRecoveryWork(options, {
        finalizations: false,
        daniEmailRetries: true,
    });
}

export async function drainDueAmyAndDaniAnamRecoveries(
    options: DrainOptions = {},
): Promise<AmyAnamRecoverySummary> {
    return drainDueAnamRecoveryWork(options, {
        finalizations: true,
        daniEmailRetries: true,
    });
}
