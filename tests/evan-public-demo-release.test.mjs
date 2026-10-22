import assert from 'node:assert/strict';
import test from 'node:test';
import { readEvanCaptureConfig, extractEvanCapture } from '../lib/anam/evan-capture-service.ts';

test('production capture requires explicit release approval and the local engine', async () => {
    const env = { VERCEL_ENV: 'production', EVAN_CAPTURE_ENABLED: 'true', EVAN_CAPTURE_ENGINE: 'local' };
    assert.equal(readEvanCaptureConfig(env).configured, false);
    const approved = { ...env, EVAN_CAPTURE_PRODUCTION_APPROVED: 'true' };
    assert.equal(readEvanCaptureConfig(approved).configured, true);
    for (const engine of ['cloud', 'typo']) {
        assert.equal(readEvanCaptureConfig({ ...approved, EVAN_CAPTURE_ENGINE: engine,
            OPENAI_API_KEY: 'unused-test-key', EVAN_CAPTURE_MODEL: 'test-model' }).configured, false);
    }
    assert.equal(readEvanCaptureConfig({ ...approved, EVAN_CAPTURE_ENABLED: 'false' }).configured, false);
    const record = await extractEvanCapture({ turns: [{ role: 'user', content: 'My name is Avery Stone.' }], revision: 1 }, {
        env: approved, fetchImpl() { assert.fail('Production local capture must not call a provider'); },
    });
    assert.equal(record.facts.find(f => f.category === 'name')?.value, 'Avery Stone');
});
