type TimerHandle = ReturnType<typeof setTimeout>;

export const EVAN_REFUSED_CLOSE_RECOVERY_MESSAGE = 'Is there anything else you would like to add about your move?';

/**
 * Contains an observed provider farewell after a refused close, without relaxing
 * close authorization. The caller owns session/user-generation correlation and
 * supplies only the accumulated post-refusal persona text. Streaming text can
 * arrive alongside audio: interruption is recovery, not proof of inaudibility.
 * A refusal with no persona output may recover after 12 seconds without an
 * interruption. Both paths share one attempt per session; cancellation never
 * replenishes that budget. Any nonempty output cancels the silence fallback.
 */
export function createEvanRefusedCloseRecovery(input: {
    onInterrupt: () => void;
    onRecover: (speech: string) => void | Promise<void>;
    canRecover: () => boolean;
    onError?: () => void;
    schedule?: typeof setTimeout;
    cancelTimer?: typeof clearTimeout;
    delayMs?: number;
    silenceDelayMs?: number;
}) {
    const schedule = input.schedule ?? setTimeout;
    const cancelTimer = input.cancelTimer ?? clearTimeout;
    const delayMs = Number.isFinite(input.delayMs) ? Math.max(300, Math.min(1_000, input.delayMs!)) : 300;
    const silenceDelayMs = Number.isFinite(input.silenceDelayMs) ? Math.max(12_000, Math.min(60_000, input.silenceDelayMs!)) : 12_000;
    let timer: TimerHandle | null = null;
    let timerKind: 'silence' | 'farewell' | null = null;
    let generation = 0;
    let armed = false;
    let used = false;
    let disposed = false;
    const reportError = () => { try { input.onError?.(); } catch { /* Diagnostics cannot resume speech. */ } };
    const clearTimer = () => {
        generation++;
        if (timer !== null) cancelTimer(timer);
        timer = null;
        timerKind = null;
    };
    const cancel = () => {
        armed = false;
        clearTimer();
    };

    return {
        rejectClose(options: { allowSilenceRecovery?: boolean } = {}) {
            // Repeated refusals in the same caller generation neither extend
            // the deadline nor restart it after ordinary speech cancelled it.
            if (disposed || used || armed) return;
            armed = true;
            // An already asked question is a legitimate listening pause.
            // Farewell interception remains armed even without a silence timer.
            if (options.allowSilenceRecovery !== true) return;
            const currentGeneration = ++generation;
            timerKind = 'silence';
            timer = schedule(() => {
                if (disposed || used || !armed || generation !== currentGeneration) return;
                timer = null;
                timerKind = null;
                used = true;
                armed = false;
                try {
                    if (!input.canRecover()) return;
                    // Nothing has been spoken since the refusal: do not send
                    // an interrupt command or disturb ongoing caller speech.
                    void Promise.resolve(input.onRecover(EVAN_REFUSED_CLOSE_RECOVERY_MESSAGE)).catch(reportError);
                } catch { reportError(); }
            }, silenceDelayMs);
        },
        cancel,
        observePersona(text: string): boolean {
            if (disposed || used || !armed) return false;
            const content = text.replace(/\s+/g, ' ').trim();
            if (content && timerKind === 'silence') clearTimer();
            if (!/^Thank you for speaking with Mullins Moving\.(?:\s|$)/.test(content)) return false;
            // Spend before any callback so reentrant events cannot trigger again.
            used = true;
            armed = false;
            const currentGeneration = ++generation;
            try {
                if (!input.canRecover()) return false;
                input.onInterrupt();
                if (disposed || generation !== currentGeneration) return true;
                timerKind = 'farewell';
                timer = schedule(() => {
                    if (disposed || generation !== currentGeneration) return;
                    timer = null;
                    timerKind = null;
                    try {
                        if (!input.canRecover()) return;
                        void Promise.resolve(input.onRecover(EVAN_REFUSED_CLOSE_RECOVERY_MESSAGE)).catch(reportError);
                    } catch { reportError(); }
                }, delayMs);
            } catch { reportError(); }
            return true;
        },
        dispose() {
            disposed = true;
            cancel();
        },
    };
}
