import { AnamEvent, createClient } from '@anam-ai/js-sdk';

// Intentionally no website capture, closing, recovery, prompt, or email modules.
const FIXTURES = [
    'Hi, I am planning a move and could use some help.',
    'I am moving from Mesa, Arizona to Tempe, Arizona.',
    'I am hoping to move in the second week of December, with a few days of flexibility.',
];
const QUIET_MS = 2_500;
let client;
let timer;
let stopPromise;
let epoch = 0;
let lastPersonaEvent = 0;
let lastToolEvent = 0;
let personaSpeaking = false;
let awaitingReply = false;
let personaEos = 0;
let completedHistoryEos = 0;
let lastPersonaId = null;
let firstReplyChunkSeen = false;
const pendingTools = new Set();
const state = {
    connected: false, stopped: false, stopRequested: false, stopReason: null,
    sessionId: null, rawStreamEvents: [], completedHistoryEvents: [],
    lifecycleEvents: [], tools: [], sentTurns: [], errors: [], overflow: false,
    scenario: 'baseline', intentionalInterruption: { requested: false, confirmed: false, messageId: null },
};
const elapsed = () => epoch ? Math.max(0, Date.now() - epoch) : 0;
// Retain the fictional transcript verbatim except credential-looking material.
const text = value => typeof value === 'string' ? value.slice(0, 20_000)
    .replace(/https?:\/\/\S+/gi, '[URL redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token redacted]') : '';
const id = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,180}$/.test(value) ? value : null;
const add = (items, event, limit = 2_000) => {
    if (items.length < limit) items.push({ ...event, elapsedMs: elapsed() });
    else state.overflow = true;
};
const message = value => ({
    id: id(value.id), role: value.role === 'persona' ? 'persona' : value.role === 'user' ? 'user' : 'unknown',
    content: text(value.content), interrupted: value.interrupted === true,
});
function quiet() {
    return state.connected && !state.stopped && !state.stopRequested && !personaSpeaking
        && !awaitingReply && personaEos > 0 && completedHistoryEos === personaEos
        && pendingTools.size === 0 && elapsed() - Math.max(lastPersonaEvent, lastToolEvent) >= QUIET_MS;
}
async function stop(reason = 'harness_cleanup') {
    if (stopPromise) return stopPromise;
    state.stopRequested = true;
    state.stopReason = reason;
    clearTimeout(timer);
    add(state.lifecycleEvents, { event: 'HARNESS_STOP_REQUESTED', reason });
    stopPromise = (async () => {
        try { if (client) await client.stopStreaming(); }
        catch { add(state.errors, { event: 'STOP_NOT_CONFIRMED' }); }
        finally { state.stopped = true; }
    })();
    return stopPromise;
}

window.__evanShortReplyDiagnostic = {
    async start({ sessionToken, startedAtEpochMs, stopAtEpochMs, scenario = 'baseline' }) {
        if (client || state.stopRequested) throw new Error('Only one diagnostic session is permitted.');
        if (!['baseline', 'interrupted'].includes(scenario)) throw new Error('Unknown diagnostic scenario.');
        state.scenario = scenario;
        if (!Number.isFinite(startedAtEpochMs) || stopAtEpochMs - startedAtEpochMs !== 53_000
            || Date.now() >= stopAtEpochMs) throw new Error('Invalid diagnostic deadline.');
        epoch = startedAtEpochMs;
        timer = setTimeout(() => { void stop('53_second_browser_limit'); }, Math.max(0, stopAtEpochMs - Date.now()));
        client = createClient(sessionToken, { disableInputAudio: true, api: { retry: { maxAttempts: 1 } },
            metrics: { disableClientMetrics: true } });
        client.addListener(AnamEvent.SESSION_READY, sessionId => {
            state.sessionId = id(sessionId);
            add(state.lifecycleEvents, { event: 'SESSION_READY', sessionId: state.sessionId });
            void window.__evanDiagnosticSessionReady(state.sessionId).catch(() => undefined);
        });
        client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
            state.connected = true;
            add(state.lifecycleEvents, { event: 'CONNECTION_ESTABLISHED' });
            if (state.stopRequested) void client.stopStreaming().catch(() => undefined);
        });
        client.addListener(AnamEvent.CONNECTION_CLOSED, (reason, details) => {
            state.connected = false;
            state.stopped = true;
            clearTimeout(timer);
            add(state.lifecycleEvents, { event: 'CONNECTION_CLOSED', reason: id(reason), hasDetails: Boolean(details) });
        });
        client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, event => {
            add(state.rawStreamEvents, { ...message(event), endOfSpeech: event.endOfSpeech === true,
                ...(event.cueTag ? { cueTag: id(event.cueTag) } : {}) });
            if (event.role !== 'persona') return;
            lastPersonaEvent = elapsed();
            lastPersonaId = id(event.id);
            personaSpeaking = event.endOfSpeech !== true;
            if (state.scenario === 'interrupted' && state.sentTurns.length === 1 && !firstReplyChunkSeen && event.content?.trim()
                && lastPersonaId !== state.sentTurns[0].precedingPersonaId) {
                firstReplyChunkSeen = true;
                if (event.endOfSpeech !== true && !event.interrupted && lastPersonaId) {
                    Object.assign(state.intentionalInterruption, { requested: true, messageId: lastPersonaId, requestedAtMs: elapsed() });
                    add(state.lifecycleEvents, { event: 'HARNESS_INTENTIONAL_INTERRUPTION', messageId: lastPersonaId });
                    // Exactly one deliberate interruption, never a new caller turn.
                    client.interruptPersona();
                } else state.intentionalInterruption.unavailableReason = 'first_reply_chunk_already_final_or_interrupted';
            }
            const intentionalEnd = state.intentionalInterruption.requested && event.endOfSpeech === true
                && event.interrupted === true && lastPersonaId === state.intentionalInterruption.messageId;
            if (intentionalEnd) Object.assign(state.intentionalInterruption, { confirmed: true, completedAtMs: elapsed() });
            if (event.endOfSpeech === true && (!event.interrupted || intentionalEnd)) {
                personaEos++;
                awaitingReply = false;
            }
        });
        // SDK 4.20 emits this after endOfSpeech; keep its full cumulative history,
        // including updates which reuse a message ID, instead of re-assembling it.
        client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, messages => {
            const history = messages.map(message);
            add(state.completedHistoryEvents, { messages: history, personaEos }, 300);
            if (!personaSpeaking && history.some(item => item.role === 'persona'
                && item.id === lastPersonaId && (!item.interrupted || state.intentionalInterruption.confirmed
                    && item.id === state.intentionalInterruption.messageId))) completedHistoryEos = personaEos;
        });
        for (const event of [AnamEvent.VIDEO_STREAM_STARTED, AnamEvent.VIDEO_PLAY_STARTED,
            AnamEvent.AUDIO_STREAM_STARTED, AnamEvent.USER_SPEECH_STARTED, AnamEvent.USER_SPEECH_ENDED,
            AnamEvent.TALK_STREAM_INTERRUPTED, AnamEvent.MIC_PERMISSION_PENDING,
            AnamEvent.MIC_PERMISSION_GRANTED, AnamEvent.MIC_PERMISSION_DENIED, AnamEvent.SERVER_WARNING]) {
            client.addListener(event, () => { add(state.lifecycleEvents, { event }); });
        }
        client.addListener(AnamEvent.INPUT_AUDIO_STREAM_STARTED, () => {
            add(state.errors, { event: 'UNEXPECTED_INPUT_AUDIO' });
            void stop('unexpected_input_audio');
        });
        for (const [event, phase] of [[AnamEvent.TOOL_CALL_STARTED, 'started'],
            [AnamEvent.TOOL_CALL_COMPLETED, 'completed'], [AnamEvent.TOOL_CALL_FAILED, 'failed']]) {
            client.addListener(event, payload => {
                const toolId = id(payload.toolCallId);
                if (phase === 'started') pendingTools.add(toolId);
                else pendingTools.delete(toolId);
                lastToolEvent = elapsed();
                add(state.tools, { event, phase, name: id(payload.toolName), id: toolId });
            });
        }
        for (const toolName of ['show_move_planner', 'send_mullins_follow_up_email', 'end_mullins_session']) {
            client.registerToolCallHandler(toolName, {
                onStart: async payload => {
                    add(state.tools, { event: 'HARNESS_UNAVAILABLE_RECEIPT', phase: 'receipt',
                        name: toolName, id: id(payload.toolCallId), status: 'unavailable' });
                    return JSON.stringify({ status: 'unavailable', accepted: false, retryAllowed: false,
                        message: 'This diagnostic has no website action connection. No action was taken.' });
                },
            });
        }
        try {
            await client.streamToVideoElement('evan-video');
            if (state.stopRequested) await client.stopStreaming();
        } catch {
            add(state.errors, { event: 'STREAM_START_FAILED' });
            throw new Error('Diagnostic stream could not start.');
        }
    },
    send(fixtureIndex) {
        if (!client || !quiet() || fixtureIndex !== state.sentTurns.length || !FIXTURES[fixtureIndex]) {
            throw new Error('A completed reply and quiet window are required before the next fixture.');
        }
        if (state.scenario === 'interrupted' && fixtureIndex > 0 && !state.intentionalInterruption.confirmed) {
            throw new Error('Interrupted end-of-speech was not confirmed; do not inject another turn.');
        }
        const sourceIndex = state.scenario === 'interrupted' ? [0, 0, 1][fixtureIndex] : fixtureIndex;
        const content = FIXTURES[sourceIndex];
        awaitingReply = true;
        add(state.sentTurns, { fixtureIndex, sourceIndex, content, precedingPersonaEos: personaEos, precedingPersonaId: lastPersonaId });
        client.sendUserMessage(content);
    },
    snapshot() {
        const video = document.getElementById('evan-video');
        return JSON.parse(JSON.stringify({ ...state, elapsedMs: elapsed(), personaEos, completedHistoryEos,
            personaSpeaking, awaitingReply, readyForInput: quiet(),
            quietForMs: Math.max(0, elapsed() - Math.max(lastPersonaEvent, lastToolEvent)),
            microphoneRequestCount: window.__evanDiagnosticMicRequests || 0,
            video: { muted: video.muted, volume: video.volume, paused: video.paused,
                currentTime: video.currentTime, readyState: video.readyState,
                audioTracks: [...(video.srcObject?.getAudioTracks?.() || [])].map(track => ({
                    enabled: track.enabled, muted: track.muted, readyState: track.readyState,
                })) },
        }));
    },
    async audioStats() {
        const result = [];
        for (const peer of window.__evanDiagnosticPeers || []) {
            const reports = await peer.getStats();
            reports.forEach(report => {
                if (report.type !== 'inbound-rtp' || (report.kind || report.mediaType) !== 'audio') return;
                const safe = { connectionState: peer.connectionState, elapsedMs: elapsed() };
                for (const key of ['bytesReceived', 'packetsReceived', 'packetsLost', 'jitter',
                    'totalAudioEnergy', 'totalSamplesDuration', 'audioLevel', 'concealedSamples']) {
                    if (Number.isFinite(report[key])) safe[key] = report[key];
                }
                result.push(safe);
            });
        }
        return result;
    },
    stop,
};
