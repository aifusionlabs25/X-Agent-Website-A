'use client';

import { useState, useRef } from 'react';

export default function BetaSignupSection() {
    const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
    const formRef = useRef<HTMLFormElement>(null);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setStatus('sending');

        const formData = new FormData(e.currentTarget);
        const data = {
            name: formData.get('name') as string,
            email: formData.get('email') as string,
            company: formData.get('company') as string,
            useCase: formData.get('useCase') as string,
        };

        try {
            const res = await fetch('/api/beta-signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                setStatus('success');
                formRef.current?.reset();
            } else {
                setStatus('error');
            }
        } catch {
            setStatus('error');
        }
    };

    return (
        <section id="beta-signup" className="bg-zinc-950 py-24 px-8">
            <div className="max-w-screen-md mx-auto">
                <div className="text-center mb-12">
                    <p className="text-indigo-400 text-sm font-semibold tracking-widest uppercase mb-3">Pilot Inquiry</p>
                    <h2 className="text-white text-3xl md:text-4xl font-bold mb-4">
                        Join the Beta Pilot — Get a Custom Demo
                    </h2>
                    <p className="text-zinc-400 text-base max-w-lg mx-auto">
                        Tell us about the sales, intake, service, or operations workflow you want to improve. We&apos;ll follow up to discuss fit and scope.
                    </p>
                </div>

                {status === 'success' ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-10 text-center">
                        <p className="text-emerald-400 text-xl font-semibold mb-2">You&apos;re In! 🎉</p>
                        <p className="text-zinc-300 mb-3">Thanks for signing up for the Beta Pilot.</p>
                        <p className="text-zinc-400 text-sm">We received your request and will follow up using the email address you provided.</p>
                    </div>
                ) : (
                    <form ref={formRef} onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 space-y-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <div>
                                <label htmlFor="signup-name" className="block text-zinc-300 text-sm font-medium mb-1.5">Name</label>
                                <input
                                    id="signup-name"
                                    name="name"
                                    type="text"
                                    required
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                                    placeholder="Your name"
                                />
                            </div>
                            <div>
                                <label htmlFor="signup-email" className="block text-zinc-300 text-sm font-medium mb-1.5">Email</label>
                                <input
                                    id="signup-email"
                                    name="email"
                                    type="email"
                                    required
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                                    placeholder="you@company.com"
                                />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="signup-company" className="block text-zinc-300 text-sm font-medium mb-1.5">Company / Role</label>
                            <input
                                id="signup-company"
                                name="company"
                                type="text"
                                required
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                                placeholder="Acme Inc. / VP of Sales"
                            />
                        </div>
                        <div>
                            <label htmlFor="signup-usecase" className="block text-zinc-300 text-sm font-medium mb-1.5">Primary Use Case</label>
                            <select
                                id="signup-usecase"
                                name="useCase"
                                required
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition appearance-none"
                            >
                                <option value="">Select a use case...</option>
                                <option value="Lead Nurturing">Lead Nurturing &amp; Follow-Up</option>
                                <option value="CRM Automation">CRM Automation</option>
                                <option value="Customer Intake">Customer Intake &amp; Onboarding</option>
                                <option value="Sales SDR">AI SDR / Outbound Sales</option>
                                <option value="Support Triage">Support Triage &amp; Routing</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>

                        {status === 'error' && (
                            <p className="text-red-400 text-sm">Something went wrong. Please try again.</p>
                        )}

                        <p className="text-zinc-500 text-xs leading-relaxed">
                            Do not submit confidential information. By submitting, you agree that AI Fusion Labs may contact you about this request.
                        </p>

                        <button
                            type="submit"
                            disabled={status === 'sending'}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-bold py-3.5 rounded-lg text-sm transition-colors"
                        >
                            {status === 'sending' ? 'Submitting...' : 'Join Beta Pilot — Get a Custom Demo'}
                        </button>
                    </form>
                )}
            </div>
        </section>
    );
}
