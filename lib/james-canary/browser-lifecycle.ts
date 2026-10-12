/** Browser connection attempts are separate from persisted conversation notes. */
export type JamesBrowserAttempt = {
    serial: number;
    cancelled: boolean;
    finished: boolean;
    settled: Promise<void>;
};

/** Keep a cancelled, pending SDK start in its slot until it can be cleaned up. */
export class JamesBrowserAttemptGate {
    #serial = 0;
    #current: JamesBrowserAttempt | null = null;
    #resolvers = new Map<JamesBrowserAttempt, () => void>();

    get current(): JamesBrowserAttempt | null { return this.#current; }

    begin(): JamesBrowserAttempt | null {
        if (this.#current && (!this.#current.cancelled || !this.#current.finished)) return null;
        let resolveSettled!: () => void;
        const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
        const attempt: JamesBrowserAttempt = {
            serial: ++this.#serial,
            cancelled: false,
            finished: false,
            settled,
        };
        this.#resolvers.set(attempt, resolveSettled);
        this.#current = attempt;
        return attempt;
    }

    isCurrent(attempt: JamesBrowserAttempt): boolean {
        return this.#current === attempt && !attempt.cancelled;
    }

    cancel(attempt: JamesBrowserAttempt | null = this.#current): void {
        if (!attempt || this.#current !== attempt) return;
        attempt.cancelled = true;
        if (attempt.finished) this.#current = null;
    }

    settle(attempt: JamesBrowserAttempt): void {
        const resolveSettled = this.#resolvers.get(attempt);
        if (!resolveSettled) return;
        attempt.finished = true;
        this.#resolvers.delete(attempt);
        if (attempt.cancelled && this.#current === attempt) this.#current = null;
        resolveSettled();
    }
}

export function browserStartAllowed(input: {
    restoring: boolean;
    busy: boolean;
    hasBrowserAttempt: boolean;
}): boolean {
    return !input.restoring && !input.busy && !input.hasBrowserAttempt;
}

/** A provider warning is an advisory, never proof that audio is echo-free. */
export function echoAdvisory(warning: unknown): string | null {
    if (typeof warning !== 'string') return null;
    const normalized = warning.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!/\b(?:echo|(?:audio|microphone|acoustic) feedback|feedback detected)\b/.test(normalized)) return null;
    return 'Possible audio feedback. Try headphones or lower speaker volume.';
}
