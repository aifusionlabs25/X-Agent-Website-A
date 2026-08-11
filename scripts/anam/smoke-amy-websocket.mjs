import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const API_BASE = 'https://api.anam.ai/v1';
const PERSONA_ID = '0a2865a7-d0f0-4a5a-92b0-1c5bd49cab08';
const TIMEOUT_MS = 20_000;
const localEnv = await fs.readFile(new URL('../../.env.local', import.meta.url), 'utf8').catch(() => '');
const env = Object.fromEntries(localEnv.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
    }));
const apiKey = process.env.ANAM_API_KEY?.trim() || env.ANAM_API_KEY?.trim();
const configuredPersonaId = process.env.ANAM_AMY_CARA4_PERSONA_ID?.trim()
    || env.ANAM_AMY_CARA4_PERSONA_ID?.trim();
if (!apiKey) throw new Error('ANAM_API_KEY is required and is never printed.');
if (configuredPersonaId !== PERSONA_ID) throw new Error('Amy Cara 4 persona identity does not match.');

async function post(pathname, bearer, body) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Anam ${pathname} failed (${response.status}).`);
    return payload;
}

const tokenPayload = await post('/auth/session-token', apiKey, {
    clientLabel: `codex-amy-websocket-smoke-${Date.now()}`,
    personaConfig: { personaId: PERSONA_ID },
});
if (typeof tokenPayload.sessionToken !== 'string' || !tokenPayload.sessionToken) {
    throw new Error('Anam did not return a session token.');
}
const engineStartedAt = performance.now();
const engine = await post('/engine/session', tokenPayload.sessionToken, {
    personaConfig: { personaId: PERSONA_ID },
    sessionOptions: {},
    clientMetadata: { client: 'js-sdk', version: '4.20.0' },
});
if (!engine.sessionId || !engine.engineHost) throw new Error('Anam engine response was incomplete.');

const socketUrl = new URL(`${engine.engineProtocol || 'https'}://${engine.engineHost}`);
socketUrl.protocol = engine.engineProtocol === 'http' ? 'ws:' : 'wss:';
socketUrl.pathname = engine.signallingEndpoint || '/ws';
socketUrl.searchParams.set('session_id', engine.sessionId);
const socketStartedAt = performance.now();
const socketResult = await new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Amy signalling WebSocket timed out.'));
    }, TIMEOUT_MS);
    socket.addEventListener('open', () => {
        clearTimeout(timeout);
        const openLatencyMs = Math.round(performance.now() - socketStartedAt);
        socket.close(1000, 'smoke-test-complete');
        resolve({ openLatencyMs, protocol: socketUrl.protocol });
    }, { once: true });
    socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Amy signalling WebSocket failed to open.'));
    }, { once: true });
});

console.log(JSON.stringify({
    result: 'PASS',
    personaId: PERSONA_ID,
    sessionFingerprint: crypto.createHash('sha256').update(engine.sessionId).digest('hex').slice(0, 12),
    engineStartLatencyMs: Math.round(socketStartedAt - engineStartedAt),
    websocketOpenLatencyMs: socketResult.openLatencyMs,
    websocketProtocol: socketResult.protocol,
    sessionTokenIssued: true,
    engineSessionStarted: true,
    websocketOpened: true,
    websocketCloseRequested: true,
}, null, 2));

// Node's built-in WebSocket can keep the engine-side close handshake referenced
// after a successful open. The smoke test has completed once the close frame is sent.
setTimeout(() => process.exit(0), 250);
