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

    const handleClose = () => {
        if (isPrivateReturn) {
            window.location.assign(returnHref);
            return;
        }

        router.push(returnHref);
    };

    const experience = (
        <main
            className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden ${isEvan ? 'bg-[#100718]' : 'bg-black'}`}
            data-anam-variant={sessionVariant ?? 'public'}
            data-anam-audio-bridge={audioBridge ?? 'default'}
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

            {/* Minimal bottom nav to return - Centered and High Visibility */}
            <div className="absolute bottom-10 left-0 w-full z-20 flex justify-center items-center pointer-events-none">
                <Link
                    href={returnHref}
                    className={`pointer-events-auto flex items-center gap-2 px-6 py-3 text-sm font-bold uppercase tracking-widest backdrop-blur-md transition-all hover:scale-105 ${isEvan ? 'rounded-xl border border-[#ffc857]/35 bg-[#5d24d6]/80 text-white shadow-[0_12px_35px_rgba(0,0,0,.3)] hover:bg-[#6f34e8]' : 'rounded-full border border-white/20 bg-black/60 text-white hover:bg-black/80'}`}
                >
                    <LogOut size={18} />
                    Exit
                </Link>
            </div>

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
            <div className={`pointer-events-none absolute inset-0 z-10 ${isEvan ? 'bg-[radial-gradient(circle_at_center,transparent_42%,rgba(16,7,24,.74)_100%)] ring-1 ring-inset ring-[#ffc857]/15' : 'bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.8)_100%)]'}`} />
        </main>
    );

    if (isAmyCara4Canary) return <AmyMemoryAccessGate>{experience}</AmyMemoryAccessGate>;
    if (agent.slug === 'evan') return <EvanContactGate>{experience}</EvanContactGate>;
    return experience;
}
