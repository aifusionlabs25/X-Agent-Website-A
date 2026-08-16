import { randomUUID } from 'node:crypto';
import {
    constants as fsConstants,
    copyFile,
    lstat,
    mkdir,
    readFile,
    rename,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

export const AMY_ANAM_HERMES_AUTH_MAINTENANCE_SCHEMA = 'amy_anam_hermes_auth_maintenance_v1';
export const AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION = 'CONFIRM_AMY_HERMES_AUTH_REFRESH';
export const AMY_ANAM_HERMES_AUTH_MAINTENANCE_LOG = 'auth-maintenance-latest.json';
const HELPER_SCHEMA = 'amy_anam_hermes_auth_refresh_helper_v1';
const MAX_AUTH_BYTES = 64 * 1024;
const MAX_HELPER_BYTES = 4 * 1024;
const HELPER_TIMEOUT_MS = 60_000;
const DEFAULT_REFRESH_SKEW_SECONDS = 48 * 60 * 60;
const REFRESH_HELPER = fileURLToPath(new URL('./amy-anam-shadow-auth-refresh.py', import.meta.url));

function value(source, key) {
    return String(source?.[key] ?? '').replace(/^\uFEFF/, '').trim();
}

function boundedInteger(raw, fallback, minimum, maximum, label) {
    const parsed = raw ? Number(raw) : fallback;
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${label} is outside the approved range`);
    }
    return parsed;
}

export function readAmyAnamHermesAuthMaintenanceConfig(source = process.env) {
    const configuredHome = value(source, 'AMY_ANAM_HERMES_HOME');
    const configuredPython = value(source, 'AMY_ANAM_HERMES_PYTHON_COMMAND');
    if (!configuredHome || !isAbsolute(configuredHome)) {
        throw new Error('AMY_ANAM_HERMES_HOME must be an absolute isolated directory');
    }
    const hermesHome = resolve(configuredHome);
    if (hermesHome.toLowerCase() === resolve(homedir(), '.hermes').toLowerCase()) {
        throw new Error('Amy auth maintenance cannot use the shared Hermes home');
    }
    if (!configuredPython || !isAbsolute(configuredPython)) {
        throw new Error('AMY_ANAM_HERMES_PYTHON_COMMAND must be absolute');
    }
    const pythonCommand = resolve(configuredPython);
    if (!/(?:^|[\\/])python(?:3(?:\.\d+)?)?\.exe$/i.test(pythonCommand)) {
        throw new Error('Amy auth maintenance requires an explicit Python executable');
    }
    if (value(source, 'AMY_ANAM_HERMES_PROVIDER') !== 'openai-codex') {
        throw new Error('Amy auth maintenance provider must remain openai-codex');
    }
    if (value(source, 'AMY_ANAM_HERMES_MODEL') !== 'gpt-5.5') {
        throw new Error('Amy auth maintenance model must remain gpt-5.5');
    }
    return {
        hermesHome,
        pythonCommand,
        enabled: value(source, 'AMY_ANAM_HERMES_AUTH_MAINTENANCE_ENABLED') === 'true',
        killSwitch: value(source, 'AMY_ANAM_HERMES_AUTH_MAINTENANCE_KILL_SWITCH') !== 'false',
        refreshSkewSeconds: boundedInteger(
            value(source, 'AMY_ANAM_HERMES_AUTH_REFRESH_SKEW_SECONDS'),
            DEFAULT_REFRESH_SKEW_SECONDS,
            3600,
            7 * 24 * 60 * 60,
            'Amy auth refresh skew',
        ),
    };
}

export function readAmyAnamHermesAuthMaintenanceCommand(args = process.argv.slice(2)) {
    const allowed = new Set(['--apply']);
    let confirmation = '';
    for (const argument of args) {
        if (argument.startsWith('--confirm=')) {
            if (confirmation) throw new Error('Duplicate auth maintenance confirmation');
            confirmation = argument.slice('--confirm='.length);
            continue;
        }
        if (!allowed.has(argument)) throw new Error(`Unsupported argument: ${argument}`);
    }
    if (args.filter(argument => argument === '--apply').length > 1) {
        throw new Error('Duplicate auth maintenance apply flag');
    }
    const apply = args.includes('--apply');
    if (apply && confirmation !== AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION) {
        throw new Error(`--confirm=${AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION} is required with --apply`);
    }
    if (!apply && confirmation) throw new Error('--confirm requires --apply');
    return { apply, confirmation };
}

function accessTokenExpiry(token) {
    if (typeof token !== 'string' || !token || token.length > 16 * 1024) {
        throw new Error('Amy Hermes access token is missing or invalid');
    }
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Amy Hermes access token is not a JWT');
    let claims;
    try {
        claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
        throw new Error('Amy Hermes access token claims are invalid');
    }
    if (!Number.isInteger(claims?.exp) || claims.exp <= 0) {
        throw new Error('Amy Hermes access token expiry is invalid');
    }
    return claims.exp * 1000;
}

async function readAuthStatus(config, options = {}) {
    const authPath = resolve(config.hermesHome, 'auth.json');
    const metadata = await (options.lstatImpl ?? lstat)(authPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > MAX_AUTH_BYTES) {
        throw new Error('Amy Hermes auth store is not a bounded regular file');
    }
    const raw = await (options.readFileImpl ?? readFile)(authPath, 'utf8');
    let auth;
    try {
        auth = JSON.parse(raw);
    } catch {
        throw new Error('Amy Hermes auth store is invalid');
    }
    const token = auth?.providers?.['openai-codex']?.tokens?.access_token;
    return { authPath, expiresAtMs: accessTokenExpiry(token) };
}

function sanitizedResult(status, nowMs, expiresAtMs, extra = {}) {
    return {
        schemaVersion: AMY_ANAM_HERMES_AUTH_MAINTENANCE_SCHEMA,
        observedAt: new Date(nowMs).toISOString(),
        status,
        applied: extra.applied === true,
        expiresAt: new Date(expiresAtMs).toISOString(),
        secondsRemaining: Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000)),
        backupCreated: extra.backupCreated === true,
        contentIncluded: false,
    };
}

function minimalRefreshEnv(source, config) {
    const allowed = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP'];
    const env = {};
    for (const key of allowed) {
        if (typeof source?.[key] === 'string' && source[key]) env[key] = source[key];
    }
    env.HERMES_HOME = config.hermesHome;
    env.CODEX_HOME = resolve(config.hermesHome, 'codex-cli-recovery-disabled');
    env.HERMES_DISABLE_TELEMETRY = '1';
    env.HERMES_SAFE_MODE = '1';
    env.HERMES_IGNORE_USER_CONFIG = '1';
    env.HERMES_IGNORE_RULES = '1';
    env.HERMES_ACCEPT_HOOKS = '0';
    env.HERMES_YOLO_MODE = '0';
    env.PYTHONDONTWRITEBYTECODE = '1';
    env.PYTHONNOUSERSITE = '1';
    env.PYTHONUTF8 = '1';
    env.PYTHONIOENCODING = 'utf-8';
    env.NO_COLOR = '1';
    env.OTEL_SDK_DISABLED = 'true';
    env.AMY_ANAM_HERMES_AUTH_REFRESH_SKEW_SECONDS = String(config.refreshSkewSeconds);
    return env;
}

function runRefreshHelper(config, source, options = {}) {
    if (options.refreshImpl) return options.refreshImpl(config);
    return new Promise((resolvePromise, reject) => {
        const child = (options.spawnImpl ?? spawn)(config.pythonCommand, [REFRESH_HELPER], {
            cwd: config.hermesHome,
            env: minimalRefreshEnv(source, config),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderrBytes = 0;
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) child.kill();
        }, HELPER_TIMEOUT_MS);
        child.stdout.setEncoding('utf8');
        child.stderr.on('data', chunk => { stderrBytes += Buffer.byteLength(chunk); });
        child.stdout.on('data', chunk => {
            stdout += chunk;
            if (Buffer.byteLength(stdout, 'utf8') > MAX_HELPER_BYTES) child.kill();
        });
        child.once('error', (error) => {
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
        child.once('close', (code) => {
            settled = true;
            clearTimeout(timer);
            let payload;
            try {
                payload = JSON.parse(stdout.trim());
            } catch {
                reject(new Error('Amy Hermes auth refresh helper response was invalid'));
                return;
            }
            if (code !== 0 || stderrBytes !== 0 || payload?.schemaVersion !== HELPER_SCHEMA
                || payload.ok !== true || payload.provider !== 'openai-codex'
                || payload.baseUrlApproved !== true || payload.accessTokenPresent !== true
                || payload.contentIncluded !== false) {
                reject(new Error('Amy Hermes auth refresh helper failed closed'));
                return;
            }
            resolvePromise(payload);
        });
    });
}

async function writeResultLog(config, result) {
    const finalPath = resolve(config.hermesHome, AMY_ANAM_HERMES_AUTH_MAINTENANCE_LOG);
    const temporaryPath = resolve(
        config.hermesHome,
        `.${AMY_ANAM_HERMES_AUTH_MAINTENANCE_LOG}.${randomUUID()}.tmp`,
    );
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    try {
        await writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporaryPath, finalPath);
    } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
    }
}

export async function runAmyAnamHermesAuthMaintenance(command, options = {}) {
    const source = options.env ?? process.env;
    const config = readAmyAnamHermesAuthMaintenanceConfig(source);
    const nowMs = Number(options.now ?? Date.now());
    if (!Number.isFinite(nowMs)) throw new Error('Amy auth maintenance time is invalid');
    if (command.apply && (!config.enabled || config.killSwitch)) {
        throw new Error('Amy Hermes auth maintenance apply gate is closed');
    }
    const before = await readAuthStatus(config, options);
    const due = before.expiresAtMs - nowMs <= config.refreshSkewSeconds * 1000;
    if (!due) {
        const result = sanitizedResult('healthy', nowMs, before.expiresAtMs);
        if (command.apply) await (options.writeResultLogImpl ?? writeResultLog)(config, result);
        return result;
    }
    if (!command.apply) return sanitizedResult('refresh_due', nowMs, before.expiresAtMs);
    const backupRoot = resolve(config.hermesHome, 'auth-backups');
    const backupDir = resolve(
        backupRoot,
        `${new Date(nowMs).toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
    );
    await (options.mkdirImpl ?? mkdir)(backupDir, { recursive: true, mode: 0o700 });
    const backupPath = resolve(backupDir, 'auth.json');
    await (options.copyFileImpl ?? copyFile)(before.authPath, backupPath, fsConstants.COPYFILE_EXCL);
    try {
        await runRefreshHelper(config, source, options);
        const after = await readAuthStatus(config, options);
        if (after.expiresAtMs <= nowMs + config.refreshSkewSeconds * 1000) {
            throw new Error('Amy Hermes refreshed credential did not clear the safety window');
        }
        const result = sanitizedResult('refreshed', nowMs, after.expiresAtMs, {
            applied: true,
            backupCreated: true,
        });
        await (options.writeResultLogImpl ?? writeResultLog)(config, result);
        return result;
    } catch (error) {
        await (options.copyFileImpl ?? copyFile)(backupPath, before.authPath);
        throw error;
    }
}

async function main() {
    const command = readAmyAnamHermesAuthMaintenanceCommand();
    const result = await runAmyAnamHermesAuthMaintenance(command);
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => {
        process.stderr.write('[Amy Anam Hermes] Content-free auth maintenance failed\n');
        process.exitCode = 1;
    });
}
