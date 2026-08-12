import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, RotateCcw, Video } from 'lucide-react';
import styles from './DaniEditorial.module.css';
import meetingStyles from './DaniMeetingScheduler.module.css';
import DaniMemoryControls from './DaniMemoryControls';
import DaniMeetingScheduler, { type DaniMeetingProvider } from './DaniMeetingScheduler';

interface DaniEditorialLandingProps {
    sessionComplete: boolean;
    meetingProvider?: DaniMeetingProvider | null;
}

const meetingProviders: Array<{ id: DaniMeetingProvider; name: string; hint: string }> = [
    { id: 'google', name: 'Google Meet', hint: 'Choose or paste a Meet link' },
    { id: 'zoom', name: 'Zoom', hint: 'Schedule Dani into Zoom' },
    { id: 'teams', name: 'Microsoft Teams', hint: 'Choose or paste a Teams link' },
];

function providerMark(provider: DaniMeetingProvider) {
    const markClass = provider === 'google'
        ? meetingStyles.googleMark
        : provider === 'zoom'
            ? meetingStyles.zoomMark
            : meetingStyles.teamsMark;
    return (
        <span aria-hidden="true" className={`${meetingStyles.platformMark} ${markClass}`}>
            {provider === 'teams' ? 'T' : <Video size={17} />}
        </span>
    );
}

function DaniPortraitRail({ compact = false }: { compact?: boolean }) {
    return (
        <div className={`${styles.choicePortrait} relative min-h-[32svh] overflow-hidden bg-[#17201d] lg:min-h-full`}>
            <Image
                src="/agents/thumbnails/dani-x-agent-director-cara4-2026.jpg"
                alt="Dani, AI Solutions Director at AI Fusion Labs"
                fill
                priority
                sizes="(max-width: 1023px) 100vw, 40vw"
                className={styles.choicePortraitImage}
            />
            <div className={styles.choicePortraitWash} />
            <Link href="/" className={`${styles.mono} ${styles.choiceBrand}`}>
                <span aria-hidden="true" /> AI Fusion Labs / Dani
            </Link>
            {!compact ? (
                <div className={styles.choicePortraitCopy}>
                    <p className={styles.mono}>AI Solutions Director</p>
                    <h2 className={styles.display}>Meet<br />Dani.</h2>
                </div>
            ) : null}
        </div>
    );
}

export default function DaniEditorialLanding({
    sessionComplete,
    meetingProvider = null,
}: DaniEditorialLandingProps) {
    if (meetingProvider && !sessionComplete) {
        return (
            <main className={`${styles.root} ${styles.paper} min-h-[100svh] overflow-x-hidden text-[#151b19]`} data-dani-surface="meeting-scheduler">
                <section className={styles.choiceShell}>
                    <DaniPortraitRail compact />
                    <div className={styles.schedulerPanel}>
                        <DaniMeetingScheduler initialProvider={meetingProvider} />
                    </div>
                </section>
            </main>
        );
    }

    if (!sessionComplete) {
        return (
            <main className={`${styles.root} ${styles.paper} min-h-[100svh] overflow-hidden text-[#151b19]`} data-dani-surface="landing">
                <section className={styles.choiceShell}>
                    <DaniPortraitRail />
                    <div className={styles.choicePanel}>
                        <div className={`${styles.entrance} ${styles.choiceContent}`}>
                            <div className={styles.choiceRule} aria-hidden="true" />
                            <p className={`${styles.mono} ${styles.choiceEyebrow}`}>Choose your experience</p>
                            <h1 className={`${styles.display} ${styles.choiceHeading}`}>How would you like to meet?</h1>
                            <p className={styles.choiceIntro}>Most visitors can start talking with Dani immediately. Bringing her into another meeting platform is completely optional.</p>

                            <Link href="/demo/dani" className={styles.talkNowCard}>
                                <span>
                                    <strong>Talk with Dani right now</strong>
                                    <small>Start the regular private X Agent session on this site.</small>
                                </span>
                                <span className={styles.talkNowAction}>Start conversation <ArrowRight size={16} /></span>
                            </Link>

                            <div className={styles.choiceDivider}><span>or bring Dani to a meeting</span></div>
                            <div className={styles.meetingChoiceGrid}>
                                {meetingProviders.map(provider => (
                                    <Link key={provider.id} href={`/agents/dani?meeting=${provider.id}`}>
                                        {providerMark(provider.id)}
                                        <span><strong>{provider.name}</strong><small>{provider.hint}</small></span>
                                        <ArrowRight size={15} />
                                    </Link>
                                ))}
                            </div>
                            <p className={styles.choiceFootnote}>Meeting shortcuts open the three-step scheduler. They never interrupt the regular Dani experience.</p>
                            <DaniMemoryControls placement="inline" />
                        </div>
                    </div>
                </section>
            </main>
        );
    }

    return (
        <main className={`${styles.root} ${styles.paper} min-h-[100svh] overflow-hidden text-[#151b19]`} data-dani-surface="post-session">
            <section className="grid min-h-[100svh] lg:grid-cols-[minmax(29rem,1.02fr)_minmax(28rem,.98fr)]">
                <div className="relative order-2 flex px-5 py-9 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-10 sm:py-12 lg:order-1 lg:px-[clamp(2.5rem,5vw,6.25rem)] lg:py-[clamp(2rem,4.5vh,3.75rem)]">
                    <div className={`${styles.entrance} my-auto w-full max-w-[42rem]`}>
                        <Link href="/" className={`${styles.mono} inline-flex items-center text-[10px] font-bold uppercase tracking-[0.16em] text-[#151b19] outline-none focus-visible:ring-2 focus-visible:ring-[#126e64] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f8f4e9]`}>
                            <span aria-hidden="true" className="mr-2.5 h-2 w-2 rounded-full bg-[#d55538]" /> AI Fusion Labs
                        </Link>
                        <div className="mt-[clamp(2.5rem,6vh,4rem)] h-px w-14 bg-[#d55538] lg:mt-[clamp(2rem,4.5vh,3rem)]" aria-hidden="true" />
                        <p className={`${styles.mono} mt-5 text-[10px] font-bold uppercase tracking-[0.17em] text-[#126e64]`}>Session complete</p>
                        <h1 className={`${styles.display} mt-3 max-w-[12ch] text-[clamp(3rem,4.6vw,5.25rem)] font-semibold leading-[.9] tracking-[-.055em] lg:max-w-[14ch]`}>Good work. You moved the idea forward.</h1>
                        <p className="mt-6 max-w-[36rem] text-[15px] leading-7 text-[#626861] sm:text-base sm:leading-7">Your conversation is complete. If you requested email follow-up, Dani&apos;s recap will separate what you shared, working inferences, and the points that still need human confirmation.</p>
                        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                            <Link href="/demo/dani" className="group inline-flex min-h-12 items-center justify-center gap-3 rounded-[3px] bg-[#126e64] px-6 text-sm font-extrabold text-white shadow-[0_14px_34px_rgba(18,110,100,.16)] transition-[transform,background-color,box-shadow] hover:-translate-y-0.5 hover:bg-[#0d5d54] hover:shadow-[0_18px_40px_rgba(18,110,100,.22)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d55538] motion-reduce:transform-none"><RotateCcw aria-hidden="true" size={17} /> Start another session</Link>
                            <Link href="/" className="inline-flex min-h-12 items-center justify-center gap-3 rounded-[3px] border border-[#a9a292] px-6 text-sm font-extrabold text-[#151b19] transition-[transform,border-color,background-color] hover:-translate-y-0.5 hover:border-[#126e64] hover:bg-white/45 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#126e64] motion-reduce:transform-none">Explore AI Fusion Labs</Link>
                        </div>
                        <DaniMemoryControls placement="inline" />
                        <div className={`${styles.mono} mt-8 border-t border-[#c9c3b4] pt-4 text-[9px] font-semibold uppercase leading-5 tracking-[0.1em] text-[#626861] sm:text-[10px]`}><p>Follow-up · Sent only when requested &nbsp; / &nbsp; No CRM update or commercial commitment was made</p></div>
                    </div>
                </div>
                <div className="relative order-1 min-h-[34svh] overflow-hidden bg-[#17201d] lg:order-2 lg:min-h-full">
                    <Image src="/agents/thumbnails/dani-x-agent-director-cara4-2026.jpg" alt="Dani, AI Solutions Director at AI Fusion Labs" fill priority sizes="(max-width: 1023px) 100vw, 44vw" className={styles.landingPortraitImage} />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(54,43,29,.01),rgba(54,43,29,.12))] lg:bg-[linear-gradient(90deg,rgba(248,244,233,.88)_0%,rgba(248,244,233,.08)_18%,transparent_38%),linear-gradient(180deg,rgba(54,43,29,.01),rgba(54,43,29,.1))]" />
                </div>
            </section>
        </main>
    );
}
