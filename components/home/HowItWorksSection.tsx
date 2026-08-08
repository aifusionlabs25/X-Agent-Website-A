import Image from 'next/image';
import { Lightbulb, Wrench, Plug, Rocket } from 'lucide-react';

const steps = [
    {
        icon: Lightbulb,
        step: '01',
        title: 'Share Your Workflow Pains',
        desc: 'Tell us where leads leak, where CRM chaos lives, or where your team is drowning in repetitive tasks.',
    },
    {
        icon: Wrench,
        step: '02',
        title: 'We Build Your Custom Agent',
        desc: 'We configure a real-time agent with your approved source material, workflow rules, escalation paths, and brand guidance.',
    },
    {
        icon: Plug,
        step: '03',
        title: 'Integrate Seamlessly',
        desc: 'Deploy via a single iframe, SDK snippet, or connect through webhooks and API to your existing CRM and sales tools.',
    },
    {
        icon: Rocket,
        step: '04',
        title: 'Validate, Launch & Monitor',
        desc: 'We test the approved journey before launch, then monitor the integrations and outcomes included in your project scope.',
    },
];

const caseStudies = [
    {
        title: 'AI Lead Automation',
        description: 'Example: inbound request → guided qualification → reviewed follow-up or CRM handoff.',
        image: '/diagrams/flow-lead-automation.png',
    },
    {
        title: 'CRM Pipeline Optimization',
        description: 'Example: organize intake data and route the next step into an existing pipeline.',
        image: '/diagrams/flow-crm-optimization.png',
    },
    {
        title: 'Lifelike Voice Engagement',
        description: 'Example: visitor starts a voice-and-video conversation → agent gathers context → approved handoff.',
        image: '/diagrams/flow-voice-engagement.png',
    },
];

export default function HowItWorksSection() {
    return (
        <section id="how-it-works" className="bg-zinc-950 py-24 px-8">
            <div className="max-w-screen-xl mx-auto">
                <div className="text-center mb-16">
                    <p className="text-indigo-400 text-sm font-semibold tracking-widest uppercase mb-3">How It Works</p>
                    <h2 className="text-white text-3xl md:text-4xl font-bold mb-4">
                        From Workflow Pain to a Testable Agent
                    </h2>
                    <p className="text-zinc-400 text-base max-w-2xl mx-auto">
                        We scope the workflow, configure the experience, connect approved tools, and validate the customer journey. Timing and channels depend on the integration.
                    </p>
                </div>

                {/* Step Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
                    {steps.map(({ icon: Icon, step, title, desc }) => (
                        <div
                            key={step}
                            className="relative bg-zinc-900 border border-zinc-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors group"
                        >
                            <span className="absolute top-4 right-5 text-4xl font-black text-zinc-800 group-hover:text-indigo-500/20 transition-colors select-none">
                                {step}
                            </span>
                            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-4 group-hover:bg-indigo-500/20 transition-colors">
                                <Icon size={20} className="text-indigo-400" />
                            </div>
                            <h3 className="text-white font-semibold text-sm mb-2">{title}</h3>
                            <p className="text-zinc-400 text-sm leading-relaxed">{desc}</p>
                        </div>
                    ))}
                </div>

                {/* Visual Case Studies */}
                <div className="text-center mb-12">
                    <p className="text-indigo-400 text-sm font-semibold tracking-widest uppercase mb-3">Illustrative Workflows</p>
                    <h3 className="text-white text-2xl md:text-3xl font-bold mb-4">
                        See It in Action
                    </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {caseStudies.map((cs) => (
                        <div
                            key={cs.title}
                            className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-indigo-500/30 transition-colors group"
                        >
                            <a href={cs.image} target="_blank" rel="noopener noreferrer" className="block relative w-full aspect-[4/3] bg-zinc-800 cursor-zoom-in">
                                <Image
                                    src={cs.image}
                                    alt={cs.title}
                                    fill
                                    className="object-contain p-2 group-hover:scale-[1.02] transition-transform duration-300"
                                    sizes="(max-width: 768px) 100vw, 33vw"
                                />
                            </a>
                            <div className="p-5">
                                <h4 className="text-white font-semibold text-sm mb-1.5">{cs.title}</h4>
                                <p className="text-zinc-400 text-sm leading-relaxed">{cs.description}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
