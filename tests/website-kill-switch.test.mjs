import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const controller = readFileSync(resolve(root, 'scripts/ops/set-website-state.ps1'), 'utf8');
const installer = readFileSync(resolve(root, 'scripts/ops/install-website-kill-switch.ps1'), 'utf8');

test('website controller exposes explicit offline and online states', () => {
    assert.match(controller, /ValidateSet\('offline', 'online'\)/);
    assert.match(controller, /MAINTENANCE_MODE/);
    assert.match(controller, /xagent\.aifusionlabs\.app/);
    assert.match(controller, /\$updateArguments = @\(/);
    assert.match(controller, /\$MaintenanceVariable,/);
    assert.match(controller, /redeploy \$SiteUrl --target production/);
    assert.match(controller, /RedirectStandardInput \$valueFile/);
    assert.match(controller, /UTF8Encoding/);
    assert.doesNotMatch(controller, /\$DesiredValue \| & vercel env update/);
});

test('website controller requires typed confirmation and verifies the public result', () => {
    assert.match(controller, /Type \$confirmationWord to continue/);
    assert.match(controller, /StatusCode -eq 503/);
    assert.match(controller, /StatusCode -ge 200/);
    assert.match(controller, /DryRun/);
});

test('desktop installer creates separate offline and restore shortcuts without embedding credentials', () => {
    assert.match(installer, /TAKE OFFLINE\.lnk/);
    assert.match(installer, /RESTORE ONLINE\.lnk/);
    assert.match(installer, /-State \$\(\$item\.State\)/);
    assert.doesNotMatch(installer, /VERCEL_TOKEN|--token/);
    assert.doesNotMatch(controller, /VERCEL_TOKEN|--token/);
});

