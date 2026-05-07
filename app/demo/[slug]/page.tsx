'use client';

import { notFound, useRouter } from 'next/navigation';
import { use } from 'react';
import { ALL_AGENTS } from '@/lib/agents';
import AnamPlayer from '@/components/AnamPlayer';
import AgentQaChat from '@/components/qa/AgentQaChat';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

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

    const rawReturnUrl = Array.isArray(resolvedSearchParams.returnUrl)
        ? resolvedSearchParams.returnUrl[0]
        : resolvedSearchParams.returnUrl;

    const getReturnHref = () => {
        if (!rawReturnUrl) return `/agents/${agent.slug}`;

        try {
            const url = new URL(rawReturnUrl);
            const allowedHosts = new Set([
                'x-agent-mullins-moving.vercel.app',
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

    return (
        <main className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center overflow-hidden">
            {/* Minimal bottom nav to return - Centered and High Visibility */}
            <div className="absolute bottom-10 left-0 w-full z-20 flex justify-center items-center pointer-events-none">
                <Link
                    href={returnHref}
                    className="pointer-events-auto flex items-center gap-2 bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white px-6 py-3 rounded-full transition-all text-sm font-bold uppercase tracking-widest hover:scale-105"
                >
                    <ArrowLeft size={18} />
                    {isPrivateReturn ? 'Back to Evan Screening' : `Back to ${agent.name}`}
                </Link>
            </div>

            {/* The Anam Player takes over the screen */}
            <div className={`w-full h-full relative ${isQaMode ? 'z-30' : ''}`}>
                {agent.personaId ? (
                    isQaMode ? (
                        <AgentQaChat personaId={agent.personaId} agentName={agent.name} />
                    ) : (
                        <AnamPlayer personaId={agent.personaId} onClose={handleClose} />
                    )
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-red-400 font-bold">Neural Link Config Missing for {agent.name}</p>
                    </div>
                )}
            </div>

            {/* Cinematic overlay effects */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.8)_100%)] z-10" />
        </main>
    );
}
