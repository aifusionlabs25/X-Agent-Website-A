import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    hasAmyWorkbenchCloseIntent,
    hasExplicitAmyCloseIntent,
} from '../lib/anam/amy-session-close.ts';
import {
    hasAmyCapabilityOverviewIntent,
    normalizeAmyCapabilityTurn,
} from '../lib/anam/amy-capability-intent.ts';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('failed session 3d852e0a view-close language cannot end Amy\'s conversation', () => {
    const exactViewCloseTurns = [
        'Okay. Thank you for sharing that. You can close this now.',
        'Yeah, no, you can close this window you popped up.',
        'Please close the Visual Brief.',
    ];

    for (const turn of exactViewCloseTurns) {
        assert.equal(hasExplicitAmyCloseIntent(turn), false, turn);
        assert.equal(hasAmyWorkbenchCloseIntent(turn, true), true, turn);
    }

    assert.equal(hasAmyWorkbenchCloseIntent('You can close this now.', false), false);
    assert.equal(hasAmyWorkbenchCloseIntent('Close this window you popped up.', false), false);
    assert.equal(hasAmyWorkbenchCloseIntent('Hide that screen.', false), false);
    assert.equal(hasAmyWorkbenchCloseIntent('Close the Visual Brief.', false), true);
    assert.equal(hasAmyWorkbenchCloseIntent('End the session now.', true), false);
    assert.equal(hasExplicitAmyCloseIntent('End the session now.'), true);
});

test('Amy exposes only a bounded directional catalog and no live product-data search', async () => {
    const [toolJson, updater, readiness] = await Promise.all([
        readSource('../config/anam/amy-workbench-client-tools.json'),
        readSource('../scripts/anam/update-amy-workbench.mjs'),
        readSource('../lib/anam/persona-readiness.ts'),
    ]);
    const tools = JSON.parse(toolJson);
    const names = tools.map((tool) => tool.name);

    assert.equal(names.includes('search_insight_catalog'), false);
    assert.equal(names.filter((name) => name === 'show_solution_catalog').length, 1);
    const directionalCatalog = tools.find((tool) => tool.name === 'show_solution_catalog');
    assert.equal(directionalCatalog.type, 'CLIENT');
    assert.equal(directionalCatalog.config.awaitResult, true);
    assert.match(directionalCatalog.description, /directional solution-category catalog/i);
    assert.match(directionalCatalog.description, /Never call this tool if the same request asks for a live SKU, part number, inventory, price, availability, lead time, contract eligibility, or product-data search/i);
    assert.match(directionalCatalog.description, /call no display tool and give the polite no-live-connection boundary/i);

    assert.match(updater, /FORBIDDEN_TOOL_NAMES = new Set\(\[[^\]]*'search_insight_catalog'/s);
    assert.match(readiness, /AMY_CARA4_FORBIDDEN_TOOL_NAMES[\s\S]*'search_insight_catalog'/);
});

test('Amy capability requests open a non-customer overview with an idempotent receipt', async () => {
    const [toolJson, player, workbench, workbenchPrompt] = await Promise.all([
        readSource('../config/anam/amy-workbench-client-tools.json'),
        readSource('../components/AnamPlayer.tsx'),
        readSource('../components/amy/AmyAnamWorkbenchV2.tsx'),
        readSource('../config/anam/amy-workbench-prompt-upgrade.md'),
    ]);
    const tools = JSON.parse(toolJson);
    const capabilityTool = tools.find((tool) => tool.name === 'show_amy_intelligence');

    assert.equal(capabilityTool.type, 'CLIENT');
    assert.deepEqual(capabilityTool.config.parameters, {
        type: 'object',
        properties: {},
        additionalProperties: false,
    });
    assert.equal(capabilityTool.config.awaitResult, true);
    assert.match(capabilityTool.description, /not a customer Visual Brief/i);
    assert.match(capabilityTool.description, /what Amy does or can do/i);
    assert.match(capabilityTool.description, /how Amy works/i);
    assert.match(capabilityTool.description, /evaluating or interviewing Amy/i);
    assert.match(workbenchPrompt, /tell me about yourself[\s\S]*show_amy_intelligence once/i);

    const registration = player.indexOf("registerToolCallHandler('show_amy_intelligence'");
    const streaming = player.indexOf("anamClient.streamToVideoElement('persona-video')");
    assert.ok(registration > 0 && registration < streaming);
    assert.match(player, /status: alreadyOpen \? 'amy_intelligence_already_open' : 'amy_intelligence_opened'/);
    assert.match(player, /receiptId: amyIntelligenceOverviewReceiptId/);
    assert.match(player, /view: 'capabilities'/);
    assert.match(player, /customerArtifact: false/);
    assert.match(player, /sessionEnded: false/);
    assert.match(player, /retryAllowed: false/);
    assert.match(workbench, /id: 'capabilities', label: 'Overview'/);
    assert.match(workbench, /This is a product-capability overview/);
    assert.match(workbench, /Insight specialists and responsible customer owners validate architecture/);
    assert.match(player, /useState<AmyWorkbenchView>\('capabilities'\)/);
    assert.match(player, /onClick=\{\(\) => \{[\s\S]{0,100}setAmyWorkbenchView\('capabilities'\);[\s\S]{0,100}setAmyWorkbenchOpen\(true\)/);
    assert.match(player, /isAmyCara4[\s\S]{0,120}workbenchEnabled[\s\S]{0,120}hasAmyCapabilityOverviewIntent/);
    assert.match(player, /lastAmyCapabilityIntentTurn/);
    assert.match(player, /amyIntelligenceOverviewReceiptId \?\?=/);
    assert.match(player, /browser has opened Amy Intelligence to the non-customer capability Overview/);
});

test('Amy capability intent is conservative, normalized, and excludes live catalog tests', () => {
    for (const turn of [
        'What do you do?',
        'Tell me what you can do.',
        "I'd like to understand what you can do.",
        'How do you work?',
        'Can you explain how you work?',
        'What are you capable of?',
        'What exactly are your capabilities?',
        'Why do you matter?',
        "I'm the CEO and I want to learn about Amy.",
        'Tell me about yourself.',
        "I'm evaluating you, Amy.",
        'Open Amy Intelligence.',
        'Walk me through your capabilities.',
    ]) {
        assert.equal(hasAmyCapabilityOverviewIntent(turn), true, turn);
    }

    for (const turn of [
        'What can you do to find part number C9300-48P?',
        'Open your capabilities and check live inventory.',
        'Tell me about our security problem.',
        'How do you work with a 30-day pricing deadline?',
    ]) {
        assert.equal(hasAmyCapabilityOverviewIntent(turn), false, turn);
    }

    assert.equal(normalizeAmyCapabilityTurn('  HOW   do you WORK?  '), 'how do you work?');
});

test('Amy view close and session close use distinct authoritative receipts', async () => {
    const [toolJson, player] = await Promise.all([
        readSource('../config/anam/amy-workbench-client-tools.json'),
        readSource('../components/AnamPlayer.tsx'),
    ]);
    const tools = JSON.parse(toolJson);
    const viewCloseTool = tools.find((tool) => tool.name === 'close_amy_intelligence');
    const sessionCloseTool = tools.find((tool) => tool.name === 'end_amy_session');

    assert.equal(viewCloseTool.type, 'CLIENT');
    assert.match(viewCloseTool.description, /never ends the conversation/i);
    assert.match(sessionCloseTool.description, /use close_amy_intelligence instead/i);
    assert.match(sessionCloseTool.description, /call once/i);
    assert.match(sessionCloseTool.description, /retryAllowed false/i);

    assert.match(player, /lastWorkbenchCloseReceipt\?\.request === normalizedRequest/);
    assert.match(player, /workbenchOpenGenerationRef\.current \+= 1/);
    assert.match(player, /lastWorkbenchCloseReceipt\?\.generation === workbenchOpenGenerationRef\.current/);
    assert.match(player, /generation: workbenchOpenGenerationRef\.current/);
    assert.match(player, /status: viewWasOpen \? 'workbench_view_closed' : 'workbench_view_already_closed'/);
    assert.match(player, /receiptId,/);
    assert.match(player, /viewClosed: true,[\s\S]{0,80}sessionEnded: false/);
    assert.match(player, /const viewCloseReceipt = closeAmyWorkbenchFromRequest\(latestUserTurn\)/);
    assert.match(player, /status: 'close_not_requested',[\s\S]{0,180}retryAllowed: false/);
    assert.match(player, /'closing_motion_and_farewell_required'/);
    assert.match(player, /receiptId: amyTerminalCloseReceiptId/);
    assert.match(player, /if \(amyTerminalCloseReceiptId\)[\s\S]{0,300}status: 'close_in_progress'/);
    const sessionHandlerStart = player.indexOf("registerToolCallHandler(\n                        'end_amy_session'");
    const sessionHandlerEnd = player.indexOf("registerToolCallHandler(\n                        'confirm_live_identity'", sessionHandlerStart);
    const sessionHandler = player.slice(sessionHandlerStart, sessionHandlerEnd);
    const acceptedReceipt = sessionHandler.lastIndexOf('accepted: true');
    const sessionNotEnded = sessionHandler.indexOf('sessionEnded: false', acceptedReceipt);
    const retryForbidden = sessionHandler.indexOf('retryAllowed: false', sessionNotEnded);
    assert.ok(acceptedReceipt > 0 && sessionNotEnded > acceptedReceipt && retryForbidden > sessionNotEnded);
    assert.doesNotMatch(player, /closing_motion_required/);
    assert.doesNotMatch(player, /silently call end_amy_session again/i);
});

test('Amy starts its bounded browser-close escape hatch before the provider stop promise', async () => {
    const player = await readSource('../components/AnamPlayer.tsx');
    const amyEnd = player.indexOf('const handleAmyRequestedEnd = () =>');
    const nextHelper = player.indexOf('const currentWorkbenchTranscriptSignature', amyEnd);
    const amyEndSource = player.slice(amyEnd, nextHelper);
    const fallback = amyEndSource.indexOf('requestedCloseFallbackTimer = window.setTimeout');
    const providerStop = amyEndSource.indexOf('activeClient.stopStreaming()');

    assert.ok(fallback > 0 && providerStop > fallback);
    assert.match(amyEndSource, /completeOnce\('user_requested_end'\)/);
    assert.match(amyEndSource, /onCloseRef\.current\?\.\(\)/);
    assert.match(amyEndSource, /}, 1_500\)/);
});

test('public audio loopback is blocked in normal sessions while explicit audio-bridge QA is exempt', async () => {
    const player = await readSource('../components/AnamPlayer.tsx');
    const handlerStart = player.indexOf('const handleInputAudioStreamStarted');
    const handlerEnd = player.indexOf('// Capture live conversation chunks', handlerStart);
    const handler = player.slice(handlerStart, handlerEnd);

    assert.match(handler, /if \(!isAmyCara4 \|\| audioBridge \|\| publicAudioBlocked\) return/);
    assert.match(handler, /assessPublicAudioInputStream\(inputStream\)/);
    assert.match(handler, /assessment\.disposition !== 'block'/);
    assert.match(handler, /anamClient\.muteInputAudio\(\)/);
    assert.match(handler, /setError\(assessment\.message\)/);
    assert.match(handler, /anamClient\.stopStreaming\(\)/);
    assert.match(player, /Microphone access is blocked\. Allow microphone access for this site in your browser, then restart the Amy session\./);
    assert.match(player, /addListener\(AnamEvent\.INPUT_AUDIO_STREAM_STARTED, handleInputAudioStreamStarted\)/);
    assert.match(player, /removeListener\(AnamEvent\.INPUT_AUDIO_STREAM_STARTED, handleInputAudioStreamStarted\)/);
    assert.match(player, /isMounted && !publicAudioBlocked/);
});
