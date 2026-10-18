import Image from 'next/image';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import type { AgentData } from '@/lib/agents';
import styles from './AgentAccessGate.module.css';

export default function AccessFrame({ agent, embedded = false, children }: {
    agent?: AgentData;
    embedded?: boolean;
    children: ReactNode;
}) {
    const name = agent?.name ? agent.name.charAt(0).toUpperCase() + agent.name.slice(1).toLowerCase() : 'X Agents';
    return (
        <section
            className={embedded ? styles.embedded : styles.page}
            style={{ '--access-accent': agent?.accentColor ?? '#b6cba0' } as CSSProperties}
            data-agent-access={agent?.slug ?? 'account'}
        >
            <div className={styles.card}>
                {!embedded && <aside className={styles.portraitPanel}>
                    {agent ? <Image src={agent.thumbnailSrc} alt={name} fill sizes="(max-width: 700px) 100vw, 420px" className={styles.portrait} /> : <div className={styles.monogram} aria-hidden="true">X</div>}
                    <div className={styles.portraitShade} />
                    <div className={styles.portraitCopy}>
                        <p className={styles.eyebrow}>AI Fusion Labs</p>
                        <p className={styles.agentName}>{name}</p>
                        <p className={styles.role}>{agent?.role ?? 'A conversation starts with access.'}</p>
                    </div>
                </aside>}
                <div className={styles.content}>
                    <Link href={agent ? `/agents/${agent.slug}` : '/#agents'} className={styles.backLink}><ArrowLeft size={15} />{agent ? `Back to ${name}` : 'Explore the agents'}</Link>
                    <div className={styles.label}><LockKeyhole size={14} /><span>{embedded ? `${name} · meeting access` : 'Private access'}</span></div>
                    {children}
                </div>
            </div>
        </section>
    );
}
