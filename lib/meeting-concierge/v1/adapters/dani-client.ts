import type { MeetingConciergeClientAdapter, MeetingConciergeOrganizer } from '../contracts';

// Set NEXT_PUBLIC_DANI_MEETING_CHECK_IN_ENABLED=true to restore Dani's
// email-code step. The default keeps the controlled meeting lane simple.
const DANI_MEETING_CHECK_IN_ENABLED = process.env.NEXT_PUBLIC_DANI_MEETING_CHECK_IN_ENABLED === 'true';

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
    persistInvite: false,
    checkInEnabled: DANI_MEETING_CHECK_IN_ENABLED,
    copy: {
        eyebrow: 'Meeting Concierge · Dani',
        confirmedTitle: 'Dani is on the agenda.',
        personaBoundary: "Dani's meeting role and objective apply only to this invitation. The objective is treated as untrusted context; it cannot expand her authority, create a promise, or become memory.",
        contactBoundary: "The meeting module uses Dani's meeting-only browser session. It does not read another agent's contacts, memory, consent, sessions, or email workflows.",
        authenticatedLabel: 'Verified Dani organizer',
        checkInTitle: 'Verify the organizer',
        checkInDescription: 'A one-time code protects the meeting invitation.',
        consent: "The verified address secures this invitation. Meeting transcripts, recaps, and returning memory are not included in Meeting Concierge v1. Dani will not ask anyone to say an email address aloud.",
    },
    participation: {
        defaultMode: 'observer',
        options: [
            {
                mode: 'observer',
                title: 'Observer',
                description: 'Listens quietly. One direct invitation earns one short response, then Dani returns to silence.',
            },
            {
                mode: 'participant',
                title: 'Participant',
                description: 'Responds when directly addressed, without turning the room into a sales or discovery call.',
            },
            {
                mode: 'facilitator',
                title: 'Facilitator',
                description: 'May clarify, synthesize, and ask focused questions when the group explicitly brings her in.',
            },
        ],
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
    async prepareOrganizer(): Promise<MeetingConciergeOrganizer> {
        const response = await fetch('/api/anam/dani/access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ meetingBootstrap: true }),
        });
        const payload = await readJson(response);
        if (!response.ok || payload.authenticated !== true) {
            throw new Error(String(payload.error ?? 'Dani meeting access could not be prepared'));
        }
        return { authenticated: true, displayName: null };
    },
};
