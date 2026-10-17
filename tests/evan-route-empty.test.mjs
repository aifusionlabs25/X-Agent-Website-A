import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as plannerModel from '../lib/anam/evan-move-planner.ts';

const mapSource = await fs.readFile(new URL('../components/evan/EvanRouteMap.tsx', import.meta.url), 'utf8');
const plannerSource = await fs.readFile(new URL('../components/evan/EvanMovePlanner.tsx', import.meta.url), 'utf8');
const jsx = (type, props) => ({ type, props: props ?? {} });
const RouteMapStub = () => null;

// Execute the components and Leaflet lifecycle with small in-memory adapters.
// This checks rendering decisions and map operations, not actual tile delivery.
function componentHarness(source, { state = {}, importFailure = false } = {}) {
    const effects = [];
    const stateChanges = [];
    const mapCalls = [];
    let stateIndex = 0;
    const fakeMap = {
        setView: (...args) => mapCalls.push(['setView', ...args]),
        fitBounds: (...args) => mapCalls.push(['fitBounds', ...args]),
        invalidateSize: () => mapCalls.push(['invalidateSize']),
        remove: () => mapCalls.push(['remove']),
    };
    const layer = () => ({ addTo: () => undefined });
    const leaflet = {
        map: (...args) => { mapCalls.push(['map', ...args]); return fakeMap; },
        tileLayer: (...args) => { mapCalls.push(['tileLayer', ...args]); return layer(); },
        control: { zoom: layer },
        polyline: (...args) => { mapCalls.push(['polyline', ...args]); return layer(); },
        latLngBounds: value => value,
        divIcon: value => value,
        marker: (...args) => {
            mapCalls.push(['marker', ...args]);
            return { addTo: () => ({ bindPopup: () => undefined }) };
        },
    };
    const modules = {
        react: {
            useEffect: callback => effects.push(callback),
            useMemo: callback => callback(),
            useRef: () => ({ current: {} }),
            useState: initial => {
                const index = stateIndex++;
                return [Object.hasOwn(state, index) ? state[index] : initial, value => stateChanges.push({ index, value })];
            },
        },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'react-dom': { createPortal: child => jsx('portal', { children: child }) },
        'lucide-react': new Proxy({}, { get: (_target, name) => String(name) }),
        'framer-motion': { AnimatePresence: 'AnimatePresence', motion: new Proxy({}, { get: (_target, name) => String(name) }) },
        'next/image': { __esModule: true, default: 'img' },
        '@/lib/anam/evan-move-planner': plannerModel,
        '@/components/evan/EvanRouteMap': { __esModule: true, default: RouteMapStub },
        leaflet,
    };
    const code = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
        exports,
        require: name => {
            if (name === 'leaflet' && importFailure) throw new Error('Mock import failure');
            if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected dependency: ${name}`);
            return modules[name];
        },
        window: { setTimeout: () => 1, clearTimeout: () => undefined,
            addEventListener: () => undefined, removeEventListener: () => undefined },
        document: { body: { style: { overflow: '' } } },
    });
    return { render: props => exports.default(props), effects, mapCalls, stateChanges };
}

function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)];
}

function textOf(tree) {
    if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
    if (Array.isArray(tree)) return tree.map(textOf).join(' ');
    return tree?.props ? textOf(tree.props.children) : '';
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('empty Route tab renders the map before any user move details, without a duplicate empty card', () => {
    const harness = componentHarness(plannerSource);
    const tree = harness.render({ isOpen: true, turns: [], requestedView: 'route', onClose: () => undefined });
    const maps = nodes(tree).filter(node => node.type === RouteMapStub);
    assert.equal(maps.length, 1);
    assert.deepEqual(maps[0].props.stops, []);
    assert.equal(nodes(tree).some(node => typeof node.type === 'function' && node.type.name === 'EmptyState'), false);
    assert.match(textOf(tree), /Tell Evan your pickup and destination/);
});

test('the other three planner tabs retain their listening empty states', () => {
    for (const view of ['brief', 'inventory', 'readiness']) {
        const harness = componentHarness(plannerSource);
        const tree = harness.render({ isOpen: true, turns: [], requestedView: view, onClose: () => undefined });
        assert.equal(nodes(tree).some(node => node.type === RouteMapStub), false);
        assert.equal(nodes(tree).some(node => typeof node.type === 'function' && node.type.name === 'EmptyState'), true);
    }
});

test('empty map is an explicitly unmarked Phoenix overview with no directions link or fabricated pins', async () => {
    const harness = componentHarness(mapSource);
    const tree = harness.render({ stops: [] });
    assert.match(textOf(tree), /Waiting for pickup and destination/);
    assert.match(textOf(tree), /Phoenix-area overview/);
    assert.match(textOf(tree), /not your current location/);
    assert.equal(nodes(tree).some(node => node.type === 'a'), false);
    assert.equal(nodes(tree).some(node => node.props['data-testid'] === 'evan-route-map-fullscreen'), true);
    const cleanup = harness.effects[1]();
    await flush();
    const center = harness.mapCalls.find(call => call[0] === 'setView');
    assert.equal(center[1][0], 33.4484);
    assert.equal(center[1][1], -112.0740);
    assert.equal(center[2], 9);
    assert.equal(harness.mapCalls.some(call => ['marker', 'polyline', 'fitBounds'].includes(call[0])), false);
    assert.ok(harness.mapCalls.some(call => call[0] === 'tileLayer' && call[1].includes('tile.openstreetmap.org')));
    cleanup();
    assert.ok(harness.mapCalls.some(call => call[0] === 'remove'));
});

test('one and multiple captured locations retain their markers, bounds and Google Maps link', async () => {
    for (const stops of [[{ city: 'Mesa', kind: 'Origin' }],
        [{ city: 'Mesa', kind: 'Origin' }, { city: 'Phoenix', kind: 'Destination' }]]) {
        const harness = componentHarness(mapSource);
        const tree = harness.render({ stops });
        assert.doesNotMatch(textOf(tree), /Waiting for pickup and destination/);
        assert.ok(nodes(tree).some(node => node.type === 'a' && node.props.href.startsWith('https://www.google.com/maps/')));
        harness.effects[1]();
        await flush();
        assert.equal(harness.mapCalls.filter(call => call[0] === 'marker').length, stops.length);
        assert.equal(harness.mapCalls.filter(call => call[0] === 'polyline').length, stops.length > 1 ? 1 : 0);
        assert.equal(harness.mapCalls.filter(call => call[0] === 'fitBounds').length, stops.length > 1 ? 1 : 0);
    }
});

test('the unmarked overview can use the existing full-screen map presentation', async () => {
    const harness = componentHarness(mapSource, { state: { 2: true } });
    const tree = harness.render({ stops: [] });
    assert.equal(tree.type, 'portal');
    assert.ok(nodes(tree).some(node => node.props.role === 'dialog' && node.props['aria-modal'] === true));
    harness.effects[1]();
    await flush();
    assert.ok(harness.mapCalls.some(call => call[0] === 'setView' && call[2] === 9));
});

test('a map import failure is caught without creating invented route details', async () => {
    const harness = componentHarness(mapSource, { importFailure: true });
    harness.render({ stops: [] });
    harness.effects[1]();
    await flush();
    assert.ok(harness.stateChanges.some(change => change.index === 1 && change.value === true));
    assert.equal(harness.mapCalls.some(call => call[0] === 'map'), false);
    const failed = componentHarness(mapSource, { state: { 1: true } });
    assert.match(textOf(failed.render({ stops: [] })), /map is temporarily unavailable.*keep planning with Evan/);
});

test('closing before the lazy map import resolves does not mount an abandoned map', async () => {
    const harness = componentHarness(mapSource);
    harness.render({ stops: [] });
    const cleanup = harness.effects[1]();
    cleanup();
    await flush();
    assert.equal(harness.mapCalls.length, 0);
});
