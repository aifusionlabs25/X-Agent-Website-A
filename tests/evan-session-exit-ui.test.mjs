import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as plannerModel from '../lib/anam/evan-move-planner.ts';

const jsx = (type, props) => ({ type, props: props ?? {} });
const exitSource = await fs.readFile(new URL('../components/evan/EvanSessionExit.tsx', import.meta.url), 'utf8');
const plannerSource = await fs.readFile(new URL('../components/evan/EvanMovePlanner.tsx', import.meta.url), 'utf8');
const playerSource = await fs.readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');

function loadComponent(source, extraModules = {}) {
    const exports = {};
    const modules = {
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': new Proxy({}, { get: (_target, name) => name }),
        ...extraModules,
    };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText, {
        exports,
        require: name => {
            assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
            return modules[name];
        },
    });
    return exports.default;
}

const Exit = loadComponent(exitSource);
const Planner = loadComponent(plannerSource, {
    react: {
        useEffect: () => undefined,
        useMemo: fn => fn(),
        useState: initial => [initial, () => undefined],
    },
    'framer-motion': { AnimatePresence: 'AnimatePresence', motion: new Proxy({}, { get: (_target, name) => name }) },
    'next/image': { __esModule: true, default: 'img' },
    '@/lib/anam/evan-move-planner': plannerModel,
    '@/components/evan/EvanRouteMap': { __esModule: true, default: 'EvanRouteMap' },
    '@/components/evan/EvanSessionExit': { __esModule: true, default: Exit },
});

function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)];
}

test('picture-in-picture exit reuses the supplied normal exit callback', () => {
    let exits = 0;
    const onExit = () => exits++;
    const button = Exit({ placement: 'picture-in-picture', onExit });
    assert.equal(button.type, 'button');
    assert.equal(button.props.type, 'button');
    assert.equal(button.props.onClick, onExit);
    button.props.onClick();
    assert.equal(exits, 1);
    assert.equal(button.props['data-testid'], 'evan-pip-exit');
    assert.equal(button.props['aria-label'], 'Exit session with Evan');
    assert.match(button.props.className, /hidden lg:inline-flex/);
    assert.match(button.props.className, /min-h-12/);
    assert.match(button.props.className, /focus-visible:outline/);
});

test('mobile planner has a responsive exit with the same accessible behavior', () => {
    const button = Exit({ placement: 'planner', onExit: () => undefined });
    assert.equal(button.props['data-testid'], 'evan-planner-mobile-exit');
    assert.match(button.props.className, /inline-flex w-full lg:hidden/);
    assert.equal(button.props['aria-label'], 'Exit session with Evan');
});

test('exit is disabled during finalization and absent without a session exit handler', () => {
    const button = Exit({ placement: 'planner', onExit: () => undefined, disabled: true });
    assert.equal(button.props.disabled, true);
    assert.ok(button.props.children.includes('Ending session…'));
    assert.equal(Exit({ placement: 'planner' }), null);
});

test('mobile footer keeps planner dismissal separate from exiting the session', () => {
    let dismissed = 0;
    let exited = 0;
    const onClose = () => dismissed++;
    const onExitSession = () => exited++;
    const tree = Planner({ isOpen: true, turns: [], onClose, onExitSession, isFinalizing: true });
    const footer = nodes(tree).find(node => node.props['data-testid'] === 'evan-planner-footer');
    const exit = nodes(footer).find(node => node.type === Exit);
    assert.equal(exit.props.placement, 'planner');
    assert.equal(exit.props.onExit, onExitSession);
    assert.equal(exit.props.disabled, true);
    exit.props.onExit();
    assert.equal(exited, 1);
    assert.equal(dismissed, 0);
    const dismiss = nodes(tree).find(node => node.props['aria-label'] === 'Close Move Planner');
    dismiss.props.onClick();
    assert.equal(dismissed, 1);
    assert.equal(exited, 1);
});

test('planner-only uses do not create an inert footer exit', () => {
    const tree = Planner({ isOpen: true, turns: [], onClose: () => undefined });
    assert.equal(nodes(tree).some(node => node.type === Exit), false);
});

test('player places Evan-only exit after video and forwards the original session callback', () => {
    const video = playerSource.indexOf('id="persona-video"');
    const exit = playerSource.indexOf('<EvanSessionExit placement="picture-in-picture"');
    const planner = playerSource.indexOf('<EvanMovePlanner', video);
    assert.ok(video > 0 && exit > video && planner > exit);
    assert.match(playerSource.slice(video, exit), /evanPlannerEnabled && evanPlannerOpen/);
    assert.match(playerSource.slice(exit, exit + 160), /onExit=\{onClose\} disabled=\{isFinalizing\}/);
    assert.match(playerSource.slice(planner, planner + 400), /onExitSession=\{onClose\}/);
    assert.match(playerSource.slice(planner, planner + 400), /isFinalizing=\{isFinalizing\}/);
    assert.doesNotMatch(exitSource, /stopStreaming|fetch\(|sessionStorage|dispatchEvent/);
});
