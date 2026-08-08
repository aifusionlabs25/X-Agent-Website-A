import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ALL_AGENTS } from '@/lib/agents';
import { Play } from 'lucide-react';
import EvanLandingPage from '@/components/evan/EvanLandingPage';

interface Props {
    params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
    return ALL_AGENTS.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const agent = ALL_AGENTS.find((candidate) => candidate.slug === slug);

    if (!agent) {
        return {
            title: 'Agent not found',
            robots: { index: false, follow: false },
        };
    }

    const title = `${agent.name} — ${agent.role}`;
    const description = `Meet ${agent.name}, an interactive AI agent demo configured for ${agent.role.toLowerCase()} workflows.`;
    const canonical = `/agents/${agent.slug}`;

    return {
        title,
        description,
        alternates: { canonical },
        openGraph: {
            title: `${title} | AI Fusion Labs`,
            description,
            url: canonical,
            siteName: 'AI Fusion Labs',
            type: 'website',
            locale: 'en_US',
            images: [
                {
                    url: '/opengraph-image',
                    width: 1200,
                    height: 630,
                    alt: 'X Agents by AI Fusion Labs',
                },
            ],
        },
    };
}

export default async function AgentDetailPage({ params }: Props) {
    const { slug } = await params;
    const agent = ALL_AGENTS.find((a) => a.slug === slug);
    if (!agent) notFound();
    const isAmy = agent.slug === 'amy';
    if (agent.slug === 'evan') return <EvanLandingPage agent={agent} />;

    return (
        <main className="min-h-screen bg-zinc-950 pt-20">
            {/* Cinematic backdrop */}
            <div className="relative w-full h-[50vh] overflow-hidden">
                {isAmy ? (
                    <Image
                        src={agent.thumbnailSrc}
                        alt={agent.name}
                        fill
                        loading="eager"
                        className="object-cover object-[center_38%] blur-[1px] opacity-40"
                        sizes="100vw"
                    />
                ) : (
                    <Image
                        src={agent.thumbnailSrc}
                        alt={agent.name}
                        fill
                        loading="eager"
                        className="object-cover object-top blur-sm scale-105 opacity-40"
                        sizes="100vw"
                    />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />

                {/* Poster + info overlay */}
                <div className="absolute bottom-0 left-0 right-0 px-8 md:px-16 pb-8 flex items-end gap-6">
                    <div
                        className="relative w-28 h-40 md:w-36 md:h-52 rounded-lg overflow-hidden flex-shrink-0 border-2 shadow-2xl"
                        style={{ borderColor: agent.accentColor }}
                    >
                        <Image
                            src={agent.thumbnailSrc}
                            alt={agent.name}
                            fill
                            loading="eager"
                            className="object-cover"
                            sizes="200px"
                        />
                    </div>
                    <div>
                        <span
                            className="text-xs font-bold uppercase tracking-widest mb-1 block"
                            style={{ color: agent.accentColor }}
                        >
                            AI Fusion Labs X Agent
                        </span>
                        <h1 className="text-4xl md:text-6xl font-black tracking-widest text-white mb-1">
                            {agent.name}
                        </h1>
                        <p className="text-zinc-400 text-base">{agent.role}</p>

                        <div className="mt-4 md:mt-6">
                            {agent.liveUrl ? (
                                <Link
                                    href={agent.liveUrl}
                                    className="inline-flex items-center gap-2 bg-white hover:bg-zinc-100 text-black font-bold px-6 py-2 md:px-7 md:py-3 rounded-md transition-colors text-sm"
                                >
                                    <Play size={16} fill="black" />
                                    Launch Live Demo
                                </Link>
                            ) : (
                                <div className="inline-flex items-center gap-2 bg-zinc-800/80 backdrop-blur-sm text-zinc-500 px-6 py-2 md:px-7 md:py-3 rounded-md cursor-not-allowed text-sm">
                                    Coming Soon
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Detail body */}
            <div className="max-w-4xl mx-auto px-8 py-12">
                <div className="border-b border-zinc-800 pb-8 mb-8">
                    <h2 className="text-white text-xl font-semibold mb-3">Overview</h2>
                    <p className="text-zinc-400 leading-relaxed">
                        {agent.name} is a real-time voice-and-avatar X Agent built by AI Fusion Labs.
                        The showcase is configured with curated instructions and source material for
                        the {agent.role} workflow. Available tools and handoffs vary by agent.
                    </p>
                </div>

                {/* Specs grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-10">
                    {[
                        ['Role', agent.role],
                        ['Experience', 'Real-time voice + avatar'],
                        ['Language', 'Configured per agent'],
                        ['Knowledge', 'Curated source set'],
                        ['Session', 'Interactive showcase'],
                        ['Tools', 'Agent-specific'],
                    ].map(([label, value]) => (
                        <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                            <p className="text-zinc-500 text-xs mb-1">{label}</p>
                            <p className="text-white font-semibold">{value}</p>
                        </div>
                    ))}
                </div>

                <div className="mt-6">
                    <Link href="/#agents" className="text-zinc-500 hover:text-white text-sm transition-colors">
                        ← Back to all agents
                    </Link>
                </div>
            </div>
        </main>
    );
}
