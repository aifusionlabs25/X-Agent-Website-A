import Image from 'next/image';
import Link from 'next/link';
import {
    ArrowRight,
    CalendarDays,
    ClipboardCheck,
    Clock3,
    MailCheck,
    MessageCircleQuestion,
    Play,
    ShieldCheck,
    Sparkles,
    Truck,
} from 'lucide-react';
import type { AgentData } from '@/lib/agents';

const CAPABILITIES = [
    {
        icon: ClipboardCheck,
        title: 'Quote-ready intake',
        body: 'Captures origin, destination, timing, access, services, specialty items, and the details Mullins needs for follow-up.',
    },
    {
        icon: ShieldCheck,
        title: 'Approved answers only',
        body: 'Uses Mullins-approved information, avoids unsupported promises, and hands uncertain decisions to the team.',
    },
    {
        icon: MailCheck,
        title: 'Three-part email handoff',
        body: 'Prepares a customer recap plus concise Admin and Sales briefs after the final session transcript is available.',
    },
];

const TEST_PROMPTS = [
    'Can you move me from Phoenix to Flagstaff?',
    'Can you help pack fragile items?',
    'How soon can I get a quote?',
    'What information do you need from me?',
];

export default function EvanLandingPage({ agent }: { agent: AgentData }) {
    return (
        <main className="relative min-h-screen overflow-hidden bg-[#100718] pt-20 text-white">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-48 top-16 h-[34rem] w-[34rem] rounded-full bg-[#5d24d6]/20 blur-[120px]" />
                <div className="absolute -right-40 top-1/3 h-[30rem] w-[30rem] rounded-full bg-[#ffc857]/10 blur-[120px]" />
                <div className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(255,255,255,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.32)_1px,transparent_1px)] [background-size:64px_64px]" />
            </div>

            <section className="relative mx-auto max-w-7xl px-5 pb-16 pt-6 sm:px-8 lg:px-10">
                <div className="flex flex-col gap-3 border-b border-white/10 pb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/65 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white p-1.5 shadow-[0_0_30px_rgba(255,200,87,.2)]">
                            <Image
                                src={agent.logoSrc ?? '/agents/thumbnails/Evan Mullins Moving logo.png'}
                                alt="Mullins Moving"
                                width={48}
                                height={48}
                                className="h-full w-full object-contain"
                            />
                        </span>
                        <span>Mullins Moving × AI Fusion Labs</span>
                    </div>
                    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#ffc857]/20 bg-[#ffc857]/10 px-3 py-2 text-[#ffdc8a]">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffc857]" />
                        Private pilot preview
                    </span>
                </div>

                <div className="grid items-center gap-12 py-12 lg:grid-cols-[1.02fr_.98fr] lg:gap-16 lg:py-16">
                    <div>
                        <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.22em] text-[#ffc857]">
                            <Sparkles size={15} />
                            Prepared for Mullins Moving
                        </p>
                        <h1 className="mt-5 max-w-3xl font-[Georgia] text-[clamp(2.65rem,6vw,5.4rem)] font-bold leading-[.93] tracking-[-0.055em] text-white">
                            Meet Evan, your moving concierge built for{' '}
                            <span className="text-[#ffc857]">calm, qualified intake.</span>
                        </h1>
                        <p className="mt-6 max-w-2xl text-base leading-7 text-[#ded3eb] sm:text-lg sm:leading-8">
                            Evan helps Mullins capture more complete quote requests, answer common service questions,
                            and prepare a cleaner human handoff—24 hours a day, without sounding like a generic bot.
                        </p>

                        <div className="mt-7 max-w-2xl border-l-2 border-[#ffc857] bg-white/[0.045] px-5 py-4">
                            <p className="text-sm font-bold text-white">Built around the real moving journey</p>
                            <p className="mt-1 text-sm leading-6 text-white/60">
                                Service-area questions, packing needs, special handling, access constraints,
                                estimate intake, and next-step coordination.
                            </p>
                        </div>

                        <div className="mt-8 flex flex-wrap gap-3">
                            <Link
                                href={agent.liveUrl}
                                className="group inline-flex items-center gap-2 rounded-lg bg-[#ffc857] px-6 py-3.5 text-sm font-extrabold text-[#271041] shadow-[0_12px_35px_rgba(255,200,87,.2)] transition hover:-translate-y-0.5 hover:bg-[#ffd77d]"
                            >
                                <Play size={17} fill="currentColor" />
                                Start the Evan demo
                            </Link>
                            <a
                                href="https://calendly.com/aifusionlabs"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 rounded-lg border border-[#8153df]/70 bg-[#5d24d6]/30 px-6 py-3.5 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:border-[#a783ee] hover:bg-[#5d24d6]/50"
                            >
                                <CalendarDays size={17} />
                                Schedule pilot discussion
                            </a>
                        </div>
                        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-white/45">
                            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[#ffc857]" />
                            Private screening experience. Evan gathers planning details but does not issue quotes,
                            confirm bookings, or promise crew availability.
                        </p>
                    </div>

                    <div className="relative">
                        <div className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-[#6f34e8]/25 via-transparent to-[#ffc857]/20 blur-2xl" />
                        <div className="relative overflow-hidden rounded-[1.6rem] border border-white/15 bg-[#1a0b28] p-2 shadow-[0_28px_90px_rgba(0,0,0,.5)]">
                            <div className="relative aspect-[16/11] overflow-hidden rounded-[1.2rem] bg-[#251135]">
                                <Image
                                    src={agent.thumbnailSrc}
                                    alt="Evan, Mullins Moving virtual concierge"
                                    fill
                                    priority
                                    sizes="(max-width: 1024px) 100vw, 48vw"
                                    className="object-cover object-top"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-[#12061d] via-transparent to-transparent" />
                                <Link
                                    href={agent.liveUrl}
                                    aria-label="Start Evan live demo"
                                    className="absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/55 bg-[#5d24d6]/85 text-white shadow-[0_16px_45px_rgba(0,0,0,.4)] backdrop-blur-md transition hover:scale-105 hover:bg-[#6f34e8]"
                                >
                                    <Play size={27} fill="currentColor" className="ml-1" />
                                </Link>
                                <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-4">
                                    <div>
                                        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">Live concierge</p>
                                        <p className="mt-1 font-[Georgia] text-2xl font-bold text-white">Evan is ready</p>
                                    </div>
                                    <span className="rounded-full border border-white/15 bg-black/45 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/75 backdrop-blur-md">
                                        Voice + video
                                    </span>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 px-2 py-3 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-white/65 sm:text-xs">
                                <span className="rounded-md bg-white/5 px-2 py-2">Mullins trained</span>
                                <span className="rounded-md bg-white/5 px-2 py-2">Live planner</span>
                                <span className="rounded-md bg-white/5 px-2 py-2">Email handoff</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.08fr_.92fr]">
                    <section className="rounded-[1.4rem] border border-white/12 bg-white/[0.035] p-6 sm:p-8">
                        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">Concierge capabilities</p>
                        <h2 className="mt-2 font-[Georgia] text-3xl font-bold tracking-tight sm:text-4xl">What Evan is designed to handle</h2>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">
                            A focused front door for customers who need useful answers and a confident next step.
                        </p>
                        <div className="mt-6 space-y-3">
                            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
                                <div key={title} className="group flex gap-4 rounded-xl border border-white/10 bg-[#160a21]/65 p-4 transition hover:border-[#ffc857]/30 hover:bg-[#1c0d2a]">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ffc857] text-[#321052]">
                                        <Icon size={18} strokeWidth={2.4} />
                                    </span>
                                    <div>
                                        <h3 className="font-bold text-white">{title}</h3>
                                        <p className="mt-1 text-sm leading-6 text-white/55">{body}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="rounded-[1.4rem] border border-[#7d48dd]/35 bg-[#5d24d6]/10 p-6 sm:p-8">
                        <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">
                            <MessageCircleQuestion size={15} />
                            Screening guide
                        </p>
                        <h2 className="mt-2 font-[Georgia] text-3xl font-bold tracking-tight sm:text-4xl">What to test</h2>
                        <p className="mt-3 text-sm leading-6 text-white/55">
                            Ask questions a real moving prospect would ask, then note what Evan should know, avoid, or hand off.
                        </p>
                        <div className="mt-6 grid gap-3 sm:grid-cols-2">
                            {TEST_PROMPTS.map((prompt, index) => (
                                <div key={prompt} className="min-h-32 rounded-xl border border-white/10 bg-[#14091f]/75 p-4">
                                    <span className="font-[Georgia] text-2xl font-bold text-[#ffc857]">0{index + 1}</span>
                                    <p className="mt-3 text-sm font-semibold leading-5 text-white/80">{prompt}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>

                <section className="relative mt-7 overflow-hidden rounded-[1.5rem] border border-[#ffc857]/25 bg-[#2a1050] p-7 sm:p-9">
                    <div className="absolute right-0 top-0 h-full w-2/5 bg-[radial-gradient(circle_at_center,rgba(255,200,87,.18),transparent_68%)]" />
                    <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">
                                <Clock3 size={14} />
                                Ready for a real pilot
                            </p>
                            <h2 className="mt-2 font-[Georgia] text-3xl font-bold sm:text-4xl">Refine Evan with the Mullins team.</h2>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#d9caeb]">
                                Run the conversation, review the live Move Planner, and identify the final knowledge or workflow changes needed for launch.
                            </p>
                        </div>
                        <Link
                            href={agent.liveUrl}
                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#ffc857] px-6 py-3.5 text-sm font-extrabold text-[#271041] transition hover:-translate-y-0.5 hover:bg-[#ffda84]"
                        >
                            Review Evan
                            <ArrowRight size={17} />
                        </Link>
                    </div>
                </section>

                <div className="mt-9 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/35">
                    <p className="flex items-center gap-2"><Truck size={14} className="text-[#ffc857]" /> Mullins Moving virtual concierge pilot</p>
                    <p>Designed and powered by AI Fusion Labs</p>
                </div>
            </section>
        </main>
    );
}
