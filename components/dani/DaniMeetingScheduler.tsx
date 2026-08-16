'use client';

import MeetingConcierge, { type MeetingConciergeStyleContract } from '@/components/meeting-concierge/v1/MeetingConcierge';
import { daniMeetingConciergeAdapter } from '@/lib/meeting-concierge/v1/adapters/dani-client';
import type { MeetingConciergeProvider } from '@/lib/meeting-concierge/v1/contracts';
import styles from './DaniMeetingScheduler.module.css';

export type DaniMeetingProvider = MeetingConciergeProvider;

export default function DaniMeetingScheduler({ initialProvider }: { initialProvider: DaniMeetingProvider }) {
    return (
        <MeetingConcierge
            adapter={daniMeetingConciergeAdapter}
            initialProvider={initialProvider}
            styles={styles as MeetingConciergeStyleContract}
        />
    );
}
