'use client';

import Image from 'next/image';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { ArrowRight, BrainCircuit, KeyRound, LockKeyhole, Mail, UserRound } from 'lucide-react';
import styles from './DaniEditorial.module.css';
import DaniMemoryControls from './DaniMemoryControls';

type SubmitMode = 'email' | 'guest' | 'verify' | null;

export default function DaniContactGate({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false);
    const [checking, setChecking] = useState(true);
    const [submitting, setSubmitting] = useState<SubmitMode>(null);
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [emailFollowUpAvailable, setEmailFollowUpAvailable] = useState(false);
    const [followUpConsent, setFollowUpConsent] = useState(false);
    const [memoryAvailable, setMemoryAvailable] = useState(false);
    const [memoryConsent, setMemoryConsent] = useState(false);
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [verificationCode, setVerificationCode] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        void fetch('/api/anam/dani/access', {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
        }).then(async response => {
            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (active) {
                const followUpAvailable = payload.emailFollowUpAvailable === true;
                setEmailFollowUpAvailable(followUpAvailable);
                setFollowUpConsent(followUpAvailable);
                setMemoryAvailable(payload.memoryAvailable === true);
            }
            // A prior guest or verified-contact cookie may remain valid for a few
            // hours, but recap consent is per conversation. Never use prior access
            // state to bypass the entry choice for a new Dani session.
        }).catch(() => undefined).finally(() => {
            if (active) setChecking(false);
        });
        return () => {
            active = false;
            controller.abort();
        };
    }, []);

    const requestAccess = async (mode: Exclude<SubmitMode, null>) => {
        setSubmitting(mode);
        setError(null);
        try {
            const response = await fetch('/api/anam/dani/access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify(mode === 'guest'
                    ? { guest: true }
                    : { displayName, email, followUpConsent, memoryConsent }),
            });
            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (
                response.status === 202
                && payload.verificationRequired === true
                && typeof payload.challengeId === 'string'
            ) {
                setChallengeId(payload.challengeId);
                setVerificationCode('');
                return;
            }
            if (!response.ok || payload.authenticated !== true) {
                throw new Error(typeof payload.error === 'string' ? payload.error : 'Dani could not be started');
            }
            setEmail('');
            setReady(true);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Dani could not be started');
        } finally {
            setSubmitting(null);
        }
    };

    const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!followUpConsent && !memoryConsent) {
            setError('Choose email recap, returning memory, or continue as a guest.');
            return;
        }
        await requestAccess('email');
    };

    const verifyEmail = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!challengeId) return;
        setSubmitting('verify');
        setError(null);
        try {
            const response = await fetch('/api/anam/dani/access/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({ challengeId, verificationCode }),
            });
            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (
                !response.ok
                || payload.authenticated !== true
                || (payload.memoryVerified !== true && payload.followUpAuthorized !== true)
            ) {
                throw new Error(typeof payload.error === 'string' ? payload.error : 'The verification code could not be confirmed');
            }
            setEmail('');
            setVerificationCode('');
            setReady(true);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'The verification code could not be confirmed');
        } finally {
            setSubmitting(null);
        }
    };

    if (checking) return (
        <main className={`${styles.root} ${styles.paper} flex min-h-[100svh] items-center justify-center px-5 text-[#151b19]`}>
            <div
                role="status"
                className="flex items-center gap-3 border border-[#c9c3b4] bg-[#f8f4e9]/90 px-5 py-3 text-sm font-semibold shadow-[0_18px_55px_rgba(21,27,25,.1)]"
            >
                <BrainCircuit className="h-4 w-4 animate-pulse text-[#126e64] motion-reduce:animate-none" />
                Preparing your session with Dani
            </div>
        </main>
    );
    if (ready) return <>{children}<DaniMemoryControls /></>;

    return (
        <main
            className={`${styles.root} min-h-[100svh] overflow-x-hidden bg-[#eee9dc] text-[#151b19] md:h-[100svh] md:overflow-hidden`}
            data-dani-surface="entry"
        >
            <section className="grid min-h-[100svh] w-full md:h-[100svh] md:grid-cols-[minmax(18rem,.86fr)_minmax(27rem,1.14fr)]">
                <div className="relative min-h-[13rem] overflow-hidden bg-[#17201d] md:min-h-0">
                    <Image
                        src="/agents/thumbnails/dani-x-agent-director-cara4-2026.jpg"
                        alt="Dani, AI Solutions Director at AI Fusion Labs"
                        fill
                        priority
                        sizes="(max-width: 767px) 100vw, 44vw"
                        className={styles.entryPortraitImage}
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,12,10,.12)_18%,rgba(7,12,10,.04)_42%,rgba(7,12,10,.88)_100%)]" />

                    <div className={`${styles.mono} absolute left-5 top-[max(1.25rem,env(safe-area-inset-top))] z-10 flex items-center text-[10px] font-bold uppercase tracking-[0.16em] text-white sm:left-8`}>
                        <span aria-hidden="true" className="mr-2.5 h-2 w-2 rounded-full bg-[#d55538]" />
                        AI Fusion Labs
                    </div>

                    <div className={`${styles.entrance} absolute inset-x-0 bottom-0 z-10 p-5 text-white sm:p-8 lg:p-10`}>
                        <p className={`${styles.mono} text-[10px] font-semibold uppercase tracking-[0.17em] text-[#dbffef]`}>
                            AI Solutions Director
                        </p>
                        <h1 className={`${styles.display} mt-2 text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-[.92] tracking-[-.045em]`}>
                            Hi, I&apos;m Dani.
                        </h1>
                        <p className="mt-3 max-w-md text-[13px] leading-5 text-white/82 sm:text-sm sm:leading-6">
                            Let&apos;s make the business problem clearer before we choose the technology.
                        </p>
                    </div>
                </div>

                <div className={`${styles.paper} ${styles.entryPanel} relative flex min-h-0 overflow-y-auto`}>
                    <div className={`${styles.entrance} ${styles.entryContent} m-auto w-full max-w-[52rem] px-5 py-7 pb-[max(2.25rem,env(safe-area-inset-bottom))] sm:px-9 sm:py-12 md:px-[clamp(2rem,4vw,4.5rem)]`}>
                        <div className={`${styles.entryRule} mb-5 h-px w-14 bg-[#d55538] sm:mb-7`} aria-hidden="true" />
                        <p className={`${styles.mono} text-[10px] font-bold uppercase tracking-[0.17em] text-[#126e64]`}>
                            A focused working session
                        </p>
                        <h2 className={`${styles.display} ${styles.entryHeading} mt-3 max-w-[18ch] text-[clamp(2.15rem,5vw,4.75rem)] font-semibold leading-[.94] tracking-[-.05em]`}>
                            Bring the problem. I&apos;ll help frame the path.
                        </h2>
                        <p className={`${styles.entryIntro} mt-3 max-w-[40rem] text-sm leading-6 text-[#626861] sm:mt-5 sm:text-[15px] sm:leading-7`}>
                            {emailFollowUpAvailable || memoryAvailable
                                ? 'Share a verified email for your recap, optional returning memory, or both. You can also continue as a guest.'
                                : 'Dani is ready to talk without collecting your name or email. Continue as a guest to begin.'}
                        </p>

                        {(emailFollowUpAvailable || memoryAvailable || challengeId) && <form
                            className={`${styles.entryForm} mt-5 grid gap-4 sm:mt-7`}
                            onSubmit={challengeId ? verifyEmail : submitEmail}
                            aria-busy={submitting !== null}
                            data-dani-access-form
                        >
                            {!challengeId && <div className="grid gap-4 xl:grid-cols-2">
                                <label className="block">
                                    <span className={`${styles.mono} flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#313936]`}>
                                        <UserRound aria-hidden="true" size={14} /> Name
                                    </span>
                                    <input
                                        required
                                        autoComplete="name"
                                        value={displayName}
                                        onChange={event => setDisplayName(event.target.value)}
                                        className={`${styles.entryField} mt-2 h-14 w-full rounded-[3px] border border-[#bdb6a6] bg-white/35 px-4 text-[15px] text-[#151b19] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[#737970] hover:bg-white/50 focus-visible:border-[#126e64] focus-visible:bg-white/70 focus-visible:ring-2 focus-visible:ring-[#126e64]/25`}
                                        placeholder="How should Dani address you?"
                                    />
                                </label>
                                <label className="block">
                                    <span className={`${styles.mono} flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#313936]`}>
                                        <Mail aria-hidden="true" size={14} /> Verified email
                                    </span>
                                    <input
                                        required
                                        type="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={event => setEmail(event.target.value)}
                                        className={`${styles.entryField} mt-2 h-14 w-full rounded-[3px] border border-[#bdb6a6] bg-white/35 px-4 text-[15px] text-[#151b19] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[#737970] hover:bg-white/50 focus-visible:border-[#126e64] focus-visible:bg-white/70 focus-visible:ring-2 focus-visible:ring-[#126e64]/25`}
                                        placeholder="you@example.com"
                                    />
                                </label>
                            </div>}

                            {!challengeId && (
                                <fieldset aria-describedby="dani-email-purpose-help">
                                    <legend className={`${styles.mono} text-[10px] font-bold uppercase tracking-[0.12em] text-[#313936]`}>
                                        Use this email for
                                    </legend>
                                    <div className={`mt-2 grid overflow-hidden rounded-[3px] border border-[#bdb6a6] bg-[#bdb6a6] ${emailFollowUpAvailable && memoryAvailable ? 'gap-px sm:grid-cols-2' : ''}`}>
                                        {emailFollowUpAvailable && (
                                            <label className={`${styles.entryPurposeChoice} flex cursor-pointer items-start gap-3 p-3.5 transition-colors ${followUpConsent ? 'bg-[#e1ebe3]' : 'bg-[#f8f4e9] hover:bg-white/75'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={followUpConsent}
                                                    onChange={event => {
                                                        setFollowUpConsent(event.target.checked);
                                                        setError(null);
                                                    }}
                                                    aria-describedby="dani-follow-up-description"
                                                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#126e64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d55538]"
                                                />
                                                <span className="min-w-0">
                                                    <strong className="block text-[13px] font-extrabold text-[#151b19]">Email my recap</strong>
                                                    <span id="dani-follow-up-description" className="mt-0.5 block text-[11px] leading-[1.45] text-[#626861]">
                                                        Thank-you and working recap after this session.
                                                    </span>
                                                </span>
                                            </label>
                                        )}
                                        {memoryAvailable && (
                                            <label className={`${styles.entryPurposeChoice} flex cursor-pointer items-start gap-3 p-3.5 transition-colors ${memoryConsent ? 'bg-[#e1ebe3]' : 'bg-[#f8f4e9] hover:bg-white/75'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={memoryConsent}
                                                    onChange={event => {
                                                        setMemoryConsent(event.target.checked);
                                                        setError(null);
                                                    }}
                                                    aria-describedby="dani-memory-consent-description"
                                                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#126e64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d55538]"
                                                />
                                                <span className="min-w-0">
                                                    <strong className="block text-[13px] font-extrabold text-[#151b19]">Remember me across sessions</strong>
                                                    <span id="dani-memory-consent-description" className="mt-0.5 block text-[11px] leading-[1.45] text-[#626861]">
                                                        Reviewed highlights only&mdash;not your raw transcript.
                                                    </span>
                                                </span>
                                            </label>
                                        )}
                                    </div>
                                    <p id="dani-email-purpose-help" className={`${styles.entryPurposeHelp} mt-2 text-[11px] leading-5 text-[#70756e]`}>
                                        A one-time code verifies the address. These choices are separate and can be changed independently.
                                    </p>
                                </fieldset>
                            )}
                            {challengeId && (
                                <div className="grid gap-4">
                                    <div className="border-l-4 border-[#126e64] bg-[#dfe9e1] px-4 py-3 text-sm leading-6 text-[#28433e]">
                                        We sent a six-digit code to the address you entered. It expires in 10 minutes and does not reveal whether earlier notes exist.
                                    </div>
                                    <label className="block">
                                        <span className={`${styles.mono} flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#313936]`}>
                                            <KeyRound aria-hidden="true" size={14} /> Verification code
                                        </span>
                                        <input
                                            required
                                            inputMode="numeric"
                                            autoComplete="one-time-code"
                                            pattern="[0-9]{6}"
                                            maxLength={6}
                                            value={verificationCode}
                                            onChange={event => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                                            className={`${styles.mono} mt-2 h-14 w-full rounded-[3px] border border-[#bdb6a6] bg-white/45 px-4 text-center text-xl font-bold tracking-[0.35em] text-[#151b19] outline-none focus-visible:border-[#126e64] focus-visible:ring-2 focus-visible:ring-[#126e64]/25`}
                                            placeholder="000000"
                                            aria-label="Six-digit email verification code"
                                        />
                                    </label>
                                </div>
                            )}
                            {error && (
                                <p role="alert" className="border-l-4 border-[#b63d2b] bg-[#f1ded5] px-4 py-3 text-sm leading-6 text-[#742a20]">
                                    {error}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={submitting !== null}
                                aria-label={challengeId ? 'Verify email and start conversation' : 'Start conversation'}
                                className={`${styles.entryAction} group inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-[3px] bg-[#126e64] px-5 text-sm font-extrabold text-white shadow-[0_12px_30px_rgba(18,110,100,.15)] transition-[transform,background-color,box-shadow] hover:-translate-y-0.5 hover:bg-[#0d5d54] hover:shadow-[0_16px_38px_rgba(18,110,100,.22)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d55538] disabled:translate-y-0 disabled:cursor-wait disabled:opacity-60 motion-reduce:transform-none`}
                            >
                                {submitting === 'email'
                                    ? 'Sending secure code...'
                                    : submitting === 'verify'
                                        ? 'Verifying...'
                                        : challengeId
                                            ? 'Verify and begin'
                                            : 'Send code and continue'}
                                {submitting === null && <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" />}
                            </button>
                            {challengeId && (
                                <button
                                    type="button"
                                    disabled={submitting !== null}
                                    onClick={() => {
                                        setChallengeId(null);
                                        setVerificationCode('');
                                        setError(null);
                                    }}
                                    className="text-sm font-bold text-[#126e64] underline decoration-[#126e64]/35 underline-offset-4 hover:decoration-[#126e64] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#126e64]"
                                >
                                    Change name or email
                                </button>
                            )}
                        </form>}

                        {!challengeId && (emailFollowUpAvailable || memoryAvailable) && <div className={`${styles.mono} ${styles.entryDivider} my-3 flex items-center gap-3 text-[9px] font-bold uppercase tracking-[0.16em] text-[#7a7d74]`}>
                            <span className="h-px flex-1 bg-[#c9c3b4]" /> Or <span className="h-px flex-1 bg-[#c9c3b4]" />
                        </div>}
                        {!challengeId && <button
                            type="button"
                            disabled={submitting !== null}
                            onClick={() => void requestAccess('guest')}
                            aria-label="Continue without email"
                            className={`${styles.entryAction} group inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-[3px] border border-[#a9a292] bg-transparent px-5 text-sm font-extrabold text-[#151b19] transition-[transform,border-color,background-color] hover:-translate-y-0.5 hover:border-[#126e64] hover:bg-white/45 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#126e64] disabled:translate-y-0 disabled:cursor-wait disabled:opacity-60 motion-reduce:transform-none`}
                        >
                            {submitting === 'guest' ? 'Opening Dani...' : 'Continue as a guest'}
                            {submitting !== 'guest' && <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" />}
                        </button>}
                        <p id="dani-session-privacy" className={`${styles.entryPrivacy} mt-4 flex max-w-[42rem] gap-2.5 text-[11px] leading-5 text-[#626861]`}>
                            <LockKeyhole aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#126e64]" />
                            <span>Dani is an AI. Your typed address stays outside her spoken context. Returning memory is email-verified, optional, separately consented, and limited to reviewed notes. Sessions may be transcribed for requested follow-up. Do not share secrets or sensitive records.</span>
                        </p>
                    </div>
                </div>
            </section>
        </main>
    );
}
