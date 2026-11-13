import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTION_EVAN_SETTINGS, productionStageArgs } from '../scripts/anam/stage-evan-duration-production.mjs';

test('production stage enables local capture and AIFL demo routing only for Evan', () => {
    assert.equal(PRODUCTION_EVAN_SETTINGS.EVAN_CAPTURE_PRODUCTION_APPROVED, 'true');
    assert.equal(PRODUCTION_EVAN_SETTINGS.EVAN_CAPTURE_ENGINE, 'local');
    assert.equal(PRODUCTION_EVAN_SETTINGS.EVAN_PUBLIC_DEMO_MAIL_ROUTING, 'all-aifl');
    assert.ok(Object.keys(PRODUCTION_EVAN_SETTINGS).every(key => key.startsWith('EVAN_')));
    assert.equal(PRODUCTION_EVAN_SETTINGS.ANAM_RECOVERY_NAMESPACE, undefined);
    assert.equal(PRODUCTION_EVAN_SETTINGS.EVAN_EXTENDED_DEMO_ACCESS_KEY, undefined);
});

test('stage uses production environment without publishing or exposing secret arguments', () => {
    const args = productionStageArgs('cli');
    assert.ok(args.includes('--prod'));
    assert.ok(args.includes('--skip-domain'));
    assert.equal(args.includes('--target'), false);
    assert.equal(args.includes('promote'), false);
    const keys = args.filter((_, index) => args[index - 1] === '--env');
    assert.deepEqual(keys, [...Object.keys(PRODUCTION_EVAN_SETTINGS), 'EVAN_EXTENDED_DEMO_ACCESS_KEY']);
    assert.equal(keys.some(key => key.includes('=')), false);
});
