import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');

test('automatic route presentation is created only for enabled Evan sessions', () => {
    assert.match(player, /const evanPlannerEnabled = personaId === EVAN_PERSONA_ID\s*&& process\.env\.NEXT_PUBLIC_EVAN_MOVE_PLANNER_ENABLED !== 'false'/);
    assert.match(player, /const evanPlannerAutoOpen = evanPlannerEnabled \? createEvanPlannerAutoOpen\(/);
    const creation = player.slice(player.indexOf('const evanPlannerAutoOpen ='), player.indexOf('evanPlannerAutoOpenRef.current = evanPlannerAutoOpen'));
    assert.match(creation, /setEvanPlannerView\('route'\)/);
    assert.match(creation, /setEvanPlannerOpen\(true\)/);
    assert.match(creation, /snapshotEvanPlannerTurns\(\)/);
    assert.doesNotMatch(creation, /\.talk\(|addContext\(|fetch\(|geocode|setEvanAddressStops|setAmyWorkbench/);
});

test('only active sessions feed provider message events to automatic route presentation', () => {
    assert.match(player, /if \(evanPlannerEnabled && isMounted && !closeHandled && !requestedCloseReason\) \{\s*evanPlannerAutoOpen\?\.observeMessage\(messageEvent\);/);
    assert.ok((player.match(/evanPlannerAutoOpen\?\.dispose\(\)/g) ?? []).length >= 3,
        'connection close, farewell, and unmount must disable automatic opening');
    assert.match(player, /if \(evanPlannerAutoOpenRef\.current === evanPlannerAutoOpen\) evanPlannerAutoOpenRef\.current = null/);
});

test('manual and tool opening consume automatic presentation; dismissal prevents reopening', () => {
    const tool = player.slice(player.indexOf("registerToolCallHandler('show_move_planner'"), player.indexOf('const memoryPolicyContext'));
    assert.match(tool, /evanPlannerAutoOpen\?\.markOpened\(\);\s*setEvanPlannerView\(view\);\s*setEvanPlannerOpen\(true\)/);
    assert.match(player, /onClick=\{\(\) => \{\s*evanPlannerAutoOpenRef\.current\?\.markOpened\(\);\s*setEvanPlannerOpen\(true\)/);
    assert.match(player, /onClose=\{\(\) => \{\s*evanPlannerAutoOpenRef\.current\?\.dismiss\(\);\s*setEvanPlannerOpen\(false\)/);
    // Explicit requests remain independent of the one-time automatic policy.
    assert.doesNotMatch(tool, /observeMessage\(|observeAgentText\(/);
});

test('route fallback uses the current plan only after a completed user turn in an active Evan session', () => {
    const fallback = player.slice(player.indexOf("if (messageEvent.endOfSpeech) {\n                        let amyFarewellRecovery"), player.indexOf('const previousEvanTurn ='));
    assert.match(fallback, /recordTurn\(messageEvent\.role, currentMessageRef\.current\)/);
    assert.match(fallback, /if \(transcriptRole\(messageEvent\.role\) === 'user'\)/);
    assert.match(fallback, /if \(evanPlannerEnabled && isMounted && !closeHandled && !requestedCloseReason\)/);
    assert.match(fallback, /observeRouteStops\(buildEvanMovePlan\(/);
    assert.match(fallback, /transcriptRef\.current\.slice\(-120\)/);
    assert.match(fallback, /evanAddressStopsRef\.current/);
    assert.doesNotMatch(fallback, /\.talk\(|addContext\(|fetch\(|setAmyWorkbench/);
});
