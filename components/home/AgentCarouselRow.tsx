'use client';

import useEmblaCarousel from 'embla-carousel-react';
import AgentThumbnail, { AgentData } from './AgentThumbnail';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback } from 'react';

interface Props {
    title: string;
    agents: AgentData[];
}

export default function AgentCarouselRow({ title, agents }: Props) {
    const [emblaRef, emblaApi] = useEmblaCarousel({
        align: 'start',
        dragFree: true,
        containScroll: 'trimSnaps',
    });

    const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
    const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

    return (
        <section className="relative px-8 py-6 max-w-screen-2xl mx-auto">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-white text-xl font-semibold tracking-tight">{title}</h2>
                <div className="flex gap-2">
                    <button
                        onClick={scrollPrev}
                        className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                        aria-label="Scroll left"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <button
                        onClick={scrollNext}
                        className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                        aria-label="Scroll right"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>

            <div className="overflow-hidden" ref={emblaRef}>
                <div className="flex gap-4">
                    {agents.map((agent) => (
                        <AgentThumbnail key={agent.slug} agent={agent} />
                    ))}
                </div>
            </div>
        </section>
    );
}
