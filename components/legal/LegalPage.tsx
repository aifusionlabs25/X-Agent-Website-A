import type { ReactNode } from 'react';

type LegalPageProps = {
    eyebrow: string;
    title: string;
    description: string;
    children: ReactNode;
};

export default function LegalPage({ eyebrow, title, description, children }: LegalPageProps) {
    return (
        <main className="min-h-screen bg-zinc-950 text-zinc-100">
            <div className="mx-auto max-w-4xl px-6 py-20 sm:px-8 sm:py-28">
                <header className="mb-14 border-b border-zinc-800 pb-10">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-teal-400">
                        {eyebrow}
                    </p>
                    <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">{title}</h1>
                    <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-400">{description}</p>
                    <p className="mt-5 text-sm font-medium text-zinc-500">Effective September 25, 2026</p>
                </header>
                <article className="space-y-12 text-[15px] leading-8 text-zinc-300">{children}</article>
            </div>
        </main>
    );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
            {children}
        </section>
    );
}

export function LegalList({ children }: { children: ReactNode }) {
    return <ul className="list-disc space-y-2 pl-6 marker:text-teal-400">{children}</ul>;
}
