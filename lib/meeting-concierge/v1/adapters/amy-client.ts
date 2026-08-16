import type { MeetingConciergeClientAdapter, MeetingConciergeOrganizer } from '../contracts';

async function readJson(response: Response): Promise<Record<string, unknown>> {
    return await response.json().catch(() => ({})) as Record<string, unknown>;
}

export const amyMeetingConciergeAdapter: MeetingConciergeClientAdapter = {
    agent: {
        key: 'amy',
        name: 'Amy',
        role: 'Senior SDR for Insight',
        returnHref: '/agents/amy',
        meetingApiPath: '/api/anam/amy/meetings',
        groupWakeName: 'Amy',
    },
    copy: {
        eyebrow: 'Meeting Concierge · Amy',
        confirmedTitle: 'Amy is on the agenda.',
        personaBoundary: "Amy's current Insight SDR persona remains in control. The objective is not used to rewrite her system prompt or expand her role.",
        contactBoundary: "The meeting module uses Amy's existing private check-in. It does not read another agent's contacts, memory, consent, sessions, or email workflows.",
        authenticatedLabel: "Secure Amy check-in active",
        checkInTitle: "Complete Amy's secure check-in",
        checkInDescription: "Use the same private check-in required for Amy's regular X Agent session.",
        consent: "By continuing, you agree to receive Amy's standard session follow-up at this private address. Amy will not ask you to repeat it during the meeting.",
    },
    checkIn: {
        kind: 'credentials',
        defaultMemoryConsent: false,
        async submit(fields): Promise<MeetingConciergeOrganizer> {
            const response = await fetch('/api/anam/amy/access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(fields),
            });
            const payload = await readJson(response);
            if (!response.ok || payload.authenticated !== true) throw new Error(String(payload.error ?? 'Amy check-in could not be completed'));
            return {
                authenticated: true,
                displayName: typeof payload.displayName === 'string' ? payload.displayName : fields.displayName,
            };
        },
    },
};
