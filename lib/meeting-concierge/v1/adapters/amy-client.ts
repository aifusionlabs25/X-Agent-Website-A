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
    checkInEnabled: false,
    copy: {
        eyebrow: 'Meeting Concierge · Amy',
        confirmedTitle: 'Amy is on the agenda.',
        personaBoundary: "Amy's current Insight SDR persona remains in control. The objective is not used to rewrite her system prompt or expand her role.",
        contactBoundary: "Your approved account secures this invitation. Email follow-up and returning memory remain separate choices.",
        authenticatedLabel: "Approved Amy organizer",
        checkInTitle: "Prepare your invitation",
        checkInDescription: "Your signed-in account is used to secure the meeting invitation.",
        consent: "Meeting transcripts, recaps, and returning memory are not included in Meeting Concierge v1. Amy will not ask you to repeat the address during the meeting.",
    },
    async prepareOrganizer(): Promise<MeetingConciergeOrganizer> {
        const accountResponse = await fetch('/api/access', { credentials: 'same-origin', cache: 'no-store' });
        const account = await readJson(accountResponse);
        if (!accountResponse.ok || account.authenticated !== true) throw new Error('Sign in to prepare your meeting invitation');
        const name = typeof account.displayName === 'string' ? account.displayName.trim() : '';
        const displayName = name.length >= 2 ? name : 'Meeting organizer';
        const response = await fetch('/api/anam/amy/access', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store',
            body: JSON.stringify({ displayName, memoryConsent: false, followUpConsent: false }),
        });
        const payload = await readJson(response);
        if (!response.ok || payload.authenticated !== true) throw new Error(String(payload.error ?? 'Amy meeting access could not be prepared'));
        return { authenticated: true, displayName: typeof payload.displayName === 'string' ? payload.displayName : displayName };
    },
};
