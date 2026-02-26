import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ALL_AGENTS } from '@/lib/agents';
import { ExternalLink } from 'lucide-react';

interface Props {
    params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
    return ALL_AGENTS.map((a) => ({ slug: a.slug }));
}

export default async function AgentDetailPage({ params }: Props) {
    const { slug } = await params;
    const agent = ALL_AGENTS.find((a) => a.slug === slug);
    if (!agent) notFound();

    return (
        <main className="min-h-screen bg-zinc-950 pt-20">
            {/* Cinematic backdrop */}
            <div className="relative w-full h-[50vh] overflow-hidden">
                <Image
                    src={agent.thumbnailSrc}
                    alt={agent.name}
                    fill
                    className="object-cover object-top blur-sm scale-105 opacity-40"
                    sizes="100vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />

                {/* Poster + info overlay */}
                <div className="absolute bottom-0 left-0 right-0 px-8 md:px-16 pb-8 flex items-end gap-6">
                    <div
                        className="relative w-28 h-40 md:w-36 md:h-52 rounded-lg overflow-hidden flex-shrink-0 border-2 shadow-2xl"
                        style={{ borderColor: agent.accentColor }}
                    >
                        <Image src={agent.thumbnailSrc} alt={agent.name} fill className="object-cover" sizes="200px" />
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
                    </div>
                </div>
            </div>

            {/* Detail body */}
            <div className="max-w-4xl mx-auto px-8 py-12">
                <div className="border-b border-zinc-800 pb-8 mb-8">
                    <h2 className="text-white text-xl font-semibold mb-3">Overview</h2>
                    <p className="text-zinc-400 leading-relaxed">
                        {agent.name} is a lifelike X Agent built by AI Fusion Labs. Trained on a
                        curated dataset and powered by real-time video synthesis, {agent.name}{' '}
                        operates as a {agent.role.toLowerCase()} — always on, never off-script.
                    </p>
                </div>

                {/* Specs grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-10">
                    {[
                        ['Role', agent.role],
                        ['Platform', 'Neural Architecture'],
                        ['Language', 'Multilingual (30+)'],
                        ['Memory', 'Custom Dataset'],
                        ['Deployment', 'Web Embed / API'],
                        ['Integrations', 'Webhooks & Tool Calls'],
                    ].map(([label, value]) => (
                        <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                            <p className="text-zinc-500 text-xs mb-1">{label}</p>
                            <p className="text-white font-semibold">{value}</p>
                        </div>
                    ))}
                </div>

                {/* CTA */}
                {agent.liveUrl ? (
                    <a
                        href={agent.liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-white hover:bg-zinc-100 text-black font-bold px-7 py-3 rounded-md transition-colors"
                    >
                        <ExternalLink size={16} />
                        Launch Live Demo
                    </a>
                ) : (
                    <div className="inline-flex items-center gap-2 bg-zinc-800 text-zinc-500 px-7 py-3 rounded-md cursor-not-allowed text-sm">
                        Coming Soon
                    </div>
                )}

                <div className="mt-6">
                    <Link href="/#agents" className="text-zinc-500 hover:text-white text-sm transition-colors">
                        ← Back to all agents
                    </Link>
                </div>
            </div>
        </main>
    );
}
