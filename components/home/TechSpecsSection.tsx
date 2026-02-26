import { Zap, Brain, TrendingUp, Globe } from 'lucide-react';

const specs = [
    {
        icon: Zap,
        title: 'Neural Architecture',
        desc: 'Advanced real-time synthesis – lifelike lip-sync, natural voice, and expressive gestures in live conversations.',
    },
    {
        icon: Brain,
        title: 'Knowledge-First Intelligence',
        desc: 'Every agent is bound to an approved Knowledge Bank. No hallucinations, no guessing.',
    },
    {
        icon: TrendingUp,
        title: 'Proven Conversion Gains',
        desc: 'Our X Agents consistently deliver measurable performance improvements relative to traditional human-led outreach and support roles.',
    },
    {
        icon: Globe,
        title: 'Deploy Anywhere',
        desc: 'Embed on any website, app, or CRM via a single iframe or SDK snippet.',
    },
];

export default function TechSpecsSection() {
    return (
        <section id="specs" className="bg-zinc-950 py-20 px-8">
            <div className="max-w-screen-xl mx-auto">
                <h2 className="text-white text-3xl md:text-4xl font-bold mb-2">Behind the Experience</h2>
                <p className="text-zinc-400 text-base mb-12 max-w-xl">
                    Gold-standard engineering principles, battle-tested across every agent we ship.
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
