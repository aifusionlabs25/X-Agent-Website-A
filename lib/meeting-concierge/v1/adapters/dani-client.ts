import type { MeetingConciergeClientAdapter, MeetingConciergeOrganizer } from '../contracts';

async function readJson(response: Response): Promise<Record<string, unknown>> {
    return await response.json().catch(() => ({})) as Record<string, unknown>;
}

export const daniMeetingConciergeAdapter: MeetingConciergeClientAdapter = {
    agent: {
        key: 'dani',
        name: 'Dani',
        role: 'AI Solutions Director',
        returnHref: '/agents/dani',
        meetingApiPath: '/api/anam/dani/meetings',
        groupWakeName: 'Dani',
    },
    copy: {
        eyebrow: 'Meeting Concierge · Dani',
        confirmedTitle: 'Dani is on the agenda.',
        personaBoundary: "Dani's current AI Solutions Director persona remains in control. The objective is not used to rewrite her system prompt or expand her authority.",
        contactBoundary: "The meeting module uses Dani's verified follow-up identity only. It does not read another agent's contacts, memory, consent, sessions, or email workflows.",
        authenticatedLabel: 'Verified Dani organizer',
        checkInTitle: 'Verify the organizer',
        checkInDescription: 'A one-time code protects the meeting invitation and requested follow-up.',
        consent: "The verified address authorizes Dani's standard meeting follow-up. Dani will not ask anyone to say an email address aloud.",
    },
    checkIn: {
        kind: 'email-code',
        async requestCode(fields) {
            const response = await fetch('/api/anam/dani/access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    displayName: fields.displayName,
                    email: fields.email,
                    followUpConsent: true,
                    memoryConsent: false,
                }),
            });
            const payload = await readJson(response);
            if (!response.ok || typeof payload.challengeId !== 'string') {
                throw new Error(String(payload.error ?? 'Dani verification email could not be sent'));
            }
            return { challengeId: payload.challengeId };
        },
        async verifyCode(fields): Promise<MeetingConciergeOrganizer> {
            const response = await fetch('/api/anam/dani/access/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(fields),
            });
            const payload = await readJson(response);
            if (!response.ok || payload.followUpAuthorized !== true) {
                throw new Error(String(payload.error ?? 'Dani verification code was not accepted'));
            }
            return {
                authenticated: true,
                displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
            };
        },
    },
};
