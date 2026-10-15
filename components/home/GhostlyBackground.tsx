'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import styles from './HomeIntroSplash.module.css';

type IntroStage = 'logo' | 'blackout' | 'reveal' | 'complete';

const LOGO_HOLD_MS = 1_600;
const REVEAL_START_MS = 2_150;
const INTRO_COMPLETE_MS = 2_950;

const STAGE_CLASS_NAMES: Record<IntroStage, string> = {
    logo: '',
    blackout: styles.blackout,
    reveal: styles.reveal,
    complete: '',
};

export default function GhostlyBackground() {
    const [stage, setStage] = useState<IntroStage>('logo');

    useEffect(() => {
        const blackoutTimer = window.setTimeout(() => setStage('blackout'), LOGO_HOLD_MS);
        const revealTimer = window.setTimeout(() => setStage('reveal'), REVEAL_START_MS);
        const completeTimer = window.setTimeout(() => setStage('complete'), INTRO_COMPLETE_MS);

        return () => {
            window.clearTimeout(blackoutTimer);
            window.clearTimeout(revealTimer);
            window.clearTimeout(completeTimer);
        };
    }, []);

    if (stage === 'complete') return null;

    return (
        <div
            aria-hidden="true"
            className={`${styles.splash} ${STAGE_CLASS_NAMES[stage]}`.trim()}
            data-home-loading-brand
            data-stage={stage}
        >
            <Image
                src="/brand/x-agents-metallic-loading.webp"
                alt=""
                width={1672}
                height={941}
                priority
                fetchPriority="high"
                sizes="100vw"
                className={styles.logo}
            />
        </div>
    );
}
