'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import AnamPlayer from '@/components/AnamPlayer';
import EvanContactGate from '@/components/evan/EvanContactGate';
import { EVAN_PERSONA_ID } from '@/lib/anam/persona-ids';

// The approved Evan room presentation, on the protected path only. Do not send
// an unlocked visitor back to /demo/evan: that path always starts public calls.
export default function EvanExtendedDemoRoom() {
    const router = useRouter();
    return (
        <EvanContactGate evanDemoMode="extended">
            <main className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#100718]" data-ai-screen data-anam-variant="public" data-anam-audio-bridge="default" data-evan-demo-mode="extended">
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#160925]/88 px-4 py-3 shadow-[0_8px_35px_rgba(0,0,0,.25)] backdrop-blur-md sm:px-6">
                    <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white p-1">
                            <Image src="/agents/thumbnails/Evan Mullins Moving logo.png" alt="Mullins Moving" width={44} height={44} className="h-full w-full object-contain" />
                        </span>
                        <div>
                            <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#ffc857]">Mullins Moving</p>
                            <p className="text-sm font-bold text-white">Live with Evan</p>
                        </div>
                    </div>
                    <span className="hidden items-center gap-2 rounded-full border border-[#ffc857]/20 bg-[#ffc857]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ffdc8a] sm:inline-flex">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffc857]" /> Concierge session
                    </span>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex items-center justify-center px-4">
                    <Link href="/agents/evan" aria-label="Exit session" className="pointer-events-auto flex min-h-12 items-center gap-2 px-6 py-3 text-sm font-bold backdrop-blur-md transition-[transform,background-color,border-color] focus-visible:outline-2 focus-visible:outline-offset-4 rounded-xl border border-[#ffc857]/35 bg-[#5d24d6]/80 uppercase tracking-widest text-white shadow-[0_12px_35px_rgba(0,0,0,.3)] hover:scale-105 hover:bg-[#6f34e8] focus-visible:outline-[#ffc857]">
                        <LogOut size={18} /> Exit
                    </Link>
                </div>
                <div className="relative h-full w-full px-4 pb-24 pt-20 sm:px-7 sm:pb-20 sm:pt-20">
                    <AnamPlayer personaId={EVAN_PERSONA_ID} evanDemoMode="extended" onClose={() => router.push('/agents/evan')} />
                </div>
                <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_center,transparent_42%,rgba(16,7,24,.74)_100%)] ring-1 ring-inset ring-[#ffc857]/15" />
            </main>
        </EvanContactGate>
    );
}
