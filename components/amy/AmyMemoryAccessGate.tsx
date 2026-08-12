'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Brain, CheckCircle2, LogOut, RotateCcw, Sparkles, UserRound, X } from 'lucide-react';

type AccessStatus = {
    required: boolean;
    authenticated: boolean;
    displayName: string | null;
    memoryConsent: boolean;
    approvedMemoryCount: number;
    recentMemoryDates: string[];
};

type AmyMemoryAccessGateProps = {
    children: ReactNode;
};

const emptyStatus: AccessStatus = {
    required: true,
    authenticated: false,
    displayName: null,
    memoryConsent: false,
    approvedMemoryCount: 0,
    recentMemoryDates: [],
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
    return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function normalizeStatus(payload: Record<string, unknown>): AccessStatus {
    return {
        required: payload.required !== false,
        authenticated: payload.authenticated === true,
        displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
        memoryConsent: payload.memoryConsent === true,
        approvedMemoryCount: Number.isInteger(payload.approvedMemoryCount)
            ? Number(payload.approvedMemoryCount)
            : 0,
        recentMemoryDates: Array.isArray(payload.recentMemoryDates)
            ? payload.recentMemoryDates.filter(item => typeof item === 'string').slice(-3)
            : [],
    };
}

export default function AmyMemoryAccessGate({ children }: AmyMemoryAccessGateProps) {
    const [status, setStatus] = useState<AccessStatus>(emptyStatus);
    const [checking, setChecking] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [accessCode, setAccessCode] = useState('');
    const [memoryConsent, setMemoryConsent] = useState(false);
    const [profileControlsOpen, setProfileControlsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [checkInResult, setCheckInResult] = useState<AccessStatus | null>(null);

    const checkAccess = useCallback(async () => {
        setChecking(true);
        setError(null);
        try {
            const response = await fetch('/api/anam/amy/access', {
                cache: 'no-store',
                credentials: 'same-origin',
            });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(String(payload.error ?? 'Memory check-in is unavailable'));
            setStatus(normalizeStatus(payload));
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Memory check-in is unavailable');
            setStatus(emptyStatus);
        } finally {
            setChecking(false);
        }
    }, []);

    const requireFreshCheckIn = useCallback(async () => {
        setChecking(true);
        setError(null);
        try {
            const response = await fetch('/api/anam/amy/access', {
                method: 'DELETE',
                cache: 'no-store',
                credentials: 'same-origin',
            });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(String(payload.error ?? 'A fresh check-in could not be started'));
            await checkAccess();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'A fresh check-in could not be started');
            setStatus(emptyStatus);
            setChecking(false);
        }
    }, [checkAccess]);

    useEffect(() => {
        void requireFreshCheckIn();
    }, [requireFreshCheckIn]);

    const submitAccess = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        setNotice(null);
        try {
            const response = await fetch('/api/anam/amy/access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ displayName, email, accessCode, memoryConsent }),
            });
            const payload = await readJson(response);
            if (!response.ok) throw new Error(String(payload.error ?? 'Access was not granted'));
            const nextStatus = normalizeStatus(payload);
            setStatus(nextStatus);
            setCheckInResult(nextStatus);
            setAccessCode('');
            setNotice(nextStatus.approvedMemoryCount > 0
                ? `Amy found ${nextStatus.approvedMemoryCount} saved conversation highlight(s) for you.`
                : 'You’re all set. Amy is ready to meet you.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Access was not granted');
        } finally {
            setSubmitting(false);
        }
    };

    const editCheckIn = async () => {
        setError(null);
        await fetch('/api/anam/amy/access', {
            method: 'DELETE',
            credentials: 'same-origin',
        }).catch(() => undefined);
        setStatus(emptyStatus);
        setCheckInResult(null);
        setAccessCode('');
    };

    const continueToAmy = () => {
        if (!checkInResult) return;
        setNotice(
            checkInResult.memoryConsent && checkInResult.approvedMemoryCount > 0
                ? `${checkInResult.approvedMemoryCount} previous conversation ${checkInResult.approvedMemoryCount === 1 ? 'note is' : 'notes are'} ready.`
                : checkInResult.memoryConsent
                    ? 'Starting with a fresh conversation.'
                    : 'Memory is off for this visit.',
        );
        setEmail('');
        setCheckInResult(null);
    };

    const logout = async () => {
        await fetch('/api/anam/amy/access', {
            method: 'DELETE',
            credentials: 'same-origin',
        }).catch(() => undefined);
        setStatus(emptyStatus);
        setNotice(null);
        setDisplayName('');
        setProfileControlsOpen(false);
    };

    const forgetMemory = async () => {
        if (!window.confirm('Clear everything Amy remembers for this profile?')) return;
        setError(null);
        const response = await fetch('/api/anam/amy/memory', {
            method: 'DELETE',
            credentials: 'same-origin',
        });
        const payload = await readJson(response);
        if (!response.ok) {
            setError(String(payload.error ?? 'Memory could not be removed'));
            return;
        }
        setStatus(current => ({
            ...current,
            approvedMemoryCount: 0,
            recentMemoryDates: [],
        }));
        setNotice('Amy’s saved conversation highlights were cleared.');
    };

    if (checking) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-200">
                <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm">
                    <Brain className="h-4 w-4 animate-pulse text-indigo-300" />
                    Getting Amy ready…
                </div>
            </main>
        );
    }

    if (status.authenticated && checkInResult) {
        const memoryFound = checkInResult.memoryConsent && checkInResult.approvedMemoryCount > 0;
        const memoryMissing = checkInResult.memoryConsent && checkInResult.approvedMemoryCount === 0;
        return (
            <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07080d] px-5 py-10 text-white">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.17),transparent_42%)]" />
                <section className="relative w-full max-w-lg rounded-[1.75rem] border border-white/10 bg-[#0d0f17]/95 p-8 shadow-2xl sm:p-10">
                    <div className={`grid h-12 w-12 place-items-center rounded-full border ${memoryMissing ? 'border-amber-300/25 bg-amber-300/10 text-amber-200' : 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200'}`}>
                        {memoryMissing ? <AlertCircle className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
                    </div>
                    <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                        Check-in complete
                    </p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                        {memoryFound
                            ? 'Previous conversation found.'
                            : memoryMissing
                                ? 'No previous conversation found.'
                                : 'You are ready to meet Amy.'}
                    </h1>
                    <p className="mt-4 text-base leading-7 text-zinc-400">
                        {memoryFound
                            ? `Amy found ${checkInResult.approvedMemoryCount} reviewed ${checkInResult.approvedMemoryCount === 1 ? 'note' : 'notes'} from an earlier conversation.`
                            : memoryMissing
                                ? 'If you have met Amy before, check the email spelling. Otherwise, continue and start fresh.'
                                : 'Amy will start fresh for this visit.'}
                    </p>
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                        {memoryMissing && (
                            <button
                                type="button"
                                onClick={() => void editCheckIn()}
                                className="rounded-xl border border-white/15 px-5 py-3 font-medium text-zinc-200 transition hover:border-white/30 hover:bg-white/5"
                            >
                                Check email
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={continueToAmy}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200"
                        >
                            {memoryMissing ? 'Continue fresh' : 'Continue to Amy'}
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    </div>
                    <p className="mt-6 text-xs leading-5 text-zinc-600">
                        Your email stays private and is never shown to Amy.
                    </p>
                </section>
            </main>
        );
    }

    if (status.authenticated) {
        return (

            <div className="relative">
                {status.required && (
                    <>
                        <button
                            type="button"
                            onClick={() => setProfileControlsOpen(open => !open)}
                            aria-label="Open Amy profile controls"
                            aria-expanded={profileControlsOpen}
                            aria-controls="amy-profile-controls"
                            title="Profile and memory"
                            className="fixed bottom-3 left-3 z-[600] grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/35 text-white/55 shadow-lg backdrop-blur-md transition hover:border-white/25 hover:bg-black/60 hover:text-white"
                        >
                            <UserRound className="h-4 w-4" />
                        </button>
                        {profileControlsOpen && (
                            <aside
                                id="amy-profile-controls"
                                className="fixed bottom-14 left-3 z-[600] w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-white/15 bg-zinc-950/90 p-4 text-xs text-zinc-300 shadow-2xl backdrop-blur-xl"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="font-semibold text-white">
                                            {status.displayName ? `Welcome, ${status.displayName}` : 'Welcome back'}
                                        </p>
                                        <p className="mt-1 text-zinc-400">
                                            {status.memoryConsent
                                                ? `${status.approvedMemoryCount} saved conversation highlight(s)`
                                                : 'Starting fresh for this visit'}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setProfileControlsOpen(false)}
                                        aria-label="Close profile controls"
                                        className="rounded-full p-1 text-zinc-500 transition hover:bg-white/10 hover:text-white"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                {notice && <p className="mt-3 text-emerald-300">{notice}</p>}
                                {error && <p className="mt-3 text-rose-300">{error}</p>}
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {status.memoryConsent && status.approvedMemoryCount > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => void forgetMemory()}
                                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-zinc-300 transition hover:border-rose-400/40 hover:text-rose-200"
                                        >
                                            <RotateCcw className="h-3 w-3" />
                                            Clear memory
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => void logout()}
                                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-zinc-300 transition hover:border-white/25 hover:text-white"
                                    >
                                        <LogOut className="h-3 w-3" />
                                        Switch user
                                    </button>
                                </div>
                            </aside>
                        )}
                    </>
                )}
                {children}
            </div>
        );
    }

    return (
        <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#07080d] px-5 py-10 text-white">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.17),transparent_42%)]" />
            <div className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#0d0f17]/95 shadow-2xl">
                <section className="hidden">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
                            <Sparkles className="h-4 w-4" />
                            Private preview
                        </div>
                        <h1 className="mt-7 max-w-lg text-4xl font-semibold tracking-tight sm:text-5xl">
                            Meet Amy.
                        </h1>
                        <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
                            A quick check-in opens your private preview and, if you choose, helps Amy pick up where you left off next time.
                        </p>
                        <div className="mt-8 max-w-xl border-l border-indigo-300/30 pl-5">
                            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-indigo-200/80">
                                About Amy
                            </p>
                            <p className="mt-2 text-sm leading-6 text-zinc-300">
                                Amy is AI Fusion Labs’ Insight Enterprise SDR—an AI-powered X Agent who helps technology leaders explore infrastructure priorities, clarify requirements, and shape practical next steps.
                            </p>
                        </div>
                    </div>
                    <div className="mt-10 space-y-3 text-sm text-zinc-400">
                        <p>It takes about a minute to get started.</p>
                        <p>You decide whether Amy remembers helpful conversation highlights.</p>
                        <p>You can clear what she remembers whenever you like.</p>
                    </div>
                </section>

                <section className="p-7 sm:p-9">
                    <div className="mb-7">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
                            Amy / Insight Enterprise SDR
                        </p>
                        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Meet Amy.</h1>
                        <p className="mt-3 text-sm leading-6 text-zinc-400">
                            Sign in to begin. We use this address privately for your post-session recap, Visual Brief, and follow-up support.
                        </p>
                    </div>
                    <div className="hidden">
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-indigo-200">
                            <UserRound className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold">Let’s get you connected</h2>
                            <p className="text-sm text-zinc-500">Just a few details before your conversation</p>
                        </div>
                    </div>

                    <form onSubmit={submitAccess} className="space-y-4">
                        <label className="block text-sm text-zinc-300">
                            Your name
                            <input
                                required
                                autoComplete="name"
                                value={displayName}
                                onChange={event => setDisplayName(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
                                placeholder="Your first name"
                            />
                            <span className="hidden">
                                Used only for your preview profile. Amy will still ask how you’d like to be addressed.
                            </span>
                        </label>
                        <label className="block text-sm text-zinc-300">
                            Email
                            <input
                                required
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={event => setEmail(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
                                placeholder="you@example.com"
                            />
                        </label>
                        <label className="block text-sm text-zinc-300">
                            Access code
                            <input
                                required
                                type="password"
                                autoComplete="current-password"
                                value={accessCode}
                                onChange={event => setAccessCode(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
                                placeholder="Provided with your invitation"
                            />
                        </label>
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                            <input
                                type="checkbox"
                                checked={memoryConsent}
                                onChange={event => setMemoryConsent(event.target.checked)}
                                className="mt-1 h-4 w-4 accent-indigo-500"
                            />
                            <span>
                                <strong className="font-medium text-white">Remember this email</strong>
                                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                                    Amy can find reviewed notes on your next visit. Turn this off to start fresh.
                                </span>
                            </span>
                        </label>

                        {error && (
                            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                                {error}
                            </div>
                        )}
                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full rounded-xl bg-indigo-500 px-5 py-3.5 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {submitting ? 'Getting things ready…' : 'Continue to Amy'}
                        </button>
                        <p className="text-xs leading-5 text-zinc-500">
                            By continuing, you agree to receive Amy&apos;s session follow-up at the email above. Amy will not ask you to repeat or confirm the address during the conversation.
                        </p>
                        <button
                            type="button"
                            onClick={() => void checkAccess()}
                            className="hidden"
                        >
                            Having trouble? Try again
                        </button>
                        <details className="hidden">
                            <summary className="cursor-pointer list-none text-zinc-400 transition hover:text-zinc-200">
                                How remembering works
                            </summary>
                            <p className="mt-2 text-xs leading-5">
                                Your email is used behind the scenes to recognize you on future visits; Amy does not see it. Only reviewed conversation highlights can carry over, and you can clear them at any time.
                            </p>
                        </details>
                    </form>
                </section>
            </div>
            <footer className="hidden">
                Amy is an AI-powered agent, not a human. Conversations may be transcribed and reviewed to support this preview. Please don’t share sensitive or confidential information.
            </footer>
        </main>
    );
            <footer className="relative mt-5 max-w-lg text-center text-[0.7rem] leading-5 text-zinc-600">
                Amy is an AI agent. Conversations may be transcribed and reviewed. Do not share sensitive information.
            </footer>
}
