'use client';

import { notFound, useRouter } from 'next/navigation';
import { use } from 'react';
import { ALL_AGENTS } from '@/lib/agents';
import AnamPlayer from '@/components/AnamPlayer';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface Props {
    params: Promise<{ slug: string }>;
}

export default function DemoPage({ params }: Props) {
    const { slug } = use(params);
    const router = useRouter();

    const agent = ALL_AGENTS.find((a) => a.slug === slug);
    if (!agent) return notFound();

    return (
        <main className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center overflow-hidden">
            {/* Minimal top nav just to return */}
            <div className="absolute top-0 left-0 w-full p-6 z-20 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
                <Link
                    href={`/agents/${agent.slug}`}
                    className="flex items-center gap-2 text-white/70 hover:text-white transition-colors text-sm font-semibold uppercase tracking-widest"
                >
                    <ArrowLeft size={16} />
                    Back to {agent.name}
                </Link>
                <div className="text-white/50 text-xs font-mono tracking-widest uppercase">
                    AI Fusion Labs • SECURE LINK
                </div>
            </div>

            {/* The Anam Player takes over the screen */}
            <div className="w-full h-full relative">
                {agent.personaId ? (
                    <AnamPlayer personaId={agent.personaId} onClose={() => router.push(`/agents/${agent.slug}`)} />
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
