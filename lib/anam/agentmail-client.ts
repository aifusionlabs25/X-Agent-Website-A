type ClientFetch = typeof fetch;

type SendEmailInput = {
    launchId: string;
    sessionId: string;
    userConfirmed: true;
    transcript: Array<{ role: string; content: string }>;
    fetchImpl?: ClientFetch;
};

export type AmyAnamEmailResult = {
    status: 'email_sent' | 'email_already_attempted';
    sent: boolean;
    duplicate: boolean;
    receiptId: string;
    provider: 'agentmail';
};

export async function sendAmyAnamFollowUpEmail({
    launchId,
    sessionId,
    userConfirmed,
    transcript,
    fetchImpl = fetch,
}: SendEmailInput): Promise<AmyAnamEmailResult> {
    const response = await fetchImpl('/api/anam/session/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchId, sessionId, userConfirmed, transcript }),
        cache: 'no-store',
        credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (
        !response.ok
        || !['email_sent', 'email_already_attempted'].includes(String(payload.status))
        || typeof payload.sent !== 'boolean'
        || typeof payload.duplicate !== 'boolean'
        || typeof payload.receiptId !== 'string'
        || payload.provider !== 'agentmail'
    ) {
        const message = typeof payload.error === 'string'
            ? payload.error
            : `Amy email delivery failed (${response.status})`;
        throw new Error(message);
    }
    return {
        status: payload.status as AmyAnamEmailResult['status'],
        sent: payload.sent,
        duplicate: payload.duplicate,
        receiptId: payload.receiptId,
        provider: 'agentmail',
    };
}
