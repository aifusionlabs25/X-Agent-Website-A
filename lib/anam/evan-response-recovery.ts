type TimerHandle = ReturnType<typeof setTimeout>;

export const EVAN_RESPONSE_RECOVERY_MESSAGE = 'Sorry about that pause. I am still here and listening.';

type ToolEvent = { toolCallId: string; toolName: string; userActionCorrelationId?: string };

function normalized(value: string): string {
    return value.normalize('NFKC').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Conservative: silence is expected for explicit waiting, closing, and backchannels. */
export function isEvanRecoverableAnswer(text: string, previousAgentText = ''): boolean {
    const answer = normalized(text);
    if (!/[a-z0-9]/i.test(answer)) return false;
    if (/\b(?:wait|hold on|hold up|hang on|hang tight|one (?:moment|second|minute)|just a (?:sec|second|moment|minute)|give me (?:a|one|a few|a couple of) (?:seconds?|moments?|minutes?)|i need (?:a|one) (?:second|moment|minute)|let me (?:think|finish|check)|be right back|not finished|still speaking|pause)\b/i.test(answer)) return false;
    if (/\b(?:goodbye|bye|end (?:the|this|our) (?:call|session|conversation)|that(?:'s| is) (?:all|it)|all done|we(?:'re| are) done|i(?:'m| am) done|nothing else|no more questions|take care)\b/i.test(answer)) return false;

    const bareAcknowledgment = /^(?:(?:yes|yeah|yep|yup|no|nope|sure|okay|ok|right|correct|that'?s right|exactly|uh[ -]?huh|mm[ -]?hmm|thanks|thank you|got it|understood|well|um|uh|so)(?:[.!?,\s]+|$))+$/i.test(answer);
    if (!bareAcknowledgment) return true;
    // A yes/no is an answer to an explicit confirmation, not a request to stay silent.
    return /^(?:yes|yeah|yep|yup|no|nope|sure|okay|ok|right|correct|that'?s right|exactly)[.!?,\s]*$/i.test(answer)
        && /(?:did i (?:get|hear|catch).{0,100}right|is that (?:right|correct)|does that sound (?:right|correct)|can you confirm|is .{1,100} correct|am i understanding.{0,100}right)/i.test(normalized(previousAgentText));
}

/**
 * One recovery at most per session, only after an unexpected skip_turn.
 * This never interrupts speech, invokes a tool, manufactures a user turn, or retries.
 * User VAD events are authoritative: a transcript final alone does not clear active speech.
 */
export function createEvanResponseRecovery(input: {
    onRecover: (speech: string) => void | Promise<void>;
    canRecover: () => boolean;
    onError?: () => void;
    delayMs?: number;
    schedule?: typeof setTimeout;
    cancel?: typeof clearTimeout;
}) {
    const schedule = input.schedule ?? setTimeout;
    const cancel = input.cancel ?? clearTimeout;
    const requestedDelay = input.delayMs ?? 12_000;
    const delayMs = Number.isFinite(requestedDelay) ? Math.max(12_000, Math.min(60_000, requestedDelay)) : 12_000;
    let timer: TimerHandle | null = null;
    let generation = 0;
    let closed = false;
    let recovered = false;
    let userSpeaking = false;
    let eligible = false;
    let skipped = false;
    let lastFinalTurnId: string | undefined;
    let speechCorrelationId: string | undefined;
    const activeTools = new Set<string>();
    const seenSkipCalls = new Set<string>();

    const cancelTimer = () => {
        generation++;
        if (timer !== null) cancel(timer);
        timer = null;
    };
    const invalidateTurn = () => {
        cancelTimer();
        eligible = false;
        skipped = false;
    };
    const arm = () => {
        if (closed || recovered || timer !== null || userSpeaking || !eligible || !skipped || activeTools.size) return;
        const armedGeneration = generation;
        timer = schedule(() => {
            timer = null;
            if (closed || recovered || generation !== armedGeneration || userSpeaking || !eligible || !skipped || activeTools.size) return;
            // Consumed even if hidden/disconnected or the callback fails: no delayed surprise or loop.
            recovered = true;
            eligible = false;
            skipped = false;
            try {
                if (!input.canRecover()) return;
                void Promise.resolve(input.onRecover(EVAN_RESPONSE_RECOVERY_MESSAGE)).catch(() => input.onError?.());
            } catch {
                input.onError?.();
            }
        }, delayMs);
    };
    const close = () => {
        closed = true;
        invalidateTurn();
        activeTools.clear();
        seenSkipCalls.clear();
    };

    return {
        userSpeechStarted: (correlationId?: string) => {
            if (closed) return;
            userSpeaking = true;
            speechCorrelationId = correlationId && correlationId !== 'unknown' ? correlationId : undefined;
            invalidateTurn();
        },
        userSpeechEnded: (correlationId?: string) => {
            if (closed) return;
            if (speechCorrelationId && correlationId && correlationId !== 'unknown' && correlationId !== speechCorrelationId) return;
            userSpeaking = false;
            arm();
        },
        userTurnCompleted: (text: string, previousAgentText = '', turnId?: string) => {
            if (closed || recovered || (turnId && turnId === lastFinalTurnId)) return;
            invalidateTurn();
            lastFinalTurnId = turnId;
            eligible = isEvanRecoverableAnswer(text, previousAgentText);
            // A new skip event must follow this final turn. Late old tool events must not revive it.
        },
        agentResponseStarted: () => {
            if (!closed) invalidateTurn();
        },
        toolStarted: (event: ToolEvent) => {
            if (closed) return;
            if (event.toolName === 'end_mullins_session') { close(); return; }
            if (event.toolName === 'skip_turn') {
                if (!event.toolCallId || seenSkipCalls.has(event.toolCallId)) return;
                seenSkipCalls.add(event.toolCallId);
                if (speechCorrelationId && event.userActionCorrelationId && event.userActionCorrelationId !== 'unknown'
                    && speechCorrelationId !== event.userActionCorrelationId) return;
                skipped = true;
                arm();
                return;
            }
            activeTools.add(event.toolCallId);
            // Useful work has begun. Do not race it or resume the old silence watchdog afterward.
            invalidateTurn();
        },
        toolFinished: (event: ToolEvent) => {
            if (closed || event.toolName === 'skip_turn') return;
            activeTools.delete(event.toolCallId);
        },
        close,
        dispose: close,
    };
}
