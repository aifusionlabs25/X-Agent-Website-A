'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
    {
        question: 'What makes X Agents different from other AI chatbots?',
        answer: 'X Agents deliver real-time video and voice interactions—not just text. Each agent is configured for a defined workflow with approved source material, escalation rules, and agent-specific tools.',
    },
    {
        question: 'How do you prevent hallucinations?',
        answer: 'Grounding, instructions, tool limits, and testing reduce unsupported answers, but no generative AI system can promise zero hallucinations. X Agents are instructed to acknowledge uncertainty and escalate rather than invent an answer.',
    },
    {
        question: 'What integrations are supported?',
        answer: 'X Agents can connect through APIs, webhooks, email providers, and web embeds. The exact channels and integrations are confirmed during scoping and tested before launch.',
    },
    {
        question: 'How fast can I deploy an agent?',
        answer: 'Timing depends on the workflow, source material, integrations, security requirements, and review cycle. We define a realistic pilot schedule after discovery rather than promise a one-size-fits-all launch date.',
    },
    {
        question: 'What\'s the pilot process?',
        answer: 'We start by mapping the workflow and success criteria. From there, we scope the build, configure approved knowledge and guardrails, connect agreed tools, test the full journey, and prepare a controlled launch.',
    },
    {
        question: 'Is my data private and secure?',
        answer: 'Data handling depends on the selected providers and deployment design. Before production, we document what is collected, where it is processed, who can access it, and the applicable retention settings so the configuration can match your requirements.',
    },
];

export default function FAQSection() {
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    const toggle = (index: number) => {
        setOpenIndex(openIndex === index ? null : index);
    };

    return (
        <section id="faq" className="bg-zinc-950 py-24 px-8">
            <div className="max-w-screen-md mx-auto">
                <div className="text-center mb-16">
                    <p className="text-indigo-400 text-sm font-semibold tracking-widest uppercase mb-3">FAQ</p>
                    <h2 className="text-white text-3xl md:text-4xl font-bold mb-4">
                        Frequently Asked Questions
                    </h2>
                </div>

                <div className="space-y-3">
                    {faqs.map((faq, index) => (
                        <div
                            key={index}
                            className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden transition-colors hover:border-zinc-700"
                        >
                            <button
                                onClick={() => toggle(index)}
                                className="w-full flex items-center justify-between px-6 py-5 text-left"
                            >
                                <span className="text-white text-sm font-medium pr-4">{faq.question}</span>
                                <ChevronDown
                                    size={18}
                                    className={`text-zinc-500 shrink-0 transition-transform duration-200 ${openIndex === index ? 'rotate-180' : ''
                                        }`}
                                />
                            </button>
                            {openIndex === index && (
                                <div className="px-6 pb-5">
                                    <p className="text-zinc-400 text-sm leading-relaxed">{faq.answer}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
