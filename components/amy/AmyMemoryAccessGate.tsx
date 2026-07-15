'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Brain, LockKeyhole, LogOut, RotateCcw, ShieldCheck } from 'lucide-react';

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
    const [memoryConsent, setMemoryConsent] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

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

    useEffect(() => {
        void checkAccess();
    }, [checkAccess]);

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
            setAccessCode('');
            setEmail('');
            setNotice(nextStatus.approvedMemoryCount > 0
                ? `${nextStatus.approvedMemoryCount} approved prior-session note(s) are ready for Amy.`
                : 'Check-in complete. No approved prior-session notes were found.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Access was not granted');
        } finally {
            setSubmitting(false);
        }
    };

    const logout = async () => {
        await fetch('/api/anam/amy/access', {
            method: 'DELETE',
            credentials: 'same-origin',
        }).catch(() => undefined);
        setStatus(emptyStatus);
        setNotice(null);
        setDisplayName('');
    };

    const forgetMemory = async () => {
        if (!window.confirm('Remove all approved Amy memories associated with this test identity?')) return;
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
        setNotice('Approved returning memories were removed. New sessions can still create review candidates.');
    };

    if (checking) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-200">
                <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm">
                    <Brain className="h-4 w-4 animate-pulse text-indigo-300" />
                    Checking Amy memory access…
                </div>
            </main>
        );
    }

    if (status.authenticated) {
        return (
            <div className="relative">
                {status.required && (
                    <aside className="fixed left-4 top-4 z-[600] max-w-sm rounded-2xl border border-white/15 bg-zinc-950/85 p-3 text-xs text-zinc-300 shadow-2xl backdrop-blur-xl">
                        <div className="flex items-start gap-3">
                            <div className="rounded-xl bg-indigo-500/15 p-2 text-indigo-300">
                                <Brain className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold text-white">
                                    {status.displayName ? `${status.displayName}'s Amy memory` : 'Amy memory'}
                                </p>
                                <p className="mt-0.5 text-zinc-400">
                                    {status.memoryConsent
                                        ? `${status.approvedMemoryCount} approved session note(s)`
                                        : 'Memory consent is off for this visit'}
                                </p>
                                {notice && <p className="mt-2 text-emerald-300">{notice}</p>}
                                {error && <p className="mt-2 text-rose-300">{error}</p>}
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {status.memoryConsent && status.approvedMemoryCount > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => void forgetMemory()}
                                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-zinc-300 transition hover:border-rose-400/40 hover:text-rose-200"
                                        >
                                            <RotateCcw className="h-3 w-3" />
                                            Forget notes
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => void logout()}
                                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-zinc-300 transition hover:border-white/25 hover:text-white"
                                    >
                                        <LogOut className="h-3 w-3" />
                                        Exit
                                    </button>
                                </div>
                            </div>
                        </div>
                    </aside>
                )}
                {children}
            </div>
        );
    }

    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#060711] px-5 py-10 text-white">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(79,70,229,0.25),transparent_38%),radial-gradient(circle_at_80%_80%,rgba(14,165,233,0.18),transparent_42%)]" />
            <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/75 shadow-2xl backdrop-blur-2xl lg:grid-cols-[1.05fr_0.95fr]">
                <section className="flex flex-col justify-between border-b border-white/10 p-8 lg:border-b-0 lg:border-r lg:p-12">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
                            <ShieldCheck className="h-4 w-4" />
                            Amy memory test lane
                        </div>
                        <h1 className="mt-7 max-w-lg text-4xl font-semibold tracking-tight sm:text-5xl">
                            Continue a conversation without exposing your identity to Amy.
                        </h1>
                        <p className="mt-5 max-w-xl text-base leading-7 text-zinc-400">
                            Check in with the same email on a later visit. The server converts it into a salted Amy-only identity and recalls only operator-approved, redacted notes.
                        </p>
                    </div>
                    <div className="mt-10 space-y-3 text-sm text-zinc-400">
                        <p>Raw email is not stored in this Anam memory lane.</p>
                        <p>Every visit creates a new Anam session; approved notes connect the sessions.</p>
                        <p>Email ownership is not verified in this preview, so use designated test identities only.</p>
                    </div>
                </section>

                <section className="p-8 lg:p-12">
                    <div className="mb-7 flex items-center gap-3">
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-indigo-200">
                            <LockKeyhole className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold">Secure test check-in</h2>
                            <p className="text-sm text-zinc-500">Access code plus consented memory identity</p>
                        </div>
                    </div>

                    <form onSubmit={submitAccess} className="space-y-5">
                        <label className="block text-sm text-zinc-300">
                            Name
                            <input
                                required
                                autoComplete="name"
                                value={displayName}
                                onChange={event => setDisplayName(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
                                placeholder="Test visitor name"
                            />
                        </label>
                        <label className="block text-sm text-zinc-300">
                            Email identity
                            <input
                                required
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={event => setEmail(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
                                placeholder="test-user@example.com"
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
                                placeholder="Preview access code"
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
                                <strong className="font-medium text-white">Remember approved conversation notes.</strong>
                                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                                    Use the same email on a future test so Amy can receive operator-approved continuity notes.
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
                            {submitting ? 'Checking identity…' : 'Enter Amy memory test'}
                        </button>
                        <button
                            type="button"
                            onClick={() => void checkAccess()}
                            className="w-full text-sm text-zinc-500 transition hover:text-zinc-300"
                        >
                            Retry access check
                        </button>
                    </form>
                </section>
            </div>
        </main>
    );
}
