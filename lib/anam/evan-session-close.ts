type TimerHandle = ReturnType<typeof setTimeout>;

export type EvanFarewellCloseCoordinator = {
    arm: () => boolean;
    completeFarewell: () => boolean;
    dispose: () => void;
    isArmed: () => boolean;
};

export function createEvanFarewellCloseCoordinator(input: {
    stopStreaming: () => void | Promise<void>;
    onStopError?: () => void;
    fallbackMs?: number;
    audioDrainMs?: number;
    schedule?: typeof setTimeout;
    cancel?: typeof clearTimeout;
}): EvanFarewellCloseCoordinator {
    const schedule = input.schedule ?? setTimeout;
    const cancel = input.cancel ?? clearTimeout;
    const fallbackMs = input.fallbackMs ?? 12_000;
    const audioDrainMs = input.audioDrainMs ?? 2_500;
    let armed = false;
    let disposed = false;
    let stopRequested = false;
    let fallbackTimer: TimerHandle | null = null;
    let audioDrainTimer: TimerHandle | null = null;

    const clearTimer = (timer: TimerHandle | null) => {
        if (timer !== null) cancel(timer);
    };

    const stopOnce = () => {
        if (disposed || stopRequested) return;
        stopRequested = true;
        armed = false;
        clearTimer(fallbackTimer);
        fallbackTimer = null;
        void Promise.resolve(input.stopStreaming()).catch(() => input.onStopError?.());
    };

    return {
        arm: () => {
            if (disposed || stopRequested || armed) return false;
            armed = true;
            fallbackTimer = schedule(stopOnce, fallbackMs);
            return true;
        },
        completeFarewell: () => {
            if (disposed || stopRequested || !armed || audioDrainTimer !== null) return false;
            armed = false;
            clearTimer(fallbackTimer);
            fallbackTimer = null;
            audioDrainTimer = schedule(stopOnce, audioDrainMs);
            return true;
        },
        dispose: () => {
            disposed = true;
            armed = false;
            clearTimer(fallbackTimer);
            clearTimer(audioDrainTimer);
            fallbackTimer = null;
            audioDrainTimer = null;
        },
        isArmed: () => armed,
    };
}
