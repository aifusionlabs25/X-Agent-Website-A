'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    ArrowLeft,
    ArrowRight,
    CalendarDays,
    Check,
    Clock3,
    ExternalLink,
    LoaderCircle,
    Mail,
    ShieldCheck,
    UserRound,
    UsersRound,
    Video,
} from 'lucide-react';
import styles from './DaniMeetingScheduler.module.css';

export type DaniMeetingProvider = 'google' | 'zoom' | 'teams';

type AccessState = {
    authenticated?: boolean;
    displayName?: string | null;
    followUpAuthorized?: boolean;
};

type InviteState = {
    id: string;
    provider: string;
    status: string;
    joinAt: string | null;
    sessionId: string | null;
    statusReason: string | null;
};

const PROVIDERS: Record<DaniMeetingProvider, { name: string; hint: string; className: string }> = {
    google: { name: 'Google Meet', hint: 'Paste a Meet link', className: styles.googleMark },
    zoom: { name: 'Zoom', hint: 'Paste a Zoom link', className: styles.zoomMark },
    teams: { name: 'Microsoft Teams', hint: 'Paste a Teams link', className: styles.teamsMark },
};

function localDate(daysAhead = 1) {
    const date = new Date();
    date.setDate(date.getDate() + daysAhead);
    return date.toLocaleDateString('en-CA');
}

function platformMark(provider: DaniMeetingProvider) {
    return <span aria-hidden="true" className={`${styles.platformMark} ${PROVIDERS[provider].className}`}>{provider === 'teams' ? 'T' : <Video size={17} />}</span>;
}

function detectProvider(value: string): DaniMeetingProvider | null {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        if (hostname === 'meet.google.com') return 'google';
        if (hostname === 'zoom.us' || hostname.endsWith('.zoom.us')) return 'zoom';
        if (hostname === 'teams.microsoft.com' || hostname.endsWith('.teams.microsoft.com') || hostname === 'teams.live.com' || hostname.endsWith('.teams.live.com')) return 'teams';
    } catch {
        // An incomplete link is expected while the visitor is typing.
    }
    return null;
}

export default function DaniMeetingScheduler({ initialProvider }: { initialProvider: DaniMeetingProvider }) {
    const [step, setStep] = useState(1);
    const [provider, setProvider] = useState<DaniMeetingProvider>(initialProvider);
    const [meetingUrl, setMeetingUrl] = useState('');
    const [date, setDate] = useState(() => localDate());
    const [time, setTime] = useState('10:30');
    const [timezone, setTimezone] = useState('America/Phoenix');
    const [groupCall, setGroupCall] = useState(true);
    const [purpose, setPurpose] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [verified, setVerified] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [invite, setInvite] = useState<InviteState | null>(null);

    useEffect(() => {
        try {
            setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Phoenix');
        } catch {
            // Keep the visible Phoenix fallback when browser timezone data is unavailable.
        }
        void fetch('/api/anam/dani/access', { cache: 'no-store' })
            .then(response => response.ok ? response.json() as Promise<AccessState> : null)
            .then(access => {
                if (access?.followUpAuthorized) {
                    setVerified(true);
                    setDisplayName(access.displayName ?? 'Organizer');
                }
            })
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        if (!invite || invite.status === 'ended' || invite.status === 'failed' || invite.status === 'cancelled') return;
        const timer = window.setInterval(() => {
            void fetch(`/api/anam/dani/meetings?inviteId=${encodeURIComponent(invite.id)}`, { cache: 'no-store' })
                .then(response => response.ok ? response.json() as Promise<{ invite: InviteState }> : null)
                .then(payload => payload?.invite && setInvite(payload.invite))
                .catch(() => undefined);
        }, 15_000);
        return () => window.clearInterval(timer);
    }, [invite]);

    const joinAt = useMemo(() => {
        const value = new Date(`${date}T${time}:00`);
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }, [date, time]);

    async function sendCode() {
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/anam/dani/access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName, email, followUpConsent: true, memoryConsent: false }),
            });
            const payload = await response.json() as { challengeId?: string; error?: string };
            if (!response.ok || !payload.challengeId) throw new Error(payload.error || 'Verification email could not be sent');
            setChallengeId(payload.challengeId);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Verification email could not be sent');
        } finally {
            setBusy(false);
        }
    }

    async function verifyCode() {
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/anam/dani/access/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ challengeId, verificationCode }),
            });
            const payload = await response.json() as { followUpAuthorized?: boolean; error?: string };
            if (!response.ok || !payload.followUpAuthorized) throw new Error(payload.error || 'Verification code was not accepted');
            setVerified(true);
            setChallengeId(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Verification code was not accepted');
        } finally {
            setBusy(false);
        }
    }

    async function createInvite() {
        if (!joinAt) return;
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/anam/dani/meetings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meetingUrl, joinAt, groupCall, purpose }),
            });
            const payload = await response.json() as { invite?: InviteState; error?: string };
            if (!response.ok || !payload.invite) throw new Error(payload.error || 'Dani could not be scheduled');
            setInvite(payload.invite);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Dani could not be scheduled');
        } finally {
            setBusy(false);
        }
    }

    if (invite) {
        return (
            <div className={styles.scheduler} data-dani-meeting-state="confirmed">
                <div className={styles.confirmIcon}><Check size={25} /></div>
                <p className={styles.eyebrow}>Invitation created</p>
                <h1 className={styles.title}>Dani is on the agenda.</h1>
                <p className={styles.intro}>We are tracking the Anam invitation from this page. A host may still need to admit Dani from the waiting room.</p>
                <dl className={styles.confirmFacts}>
                    <div><dt>Platform</dt><dd>{PROVIDERS[provider].name}</dd></div>
                    <div><dt>Status</dt><dd>{invite.status.replaceAll('_', ' ')}</dd></div>
                    <div><dt>Joins</dt><dd>{invite.joinAt ? new Date(invite.joinAt).toLocaleString() : 'As soon as capacity is available'}</dd></div>
                    <div><dt>Mode</dt><dd>{groupCall ? 'Group meeting · name gated' : '1:1 conversation'}</dd></div>
                </dl>
                {invite.statusReason ? <p className={styles.error}>{invite.statusReason}</p> : null}
                <div className={styles.actions}>
                    <Link href="/agents/dani" className={styles.secondaryButton}>Back to Dani</Link>
                    <a href={meetingUrl} target="_blank" rel="noreferrer" className={styles.primaryButton}>Open meeting <ExternalLink size={15} /></a>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.scheduler} data-dani-meeting-step={step}>
            <Link href="/agents/dani" className={styles.backLink}><ArrowLeft size={15} /> Back to Dani</Link>
            <div className={styles.topline} aria-hidden="true" />
            <div className={styles.headingRow}>
                <div>
                    <p className={styles.eyebrow}>Invite Dani to a meeting</p>
                    <h1 className={styles.title}>{step === 1 ? 'Set the room.' : step === 2 ? 'Set her role.' : 'Confirm the invitation.'}</h1>
                </div>
                <ol className={styles.steps} aria-label="Meeting invitation progress">
                    {[1, 2, 3].map(item => <li key={item} aria-current={item === step ? 'step' : undefined} data-active={item === step} data-complete={item < step}>{String(item).padStart(2, '0')}</li>)}
                </ol>
            </div>

            {step === 1 ? (
                <div className={styles.formStack}>
                    <fieldset>
                        <legend>Meeting platform</legend>
                        <div className={styles.providerGrid}>
                            {(Object.keys(PROVIDERS) as DaniMeetingProvider[]).map(item => (
                                <button key={item} type="button" aria-pressed={provider === item} data-selected={provider === item} onClick={() => setProvider(item)}>
                                    {platformMark(item)}<span><strong>{PROVIDERS[item].name}</strong><small>{PROVIDERS[item].hint}</small></span>{provider === item ? <Check size={16} /> : null}
                                </button>
                            ))}
                        </div>
                    </fieldset>
                    <label>Meeting link<input type="url" value={meetingUrl} onChange={event => {
                        const value = event.target.value;
                        setMeetingUrl(value);
                        const detected = detectProvider(value);
                        if (detected) setProvider(detected);
                    }} placeholder="Paste the meeting invitation link" autoComplete="url" /></label>
                    <div className={styles.fieldGrid}>
                        <label><span><CalendarDays size={14} /> Date</span><input type="date" min={localDate(0)} value={date} onChange={event => setDate(event.target.value)} /></label>
                        <label><span><Clock3 size={14} /> Time</span><input type="time" value={time} onChange={event => setTime(event.target.value)} /></label>
                        <label>Timezone<input value={timezone} readOnly aria-describedby="timezone-help" /><small id="timezone-help">Detected from your browser.</small></label>
                    </div>
                </div>
            ) : step === 2 ? (
                <div className={styles.formStack}>
                    <fieldset>
                        <legend>How should Dani participate?</legend>
                        <div className={styles.roleGrid}>
                            <button type="button" aria-pressed={groupCall} data-selected={groupCall} onClick={() => setGroupCall(true)}><UsersRound size={22} /><span><strong>Group meeting</strong><small>Joins quietly and responds when someone says “Dani.”</small></span>{groupCall ? <Check size={17} /> : null}</button>
                            <button type="button" aria-pressed={!groupCall} data-selected={!groupCall} onClick={() => setGroupCall(false)}><UserRound size={22} /><span><strong>1:1 conversation</strong><small>Greets the participant and responds naturally.</small></span>{!groupCall ? <Check size={17} /> : null}</button>
                        </div>
                    </fieldset>
                    <label>Meeting purpose <span className={styles.optional}>Optional</span><textarea value={purpose} onChange={event => setPurpose(event.target.value)} maxLength={500} placeholder="Give Dani a short, factual objective for the room." /></label>
                    <div className={styles.note}><ShieldCheck size={18} /><p>The saved Dani persona remains in control. The purpose stays visible for your review; it does not silently rewrite her system prompt.</p></div>
                </div>
            ) : (
                <div className={styles.formStack}>
                    <div className={styles.reviewCard}>
                        <div>{platformMark(provider)}<span><strong>{PROVIDERS[provider].name}</strong><small>{new Date(joinAt ?? '').toLocaleString()} · {groupCall ? 'Group meeting' : '1:1 conversation'}</small></span></div>
                        <button type="button" onClick={() => setStep(1)}>Edit</button>
                    </div>
                    {purpose.trim() ? <p className={styles.purposeReview}><strong>Working objective:</strong> {purpose.trim()}</p> : null}
                    {verified ? (
                        <div className={styles.verifiedCard}><ShieldCheck size={21} /><div><strong>Organizer verified</strong><span>{displayName || 'Verified organizer'} · meeting status and post-call handling can be tied to this invitation.</span></div></div>
                    ) : (
                        <div className={styles.verifyPanel}>
                            <p className={styles.sectionTitle}>Verify the organizer</p>
                            <p className={styles.sectionCopy}>We verify the address before creating an external meeting invitation.</p>
                            {!challengeId ? (
                                <div className={styles.fieldGridTwo}>
                                    <label><span><UserRound size={14} /> Name</span><input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" /></label>
                                    <label><span><Mail size={14} /> Email</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></label>
                                </div>
                            ) : (
                                <label>Six-digit verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, ''))} /></label>
                            )}
                            <button type="button" className={styles.verifyButton} onClick={challengeId ? verifyCode : sendCode} disabled={busy || (challengeId ? verificationCode.length !== 6 : displayName.trim().length < 2 || !email.includes('@'))}>
                                {busy ? <LoaderCircle className={styles.spinner} size={16} /> : null}{challengeId ? 'Verify code' : 'Send verification code'}
                            </button>
                        </div>
                    )}
                    <div className={styles.note}><Mail size={18} /><p>The verified address is used for invitation status and the requested meeting follow-up. Dani will not ask participants to say an email aloud.</p></div>
                </div>
            )}

            {error ? <p role="alert" className={styles.error}>{error}</p> : null}
            <div className={styles.actions}>
                {step > 1 ? <button type="button" className={styles.secondaryButton} onClick={() => setStep(value => value - 1)}>Back</button> : <span />}
                {step < 3 ? (
                    <button type="button" className={styles.primaryButton} onClick={() => setStep(value => value + 1)} disabled={step === 1 && (!meetingUrl.trim() || !joinAt)}>Continue <ArrowRight size={16} /></button>
                ) : (
                    <button type="button" className={styles.primaryButton} onClick={createInvite} disabled={!verified || busy}>{busy ? <LoaderCircle className={styles.spinner} size={16} /> : null} Invite Dani <ArrowRight size={16} /></button>
                )}
            </div>
        </div>
    );
}
