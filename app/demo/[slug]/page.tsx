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
            {/* Minimal bottom nav to return - Centered and High Visibility */}
            <div className="absolute bottom-10 left-0 w-full z-20 flex justify-center items-center pointer-events-none">
                <Link
                    href={`/agents/${agent.slug}`}
                    className="pointer-events-auto flex items-center gap-2 bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white px-6 py-3 rounded-full transition-all text-sm font-bold uppercase tracking-widest hover:scale-105"
                >
                    <ArrowLeft size={18} />
                    Back to {agent.name}
                </Link>
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
