type ClientFetch = typeof fetch;

type BindInput = {
    launchId: string;
    sessionId: string;
    fetchImpl?: ClientFetch;
};

type CompleteInput = BindInput & {
    closeReason: string;
    maxAttempts?: number;
    sleep?: (milliseconds: number) => Promise<void>;
};

export type AmyAnamCompletionResult = {
    accepted: boolean;
    status: string;
    receiptId?: string;
};

async function defaultSleep(milliseconds: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function bindAmyAnamClientSession({
    launchId,
    sessionId,
    fetchImpl = fetch,
}: BindInput): Promise<void> {
    const response = await fetchImpl('/api/anam/session/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchId, sessionId }),
        cache: 'no-store',
        credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`Amy session binding failed (${response.status})`);
}

export async function completeAmyAnamClientSession({
    launchId,
    sessionId,
    closeReason,
    fetchImpl = fetch,
    maxAttempts = 2,
    sleep = defaultSleep,
}: CompleteInput): Promise<AmyAnamCompletionResult> {
    const attempts = Math.max(1, Math.min(3, Math.floor(maxAttempts)));

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const response = await fetchImpl('/api/anam/session/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ launchId, sessionId, closeReason }),
            cache: 'no-store',
            credentials: 'same-origin',
            keepalive: true,
        });
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok && response.status !== 202) {
            throw new Error(`Amy session completion failed (${response.status})`);
        }

        const status = typeof payload.status === 'string' ? payload.status : 'accepted';
        if (response.status !== 202 || (status !== 'awaiting_transcript' && status !== 'processing')) {
            return {
                accepted: payload.accepted !== false,
                status,
                receiptId: typeof payload.receiptId === 'string' ? payload.receiptId : undefined,
            };
        }

        if (attempt < attempts - 1) {
            const requestedDelay = typeof payload.retryAfterMs === 'number'
                ? payload.retryAfterMs
                : 1_500;
            await sleep(Math.max(250, Math.min(2_000, requestedDelay)));
        }
    }

    return { accepted: true, status: 'awaiting_transcript' };
}
