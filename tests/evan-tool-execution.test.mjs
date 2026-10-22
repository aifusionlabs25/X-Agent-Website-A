import assert from 'node:assert/strict';
import test from 'node:test';
import {
    EVAN_TOOL_DEADLINE_MS,
    EVAN_TOOL_MAX_DEADLINE_MS,
    EvanToolExecutionError,
    runEvanToolWithDeadline,
} from '../lib/anam/evan-tool-execution.ts';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const hasCode = code => error => {
    assert.ok(error instanceof EvanToolExecutionError);
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    return true;
};

test('whole operation deadline is eight seconds by default and always below provider timeout', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    assert.equal(EVAN_TOOL_DEADLINE_MS, 8_000);
    assert.equal(EVAN_TOOL_MAX_DEADLINE_MS, 10_000);
    assert.ok(EVAN_TOOL_MAX_DEADLINE_MS < 15_000);
    const pending = runEvanToolWithDeadline(() => new Promise(() => {}));
    const checked = assert.rejects(pending, hasCode('timeout'));
    t.mock.timers.tick(EVAN_TOOL_DEADLINE_MS);
    return checked;
});

test('larger requested timeouts are capped at ten seconds', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal;
    const pending = runEvanToolWithDeadline(value => {
        signal = value;
        return new Promise(() => {});
    }, { timeoutMs: 60_000 });
    const checked = assert.rejects(pending, hasCode('timeout'));
    await flush();
    t.mock.timers.tick(EVAN_TOOL_MAX_DEADLINE_MS - 1);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1);
    await checked;
    assert.equal(signal.aborted, true);
});

test('pending session binding times out, and a late binding cannot start an email request', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const binding = deferred();
    let calls = 0;
    let emailRequests = 0;
    const pending = runEvanToolWithDeadline(async signal => {
        calls++;
        await binding.promise;
        signal.throwIfAborted();
        emailRequests++;
        return 'queued';
    });
    const checked = assert.rejects(pending, hasCode('timeout'));
    await flush();
    t.mock.timers.tick(EVAN_TOOL_DEADLINE_MS);
    await checked;
    binding.resolve();
    await flush();
    assert.equal(calls, 1);
    assert.equal(emailRequests, 0);
});

test('timeout aborts a fetch-like operation without retrying it', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let requests = 0;
    let aborted = false;
    const pending = runEvanToolWithDeadline(signal => {
        requests++;
        return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
                aborted = true;
                reject(new Error('private-address and secret-provider-url'));
            });
        });
    });
    const checked = assert.rejects(pending, hasCode('timeout'));
    await flush();
    t.mock.timers.tick(EVAN_TOOL_DEADLINE_MS);
    await checked;
    await flush();
    assert.equal(aborted, true);
    assert.equal(requests, 1);
});

test('late success and late rejection cannot replace a timeout result', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const mode of ['resolve', 'reject']) {
        const late = deferred();
        let successes = 0;
        let failures = 0;
        const pending = runEvanToolWithDeadline(() => late.promise, { timeoutMs: 100 });
        const observed = pending.then(() => { successes++; }, error => {
            failures++;
            hasCode('timeout')(error);
        });
        await flush();
        t.mock.timers.tick(100);
        await observed;
        late[mode](mode === 'resolve' ? 'late receipt' : new Error('private content'));
        await flush();
        assert.equal(successes, 0);
        assert.equal(failures, 1);
    }
});

test('success cleans up deadline and external abort listener', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const external = new AbortController();
    const remove = t.mock.method(external.signal, 'removeEventListener');
    let signal;
    assert.deepEqual(await runEvanToolWithDeadline(value => {
        signal = value;
        return { status: 'ready' };
    }, { signal: external.signal }), { status: 'ready' });
    assert.equal(remove.mock.callCount(), 1);
    t.mock.timers.tick(20_000);
    external.abort('private contact information');
    assert.equal(signal.aborted, false);
});

test('pre-aborted and subsequently aborted operations reject without leaking abort reasons', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const preAborted = new AbortController();
    preAborted.abort('private@example.com');
    let calls = 0;
    await assert.rejects(runEvanToolWithDeadline(() => { calls++; }, { signal: preAborted.signal }), hasCode('aborted'));
    assert.equal(calls, 0);

    const external = new AbortController();
    let signal;
    const pending = runEvanToolWithDeadline(value => {
        signal = value;
        return new Promise(() => {});
    }, { signal: external.signal });
    const checked = assert.rejects(pending, error => {
        hasCode('aborted')(error);
        assert.doesNotMatch(`${error.message} ${error.stack}`, /private@example/);
        return true;
    });
    await flush();
    external.abort('private@example.com');
    await checked;
    assert.equal(signal.aborted, true);
    t.mock.timers.tick(20_000);
});

test('sync throws and async errors produce only sanitized failure details', async () => {
    for (const operation of [
        () => { throw new Error('private@example.com /api?apiKey=secret'); },
        async () => { throw new Error('123 Example Street /api?apiKey=secret'); },
    ]) {
        await assert.rejects(runEvanToolWithDeadline(operation), error => {
            hasCode('failed')(error);
            assert.doesNotMatch(`${error.message} ${error.stack} ${JSON.stringify(error)}`, /private@example|Example Street|apiKey=secret/);
            return true;
        });
    }
});

test('invalid deadlines fail closed before invoking the operation', async () => {
    for (const timeoutMs of [0, -1, NaN, Infinity]) {
        let calls = 0;
        await assert.rejects(runEvanToolWithDeadline(() => { calls++; }, { timeoutMs }), hasCode('failed'));
        assert.equal(calls, 0);
    }
});
