// Production build only: never assigns aliases, modifies a persona, or starts a call.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID } from '../../lib/anam/evan-demo-persona.ts';

export const PRODUCTION_EVAN_SETTINGS = Object.freeze({
    EVAN_PUBLIC_DEMO_PERSONA_ID: EVAN_DEMO_PUBLIC_PERSONA_ID,
    EVAN_EXTENDED_DEMO_PERSONA_ID: EVAN_DEMO_EXTENDED_PERSONA_ID,
    EVAN_CAPTURE_ENABLED: 'true', EVAN_CAPTURE_ENGINE: 'local', EVAN_CAPTURE_PRODUCTION_APPROVED: 'true',
    EVAN_PUBLIC_DEMO_ENABLED: 'true', EVAN_PUBLIC_DEMO_MAIL_ROUTING: 'all-aifl',
    EVAN_GUEST_DEMO_LEAD_ENABLED: 'true',
    EVAN_MULLINS_ADMIN_EMAIL: 'aifusionlabs@gmail.com', EVAN_MULLINS_SALES_EMAIL: 'aifusionlabs@gmail.com',
    EVAN_DEMO_LEAD_EMAIL: 'aifusionlabs@gmail.com',
    EVAN_EMAIL_PROVIDER: 'agentmail', EVAN_AGENTMAIL_ADDRESS: 'hermes-hal@agentmail.to',
    EVAN_ANAM_AGENTMAIL_ENABLED: 'true', EVAN_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
    EVAN_ANAM_TOOLS_ENABLED: 'true', EVAN_ANAM_TOOLS_KILL_SWITCH: 'false',
    EVAN_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true', EVAN_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
});

export function productionStageArgs(cli) {
    return [cli, 'deploy', '.', '--prod', '--skip-domain', '--yes', '--force', '--no-wait',
        '--scope', 'robs-projects-e72bad73',
        ...[...Object.keys(PRODUCTION_EVAN_SETTINGS), 'EVAN_EXTENDED_DEMO_ACCESS_KEY'].flatMap(key => ['--env', key])];
}

function main() {
    if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported');
    const project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
    if (project.projectId !== 'prj_bV8rj56Sxm9BnNSgTxp5DcHrPVvs' || project.orgId !== 'team_vtMP2TcBz05zYZ5dY1lsSQI6') throw new Error('Wrong linked project');
    const copies = JSON.parse(readFileSync('.vercel/evan-6097-duration-release.json', 'utf8'));
    for (const id of [EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID]) {
        if (!copies.clones.some(row => row.id === id && row.verified)) throw new Error('Unverified provider copy');
    }
    const { code } = JSON.parse(readFileSync('.vercel/evan-duration-private-access.json', 'utf8'));
    if (typeof code !== 'string' || code.length < 32) throw new Error('Private key missing or invalid');
    const args = productionStageArgs(resolve(process.env.APPDATA, 'npm/node_modules/vercel/dist/index.js'));
    if (!process.argv.includes('--apply')) {
        console.log(JSON.stringify({ environment: 'production', skipDomain: true,
            overrideKeys: [...Object.keys(PRODUCTION_EVAN_SETTINGS), 'EVAN_EXTENDED_DEMO_ACCESS_KEY'],
            sharedSettingsOverridden: false, aliasWrite: false, projectEnvWrite: false }));
        return;
    }
    // Existing production credentials/shared settings are inherited by Vercel.
    // Only explicitly named Evan values travel to this build. No namespace override.
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true,
        env: { ...process.env, ...PRODUCTION_EVAN_SETTINGS, EVAN_EXTENDED_DEMO_ACCESS_KEY: code },
        maxBuffer: 4 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    const urls = result.stdout.match(/https:\/\/x-agent-website-[a-z0-9]+-robs-projects-e72bad73\.vercel\.app/g) ?? [];
    if (urls.length !== 1) throw new Error('Expected one immutable deployment URL');
    const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
    if (commit.status !== 0) throw new Error('Unable to record source commit');
    writeFileSync('.vercel/evan-duration-production-stage.json', JSON.stringify({
        url: urls[0], environment: 'production', skipDomain: true, stagedAt: new Date().toISOString(),
        sourceCommit: commit.stdout.trim(), checkpointHash: copies.checkpointHash,
        rollbackDeployment: 'dpl_532oXZx47MLz9UWBmRWkzDx4dqLF',
        overrideKeys: [...Object.keys(PRODUCTION_EVAN_SETTINGS), 'EVAN_EXTENDED_DEMO_ACCESS_KEY'],
        aliasWrite: false, projectEnvWrite: false,
    }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
