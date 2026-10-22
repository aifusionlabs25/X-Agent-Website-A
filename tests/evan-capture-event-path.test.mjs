import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createEvanCaptureClient } from '../lib/anam/evan-capture-client.ts';
import { validateEvanCapture } from '../lib/anam/evan-capture.ts';
import { createEvanTranscriptAccumulator } from '../lib/anam/evan-transcript-accumulator.ts';
import { extractEvanCapture } from '../lib/anam/evan-capture-service.ts';
import { projectEvanCaptureContact, projectEvanCapturePlan } from '../lib/anam/evan-capture.ts';
import { AnamSessionApiError, fetchCompletedAnamTranscript } from '../lib/anam/session-api.ts';

// Execute the actual player callbacks, not a second copy of their event wiring.
// UI setters and unrelated speaking/closing collaborators are inert. Capture
// uses its real accumulator and client with a synthetic in-memory provider.
const playerSource = readFileSync(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
const playerAst = ts.createSourceFile('AnamPlayer.tsx', playerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name) {
    const matches = [];
    const visit = node => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
            matches.push(node.initializer.getText(playerAst));
        }
        ts.forEachChild(node, visit);
    };
    visit(playerAst);
    assert.equal(matches.length, 1, `Production callback ${name} must be uniquely located`);
    return ts.transpileModule(`globalThis.${name} = ${matches[0]};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
}
const callbacks = ['recordTurn', 'recordEvanCompletedTurn', 'reviseEvanCompletedTurn', 'handleMessageStream'].map(callback).join('\n');
const user = (id, content, endOfSpeech = false) => ({ id, role: 'user', content, endOfSpeech });
const persona = (id, content, endOfSpeech = false) => ({ id, role: 'persona', content, endOfSpeech });
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function eventPath(t, request) {
    t.mock.method(globalThis, 'fetch', () => assert.fail('External fetch is forbidden in this local event-path test'));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = [], states = [];
    const uiState = { contactTurns: [], workbenchTurns: [], closeCancellations: 0, routeReconciliations: 0 };
    const setUi = (field, value) => { uiState[field] = typeof value === 'function' ? value(uiState[field]) : value; };
    const client = createEvanCaptureClient({ delayMs: 1, onState: state => states.push(state),
        request: async (turns, revision, signal) => {
            requests.push({ turns: plain(turns), revision, signal });
            return request ? request(turns, revision, signal)
                : { capture: validateEvanCapture({ facts: [] }, turns, revision) };
        },
    });
    t.after(() => client.dispose());
    const context = vm.createContext({
        isEvan: true, isMounted: true, closeHandled: false, requestedCloseReason: null,
        evanPlannerEnabled: true, workbenchEnabled: false, evanTranscript: createEvanTranscriptAccumulator(),
        transcriptRef: { current: [] }, currentMessageRef: { current: '' }, currentRoleRef: { current: '' },
        evanAddressStopsRef: { current: null }, evanCaptureTurns: [], evanCaptureClient: client,
        evanCompletedSourceTurns: new Map(),
        evanUserBoundaries: new Map(), evanCompletedUserIds: new Set(), evanSpeechGeneration: 0,
        evanUserTurnGeneration: 0, evanSpeechCorrelationId: undefined, evanPersonaMessage: null,
        evanRefusedCloseContext: null, evanRefusedCloseRecovery: null, evanResponseRecovery: null,
        evanPlannerAutoOpen: null, evanCloseCoordinator: null, evanExplicitCloseFallback: null,
        evanCloseBaselineMessage: null, evanUserSpeaking: false, evanLastCompletedUserAt: 0,
        evanLatestCompletedUserId: null, evanCloseCandidate: null, completedUserTurns: 0,
        cancelEvanPendingClose: () => { uiState.closeCancellations += 1; },
        setEvanContactTurns: value => setUi('contactTurns', value),
        setWorkbenchTurns: value => setUi('workbenchTurns', value),
        reconcileEvanConfirmedRoute: previous => { uiState.routeReconciliations += 1; return previous; },
        transcriptRole: role => role === 'user' ? 'user' : 'agent',
        hasEvanCloseIntentAfterFragment: () => false, hasEvanCloseIntent: () => false,
        isEvanTerminalFarewell: () => false, console: { info() {} },
    });
    vm.runInContext(callbacks, context, { filename: 'production-evan-event-path.cjs' });
    return { client, context, requests, states, uiState, deliver: event => context.handleMessageStream(event),
        async settle() { t.mock.timers.tick(1); await flush(); },
    };
}

test('player forwards a completed user utterance once; partial chunks never reach capture', async t => {
    const f = eventPath(t);
    f.deliver(user('u1', 'I have two '));
    await f.settle();
    assert.equal(f.requests.length, 0);
    f.deliver(user('u1', 'walnut cabinets.', true));
    await f.settle();
    assert.deepEqual(f.requests[0].turns, [{ role: 'user', content: 'I have two walnut cabinets.' }]);
    f.deliver(user('u1', 'walnut cabinets.', true));
    await f.settle();
    assert.equal(f.requests.length, 1);
});

test('a known old user partial cannot flush a newer unfinished user utterance into capture', async t => {
    const f = eventPath(t);
    f.deliver(user('u1', 'I have a sideboard.', true));
    await f.settle();
    f.deliver(user('u2', 'Actually, do not move the '));
    f.deliver(user('u1', 'I have a sideboard.'));
    await f.settle();
    assert.equal(f.requests.length, 1, 'A late old partial must not publish the unfinished newer correction');
    assert.equal(f.context.evanTranscript.getPending()?.id, 'u2');
    assert.equal(f.context.evanTranscript.getPending()?.content, 'Actually, do not move the ');
});

test('late expanded final revises its original source slot and cannot become newer than a later correction', async t => {
    const f = eventPath(t);
    f.deliver(user('u1', 'Move date Friday'));
    f.deliver(persona('p1', 'Any other details?'));
    f.deliver(user('u2', 'Change move date to Monday.', true));
    await f.settle();
    f.deliver(user('u1', 'Move date Friday morning.', true));
    await f.settle();
    const turns = f.requests.at(-1).turns;
    assert.equal(turns.length, 3, 'One user message identity must not create a second chronological source turn');
    assert.equal(turns[0].content, 'Move date Friday morning.');
    assert.equal(turns.at(-1).content, 'Change move date to Monday.');
});

test('player source revision preserves pending speech and never advances close freshness', async t => {
    const f = eventPath(t);
    f.deliver(user('u1', 'My pickup is Mesa'));
    f.deliver(persona('p1', 'Where to?', true));
    f.deliver(user('u2', 'Gilbert.', true));
    await f.settle();
    f.deliver(user('u3', 'And I also need '));
    const { evanUserTurnGeneration, evanSpeechGeneration, evanLatestCompletedUserId,
        evanLastCompletedUserAt, evanCloseCandidate, completedUserTurns } = f.context;
    const { closeCancellations, routeReconciliations } = f.uiState;
    f.context.evanAddressStopsRef.current = [{ city: 'Mesa', kind: 'Origin' }];
    f.deliver(user('u1', 'My pickup is Mesa at 12 Example Lane.', true));
    await f.settle();
    assert.equal(f.context.evanUserTurnGeneration, evanUserTurnGeneration);
    assert.equal(f.context.evanSpeechGeneration, evanSpeechGeneration);
    assert.equal(f.context.evanLatestCompletedUserId, evanLatestCompletedUserId);
    assert.equal(f.context.evanLastCompletedUserAt, evanLastCompletedUserAt);
    assert.equal(f.context.evanCloseCandidate, evanCloseCandidate);
    assert.equal(f.context.completedUserTurns, completedUserTurns);
    assert.equal(f.uiState.closeCancellations, closeCancellations);
    assert.equal(f.uiState.routeReconciliations, routeReconciliations);
    assert.equal(f.context.evanTranscript.getPending()?.id, 'u3');
    assert.equal(f.context.currentMessageRef.current, 'And I also need ');
    assert.equal(f.requests.at(-1).turns.length, 3);
    assert.equal(f.context.transcriptRef.current[0].content, 'My pickup is Mesa at 12 Example Lane.');
    assert.equal(f.context.transcriptRef.current[0], f.context.evanCaptureTurns[0]);
    assert.equal(f.uiState.contactTurns[0], f.context.evanCaptureTurns[0]);
    assert.equal(f.uiState.workbenchTurns[0], f.context.evanCaptureTurns[0]);
    assert.equal(f.uiState.contactTurns.length, 3);
});

test('late prefix final cannot shrink a capture source or enqueue another extraction', async t => {
    const f = eventPath(t);
    f.deliver(user('u1', 'Do not move the cabinet.', true));
    await f.settle();
    f.deliver(user('u2', 'The desk should '));
    f.deliver(user('u1', 'Do not move', true));
    await f.settle();
    assert.equal(f.requests.length, 1);
    assert.equal(f.context.evanCaptureTurns[0].content, 'Do not move the cabinet.');
    assert.equal(f.context.evanTranscript.getPending()?.content, 'The desk should ');
});

test('disposing capture after a player event ignores the late result and all queued snapshots', async t => {
    let resolveRequest;
    const f = eventPath(t, () => new Promise(resolve => { resolveRequest = resolve; }));
    f.deliver(user('u1', 'I have a sideboard.', true));
    await f.settle();
    f.deliver(user('u2', 'I also have a cabinet.', true));
    f.client.dispose();
    const previousStates = f.states.length;
    const first = f.requests[0];
    resolveRequest({ capture: validateEvanCapture({ facts: [] }, first.turns, first.revision) });
    await f.settle();
    assert.equal(f.requests.length, 1);
    assert.equal(first.signal.aborted, true);
    assert.equal(f.states.length, previousStates);
});

test('actual player events reach the local record and planner including late contact completion', async t => {
    const f = eventPath(t, async (turns, revision, signal) => ({ capture: await extractEvanCapture({ turns, revision }, {
        env: { EVAN_CAPTURE_ENABLED: 'true', VERCEL_ENV: 'preview' }, signal,
    }) }));
    f.deliver(user('u1', 'My contact info is Avery Stone, 602-555-0138', true));
    await f.settle();
    assert.equal(projectEvanCaptureContact(f.states.at(-1).record).displayName, 'Avery Stone');
    f.deliver(user('u2', 'I have two walnut credenzas.', true));
    await f.settle();
    f.deliver(user('u1', 'My contact info is Avery Stone, 602-555-0138, email is avery@example.test.', true));
    await f.settle();
    const final = f.states.at(-1);
    assert.equal(final.status, 'ready');
    assert.equal(projectEvanCaptureContact(final.record).email, 'avery@example.test');
    assert.match(projectEvanCapturePlan(final.record).inventoryItems.join(' '), /two walnut credenzas/);
    assert.equal(final.record.sourceTurnCount, 2);
});

test('actual local replay preserves a later quantity correction when an older final gains a sibling item', async t => {
    const f = eventPath(t, async (turns, revision, signal) => ({ capture: await extractEvanCapture({ turns, revision }, {
        env: { EVAN_CAPTURE_ENABLED: 'true', VERCEL_ENV: 'preview' }, signal,
    }) }));
    f.deliver(user('u1', 'I have two walnut cabinets.', true));
    await f.settle();
    f.deliver(user('u2', 'Actually, make that three walnut cabinets.', true));
    await f.settle();
    f.deliver(user('u1', 'I have two walnut cabinets. I also have a desk.', true));
    await f.settle();
    const latest = f.states.at(-1);
    assert.equal(latest.status, 'ready');
    assert.equal(latest.record.sourceTurnCount, 2);
    const inventory = projectEvanCapturePlan(latest.record).inventoryItems;
    assert.ok(inventory.some(value => /three walnut cabinets/i.test(value)));
    assert.ok(inventory.some(value => /a desk/i.test(value)));
    assert.ok(inventory.every(value => !/two walnut cabinets/i.test(value)), 'Late source enrichment must not reverse the newer count');
});

test('actual local replay keeps email removal while a late earlier final supplies the phone', async t => {
    const f = eventPath(t, async (turns, revision, signal) => ({ capture: await extractEvanCapture({ turns, revision }, {
        env: { EVAN_CAPTURE_ENABLED: 'true', VERCEL_ENV: 'preview' }, signal,
    }) }));
    f.deliver(user('u1', 'My name is Robin Vale. My email is robin@example.test.', true));
    await f.settle();
    f.deliver(user('u2', 'Remove my email.', true));
    await f.settle();
    f.deliver(user('u1', 'My name is Robin Vale. My email is robin@example.test. My phone is 602-555-0148.', true));
    await f.settle();
    const latest = f.states.at(-1);
    assert.equal(latest.status, 'ready');
    assert.equal(latest.record.sourceTurnCount, 2);
    const contact = projectEvanCaptureContact(latest.record);
    assert.equal(contact.displayName, 'Robin Vale');
    assert.equal(contact.phone.replace(/\D/g, ''), '6025550148');
    assert.equal(contact.email, '', 'A late old contact bundle cannot resurrect a removed channel');
});

test('the real provider-final transcript boundary rejects oversized input before normalization', async t => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('External fetch is forbidden in this offline provider-boundary test'));
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const launch = { clientLabel: 'synthetic-launch', resolvedPersonaId: 'synthetic-evan' };
    for (const messages of [
        Array.from({ length: 401 }, () => ({ role: 'user', message: 'Synthetic detail.' })),
        [{ role: 'user', message: 'x'.repeat(4001) }],
    ]) {
        const calls = [];
        await assert.rejects(fetchCompletedAnamTranscript(sessionId, launch, {
            env: { ANAM_API_KEY: 'synthetic-not-a-credential' }, pollDelaysMs: [0], sleep: async () => {},
            fetchImpl: async url => {
                calls.push(String(url));
                return Response.json(String(url).endsWith('/transcript')
                    ? { sessionId, transcriptsEnabled: true, endTime: '2026-10-21T10:05:00Z', totalMessages: messages.length, messages }
                    : { id: sessionId, personaId: launch.resolvedPersonaId, clientLabel: launch.clientLabel, endTime: '2026-10-21T10:05:00Z' });
            },
        }), error => error instanceof AnamSessionApiError && error.retryable === false);
        assert.equal(calls.length, 2);
    }
});

