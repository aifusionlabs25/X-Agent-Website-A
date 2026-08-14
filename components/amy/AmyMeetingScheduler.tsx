'use client';

import Image from 'next/image';
import MeetingConcierge, { type MeetingConciergeStyleContract } from '@/components/meeting-concierge/v1/MeetingConcierge';
import { amyMeetingConciergeAdapter } from '@/lib/meeting-concierge/v1/adapters/amy-client';
import type { MeetingConciergeProvider } from '@/lib/meeting-concierge/v1/contracts';
import styles from './AmyMeetingScheduler.module.css';

export type AmyMeetingProvider = MeetingConciergeProvider;

export function AmyMeetingConcierge({ initialProvider }: { initialProvider: AmyMeetingProvider }) {
    return (
        <main id="amy-meeting-concierge" className={styles.page} data-amy-surface="meeting-concierge">
            <section className={styles.shell}>
                <div className={styles.portraitPanel}>
                    <Image
                        src="/agents/amy-insight-sdr-hero-polished.webp"
                        alt="Amy, senior SDR for Insight"
                        fill
                        priority
                        sizes="(max-width: 900px) 100vw, 38vw"
                        className={styles.portrait}
                    />
                    <div className={styles.portraitWash} />
                    <div className={styles.portraitCopy}>
                        <p>Amy · Senior SDR for Insight</p>
                        <h2>Bring Amy<br />into the room.</h2>
                    </div>
                </div>
                <div className={styles.schedulerPanel}>
                    <Image src="/agents/insight-logo.png" alt="Insight" width={150} height={62} className={styles.logo} />
                    <MeetingConcierge
                        adapter={amyMeetingConciergeAdapter}
                        initialProvider={initialProvider}
                        styles={styles as MeetingConciergeStyleContract}
                    />
                </div>
            </section>
        </main>
    );
}
