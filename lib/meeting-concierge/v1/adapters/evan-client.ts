import type { MeetingConciergeClientAdapter, MeetingConciergeOrganizer } from '../contracts';

async function readJson(response: Response): Promise<Record<string, unknown>> {
    return await response.json().catch(() => ({})) as Record<string, unknown>;
}

export const evanMeetingConciergeAdapter: MeetingConciergeClientAdapter = {
    agent: {
        key: 'evan',
        name: 'Evan',
        role: 'Mullins Moving Concierge',
        returnHref: '/agents/evan',
        meetingApiPath: '/api/anam/evan/meetings',
        groupWakeName: 'Evan',
    },
    checkInEnabled: false,
    copy: {
        eyebrow: 'Meeting Concierge · Evan',
        confirmedTitle: 'Evan is ready to join.',
        personaBoundary: "Evan remains the Mullins Moving concierge. A meeting objective gives him context, but does not authorize a quote, booking, price, crew schedule, or service guarantee.",
        contactBoundary: 'Your approved account secures this invitation. Email follow-up remains a separate choice.',
        authenticatedLabel: 'Approved Evan organizer',
        checkInTitle: 'Prepare your invitation',
        checkInDescription: 'Your signed-in account is used to secure the meeting invitation.',
        consent: 'Meeting transcripts, recap emails, and returning memory are not included in Meeting Concierge v1.',
    },
    async prepareOrganizer(): Promise<MeetingConciergeOrganizer> {
        const response = await fetch('/api/anam/evan/access', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store',
            body: JSON.stringify({ guest: true }),
        });
        const payload = await readJson(response);
        if (!response.ok || payload.authenticated !== true) throw new Error(String(payload.error ?? 'Evan meeting access could not be prepared'));
        return { authenticated: true, displayName: typeof payload.displayName === 'string' ? payload.displayName : null };
    },
};
