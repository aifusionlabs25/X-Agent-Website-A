import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedEvanDemoCheckpoint, EVAN_DEMO_PUBLIC_PERSONA_ID, EVAN_DEMO_EXTENDED_PERSONA_ID } from '../lib/anam/evan-demo-persona.ts';
import { verifyEvanDemoPersona } from '../lib/anam/evan-demo-runtime.ts';

for (const [mode, maxSeconds, providerPersonaId] of [
    ['public', 180, EVAN_DEMO_PUBLIC_PERSONA_ID], ['extended', 1800, EVAN_DEMO_EXTENDED_PERSONA_ID],
]) {
    test(`${mode} preflight verifies frozen checkpoint without reading mutable6097`, async () => {
        const clone = { ...expectedEvanDemoCheckpoint(), id: providerPersonaId, maxSessionLengthSeconds: maxSeconds };
        const calls = [];
        const fetchImpl = async (url, options) => {
            calls.push(url);
            assert.equal(options.cache, 'no-store');
            return Response.json(clone);
        };
        await verifyEvanDemoPersona('offline-key', { mode, maxSeconds, providerPersonaId }, fetchImpl);
        assert.deepEqual(calls, [`https://api.anam.ai/v1/personas/${providerPersonaId}`]);
        clone.maxSessionLengthSeconds = 3600;
        await assert.rejects(verifyEvanDemoPersona('offline-key', { mode, maxSeconds, providerPersonaId }, fetchImpl), /duration readback/);
    });
}

test('preflight rejects unavailable provider and changed prompt or tools', async () => {
    const policy = { mode: 'public', maxSeconds: 180, providerPersonaId: EVAN_DEMO_PUBLIC_PERSONA_ID };
    await assert.rejects(verifyEvanDemoPersona('offline', policy, async () => new Response('', { status: 503 })), /could not be verified/);
    for (const field of ['prompt', 'tool']) {
        const clone = { ...expectedEvanDemoCheckpoint(), id: policy.providerPersonaId, maxSessionLengthSeconds: 180 };
        if (field === 'prompt') clone.brain.systemPrompt += '\nChanged behavior';
        else clone.tools[0].description += 'Changed behavior';
        await assert.rejects(verifyEvanDemoPersona('offline', policy, async () => Response.json(clone)), /readback changed/);
    }
});
