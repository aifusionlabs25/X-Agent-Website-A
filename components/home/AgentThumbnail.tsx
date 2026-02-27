'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';

export interface AgentData {
    slug: string;
    name: string;
    role: string;
    thumbnailSrc: string;
    accentColor: string; // e.g. '#6366f1'
    personaId: string;
    liveUrl?: string;
}

interface Props {
    agent: AgentData;
}

export default function AgentThumbnail({ agent }: Props) {
    return (
        <Link href={`/agents/${agent.slug}`} className="block flex-shrink-0 w-[160px] sm:w-[180px]">
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
