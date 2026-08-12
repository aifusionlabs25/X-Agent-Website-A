type ClientFetch = typeof fetch;

type SendEmailInput = {
    launchId: string;
    sessionId: string;
    userConfirmed: true;
    callbackPhone?: string;
    callbackPhoneConfirmed?: true;
    fetchImpl?: ClientFetch;
};

export type AmyAnamEmailResult = {
    status: 'email_queued' | 'email_already_queued';
    queued: true;
    sent: false;
    duplicate: boolean;
    receiptId: string;
    provider: 'agentmail';
};

export type DaniAnamEmailPreferenceResult = {
    status: 'email_already_queued' | 'email_cancelled' | 'email_queued';
    queued: boolean;
    sent: false;
    duplicate: boolean;
    receiptId: string | null;
    provider: 'agentmail';
};

export async function sendAmyAnamFollowUpEmail({
    launchId,
    sessionId,
    userConfirmed,
    fetchImpl = fetch,
}: SendEmailInput): Promise<AmyAnamEmailResult> {
    const response = await fetchImpl('/api/anam/session/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchId, sessionId, userConfirmed }),
        cache: 'no-store',
        credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (
        !response.ok
        || !['email_queued', 'email_already_queued'].includes(String(payload.status))
        || payload.queued !== true
        || payload.sent !== false
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
        queued: true,
        duplicate: payload.duplicate,
        receiptId: payload.receiptId,
        provider: 'agentmail',
    };
}

export async function setDaniAnamFollowUpPreference({
    launchId,
    sessionId,
    userConfirmed,
    callbackPhone,
    callbackPhoneConfirmed,
    fetchImpl = fetch,
}: Omit<SendEmailInput, 'userConfirmed'> & { userConfirmed: boolean }): Promise<DaniAnamEmailPreferenceResult> {
    const response = await fetchImpl('/api/anam/session/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            launchId,
            sessionId,
            userConfirmed,
            ...(callbackPhone && callbackPhoneConfirmed === true
                ? { callbackPhone, callbackPhoneConfirmed: true }
                : {}),
        }),
        cache: 'no-store',
        credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const status = String(payload.status);
    const validStatus = ['email_queued', 'email_already_queued', 'email_cancelled'].includes(status);
    const receiptShapeValid = status === 'email_cancelled'
        ? payload.receiptId === null
        : typeof payload.receiptId === 'string';
    if (
        !response.ok
        || !validStatus
        || typeof payload.queued !== 'boolean'
        || payload.sent !== false
        || typeof payload.duplicate !== 'boolean'
        || !receiptShapeValid
        || payload.provider !== 'agentmail'
    ) {
        const message = typeof payload.error === 'string'
            ? payload.error
            : `Dani email preference failed (${response.status})`;
        throw new Error(message);
    }
    return {
        status: status as DaniAnamEmailPreferenceResult['status'],
        queued: payload.queued,
        sent: false,
        duplicate: payload.duplicate,
        receiptId: payload.receiptId as string | null,
        provider: 'agentmail',
    };
}
