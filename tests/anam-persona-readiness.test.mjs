import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    AMY_CARA4_REQUIRED_PROMPT_MARKERS,
    AMY_CARA4_REQUIRED_TOOL_NAMES,
    inspectAmyCara4PersonaReadiness,
    readAmyCara4PersonaReadiness,
} from '../lib/anam/persona-readiness.ts';

const PERSONA_ID = '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08';

function healthyPersona() {
    return {
        id: PERSONA_ID,
        avatarModel: 'cara-4',
        zeroDataRetention: false,
        enableAudioPassthrough: false,
        tools: AMY_CARA4_REQUIRED_TOOL_NAMES.map(name => ({ name })),
        brain: {
            systemPrompt: AMY_CARA4_REQUIRED_PROMPT_MARKERS.join('\n'),
        },
    };
}

test('Cara 4 preflight accepts the complete Amy feature configuration', () => {
    const result = inspectAmyCara4PersonaReadiness(healthyPersona(), PERSONA_ID);
    assert.deepEqual(result, {
        ready: true,
        personaIdMatches: true,
        cara4AvatarConfigured: true,
        sessionDataRetentionConfigured: true,
        anamTranscriptionPipelineConfigured: true,
        missingToolNames: [],
        forbiddenToolNames: [],
        missingPromptMarkers: [],
    });
});

test('Cara 4 preflight detects the exact stripped configuration from the failed session', () => {
    const result = inspectAmyCara4PersonaReadiness({
        id: PERSONA_ID,
        avatarModel: 'cara-4',
        tools: [
            { name: 'Knowledge_Amy' },
            { name: 'search_insight_catalog' },
        ],
        brain: { systemPrompt: 'Base prompt without managed blocks.' },
    }, PERSONA_ID);

    assert.equal(result.ready, false);
    assert.deepEqual(result.missingToolNames, [
        'confirm_live_identity',
        'end_amy_session',
        'show_live_notes',
        'show_session_brief',
        'show_solution_catalog',
        'show_solution_roadmap',
        'show_visual_brief',
        'skip_turn',
    ]);
    assert.deepEqual(result.missingPromptMarkers, AMY_CARA4_REQUIRED_PROMPT_MARKERS);
});

test('Cara 4 preflight rejects legacy close and handoff tools', () => {
    const result = inspectAmyCara4PersonaReadiness({
        ...healthyPersona(),
        tools: [
            ...healthyPersona().tools,
            { name: 'end_call' },
            { name: 'capture_sales_handoff' },
        ],
    }, PERSONA_ID);

    assert.equal(result.ready, false);
    assert.deepEqual(result.forbiddenToolNames, ['capture_sales_handoff', 'end_call']);
});

test('Cara 4 preflight also rejects the wrong persona or avatar model', () => {
    assert.equal(inspectAmyCara4PersonaReadiness({
        ...healthyPersona(),
        id: 'different-persona',
    }, PERSONA_ID).ready, false);
    assert.equal(inspectAmyCara4PersonaReadiness({
        ...healthyPersona(),
        avatarModel: 'cara-3',
    }, PERSONA_ID).ready, false);
});

test('Cara 4 preflight rejects zero-data retention and audio passthrough', () => {
    const zeroDataRetention = inspectAmyCara4PersonaReadiness({
        ...healthyPersona(),
        zeroDataRetention: true,
    }, PERSONA_ID);
    assert.equal(zeroDataRetention.ready, false);
    assert.equal(zeroDataRetention.sessionDataRetentionConfigured, false);

    const audioPassthrough = inspectAmyCara4PersonaReadiness({
        ...healthyPersona(),
        enableAudioPassthrough: true,
    }, PERSONA_ID);
    assert.equal(audioPassthrough.ready, false);
    assert.equal(audioPassthrough.anamTranscriptionPipelineConfigured, false);
});

test('live readiness fetch is no-store, bounded, and returns only configuration status', async () => {
    const calls = [];
    const result = await readAmyCara4PersonaReadiness(PERSONA_ID, {
        apiKey: 'secret-test-key',
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return new Response(JSON.stringify(healthyPersona()), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });

    assert.equal(result.ready, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, new RegExp(`/personas/${PERSONA_ID}$`));
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-test-key');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.doesNotMatch(JSON.stringify(result), /secret-test-key/);
});

test('the token route fails closed before reserving or authenticating a stripped Amy session', async () => {
    const route = await readFile(new URL('../app/api/anam-token/route.ts', import.meta.url), 'utf8');
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const preflight = route.indexOf('readAmyCara4PersonaReadiness(');
    const reserve = route.indexOf('storeAmyAnamLaunch(');
    const sessionToken = route.indexOf("fetch('https://api.anam.ai/v1/auth/session-token'");

    assert.ok(preflight > 0);
    assert.ok(preflight < reserve);
    assert.ok(preflight < sessionToken);
    assert.match(route, /Amy configuration is out of sync/);
    assert.match(route, /status: 503/);
    assert.doesNotMatch(route, /missingToolNames[^\n]*error:/);
    const tokenRequest = route.slice(sessionToken, route.indexOf('const data =', sessionToken));
    assert.match(tokenRequest, /personaConfig:\s*\{\s*personaId: resolution\.personaId/);
    assert.doesNotMatch(tokenRequest, /zeroDataRetention|enableAudioPassthrough|livekit/i);
    assert.match(player, /const errorPayload = await tokenRes\.json\(\)\.catch/);
    assert.match(player, /serverMessage \|\| 'Failed to start the agent session'/);
    assert.match(player, /err instanceof Error \? err\.message/);
});
