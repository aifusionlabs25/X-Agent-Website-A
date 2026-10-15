'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const faqs = [
    {
        question: 'What makes X Agents different from other AI chatbots?',
        answer: 'X Agents deliver lifelike, real-time video and voice interactions—not just text. Agents are configured with approved business information and workflow-specific instructions for sales, operations, and service.',
    },
    {
        question: 'How do you reduce inaccurate answers?',
        answer: 'We use curated business information, scoped instructions, and testing to reduce inaccurate answers. AI can still make mistakes, so important information should be verified by a person. These safeguards do not guarantee error-free responses.',
    },
    {
        question: 'What integrations are supported?',
        answer: 'X Agents connect to your existing tools via webhooks and API — including popular CRMs, email platforms, and custom integrations. You can also embed agents on any website using a single iframe or our JavaScript SDK.',
    },
    {
        question: 'How fast can I deploy an agent?',
        answer: 'Most pilot builds are completed within 2–4 weeks from kickoff, depending on complexity. Simpler workflows move faster, while enterprise integrations with custom training may take a bit longer.',
    },
    {
        question: 'What\'s the pilot process?',
        answer: 'We start with a 30-minute discovery call to map your workflow pains. From there, we scope the build, configure your agent with a custom Knowledge Bank, integrate with your tools, and deploy to production. You get full analytics and lead intelligence from day one.',
    },
    {
        question: 'Is my data private and secure?',
        answer: 'Absolutely. All Knowledge Banks are private to your organization. Conversations can be processed locally or via enterprise-grade encrypted APIs. We never share client data, and all transcripts are stored securely with configurable retention policies.',
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
