'use client';

import Image from 'next/image';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { ArrowRight, BrainCircuit, LockKeyhole, Mail, ShieldCheck, UserRound } from 'lucide-react';

type SubmitMode = 'email' | 'guest' | null;

export default function DaniContactGate({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false);
    const [checking, setChecking] = useState(true);
    const [submitting, setSubmitting] = useState<SubmitMode>(null);
    const [displayName, setDisplayName] = useState('');
    const [email, setEmail] = useState('');
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
            if (
                response.ok
                && payload.authenticated === true
                && (payload.guest === true || payload.followUpAuthorized === true)
                && active
            ) setReady(true);
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
                    : { displayName, email, followUpConsent: true }),
            });
            const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
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
        await requestAccess('email');
    };

    if (checking) return (
        <main className="flex min-h-[100svh] items-center justify-center bg-[#070914] text-white">
            <div className="flex items-center gap-3 rounded-full border border-indigo-300/20 bg-indigo-400/10 px-5 py-3 text-sm text-indigo-100">
                <BrainCircuit className="h-4 w-4 animate-pulse text-cyan-300" /> Preparing Dani
            </div>
        </main>
    );
    if (ready) return <>{children}</>;

    return (
        <main className="relative flex min-h-[100svh] items-center justify-center overflow-x-hidden bg-[#070914] px-4 py-5 text-white sm:px-6 lg:h-[100svh] lg:overflow-hidden">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-40 top-0 h-[34rem] w-[34rem] rounded-full bg-indigo-600/25 blur-[120px]" />
                <div className="absolute -right-32 bottom-0 h-[30rem] w-[30rem] rounded-full bg-cyan-500/12 blur-[110px]" />
                <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.28)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.28)_1px,transparent_1px)] [background-size:56px_56px]" />
            </div>

            <section className="relative grid w-full max-w-6xl overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#0c1020]/96 shadow-[0_32px_120px_rgba(0,0,0,.55)] lg:h-[min(88svh,720px)] lg:max-h-[calc(100svh-32px)] lg:grid-cols-[.9fr_1.1fr]">
                <div className="relative hidden min-h-0 overflow-hidden border-r border-white/10 bg-[#0a0d18] lg:block">
                    <Image
                        src="/agents/thumbnails/dani-x-agent-director-cara4-2026.jpg"
                        alt="Dani, AI Solutions Director"
                        fill
                        priority
                        sizes="45vw"
                        className="object-cover object-center"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#080b16] via-transparent to-black/15" />
                    <div className="absolute inset-x-0 bottom-0 p-8">
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-cyan-300">AI Fusion Labs</p>
                        <h1 className="mt-2 text-3xl font-bold leading-tight">Hi, I&apos;m Dani.</h1>
                        <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">
                            I&apos;m with AI Fusion Labs.
                        </p>
                        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/65">
                            <p className="flex items-center gap-2"><ShieldCheck size={14} className="text-cyan-300" /> Transparent AI</p>
                            <p className="flex items-center gap-2"><BrainCircuit size={14} className="text-indigo-300" /> Solution discovery</p>
                        </div>
                    </div>
                </div>

                <div className="flex min-h-0 flex-col justify-center overflow-y-auto p-5 sm:p-8 lg:p-9">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-cyan-300">Before you meet Dani</p>
                    <h2 className="mt-2 text-[clamp(1.8rem,2.5vw,2.5rem)] font-bold leading-tight tracking-tight">Choose how you want to begin.</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                        Add your name and email, or continue as a guest.
                    </p>

                    <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={submitEmail}>
                        <label className="block">
                            <span className="flex items-center gap-2 text-sm font-bold text-white/85"><UserRound size={15} /> Name</span>
                            <input
                                required
                                autoComplete="name"
                                value={displayName}
                                onChange={event => setDisplayName(event.target.value)}
                                className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-2.5 text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10"
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
                                className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-2.5 text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10"
                                placeholder="you@example.com"
                            />
                        </label>
                        {error && <p role="alert" className="rounded-xl border border-red-300/20 bg-red-300/10 px-4 py-3 text-sm text-red-200 sm:col-span-2">{error}</p>}
                        <button
                            type="submit"
                            disabled={submitting !== null}
                            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 px-5 font-extrabold text-white shadow-[0_12px_30px_rgba(79,70,229,.2)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60 sm:col-span-2"
                        >
                            {submitting === 'email' ? 'Starting Dani...' : 'Start conversation'}
                            {submitting !== 'email' && <ArrowRight className="h-4 w-4" />}
                        </button>
                    </form>

                    <div className="my-3 flex items-center gap-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/30">
                        <span className="h-px flex-1 bg-white/10" /> Or <span className="h-px flex-1 bg-white/10" />
                    </div>
                    <button
                        type="button"
                        disabled={submitting !== null}
                        onClick={() => void requestAccess('guest')}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-indigo-400/45 bg-indigo-500/10 px-5 font-bold text-white transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-500/20 disabled:translate-y-0 disabled:opacity-60"
                    >
                        {submitting === 'guest' ? 'Opening Dani...' : 'Continue without email'}
                        {submitting !== 'guest' && <ArrowRight className="h-4 w-4" />}
                    </button>
                    <p className="mt-3 flex gap-2 text-[11px] leading-5 text-white/42">
                        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300/80" />
                        Your typed address stays outside Dani&apos;s spoken context. Sessions may be transcribed for post-session follow-up. Do not share secrets or sensitive records.
                    </p>
                </div>
            </section>
        </main>
    );
}
