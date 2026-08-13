export const MEETING_CONCIERGE_VERSION = 'v1' as const;

export const MEETING_CONCIERGE_PROVIDERS = ['google', 'zoom', 'teams'] as const;
export type MeetingConciergeProvider = (typeof MEETING_CONCIERGE_PROVIDERS)[number];
export type MeetingConciergeJoinTiming = 'now' | 'scheduled';

export const MEETING_CONCIERGE_DURATION_MINUTES = [15, 30, 45, 60] as const;
export type MeetingConciergeDurationMinutes = (typeof MEETING_CONCIERGE_DURATION_MINUTES)[number];

export type MeetingConciergeInvite = {
    id: string;
    provider: string;
    status: string;
    joinAt: string | null;
    joinState: string | null;
    sessionId: string | null;
    statusReason: string | null;
};

export type MeetingConciergeOrganizer = {
    authenticated: boolean;
    displayName: string | null;
};

export type MeetingConciergeCreateInput = {
    meetingUrl: string;
    joinAt?: string;
    groupCall: boolean;
    purpose: string;
    maxDurationMinutes: MeetingConciergeDurationMinutes;
};

export type MeetingConciergeStoredInvite = {
    invite: MeetingConciergeInvite;
    provider: MeetingConciergeProvider;
    groupCall: boolean;
    maxDurationMinutes: MeetingConciergeDurationMinutes;
    savedAt: number;
};

export type MeetingConciergeCheckInFields = {
    displayName: string;
    email: string;
    accessCode: string;
    memoryConsent: boolean;
};

export type MeetingConciergeClientAdapter = {
    agent: {
        key: string;
        name: string;
        role: string;
        returnHref: string;
        meetingApiPath: string;
        groupWakeName: string;
    };
    copy: {
        eyebrow: string;
        confirmedTitle: string;
        personaBoundary: string;
        contactBoundary: string;
        authenticatedLabel: string;
        checkInTitle: string;
        checkInDescription: string;
        consent: string;
    };
    checkIn?: {
        submit(fields: MeetingConciergeCheckInFields): Promise<MeetingConciergeOrganizer>;
        defaultMemoryConsent: boolean;
    };
};
