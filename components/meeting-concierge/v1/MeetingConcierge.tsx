'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import {
    ArrowLeft,
    ArrowRight,
    CalendarDays,
    Check,
    Clock3,
    Ear,
    ListChecks,
    LoaderCircle,
    LogOut,
    LockKeyhole,
    Mail,
    MessageCircle,
    ShieldCheck,
    TriangleAlert,
    UserRound,
    UsersRound,
    Video,
} from 'lucide-react';
import {
    clearStoredMeetingConciergeInvite,
    createMeetingConciergeInvite,
    detectMeetingConciergeProvider,
    isMeetingConciergeInviteTerminal,
    localMeetingConciergeDate,
    readMeetingConciergeInvite,
    readMeetingConciergeOrganizer,
    readStoredMeetingConciergeInvite,
    removeMeetingConciergeInvite,
    storeMeetingConciergeInvite,
} from '@/lib/meeting-concierge/v1/client';
import type {
    MeetingConciergeClientAdapter,
    MeetingConciergeDurationMinutes,
    MeetingConciergeInvite,
    MeetingConciergeJoinTiming,
    MeetingConciergeParticipationMode,
    MeetingConciergeProvider,
} from '@/lib/meeting-concierge/v1/contracts';
import { MEETING_CONCIERGE_DURATION_MINUTES, MEETING_CONCIERGE_VERSION } from '@/lib/meeting-concierge/v1/contracts';

export type MeetingConciergeStyleContract = Record<
    | 'scheduler' | 'backLink' | 'topline' | 'headingRow' | 'eyebrow' | 'title' | 'steps'
    | 'formStack' | 'providerGrid' | 'timingGrid' | 'fieldGrid' | 'joinNowNote' | 'roleGrid'
    | 'optional' | 'note' | 'reviewCard' | 'purposeReview' | 'verifiedCard' | 'verifyPanel'
    | 'sectionTitle' | 'sectionCopy' | 'fieldGridTwo' | 'memoryChoice' | 'verifyButton'
    | 'spinner' | 'consentCopy' | 'error' | 'actions' | 'secondaryButton' | 'primaryButton'
    | 'platformMark' | 'googleMark' | 'zoomMark' | 'teamsMark' | 'confirmIcon' | 'intro'
    | 'liveStatus' | 'confirmFacts' | 'durationGrid' | 'dangerButton' | 'dangerPanel'
    | 'restoredNote',
    string
>;

type MeetingConciergeProps = {
    adapter: MeetingConciergeClientAdapter;
    initialProvider: MeetingConciergeProvider;
    styles: MeetingConciergeStyleContract;
};

const PROVIDER_COPY: Record<MeetingConciergeProvider, { name: string; hint: string }> = {
    google: { name: 'Google Meet', hint: 'Paste a Meet link' },
    zoom: { name: 'Zoom', hint: 'Paste a Zoom link' },
    teams: { name: 'Microsoft Teams', hint: 'Paste a Teams link' },
};

function platformMark(provider: MeetingConciergeProvider, styles: MeetingConciergeStyleContract) {
    const className = provider === 'google' ? styles.googleMark : provider === 'zoom' ? styles.zoomMark : styles.teamsMark;
    return <span aria-hidden="true" className={`${styles.platformMark} ${className}`}>{provider === 'teams' ? 'T' : <Video size={17} />}</span>;
}

function participationIcon(mode: MeetingConciergeParticipationMode) {
    if (mode === 'observer') return <Ear size={21} />;
    if (mode === 'facilitator') return <ListChecks size={21} />;
    return <MessageCircle size={21} />;
}

function CheckInFields({
    adapter,
    styles,
    onAuthenticated,
    onError,
}: {
    adapter: MeetingConciergeClientAdapter;
    styles: MeetingConciergeStyleContract;
    onAuthenticated: (displayName: string | null) => void;
    onError: (value: string) => void;
}) {
    const checkIn = adapter.checkIn;
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [accessCode, setAccessCode] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [memoryConsent, setMemoryConsent] = useState(checkIn?.kind === 'credentials' ? checkIn.defaultMemoryConsent : false);
    const [submitting, setSubmitting] = useState(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!checkIn) return;
        onError('');
        setSubmitting(true);
        try {
            if (checkIn.kind === 'email-code' && !challengeId) {
                const challenge = await checkIn.requestCode({ displayName, email });
                setChallengeId(challenge.challengeId);
                return;
            }
            const organizer = checkIn.kind === 'email-code'
                ? await checkIn.verifyCode({ challengeId: challengeId ?? '', verificationCode })
                : await checkIn.submit({ displayName, email, accessCode, memoryConsent });
            setEmail('');
            setAccessCode('');
            setVerificationCode('');
            setChallengeId(null);
            onAuthenticated(organizer.displayName);
        } catch (caught) {
            onError(caught instanceof Error ? caught.message : `${adapter.agent.name} check-in could not be completed`);
        } finally {
            setSubmitting(false);
        }
    }

    if (!checkIn) return null;
    return (
        <form className={styles.verifyPanel} onSubmit={submit}>
            <p className={styles.sectionTitle}>{adapter.copy.checkInTitle}</p>
            <p className={styles.sectionCopy}>{adapter.copy.checkInDescription}</p>
            {checkIn.kind === 'email-code' && challengeId ? (
                <label><span><LockKeyhole size={14} /> Six-digit verification code</span><input required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, ''))} /></label>
            ) : <>
                <div className={styles.fieldGridTwo}>
                    <label><span><UserRound size={14} /> Name</span><input required value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" /></label>
                    <label><span><Mail size={14} /> Email</span><input required type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></label>
                </div>
                {checkIn.kind === 'credentials' ? <>
                    <label><span><LockKeyhole size={14} /> Access code</span><input required type="password" value={accessCode} onChange={event => setAccessCode(event.target.value)} autoComplete="current-password" /></label>
                    <label className={styles.memoryChoice}>
                        <input type="checkbox" checked={memoryConsent} onChange={event => setMemoryConsent(event.target.checked)} />
                        <span><strong>Remember this email</strong><small>{adapter.agent.name} may find reviewed notes on a future visit. Leave this off to start fresh.</small></span>
                    </label>
                </> : null}
            </>}
            <button type="submit" className={styles.verifyButton} disabled={submitting || (checkIn.kind === 'email-code' && challengeId ? verificationCode.length !== 6 : displayName.trim().length < 2 || !email.includes('@') || (checkIn.kind === 'credentials' && !accessCode))}>
                {submitting ? <LoaderCircle className={styles.spinner} size={16} /> : null} {checkIn.kind === 'email-code' ? challengeId ? 'Verify code' : 'Send verification code' : 'Complete check-in'}
            </button>
            <p className={styles.consentCopy}>{adapter.copy.consent}</p>
        </form>
    );
}

function statusCopy(agentName: string, invite: MeetingConciergeInvite, joinState: string | null) {
    if (invite.status === 'active') return joinState === 'media active'
        ? `${agentName} is connected with active audio and video.`
        : `${agentName} has joined the call and the session is active.`;
    if (joinState === 'waiting room') return `${agentName} is in the lobby. Admit the agent from the participant list.`;
    if (invite.status === 'pending' && invite.joinAt) return `${agentName} is scheduled and will connect separately at the time below.`;
    if (invite.status === 'pending') return `${agentName} is connecting separately now. Watch the lobby and participant list.`;
    if (invite.status === 'failed') return `${agentName} could not enter this meeting. Review the status below before trying again.`;
    if (invite.status === 'cancelled' || joinState === 'left') return `${agentName} has left the meeting and the Anam session is no longer active.`;
    if (invite.status === 'ended' || joinState === 'done') return `${agentName}'s meeting session has ended.`;
    return 'The meeting invitation has finished.';
}

export default function MeetingConcierge({ adapter, initialProvider, styles }: MeetingConciergeProps) {
    const { meetingApiPath } = adapter.agent;
    const [step, setStep] = useState(1);
    const [provider, setProvider] = useState<MeetingConciergeProvider>(initialProvider);
    const [meetingUrl, setMeetingUrl] = useState('');
    const [joinTiming, setJoinTiming] = useState<MeetingConciergeJoinTiming>('now');
    const [date, setDate] = useState(() => localMeetingConciergeDate());
    const [time, setTime] = useState('10:30');
    const [timezone, setTimezone] = useState('America/Phoenix');
    const [groupCall, setGroupCall] = useState(true);
    const [participationMode, setParticipationMode] = useState<MeetingConciergeParticipationMode>(adapter.participation?.defaultMode ?? 'participant');
    const [maxDurationMinutes, setMaxDurationMinutes] = useState<MeetingConciergeDurationMinutes>(30);
    const [purpose, setPurpose] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [authenticated, setAuthenticated] = useState(false);
    const [busy, setBusy] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [confirmingRemoval, setConfirmingRemoval] = useState(false);
    const [restoredInvite, setRestoredInvite] = useState(false);
    const [error, setError] = useState('');
    const [invite, setInvite] = useState<MeetingConciergeInvite | null>(null);

    useEffect(() => {
        let disposed = false;
        queueMicrotask(() => {
            if (disposed) return;
            try {
                setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Phoenix');
            } catch {
                // Keep the visible fallback when browser timezone data is unavailable.
            }
            const stored = readStoredMeetingConciergeInvite(adapter.agent.key);
            if (stored) {
                setInvite(stored.invite);
                setProvider(stored.provider);
                setGroupCall(stored.groupCall);
                if (stored.participationMode && adapter.participation?.options.some(option => option.mode === stored.participationMode)) {
                    setParticipationMode(stored.participationMode);
                }
                setMaxDurationMinutes(stored.maxDurationMinutes);
                setStep(3);
                setRestoredInvite(true);
            }
        });
        void readMeetingConciergeOrganizer(meetingApiPath)
            .then(organizer => {
                if (disposed) return;
                setAuthenticated(organizer.authenticated);
                setDisplayName(organizer.displayName ?? 'Organizer');
            })
            .catch(() => undefined);
        return () => { disposed = true; };
    }, [adapter.agent.key, adapter.participation, meetingApiPath]);

    const inviteId = invite?.id ?? null;
    useEffect(() => {
        if (!inviteId || !invite || removing || isMeetingConciergeInviteTerminal(invite)) return;
        let disposed = false;
        const refresh = () => {
            void readMeetingConciergeInvite(meetingApiPath, inviteId)
                .then(nextInvite => { if (!disposed) setInvite(nextInvite); })
                .catch(() => undefined);
        };
        refresh();
        const timer = window.setInterval(refresh, 15_000);
        return () => {
            disposed = true;
            window.clearInterval(timer);
        };
    }, [invite, inviteId, meetingApiPath, removing]);

    useEffect(() => {
        if (!invite) return;
        const effectiveParticipationMode = groupCall ? participationMode : 'participant';
        storeMeetingConciergeInvite(adapter.agent.key, {
            invite,
            provider,
            groupCall,
            maxDurationMinutes,
            ...(adapter.participation ? { participationMode: effectiveParticipationMode } : {}),
            savedAt: Date.now(),
        });
    }, [adapter.agent.key, adapter.participation, groupCall, invite, maxDurationMinutes, participationMode, provider]);

    const scheduledJoinAt = (() => {
        const value = new Date(`${date}T${time}:00`);
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    })();
    const joinAt = joinTiming === 'scheduled' ? scheduledJoinAt : null;
    const effectiveParticipationMode: MeetingConciergeParticipationMode = groupCall ? participationMode : 'participant';
    const participationLabel = adapter.participation?.options.find(option => option.mode === effectiveParticipationMode)?.title ?? null;

    async function createInvite() {
        if (joinTiming === 'scheduled' && !joinAt) return;
        setBusy(true);
        setError('');
        try {
            const created = await createMeetingConciergeInvite(meetingApiPath, {
                meetingUrl,
                ...(joinAt ? { joinAt } : {}),
                groupCall,
                purpose,
                maxDurationMinutes,
                ...(adapter.participation ? { participationMode: effectiveParticipationMode } : {}),
            });
            setInvite(created);
            setRestoredInvite(false);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : `${adapter.agent.name} could not be scheduled`);
        } finally {
            setBusy(false);
        }
    }

    async function removeInvite() {
        if (!invite) return;
        setRemoving(true);
        setError('');
        try {
            const removed = await removeMeetingConciergeInvite(meetingApiPath, invite.id);
            setInvite({
                ...invite,
                ...removed,
                provider: invite.provider,
                joinAt: invite.joinAt,
            });
            setConfirmingRemoval(false);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : `${adapter.agent.name} could not be removed from the meeting`);
        } finally {
            setRemoving(false);
        }
    }

    function scheduleAnotherMeeting() {
        clearStoredMeetingConciergeInvite(adapter.agent.key);
        setInvite(null);
        setMeetingUrl('');
        setStep(1);
        setConfirmingRemoval(false);
        setRestoredInvite(false);
        setError('');
    }

    if (invite) {
        const joinState = invite.joinState?.replaceAll('_', ' ') ?? null;
        const terminal = isMeetingConciergeInviteTerminal(invite);
        const removalLabel = invite.status === 'pending' ? 'Cancel invitation' : `Remove ${adapter.agent.name} from meeting`;
        return (
            <div className={styles.scheduler} data-meeting-concierge-version={MEETING_CONCIERGE_VERSION} data-meeting-concierge-agent={adapter.agent.key} data-meeting-concierge-state="confirmed">
                <div className={styles.confirmIcon}><Check size={25} /></div>
                <p className={styles.eyebrow}>Invitation created</p>
                <h1 className={styles.title}>{adapter.copy.confirmedTitle}</h1>
                <p className={styles.intro}>{statusCopy(adapter.agent.name, invite, joinState)}</p>
                {restoredInvite ? <p className={styles.restoredNote}>Restored from this browser so you can continue monitoring or remove {adapter.agent.name}.</p> : null}
                <div className={styles.liveStatus} data-status={invite.status} role="status" aria-live="polite">
                    <span aria-hidden="true" />
                    <div><strong>{joinState || invite.status.replaceAll('_', ' ')}</strong><small>This follows {adapter.agent.name}&apos;s Anam participant—not the meeting window on your computer.</small></div>
                </div>
                <dl className={styles.confirmFacts}>
                    <div><dt>Platform</dt><dd>{PROVIDER_COPY[provider].name}</dd></div>
                    <div><dt>Status</dt><dd>{invite.status.replaceAll('_', ' ')}</dd></div>
                    <div><dt>Joins</dt><dd>{invite.joinAt ? new Date(invite.joinAt).toLocaleString() : 'Now'}</dd></div>
                    <div><dt>Mode</dt><dd>{groupCall ? `Group meeting${participationLabel ? ` · ${participationLabel}` : ' · name gated'}` : '1:1 conversation'}</dd></div>
                    <div><dt>Safety limit</dt><dd>{maxDurationMinutes} minutes</dd></div>
                </dl>
                {invite.statusReason ? <p className={styles.error}>{invite.statusReason}</p> : null}
                {confirmingRemoval && !terminal ? <div className={styles.dangerPanel} role="alert">
                    <TriangleAlert size={20} />
                    <div><strong>{invite.status === 'pending' ? 'Cancel this invitation?' : `Remove ${adapter.agent.name} now?`}</strong><p>{invite.status === 'pending' ? `${adapter.agent.name} will not join this meeting.` : `${adapter.agent.name} will leave immediately and the Anam meeting session will end.`}</p></div>
                    <button type="button" className={styles.secondaryButton} onClick={() => setConfirmingRemoval(false)} disabled={removing}>Keep meeting</button>
                    <button type="button" className={styles.dangerButton} onClick={removeInvite} disabled={removing}>{removing ? <LoaderCircle className={styles.spinner} size={16} /> : <LogOut size={16} />} Confirm</button>
                </div> : null}
                {error ? <p role="alert" className={styles.error}>{error}</p> : null}
                <div className={styles.actions}>
                    {terminal
                        ? <button type="button" className={styles.secondaryButton} onClick={scheduleAnotherMeeting}>Schedule another meeting</button>
                        : <button type="button" className={styles.dangerButton} onClick={() => setConfirmingRemoval(true)} disabled={confirmingRemoval || removing}><LogOut size={16} /> {removalLabel}</button>}
                    <Link href={adapter.agent.returnHref} className={styles.primaryButton}>Return to {adapter.agent.name} <ArrowRight size={15} /></Link>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.scheduler} data-meeting-concierge-version={MEETING_CONCIERGE_VERSION} data-meeting-concierge-agent={adapter.agent.key} data-meeting-concierge-step={step}>
            <Link href={adapter.agent.returnHref} className={styles.backLink}><ArrowLeft size={15} /> Back to {adapter.agent.name}</Link>
            <div className={styles.topline} aria-hidden="true" />
            <div className={styles.headingRow}>
                <div><p className={styles.eyebrow}>{adapter.copy.eyebrow}</p><h1 className={styles.title}>{step === 1 ? 'Set the room.' : step === 2 ? 'Set the role.' : 'Confirm the invitation.'}</h1></div>
                <ol className={styles.steps} aria-label="Meeting invitation progress">{[1, 2, 3].map(item => <li key={item} aria-current={item === step ? 'step' : undefined} data-active={item === step} data-complete={item < step}>{String(item).padStart(2, '0')}</li>)}</ol>
            </div>

            {step === 1 ? (
                <div className={styles.formStack}>
                    <fieldset><legend>Meeting platform</legend><div className={styles.providerGrid}>{(Object.keys(PROVIDER_COPY) as MeetingConciergeProvider[]).map(item => (
                        <button key={item} type="button" aria-pressed={provider === item} data-selected={provider === item} onClick={() => setProvider(item)}>{platformMark(item, styles)}<span><strong>{PROVIDER_COPY[item].name}</strong><small>{PROVIDER_COPY[item].hint}</small></span>{provider === item ? <Check size={16} /> : null}</button>
                    ))}</div></fieldset>
                    <label>Meeting link<input type="url" value={meetingUrl} onChange={event => { const value = event.target.value; setMeetingUrl(value); const detected = detectMeetingConciergeProvider(value); if (detected) setProvider(detected); }} placeholder="Paste the meeting invitation link" autoComplete="url" /></label>
                    <fieldset><legend>When should {adapter.agent.name} join?</legend><div className={styles.timingGrid}>
                        <button type="button" aria-pressed={joinTiming === 'now'} data-selected={joinTiming === 'now'} onClick={() => setJoinTiming('now')}><Video size={20} /><span><strong>Join now</strong><small>{adapter.agent.name} connects separately after you confirm.</small></span>{joinTiming === 'now' ? <Check size={16} /> : null}</button>
                        <button type="button" aria-pressed={joinTiming === 'scheduled'} data-selected={joinTiming === 'scheduled'} onClick={() => setJoinTiming('scheduled')}><CalendarDays size={20} /><span><strong>Schedule for later</strong><small>Reserve {adapter.agent.name} for a future meeting.</small></span>{joinTiming === 'scheduled' ? <Check size={16} /> : null}</button>
                    </div></fieldset>
                    {joinTiming === 'scheduled' ? <div className={styles.fieldGrid}>
                        <label><span><CalendarDays size={14} /> Date</span><input type="date" min={localMeetingConciergeDate(0)} value={date} onChange={event => setDate(event.target.value)} /></label>
                        <label><span><Clock3 size={14} /> Time</span><input type="time" value={time} onChange={event => setTime(event.target.value)} /></label>
                        <label>Timezone<input value={timezone} readOnly aria-describedby="meeting-concierge-timezone-help" /><small id="meeting-concierge-timezone-help">Detected from your browser.</small></label>
                    </div> : <div className={styles.joinNowNote}><Clock3 size={18} /><p><strong>{adapter.agent.name} joins independently.</strong> After the invitation is created, open the meeting as host and admit the agent if needed.</p></div>}
                </div>
            ) : step === 2 ? (
                <div className={styles.formStack}>
                    <fieldset><legend>How should {adapter.agent.name} participate?</legend><div className={styles.roleGrid}>
                        <button type="button" aria-pressed={groupCall} data-selected={groupCall} onClick={() => setGroupCall(true)}><UsersRound size={22} /><span><strong>Group meeting</strong><small>{adapter.participation ? `Choose how ${adapter.agent.name} contributes below.` : `Joins quietly and responds when someone says “${adapter.agent.groupWakeName}.”`}</small></span>{groupCall ? <Check size={17} /> : null}</button>
                        <button type="button" aria-pressed={!groupCall} data-selected={!groupCall} onClick={() => setGroupCall(false)}><UserRound size={22} /><span><strong>1:1 conversation</strong><small>Greets the participant and responds naturally.</small></span>{!groupCall ? <Check size={17} /> : null}</button>
                    </div></fieldset>
                    {adapter.participation && groupCall ? <fieldset><legend>{adapter.agent.name}&apos;s role in the room</legend><div className={styles.roleGrid} data-options={adapter.participation.options.length}>
                        {adapter.participation.options.map(option => <button key={option.mode} type="button" aria-pressed={participationMode === option.mode} data-selected={participationMode === option.mode} onClick={() => setParticipationMode(option.mode)}>
                            {participationIcon(option.mode)}<span><strong>{option.title}</strong><small>{option.description}</small></span>{participationMode === option.mode ? <Check size={17} /> : null}
                        </button>)}
                    </div></fieldset> : null}
                    <fieldset><legend>Automatic safety limit</legend><div className={styles.durationGrid}>{MEETING_CONCIERGE_DURATION_MINUTES.map(minutes => (
                        <button key={minutes} type="button" aria-pressed={maxDurationMinutes === minutes} data-selected={maxDurationMinutes === minutes} onClick={() => setMaxDurationMinutes(minutes)}><Clock3 size={18} /><span><strong>{minutes} minutes</strong><small>The meeting session ends at this limit.</small></span>{maxDurationMinutes === minutes ? <Check size={16} /> : null}</button>
                    ))}</div></fieldset>
                    <label>Meeting purpose <span className={styles.optional}>Optional</span><textarea value={purpose} onChange={event => setPurpose(event.target.value)} maxLength={500} placeholder={`Give ${adapter.agent.name} a short, factual objective for the room.`} /></label>
                    <div className={styles.note}><ShieldCheck size={18} /><p>{adapter.copy.personaBoundary}</p></div>
                </div>
            ) : (
                <div className={styles.formStack}>
                    <div className={styles.reviewCard}><div>{platformMark(provider, styles)}<span><strong>{PROVIDER_COPY[provider].name}</strong><small>{joinAt ? new Date(joinAt).toLocaleString() : 'Join now'} · {groupCall ? `Group meeting${participationLabel ? ` · ${participationLabel}` : ''}` : '1:1 conversation'} · {maxDurationMinutes} minute limit</small></span></div><button type="button" onClick={() => setStep(1)}>Edit</button></div>
                    {purpose.trim() ? <p className={styles.purposeReview}><strong>Working objective:</strong> {purpose.trim()}</p> : null}
                    {authenticated ? <div className={styles.verifiedCard}><ShieldCheck size={21} /><div><strong>{adapter.copy.authenticatedLabel}</strong><span>{displayName || 'Verified organizer'} · existing consent and follow-up settings remain unchanged.</span></div></div> : <CheckInFields adapter={adapter} styles={styles} onAuthenticated={name => { setAuthenticated(true); setDisplayName(name ?? 'Organizer'); }} onError={setError} />}
                    <div className={styles.note}><Mail size={18} /><p>{adapter.copy.contactBoundary}</p></div>
                </div>
            )}

            {error ? <p role="alert" className={styles.error}>{error}</p> : null}
            <div className={styles.actions}>
                {step > 1 ? <button type="button" className={styles.secondaryButton} onClick={() => setStep(value => value - 1)}>Back</button> : <span />}
                {step < 3 ? <button type="button" className={styles.primaryButton} onClick={() => setStep(value => value + 1)} disabled={step === 1 && (!meetingUrl.trim() || (joinTiming === 'scheduled' && !joinAt))}>Continue <ArrowRight size={16} /></button> : <button type="button" className={styles.primaryButton} onClick={createInvite} disabled={!authenticated || busy}>{busy ? <LoaderCircle className={styles.spinner} size={16} /> : null} Invite {adapter.agent.name} <ArrowRight size={16} /></button>}
            </div>
        </div>
    );
}
