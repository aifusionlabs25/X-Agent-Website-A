import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export class MeetingConciergeStatusTicketError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'MeetingConciergeStatusTicketError';
        this.status = status;
    }
}

type StatusTicketScope = {
    agentKey: string;
    isolationId: string;
    secret: string;
};

function organizerDigest(isolationId: string) {
    return createHash('sha256').update(isolationId).digest('base64url');
}

export function issueMeetingConciergeStatusTicket(scope: StatusTicketScope & { inviteId: string }) {
    const payload = Buffer.from(JSON.stringify({
        v: 1,
        agent: scope.agentKey,
        organizer: organizerDigest(scope.isolationId),
        inviteId: scope.inviteId,
    }), 'utf8').toString('base64url');
    const signature = createHmac('sha256', scope.secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

export function readMeetingConciergeStatusTicket(scope: StatusTicketScope & { ticket: string }) {
    if (!scope.ticket || scope.ticket.length > 1_024) throw new MeetingConciergeStatusTicketError('Meeting invitation identity was invalid', 400);
    const [payload, signature, ...extra] = scope.ticket.split('.');
    if (!payload || !signature || extra.length > 0) throw new MeetingConciergeStatusTicketError('Meeting invitation identity was invalid', 400);
    const expected = createHmac('sha256', scope.secret).update(payload).digest();
    let received: Buffer;
    try {
        received = Buffer.from(signature, 'base64url');
    } catch {
        throw new MeetingConciergeStatusTicketError('Meeting invitation identity was invalid', 400);
    }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        throw new MeetingConciergeStatusTicketError('Meeting invitation identity was invalid', 400);
    }
    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
        throw new MeetingConciergeStatusTicketError('Meeting invitation identity was invalid', 400);
    }
    if (!value || typeof value !== 'object') throw new MeetingConciergeStatusTicketError('Meeting invitation identity was invalid', 400);
    const record = value as Record<string, unknown>;
    if (record.v !== 1 || record.agent !== scope.agentKey || record.organizer !== organizerDigest(scope.isolationId)) {
        throw new MeetingConciergeStatusTicketError('Meeting invitation is not available to this organizer', 403);
    }
    const inviteId = typeof record.inviteId === 'string' ? record.inviteId : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inviteId)) {
        throw new MeetingConciergeStatusTicketError('Meeting invitation identity was invalid', 400);
    }
    return inviteId;
}
