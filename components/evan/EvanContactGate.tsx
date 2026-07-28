'use client';

import Image from 'next/image';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { ArrowRight, LockKeyhole, Mail, ShieldCheck, Truck } from 'lucide-react';
import { isEvanLocalTestMode } from '@/lib/anam/evan-local-test-mode';

export default function EvanContactGate({ children }: { children: ReactNode }) {
    const localTestMode = isEvanLocalTestMode();
    const [ready, setReady] = useState(localTestMode);
    const [checking, setChecking] = useState(!localTestMode);
    const [submitting, setSubmitting] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [followUpConsent, setFollowUpConsent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (localTestMode) return;
        void fetch('/api/anam/evan/access', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
            .catch(() => undefined).finally(() => setChecking(false));
    }, [localTestMode]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch('/api/anam/evan/access', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin', cache: 'no-store',
                body: JSON.stringify({ displayName, email, followUpConsent }),
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
        <main className="flex min-h-screen items-center justify-center bg-[#100718] text-white">
            <div className="flex items-center gap-3 rounded-full border border-[#ffc857]/20 bg-[#5d24d6]/20 px-5 py-3 text-sm text-[#f3eafb]">
                <Truck className="h-4 w-4 animate-pulse text-[#ffc857]" /> Preparing your Mullins Moving concierge
            </div>
        </main>
    );
    if (ready) return <>{children}</>;

    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#100718] px-5 py-10 text-white">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-40 top-0 h-[32rem] w-[32rem] rounded-full bg-[#5d24d6]/30 blur-[120px]" />
                <div className="absolute -right-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-[#ffc857]/12 blur-[110px]" />
                <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.28)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.28)_1px,transparent_1px)] [background-size:56px_56px]" />
            </div>

            <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#170a22]/95 shadow-[0_32px_120px_rgba(0,0,0,.55)] lg:grid-cols-[.85fr_1.15fr]">
                <div className="relative hidden overflow-hidden border-r border-white/10 p-9 lg:flex lg:flex-col lg:justify-between">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#5d24d6]/45 via-[#2a1040]/70 to-[#14071e]" />
                    <div className="relative">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white p-2 shadow-[0_12px_35px_rgba(0,0,0,.25)]">
                            <Image
                                src="/agents/thumbnails/Evan Mullins Moving logo.png"
                                alt="Mullins Moving"
                                width={72}
                                height={72}
                                className="h-full w-full object-contain"
                            />
                        </span>
                        <p className="mt-8 text-xs font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">Mullins Moving</p>
                        <h1 className="mt-3 font-[Georgia] text-4xl font-bold leading-tight">A calmer way to plan your move.</h1>
                        <p className="mt-4 text-sm leading-6 text-[#ddcfea]">
                            Check in once, speak naturally with Evan, and receive a polished conversation recap after the session.
                        </p>
                    </div>
                    <div className="relative space-y-3 text-sm text-white/70">
                        <p className="flex items-center gap-3"><ShieldCheck size={17} className="text-[#ffc857]" /> Secure, session-bound check-in</p>
                        <p className="flex items-center gap-3"><Mail size={17} className="text-[#ffc857]" /> One customer recap after the call</p>
                        <p className="flex items-center gap-3"><Truck size={17} className="text-[#ffc857]" /> Live Move Planner during the conversation</p>
                    </div>
                </div>

                <div className="p-7 sm:p-10 lg:p-12">
                    <div className="flex items-center gap-3 lg:hidden">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white p-1.5">
                            <Image
                                src="/agents/thumbnails/Evan Mullins Moving logo.png"
                                alt="Mullins Moving"
                                width={56}
                                height={56}
                                className="h-full w-full object-contain"
                            />
                        </span>
                        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#ffc857]">Mullins Moving</p>
                    </div>
                    <p className="mt-7 text-xs font-extrabold uppercase tracking-[0.2em] text-[#ffc857] lg:mt-0">Private demo check-in</p>
                    <h2 className="mt-2 font-[Georgia] text-3xl font-bold tracking-tight sm:text-4xl">Meet Evan.</h2>
                    <p className="mt-4 text-sm leading-6 text-[#d7cbe2]">
                        Enter your name and email before the conversation. Evan never sees or repeats your email address.
                        Your recap and Mullins team briefs are prepared after the session transcript is complete.
                    </p>

                    <form className="mt-7 space-y-5" onSubmit={submit}>
                        <label className="block">
                            <span className="text-sm font-bold text-white/85">Name</span>
                            <input
                                required
                                autoComplete="name"
                                value={displayName}
                                onChange={event => setDisplayName(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-[#ffc857]/70 focus:ring-2 focus:ring-[#ffc857]/10"
                                placeholder="Your name"
                            />
                        </label>
                        <label className="block">
                            <span className="text-sm font-bold text-white/85">Email</span>
                            <input
                                required
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={event => setEmail(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-[#ffc857]/70 focus:ring-2 focus:ring-[#ffc857]/10"
                                placeholder="you@example.com"
                            />
                        </label>
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-[#d7cbe2] transition hover:border-[#8f61e5]/50">
                            <input
                                required
                                type="checkbox"
                                checked={followUpConsent}
                                onChange={event => setFollowUpConsent(event.target.checked)}
                                className="mt-1 h-4 w-4 shrink-0 accent-[#ffc857]"
                            />
                            <span>
                                Email me one conversation recap after this session and share the internal session briefs with Mullins Admin and Sales.
                            </span>
                        </label>
                        {error && <p role="alert" className="rounded-xl border border-red-300/20 bg-red-300/10 px-4 py-3 text-sm text-red-200">{error}</p>}
                        <button
                            type="submit"
                            disabled={submitting}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ffc857] px-5 py-3.5 font-extrabold text-[#2b1043] shadow-[0_12px_30px_rgba(255,200,87,.14)] transition hover:-translate-y-0.5 hover:bg-[#ffd77d] disabled:translate-y-0 disabled:opacity-60"
                        >
                            {submitting ? 'Securing check-in…' : 'Continue to Evan'} {!submitting && <ArrowRight className="h-4 w-4" />}
                        </button>
                    </form>
                    <p className="mt-6 flex gap-2 text-xs leading-5 text-white/35">
                        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#ffc857]/75" />
                        Your contact details and follow-up choice are encrypted and session-bound. The email bundle is sent only after the final transcript is available.
                    </p>
                </div>
            </section>
        </main>
    );
}
