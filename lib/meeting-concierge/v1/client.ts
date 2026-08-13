import type {
    MeetingConciergeCreateInput,
    MeetingConciergeDurationMinutes,
    MeetingConciergeInvite,
    MeetingConciergeOrganizer,
    MeetingConciergeProvider,
    MeetingConciergeStoredInvite,
} from './contracts.ts';
import { MEETING_CONCIERGE_DURATION_MINUTES, MEETING_CONCIERGE_PROVIDERS } from './contracts.ts';

const STORAGE_PREFIX = 'x-agent-meeting-concierge-v1';
const MAX_STORED_INVITE_AGE_MS = 8 * 24 * 60 * 60 * 1_000;

function storageKey(agentKey: string) {
    return `${STORAGE_PREFIX}:${agentKey}`;
}

function isDuration(value: unknown): value is MeetingConciergeDurationMinutes {
    return MEETING_CONCIERGE_DURATION_MINUTES.includes(value as MeetingConciergeDurationMinutes);
}

function isProvider(value: unknown): value is MeetingConciergeProvider {
    return MEETING_CONCIERGE_PROVIDERS.includes(value as MeetingConciergeProvider);
}

function isInvite(value: unknown): value is MeetingConciergeInvite {
    if (!value || typeof value !== 'object') return false;
    const invite = value as Record<string, unknown>;
    return typeof invite.id === 'string'
        && invite.id.length > 20
        && typeof invite.status === 'string'
        && typeof invite.provider === 'string';
}

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

export async function removeMeetingConciergeInvite(apiPath: string, inviteId: string): Promise<MeetingConciergeInvite> {
    const response = await fetch(apiPath, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ inviteId }),
    });
    const payload = await readJson(response) as { invite?: MeetingConciergeInvite; error?: string };
    if (!response.ok || !payload.invite) throw new Error(payload.error || 'The meeting participant could not be removed');
    return payload.invite;
}

export function isMeetingConciergeInviteTerminal(invite: MeetingConciergeInvite) {
    return ['ended', 'failed', 'cancelled'].includes(invite.status)
        || ['left', 'done', 'error'].includes(invite.joinState ?? '');
}

export function storeMeetingConciergeInvite(agentKey: string, value: MeetingConciergeStoredInvite, storage: Storage = window.localStorage) {
    storage.setItem(storageKey(agentKey), JSON.stringify(value));
}

export function readStoredMeetingConciergeInvite(agentKey: string, storage: Storage = window.localStorage): MeetingConciergeStoredInvite | null {
    try {
        const raw = storage.getItem(storageKey(agentKey));
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<MeetingConciergeStoredInvite>;
        if (!isInvite(value.invite)
            || !isProvider(value.provider)
            || typeof value.groupCall !== 'boolean'
            || !isDuration(value.maxDurationMinutes)
            || typeof value.savedAt !== 'number'
            || Date.now() - value.savedAt > MAX_STORED_INVITE_AGE_MS) {
            storage.removeItem(storageKey(agentKey));
            return null;
        }
        return value as MeetingConciergeStoredInvite;
    } catch {
        storage.removeItem(storageKey(agentKey));
        return null;
    }
}

export function clearStoredMeetingConciergeInvite(agentKey: string, storage: Storage = window.localStorage) {
    storage.removeItem(storageKey(agentKey));
}
