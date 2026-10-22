import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as plannerModel from '../lib/anam/evan-move-planner.ts';

const source = await fs.readFile(new URL('../components/evan/EvanRouteMap.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const jsx = (type, props) => ({ type, props: props ?? {} });
const equalDeps = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
const flush = () => new Promise(resolve => setImmediate(resolve));

// Execute the real component with persistent hook dependencies and fake Leaflet.
// Unlike a source assertion, this catches map teardown on a semantically unchanged rerender.
function createHarness() {
    const slots = [];
    const pendingEffects = [];
    const calls = [];
    let cursor = 0;
    let currentMap = 0;
    const layer = () => ({ addTo: () => undefined });
    const modules = {
        react: {
            useRef: initial => {
                const index = cursor++;
                return slots[index] ??= { current: initial ?? {} };
            },
            useState: initial => {
                const index = cursor++;
                slots[index] ??= { value: initial };
                return [slots[index].value, value => {
                    slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
                }];
            },
            useMemo: (callback, deps) => {
                const index = cursor++;
                if (!slots[index] || !equalDeps(slots[index].deps, deps)) slots[index] = { deps, value: callback() };
                return slots[index].value;
            },
            useEffect: (callback, deps) => {
                const index = cursor++;
                if (!slots[index] || !equalDeps(slots[index].deps, deps)) {
                    pendingEffects.push(() => {
                        slots[index]?.cleanup?.();
                        slots[index] = { deps, cleanup: callback() };
                    });
                }
            },
        },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'react-dom': { createPortal: child => jsx('portal', { children: child }) },
        'lucide-react': new Proxy({}, { get: (_target, name) => String(name) }),
        '@/lib/anam/evan-move-planner': plannerModel,
        leaflet: {
            map: () => {
                const id = ++currentMap;
                calls.push(['map', id]);
                return {
                    setView: (...args) => calls.push(['setView', id, ...args]),
                    fitBounds: (...args) => calls.push(['fitBounds', id, ...args]),
                    invalidateSize: () => calls.push(['invalidateSize', id]),
                    remove: () => calls.push(['remove', id]),
                };
            },
            tileLayer: (...args) => { calls.push(['tileLayer', ...args]); return layer(); },
            control: { zoom: layer },
            polyline: (...args) => { calls.push(['polyline', currentMap, ...args]); return layer(); },
            latLngBounds: value => value,
            divIcon: value => value,
            marker: (...args) => {
                calls.push(['marker', currentMap, ...args]);
                return { addTo: () => ({ bindPopup: popup => calls.push(['popup', currentMap, popup]) }) };
            },
        },
    };
    const exports = {};
    vm.runInNewContext(code, {
        exports,
        require: name => {
            if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected dependency: ${name}`);
            return modules[name];
        },
        window: { setTimeout: () => 1, clearTimeout: () => undefined,
            addEventListener: () => undefined, removeEventListener: () => undefined },
        document: { body: { style: { overflow: '' } } },
    });
    return {
        calls,
        async render(stops) {
            cursor = 0;
            const tree = exports.default({ stops });
            while (pendingEffects.length) pendingEffects.shift()();
            await flush();
            return tree;
        },
        dispose() { slots.forEach(slot => slot?.cleanup?.()); },
    };
}

function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)];
}

const route = () => [
    { city: 'Gilbert', kind: 'Origin', address: '123 N Main St, Gilbert, AZ',
        displayAddress: '123 North Main Street, Gilbert, AZ', precision: 'address',
        coordinates: { latitude: 33.353, longitude: -111.789 } },
    { city: 'Queen Creek', kind: 'Destination' },
];

test('fresh stop objects from unrelated transcript turns preserve Leaflet, tiles and zoom', async () => {
    const harness = createHarness();
    await harness.render(route());
    const initialCalls = harness.calls.length;
    for (let index = 0; index < 8; index++) {
        // Property insertion order and planner-only metadata do not alter the map.
        const stops = route().map(stop => ({ ...Object.fromEntries(Object.entries(stop).reverse()), label: `revision ${index}`, confirmed: index % 2 === 0 }));
        await harness.render(stops);
    }
    assert.equal(harness.calls.length, initialCalls);
    assert.equal(harness.calls.filter(call => call[0] === 'map').length, 1);
    assert.equal(harness.calls.filter(call => call[0] === 'tileLayer').length, 1);
    harness.dispose();
    assert.equal(harness.calls.filter(call => call[0] === 'remove').length, 1);
});

test('a changed same-city address refreshes marker text and the directions link', async () => {
    const harness = createHarness();
    await harness.render(route());
    const changed = route();
    changed[0].address = '456 W Oak St, Gilbert, AZ';
    changed[0].displayAddress = '456 West Oak Street, Gilbert, AZ';
    const tree = await harness.render(changed);
    assert.equal(harness.calls.filter(call => call[0] === 'map').length, 2);
    assert.equal(harness.calls.filter(call => call[0] === 'remove').length, 1);
    assert.match(harness.calls.findLast(call => call[0] === 'marker' && call[2][0] === 33.353)[3].title, /456 West Oak Street/);
    const directions = nodes(tree).find(node => node.type === 'a').props.href;
    assert.match(new URL(directions).searchParams.get('origin'), /456 West Oak Street/);
});

test('geocoded coordinate updates redraw street pins even when address text is unchanged', async () => {
    const harness = createHarness();
    await harness.render(route());
    const changed = route();
    changed[0].coordinates = { latitude: 33.36, longitude: -111.8 };
    await harness.render(changed);
    const marker = harness.calls.findLast(call => call[0] === 'marker' && call[3].title.startsWith('1.'));
    assert.equal(marker[2][0], 33.36);
    assert.equal(marker[2][1], -111.8);
    assert.equal(harness.calls.filter(call => call[0] === 'map').length, 2);
});

test('city corrections and stop reordering update the line, numbering and destinations', async () => {
    const harness = createHarness();
    await harness.render([{ city: 'Mesa', kind: 'Origin' }, { city: 'Phoenix', kind: 'Destination' }]);
    await harness.render([{ city: 'Mesa', kind: 'Origin' }, { city: 'Chandler', kind: 'Destination' }]);
    const tree = await harness.render([{ city: 'Chandler', kind: 'Origin' }, { city: 'Mesa', kind: 'Destination' }]);
    assert.equal(harness.calls.filter(call => call[0] === 'map').length, 3);
    const lastLine = harness.calls.findLast(call => call[0] === 'polyline')[2];
    assert.equal(lastLine[0][0], 33.3062);
    assert.equal(lastLine[1][0], 33.4152);
    const lastMarkers = harness.calls.filter(call => call[0] === 'marker' && call[1] === 3);
    assert.match(lastMarkers[0][3].title, /^1\. Chandler — Origin$/);
    assert.match(lastMarkers[1][3].title, /^2\. Mesa — Destination$/);
    const directions = new URL(nodes(tree).find(node => node.type === 'a').props.href);
    assert.equal(directions.searchParams.get('origin'), 'Chandler, Arizona');
    assert.equal(directions.searchParams.get('destination'), 'Mesa, Arizona');
});

test('stop removal replaces the route with the unmarked overview and no stale directions', async () => {
    const harness = createHarness();
    await harness.render(route());
    const tree = await harness.render([]);
    assert.equal(harness.calls.filter(call => call[0] === 'remove').length, 1);
    assert.equal(harness.calls.filter(call => call[0] === 'marker' && call[1] === 2).length, 0);
    assert.equal(harness.calls.findLast(call => call[0] === 'setView')[3], 9);
    assert.equal(nodes(tree).some(node => node.type === 'a'), false);
    const initialCalls = harness.calls.length;
    await harness.render([]);
    assert.equal(harness.calls.length, initialCalls);
});

test('full-screen portal changes still remount the map while route data stays current', async () => {
    const harness = createHarness();
    let tree = await harness.render(route());
    nodes(tree).find(node => node.props['data-testid'] === 'evan-route-map-fullscreen').props.onClick();
    tree = await harness.render(route());
    assert.equal(tree.type, 'portal');
    assert.equal(harness.calls.filter(call => call[0] === 'map').length, 2);
    assert.equal(harness.calls.filter(call => call[0] === 'remove').length, 1);
    nodes(tree).find(node => node.props['data-testid'] === 'evan-route-map-fullscreen').props.onClick();
    tree = await harness.render(route());
    assert.notEqual(tree.type, 'portal');
    assert.equal(harness.calls.filter(call => call[0] === 'map').length, 3);
    assert.equal(harness.calls.filter(call => call[0] === 'remove').length, 2);
});
