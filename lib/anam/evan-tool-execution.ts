export const EVAN_TOOL_DEADLINE_MS = 8_000;
export const EVAN_TOOL_MAX_DEADLINE_MS = 10_000;

export type EvanToolExecutionFailureCode = 'timeout' | 'aborted' | 'failed';

const FAILURE_MESSAGES: Record<EvanToolExecutionFailureCode, string> = {
    timeout: 'The Evan tool did not finish before its deadline.',
    aborted: 'The Evan tool was cancelled.',
    failed: 'The Evan tool could not complete.',
};

// Never attach the original exception or abort reason: either can include
// contact details, street addresses, request URLs, or provider credentials.
export class EvanToolExecutionError extends Error {
    readonly code: EvanToolExecutionFailureCode;

    constructor(code: EvanToolExecutionFailureCode) {
        super(FAILURE_MESSAGES[code]);
        this.name = 'EvanToolExecutionError';
        this.code = code;
    }
}

type ExecutionOptions = {
    timeoutMs?: number;
    signal?: AbortSignal;
};

/**
 * Bound the whole tool operation, including session-binding waits, below the
 * provider's 15-second deadline. This invokes the operation exactly once.
 *
 * The operation must pass this signal to fetch and check signal.throwIfAborted()
 * after any non-abortable await, before starting a side effect or committing UI
 * state. A timeout cannot undo a request the server has already accepted; do
 * not automatically retry email from a timeout or claim it was not scheduled.
 * Late promise results/rejections are consumed but never change this outcome.
 */
export function runEvanToolWithDeadline<T>(
    operation: (signal: AbortSignal) => T | PromiseLike<T>,
    options: ExecutionOptions = {},
): Promise<T> {
    const requestedTimeout = options.timeoutMs ?? EVAN_TOOL_DEADLINE_MS;
    if (!Number.isFinite(requestedTimeout) || requestedTimeout < 1) {
        return Promise.reject(new EvanToolExecutionError('failed'));
    }
    const timeoutMs = Math.min(EVAN_TOOL_MAX_DEADLINE_MS, Math.floor(requestedTimeout));
    const controller = new AbortController();

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
            if (timer !== null) clearTimeout(timer);
            options.signal?.removeEventListener('abort', onExternalAbort);
        };
        const fail = (code: EvanToolExecutionFailureCode) => {
            if (settled) return;
            settled = true;
            cleanup();
            const error = new EvanToolExecutionError(code);
            reject(error);
            controller.abort(error);
        };
        const onExternalAbort = () => fail('aborted');

        if (options.signal?.aborted) {
            fail('aborted');
            return;
        }
        options.signal?.addEventListener('abort', onExternalAbort, { once: true });
        timer = setTimeout(() => fail('timeout'), timeoutMs);

        // Defer invocation so synchronous throws are sanitized by the same path.
        Promise.resolve().then(() => {
            controller.signal.throwIfAborted();
            return operation(controller.signal);
        }).then(value => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        }, () => fail('failed'));
    });
}
