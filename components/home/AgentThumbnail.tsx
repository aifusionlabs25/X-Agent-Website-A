'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { AgentCardData } from '@/lib/agents';

interface Props {
    agent: AgentCardData;
}

export default function AgentThumbnail({ agent }: Props) {
    const href = agent.externalUrl ?? `/agents/${agent.slug}`;

    return (
        <Link
            href={href}
            className="block flex-shrink-0 w-[160px] sm:w-[180px]"
            target={agent.externalUrl ? '_blank' : undefined}
            rel={agent.externalUrl ? 'noopener noreferrer' : undefined}
        >
            <motion.div
                className="relative rounded-lg overflow-hidden cursor-pointer"
                style={{ aspectRatio: '2/3' }}
                whileHover={{ scale: 1.05, boxShadow: `0 0 28px 4px ${agent.accentColor}66` }}
                transition={{ duration: 0.2 }}
            >
                <Image
                    src={agent.thumbnailSrc}
                    alt={agent.name}
                    fill
                    className="object-cover"
                    sizes="200px"
                />
                {agent.externalUrl && (
                    <span className="absolute right-2 top-2 rounded-full border border-teal-300/40 bg-zinc-950/80 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-teal-200 backdrop-blur-sm">
                        Standalone ↗
                    </span>
                )}
                {/* Bottom gradient + name */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
                <div className="absolute bottom-0 left-0 p-3">
                    <p className="text-white font-bold text-sm leading-tight">{agent.name}</p>
                    <p className="text-zinc-400 text-xs mt-0.5">{agent.role}</p>
                </div>
            </motion.div>
        </Link>
    );
}
