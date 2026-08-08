import { Zap, Brain, TrendingUp, Globe } from 'lucide-react';

const specs = [
    {
        icon: Zap,
        title: 'Real-Time Agent Experience',
        desc: 'Real-time voice and avatar video with responsive lip-sync, natural turn-taking, and a clear on-screen AI experience.',
    },
    {
        icon: Brain,
        title: 'Knowledge-First Intelligence',
        desc: 'Agents are grounded in approved sources and instructed to avoid guessing, acknowledge uncertainty, and escalate when needed.',
    },
    {
        icon: TrendingUp,
        title: 'Workflow Efficiency',
        desc: 'Designed to reduce repetitive intake, follow-up, and routing work when paired with verified tools and appropriate human review.',
    },
    {
        icon: Globe,
        title: 'Deploy Anywhere',
        desc: 'Designed for web embedding plus API and webhook integrations. Available channels and integrations vary by project.',
    },
];

export default function TechSpecsSection() {
    return (
        <section id="specs" className="bg-zinc-950 py-20 px-8">
            <div className="max-w-screen-xl mx-auto">
                <h2 className="text-white text-3xl md:text-4xl font-bold mb-2">Behind the Experience</h2>
                <p className="text-zinc-400 text-base mb-12 max-w-xl">
                    Engineering safeguards and reusable patterns tested across the current showcase.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {specs.map(({ icon: Icon, title, desc }) => (
                        <div
                            key={title}
                            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors group"
                        >
                            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-4 group-hover:bg-indigo-500/20 transition-colors">
                                <Icon size={20} className="text-indigo-400" />
                            </div>
                            <h3 className="text-white font-semibold text-sm mb-2">{title}</h3>
                            <p className="text-zinc-400 text-sm leading-relaxed">{desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
