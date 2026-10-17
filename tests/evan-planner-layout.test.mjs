import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as plannerModel from '../lib/anam/evan-move-planner.ts';

const jsx = (type, props) => ({ type, props: props ?? {} });
const mapStub = () => null;
const plannerSource = await fs.readFile(new URL('../components/evan/EvanMovePlanner.tsx', import.meta.url), 'utf8');
const mapSource = await fs.readFile(new URL('../components/evan/EvanRouteMap.tsx', import.meta.url), 'utf8');

// Layout contracts complement the browser harness's actual viewport measurements.
// No effects or network requests run in this small component-render adapter.
function render(source, props, expanded = false) {
    let stateIndex = 0;
    const exports = {};
    const modules = {
        react: {
            useEffect: () => undefined,
            useMemo: fn => fn(),
            useRef: () => ({ current: null }),
            useState: initial => [stateIndex++ === 2 && expanded ? true : initial, () => undefined],
        },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'react-dom': { createPortal: child => jsx('portal', { children: child }) },
        'framer-motion': { AnimatePresence: 'AnimatePresence', motion: new Proxy({}, { get: (_target, name) => name }) },
        'next/image': { __esModule: true, default: 'img' },
        'lucide-react': new Proxy({}, { get: (_target, name) => name }),
        '@/lib/anam/evan-move-planner': plannerModel,
        '@/components/evan/EvanRouteMap': { __esModule: true, default: mapStub },
    };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText, {
        exports, document: { body: {} },
        require: name => {
            assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
            return modules[name];
        },
    });
    return exports.default(props);
}

function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)];
}
const byTestId = (tree, id) => nodes(tree).find(node => node.props['data-testid'] === id);
const stops = [{ city: 'Gilbert', kind: 'Origin' }, { city: 'Mesa', kind: 'Destination' }];
const plannerProps = { isOpen: true, turns: [], addressStops: stops, requestedView: 'route', onClose: () => undefined };

test('planner gives remaining height to a bounded scroll region without overlaying its footer', () => {
    const tree = render(plannerSource, plannerProps);
    const content = byTestId(tree, 'evan-planner-content');
    assert.match(content.props.className, /\bmin-h-0\b/);
    assert.match(content.props.className, /\bflex-1\b/);
    assert.match(content.props.className, /\boverflow-y-auto\b/);
    assert.match(content.props.className, /\boverscroll-contain\b/);
    const footer = byTestId(tree, 'evan-planner-footer');
    assert.match(footer.props.className, /\bflex-none\b/);
    assert.doesNotMatch(footer.props.className, /\b(?:absolute|fixed|sticky)\b/);
    assert.equal(nodes(content).includes(footer), false);
    assert.ok(nodes(content).some(node => node.type === mapStub));
});

test('compact route heading and tabs retain usable controls and all route details', () => {
    const tree = render(plannerSource, plannerProps);
    const view = byTestId(tree, 'evan-planner-route-view');
    const heading = nodes(view).find(node => node.type === 'h3');
    assert.match(heading.props.className, /\btext-xl\b/);
    const tabNav = nodes(tree).find(node => node.type === 'nav');
    const tabs = nodes(tabNav).filter(node => node.type === 'button');
    assert.equal(tabs.length, 4);
    tabs.forEach(tab => assert.match(tab.props.className, /\bmin-h-11\b/));
    assert.ok(nodes(view).some(node => node.props.children === 'Gilbert'));
    assert.ok(nodes(view).some(node => node.props.children === 'Mesa'));
    assert.ok(nodes(tree).some(node => node.props['aria-label'] === 'Close Move Planner'));
});

test('inline map height follows the dynamic viewport instead of a fixed desktop canvas', () => {
    for (const route of [[], stops]) {
        const tree = render(mapSource, { stops: route });
        const canvas = byTestId(tree, 'evan-route-map-canvas');
        assert.match(canvas.props.className, /h-\[clamp\(220px,calc\(100dvh-400px\),460px\)\]/);
        assert.doesNotMatch(canvas.props.className, /sm:h-|min-h-\[420px\]/);
        assert.match(byTestId(tree, 'evan-route-map-header').props.className, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
        assert.ok(byTestId(tree, 'evan-route-map-fullscreen'));
        assert.match(byTestId(tree, 'evan-route-map-controls').props.className, /\bflex-wrap\b/);
    }
});

test('full-screen map flexes into short windows without pushing controls below the viewport', () => {
    const tree = render(mapSource, { stops }, true);
    assert.equal(tree.type, 'portal');
    const panel = byTestId(tree, 'evan-route-map');
    assert.equal(panel.props.role, 'dialog');
    assert.match(panel.props.className, /h-\[100dvh\]/);
    const canvas = byTestId(tree, 'evan-route-map-canvas');
    assert.match(canvas.props.className, /\bh-full\b/);
    assert.match(canvas.props.className, /\bmin-h-0\b/);
    assert.doesNotMatch(canvas.props.className, /min-h-\[\d+px\]/);
    assert.match(byTestId(tree, 'evan-route-map-controls').props.className, /\bflex-none\b/);
    assert.ok(nodes(tree).some(node => node.type === 'a' && node.props.href.includes('google.com/maps')));
});
