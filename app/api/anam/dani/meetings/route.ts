import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { DANI_PERSONA_ID } from '@/lib/anam/persona-ids';
import {
    AmyAnamRequestError,
    isTrustedBrowserOrigin,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    requestFingerprint,
} from '@/lib/anam/session-spine';
import {
    readDaniAnamBrowserSession,
    readDaniAnamSessionSecrets,
} from '@/lib/anam/dani-session';
import { readDaniAnamContactFromRequest } from '@/lib/anam/contact-token';
import { readDaniAnamFollowUpAuthorization } from '@/lib/anam/dani-agentmail';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';

const ANAM_MEETINGS_URL = 'https://api.anam.ai/v1/meetings/invites';
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1_000;

type MeetingProvider = 'google_meet' | 'zoom' | 'microsoft_teams';

function json(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function readApiKey() {
    const apiKey = String(process.env.ANAM_API_KEY ?? '').trim();
    if (!apiKey) throw new Error('Anam meetings are not configured');
    return apiKey;
}

function parseMeetingUrl(raw: unknown): { url: string; provider: MeetingProvider } {
    if (typeof raw !== 'string' || raw.length > 2_048) {
        throw new AmyAnamRequestError('Enter a supported meeting link', 400);
    }
    let parsed: URL;
    try {
        parsed = new URL(raw.trim());
    } catch {
        throw new AmyAnamRequestError('Enter a valid meeting link', 400);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
        throw new AmyAnamRequestError('Meeting links must use a secure HTTPS address', 400);
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
    if (!provider) throw new AmyAnamRequestError('Use a Google Meet, Zoom, or Microsoft Teams link', 400);
    parsed.hash = '';
    return { url: parsed.toString(), provider };
}

function parseJoinAt(raw: unknown) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string' || raw.length > 80) {
        throw new AmyAnamRequestError('Choose when Dani should join', 400);
    }
    const timestamp = Date.parse(raw);
    const now = Date.now();
    if (!Number.isFinite(timestamp) || timestamp < now + 60_000) {
        throw new AmyAnamRequestError('Choose a time at least one minute from now', 400);
    }
    if (timestamp > now + MAX_SCHEDULE_AHEAD_MS) {
        throw new AmyAnamRequestError('Anam meetings can be scheduled up to seven days ahead', 400);
    }
    return new Date(timestamp).toISOString();
}

function parseInvite(payload: unknown) {
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

async function requireVerifiedOrganizer(request: Request) {
    const spine = readAmyAnamSpineConfig();
    const secrets = readDaniAnamSessionSecrets();
    if (!spine.gatesOpen || !secrets.configured) throw new AmyAnamRequestError('Dani meeting invitations are temporarily unavailable', 503);
    const browser = readDaniAnamBrowserSession(request, secrets.sessionSecret);
    if (!browser) throw new AmyAnamRequestError('Verify the organizer before inviting Dani', 401);
    const cookieContact = readDaniAnamContactFromRequest({
        request,
        browserSessionId: browser.id,
        secret: secrets.contactSecret,
    });
    const storedContact = cookieContact ?? await readDaniAnamFollowUpAuthorization({
        browserSessionId: browser.id,
        contactSecret: secrets.contactSecret,
    });
    const contact = storedContact?.emailOwnershipVerified === true ? storedContact : null;
    if (contact?.purpose !== 'dani_follow_up' || contact.emailOwnershipVerified !== true) {
        throw new AmyAnamRequestError('Verify the organizer before inviting Dani', 401);
    }
    return { browser };
}

export async function POST(request: Request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
        if (!isTrustedBrowserOrigin(request)) return json({ error: 'Request origin is not allowed' }, { status: 403 });
        const preAuthRate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: requestFingerprint(request, 'dani-meeting-create-preauth'),
            limit: 15,
            windowSeconds: 15 * 60,
        });
        if (!preAuthRate.allowed) {
            return json({ error: 'Too many meeting requests' }, { status: 429, headers: { 'Retry-After': String(preAuthRate.retryAfterSeconds) } });
        }
        const { browser } = await requireVerifiedOrganizer(request);
        const organizerRate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: `dani-meeting-create:${browser.id}`,
            limit: 4,
            windowSeconds: 24 * 60 * 60,
        });
        if (!organizerRate.allowed) {
            return json({ error: 'This organizer has reached the daily Dani meeting limit' }, { status: 429, headers: { 'Retry-After': String(organizerRate.retryAfterSeconds) } });
        }
        const body = await readBoundedJsonObject(request, 5 * 1024);
        const allowedFields = new Set(['meetingUrl', 'joinAt', 'groupCall', 'purpose']);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return json({ error: 'Meeting request contained unsupported fields' }, { status: 400 });
        }
        const meeting = parseMeetingUrl(body.meetingUrl);
        const joinAt = parseJoinAt(body.joinAt);
        if (typeof body.groupCall !== 'boolean') throw new AmyAnamRequestError('Choose a group or 1:1 meeting', 400);
        if (body.purpose !== undefined && (typeof body.purpose !== 'string' || body.purpose.length > 500)) {
            throw new AmyAnamRequestError('Meeting purpose was too long', 400);
        }
        const response = await fetch(ANAM_MEETINGS_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${readApiKey()}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                meetingUrl: meeting.url,
                displayName: 'Dani AI Solutions Director',
                personaId: DANI_PERSONA_ID,
                ...(joinAt ? { joinAt } : {}),
                groupCall: body.groupCall,
                clientLabel: `xagent-dani-${randomUUID()}`,
            }),
            cache: 'no-store',
            signal: controller.signal,
        });
        const payload = await boundedAnamJson(response);
        if (!response.ok) {
            console.warn('[Dani Meetings] Provider rejected invitation', { status: response.status, provider: meeting.provider, sensitiveContentLogged: false });
            return json({ error: response.status === 429 ? 'Anam meeting capacity is currently full' : 'Dani could not be added to that meeting' }, { status: response.status === 429 ? 429 : 502 });
        }
        return json({ invite: parseInvite(payload), meetingProvider: meeting.provider }, { status: 201 });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) return json({ error: error.message }, { status: error.status });
        const timedOut = error instanceof Error && error.name === 'AbortError';
        console.error('[Dani Meetings] Invitation failed', { reason: timedOut ? 'provider_timeout' : 'provider_error', sensitiveContentLogged: false });
        return json({ error: timedOut ? 'Anam did not respond in time' : 'Dani meeting invitations are temporarily unavailable' }, { status: 503 });
    } finally {
        clearTimeout(timeout);
    }
}

export async function GET(request: Request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
        if (!isTrustedBrowserOrigin(request)) return json({ error: 'Request origin is not allowed' }, { status: 403 });
        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: requestFingerprint(request, 'dani-meeting-status-preauth'),
            limit: 90,
            windowSeconds: 15 * 60,
        });
        if (!rate.allowed) return json({ error: 'Too many status requests' }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } });
        await requireVerifiedOrganizer(request);
        const inviteId = new URL(request.url).searchParams.get('inviteId')?.trim() ?? '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inviteId)) {
            return json({ error: 'Meeting invitation identity was invalid' }, { status: 400 });
        }
        const response = await fetch(`${ANAM_MEETINGS_URL}/${encodeURIComponent(inviteId)}`, {
            headers: { Authorization: `Bearer ${readApiKey()}`, Accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
        });
        const payload = await boundedAnamJson(response);
        if (!response.ok) return json({ error: response.status === 404 ? 'Meeting invitation was not found' : 'Meeting status is temporarily unavailable' }, { status: response.status === 404 ? 404 : 502 });
        return json({ invite: parseInvite(payload) });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) return json({ error: error.message }, { status: error.status });
        return json({ error: 'Meeting status is temporarily unavailable' }, { status: 503 });
    } finally {
        clearTimeout(timeout);
    }
}
