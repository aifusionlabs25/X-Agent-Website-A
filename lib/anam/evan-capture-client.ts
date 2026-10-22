import type { EvanCaptureRecord, EvanCaptureTurn } from './evan-capture.ts';
import { validateEvanCapture } from './evan-capture.ts';

export type EvanCaptureClientState = { status: 'listening' | 'updating' | 'ready' | 'degraded'; record: EvanCaptureRecord | null; revision: number };

/** Bound non-cancellable prerequisites such as session binding without changing
 * their shared implementation. Late completion never re-enters capture. */
export function awaitEvanCaptureWork<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const aborted = () => reject(new Error('Capture work cancelled'));
        if (signal.aborted) { void work.catch(() => undefined); aborted(); return; }
        signal.addEventListener('abort', aborted, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    });
}

/** Serial, latest-snapshot-wins background work; never joins Evan's speaking or
 * closing promise. No partial utterances, persistence, or auto-loop retries. */
export function createEvanCaptureClient(options: {
    onState: (state: EvanCaptureClientState) => void;
    request: (turns: EvanCaptureTurn[], revision: number, signal: AbortSignal) => Promise<unknown>;
    delayMs?: number;
    timeoutMs?: number;
}) {
    let disposed = false;
    let revision = 0;
    let record: EvanCaptureRecord | null = null;
    let pending: EvanCaptureTurn[] | null = null;
    let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latestSignature = '';
    const emit = (status: EvanCaptureClientState['status']) => { if (!disposed) options.onState({ status, record, revision }); };
    const run = async () => {
        timer = null;
        if (disposed || active || !pending) return;
        const turns = pending;
        const requestedRevision = revision;
        pending = null;
        const controller = new AbortController();
        active = controller;
        try {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(options.timeoutMs ?? 20_000)]);
            const raw = await awaitEvanCaptureWork(options.request(turns, requestedRevision, signal), signal) as { capture?: EvanCaptureRecord };
            if (disposed || requestedRevision !== revision) return;
            if (!raw?.capture || raw.capture.revision !== requestedRevision || raw.capture.sourceTurnCount !== turns.length) throw new Error('stale capture');
            record = validateEvanCapture({ facts: raw.capture.facts }, turns, requestedRevision);
            emit('ready');
        } catch { if (!disposed && requestedRevision === revision) emit('degraded'); }
        finally {
            active = null;
            if (!disposed && pending) timer = setTimeout(() => void run(), options.delayMs ?? 400);
        }
    };
    return {
        update(turns: EvanCaptureTurn[]) {
            if (disposed) return;
            const signature = JSON.stringify(turns);
            if (signature === latestSignature) return;
            latestSignature = signature;
            revision += 1;
            if (turns.length > 400 || turns.some(turn => turn.content.length > 2_000)
                || turns.reduce((sum, turn) => sum + turn.content.length, 0) > 80_000) {
                pending = null; active?.abort(); emit('degraded'); return;
            }
            pending = turns.map(turn => ({ ...turn }));
            emit('updating');
            if (!active) {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => void run(), options.delayMs ?? 400);
            }
        },
        dispose() { disposed = true; pending = null; active?.abort(); if (timer) clearTimeout(timer); timer = null; },
    };
}
