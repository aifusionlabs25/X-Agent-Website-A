import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

const source = await readFile(new URL('../lib/anam/evan-unexpected-close.ts', import.meta.url), 'utf8');
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
const exports = {};
new Function('exports', compiled.outputText)(exports);
const { isUnexpectedEvanClose } = exports;

test('Evan-only unexpected disconnect remains in the session for diagnosis', () => {
    assert.equal(isUnexpectedEvanClose({ isEvan: true, requestedCloseReason: null, publicAudioBlocked: false }), true);
    assert.equal(isUnexpectedEvanClose({ isEvan: true, requestedCloseReason: 'user_requested_end', publicAudioBlocked: false }), false);
    assert.equal(isUnexpectedEvanClose({ isEvan: true, requestedCloseReason: 'unsafe_public_audio_input', publicAudioBlocked: true }), false);
    assert.equal(isUnexpectedEvanClose({ isEvan: false, requestedCloseReason: null, publicAudioBlocked: false }), false);
});

test('Anam close handler records the SDK reason and does not auto-navigate after an unrequested Evan disconnect', async () => {
    const player = await readFile(new URL('../components/AnamPlayer.tsx', import.meta.url), 'utf8');
    const handler = player.slice(player.indexOf('const handleConnectionClosed'), player.indexOf("if (isAmyCara4) {\n                    removeCloseToolHandler", player.indexOf('const handleConnectionClosed')));
    assert.match(handler, /handleConnectionClosed = async \(reason: ConnectionClosedCode, details\?: string\)/);
    assert.match(handler, /isUnexpectedEvanClose\(/);
    assert.match(handler, /reason,\s*requestedClose: Boolean\(requestedCloseReason\)/);
    assert.match(handler, /if \(isMounted && unexpectedEvanDisconnect\)/);
    assert.match(handler, /setUnexpectedEvanClose\(true\)/);
    assert.match(handler, /else if \(isMounted && !publicAudioBlocked\) \{\s*onCloseRef\.current\?\.\(\)/);
    assert.match(player, /The live connection ended/);
});
