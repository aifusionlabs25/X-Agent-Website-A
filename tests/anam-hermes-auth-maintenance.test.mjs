import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
    AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION,
    readAmyAnamHermesAuthMaintenanceCommand,
    runAmyAnamHermesAuthMaintenance,
} from '../scripts/hermes/amy-anam-shadow-auth-maintenance.mjs';

const NOW = Date.parse('2026-08-16T00:00:00.000Z');

function jwt(exp) {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    return `${header}.${payload}.fixture`;
}

function envFor(home) {
    return {
        AMY_ANAM_HERMES_HOME: home,
        AMY_ANAM_HERMES_PYTHON_COMMAND: resolve(home, 'venv', 'Scripts', 'python.exe'),
        AMY_ANAM_HERMES_PROVIDER: 'openai-codex',
        AMY_ANAM_HERMES_MODEL: 'gpt-5.5',
        AMY_ANAM_HERMES_AUTH_MAINTENANCE_ENABLED: 'true',
        AMY_ANAM_HERMES_AUTH_MAINTENANCE_KILL_SWITCH: 'false',
        AMY_ANAM_HERMES_AUTH_REFRESH_SKEW_SECONDS: '172800',
    };
}

async function fixture(exp) {
    const home = resolve(tmpdir(), `amy-hermes-auth-maintenance-${process.pid}-${Date.now()}-${Math.random()}`);
    await mkdir(home, { recursive: true });
    await writeFile(resolve(home, 'auth.json'), JSON.stringify({
        providers: { 'openai-codex': { tokens: { access_token: jwt(exp), refresh_token: 'fixture' } } },
    }));
    return home;
}

test('auth maintenance is inspection-first and apply requires an exact confirmation', () => {
    assert.deepEqual(readAmyAnamHermesAuthMaintenanceCommand([]), { apply: false, confirmation: '' });
    assert.throws(
        () => readAmyAnamHermesAuthMaintenanceCommand(['--apply']),
        new RegExp(AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION),
    );
    assert.deepEqual(readAmyAnamHermesAuthMaintenanceCommand([
        '--apply',
        `--confirm=${AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION}`,
    ]), {
        apply: true,
        confirmation: AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION,
    });
});

test('healthy auth inspection is content-free and creates no backup', async () => {
    const home = await fixture(Math.floor(NOW / 1000) + 7 * 24 * 60 * 60);
    try {
        const result = await runAmyAnamHermesAuthMaintenance(
            readAmyAnamHermesAuthMaintenanceCommand([]),
            { env: envFor(home), now: NOW },
        );
        assert.equal(result.status, 'healthy');
        assert.equal(result.applied, false);
        assert.equal(result.backupCreated, false);
        assert.equal(result.contentIncluded, false);
        assert.equal(JSON.stringify(result).includes('access_token'), false);
        assert.equal((await readdir(home)).includes('auth-backups'), false);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('due apply backs up, refreshes, validates the new window, and writes only metadata', async () => {
    const home = await fixture(Math.floor(NOW / 1000) + 60 * 60);
    try {
        const result = await runAmyAnamHermesAuthMaintenance(
            readAmyAnamHermesAuthMaintenanceCommand([
                '--apply',
                `--confirm=${AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION}`,
            ]),
            {
                env: envFor(home),
                now: NOW,
                refreshImpl: async () => {
                    await writeFile(resolve(home, 'auth.json'), JSON.stringify({
                        providers: {
                            'openai-codex': {
                                tokens: {
                                    access_token: jwt(Math.floor(NOW / 1000) + 10 * 24 * 60 * 60),
                                    refresh_token: 'new-fixture',
                                },
                            },
                        },
                    }));
                },
            },
        );
        assert.equal(result.status, 'refreshed');
        assert.equal(result.applied, true);
        assert.equal(result.backupCreated, true);
        assert.equal(result.contentIncluded, false);
        const log = await readFile(resolve(home, 'auth-maintenance-latest.json'), 'utf8');
        assert.deepEqual(JSON.parse(log), result);
        assert.equal(log.includes('access_token'), false);
        assert.equal(log.includes('refresh_token'), false);
        assert.equal((await readdir(resolve(home, 'auth-backups'))).length, 1);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('apply fails closed when either maintenance gate is closed', async () => {
    const home = await fixture(Math.floor(NOW / 1000) + 7 * 24 * 60 * 60);
    const command = readAmyAnamHermesAuthMaintenanceCommand([
        '--apply',
        `--confirm=${AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION}`,
    ]);
    try {
        await assert.rejects(
            runAmyAnamHermesAuthMaintenance(command, {
                env: { ...envFor(home), AMY_ANAM_HERMES_AUTH_MAINTENANCE_ENABLED: 'false' },
                now: NOW,
            }),
            /apply gate is closed/,
        );
        await assert.rejects(
            runAmyAnamHermesAuthMaintenance(command, {
                env: { ...envFor(home), AMY_ANAM_HERMES_AUTH_MAINTENANCE_KILL_SWITCH: 'true' },
                now: NOW,
            }),
            /apply gate is closed/,
        );
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('failed refresh restores the exact pre-refresh auth store', async () => {
    const home = await fixture(Math.floor(NOW / 1000) + 60 * 60);
    const authPath = resolve(home, 'auth.json');
    const before = await readFile(authPath, 'utf8');
    try {
        await assert.rejects(
            runAmyAnamHermesAuthMaintenance(
                readAmyAnamHermesAuthMaintenanceCommand([
                    '--apply',
                    `--confirm=${AMY_ANAM_HERMES_AUTH_MAINTENANCE_CONFIRMATION}`,
                ]),
                {
                    env: envFor(home),
                    now: NOW,
                    refreshImpl: async () => {
                        await writeFile(authPath, '{"damaged":true}');
                        throw new Error('fixture refresh failure');
                    },
                },
            ),
            /fixture refresh failure/,
        );
        assert.equal(await readFile(authPath, 'utf8'), before);
        await assert.rejects(readFile(resolve(home, 'auth-maintenance-latest.json'), 'utf8'));
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});

test('maintenance source disables shared Codex recovery and never logs token fields', async () => {
    const source = await readFile(
        resolve('scripts', 'hermes', 'amy-anam-shadow-auth-maintenance.mjs'),
        'utf8',
    );
    const helper = await readFile(
        resolve('scripts', 'hermes', 'amy-anam-shadow-auth-refresh.py'),
        'utf8',
    );
    assert.match(source, /codex-cli-recovery-disabled/);
    assert.doesNotMatch(source, /process\.stdout\.write.*access_token/s);
    assert.match(helper, /shared Codex credential recovery is not disabled/);
    assert.match(helper, /contentIncluded/);
});
