import { createHash, randomUUID } from 'node:crypto';
import {
    link,
    lstat,
    mkdir,
    open,
    readdir,
    realpath,
    unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const AMY_ANAM_HERMES_LOCAL_OUTPUT_VERSION = 'amy_anam_hermes_local_output_v1';
export const AMY_ANAM_HERMES_LOCAL_RESERVATION_VERSION = 'amy_anam_hermes_local_reservation_v1';
export const AMY_ANAM_HERMES_LOCAL_OUTPUT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const AMY_ANAM_HERMES_LOCAL_TEMP_STALE_MS = 60 * 60 * 1000;

const DEFAULT_OUTPUT_DIR = resolve(tmpdir(), 'xagent-amy-anam-hermes-shadow');
const MAX_LOCAL_OUTPUT_BYTES = 96 * 1024;
const MAX_FUTURE_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
const LOCAL_OPERATION_LOCK_NAME = '.amy-anam-local-output.lock';
const LOCAL_OPERATION_LOCK_STALE_MS = 5 * 60 * 1000;
const LOCAL_OPERATION_LOCK_RETRY_MS = 10;
const LOCAL_OPERATION_LOCK_RETRIES = 200;
const MAX_LOCAL_OPERATION_LOCK_BYTES = 512;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FINAL_FILE_PATTERN = /^([a-f0-9]{64})\.([a-f0-9]{64})\.json$/;
const TEMP_FILE_PATTERN = /^\.([a-f0-9]{64})\.([a-f0-9]{64})\.([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.tmp$/;

export class AmyAnamHermesLocalOutputError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AmyAnamHermesLocalOutputError';
        this.code = code;
    }
}

function localOutputError(code, message) {
    return new AmyAnamHermesLocalOutputError(code, message);
}

function isWithin(parent, candidate) {
    const relation = relative(resolve(parent), resolve(candidate));
    return Boolean(relation)
        && !relation.startsWith('..')
        && !isAbsolute(relation);
}

function samePath(left, right) {
    return relative(resolve(left), resolve(right)) === '';
}

function safeInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

export function readAmyAnamHermesLocalOutputConfig(source = {}) {
    const configuredOutputDir = String(
        source.AMY_ANAM_HERMES_WORKER_OUTPUT_DIR ?? '',
    ).replace(/^\uFEFF/, '').trim();
    const configuredRetentionHours = String(
        source.AMY_ANAM_HERMES_OUTPUT_RETENTION_HOURS ?? '24',
    ).replace(/^\uFEFF/, '').trim();
    const retentionHours = safeInteger(configuredRetentionHours);

    if (retentionHours === null || retentionHours < 1 || retentionHours > 24) {
        throw localOutputError(
            'local_output_config_invalid',
            'Amy Anam Hermes local output retention must be between 1 and 24 hours',
        );
    }

    const outputDir = configuredOutputDir ? resolve(configuredOutputDir) : DEFAULT_OUTPUT_DIR;
    if (!isWithin(resolve(tmpdir()), outputDir)) {
        throw localOutputError(
            'local_output_config_invalid',
            'Amy Anam Hermes local output must remain below the operating-system temp directory',
        );
    }

    return {
        outputDir,
        retentionMs: retentionHours * 60 * 60 * 1000,
    };
}

function metadataIdentity(metadata) {
    return {
        dev: metadata.dev,
        ino: metadata.ino,
    };
}

function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}

function sameFileObservation(left, right) {
    return sameIdentity(left, right)
        && left.size === right.size
        && left.nlink === right.nlink
        && left.mtimeMs === right.mtimeMs
        && left.ctimeMs === right.ctimeMs;
}

function waitFor(milliseconds) {
    return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function hasExactKeys(record, expected) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    const actual = Object.keys(record).sort();
    const keys = [...expected].sort();
    return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isLiveProcess(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // ESRCH is the only certain dead-owner result. Access denied or an
        // unfamiliar platform error remains busy rather than risking overlap.
        return error?.code !== 'ESRCH';
    }
}

async function readValidatedLockOwner(lockPath, observedMetadata) {
    let handle;
    try {
        if (
            observedMetadata.size <= 0
            || observedMetadata.size > MAX_LOCAL_OPERATION_LOCK_BYTES
        ) {
            throw localOutputError(
                'local_output_lock_unsafe',
                'Amy Anam Hermes stale local operation lock had an invalid size',
            );
        }
        handle = await open(lockPath, 'r');
        const beforeRead = await handle.stat();
        if (
            !beforeRead.isFile()
            || beforeRead.nlink !== 1
            || !sameFileObservation(beforeRead, observedMetadata)
        ) {
            throw localOutputError(
                'local_output_lock_unsafe',
                'Amy Anam Hermes stale local operation lock changed during validation',
            );
        }
        const bytes = await readExactlyFromHandle(handle, beforeRead.size);
        const afterRead = await handle.stat();
        if (!sameFileObservation(beforeRead, afterRead)) {
            throw localOutputError(
                'local_output_lock_unsafe',
                'Amy Anam Hermes stale local operation lock changed while being read',
            );
        }
        let record;
        try {
            record = JSON.parse(bytes.toString('utf8'));
        } catch {
            throw localOutputError(
                'local_output_lock_unsafe',
                'Amy Anam Hermes stale local operation lock was malformed',
            );
        }
        if (
            !hasExactKeys(record, ['schemaVersion', 'pid', 'createdAt'])
            || record.schemaVersion !== 'amy_anam_hermes_local_operation_lock_v1'
            || !Number.isSafeInteger(record.pid)
            || record.pid <= 0
            || typeof record.createdAt !== 'string'
            || !Number.isFinite(Date.parse(record.createdAt))
        ) {
            throw localOutputError(
                'local_output_lock_unsafe',
                'Amy Anam Hermes stale local operation lock failed validation',
            );
        }
        return record.pid;
    } finally {
        await handle?.close().catch(() => undefined);
    }
}

async function canonicalTempDirectory() {
    const requestedTemp = resolve(tmpdir());
    let metadata;
    let canonicalTemp;
    try {
        metadata = await lstat(requestedTemp);
        canonicalTemp = await realpath(requestedTemp);
    } catch {
        throw localOutputError(
            'local_output_root_unsafe',
            'Amy Anam Hermes could not verify the operating-system temp directory',
        );
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw localOutputError(
            'local_output_root_unsafe',
            'Amy Anam Hermes operating-system temp directory was unsafe',
        );
    }
    return { requestedTemp, canonicalTemp };
}

async function walkOutputDirectoryComponents(requestedTemp, requestedRoot, create) {
    const relation = relative(requestedTemp, requestedRoot);
    if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
        throw localOutputError(
            'local_output_root_unsafe',
            'Amy Anam Hermes local output must remain below the operating-system temp directory',
        );
    }

    const components = relation.split(/[\\/]+/).filter(Boolean);
    let current = requestedTemp;
    for (const component of components) {
        current = resolve(current, component);
        let metadata;
        try {
            metadata = await lstat(current);
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw localOutputError(
                    'local_output_root_unsafe',
                    'Amy Anam Hermes could not validate its local output directory',
                );
            }
            if (!create) return null;
            try {
                await mkdir(current, { mode: 0o700 });
            } catch (mkdirError) {
                if (mkdirError?.code !== 'EEXIST') {
                    throw localOutputError(
                        'local_output_root_unsafe',
                        'Amy Anam Hermes could not create its local output directory',
                    );
                }
            }
            try {
                metadata = await lstat(current);
            } catch {
                throw localOutputError(
                    'local_output_root_unsafe',
                    'Amy Anam Hermes could not validate its created output directory',
                );
            }
        }

        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
            throw localOutputError(
                'local_output_root_unsafe',
                'Amy Anam Hermes local output directory contained a linked or non-directory component',
            );
        }
    }
    return current;
}

async function resolveLocalOutputRoot(outputDir, options = {}) {
    const requestedRoot = resolve(outputDir ?? DEFAULT_OUTPUT_DIR);
    const { requestedTemp, canonicalTemp } = await canonicalTempDirectory();
    const walkedRoot = await walkOutputDirectoryComponents(
        requestedTemp,
        requestedRoot,
        options.create === true,
    );
    if (!walkedRoot) return null;

    let canonicalRoot;
    let metadata;
    try {
        canonicalRoot = await realpath(walkedRoot);
        metadata = await lstat(walkedRoot);
    } catch {
        throw localOutputError(
            'local_output_root_unsafe',
            'Amy Anam Hermes could not resolve its local output directory',
        );
    }
    if (
        !metadata.isDirectory()
        || metadata.isSymbolicLink()
        || !isWithin(canonicalTemp, canonicalRoot)
    ) {
        throw localOutputError(
            'local_output_root_unsafe',
            'Amy Anam Hermes local output directory escaped its trusted temp boundary',
        );
    }

    // Node does not expose a Windows O_NOFOLLOW equivalent or a complete ACL API.
    // These checks fail closed on observable links and path swaps, but processes
    // running as the same Windows user (and administrators) remain a trust boundary.
    return {
        requestedRoot,
        canonicalRoot,
        identity: metadataIdentity(metadata),
    };
}

async function assertRootUnchanged(root) {
    let metadata;
    let canonicalRoot;
    try {
        metadata = await lstat(root.requestedRoot);
        canonicalRoot = await realpath(root.requestedRoot);
    } catch {
        throw localOutputError(
            'local_output_root_changed',
            'Amy Anam Hermes local output directory changed during an operation',
        );
    }
    if (
        !metadata.isDirectory()
        || metadata.isSymbolicLink()
        || !sameIdentity(metadataIdentity(metadata), root.identity)
        || !samePath(canonicalRoot, root.canonicalRoot)
    ) {
        throw localOutputError(
            'local_output_root_changed',
            'Amy Anam Hermes local output directory changed during an operation',
        );
    }
}

async function releaseLocalOperationLock(lock) {
    if (!lock) return;
    let handleMetadata;
    try {
        handleMetadata = await lock.handle.stat();
    } finally {
        await lock.handle.close().catch(() => undefined);
    }
    try {
        const pathMetadata = await lstat(lock.path);
        if (
            pathMetadata.isFile()
            && !pathMetadata.isSymbolicLink()
            && pathMetadata.nlink === 1
            && sameIdentity(pathMetadata, handleMetadata)
        ) {
            await unlink(lock.path);
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function acquireLocalOperationLock(root, options = {}) {
    const lockPath = resolveArtifactPath(root, LOCAL_OPERATION_LOCK_NAME);
    const wait = options.wait === true;
    // Non-wait cleanup still gets one immediate retry after it safely removes
    // a stale crash lock. It never waits on a live writer.
    const attempts = wait ? LOCAL_OPERATION_LOCK_RETRIES : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        await assertRootUnchanged(root);
        let handle;
        try {
            handle = await open(lockPath, 'wx+', 0o600);
            await handle.writeFile(`${JSON.stringify({
                schemaVersion: 'amy_anam_hermes_local_operation_lock_v1',
                pid: process.pid,
                createdAt: new Date().toISOString(),
            })}\n`, 'utf8');
            await handle.sync();
            const metadata = await handle.stat();
            if (!metadata.isFile() || metadata.nlink !== 1) {
                await handle.close().catch(() => undefined);
                throw localOutputError(
                    'local_output_lock_unsafe',
                    'Amy Anam Hermes local operation lock was unsafe',
                );
            }
            return { path: lockPath, handle };
        } catch (error) {
            await handle?.close().catch(() => undefined);
            if (error instanceof AmyAnamHermesLocalOutputError) throw error;
            if (error?.code !== 'EEXIST') {
                throw localOutputError(
                    'local_output_lock_unsafe',
                    'Amy Anam Hermes could not acquire its local operation lock',
                );
            }
        }

        let lockMetadata;
        try {
            lockMetadata = await lstat(lockPath);
        } catch (error) {
            if (error?.code === 'ENOENT') continue;
            throw localOutputError(
                'local_output_lock_unsafe',
                'Amy Anam Hermes could not validate its local operation lock',
            );
        }
        if (
            !lockMetadata.isFile()
            || lockMetadata.isSymbolicLink()
            || lockMetadata.nlink !== 1
        ) {
            throw localOutputError(
                'local_output_lock_unsafe',
                'Amy Anam Hermes local operation lock was linked or invalid',
            );
        }
        if (Date.now() - lockMetadata.mtimeMs > LOCAL_OPERATION_LOCK_STALE_MS) {
            const ownerPid = await readValidatedLockOwner(lockPath, lockMetadata);
            let ownerAlive = true;
            try {
                ownerAlive = await (options.processAliveImpl ?? isLiveProcess)(ownerPid);
            } catch {
                ownerAlive = true;
            }
            if (ownerAlive !== false) {
                if (!wait) return null;
                await waitFor(LOCAL_OPERATION_LOCK_RETRY_MS);
                continue;
            }
            try {
                const confirmed = await lstat(lockPath);
                if (sameFileObservation(lockMetadata, confirmed)) await unlink(lockPath);
            } catch (error) {
                if (error?.code !== 'ENOENT') {
                    throw localOutputError(
                        'local_output_lock_unsafe',
                        'Amy Anam Hermes could not clear a stale local operation lock',
                    );
                }
            }
            continue;
        }
        if (!wait) return null;
        await waitFor(LOCAL_OPERATION_LOCK_RETRY_MS);
    }
    throw localOutputError(
        'local_output_busy',
        'Amy Anam Hermes local output remained busy',
    );
}

async function validateLocalOutputReservation(root, reservation) {
    if (
        !reservation
        || reservation.schemaVersion !== AMY_ANAM_HERMES_LOCAL_RESERVATION_VERSION
        || reservation.released !== false
        || !reservation.root
        || !reservation.operationLock?.handle
        || !samePath(reservation.root.canonicalRoot, root.canonicalRoot)
        || !sameIdentity(reservation.root.identity, root.identity)
    ) {
        throw localOutputError(
            'local_output_lock_unsafe',
            'Amy Anam Hermes local output reservation was invalid',
        );
    }
    await assertRootUnchanged(root);
    let handleMetadata;
    let pathMetadata;
    try {
        handleMetadata = await reservation.operationLock.handle.stat();
        pathMetadata = await lstat(reservation.operationLock.path);
    } catch {
        throw localOutputError(
            'local_output_lock_unsafe',
            'Amy Anam Hermes local output reservation was unavailable',
        );
    }
    if (
        !handleMetadata.isFile()
        || handleMetadata.nlink !== 1
        || !pathMetadata.isFile()
        || pathMetadata.isSymbolicLink()
        || pathMetadata.nlink !== 1
        || !sameIdentity(handleMetadata, pathMetadata)
    ) {
        throw localOutputError(
            'local_output_lock_unsafe',
            'Amy Anam Hermes local output reservation changed',
        );
    }
    return reservation.operationLock;
}

export async function reserveAmyAnamHermesLocalOutput(options = {}) {
    const root = await resolveLocalOutputRoot(options.outputDir, { create: true });
    const operationLock = await acquireLocalOperationLock(root, {
        wait: options.wait === true,
        processAliveImpl: options.processAliveImpl,
    });
    if (!operationLock) return null;
    return {
        schemaVersion: AMY_ANAM_HERMES_LOCAL_RESERVATION_VERSION,
        root,
        operationLock,
        released: false,
    };
}

export async function releaseAmyAnamHermesLocalOutputReservation(reservation) {
    if (
        !reservation
        || reservation.schemaVersion !== AMY_ANAM_HERMES_LOCAL_RESERVATION_VERSION
        || reservation.released !== false
    ) {
        throw localOutputError(
            'local_output_lock_unsafe',
            'Amy Anam Hermes local output reservation could not be released',
        );
    }
    reservation.released = true;
    await releaseLocalOperationLock(reservation.operationLock);
}

function resolveArtifactPath(root, name) {
    const candidate = resolve(root.canonicalRoot, name);
    if (!isWithin(root.canonicalRoot, candidate) || candidate.includes(`..${sep}`)) {
        throw localOutputError(
            'local_output_path_unsafe',
            'Amy Anam Hermes local output path escaped its directory',
        );
    }
    return candidate;
}

async function readExactlyFromHandle(fileHandle, size) {
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
        const { bytesRead } = await fileHandle.read(bytes, offset, size - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
    }
    if (offset !== size) {
        throw localOutputError(
            'local_output_changed',
            'Amy Anam Hermes local output changed while it was being read',
        );
    }
    return bytes;
}

async function verifyExactExistingFile(finalPath, expectedBytes, root) {
    let pathMetadata;
    let fileHandle;
    try {
        await assertRootUnchanged(root);
        pathMetadata = await lstat(finalPath);
        if (
            !pathMetadata.isFile()
            || pathMetadata.isSymbolicLink()
            || pathMetadata.nlink !== 1
            || pathMetadata.size !== expectedBytes.length
        ) {
            throw localOutputError(
                'local_output_collision',
                'Amy Anam Hermes local output collided with an unsafe existing artifact',
            );
        }

        fileHandle = await open(finalPath, 'r');
        const beforeRead = await fileHandle.stat();
        if (
            !beforeRead.isFile()
            || beforeRead.nlink !== 1
            || !sameIdentity(beforeRead, pathMetadata)
            || beforeRead.size !== expectedBytes.length
        ) {
            throw localOutputError(
                'local_output_collision',
                'Amy Anam Hermes local output changed during collision validation',
            );
        }
        const observedBytes = await readExactlyFromHandle(fileHandle, expectedBytes.length);
        const afterRead = await fileHandle.stat();
        if (!sameFileObservation(beforeRead, afterRead) || !observedBytes.equals(expectedBytes)) {
            throw localOutputError(
                'local_output_collision',
                'Amy Anam Hermes existing local output did not match the expected artifact',
            );
        }
    } catch (error) {
        if (error instanceof AmyAnamHermesLocalOutputError) throw error;
        throw localOutputError(
            'local_output_collision',
            'Amy Anam Hermes could not safely validate an existing local output',
        );
    } finally {
        await fileHandle?.close().catch(() => undefined);
    }
    await assertRootUnchanged(root);
}

async function removeTemporaryName(tempPath) {
    try {
        await unlink(tempPath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

function normalizeOutputBytes(contents, outputSha256) {
    const bytes = Buffer.isBuffer(contents) ? Buffer.from(contents) : Buffer.from(String(contents), 'utf8');
    if (bytes.length <= 0 || bytes.length > MAX_LOCAL_OUTPUT_BYTES) {
        throw localOutputError(
            'local_output_invalid',
            'Amy Anam Hermes local output exceeded its size boundary',
        );
    }
    let compactJson;
    try {
        compactJson = JSON.stringify(JSON.parse(bytes.toString('utf8')));
    } catch {
        throw localOutputError(
            'local_output_invalid',
            'Amy Anam Hermes local output was not valid JSON',
        );
    }
    const observedSha256 = createHash('sha256').update(compactJson).digest('hex');
    if (observedSha256 !== outputSha256) {
        throw localOutputError(
            'local_output_invalid',
            'Amy Anam Hermes local output did not match its content hash',
        );
    }
    return bytes;
}

export async function publishAmyAnamHermesLocalOutput(input) {
    const jobId = String(input?.jobId ?? '');
    const outputSha256 = String(input?.outputSha256 ?? '');
    if (!SHA256_PATTERN.test(jobId) || !SHA256_PATTERN.test(outputSha256)) {
        throw localOutputError(
            'local_output_invalid',
            'Amy Anam Hermes local output identity was invalid',
        );
    }
    const expectedBytes = normalizeOutputBytes(input.contents, outputSha256);
    const root = await resolveLocalOutputRoot(input.outputDir, { create: true });
    const finalName = `${jobId}.${outputSha256}.json`;
    const tempName = `.${jobId}.${outputSha256}.${randomUUID()}.tmp`;
    const finalPath = resolveArtifactPath(root, finalName);
    const tempPath = resolveArtifactPath(root, tempName);
    const reservation = input.reservation;
    const operationLock = reservation
        ? await validateLocalOutputReservation(root, reservation)
        : await acquireLocalOperationLock(root, { wait: true });
    const releaseOperationLock = !reservation;
    let fileHandle;
    let published = false;

    try {
        await assertRootUnchanged(root);
        fileHandle = await open(tempPath, 'wx+', 0o600);
        await fileHandle.writeFile(expectedBytes);
        await fileHandle.sync();
        const writtenMetadata = await fileHandle.stat();
        if (
            !writtenMetadata.isFile()
            || writtenMetadata.nlink !== 1
            || writtenMetadata.size !== expectedBytes.length
        ) {
            throw localOutputError(
                'local_output_write_failed',
                'Amy Anam Hermes temporary local output failed handle validation',
            );
        }
        const writtenBytes = await readExactlyFromHandle(fileHandle, expectedBytes.length);
        const verifiedMetadata = await fileHandle.stat();
        if (
            !sameFileObservation(writtenMetadata, verifiedMetadata)
            || !writtenBytes.equals(expectedBytes)
        ) {
            throw localOutputError(
                'local_output_write_failed',
                'Amy Anam Hermes temporary local output failed byte validation',
            );
        }
        await fileHandle.close();
        fileHandle = undefined;
        await assertRootUnchanged(root);

        try {
            await link(tempPath, finalPath);
            published = true;
        } catch (error) {
            let finalExists = false;
            try {
                await lstat(finalPath);
                finalExists = true;
            } catch (statError) {
                if (statError?.code !== 'ENOENT') finalExists = true;
            }
            if (error?.code !== 'EEXIST' && !finalExists) {
                throw localOutputError(
                    'local_output_write_failed',
                    'Amy Anam Hermes could not atomically publish its local output',
                );
            }
        }

        await removeTemporaryName(tempPath);
        await verifyExactExistingFile(finalPath, expectedBytes, root);
        return {
            schemaVersion: AMY_ANAM_HERMES_LOCAL_OUTPUT_VERSION,
            outputPath: finalPath,
            outputSha256,
            created: published,
            idempotent: !published,
        };
    } catch (error) {
        if (error instanceof AmyAnamHermesLocalOutputError) throw error;
        throw localOutputError(
            'local_output_write_failed',
            'Amy Anam Hermes local output could not be written safely',
        );
    } finally {
        await fileHandle?.close().catch(() => undefined);
        await removeTemporaryName(tempPath).catch(() => undefined);
        if (releaseOperationLock) await releaseLocalOperationLock(operationLock);
    }
}

function emptyCleanupSummary(rootPresent) {
    return {
        schemaVersion: 'amy_anam_hermes_local_cleanup_v1',
        ok: true,
        busy: false,
        rootPresent,
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
    };
}

function observedAt(metadata) {
    const birthTime = metadata.birthtimeMs > 0 ? metadata.birthtimeMs : metadata.mtimeMs;
    return Math.min(birthTime, metadata.mtimeMs);
}

function isFutureDated(metadata, now) {
    const birthTime = metadata.birthtimeMs > 0 ? metadata.birthtimeMs : metadata.mtimeMs;
    return metadata.mtimeMs > now + MAX_FUTURE_TIMESTAMP_SKEW_MS
        || birthTime > now + MAX_FUTURE_TIMESTAMP_SKEW_MS;
}

async function recoverInterruptedPublication(root, entry, entryNames, now) {
    const tempMatch = TEMP_FILE_PATTERN.exec(entry.name);
    if (!tempMatch) return false;
    const finalName = `${tempMatch[1]}.${tempMatch[2]}.json`;
    if (!entryNames.has(finalName)) return false;
    const tempPath = resolveArtifactPath(root, entry.name);
    const finalPath = resolveArtifactPath(root, finalName);
    let tempHandle;
    let finalHandle;
    try {
        const tempPathMetadata = await lstat(tempPath);
        const finalPathMetadata = await lstat(finalPath);
        if (
            !tempPathMetadata.isFile()
            || tempPathMetadata.isSymbolicLink()
            || !finalPathMetadata.isFile()
            || finalPathMetadata.isSymbolicLink()
            || tempPathMetadata.nlink !== 2
            || finalPathMetadata.nlink !== 2
            || !sameIdentity(tempPathMetadata, finalPathMetadata)
            || isFutureDated(tempPathMetadata, now)
            || isFutureDated(finalPathMetadata, now)
            || finalPathMetadata.size <= 0
            || finalPathMetadata.size > MAX_LOCAL_OUTPUT_BYTES
        ) {
            return false;
        }
        tempHandle = await open(tempPath, 'r');
        finalHandle = await open(finalPath, 'r');
        const tempHandleMetadata = await tempHandle.stat();
        const finalHandleMetadata = await finalHandle.stat();
        if (
            tempHandleMetadata.nlink !== 2
            || finalHandleMetadata.nlink !== 2
            || !sameIdentity(tempHandleMetadata, tempPathMetadata)
            || !sameIdentity(finalHandleMetadata, finalPathMetadata)
            || !sameIdentity(tempHandleMetadata, finalHandleMetadata)
        ) {
            return false;
        }
        const bytes = await readExactlyFromHandle(finalHandle, finalHandleMetadata.size);
        let compactJson;
        try {
            compactJson = JSON.stringify(JSON.parse(bytes.toString('utf8')));
        } catch {
            return false;
        }
        if (createHash('sha256').update(compactJson).digest('hex') !== tempMatch[2]) {
            return false;
        }
    } finally {
        await tempHandle?.close().catch(() => undefined);
        await finalHandle?.close().catch(() => undefined);
    }

    await assertRootUnchanged(root);
    const beforeUnlink = await lstat(tempPath);
    const finalBeforeUnlink = await lstat(finalPath);
    if (
        beforeUnlink.nlink !== 2
        || finalBeforeUnlink.nlink !== 2
        || !sameIdentity(beforeUnlink, finalBeforeUnlink)
    ) {
        return false;
    }
    await unlink(tempPath);
    const recoveredFinal = await lstat(finalPath);
    if (
        !recoveredFinal.isFile()
        || recoveredFinal.isSymbolicLink()
        || recoveredFinal.nlink !== 1
        || !sameIdentity(recoveredFinal, finalBeforeUnlink)
    ) {
        throw localOutputError(
            'local_output_recovery_failed',
            'Amy Anam Hermes could not recover an interrupted local publication',
        );
    }
    return true;
}

export async function cleanupAmyAnamHermesLocalOutputs(options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const retentionMs = Number.isFinite(options.retentionMs)
        ? options.retentionMs
        : AMY_ANAM_HERMES_LOCAL_OUTPUT_RETENTION_MS;
    if (retentionMs <= 0 || retentionMs > AMY_ANAM_HERMES_LOCAL_OUTPUT_RETENTION_MS) {
        throw localOutputError(
            'local_output_config_invalid',
            'Amy Anam Hermes cleanup retention exceeded its fixed 24-hour maximum',
        );
    }

    const root = await resolveLocalOutputRoot(options.outputDir, { create: false });
    if (!root) return emptyCleanupSummary(false);
    const summary = emptyCleanupSummary(true);
    const unlinkImpl = options.unlinkImpl ?? unlink;
    const operationLock = await acquireLocalOperationLock(root, {
        wait: false,
        processAliveImpl: options.processAliveImpl,
    });
    if (!operationLock) {
        summary.busy = true;
        return summary;
    }

    try {
        await assertRootUnchanged(root);
        let entries = (await readdir(root.canonicalRoot, { withFileTypes: true }))
            .filter(entry => entry.name !== LOCAL_OPERATION_LOCK_NAME);
        summary.scanned = entries.length;

        // Publication uses a hard link as the atomic namespace transition. If
        // the process exits after link() but before removing the temporary
        // name, both names legitimately reference one two-link inode. Recover
        // every exact pair before the normal validation pass, then enumerate
        // again so readdir ordering cannot create a false integrity failure.
        const entryNames = new Set(entries.map(entry => entry.name));
        const recoveredNames = new Set();
        for (const entry of entries) {
            if (!TEMP_FILE_PATTERN.test(entry.name)) continue;
            try {
                if (await recoverInterruptedPublication(root, entry, entryNames, now)) {
                    recoveredNames.add(entry.name);
                    summary.recovered += 1;
                    summary.matched += 1;
                    summary.deleted += 1;
                }
            } catch {
                summary.failed += 1;
            }
        }
        entries = (await readdir(root.canonicalRoot, { withFileTypes: true }))
            .filter(entry => entry.name !== LOCAL_OPERATION_LOCK_NAME);

        for (const entry of entries) {
            if (recoveredNames.has(entry.name)) continue;
            const finalMatch = FINAL_FILE_PATTERN.exec(entry.name);
            const tempMatch = TEMP_FILE_PATTERN.exec(entry.name);
            if (!finalMatch && !tempMatch) {
                summary.ignored += 1;
                continue;
            }
            summary.matched += 1;
            const candidatePath = resolveArtifactPath(root, entry.name);
            let beforeDelete;
            try {
                beforeDelete = await lstat(candidatePath);
            } catch {
                summary.failed += 1;
                continue;
            }
            if (
                entry.isSymbolicLink()
                || beforeDelete.isSymbolicLink()
                || !entry.isFile()
                || !beforeDelete.isFile()
                || beforeDelete.nlink !== 1
            ) {
                summary.unsafe += 1;
                continue;
            }
            if (isFutureDated(beforeDelete, now)) {
                summary.futureDated += 1;
                continue;
            }

            const maximumAge = tempMatch
                ? Math.min(retentionMs, AMY_ANAM_HERMES_LOCAL_TEMP_STALE_MS)
                : retentionMs;
            if (now - observedAt(beforeDelete) < maximumAge) {
                summary.retained += 1;
                continue;
            }

            try {
                await assertRootUnchanged(root);
                let candidateHandle;
                let handleMetadata;
                try {
                    candidateHandle = await open(candidatePath, 'r');
                    handleMetadata = await candidateHandle.stat();
                } finally {
                    await candidateHandle?.close().catch(() => undefined);
                }
                if (
                    !handleMetadata?.isFile()
                    || handleMetadata.nlink !== 1
                    || !sameIdentity(handleMetadata, beforeDelete)
                    || handleMetadata.size !== beforeDelete.size
                ) {
                    summary.unsafe += 1;
                    continue;
                }
                const confirmedMetadata = await lstat(candidatePath);
                if (
                    !confirmedMetadata.isFile()
                    || confirmedMetadata.isSymbolicLink()
                    || confirmedMetadata.nlink !== 1
                    || !sameFileObservation(beforeDelete, confirmedMetadata)
                ) {
                    summary.unsafe += 1;
                    continue;
                }
                await unlinkImpl(candidatePath);
                summary.deleted += 1;
            } catch {
                summary.failed += 1;
            }
        }

        await assertRootUnchanged(root);
        summary.ok = summary.unsafe === 0
            && summary.futureDated === 0
            && summary.failed === 0;
        return summary;
    } catch (error) {
        if (error instanceof AmyAnamHermesLocalOutputError) throw error;
        throw localOutputError(
            'local_output_cleanup_failed',
            'Amy Anam Hermes cleanup could not safely process local artifacts',
        );
    } finally {
        await releaseLocalOperationLock(operationLock);
    }
}
