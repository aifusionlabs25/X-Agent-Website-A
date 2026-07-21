import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
    buildEvanMovePlan,
    EVAN_MOVE_PLANNER_BOUNDARY,
} from '../lib/anam/evan-move-planner.ts';

test('Evan Move Planner starts empty without inventing move details', () => {
    const model = buildEvanMovePlan([]);
    assert.equal(model.status, 'listening');
    assert.equal(model.readiness, 0);
    assert.deepEqual(model.stops, []);
    assert.deepEqual(model.highlights, []);
});

test('Evan Move Planner builds a multi-stop senior move brief from current-session facts', () => {
    const model = buildEvanMovePlan([
        {
            role: 'user',
            content: 'We need to move my elderly dad out of his house in Mesa, pick up items from a storage unit in Chandler, and move everything into a home in Surprise in less than 10 days.',
        },
        {
            role: 'user',
            content: 'We need full packing for antique furniture, artwork, and a grandfather clock. The Mesa house has a narrow driveway and stairs, and my dad uses a walker, so we need to minimize a chaotic day.',
        },
    ]);

    assert.equal(model.status, 'building');
    assert.deepEqual(model.stops, [
        { city: 'Mesa', kind: 'Origin' },
        { city: 'Chandler', kind: 'Additional stop' },
        { city: 'Surprise', kind: 'Destination' },
    ]);
    assert.match(model.timing, /less than 10 days/i);
    assert.ok(model.services.includes('Full packing'));
    assert.ok(model.services.includes('Storage stop'));
    assert.ok(model.specialtyItems.includes('Antiques'));
    assert.ok(model.specialtyItems.includes('Grandfather clock'));
    assert.ok(model.accessFactors.includes('Narrow driveway'));
    assert.ok(model.accessFactors.includes('Stairs'));
    assert.ok(model.carePriorities.includes('Mobility considerations'));
    assert.ok(model.readiness > 50);
});

test('Evan Move Planner keeps uncertainty visible and excludes spoken email from the brief', () => {
    const model = buildEvanMovePlan([
        { role: 'user', content: 'I am moving from Mesa to Phoenix next month.' },
        { role: 'user', content: 'I think there may be stairs, but I have to check. My email is rvicks@gmail.com.' },
    ]);
    const renderedSignals = JSON.stringify(model);

    assert.equal(model.stops[0]?.kind, 'Origin');
    assert.equal(model.stops[1]?.kind, 'Destination');
    assert.ok(model.uncertainties.some((item) => /stairs/i.test(item)));
    assert.doesNotMatch(renderedSignals, /rvicks|gmail|@/i);
});

test('Move Planner boundary explicitly prevents quote and booking assumptions', () => {
    assert.match(EVAN_MOVE_PLANNER_BOUNDARY, /working view only/i);
    assert.match(EVAN_MOVE_PLANNER_BOUNDARY, /pricing/i);
    assert.match(EVAN_MOVE_PLANNER_BOUNDARY, /appointment/i);
});

test('Anam player exposes the Move Planner only for Evan sessions', async () => {
    const player = await fs.readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const planner = await fs.readFile(new URL('../components/evan/EvanMovePlanner.tsx', import.meta.url), 'utf8');
    const prompt = await fs.readFile(new URL('../config/anam/evan/EVAN_ANAM_SYSTEM_PROMPT_2026-07-16.md', import.meta.url), 'utf8');
    const updater = await fs.readFile(new URL('../scripts/anam/update-evan-persona.mjs', import.meta.url), 'utf8');
    const tool = JSON.parse(await fs.readFile(new URL('../config/anam/evan-move-planner-client-tool.json', import.meta.url), 'utf8'));

    assert.match(player, /personaId === EVAN_PERSONA_ID/);
    assert.match(player, /NEXT_PUBLIC_EVAN_MOVE_PLANNER_ENABLED/);
    assert.match(player, /Live Move Planner/);
    assert.match(player, /<EvanMovePlanner/);
    assert.match(planner, /No quote or booking created/);
    assert.match(planner, /data-testid="evan-move-planner"/);
    assert.match(player, /registerToolCallHandler\('show_move_planner'/);
    assert.match(prompt, /call `show_move_planner` silently/i);
    assert.match(prompt, /not a quote, estimate, booking, confirmed route/i);
    assert.equal(tool.name, 'show_move_planner');
    assert.deepEqual(tool.config.parameters.properties.view.enum, ['brief', 'route', 'inventory', 'readiness']);
    assert.match(updater, /movePlannerToolDefinition/);
});

