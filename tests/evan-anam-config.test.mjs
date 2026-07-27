import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { EVAN_PERSONA_ID, EVAN_REQUIRED_PROMPT_MARKERS, EVAN_REQUIRED_TOOL_NAMES, inspectEvanPersonaReadiness, readEvanPersonaReadiness } from '../lib/anam/persona-readiness.ts';

const healthyPersona = () => ({
    id: EVAN_PERSONA_ID,
    name: 'Evan Mullins Moving Concierge',
    avatarModel: 'cara-4',
    zeroDataRetention: false,
    enableAudioPassthrough: false,
    tools: EVAN_REQUIRED_TOOL_NAMES.map(name => ({ name })),
    brain: { systemPrompt: EVAN_REQUIRED_PROMPT_MARKERS.join('\n') },
});

test('Evan readiness requires exact identity, Cara 4, managed prompt, and safe tools', () => {
    assert.equal(inspectEvanPersonaReadiness(healthyPersona()).ready, true);
    assert.equal(inspectEvanPersonaReadiness({ ...healthyPersona(), id: '8a991c93-0c95-42c5-8c22-a67428946eb8' }).ready, false);
    assert.equal(inspectEvanPersonaReadiness({ ...healthyPersona(), name: 'James Knowles Law Firm' }).ready, false);
    assert.equal(inspectEvanPersonaReadiness({ ...healthyPersona(), avatarModel: 'cara-3' }).ready, false);
    assert.equal(inspectEvanPersonaReadiness({ ...healthyPersona(), tools: [{ name: 'Knowledge_Liv' }] }).ready, false);
});

test('live readiness fetch is bounded, no-store, and does not leak the API key', async () => {
    const calls = [];
    const result = await readEvanPersonaReadiness('test-secret', async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(healthyPersona()), { status: 200 });
    });
    assert.equal(result.ready, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, new RegExp(`${EVAN_PERSONA_ID}$`));
    assert.equal(calls[0].init.cache, 'no-store');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.doesNotMatch(JSON.stringify(result), /test-secret/);
});

test('agent IDs are unique and Evan never uses the James ID', async () => {
    const agents = await readFile(new URL('../lib/agents.ts', import.meta.url), 'utf8');
    const ids = [...agents.matchAll(/personaId:\s*"([0-9a-f-]{36})"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(agents, new RegExp(`slug: "evan"[\\s\\S]{0,300}personaId: "${EVAN_PERSONA_ID}"`));
    assert.match(agents, /slug: "james"[\s\S]{0,300}personaId: "8a991c93-0c95-42c5-8c22-a67428946eb8"/);
});

test('managed prompt enforces reliability and action honesty', async () => {
    const prompt = await readFile(new URL('../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8');
    for (const marker of EVAN_REQUIRED_PROMPT_MARKERS) assert.ok(prompt.includes(marker));
    assert.match(prompt, /at most one meaningful next question/i);
    assert.match(prompt, /Do not restart the intake/i);
    assert.match(prompt, /relaxed, patient, and conversational/i);
    assert.match(prompt, /Ask one useful moving-detail question at a time/i);
    assert.match(prompt, /complete date including month and flexibility/i);
    assert.match(prompt, /Never silently guess or change a person's name/i);
    assert.match(prompt, /send_mullins_follow_up_email/);
    assert.match(prompt, /three messages are scheduled/i);
    assert.match(prompt, /required check-in includes explicit consent/i);
    assert.match(prompt, /backend reserves the three-message follow-up when the verified Evan session binds/i);
    assert.match(prompt, /never visible to you/i);
    assert.match(prompt, /No tool books a move/i);
    assert.match(prompt, /Never ask whether it is okay to end the call/i);
    assert.match(prompt, /Would you like me to end our call now\?" is forbidden/i);
    assert.match(prompt, /"take care,".*are already confirmation/i);
    assert.match(prompt, /Call `end_mullins_session` immediately without speaking first or seeking confirmation/i);
    assert.match(prompt, /when `end_mullins_session` returns `farewell_required`[\s\S]*Thank you for speaking with Mullins Moving\. Take care\./i);
    assert.match(prompt, /items intended for donation so the team can confirm what transportation options are available/i);
    assert.match(prompt, /loading order, destination labels, time, and cost/i);
    assert.match(prompt, /assisted-living or managed-facility name and address/i);
    assert.match(prompt, /Never say a quote or estimate will be emailed/i);
    assert.match(prompt, /Mullins staff must separately review any estimate or walkthrough request/i);
    assert.match(prompt, /you can refresh the Live Move Planner whenever the visitor adds or corrects move details/i);
    assert.match(prompt, /call `show_move_planner` again after capturing the correction/i);
    assert.match(prompt, /location map, stops, or their order/i);
    assert.match(prompt, /city-center pins and a stop-order line/i);
    assert.match(prompt, /Never say an item, stop, route order, or other detail was added, corrected, saved, or is accurate unless the receipt supports that visible fact/i);
    assert.match(prompt, /Once the session has ended, new changes must go to the Mullins team/i);
});

test('move planner tool supports live corrections without unsupported update claims', async () => {
    const tool = JSON.parse(await readFile(new URL('../config/anam/evan-move-planner-client-tool.json', import.meta.url), 'utf8'));
    assert.ok(tool.description.length <= 1024, 'Anam tool descriptions must remain within the platform limit');
    assert.match(tool.description, /explicitly asks to add, change, correct, update, or refresh planner details during the active session/i);
    assert.match(tool.description, /Call it again after an explicit correction/i);
    assert.match(tool.description, /live city map, stops, or stop order/i);
    assert.match(tool.description, /city-center pins and a stop-order line/i);
    assert.match(tool.description, /never claim that a requested update was made, saved, or is accurate when the receipt does not support it/i);
    assert.match(tool.description, /after the session ends must go to Mullins staff/i);
    assert.match(tool.config.parameters.properties.view.description, /stop-order corrections/i);
    assert.match(tool.config.parameters.properties.view.description, /items, packing, services, access/i);
});

test('managed persona uses patient turn detection and disables silence prompts and shutdown', async () => {
    const manifest = JSON.parse(await readFile(new URL('../config/anam/evan/persona-manifest.json', import.meta.url), 'utf8'));
    assert.deepEqual(manifest.voiceDetectionOptions, {
        endOfSpeechSensitivity: 0.05,
        silenceBeforeAutoEndTurnSeconds: 3,
        silenceBeforeSkipTurnSeconds: 0,
        silenceBeforeSessionEndSeconds: 0,
        speechEnhancementLevel: 0.7,
    });

    const updater = await readFile(new URL('../scripts/anam/update-evan-persona.mjs', import.meta.url), 'utf8');
    const audit = await readFile(new URL('../scripts/anam/audit-evan-persona.mjs', import.meta.url), 'utf8');
    assert.match(updater, /personaManifest\.voiceDetectionOptions/);
    assert.match(updater, /voiceDetectionOptions: VOICE_DETECTION_OPTIONS/);
    assert.match(updater, /managedPromptOf/);
    assert.doesNotMatch(updater, /rollbackName|Pre-update rollback copy/);
    assert.match(updater, /endSessionToolDefinition/);
    assert.doesNotMatch(updater, /tools\.find\(item => item\.name === 'end_call'\)/);
    assert.match(audit, /voiceDetectionOptions\.\$\{name\}/);
    assert.match(audit, /managedPromptOf/);
    assert.match(audit, /end_mullins_session/);
    assert.doesNotMatch(audit, /'end_call'/);
});

test('knowledge manifest is complete and excludes internal/Tavus material', async () => {
    const manifest = JSON.parse(await readFile(new URL('../config/anam/evan/knowledge-manifest.json', import.meta.url), 'utf8'));
    const files = (await readdir(new URL('../config/anam/evan/knowledge/', import.meta.url))).sort();
    assert.deepEqual(files, [...manifest.documents].sort());
    assert.equal(files.length, 8);
    assert.ok(manifest.excludedClasses.some(value => /Tavus/i.test(value)));
    for (const file of files) {
        const content = await readFile(new URL(`../config/anam/evan/knowledge/${file}`, import.meta.url), 'utf8');
        assert.match(content, /Verified: 2026-07-16/);
        assert.match(content, /https:\/\/www\.mullins-moving\.com\//);
        assert.doesNotMatch(content, /TEST-SPECIFIC BEHAVIOR RULES|PAL BLUEPRINT|founder questionnaire/i);
    }
});

test('token route allowlists personas and fails closed before minting an unready Evan session', async () => {
    const route = await readFile(new URL('../app/api/anam-token/route.ts', import.meta.url), 'utf8');
    const allowlist = route.indexOf('allowedPersonaIds: ALLOWED_PERSONA_IDS');
    const readiness = route.indexOf('readEvanPersonaReadiness(anamApiKey)');
    const token = route.indexOf("fetch('https://api.anam.ai/v1/auth/session-token'");
    assert.ok(allowlist > 0 && allowlist < token);
    assert.ok(readiness > 0 && readiness < token);
    assert.match(route, /status: 503/);
    assert.doesNotMatch(route, /missingToolNames[^\n]*error:/);
});
