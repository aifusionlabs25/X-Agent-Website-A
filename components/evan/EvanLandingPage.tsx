import Image from 'next/image';
import Link from 'next/link';
import {
    ArrowRight,
    CheckCircle2,
    Play,
    ShieldCheck,
    Truck,
} from 'lucide-react';
import type { AgentData } from '@/lib/agents';

export default function EvanLandingPage({ agent }: { agent: AgentData }) {
    return (
        <main className="relative min-h-[100svh] overflow-x-hidden bg-[#12071c] text-white lg:h-[100svh] lg:overflow-hidden">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-40 -top-36 h-[34rem] w-[34rem] rounded-full bg-[#5d24d6]/24 blur-[120px]" />
                <div className="absolute -right-24 bottom-0 h-[26rem] w-[26rem] rounded-full bg-[#ffc857]/12 blur-[110px]" />
                <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.28)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.28)_1px,transparent_1px)] [background-size:58px_58px]" />
            </div>

            <section className="relative mx-auto flex min-h-[100svh] w-full max-w-[1480px] flex-col px-5 py-4 sm:px-8 lg:h-full lg:min-h-0 lg:px-10 lg:py-5 xl:px-14">
                <header className="flex shrink-0 items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center gap-3.5">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white p-1.5 shadow-[0_0_35px_rgba(255,200,87,.18)]">
                            <Image
                                src={agent.logoSrc ?? '/agents/thumbnails/Evan Mullins Moving logo.png'}
                                alt="Mullins Moving"
                                width={58}
                                height={58}
                                className="h-full w-full object-contain"
                            />
                        </span>
                        <div>
                            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">Mullins Moving</p>
                            <p className="mt-0.5 text-xs font-semibold text-white/58">Top Tier Moving. Driven with Heart.</p>
                        </div>
                    </div>
                    <div className="hidden items-center gap-2 text-xs font-semibold text-white/58 sm:flex">
                        <ShieldCheck size={15} className="text-[#ffc857]" />
                        Your planning conversation stays private
                    </div>
                </header>

                <div className="grid flex-1 items-center gap-7 py-6 lg:min-h-0 lg:grid-cols-[.82fr_1.18fr] lg:gap-8 lg:py-4 xl:gap-12">
                    <div className="relative z-10">
                        <p className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">
                            <Truck size={15} />
                            Your Mullins Moving concierge
                        </p>
                        <h1 className="mt-4 max-w-[680px] font-[Georgia] text-[clamp(2.65rem,4.35vw,4.65rem)] font-bold leading-[.96] tracking-[-0.045em]">
                            Planning a move?
                            <span className="mt-1 block text-[#ffc857]">Start with Evan.</span>
                        </h1>
                        <p className="mt-5 max-w-[610px] text-base leading-7 text-[#ded2e9] lg:text-[1.05rem]">
                            Tell Evan what you are moving, where it is going, and what matters most. He can answer common questions and organize the details for a smoother conversation with the Mullins team.
                        </p>

                        <div className="mt-6 grid max-w-[620px] gap-2.5 sm:grid-cols-2">
                            {[
                                'Ask about packing and moving services',
                                'Map multiple pickup and delivery stops',
                                'Flag stairs, access, and specialty items',
                                'Prepare details for an estimate review',
                            ].map((item) => (
                                <p key={item} className="flex items-start gap-2 text-sm leading-5 text-white/72">
                                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#ffc857]" />
                                    {item}
                                </p>
                            ))}
                        </div>

                        <div className="mt-7 flex flex-wrap items-center gap-4">
                            <Link
                                href={agent.liveUrl}
                                className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#ffc857] px-6 text-sm font-extrabold text-[#271041] shadow-[0_14px_40px_rgba(255,200,87,.18)] transition hover:-translate-y-0.5 hover:bg-[#ffda7f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffc857]"
                            >
                                <Play size={17} fill="currentColor" />
                                Start planning with Evan
                                <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
                            </Link>
                            <p className="max-w-[250px] text-xs leading-5 text-white/45">
                                No quote or booking is created. Mullins staff confirms pricing, availability, and scheduling.
                            </p>
                        </div>
                    </div>

                    <div className="relative mx-auto w-full max-w-[760px] lg:h-[min(58vh,520px)] lg:min-h-[360px]">
                        <div className="absolute -inset-5 rounded-[2.2rem] bg-gradient-to-br from-[#6f34e8]/30 via-transparent to-[#ffc857]/18 blur-2xl" />
                        <div className="relative h-full overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#20102d] p-2 shadow-[0_28px_90px_rgba(0,0,0,.48)]">
                            <div className="relative aspect-[16/11] h-full min-h-0 overflow-hidden rounded-[1.35rem] bg-[#281338] lg:aspect-auto">
                                <Image
                                    src={agent.thumbnailSrc}
                                    alt="Evan, Mullins Moving virtual concierge"
                                    fill
                                    priority
                                    sizes="(max-width: 1024px) 100vw, 55vw"
                                    className="object-contain"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-[#13071e] via-transparent to-transparent" />
                                <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-4 rounded-xl border border-white/12 bg-[#13071e]/86 px-4 py-3 backdrop-blur-md sm:inset-x-5 sm:bottom-5 sm:px-5 sm:py-4">
                                    <div>
                                        <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#ffc857]">Live moving support</p>
                                        <p className="mt-1 font-[Georgia] text-xl font-bold text-white sm:text-2xl">Evan is ready when you are</p>
                                    </div>
                                    <Link
                                        href={agent.liveUrl}
                                        aria-label="Start planning your move with Evan"
                                        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#ffc857] text-[#271041] transition hover:scale-105 hover:bg-[#ffdc85]"
                                    >
                                        <Play size={18} fill="currentColor" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            </section>
        </main>
    );
}
