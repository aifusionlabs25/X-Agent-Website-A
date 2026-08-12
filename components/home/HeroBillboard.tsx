'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Play, ArrowRight } from 'lucide-react';
import GhostlyBackground from './GhostlyBackground';

export default function HeroBillboard() {
    return (
        <section className="relative w-full h-screen min-h-[540px] overflow-hidden bg-zinc-950">
            <GhostlyBackground />

            <motion.div
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8 }}
            >
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.8 }}
                    className="absolute inset-0"
                >
                            <Image
                                src="/agents/thumbnails/dani-x-agent-director-cara4-2026.jpg"
                                alt="Dani - AI Solutions Director"
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
                                    Meet Dani - AI Solutions Director
                                </motion.p>
                                <motion.h1
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.3 }}
                                    className="text-white text-4xl sm:text-5xl md:text-6xl font-black mb-6 leading-[1.1]"
                                >
                                    Find the Right AI Fit for{' '}
                                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
                                        Your Business Workflow
                                    </span>
                                </motion.h1>
                                <motion.p
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.4 }}
                                    className="text-zinc-300 text-sm sm:text-base leading-relaxed mb-8 max-w-xl"
                                >
                                    Dani helps you clarify the business problem, compare practical AI solution patterns, and identify what should be validated next—from conversational X Agents and approved knowledge to research, reporting, and workflow automation.
                                    <br /><br />
                                    <span className="font-semibold text-indigo-300">Start with the workflow, the evidence, and the human decision—not the buzzwords.</span>
                                </motion.p>

                                <div className="flex flex-col sm:flex-row gap-4">
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.5 }}
                                    >
                                        <Link
                                            href="/agents/dani"
                                            className="flex items-center justify-center gap-2 bg-white text-black hover:bg-zinc-200 font-bold px-8 py-3.5 rounded-md transition-colors"
                                        >
                                            <Play size={18} className="fill-black" />
                                            Meet Dani
                                        </Link>
                                    </motion.div>
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
            </motion.div>
        </section>
    );
}
