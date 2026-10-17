import { AnamEvent, createClient } from '@anam-ai/js-sdk';
import { hasEvanCloseIntent } from '../../lib/anam/evan-close-intent.ts';
import { createEvanTranscriptAccumulator } from '../../lib/anam/evan-transcript-accumulator.ts';
import { createEvanRefusedCloseRecovery } from '../../lib/anam/evan-refused-close-recovery.ts';

const FAREWELL = 'Thank you for speaking with Mullins Moving. Take care.';
let client;
let startedAt = 0;
let stopPromise;
let hardLimit;
let farewellTimer;
let closeArmed = false;
let latestTypedTurn = { content: '', previousAgentText: '' };
let personaEventsAtTypedTurn = 0;
let personaEvents = 0;
let pendingStartedMs = 0;
let closeBaseline = null;
let refusedCloseActive = false;
let refusedClosePersona = null;
const transcript = createEvanTranscriptAccumulator();
const state = { sessionId: null, connected: false, stopped: false, stopReason: null, messages: [], tools: [], receipts: [], recoveries: [], streamEvents: [], lastPersonaEventMs: 0, failures: [] };
const elapsed = () => Date.now() - startedAt;
const receipt = (payload, value) => {
    // Status only: never copy tool arguments, result bodies, or credentials.
    state.receipts.push({ name: payload.toolName, id: payload.toolCallId, status: value.status, elapsedMs: elapsed() });
    return JSON.stringify(value);
};
const refusedCloseRecovery = createEvanRefusedCloseRecovery({
    canRecover: () => Boolean(client && state.connected && !state.stopped && !stopPromise && !closeArmed),
    onInterrupt: () => {
        state.recoveries.push({ type: 'refused_close_interruption_requested', elapsedMs: elapsed() });
        client.interruptPersona();
    },
    onRecover: async speech => {
        state.recoveries.push({ type: 'refused_close_recovery_speech_requested', elapsedMs: elapsed() });
        await client.talk(speech);
    },
    onError: () => { state.failures.push({ type: 'refused_close_recovery_not_confirmed', elapsedMs: elapsed() }); },
});

async function stop(reason = 'harness_cleanup') {
    if (stopPromise) return stopPromise;
    state.stopReason = reason;
    clearTimeout(hardLimit);
    clearTimeout(farewellTimer);
    refusedCloseRecovery.dispose();
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
        // requested and no mock audio is supplied. Only the bounded refused-close
        // recovery may use talk(); that intervention is recorded separately.
        client = createClient(sessionToken, { disableInputAudio: true, metrics: { disableClientMetrics: true } });
        hardLimit = setTimeout(() => { void stop('120_second_safety_limit'); }, 120_000);
        client.addListener(AnamEvent.SESSION_READY, id => { state.sessionId = id; });
        client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => { state.connected = true; });
        client.addListener(AnamEvent.CONNECTION_CLOSED, () => { state.connected = false; });
        client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, event => {
            const now = elapsed();
            const previous = transcript.getPending();
            let recoveryInterrupted = false;
            if (event.role === 'persona' && refusedCloseActive) {
                if (refusedClosePersona?.id !== event.id) refusedClosePersona = { id: event.id, content: '' };
                refusedClosePersona.content += event.content || '';
                recoveryInterrupted = refusedCloseRecovery.observePersona(refusedClosePersona.content);
                if (recoveryInterrupted) refusedCloseActive = false;
            }
            // Keep attempted output in test evidence, marked as locally
            // interrupted. Containment must not masquerade as model compliance.
            const update = transcript.push(recoveryInterrupted ? { ...event, interrupted: true } : event);
            if (state.streamEvents.length < 2_000) state.streamEvents.push({
                id: event.id, role: event.role, characters: event.content?.length || 0,
                endOfSpeech: event.endOfSpeech === true, interrupted: event.interrupted === true,
                replay: update.replay, recoveryInterrupted, elapsedMs: now,
            });
            if (update.replay) return;
            if (event.role === 'persona') {
                if (event.content?.trim()) personaEvents++;
                state.lastPersonaEventMs = now;
                // New speech after a farewell must remain observable, not be
                // cut off by the prior completion timer and hidden as a pass.
                clearTimeout(farewellTimer);
            }
            for (const turn of update.completed) {
                const startedMs = previous?.id === turn.id && previous.role === turn.role ? pendingStartedMs : now;
                state.messages.push({ ...turn, startedMs, completedMs: now });
                const farewellText = closeBaseline?.id === turn.id && closeBaseline.role === turn.role
                    && turn.content.startsWith(closeBaseline.content)
                    ? turn.content.slice(closeBaseline.content.length).trim() : turn.content.trim();
                if (closeArmed && turn.role === 'persona' && turn.completion === 'explicit-final'
                    && !turn.interrupted && farewellText === FAREWELL) {
                    clearTimeout(farewellTimer);
                    farewellTimer = setTimeout(() => { void stop('farewell_complete'); }, 1_000);
                }
            }
            if (!update.pending) pendingStartedMs = 0;
            else if (previous?.id !== update.pending.id || previous.role !== update.pending.role) pendingStartedMs = now;
        });
        for (const [eventName, phase] of [[AnamEvent.TOOL_CALL_STARTED, 'started'], [AnamEvent.TOOL_CALL_COMPLETED, 'completed'], [AnamEvent.TOOL_CALL_FAILED, 'failed']]) {
            client.addListener(eventName, event => {
                // No tool arguments, result bodies, request URLs, or credentials.
                state.tools.push({ name: event.toolName, id: event.toolCallId, phase, elapsedMs: elapsed() });
            });
        }
        client.registerToolCallHandler('send_mullins_follow_up_email', {
            onStart: async payload => receipt(payload, { status: 'email_unavailable', retryAllowed: false,
                instruction: 'This standalone guest test has no email check-in or delivery connection. No email recap is scheduled. Do not claim email, staff follow-up, or a handoff was sent or queued; do not retry. Continue the moving conversation.' }),
        });
        client.registerToolCallHandler('show_move_planner', {
            onStart: async payload => receipt(payload, { status: 'move_planner_update_unconfirmed', retryAllowed: false,
                instruction: 'This standalone conversation test does not include the website planner. Do not claim a view or pin was displayed. Continue from details already shared; do not ask the visitor to repeat the whole move or retry.' }),
        });
        client.registerToolCallHandler('end_mullins_session', {
            onStart: async payload => {
                if (!hasEvanCloseIntent(latestTypedTurn.content, latestTypedTurn.previousAgentText)) {
                    refusedCloseRecovery.rejectClose({ allowSilenceRecovery: personaEvents === personaEventsAtTypedTurn });
                    if (!refusedCloseActive) refusedClosePersona = null;
                    refusedCloseActive = true;
                    return receipt(payload, { status: 'continue_conversation', accepted: false, retryAllowed: false,
                        instruction: 'This is a deliberate refusal, not a tool failure. Do not say goodbye, retry this tool, restart a readback, or repeat an answered question. The latest visitor answer is complete: acknowledge it briefly and ask one useful unanswered moving question, or ask whether they have anything else to add. Only wait silently if you have already asked a NEW question after that latest answer. A contact confirmation or callback preference is not permission to end. Do not promise that a callback has been scheduled.' });
                }
                refusedCloseRecovery.cancel();
                refusedCloseActive = false;
                if (closeArmed) return receipt(payload, { status: 'farewell_already_armed',
                    instruction: 'The farewell is already pending. Do not repeat it, speak again, or call the tool again.' });
                closeArmed = true;
                const pending = transcript.getPending();
                closeBaseline = pending?.role === 'persona' ? pending : null;
                return receipt(payload, { status: 'farewell_required',
                    instruction: 'Say exactly one brief warm farewell now: "Thank you for speaking with Mullins Moving. Take care." Do not ask a question, add a recap, or mention ending the call. The browser will close after the farewell finishes.' });
            },
        });
        try { await client.streamToVideoElement('evan-video'); }
        catch { state.failures.push({ type: 'stream_start_failed', elapsedMs: elapsed() }); throw new Error('Anam stream did not start.'); }
    },
    send(content) {
        if (!client || state.stopped) throw new Error('No active test session.');
        const pending = transcript.getPending();
        latestTypedTurn = { content, previousAgentText: pending?.role === 'persona'
            ? pending.content : state.messages.filter(turn => turn.role === 'persona').at(-1)?.content || '' };
        // New typed input cancels a pending farewell. This is not a VAD test.
        clearTimeout(farewellTimer);
        refusedCloseRecovery.cancel();
        refusedCloseActive = false;
        refusedClosePersona = null;
        closeArmed = false;
        closeBaseline = null;
        personaEventsAtTypedTurn = personaEvents;
        client.sendUserMessage(content);
    },
    snapshot() { const pending = transcript.getPending(); return JSON.parse(JSON.stringify({ ...state, partialMessages: pending ? [{ ...pending, startedMs: pendingStartedMs }] : [], elapsedMs: elapsed() })); },
    stop,
};
