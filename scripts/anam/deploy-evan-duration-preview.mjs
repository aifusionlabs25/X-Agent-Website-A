// Immutable rehearsal only. No project environment, production or alias writes.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID } from '../../lib/anam/evan-demo-persona.ts';

if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported');
const project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
if (project.projectId !== 'prj_bV8rj56Sxm9BnNSgTxp5DcHrPVvs' || project.orgId !== 'team_vtMP2TcBz05zYZ5dY1lsSQI6') throw new Error('Wrong linked project');
const receipt = JSON.parse(readFileSync('.vercel/evan-6097-duration-release.json', 'utf8'));
for (const id of [EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID]) {
    if (!receipt.clones.some(row => row.id === id && row.verified)) throw new Error('Provider copy is not verified');
}
const privateFile = '.vercel/evan-duration-private-access.json';
const savedAccess = existsSync(privateFile) ? JSON.parse(readFileSync(privateFile, 'utf8')) : undefined;
const customKeys = savedAccess?.accessCode === undefined ? [] : ['EVAN_EXTENDED_DEMO_ACCESS_CODE'];
if (customKeys.length && (typeof savedAccess.accessCode !== 'string' || savedAccess.accessCode.length < 6 || savedAccess.accessCode.length > 256 || savedAccess.accessCode !== savedAccess.accessCode.trim())) throw new Error('Invalid custom demo code');
const env = {
    ...process.env,
    EVAN_PUBLIC_DEMO_PERSONA_ID: EVAN_DEMO_PUBLIC_PERSONA_ID,
    EVAN_EXTENDED_DEMO_PERSONA_ID: EVAN_DEMO_EXTENDED_PERSONA_ID,
    EVAN_CAPTURE_ENABLED: 'true', EVAN_CAPTURE_ENGINE: 'local', EVAN_CAPTURE_PRODUCTION_APPROVED: 'false',
    EVAN_PUBLIC_DEMO_ENABLED: 'true', EVAN_PUBLIC_DEMO_MAIL_ROUTING: 'all-aifl',
    EVAN_GUEST_DEMO_LEAD_ENABLED: 'true',
    EVAN_MULLINS_ADMIN_EMAIL: 'aifusionlabs@gmail.com', EVAN_MULLINS_SALES_EMAIL: 'aifusionlabs@gmail.com',
    EVAN_DEMO_LEAD_EMAIL: 'aifusionlabs@gmail.com',
    EVAN_EMAIL_PROVIDER: 'agentmail', EVAN_AGENTMAIL_ADDRESS: 'hermes-hal@agentmail.to',
    EVAN_ANAM_AGENTMAIL_ENABLED: 'true', EVAN_ANAM_AGENTMAIL_KILL_SWITCH: 'false',
    EVAN_ANAM_TOOLS_ENABLED: 'true', EVAN_ANAM_TOOLS_KILL_SWITCH: 'false',
    EVAN_ANAM_OUTBOUND_ACTIONS_ENABLED: 'true', EVAN_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH: 'false',
    ANAM_RECOVERY_NAMESPACE: 'evan-duration-20261113',
};
const keys = Object.keys(env).filter(key => key.startsWith('EVAN_') || key === 'ANAM_RECOVERY_NAMESPACE');
// Only explicit release settings, never arbitrary inherited Evan environment values.
const explicitKeys = keys.filter(key => Object.hasOwn({
    EVAN_PUBLIC_DEMO_PERSONA_ID:1, EVAN_EXTENDED_DEMO_PERSONA_ID:1, EVAN_CAPTURE_ENABLED:1,
    EVAN_CAPTURE_ENGINE:1, EVAN_CAPTURE_PRODUCTION_APPROVED:1, EVAN_PUBLIC_DEMO_ENABLED:1,
    EVAN_PUBLIC_DEMO_MAIL_ROUTING:1, EVAN_GUEST_DEMO_LEAD_ENABLED:1, EVAN_MULLINS_ADMIN_EMAIL:1,
    EVAN_MULLINS_SALES_EMAIL:1, EVAN_DEMO_LEAD_EMAIL:1, EVAN_EMAIL_PROVIDER:1, EVAN_AGENTMAIL_ADDRESS:1,
    EVAN_ANAM_AGENTMAIL_ENABLED:1, EVAN_ANAM_AGENTMAIL_KILL_SWITCH:1, EVAN_ANAM_TOOLS_ENABLED:1,
    EVAN_ANAM_TOOLS_KILL_SWITCH:1, EVAN_ANAM_OUTBOUND_ACTIONS_ENABLED:1,
    EVAN_ANAM_OUTBOUND_ACTIONS_KILL_SWITCH:1, ANAM_RECOVERY_NAMESPACE:1,
}, key));
if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ target: 'amy-ceo-rehearsal', skipDomain: true, overrideKeys: [...explicitKeys, 'EVAN_EXTENDED_DEMO_ACCESS_KEY', ...customKeys], productionWrite: false }));
} else {
    const access = savedAccess ?? { code: randomBytes(32).toString('base64url') };
    if (typeof access.code !== 'string' || access.code.length < 32) throw new Error('Invalid private demo key');
    if (!existsSync(privateFile)) writeFileSync(privateFile, JSON.stringify(access, null, 2), { mode: 0o600, flag: 'wx' });
    env.EVAN_EXTENDED_DEMO_ACCESS_KEY = access.code;
    if (access.accessCode !== undefined) {
        env.EVAN_EXTENDED_DEMO_ACCESS_CODE = access.accessCode;
    }
    const cli = resolve(process.env.APPDATA, 'npm/node_modules/vercel/dist/index.js');
    const args = [cli, 'deploy', '.', '--target', 'amy-ceo-rehearsal', '--skip-domain', '--yes', '--force', '--no-wait', '--scope', 'robs-projects-e72bad73'];
    for (const key of [...explicitKeys, 'EVAN_EXTENDED_DEMO_ACCESS_KEY', ...customKeys]) args.push('--env', key);
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    // CLI logs key names, never secret values (values travel in the child environment).
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    const urls = result.stdout.match(/https:\/\/x-agent-website-[a-z0-9-]+\.vercel\.app/g) ?? [];
    if (urls.length !== 1) throw new Error('Inspect CLI result: expected one immutable preview URL');
    writeFileSync('.vercel/evan-duration-preview.json', JSON.stringify({ url: urls[0], environment: 'amy-ceo-rehearsal', deployedAt: new Date().toISOString(), checkpointHash: receipt.checkpointHash, productionWrite: false }, null, 2));
}
