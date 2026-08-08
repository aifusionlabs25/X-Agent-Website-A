'use client';

import { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Square, ArrowRight } from 'lucide-react';
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
                                alt="Dani – X Agent Director"
                                fill
                                priority
                                className="object-cover object-top"
                                sizes="100vw"
                            />

                            {/* Bottom dark gradient — heavier to ensure text contrast */}
                            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 from-0% via-zinc-950/40 via-[30%] to-transparent to-[100%]" />
                            {/* Left vignette — stronger for text readability */}
                            <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/40 via-[45%] to-transparent" />

                            {/* Content layer */}
                            <div className="absolute bottom-0 left-0 p-6 md:p-16 max-w-2xl w-full">
                                <motion.p
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.2 }}
                                    className="text-indigo-400 font-bold tracking-widest text-sm mb-3 uppercase flex items-center gap-2"
                                >
                                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                                    Meet Dani — X Agent Director
                                </motion.p>
                                <motion.h1
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.3 }}
                                    className="text-white text-4xl sm:text-5xl md:text-6xl font-black mb-6 leading-[1.1]"
                                >
                                    Deploy Lifelike AI Agents for{' '}
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
                                        Smarter Sales & Ops
                                    </span>
                                </motion.h1>
                                <motion.p
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.4 }}
                                    className="text-zinc-300 text-sm sm:text-base leading-relaxed mb-8 max-w-xl"
                                >
                                    X Agents combine real-time voice and avatar video with approved knowledge and workflow guardrails. They can support tasks such as lead qualification, intake, and tier-1 service routing while making uncertainty visible and handing off when a human is needed. Integrations and capabilities are configured for each deployment.
                                    <br /><br />
                                    <span className="font-semibold text-indigo-300">Explore practical sales, intake, and service workflows →</span>
                                </motion.p>

                                <div className="flex flex-col sm:flex-row gap-4">
                                    <motion.button
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.5 }}
                                        onClick={() => setIsPlaying(true)}
                                        className="flex items-center justify-center gap-2 bg-white text-black hover:bg-zinc-200 font-bold px-8 py-3.5 rounded-md transition-colors"
                                    >
                                        <Play size={18} className="fill-black" />
                                        Start Conversation
                                    </motion.button>
                                    <motion.a
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.6 }}
                                        href="#beta-signup"
                                        className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-8 py-3.5 rounded-md transition-colors"
                                    >
                                        Join Beta Pilot
                                        <ArrowRight size={16} />
                                    </motion.a>
                                </div>
                            </div>
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
                                    <Square size={16} className="fill-white" />
                                    End Session
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </section>
    );
}
