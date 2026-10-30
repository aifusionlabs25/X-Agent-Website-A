import type { EvanCaptureRecord, EvanCaptureTurn } from './capture/evan-capture.ts';
import { validateBrowserCapture } from './browser-contract.mjs';

export type EvanCaptureClientState = { status: 'listening' | 'updating' | 'ready' | 'degraded'; record: EvanCaptureRecord | null; revision: number; review: any; receipt: any };

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
    session: {sessionId: string; launchId: string} | (() => {sessionId: string; launchId: string});
    restore?: (signal: AbortSignal) => Promise<unknown>;
    onState: (state: EvanCaptureClientState) => void;
    request: (turns: EvanCaptureTurn[], revision: number, signal: AbortSignal) => Promise<unknown>;
    delayMs?: number;
    timeoutMs?: number;
}) {
    let disposed = false;
    let revision = 0;
    let record: EvanCaptureRecord | null = null;
    let review: any = null;
    let receipt: any = null;
    let pending: EvanCaptureTurn[] | null = null;
    let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latestSignature = '';
    const boundSession = () => typeof options.session === 'function' ? options.session() : options.session;
    const emit = (status: EvanCaptureClientState['status']) => { if (!disposed) options.onState({ status, record, revision, review, receipt }); };
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
            const raw = await awaitEvanCaptureWork(options.request(turns, requestedRevision, signal), signal);
            if (disposed || requestedRevision !== revision) return;
            const accepted = await validateBrowserCapture(raw, turns, requestedRevision, boundSession());
            if (disposed || signal.aborted || requestedRevision !== revision) return;
            record = accepted.record; review = accepted.review; receipt = accepted.receipt;
            emit('ready');
        } catch { if (!disposed && requestedRevision === revision) emit('degraded'); }
        finally {
            active = null;
            if (!disposed && pending) timer = setTimeout(() => void run(), options.delayMs ?? 400);
        }
    };
    return {
        async restore(turns: EvanCaptureTurn[]) {
            if (disposed || revision !== 0 || active || pending || !options.restore) throw new Error('Capture restore is unavailable');
            const controller = new AbortController(); active = controller;
            const frozen = turns.map(turn => ({...turn}));
            try {
                const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(options.timeoutMs ?? 20_000)]);
                const raw: any = await awaitEvanCaptureWork(options.restore(signal), signal);
                if (disposed || revision !== 0) return;
                if (raw?.schema === 'capture-application.v0.1' && raw.empty === true) { emit('listening'); return; }
                const accepted = await validateBrowserCapture(raw, frozen, raw?.capture?.revision, boundSession());
                if (disposed || signal.aborted || revision !== 0) return;
                record = accepted.record; review = accepted.review; receipt = accepted.receipt;
                revision = record.revision; latestSignature = JSON.stringify(frozen); emit('ready');
            } catch { if (!disposed && revision === 0) emit('degraded'); }
            finally { active = null; if (!disposed && pending) timer = setTimeout(() => void run(), options.delayMs ?? 400); }
        },
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
