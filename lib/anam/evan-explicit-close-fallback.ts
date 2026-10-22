type TimerHandle = ReturnType<typeof setTimeout>;

/** Last-resort browser close for a verified, completed visitor request when no
 * end-tool call arrives. It never infers intent from silence or agent speech. */
export function createEvanExplicitCloseFallback(input: {
    canClose: () => boolean;
    onFallback: () => void | Promise<void>;
    onError?: () => void;
    delayMs?: number;
    schedule?: typeof setTimeout;
    cancelTimer?: typeof clearTimeout;
}) {
    const schedule = input.schedule ?? setTimeout;
    const cancelTimer = input.cancelTimer ?? clearTimeout;
    const requestedDelay = input.delayMs ?? 8_000;
    const delayMs = Number.isFinite(requestedDelay)
        ? Math.max(8_000, Math.min(30_000, requestedDelay)) : 8_000;
    let timer: TimerHandle | null = null;
    let generation = 0;
    let used = false;
    let disposed = false;

    const cancel = () => {
        generation += 1;
        if (timer !== null) cancelTimer(timer);
        timer = null;
    };
    return {
        observeExplicitClose: () => {
            if (disposed || used) return;
            cancel();
            const armedGeneration = generation;
            timer = schedule(() => {
                timer = null;
                if (disposed || used || generation !== armedGeneration || !input.canClose()) return;
                used = true;
                try {
                    void Promise.resolve(input.onFallback()).catch(() => input.onError?.());
                } catch { input.onError?.(); }
            }, delayMs);
        },
        cancel,
        dispose: () => { disposed = true; cancel(); },
    };
}
