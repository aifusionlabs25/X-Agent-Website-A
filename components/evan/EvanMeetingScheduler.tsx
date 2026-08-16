'use client';

import Image from 'next/image';
import MeetingConcierge, { type MeetingConciergeStyleContract } from '@/components/meeting-concierge/v1/MeetingConcierge';
import { evanMeetingConciergeAdapter } from '@/lib/meeting-concierge/v1/adapters/evan-client';
import type { MeetingConciergeProvider } from '@/lib/meeting-concierge/v1/contracts';
import styles from './EvanMeetingScheduler.module.css';

export type EvanMeetingProvider = MeetingConciergeProvider;

export default function EvanMeetingScheduler({ initialProvider }: { initialProvider: EvanMeetingProvider }) {
    return (
        <main id="evan-meeting-concierge" className={styles.page} data-evan-surface="meeting-concierge">
            <section className={styles.shell}>
                <div className={styles.portraitPanel}>
                    <Image
                        src="/agents/thumbnails/Evan Mullins Moving.png"
                        alt="Evan, Mullins Moving concierge"
                        fill
                        priority
                        sizes="(max-width: 900px) 100vw, 40vw"
                        className={styles.portrait}
                    />
                    <div className={styles.portraitWash} />
                    <div className={styles.portraitCopy}>
                        <p>Mullins Moving · Meeting Concierge</p>
                        <h2>Bring Evan<br />into the room.</h2>
                    </div>
                </div>
                <div className={styles.schedulerPanel}>
                    <Image
                        src="/agents/thumbnails/Evan Mullins Moving logo.png"
                        alt="Mullins Moving"
                        width={160}
                        height={80}
                        className={styles.logo}
                    />
                    <MeetingConcierge
                        adapter={evanMeetingConciergeAdapter}
                        initialProvider={initialProvider}
                        styles={styles as MeetingConciergeStyleContract}
                    />
                </div>
            </section>
        </main>
    );
}
