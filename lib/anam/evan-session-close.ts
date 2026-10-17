import { isEvanTerminalFarewell } from './evan-close-intent.ts';

type TimerHandle = ReturnType<typeof setTimeout>;
type ClosePhase = 'idle' | 'armed' | 'draining' | 'stopped' | 'disposed';

export type EvanFarewellCloseCoordinator = {
    arm: () => boolean;
    completeFarewell: (text: string, interrupted?: boolean) => boolean;
    cancelPending: () => boolean;
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
    let phase: ClosePhase = 'idle';
    let generation = 0;
    let fallbackTimer: TimerHandle | null = null;
    let audioDrainTimer: TimerHandle | null = null;

    const clearTimer = (timer: TimerHandle | null) => {
        if (timer !== null) cancel(timer);
    };

    const clearTimers = () => {
        clearTimer(fallbackTimer);
        clearTimer(audioDrainTimer);
        fallbackTimer = null;
        audioDrainTimer = null;
    };

    const stopOnce = (scheduledGeneration: number) => {
        if (generation !== scheduledGeneration || (phase !== 'armed' && phase !== 'draining')) return;
        phase = 'stopped';
        generation += 1;
        clearTimers();
        try {
            void Promise.resolve(input.stopStreaming()).catch(() => input.onStopError?.());
        } catch {
            input.onStopError?.();
        }
    };

    return {
        arm: () => {
            if (phase !== 'idle') return false;
            phase = 'armed';
            const armedGeneration = ++generation;
            fallbackTimer = schedule(() => stopOnce(armedGeneration), fallbackMs);
            return true;
        },
        completeFarewell: (text, interrupted = false) => {
            if (phase !== 'armed' || interrupted || !isEvanTerminalFarewell(text)) return false;
            phase = 'draining';
            const farewellGeneration = ++generation;
            clearTimer(fallbackTimer);
            fallbackTimer = null;
            audioDrainTimer = schedule(() => stopOnce(farewellGeneration), audioDrainMs);
            return true;
        },
        cancelPending: () => {
            if (phase !== 'armed' && phase !== 'draining') return false;
            phase = 'idle';
            generation += 1;
            clearTimers();
            return true;
        },
        dispose: () => {
            phase = 'disposed';
            generation += 1;
            clearTimers();
        },
        isArmed: () => phase === 'armed' || phase === 'draining',
    };
}
