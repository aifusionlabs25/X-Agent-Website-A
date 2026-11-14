import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../components/evan/EvanContactGate.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const jsx = (type, props) => ({ type, props: props ?? {} });
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (payload, ok = true) => ({ ok, json: async () => payload });

// Run the real component and its effects without a browser, network or email.
function createHarness(props = {}) {
    const slots = [];
    const effects = [];
    const calls = [];
    let cursor = 0;
    let stateWrites = 0;
    let resolvePolicy;
    let rejectPolicy;
    const policy = new Promise((resolve, reject) => { resolvePolicy = resolve; rejectPolicy = reject; });
    const modules = {
        react: {
            useState(initial) {
                const index = cursor++;
                slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
                return [slots[index].value, value => {
                    stateWrites++;
                    slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
                }];
            },
            useEffect(callback, deps) {
                const index = cursor++;
                if (!slots[index] || !deps.every((value, at) => Object.is(value, slots[index].deps[at]))) {
                    effects.push(() => {
                        slots[index]?.cleanup?.();
                        slots[index] = { deps, cleanup: callback() };
                    });
                }
            },
        },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'next/image': 'image',
        'next/link': 'link',
        'lucide-react': new Proxy({}, { get: (_target, name) => String(name) }),
        '@/lib/anam/evan-local-test-mode': { isEvanLocalTestMode: () => false },
        '@/components/evan/EvanPlannerContactContext': { EvanPlannerContactContext: { Provider: 'contact-provider' } },
    };
    const exports = {};
    vm.runInNewContext(code, {
        exports,
        require(name) {
            assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
            return modules[name];
        },
        fetch(url, options = {}) {
            calls.push({ url, ...options });
            if (url === '/api/anam/evan/demo-access') return policy;
            assert.equal(url, '/api/anam/evan/access');
            assert.ok(['DELETE', 'POST'].includes(options.method));
            return Promise.resolve(response({ authenticated: true }));
        },
    });
    const render = () => {
        cursor = 0;
        const tree = exports.default({ children: 'authorized-children', ...props });
        while (effects.length) effects.shift()();
        return tree;
    };
    return {
        calls, render, resolvePolicy, rejectPolicy,
        async mount() { render(); await flush(); return render(); },
        async settle() { await flush(); return render(); },
        get posts() { return calls.filter(call => call.method === 'POST'); },
        get stateWrites() { return stateWrites; },
        dispose() { slots.forEach(slot => slot?.cleanup?.()); },
    };
}

function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
    if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
    if (Array.isArray(tree)) return tree.map(text).join(' ');
    return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
const form = tree => nodes(tree).find(node => node.type === 'form');
const emailButton = tree => nodes(tree).find(node => node.type === 'button' && node.props.type === 'submit');
const guestButton = tree => nodes(tree).find(node => node.type === 'button' && text(node).includes('Continue without email'));
const submit = tree => form(tree).props.onSubmit({ preventDefault() {} });
function assertUnknownPolicy(tree) {
    assert.equal(emailButton(tree).props.disabled, true);
    assert.equal(guestButton(tree).props.disabled, false);
    assert.doesNotMatch(text(tree), /Email my recap|for a written recap|send one post-call summary to this address|we can use it for one post-call recap|all recap and team emails go to/);
}

test('loading policy is neutral, leaves guest entry usable, and guards direct email submits', async () => {
    const harness = createHarness();
    let tree = await harness.mount();
    assertUnknownPolicy(tree);
    assert.match(text(tree), /Checking recap options/);
    await submit(tree);
    assert.equal(harness.posts.length, 0, 'disabled UI is also enforced in the request handler');
    tree = harness.render();
    assert.match(text(tree), /Please wait for recap options to load/);
    guestButton(tree).props.onClick();
    tree = await harness.settle();
    assert.equal(tree.type, 'contact-provider');
    assert.equal(tree.props.value, undefined);
    assert.deepEqual(JSON.parse(harness.posts[0].body), { guest: true });
    harness.dispose();
});

for (const [name, result] of [
    ['HTTP failure with a misleading false policy', response({ aiflDemoRecaps: false }, false)],
    ['missing routing field', response({ mode: 'public' })],
    ['null payload', response(null)],
    ['string instead of boolean', response({ aiflDemoRecaps: 'false' })],
    ['invalid JSON', { ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } }],
    ['network failure', null],
]) {
    test(`${name} fails closed for email while guest entry remains available`, async () => {
        const harness = createHarness();
        await harness.mount();
        if (result) harness.resolvePolicy(result);
        else harness.rejectPolicy(new Error('Network unavailable'));
        let tree = await harness.settle();
        assertUnknownPolicy(tree);
        assert.match(text(tree), /Recap options could not be loaded/);
        assert.match(text(tree), /refresh this page to try again/);
        await submit(tree);
        assert.equal(harness.posts.length, 0);
        tree = harness.render();
        guestButton(tree).props.onClick();
        tree = await harness.settle();
        assert.equal(tree.type, 'contact-provider');
        assert.deepEqual(JSON.parse(harness.posts[0].body), { guest: true });
        harness.dispose();
    });
}

for (const aiflDemoRecaps of [true, false]) {
    test(`an explicit ${aiflDemoRecaps} policy preserves the verified disclosure and email flow`, async () => {
        const harness = createHarness();
        assertUnknownPolicy(await harness.mount());
        harness.resolvePolicy(response({ mode: 'public', aiflDemoRecaps }));
        let tree = await harness.settle();
        assert.equal(emailButton(tree).props.disabled, false);
        if (aiflDemoRecaps) {
            assert.match(text(tree), /Demo mode: all recap and team emails go to AI Fusion Labs/);
            assert.match(text(emailButton(tree)), /Continue with demo recap/);
            assert.doesNotMatch(text(tree), /send one post-call summary to this address|Email my recap/);
        } else {
            assert.match(text(tree), /send one post-call summary to this address/);
            assert.match(text(emailButton(tree)), /Email my recap and continue/);
            assert.doesNotMatch(text(tree), /all recap and team emails go to AI Fusion Labs/);
        }
        const inputs = nodes(tree).filter(node => node.type === 'input');
        inputs[0].props.onChange({ target: { value: '  Test Visitor  ' } });
        inputs[1].props.onChange({ target: { value: '  test@example.test  ' } });
        tree = harness.render();
        await submit(tree);
        tree = harness.render();
        assert.equal(harness.posts.length, 1);
        assert.deepEqual(JSON.parse(harness.posts[0].body), {
            displayName: '  Test Visitor  ', email: '  test@example.test  ', followUpConsent: true,
        });
        assert.equal(tree.type, 'contact-provider');
        assert.deepEqual(JSON.parse(JSON.stringify(tree.props.value)), {
            displayName: 'Test Visitor', email: 'test@example.test',
        });
        harness.dispose();
    });
}

test('late policy responses cannot update an unmounted gate', async () => {
    const harness = createHarness();
    await harness.mount();
    harness.dispose();
    const writesBeforeResponse = harness.stateWrites;
    harness.resolvePolicy(response({ mode: 'extended', aiflDemoRecaps: true }));
    await flush();
    assert.equal(harness.stateWrites, writesBeforeResponse);
});

for (const payload of [
    { mode: 'public', maxSeconds: 180, extendedAccess: true, aiflDemoRecaps: true },
    { mode: 'extended', maxSeconds: 1800, extendedAccess: true, aiflDemoRecaps: true },
]) {
    test(`public check-in stays three minutes despite cookie status ${payload.mode}`, async () => {
        const harness = createHarness();
        assert.match(text(await harness.mount()), /Public demo.*up to 3 minutes/);
        harness.resolvePolicy(response(payload));
        const tree = await harness.settle();
        assert.match(text(tree), /Public demo.*up to 3 minutes/);
        assert.doesNotMatch(text(tree), /Private demo.*30 minutes|Switch back to the public demo/);
        assert.equal(harness.calls.some(call => call.url === '/api/anam/evan/demo-access' && call.method === 'DELETE'), false,
            'a public tab must not revoke another private tab');
        harness.dispose();
    });
}

test('explicit private check-in keeps its label and offers a plain return-to-public link without revoking the grant', async () => {
    const harness = createHarness({ evanDemoMode: 'extended' });
    assert.match(text(await harness.mount()), /Private demo.*up to 30 minutes/);
    harness.resolvePolicy(response({ mode: 'public', maxSeconds: 180, extendedAccess: true, aiflDemoRecaps: true }));
    const tree = await harness.settle();
    assert.match(text(tree), /Private demo.*up to 30 minutes/);
    const link = nodes(tree).find(node => ['link', 'a'].includes(node.type) && node.props.href === '/demo/evan');
    assert.ok(link, 'private check-in provides the canonical public route');
    assert.equal(harness.calls.some(call => call.url === '/api/anam/evan/demo-access' && call.method === 'DELETE'), false);
    harness.dispose();
});
