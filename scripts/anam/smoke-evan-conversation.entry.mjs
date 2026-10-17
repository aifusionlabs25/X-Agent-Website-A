import { AnamEvent, createClient } from '@anam-ai/js-sdk';

const FAREWELL = 'Thank you for speaking with Mullins Moving. Take care.';
let client;
let startedAt = 0;
let stopPromise;
let hardLimit;
let farewellTimer;
let closeAllowed = false;
let closeArmed = false;
const pending = new Map();
const completedIds = new Set();
const state = { sessionId: null, connected: false, stopped: false, stopReason: null, messages: [], tools: [], failures: [] };
const elapsed = () => Date.now() - startedAt;

async function stop(reason = 'harness_cleanup') {
    if (stopPromise) return stopPromise;
    state.stopReason = reason;
    clearTimeout(hardLimit);
    clearTimeout(farewellTimer);
    stopPromise = (async () => {
        try { if (client) await client.stopStreaming(); }
        catch { state.failures.push({ type: 'stop_not_confirmed', elapsedMs: elapsed() }); }
        finally { state.stopped = true; }
    })();
    return stopPromise;
}

window.__evanConversationSmoke = {
    async start(sessionToken) {
        if (client) throw new Error('The harness permits only one session.');
        startedAt = Date.now();
        // The long-lived API key never enters this browser. No microphone is
        // requested, no mock audio is supplied, and no forced talk() is used.
        client = createClient(sessionToken, { disableInputAudio: true, metrics: { disableClientMetrics: true } });
        hardLimit = setTimeout(() => { void stop('120_second_safety_limit'); }, 120_000);
        client.addListener(AnamEvent.SESSION_READY, id => { state.sessionId = id; });
        client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => { state.connected = true; });
        client.addListener(AnamEvent.CONNECTION_CLOSED, () => { state.connected = false; });
        client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, event => {
            if (completedIds.has(event.id)) return;
            const turn = pending.get(event.id) || { id: event.id, role: event.role, content: '', startedMs: elapsed(), interrupted: false };
            turn.content += event.content || '';
            turn.interrupted ||= event.interrupted === true;
            pending.set(event.id, turn);
            if (!event.endOfSpeech) return;
            completedIds.add(event.id);
            pending.delete(event.id);
            state.messages.push({ ...turn, completedMs: elapsed() });
            if (closeArmed && turn.role === 'persona' && !turn.interrupted && turn.content.trim() === FAREWELL) {
                farewellTimer = setTimeout(() => { void stop('farewell_complete'); }, 1_000);
            }
        });
        for (const [eventName, phase] of [[AnamEvent.TOOL_CALL_STARTED, 'started'], [AnamEvent.TOOL_CALL_COMPLETED, 'completed'], [AnamEvent.TOOL_CALL_FAILED, 'failed']]) {
            client.addListener(eventName, event => {
                // No tool arguments, result bodies, request URLs, or credentials.
                state.tools.push({ name: event.toolName, id: event.toolCallId, phase, elapsedMs: elapsed() });
            });
        }
        client.registerToolCallHandler('send_mullins_follow_up_email', {
            onStart: async () => JSON.stringify({ status: 'email_unavailable', retryAllowed: false,
                instruction: 'This standalone guest test has no email check-in or delivery connection. No email recap is scheduled. Do not claim email, staff follow-up, or a handoff was sent or queued; do not retry. Continue the moving conversation.' }),
        });
        client.registerToolCallHandler('show_move_planner', {
            onStart: async () => JSON.stringify({ status: 'move_planner_update_unconfirmed', retryAllowed: false,
                instruction: 'This standalone conversation test does not include the website planner. Do not claim a view or pin was displayed. Continue from details already shared; do not ask the visitor to repeat the whole move or retry.' }),
        });
        client.registerToolCallHandler('end_mullins_session', {
            onStart: async () => {
                if (!closeAllowed) return JSON.stringify({ status: 'continue_conversation', retryAllowed: false,
                    instruction: 'The visitor has not finished the conversation. Do not say goodbye or call this tool again now. Listen to their next details and continue helping with the move.' });
                if (closeArmed) return JSON.stringify({ status: 'farewell_already_armed',
                    instruction: 'The farewell is already pending. Do not repeat it, speak again, or call the tool again.' });
                closeArmed = true;
                return JSON.stringify({ status: 'farewell_required',
                    instruction: 'Say exactly one brief warm farewell now: "Thank you for speaking with Mullins Moving. Take care." Do not ask a question, add a recap, or mention ending the call. The browser will close after the farewell finishes.' });
            },
        });
        try { await client.streamToVideoElement('evan-video'); }
        catch { state.failures.push({ type: 'stream_start_failed', elapsedMs: elapsed() }); throw new Error('Anam stream did not start.'); }
    },
    send(content, isFarewell = false) {
        if (!client || state.stopped) throw new Error('No active test session.');
        closeAllowed = isFarewell === true;
        client.sendUserMessage(content);
    },
    snapshot() { return JSON.parse(JSON.stringify({ ...state, partialMessages: [...pending.values()], elapsedMs: elapsed() })); },
    stop,
};
