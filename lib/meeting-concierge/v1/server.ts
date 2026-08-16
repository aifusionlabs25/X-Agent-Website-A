import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { MeetingConciergeInvite, MeetingConciergeOrganizer } from './contracts';
import {
    issueMeetingConciergeStatusTicket,
    MeetingConciergeStatusTicketError,
    readMeetingConciergeStatusTicket,
} from './tickets';

const ANAM_MEETINGS_URL = 'https://api.anam.ai/v1/meetings/invites';
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1_000;

type MeetingProvider = 'google_meet' | 'zoom' | 'microsoft_teams';

export type MeetingConciergeServerAdapter = {
    agentKey: string;
    agentName: string;
    displayName: string;
    resolvePersona(input: {
        apiKey: string;
        groupCall: boolean;
        maxSessionLengthSeconds: number;
    }): Promise<{ personaId: string } | { personaConfig: Record<string, unknown> }>;
    statusTokenSecret(): string;
    readOrganizer(request: Request): Promise<MeetingConciergeOrganizer & { isolationId: string } | null>;
    platform: {
        isTrustedBrowserOrigin(request: Request): boolean;
        readBoundedJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>>;
        requestFingerprint(request: Request, scope: string): string;
        consumeRateLimit(input: { fingerprint: string; limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
    };
};

class MeetingConciergeRequestError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'MeetingConciergeRequestError';
        this.status = status;
    }
}

function json(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function parseMeetingUrl(raw: unknown): { url: string; provider: MeetingProvider } {
    if (typeof raw !== 'string' || raw.length > 2_048) throw new MeetingConciergeRequestError('Enter a supported meeting link', 400);
    let parsed: URL;
    try {
        parsed = new URL(raw.trim());
    } catch {
        throw new MeetingConciergeRequestError('Enter a valid meeting link', 400);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
        throw new MeetingConciergeRequestError('Meeting links must use a secure HTTPS address', 400);
    }
    const hostname = parsed.hostname.toLowerCase();
    const provider = hostname === 'meet.google.com'
        ? 'google_meet'
        : hostname === 'zoom.us' || hostname.endsWith('.zoom.us')
            ? 'zoom'
            : hostname === 'teams.microsoft.com'
                || hostname.endsWith('.teams.microsoft.com')
                || hostname === 'teams.live.com'
                || hostname.endsWith('.teams.live.com')
                ? 'microsoft_teams'
                : null;
    if (!provider) throw new MeetingConciergeRequestError('Use a Google Meet, Zoom, or Microsoft Teams link', 400);
    parsed.hash = '';
    return { url: parsed.toString(), provider };
}

function parseJoinAt(raw: unknown, agentName: string) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string' || raw.length > 80) throw new MeetingConciergeRequestError(`Choose when ${agentName} should join`, 400);
    const timestamp = Date.parse(raw);
    const now = Date.now();
    if (!Number.isFinite(timestamp) || timestamp < now + 60_000) throw new MeetingConciergeRequestError('Choose a time at least one minute from now', 400);
    if (timestamp > now + MAX_SCHEDULE_AHEAD_MS) throw new MeetingConciergeRequestError('Anam meetings can be scheduled up to seven days ahead', 400);
    return new Date(timestamp).toISOString();
}

function parseDurationMinutes(raw: unknown) {
    if (![15, 30, 45, 60].includes(Number(raw))) {
        throw new MeetingConciergeRequestError('Choose a 15, 30, 45, or 60 minute safety limit', 400);
    }
    return Number(raw);
}

function parseInvite(payload: unknown): MeetingConciergeInvite {
    if (!payload || typeof payload !== 'object') throw new Error('Anam returned an invalid meeting invitation');
    const value = payload as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Anam returned an invalid meeting invitation');
    return {
        id,
        provider: typeof value.provider === 'string' ? value.provider : 'unknown',
        status: typeof value.status === 'string' ? value.status : 'pending',
        joinAt: typeof value.joinAt === 'string' ? value.joinAt : null,
        joinState: typeof value.joinState === 'string' ? value.joinState : null,
        sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
        statusReason: typeof value.statusReason === 'string' ? value.statusReason.slice(0, 500) : null,
    };
}

async function boundedAnamJson(response: Response) {
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error('Anam meeting response was too large');
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Anam meeting response was too large');
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        throw new Error('Anam returned an invalid meeting response');
    }
}

function readApiKey() {
    const apiKey = String(process.env.ANAM_API_KEY ?? '').trim();
    if (!apiKey) throw new Error('Anam meetings are not configured');
    return apiKey;
}

export function createMeetingConciergeHandlers(adapter: MeetingConciergeServerAdapter) {
    const requireOrganizer = async (request: Request) => {
        const organizer = await adapter.readOrganizer(request);
        if (!organizer) throw new MeetingConciergeRequestError(`Complete ${adapter.agentName}'s secure check-in before creating the invitation`, 401);
        return organizer;
    };

    const POST = async (request: Request) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 18_000);
        try {
            if (!adapter.platform.isTrustedBrowserOrigin(request)) return json({ error: 'Request origin is not allowed' }, { status: 403 });
            const preAuthRate = await adapter.platform.consumeRateLimit({
                fingerprint: adapter.platform.requestFingerprint(request, `${adapter.agentKey}-meeting-create-preauth`),
                limit: 15,
                windowSeconds: 15 * 60,
            });
            if (!preAuthRate.allowed) return json({ error: 'Too many meeting requests' }, { status: 429, headers: { 'Retry-After': String(preAuthRate.retryAfterSeconds) } });
            const organizer = await requireOrganizer(request);
            const organizerRate = await adapter.platform.consumeRateLimit({
                fingerprint: `${adapter.agentKey}-meeting-create:${organizer.isolationId}`,
                limit: 4,
                windowSeconds: 24 * 60 * 60,
            });
            if (!organizerRate.allowed) return json({ error: `This organizer has reached the daily ${adapter.agentName} meeting limit` }, { status: 429, headers: { 'Retry-After': String(organizerRate.retryAfterSeconds) } });
            const body = await adapter.platform.readBoundedJsonObject(request, 5 * 1024);
            const allowedFields = new Set(['meetingUrl', 'joinAt', 'groupCall', 'purpose', 'maxDurationMinutes']);
            if (Object.keys(body).some(key => !allowedFields.has(key))) return json({ error: 'Meeting request contained unsupported fields' }, { status: 400 });
            const meeting = parseMeetingUrl(body.meetingUrl);
            const joinAt = parseJoinAt(body.joinAt, adapter.agentName);
            if (typeof body.groupCall !== 'boolean') throw new MeetingConciergeRequestError('Choose a group or 1:1 meeting', 400);
            if (body.purpose !== undefined && (typeof body.purpose !== 'string' || body.purpose.length > 500)) throw new MeetingConciergeRequestError('Meeting purpose was too long', 400);
            const maxDurationMinutes = parseDurationMinutes(body.maxDurationMinutes);
            const apiKey = readApiKey();
            const persona = await adapter.resolvePersona({
                apiKey,
                groupCall: body.groupCall,
                maxSessionLengthSeconds: maxDurationMinutes * 60,
            });
            const response = await fetch(ANAM_MEETINGS_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    meetingUrl: meeting.url,
                    displayName: adapter.displayName,
                    ...persona,
                    ...(joinAt ? { joinAt } : {}),
                    groupCall: body.groupCall,
                    clientLabel: `xagent-${adapter.agentKey}-${randomUUID()}`,
                }),
                cache: 'no-store',
                signal: controller.signal,
            });
            const payload = await boundedAnamJson(response);
            if (!response.ok) {
                console.warn(`[${adapter.agentName} Meetings] Provider rejected invitation`, { status: response.status, provider: meeting.provider, sensitiveContentLogged: false });
                return json({ error: response.status === 429 ? 'Anam meeting capacity is currently full' : `${adapter.agentName} could not be added to that meeting` }, { status: response.status === 429 ? 429 : 502 });
            }
            const invite = parseInvite(payload);
            return json({
                invite: { ...invite, id: issueMeetingConciergeStatusTicket({
                    agentKey: adapter.agentKey,
                    isolationId: organizer.isolationId,
                    secret: adapter.statusTokenSecret(),
                    inviteId: invite.id,
                }) },
                meetingProvider: meeting.provider,
            }, { status: 201 });
        } catch (error) {
            if (error instanceof MeetingConciergeRequestError) return json({ error: error.message }, { status: error.status });
            const timedOut = error instanceof Error && error.name === 'AbortError';
            console.error(`[${adapter.agentName} Meetings] Invitation failed`, { reason: timedOut ? 'provider_timeout' : 'provider_error', sensitiveContentLogged: false });
            return json({ error: timedOut ? 'Anam did not respond in time' : `${adapter.agentName} meeting invitations are temporarily unavailable` }, { status: 503 });
        } finally {
            clearTimeout(timeout);
        }
    };

    const GET = async (request: Request) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6_000);
        try {
            const origin = request.headers.get('origin');
            if (origin && !adapter.platform.isTrustedBrowserOrigin(request)) return json({ error: 'Request origin is not allowed' }, { status: 403 });
            const rate = await adapter.platform.consumeRateLimit({
                fingerprint: adapter.platform.requestFingerprint(request, `${adapter.agentKey}-meeting-status-preauth`),
                limit: 90,
                windowSeconds: 15 * 60,
            });
            if (!rate.allowed) return json({ error: 'Too many status requests' }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } });
            const inviteId = new URL(request.url).searchParams.get('inviteId')?.trim() ?? '';
            if (!inviteId) {
                const organizer = await adapter.readOrganizer(request);
                return json({ authenticated: Boolean(organizer), displayName: organizer?.displayName ?? null, rawEmailReturned: false, memoryContentReturned: false });
            }
            const organizer = await requireOrganizer(request);
            const providerInviteId = readMeetingConciergeStatusTicket({
                agentKey: adapter.agentKey,
                isolationId: organizer.isolationId,
                secret: adapter.statusTokenSecret(),
                ticket: inviteId,
            });
            const response = await fetch(`${ANAM_MEETINGS_URL}/${encodeURIComponent(providerInviteId)}`, {
                headers: { Authorization: `Bearer ${readApiKey()}`, Accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
            });
            const payload = await boundedAnamJson(response);
            if (!response.ok) return json({ error: response.status === 404 ? 'Meeting invitation was not found' : 'Meeting status is temporarily unavailable' }, { status: response.status === 404 ? 404 : 502 });
            const invite = parseInvite(payload);
            return json({ invite: { ...invite, id: inviteId } });
        } catch (error) {
            if (error instanceof MeetingConciergeRequestError || error instanceof MeetingConciergeStatusTicketError) {
                return json({ error: error.message }, { status: error.status });
            }
            return json({ error: 'Meeting status is temporarily unavailable' }, { status: 503 });
        } finally {
            clearTimeout(timeout);
        }
    };

    const DELETE = async (request: Request) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        try {
            if (!adapter.platform.isTrustedBrowserOrigin(request)) return json({ error: 'Request origin is not allowed' }, { status: 403 });
            const preAuthRate = await adapter.platform.consumeRateLimit({
                fingerprint: adapter.platform.requestFingerprint(request, `${adapter.agentKey}-meeting-remove-preauth`),
                limit: 30,
                windowSeconds: 15 * 60,
            });
            if (!preAuthRate.allowed) return json({ error: 'Too many meeting removal requests' }, { status: 429, headers: { 'Retry-After': String(preAuthRate.retryAfterSeconds) } });
            const organizer = await requireOrganizer(request);
            const organizerRate = await adapter.platform.consumeRateLimit({
                fingerprint: `${adapter.agentKey}-meeting-remove:${organizer.isolationId}`,
                limit: 12,
                windowSeconds: 24 * 60 * 60,
            });
            if (!organizerRate.allowed) return json({ error: `This organizer has reached the daily ${adapter.agentName} meeting removal limit` }, { status: 429, headers: { 'Retry-After': String(organizerRate.retryAfterSeconds) } });
            const body = await adapter.platform.readBoundedJsonObject(request, 2 * 1024);
            if (Object.keys(body).some(key => key !== 'inviteId')) return json({ error: 'Meeting removal request contained unsupported fields' }, { status: 400 });
            const ticket = typeof body.inviteId === 'string' ? body.inviteId.trim() : '';
            const providerInviteId = readMeetingConciergeStatusTicket({
                agentKey: adapter.agentKey,
                isolationId: organizer.isolationId,
                secret: adapter.statusTokenSecret(),
                ticket,
            });
            const response = await fetch(`${ANAM_MEETINGS_URL}/${encodeURIComponent(providerInviteId)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${readApiKey()}`, Accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
            });
            if (!response.ok) {
                console.warn(`[${adapter.agentName} Meetings] Provider rejected removal`, { status: response.status, sensitiveContentLogged: false });
                return json({ error: response.status === 404 ? 'Meeting invitation was not found' : `${adapter.agentName} could not be removed from the meeting` }, { status: response.status === 404 ? 404 : 502 });
            }
            return json({
                invite: {
                    id: ticket,
                    provider: 'unknown',
                    status: 'cancelled',
                    joinAt: null,
                    joinState: 'left',
                    sessionId: null,
                    statusReason: null,
                },
            });
        } catch (error) {
            if (error instanceof MeetingConciergeRequestError || error instanceof MeetingConciergeStatusTicketError) {
                return json({ error: error.message }, { status: error.status });
            }
            const timedOut = error instanceof Error && error.name === 'AbortError';
            return json({ error: timedOut ? 'Anam did not respond in time' : `${adapter.agentName} meeting removal is temporarily unavailable` }, { status: 503 });
        } finally {
            clearTimeout(timeout);
        }
    };

    return { DELETE, GET, POST };
}
