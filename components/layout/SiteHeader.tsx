'use client';

import Link from 'next/link';

export default function SiteHeader() {
    return (
        <header className="fixed top-0 left-0 right-0 z-50">
            {/* Subtle Gradient fade from black to transparent for text legibility */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/30 to-transparent pointer-events-none h-32" />
            <div className="relative flex items-center justify-between px-6 md:px-8 py-4 max-w-screen-2xl mx-auto">

                <Link href="/" className="flex items-center gap-3 group">
                    {/* Logo removed per user request */}
                </Link>

                {/* Nav */}
                <nav className="flex items-center gap-4 md:gap-6 text-sm text-zinc-100 drop-shadow-md font-medium">
                    <Link href="#agents" className="hover:text-white transition-colors hidden sm:inline">Agents</Link>
                    <Link href="#specs" className="hover:text-white transition-colors hidden sm:inline">Technology</Link>
                    <Link href="#how-it-works" className="hover:text-white transition-colors hidden md:inline">How It Works</Link>
                    {/* <Link href="#pricing" className="hover:text-white transition-colors hidden md:inline">Pricing</Link> */}
                    <Link href="#faq" className="hover:text-white transition-colors hidden lg:inline">FAQ</Link>
                    <Link
                        href="#beta-signup"
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 py-2 rounded-md text-sm transition-colors"
                    >
                        Join Beta
                    </Link>
                </nav>
            </div>
        </header>
    );
}
