import assert from 'node:assert/strict';
import test from 'node:test';
import {
    inspectJamesPersonaReadiness,
    readJamesPersonaReadiness,
} from '../lib/anam/james-persona-readiness.ts';

const PERSONA_ID = '11111111-2222-3333-4444-555555555555';
const readyPersona = {
    id: PERSONA_ID,
    avatarModel: 'cara-4',
    zeroDataRetention: false,
    initialMessage: "Hello, I'm James, an AI intake assistant.",
    brain: { systemPrompt: '<!-- JAMES_CANONICAL_SP_START -->\nJAMES_ANAM_SP_2026_07_16\nYou are not a lawyer.\n<!-- JAMES_CANONICAL_SP_END -->' },
    tools: [
        { name: 'Knowledge_James_Knowles_Law_Firm_2026_07' },
        { name: 'end_call' },
        { name: 'skip_turn' },
    ],
};

test('James readiness accepts the reviewed Cara 4 configuration', () => {
    assert.equal(inspectJamesPersonaReadiness(readyPersona, PERSONA_ID).ready, true);
});

test('James readiness fails closed on model, privacy, disclosure, prompt, or tool drift', () => {
    const cases = [
        { ...readyPersona, avatarModel: 'cara-3' },
        { ...readyPersona, initialMessage: 'Hello.' },
        { ...readyPersona, brain: { systemPrompt: 'You are not a lawyer.' } },
        { ...readyPersona, tools: readyPersona.tools.slice(1) },
    ];
    for (const persona of cases) assert.equal(inspectJamesPersonaReadiness(persona, PERSONA_ID).ready, false);
});

test('James live readiness uses a no-store authenticated persona read', async () => {
    const calls = [];
    const result = await readJamesPersonaReadiness(PERSONA_ID, {
        apiKey: 'test-key',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify(readyPersona), { status: 200 });
        },
    });
    assert.equal(result.ready, true);
    assert.match(calls[0].url, new RegExp(`/personas/${PERSONA_ID}$`));
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
});
