import type {
    MeetingConciergeCreateInput,
    MeetingConciergeInvite,
    MeetingConciergeOrganizer,
    MeetingConciergeProvider,
} from './contracts';

export function detectMeetingConciergeProvider(value: string): MeetingConciergeProvider | null {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        if (hostname === 'meet.google.com') return 'google';
        if (hostname === 'zoom.us' || hostname.endsWith('.zoom.us')) return 'zoom';
        if (hostname === 'teams.microsoft.com' || hostname.endsWith('.teams.microsoft.com') || hostname === 'teams.live.com' || hostname.endsWith('.teams.live.com')) return 'teams';
    } catch {
        // An incomplete link is expected while the visitor is typing.
    }
    return null;
}

export function localMeetingConciergeDate(daysAhead = 1) {
    const date = new Date();
    date.setDate(date.getDate() + daysAhead);
    return date.toLocaleDateString('en-CA');
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
    return await response.json().catch(() => ({})) as Record<string, unknown>;
}

export async function readMeetingConciergeOrganizer(apiPath: string): Promise<MeetingConciergeOrganizer> {
    const response = await fetch(apiPath, { cache: 'no-store', credentials: 'same-origin' });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(String(payload.error ?? 'Meeting Concierge is unavailable'));
    return {
        authenticated: payload.authenticated === true,
        displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
    };
}

export async function createMeetingConciergeInvite(apiPath: string, input: MeetingConciergeCreateInput): Promise<MeetingConciergeInvite> {
    const response = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(input),
    });
    const payload = await readJson(response) as { invite?: MeetingConciergeInvite; error?: string };
    if (!response.ok || !payload.invite) throw new Error(payload.error || 'The agent could not be scheduled');
    return payload.invite;
}

export async function readMeetingConciergeInvite(apiPath: string, inviteId: string): Promise<MeetingConciergeInvite> {
    const response = await fetch(`${apiPath}?inviteId=${encodeURIComponent(inviteId)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
    });
    const payload = await readJson(response) as { invite?: MeetingConciergeInvite; error?: string };
    if (!response.ok || !payload.invite) throw new Error(payload.error || 'Meeting status is unavailable');
    return payload.invite;
}
