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
    copy: {
        eyebrow: 'Meeting Concierge · Evan',
        confirmedTitle: 'Evan is ready to join.',
        personaBoundary: "Evan remains the Mullins Moving concierge. A meeting objective gives him context, but does not authorize a quote, booking, price, crew schedule, or service guarantee.",
        contactBoundary: "This invitation uses Evan's Mullins Moving check-in only. It does not read other agents' contacts, memory, consent, sessions, or email workflows.",
        authenticatedLabel: 'Secure Evan organizer check-in active',
        checkInTitle: 'Secure the meeting invitation',
        checkInDescription: 'Add the organizer name and email Mullins Moving may use for this invitation and related follow-up.',
        consent: 'Submitting this form authorizes Mullins Moving to use this email for the invitation and related follow-up. Meeting transcripts, recap emails, and returning memory are not included in Meeting Concierge v1.',
    },
    checkIn: {
        kind: 'contact',
        async submit(fields): Promise<MeetingConciergeOrganizer> {
            const response = await fetch('/api/anam/evan/access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({
                    displayName: fields.displayName,
                    email: fields.email,
                    followUpConsent: true,
                }),
            });
            const payload = await readJson(response);
            if (!response.ok || payload.followUpAuthorized !== true) {
                throw new Error(String(payload.error ?? 'Evan check-in could not be completed'));
            }
            return {
                authenticated: true,
                displayName: typeof payload.displayName === 'string' ? payload.displayName : fields.displayName,
            };
        },
    },
};
