'use client';

import Image from 'next/image';
import { notFound, useRouter } from 'next/navigation';
import { use } from 'react';
import { ALL_AGENTS } from '@/lib/agents';
import { AMY_CARA4_VARIANT } from '@/lib/anam/session-config';
import { resolveAnamAudioBridge } from '@/lib/anam/audio-bridge';
import AnamPlayer from '@/components/AnamPlayer';
import AgentQaChat from '@/components/qa/AgentQaChat';
import AmyMemoryAccessGate from '@/components/amy/AmyMemoryAccessGate';
import DaniContactGate from '@/components/dani/DaniContactGate';
import daniStyles from '@/components/dani/DaniEditorial.module.css';
import EvanContactGate from '@/components/evan/EvanContactGate';
import Link from 'next/link';
import { LogOut } from 'lucide-react';

interface Props {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default function DemoPage({ params, searchParams }: Props) {
    const { slug } = use(params);
    const resolvedSearchParams = use(searchParams);
    const isQaMode = resolvedSearchParams.qa === '1';
    const router = useRouter();

    const agent = ALL_AGENTS.find((a) => a.slug === slug);
    if (!agent) return notFound();
    const isEvan = agent.slug === 'evan';
    const isDani = agent.slug === 'dani';

    const rawVariant = Array.isArray(resolvedSearchParams.variant)
        ? resolvedSearchParams.variant[0]
        : resolvedSearchParams.variant;
    const isAmyCara4Canary = agent.slug === 'amy' && rawVariant === 'cara4';
    const sessionVariant = isAmyCara4Canary ? AMY_CARA4_VARIANT : undefined;

    const rawAudioBridge = Array.isArray(resolvedSearchParams.audioBridge)
        ? resolvedSearchParams.audioBridge[0]
        : resolvedSearchParams.audioBridge;
    const audioBridge = resolveAnamAudioBridge({
        agentSlug: agent.slug,
        isAmyCara4Canary,
        isQaMode,
        requestedAudioBridge: rawAudioBridge,
    });

    const rawReturnUrl = Array.isArray(resolvedSearchParams.returnUrl)
        ? resolvedSearchParams.returnUrl[0]
        : resolvedSearchParams.returnUrl;

    const getReturnHref = () => {
        if (!rawReturnUrl) return `/agents/${agent.slug}`;

        try {
            const url = new URL(rawReturnUrl);
            const allowedHosts = new Set([
                'x-agent-mullins-moving.vercel.app',
                'insight-amy-a.vercel.app',
                'localhost',
                '127.0.0.1',
            ]);

            if ((url.protocol === 'https:' || url.protocol === 'http:') && allowedHosts.has(url.hostname)) {
                return url.toString();
            }
        } catch {
            return `/agents/${agent.slug}`;
        }

        return `/agents/${agent.slug}`;
    };

    const returnHref = getReturnHref();
    const isPrivateReturn = returnHref !== `/agents/${agent.slug}`;
    const displayReturnHref = isDani && !isPrivateReturn
        ? '/agents/dani?session=complete'
        : returnHref;

    const handleClose = () => {
        if (isPrivateReturn) {
            window.location.assign(returnHref);
            return;
        }

        router.push(displayReturnHref);
    };

    const experience = (
        <main
            className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden ${isEvan ? 'bg-[#100718]' : isDani ? `${daniStyles.root} ${daniStyles.sessionTexture} bg-[#08100d]` : 'bg-black'}`}
            data-anam-variant={sessionVariant ?? 'public'}
            data-anam-audio-bridge={audioBridge ?? 'default'}
            data-dani-surface={isDani ? 'live-session' : undefined}
        >
            {isEvan && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#160925]/88 px-4 py-3 shadow-[0_8px_35px_rgba(0,0,0,.25)] backdrop-blur-md sm:px-6">
                    <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white p-1">
                            <Image
                                src="/agents/thumbnails/Evan Mullins Moving logo.png"
                                alt="Mullins Moving"
                                width={44}
                                height={44}
                                className="h-full w-full object-contain"
                            />
                        </span>
                        <div>
                            <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">Mullins Moving</p>
                            <p className="text-sm font-bold text-white">Live with Evan</p>
                        </div>
                    </div>
                    <span className="hidden items-center gap-2 rounded-full border border-[#ffc857]/20 bg-[#ffc857]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ffdc8a] sm:inline-flex">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffc857]" />
                        Concierge session
                    </span>
                </div>
            )}

            {isDani && !isQaMode && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-7 sm:pt-[max(1.5rem,env(safe-area-inset-top))] lg:px-10">
                    <div className={`${daniStyles.mono} flex items-center text-[9px] font-bold uppercase tracking-[0.16em] sm:text-[10px]`}>
                        <span aria-hidden="true" className="mr-2.5 h-2 w-2 rounded-full bg-[#d55538]" />
                        AI Fusion Labs / Dani
                    </div>
                    <div className={`${daniStyles.mono} flex items-center gap-2.5 text-[8px] font-semibold uppercase tracking-[0.13em] text-white/75 sm:text-[9px]`}>
                        <span aria-hidden="true" className={`${daniStyles.statusPulse} h-2 w-2 rounded-full bg-[#77ffb2]`} />
                        Working session
                    </div>
                </div>
            )}

            {/* Session-scoped exit control; global marketing navigation stays outside the room. */}
            <div className={`pointer-events-none absolute inset-x-0 z-20 flex items-center justify-center px-4 ${isDani ? 'bottom-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))]' : 'bottom-10'}`}>
                <Link
                    href={displayReturnHref}
                    aria-label={isDani ? 'End session with Dani' : 'Exit session'}
                    className={`pointer-events-auto flex min-h-12 items-center gap-2 px-6 py-3 text-sm font-bold backdrop-blur-md transition-[transform,background-color,border-color] focus-visible:outline-2 focus-visible:outline-offset-4 ${isEvan ? 'rounded-xl border border-[#ffc857]/35 bg-[#5d24d6]/80 uppercase tracking-widest text-white shadow-[0_12px_35px_rgba(0,0,0,.3)] hover:scale-105 hover:bg-[#6f34e8] focus-visible:outline-[#ffc857]' : isDani ? 'rounded-[3px] border border-white/20 bg-[#0b0e0d]/88 text-white shadow-[0_14px_40px_rgba(0,0,0,.34)] hover:-translate-y-0.5 hover:border-white/35 hover:bg-[#151a18] focus-visible:outline-[#d55538] motion-reduce:transform-none' : 'rounded-full border border-white/20 bg-black/60 uppercase tracking-widest text-white hover:scale-105 hover:bg-black/80 focus-visible:outline-white'}`}
                >
                    <LogOut size={18} />
                    {isDani ? 'End session' : 'Exit'}
                </Link>
            </div>

            {isDani && !isQaMode && (
                <div className="pointer-events-none absolute bottom-[calc(5rem+env(safe-area-inset-bottom))] left-5 z-20 hidden max-w-md text-white sm:block sm:left-8 lg:bottom-[max(2.25rem,env(safe-area-inset-bottom))] lg:left-10">
                    <p className={`${daniStyles.mono} text-[9px] font-semibold uppercase tracking-[0.17em] text-[#dbffef]`}>AI Solutions Director</p>
                    <p className={`${daniStyles.display} mt-2 text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-[.94] tracking-[-.04em]`}>Clarity, in conversation.</p>
                    <p className="mt-2 max-w-sm text-xs leading-5 text-white/72">One focused question at a time.</p>
                </div>
            )}

            {/* The Anam Player takes over the screen */}
            <div className={`relative h-full w-full ${isEvan ? 'px-4 pb-24 pt-20 sm:px-7 sm:pb-20 sm:pt-20' : ''} ${isQaMode ? 'z-30' : ''}`}>
                {agent.personaId ? (
                    isQaMode ? (
                        <AgentQaChat
                            personaId={agent.personaId}
                            agentName={isAmyCara4Canary ? `${agent.name} · Cara 4 canary` : agent.name}
                            sessionVariant={sessionVariant}
                        />
                    ) : (
                        <AnamPlayer
                            personaId={agent.personaId}
                            sessionVariant={sessionVariant}
                            audioBridge={audioBridge}
                            onClose={handleClose}
                        />
                    )
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-red-400 font-bold">Neural Link Config Missing for {agent.name}</p>
                    </div>
                )}
            </div>

            {/* Cinematic overlay effects */}
            <div className={`pointer-events-none absolute inset-0 z-10 ${isEvan ? 'bg-[radial-gradient(circle_at_center,transparent_42%,rgba(16,7,24,.74)_100%)] ring-1 ring-inset ring-[#ffc857]/15' : isDani ? 'bg-[linear-gradient(90deg,rgba(5,8,7,.56),transparent_44%,rgba(5,8,7,.16)),linear-gradient(0deg,rgba(5,8,7,.68),transparent_42%)] ring-1 ring-inset ring-white/10' : 'bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.8)_100%)]'}`} />
        </main>
    );

    if (isAmyCara4Canary) return <AmyMemoryAccessGate>{experience}</AmyMemoryAccessGate>;
    if (agent.slug === 'dani') return <DaniContactGate>{experience}</DaniContactGate>;
    if (agent.slug === 'evan') return <EvanContactGate>{experience}</EvanContactGate>;
    return experience;
}
