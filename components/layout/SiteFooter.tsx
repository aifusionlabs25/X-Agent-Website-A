'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SiteFooter() {
    const pathname = usePathname();
    if (pathname === '/agents/evan' || pathname.startsWith('/demo/')) return null;

    return (
        <footer className="bg-zinc-950 border-t border-zinc-800 py-12 px-8">
            <div className="max-w-screen-xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">

                    {/* Brand Column */}
                    <div>
                        <p className="text-white font-bold text-lg mb-2">AI Fusion Labs</p>
                        <p className="text-zinc-500 text-sm leading-relaxed max-w-xs">
                            Founder-led AI studio building practical voice, video, intake, and workflow agents for growing teams.
                        </p>
                    </div>

                    {/* Quick Links */}
                    <div>
                        <p className="text-zinc-400 font-semibold text-sm uppercase tracking-wider mb-3">Quick Links</p>
                        <nav className="flex flex-col gap-2 text-sm">
                            <Link href="/#agents" className="text-zinc-500 hover:text-white transition-colors">Agents</Link>
                            <Link href="/#how-it-works" className="text-zinc-500 hover:text-white transition-colors">How It Works</Link>
                            <Link href="/#faq" className="text-zinc-500 hover:text-white transition-colors">FAQ</Link>
                            <Link href="/#beta-signup" className="text-zinc-500 hover:text-white transition-colors">Join Beta</Link>
                        </nav>
                    </div>

                    {/* Social & Legal */}
                    <div>
                        <p className="text-zinc-400 font-semibold text-sm uppercase tracking-wider mb-3">Connect</p>
                        <nav className="flex flex-col gap-2 text-sm mb-4">
                            <a href="https://linkedin.com/company/aifusionlabs" className="text-zinc-500 hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">
                                LinkedIn
                            </a>
                            <a href="https://x.com/AI_FusionLabs" className="text-zinc-500 hover:text-white transition-colors" target="_blank" rel="noopener noreferrer">
                                X (Twitter)
                            </a>
                        </nav>
                        <a href="mailto:aifusionlabs@gmail.com" className="text-zinc-600 hover:text-zinc-400 text-xs underline underline-offset-2 transition-colors">
                            Contact AI Fusion Labs
                        </a>
                    </div>
                </div>

                <div className="border-t border-zinc-800 pt-6 text-center">
                    <p className="text-zinc-600 text-sm">
                        © {new Date().getFullYear()} AI Fusion Labs. All rights reserved.
                    </p>
                </div>
            </div>
        </footer>
    );
}
