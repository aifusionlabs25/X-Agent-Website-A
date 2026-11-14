import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const jsx = (type, props) => ({ type, props: props ?? {} });
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join(' ') : value && typeof value === 'object' ? text(value.props?.children) : String(value ?? '');
function load(file, modules, globals = {}) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const exports = {};
    vm.runInNewContext(code, { exports, ...globals, require(name) {
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`);
        return modules[name];
    } });
    return exports.default;
}
function pageHarness(payload, ok = true) {
    const state = [];
    let cursor = 0;
    const calls = [];
    const Page = load('../app/demo/evan/extended/page.tsx', {
        react: { useState(initial) { const index = cursor++; state[index] ??= { value: initial }; return [state[index].value, next => { state[index].value = next; }]; } },
        'next/link': 'link',
        '@/components/evan/EvanExtendedDemoRoom': 'private-room',
    }, { fetch: async (url, options) => { calls.push({ url, options }); return { ok, json: async () => payload }; } });
    return { calls, render() { cursor = 0; return Page(); } };
}

test('protected page starts at code entry and keeps public navigation explicitly three minutes', () => {
    const harness = pageHarness({});
    const tree = harness.render();
    assert.equal(harness.calls.length, 0);
    assert.equal(nodes(tree).filter(n => n.type === 'private-room').length, 0);
    const back = nodes(tree).find(n => n.type === 'link');
    assert.equal(back.props.href, '/demo/evan');
    assert.match(text(back), /3-minute public demo/);
});

for (const [name, payload, ok] of [['denied', { error: 'Invalid code' }, false], ['invalid success', { mode: 'public', maxSeconds: 180 }, true]]) {
    test(`private entry rejects ${name} without mounting the room`, async () => {
        const harness = pageHarness(payload, ok);
        await nodes(harness.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
        const tree = harness.render();
        assert.equal(nodes(tree).filter(n => n.type === 'private-room').length, 0);
        assert.doesNotMatch(text(tree), /Continue to private Evan/);
    });
}

test('successful code unlock stays on protected page; explicit continue mounts only the private room', async () => {
    const harness = pageHarness({ mode: 'extended', maxSeconds: 1800 });
    let tree = harness.render();
    nodes(tree).find(n => n.type === 'input').props.onChange({ target: { value: 'fictional-test-code' } });
    tree = harness.render();
    await nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    tree = harness.render();
    const proceed = nodes(tree).find(n => n.type === 'button' && /Continue to private Evan/.test(text(n)));
    assert.ok(proceed);
    assert.equal(proceed.props.href, undefined);
    assert.equal(harness.calls[0].url, '/api/anam/evan/demo-access');
    assert.equal(nodes(tree).some(n => n.type === 'private-room'), false);
    proceed.props.onClick();
    assert.equal(harness.render().type, 'private-room');
});

test('private room explicitly pins Evan and passes private intent to check-in and player', () => {
    const id = '6097c73e-b6ef-48c5-94c7-9a95d4863b99';
    const Room = load('../components/evan/EvanExtendedDemoRoom.tsx', {
        'next/image': 'image', 'next/link': 'link', 'next/navigation': { useRouter: () => ({ push() {} }) },
        'lucide-react': { LogOut: 'exit-icon' }, '@/components/AnamPlayer': 'player',
        '@/components/evan/EvanContactGate': 'gate', '@/lib/anam/persona-ids': { EVAN_PERSONA_ID: id },
    });
    const tree = Room();
    assert.equal(tree.type, 'gate');
    assert.equal(tree.props.evanDemoMode, 'extended');
    const player = nodes(tree).find(n => n.type === 'player');
    assert.equal(player.props.personaId, id);
    assert.equal(player.props.evanDemoMode, 'extended');
});

test('canonical demo page cannot opt into private mode through query parameters', () => {
    const source = readFileSync(new URL('../app/demo/[slug]/page.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /evanDemoMode|extended\/token/);
    const player = readFileSync(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    assert.match(player, /evanDemoMode = 'public'/);
    assert.match(player, /personaId === EVAN_PERSONA_ID && evanDemoMode === 'extended'/);
    assert.match(player, /\? '\/api\/anam\/evan\/extended\/token' : '\/api\/anam-token'/);
});
