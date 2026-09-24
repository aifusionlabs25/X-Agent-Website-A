'use client';

import { useEffect, useState, type ReactNode } from 'react';

type JamesReadiness = { ready?: boolean };

export default function JamesPrivacyReleaseGate({ children }: { children: ReactNode }) {
    const [ready, setReady] = useState(false);
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        let active = true;
        fetch('/api/anam/james/readiness', { cache: 'no-store' })
            .then(response => response.ok ? response.json() as Promise<JamesReadiness> : null)
            .then(result => {
                if (!active) return;
                setReady(result?.ready === true);
                setChecked(true);
            })
            .catch(() => {
                if (!active) return;
                setReady(false);
                setChecked(true);
            });
        return () => { active = false; };
    }, []);

    if (ready) return children;

    return (
        <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-white">
            <section className="max-w-lg rounded-2xl border border-white/15 bg-white/[0.04] p-8 text-center shadow-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Knowles Law Firm</p>
                <h1 className="mt-4 text-2xl font-semibold">James is temporarily unavailable</h1>
                <p className="mt-3 text-sm leading-6 text-white/70">
                    This AI experience is under privacy and release review. You can contact the firm directly at{' '}
                    <a className="font-semibold text-white underline underline-offset-4" href="tel:+16027025431">602-702-5431</a>.
                </p>
                {!checked && <p className="sr-only" role="status">Checking James availability.</p>}
                {checked && <p className="sr-only" role="status">James is unavailable.</p>}
            </section>
        </main>
    );
}
