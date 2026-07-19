'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { ArrowRight, LockKeyhole, Mail, Truck } from 'lucide-react';

export default function EvanContactGate({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false);
    const [checking, setChecking] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void fetch('/api/anam/evan/access', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
            .catch(() => undefined).finally(() => setChecking(false));
    }, []);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch('/api/anam/evan/access', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ displayName, email }),
            });
            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (!response.ok || payload.authenticated !== true) {
                throw new Error(typeof payload.error === 'string' ? payload.error : 'Check-in was not accepted');
            }
            setEmail('');
            setReady(true);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Check-in was not accepted');
        } finally {
            setSubmitting(false);
        }
    };

    if (checking) return (
        <main className="flex min-h-screen items-center justify-center bg-[#08110c] text-white">
            <div className="flex items-center gap-3 rounded-full border border-emerald-200/15 bg-white/5 px-5 py-3 text-sm">
                <Truck className="h-4 w-4 animate-pulse text-emerald-300" /> Getting Evan ready?
            </div>
        </main>
    );
    if (ready) return <>{children}</>;

    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07100b] px-5 py-10 text-white">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,0.18),transparent_45%)]" />
            <section className="relative w-full max-w-lg rounded-[1.75rem] border border-white/10 bg-[#0c1710]/95 p-8 shadow-2xl sm:p-10">
                <div className="grid h-12 w-12 place-items-center rounded-full border border-emerald-300/25 bg-emerald-300/10 text-emerald-200"><Mail className="h-6 w-6" /></div>
                <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/70">Mullins Moving check-in</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Meet Evan.</h1>
                <p className="mt-4 text-base leading-7 text-zinc-300">
                    Enter your name and email before the conversation. Evan never sees or repeats the address.
                    If you ask for a follow-up during the call, the Mullins team can send your recap after the session ends.
                </p>
                <form className="mt-8 space-y-5" onSubmit={submit}>
                    <label className="block"><span className="text-sm font-medium text-zinc-200">Name</span>
                        <input required autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)}
                            className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none focus:border-emerald-300/60" placeholder="Your name" />
                    </label>
                    <label className="block"><span className="text-sm font-medium text-zinc-200">Email</span>
                        <input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}
                            className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none focus:border-emerald-300/60" placeholder="you@example.com" />
                    </label>
                    {error && <p role="alert" className="rounded-xl border border-red-300/20 bg-red-300/10 px-4 py-3 text-sm text-red-200">{error}</p>}
                    <button type="submit" disabled={submitting}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 font-semibold text-[#07100b] hover:bg-emerald-200 disabled:opacity-60">
                        {submitting ? 'Securing check-in?' : 'Continue to Evan'} {!submitting && <ArrowRight className="h-4 w-4" />}
                    </button>
                </form>
                <p className="mt-6 flex gap-2 text-xs leading-5 text-zinc-500"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                    Your address is encrypted, session-bound, and used only if you explicitly request the three-message follow-up during this conversation.
                </p>
            </section>
        </main>
    );
}
