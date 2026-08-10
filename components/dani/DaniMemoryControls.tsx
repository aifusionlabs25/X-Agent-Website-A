'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
    BrainCircuit,
    CheckCircle2,
    LoaderCircle,
    ShieldCheck,
    Trash2,
    X,
} from 'lucide-react';
import styles from './DaniEditorial.module.css';

interface MemoryStatus {
    count: number;
    lastMemoryAt: string | null;
}

interface DaniMemoryControlsProps {
    placement?: 'dock' | 'inline';
}

function readableDate(value: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}

export default function DaniMemoryControls({ placement = 'dock' }: DaniMemoryControlsProps) {
    const [status, setStatus] = useState<MemoryStatus | null>(null);
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleted, setDeleted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const launcherRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        let active = true;
        const controller = new AbortController();

        void fetch('/api/anam/dani/memory', {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
        }).then(async response => {
            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (!active || !response.ok || payload.memoryVerified !== true) return;
            setStatus({
                count: typeof payload.memoryCount === 'number' && Number.isFinite(payload.memoryCount)
                    ? Math.max(0, Math.floor(payload.memoryCount))
                    : 0,
                lastMemoryAt: typeof payload.lastMemoryAt === 'string' ? payload.lastMemoryAt : null,
            });
        }).catch(() => undefined);

        return () => {
            active = false;
            controller.abort();
        };
    }, []);

    useEffect(() => {
        if (!open) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panelRef.current?.focus();

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !deleting) {
                setOpen(false);
                setConfirming(false);
                setError(null);
                window.requestAnimationFrame(() => launcherRef.current?.focus());
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
            );
            if (!focusable?.length) {
                event.preventDefault();
                panelRef.current?.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', closeOnEscape);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [deleting, open]);

    const close = () => {
        if (deleting) return;
        setOpen(false);
        setConfirming(false);
        setError(null);
        window.requestAnimationFrame(() => launcherRef.current?.focus());
    };

    const revokeMemory = async () => {
        setDeleting(true);
        setError(null);
        try {
            const response = await fetch('/api/anam/dani/memory', {
                method: 'DELETE',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });
            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (!response.ok || payload.deleted !== true || payload.revoked !== true) {
                throw new Error(typeof payload.error === 'string'
                    ? payload.error
                    : 'Dani could not remove recall right now.');
            }
            setStatus(null);
            setConfirming(false);
            if (window.location.pathname === '/demo/dani') {
                // Memory may already be present in the active provider context. A full
                // navigation unmounts Anam and ends this call before the visitor can
                // continue under the mistaken impression that its live context changed.
                window.location.assign('/agents/dani?memory=cleared');
                return;
            }
            setDeleted(true);
        } catch (caught) {
            setError(caught instanceof Error
                ? caught.message
                : 'Dani could not remove recall right now.');
        } finally {
            setDeleting(false);
        }
    };

    if (!status && !deleted) return null;

    const lastUpdated = readableDate(status?.lastMemoryAt ?? null);

    return (
        <>
            {status && !deleted && (
                <div
                    className={`${styles.root} ${placement === 'inline' ? styles.memoryInline : styles.memoryDock}`}
                    data-dani-memory-control
                    data-placement={placement}
                >
                    <button
                        ref={launcherRef}
                        type="button"
                        className={styles.memoryLauncher}
                        onClick={() => {
                            setOpen(true);
                            setConfirming(false);
                            setError(null);
                        }}
                        aria-label="Open Dani memory controls"
                        aria-haspopup="dialog"
                        aria-expanded={open}
                    >
                        <BrainCircuit aria-hidden="true" size={17} strokeWidth={1.8} />
                        <span className={styles.memoryLauncherLabel}>Memory</span>
                        <span aria-hidden="true" className={styles.memoryVerifiedDot} />
                    </button>
                </div>
            )}

            {open && (
                <div
                    className={`${styles.root} ${styles.memoryBackdrop}`}
                    onMouseDown={event => {
                        if (event.currentTarget === event.target) close();
                    }}
                >
                    <div
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-busy={deleting}
                        aria-labelledby={titleId}
                        aria-describedby={descriptionId}
                        tabIndex={-1}
                        className={styles.memoryPanel}
                    >
                        {!deleted && (
                            <button
                                type="button"
                                onClick={close}
                                disabled={deleting}
                                className={styles.memoryClose}
                                aria-label="Close recall controls"
                            >
                                <X aria-hidden="true" size={18} />
                            </button>
                        )}

                        {deleted ? (
                            <div className={styles.memorySuccess} role="status">
                                <span className={styles.memorySuccessIcon} aria-hidden="true">
                                    <CheckCircle2 size={26} />
                                </span>
                                <p className={`${styles.mono} ${styles.memoryEyebrow}`}>Recall removed</p>
                                <h2 id={titleId} className={`${styles.display} ${styles.memoryTitle}`}>
                                    Future sessions start without recall.
                                </h2>
                                <p id={descriptionId} className={styles.memoryCopy}>
                                    Returning-memory permission is revoked and Dani&apos;s reviewed notes for this verified identity have been deleted.
                                </p>
                                <button
                                    type="button"
                                    className={styles.memoryPrimary}
                                    onClick={() => setOpen(false)}
                                >
                                    Done
                                </button>
                            </div>
                        ) : confirming ? (
                            <div>
                                <span className={styles.memoryDangerIcon} aria-hidden="true">
                                    <Trash2 size={23} />
                                </span>
                                <p className={`${styles.mono} ${styles.memoryEyebrow}`}>Final confirmation</p>
                                <h2 id={titleId} className={`${styles.display} ${styles.memoryTitle}`}>
                                    Delete all Dani recall?
                                </h2>
                                <p id={descriptionId} className={styles.memoryCopy}>
                                    This permanently deletes every approved note connected to this verified identity and revokes future recall. It does not cancel follow-up emails you already requested.
                                </p>
                                {error && <p role="alert" className={styles.memoryError}>{error}</p>}
                                <div className={styles.memoryActions}>
                                    <button
                                        type="button"
                                        className={styles.memorySecondary}
                                        onClick={() => {
                                            setConfirming(false);
                                            setError(null);
                                        }}
                                        disabled={deleting}
                                    >
                                        Keep recall
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.memoryDanger}
                                        onClick={() => void revokeMemory()}
                                        disabled={deleting}
                                    >
                                        {deleting ? <LoaderCircle aria-hidden="true" className={styles.memorySpinner} size={17} /> : <Trash2 aria-hidden="true" size={16} />}
                                        {deleting ? 'Deleting securely...' : 'Delete all and revoke'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <span className={styles.memoryShieldIcon} aria-hidden="true">
                                    <ShieldCheck size={24} />
                                </span>
                                <p className={`${styles.mono} ${styles.memoryEyebrow}`}>Verified control</p>
                                <h2 id={titleId} className={`${styles.display} ${styles.memoryTitle}`}>
                                    Dani&apos;s recall
                                </h2>
                                <p id={descriptionId} className={styles.memoryCopy}>
                                    Dani may use {status?.count === 1 ? '1 reviewed note' : `${status?.count ?? 0} reviewed notes`} only after asking you during a conversation. Note contents are intentionally not shown on this screen.
                                </p>
                                <dl className={styles.memoryFacts}>
                                    <div>
                                        <dt>Approved notes</dt>
                                        <dd>{status?.count ?? 0}</dd>
                                    </div>
                                    <div>
                                        <dt>Last updated</dt>
                                        <dd>{lastUpdated ?? 'No notes yet'}</dd>
                                    </div>
                                </dl>
                                <div className={styles.memoryRule} aria-hidden="true" />
                                <p className={styles.memoryFootnote}>
                                    You&apos;re in control. Removing recall deletes approved notes and turns off returning memory for this identity.
                                </p>
                                <button
                                    type="button"
                                    className={styles.memoryDeleteLink}
                                    onClick={() => setConfirming(true)}
                                >
                                    <Trash2 aria-hidden="true" size={15} />
                                    Delete Dani&apos;s recall
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
