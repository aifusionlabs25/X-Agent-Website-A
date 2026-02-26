'use client';

import { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Info, Square } from 'lucide-react';
import GhostlyBackground from './GhostlyBackground';
import AnamPlayer from '../AnamPlayer';

export default function HeroBillboard() {
    const [isPlaying, setIsPlaying] = useState(false);

    return (
        <section className="relative w-full h-screen min-h-[540px] overflow-hidden bg-zinc-950">
            <GhostlyBackground />

            <motion.div
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8 }}
            >
                {/* Hero image or Live Video */}
                <AnimatePresence mode="wait">
                    {!isPlaying ? (
                        <motion.div
                            key="static-hero"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.8 }}
                            className="absolute inset-0"
                        >
                            <Image
                                src="/agents/thumbnails/Dani landing page hero 1.png"
                                alt="Dani – X Agent"
                                fill
                                priority
                                className="object-cover object-top"
                                sizes="100vw"
                            />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="live-video"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 1.2 }}
                            className="fixed inset-0 z-[100] bg-black"
                        >
                            <AnamPlayer
                                personaId="61f0fd3e-7937-472a-958d-cdba76b33bf1"
                                onClose={() => setIsPlaying(false)}
                            />
                            {/* Overlay End Session Button strictly on the video */}
                            <div className="absolute bottom-8 left-8 md:bottom-16 md:left-16 z-[101]">
                                <button
                                    onClick={() => setIsPlaying(false)}
                                    className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold px-7 py-3 rounded-md text-sm transition-colors shadow-lg shadow-red-900/50"
                                >
                                    <Square size={18} fill="white" />
                                    End Session
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Bottom dark gradient — 100% black at the very bottom edge for a smooth transition, but rapidly fading to keep her jacket bright */}
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 from-0% via-zinc-950/20 via-[25%] to-transparent to-[100%]" />
                {/* Left vignette */}
                <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/75 via-zinc-950/10 to-transparent" />

                {/* Content layer */}
                <div className="absolute bottom-0 left-0 p-8 md:p-16 max-w-2xl">

                    <AnimatePresence>
                        {!isPlaying && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                transition={{ duration: 0.4 }}
                            >
                                {/* Title */}
                                <h1 className="text-white text-7xl md:text-9xl font-black tracking-widest mb-4 drop-shadow-lg">
                                    DANI
                                </h1>

                                {/* Subtitle */}
                                <p className="text-zinc-300 text-base md:text-lg leading-relaxed mb-8 max-w-md">
                                    X Agent. Lifelike. Real-time. Always on.<br />
                                    Meet Dani, our X Agent Director here at AI Fusion Labs, she never misses a beat.
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-3 mt-4">
                        {/* Play Demo → launches cinematic Anam session */}
                        {!isPlaying && (
                            <button
                                onClick={() => setIsPlaying(true)}
                                className="flex items-center gap-2 bg-white hover:bg-zinc-100 text-black font-bold px-7 py-3 rounded-md text-sm transition-colors"
                            >
                                <Play size={18} fill="black" />
                                Start Conversation
                            </button>
                        )}
                        {/* More Info → agent detail sub-page */}
                        <AnimatePresence>
                            {!isPlaying && (
                                <motion.a
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    href="/agents/dani"
                                    className="flex items-center gap-2 bg-zinc-700/70 hover:bg-zinc-600/80 text-white font-semibold px-7 py-3 rounded-md text-sm transition-colors backdrop-blur-sm"
                                >
                                    <Info size={18} />
                                    More Info
                                </motion.a>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </motion.div>
        </section>
    );
}
