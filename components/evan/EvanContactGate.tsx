'use client';

import Image from 'next/image';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { ArrowRight, LockKeyhole, Mail, ShieldCheck, Truck, UserRound } from 'lucide-react';
import { isEvanLocalTestMode } from '@/lib/anam/evan-local-test-mode';

type SubmitMode = 'email' | 'guest' | null;

export default function EvanContactGate({ children }: { children: ReactNode }) {
    const localTestMode = isEvanLocalTestMode();
    const [ready, setReady] = useState(localTestMode);
    const [checking, setChecking] = useState(!localTestMode);
    const [submitting, setSubmitting] = useState<SubmitMode>(null);
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
    const [followUpConsent, setFollowUpConsent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (localTestMode) return;
        void fetch('/api/anam/evan/access', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
            .catch(() => undefined)
            .finally(() => setChecking(false));
    }, [localTestMode]);

    const requestAccess = async (mode: Exclude<SubmitMode, null>) => {
        setSubmitting(mode);
        setError(null);
        try {
            const response = await fetch('/api/anam/evan/access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify(mode === 'guest'
                    ? { guest: true }
                    : { displayName, email, followUpConsent }),
            });
            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (!response.ok || payload.authenticated !== true) {
                throw new Error(typeof payload.error === 'string' ? payload.error : 'Evan could not be started');
            }
            setEmail('');
            setReady(true);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Evan could not be started');
        } finally {
            setSubmitting(null);
        }
    };

    const submitEmail = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        await requestAccess('email');
    };

    if (checking) return (
        <main className="flex min-h-[100svh] items-center justify-center bg-[#100718] text-white">
            <div className="flex items-center gap-3 rounded-full border border-[#ffc857]/20 bg-[#5d24d6]/20 px-5 py-3 text-sm text-[#f3eafb]">
                <Truck className="h-4 w-4 animate-pulse text-[#ffc857]" /> Preparing your Mullins Moving concierge
            </div>
        </main>
    );
    if (ready) return <>{children}</>;

    return (
        <main className="relative flex min-h-[100svh] items-center justify-center overflow-x-hidden bg-[#100718] px-4 py-5 text-white sm:px-6 lg:h-[100svh] lg:overflow-hidden">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-40 top-0 h-[32rem] w-[32rem] rounded-full bg-[#5d24d6]/30 blur-[120px]" />
                <div className="absolute -right-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-[#ffc857]/12 blur-[110px]" />
                <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.28)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.28)_1px,transparent_1px)] [background-size:56px_56px]" />
            </div>

            <section className="relative grid w-full max-w-6xl overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#170a22]/96 shadow-[0_32px_120px_rgba(0,0,0,.55)] lg:h-[min(84svh,760px)] lg:grid-cols-[.9fr_1.1fr]">
                <div className="relative hidden overflow-hidden border-r border-white/10 lg:block">
                    <Image
                        src="/agents/thumbnails/Evan Mullins Moving.png"
                        alt="Evan, Mullins Moving virtual concierge"
                        fill
                        priority
                        sizes="42vw"
                        className="object-contain object-bottom"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-[#2a1050]/30 via-transparent to-[#12071d]" />
                    <div className="absolute inset-x-0 top-0 p-8 xl:p-10">
                        <div className="flex items-center gap-3">
                            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white p-1.5">
                                <Image
                                    src="/agents/thumbnails/Evan Mullins Moving logo.png"
                                    alt="Mullins Moving"
                                    width={52}
                                    height={52}
                                    className="h-full w-full object-contain"
                                />
                            </span>
                            <div>
                                <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">Mullins Moving</p>
                                <p className="text-xs font-semibold text-white/55">Top Tier Moving. Driven with Heart.</p>
                            </div>
                        </div>
                        <h1 className="mt-7 max-w-md font-[Georgia] text-4xl font-bold leading-[1.04] xl:text-[2.8rem]">
                            A calmer way to start planning your move.
                        </h1>
                        <p className="mt-4 max-w-md text-sm leading-6 text-[#ded2e9]">
                            Ask questions, organize locations and move details, and review your working Move Planner with Evan.
                        </p>
                    </div>
                    <div className="absolute inset-x-8 bottom-7 grid gap-2 text-xs text-white/65 xl:inset-x-10">
                        <p className="flex items-center gap-2"><ShieldCheck size={15} className="text-[#ffc857]" /> Private, session-bound conversation</p>
                        <p className="flex items-center gap-2"><Truck size={15} className="text-[#ffc857]" /> Live Move Planner included either way</p>
                    </div>
                </div>

                <div className="flex min-h-0 flex-col justify-center p-6 sm:p-8 lg:p-9 xl:p-11">
                    <div className="flex items-center gap-3 lg:hidden">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white p-1.5">
                            <Image
                                src="/agents/thumbnails/Evan Mullins Moving logo.png"
                                alt="Mullins Moving"
                                width={48}
                                height={48}
                                className="h-full w-full object-contain"
                            />
                        </span>
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#ffc857]">Mullins Moving</p>
                    </div>

                    <p className="mt-5 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#ffc857] lg:mt-0">Before you meet Evan</p>
                    <h2 className="mt-2 font-[Georgia] text-3xl font-bold tracking-tight sm:text-4xl">Choose how you want to begin.</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d7cbe2]">
                        Want a written conversation recap? Add your name and email below. Prefer not to share contact information? Continue as a guest and use Evan and the Live Move Planner normally.
                    </p>

                    <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submitEmail}>
                        <label className="block">
                            <span className="flex items-center gap-2 text-sm font-bold text-white/85"><UserRound size={15} /> Name</span>
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
                            <span className="flex items-center gap-2 text-sm font-bold text-white/85"><Mail size={15} /> Email</span>
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
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-3.5 text-xs leading-5 text-[#d7cbe2] transition hover:border-[#8f61e5]/50 sm:col-span-2">
                            <input
                                required
                                type="checkbox"
                                checked={followUpConsent}
                                onChange={event => setFollowUpConsent(event.target.checked)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-[#ffc857]"
                            />
                            <span>
                                Email me one conversation recap after the session and share the session brief with Mullins Admin and Sales.
                            </span>
                        </label>
                        {error && <p role="alert" className="rounded-xl border border-red-300/20 bg-red-300/10 px-4 py-3 text-sm text-red-200 sm:col-span-2">{error}</p>}
                        <button
                            type="submit"
                            disabled={submitting !== null}
                            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ffc857] px-5 font-extrabold text-[#2b1043] shadow-[0_12px_30px_rgba(255,200,87,.14)] transition hover:-translate-y-0.5 hover:bg-[#ffd77d] disabled:translate-y-0 disabled:opacity-60 sm:col-span-2"
                        >
                            {submitting === 'email' ? 'Securing your recap...' : 'Email my recap and continue'}
                            {submitting !== 'email' && <ArrowRight className="h-4 w-4" />}
                        </button>
                    </form>

                    <div className="my-4 flex items-center gap-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/30">
                        <span className="h-px flex-1 bg-white/10" />
                        Or
                        <span className="h-px flex-1 bg-white/10" />
                    </div>

                    <button
                        type="button"
                        disabled={submitting !== null}
                        onClick={() => void requestAccess('guest')}
                        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#8f61e5]/55 bg-[#5d24d6]/18 px-5 font-bold text-white transition hover:-translate-y-0.5 hover:border-[#b091ed] hover:bg-[#5d24d6]/30 disabled:translate-y-0 disabled:opacity-60"
                    >
                        {submitting === 'guest' ? 'Opening Evan...' : 'Continue without email'}
                        {submitting !== 'guest' && <ArrowRight className="h-4 w-4" />}
                    </button>

                    <p className="mt-4 flex gap-2 text-[11px] leading-5 text-white/38">
                        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#ffc857]/75" />
                        Email is optional. Guest conversations still include Evan and the Live Move Planner, but no customer recap or email follow-up will be sent.
                    </p>
                </div>
            </section>
        </main>
    );
}
