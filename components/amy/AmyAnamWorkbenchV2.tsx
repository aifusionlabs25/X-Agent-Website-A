'use client';

import { useMemo, useState } from 'react';
import {
    AlertTriangle,
    BookOpenText,
    Check,
    ChevronLeft,
    ChevronRight,
    FileText,
    GitBranch,
    Network,
    PackageSearch,
    ShieldCheck,
    Sparkles,
    X,
} from 'lucide-react';
import {
    AMY_WORKBENCH_BOUNDARY,
    AmyWorkbenchTurn,
    AmyWorkbenchView,
    buildAmyWorkbenchModel,
} from '@/lib/anam/workbench-v2';

interface AmyAnamWorkbenchProps {
    isOpen: boolean;
    view: AmyWorkbenchView;
    turns: AmyWorkbenchTurn[];
    roadmapTopic?: string;
    catalogQuery?: string;
    onViewChange: (view: AmyWorkbenchView) => void;
    onClose: () => void;
}

const TABS: Array<{ id: AmyWorkbenchView; label: string; icon: typeof FileText }> = [
    { id: 'notes', label: 'Notes', icon: BookOpenText },
    { id: 'brief', label: 'Brief', icon: FileText },
    { id: 'roadmap', label: 'Roadmap', icon: GitBranch },
    { id: 'visual', label: 'Visual', icon: Network },
    { id: 'catalog', label: 'Catalog', icon: PackageSearch },
];

const NOTE_SECTIONS = ['Organization', 'Scale', 'Environment', 'Priorities', 'Constraints', 'Timing', 'Identity', 'Requested outputs', 'Decisions'] as const;

function EmptySignal() {
    return (
        <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-white/15 bg-white/[0.025] px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#ff3b91]/30 bg-[#ff3b91]/10 text-[#ff68a9]">
                <Sparkles size={20} />
            </div>
            <p className="mt-5 text-sm font-semibold text-white">Ready for the first useful signal</p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-zinc-400">
                Amy will organize confirmed facts, corrections, open questions, and the next decision as the conversation develops.
            </p>
        </div>
    );
}

export default function AmyAnamWorkbenchV2({
    isOpen,
    view,
    turns,
    roadmapTopic = '',
    catalogQuery = '',
    onViewChange,
    onClose,
}: AmyAnamWorkbenchProps) {
    const model = useMemo(
        () => buildAmyWorkbenchModel(turns, roadmapTopic, catalogQuery),
        [catalogQuery, roadmapTopic, turns],
    );
    const [slideIndex, setSlideIndex] = useState(0);
    const activeSlide = model.visualBrief.slides[slideIndex] ?? model.visualBrief.slides[0];

    return (
        <aside
            aria-hidden={!isOpen}
            inert={!isOpen}
            className={`absolute inset-y-0 right-0 z-40 flex w-full max-w-[680px] flex-col overflow-hidden border-l border-white/10 bg-[#0b0b0d]/[0.985] text-white shadow-[-32px_0_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl transition duration-500 ease-out lg:w-[48vw] ${
                isOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'
            }`}
        >
            <header className="relative overflow-hidden border-b border-white/10 px-5 pb-4 pt-5 sm:px-7">
                <div className="pointer-events-none absolute -right-24 -top-32 h-64 w-64 rounded-full bg-[#ff2f8a]/10 blur-3xl" />
                <div className="relative flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-sm bg-[#ff2f8a] text-white shadow-[0_16px_40px_rgba(255,47,138,0.28)]">
                            <Sparkles size={20} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#ff68a9]">Insight intelligence layer</p>
                            <h2 className="truncate text-xl font-semibold tracking-[-0.02em]">Amy Intelligence</h2>
                            <p className="mt-0.5 text-xs text-zinc-400">Live planning, visuals, and solution context</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white" aria-label="Close Amy Intelligence">
                        <X size={17} />
                    </button>
                </div>

                <div className="relative mt-5 grid grid-cols-5 gap-px overflow-hidden rounded-sm border border-white/10 bg-white/10" role="tablist" aria-label="Amy Intelligence views">
                    {TABS.map((tab) => {
                        const Icon = tab.icon;
                        const selected = view === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => onViewChange(tab.id)}
                                className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 bg-[#101014] px-1 text-[9px] font-semibold transition sm:flex-row sm:gap-1.5 sm:text-xs ${selected ? 'bg-white text-black' : 'text-zinc-400 hover:bg-[#18181d] hover:text-white'}`}
                            >
                                <Icon size={14} />
                                <span className="truncate">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Active lane</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-100">{model.lane}</p>
                    </div>
                    <div className="inline-flex items-center gap-2 border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]" />
                        {model.status === 'live' ? `${model.signalCount} session signals` : 'Listening'}
                    </div>
                </div>

                {model.status === 'listening' && view !== 'catalog' ? (
                    <EmptySignal />
                ) : view === 'notes' ? (
                    <section aria-labelledby="amy-notes-heading">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff68a9]">Canonical session model</p>
                        <h3 id="amy-notes-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Live Notes</h3>
                        <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-400">Confirmed current-session signals. Corrections replace older wording; uncertain speech stays separate.</p>
                        <div className="mt-6 space-y-5">
                            {NOTE_SECTIONS.map((section) => {
                                const sectionFacts = model.facts.filter((fact) => fact.section === section);
                                if (!sectionFacts.length) return null;
                                return (
                                    <article key={section} className="border-t border-white/10 pt-4">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{section}</p>
                                        <div className="mt-3 space-y-3">
                                            {sectionFacts.map((fact) => (
                                                <div key={`${fact.label}:${fact.value}`} className="grid gap-1 sm:grid-cols-[132px_1fr] sm:gap-4">
                                                    <div className="flex items-start gap-2 text-xs text-zinc-500"><Check size={13} className="mt-0.5 flex-none text-[#ff68a9]" />{fact.label}</div>
                                                    <p className="text-sm leading-6 text-zinc-200">{fact.value}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                        {model.corrections.length > 0 && (
                            <div className="mt-6 border border-emerald-300/20 bg-emerald-300/[0.05] p-4">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">Applied corrections</p>
                                {model.corrections.map((item) => <p key={`${item.from}:${item.to}`} className="mt-2 text-xs text-zinc-300"><span className="line-through text-zinc-600">{item.from}</span> <span className="mx-2">→</span> {item.to}</p>)}
                            </div>
                        )}
                        {model.uncertainItems.length > 0 && (
                            <div className="mt-4 border border-amber-300/20 bg-amber-300/[0.05] p-4">
                                <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300"><AlertTriangle size={13} /> Needs clarification</p>
                                {model.uncertainItems.map((item) => <p key={item} className="mt-2 text-xs leading-5 text-zinc-400">{item}</p>)}
                            </div>
                        )}
                    </section>
                ) : view === 'brief' ? (
                    <section aria-labelledby="amy-brief-heading">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff68a9]">Account-team working summary</p>
                        <h3 id="amy-brief-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Live Brief</h3>
                        <div className="mt-6 border border-white/10 bg-white/[0.035] p-5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Current objective</p>
                            <p className="mt-3 text-lg leading-7 text-zinc-100">{model.brief.objective}</p>
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div className="border border-white/10 p-5">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Environment</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {(model.brief.environment.length ? model.brief.environment : ['Still to clarify']).map((item) => <span key={item} className="border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300">{item}</span>)}
                                </div>
                            </div>
                            <div className="border border-white/10 p-5">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Priorities and guardrails</p>
                                <ul className="mt-3 space-y-2 text-xs leading-5 text-zinc-300">
                                    {(model.brief.priorities.length ? model.brief.priorities : ['Still to clarify']).map((item) => <li key={item} className="flex gap-2"><span className="mt-2 h-1 w-1 flex-none rounded-full bg-[#ff68a9]" />{item}</li>)}
                                </ul>
                            </div>
                        </div>
                        <div className="mt-4 border-l-2 border-[#ff2f8a] bg-[#ff2f8a]/[0.065] px-5 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#ff68a9]">Suggested next decision</p>
                            <p className="mt-2 text-sm leading-6 text-zinc-200">{model.brief.nextStep}</p>
                        </div>
                        {model.brief.openQuestions.length > 0 && (
                            <div className="mt-6">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Still to clarify</p>
                                <ul className="mt-3 space-y-2 text-sm text-zinc-300">{model.brief.openQuestions.map((question) => <li key={question}>- {question}</li>)}</ul>
                            </div>
                        )}
                    </section>
                ) : view === 'roadmap' ? (
                    <section aria-labelledby="amy-roadmap-heading">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff68a9]">Illustrative planning sequence</p>
                        <h3 id="amy-roadmap-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{model.roadmap.title}</h3>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">{model.roadmap.outcome}</p>
                        {model.roadmap.facts.length > 0 && (
                            <div className="mt-5 flex flex-wrap gap-2">{model.roadmap.facts.slice(0, 7).map((fact) => <span key={`${fact.label}:${fact.value}`} className="border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] text-zinc-300"><strong className="text-zinc-500">{fact.label}:</strong> {fact.value}</span>)}</div>
                        )}
                        <div className="relative mt-8 space-y-3">
                            {model.roadmap.phases.map((phase) => (
                                <article key={phase.number} className="grid grid-cols-[40px_1fr] gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#ff2f8a]/45 bg-[#130d11] text-[10px] font-bold text-[#ff68a9]">{phase.number}</div>
                                    <div className="border border-white/10 bg-white/[0.025] px-5 py-4"><h4 className="text-sm font-semibold text-white">{phase.title}</h4><p className="mt-1 text-xs leading-5 text-zinc-400">{phase.detail}</p></div>
                                </article>
                            ))}
                        </div>
                    </section>
                ) : view === 'visual' ? (
                    <section aria-labelledby="amy-visual-heading">
                        <div className="flex items-end justify-between gap-4">
                            <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff68a9]">Live microdeck</p><h3 id="amy-visual-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Visual Brief</h3></div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{slideIndex + 1} / {model.visualBrief.slides.length}</p>
                        </div>
                        <div className="mt-6 overflow-hidden border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.025] to-[#ff2f8a]/[0.055] p-6 sm:min-h-[390px] sm:p-8">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff68a9]">{activeSlide.eyebrow}</p>
                            <h4 className="mt-5 max-w-lg text-3xl font-semibold tracking-[-0.04em] text-white">{activeSlide.title}</h4>
                            <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-300">{activeSlide.summary}</p>
                            <div className="mt-8 grid gap-3 sm:grid-cols-2">{activeSlide.bullets.map((bullet) => <div key={bullet} className="border-l border-[#ff2f8a]/70 bg-black/20 px-4 py-3 text-xs leading-5 text-zinc-300">{bullet}</div>)}</div>
                            <p className="mt-8 border-t border-white/10 pt-4 text-[10px] leading-4 text-zinc-500">{activeSlide.boundary}</p>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-4">
                            <button type="button" onClick={() => setSlideIndex((current) => Math.max(0, current - 1))} disabled={slideIndex === 0} className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/5 disabled:opacity-30"><ChevronLeft size={15} /> Previous</button>
                            <div className="flex gap-1.5">{model.visualBrief.slides.map((slide, index) => <button key={slide.id} type="button" onClick={() => setSlideIndex(index)} aria-label={`Open slide ${index + 1}`} className={`h-1.5 transition-all ${index === slideIndex ? 'w-7 bg-[#ff2f8a]' : 'w-2 bg-white/20'}`} />)}</div>
                            <button type="button" onClick={() => setSlideIndex((current) => Math.min(model.visualBrief.slides.length - 1, current + 1))} disabled={slideIndex === model.visualBrief.slides.length - 1} className="inline-flex items-center gap-2 border border-white/10 px-3 py-2 text-xs text-zinc-300 transition hover:bg-white/5 disabled:opacity-30">Next <ChevronRight size={15} /></button>
                        </div>
                    </section>
                ) : (
                    <section aria-labelledby="amy-catalog-heading">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff68a9]">Directional solution context</p>
                        <h3 id="amy-catalog-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{model.catalog.title}</h3>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">{model.catalog.summary}</p>
                        <div className="mt-7 grid gap-4 sm:grid-cols-2">
                            {model.catalog.categories.map((category, index) => (
                                <article key={category.title} className="group relative overflow-hidden border border-white/10 bg-white/[0.025] p-5 transition hover:border-[#ff2f8a]/30 hover:bg-white/[0.045]">
                                    <span className="absolute right-4 top-4 text-[10px] font-bold text-zinc-700">0{index + 1}</span>
                                    <PackageSearch size={18} className="text-[#ff68a9]" />
                                    <h4 className="mt-4 text-base font-semibold text-white">{category.title}</h4>
                                    <p className="mt-2 text-xs leading-5 text-zinc-400">{category.description}</p>
                                    <div className="mt-4 flex flex-wrap gap-2">{category.examples.map((example) => <span key={example} className="border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-zinc-400">{example}</span>)}</div>
                                </article>
                            ))}
                        </div>
                        <div className="mt-6 flex items-start gap-3 border border-amber-300/20 bg-amber-300/[0.045] p-4 text-xs leading-5 text-amber-100/80"><ShieldCheck size={16} className="mt-0.5 flex-none text-amber-300" /><span>{model.catalog.boundary}</span></div>
                    </section>
                )}
            </div>

            <footer className="flex items-start gap-3 border-t border-white/10 bg-black/30 px-5 py-4 text-[10px] leading-4 text-zinc-500 sm:px-7">
                <ShieldCheck size={15} className="mt-0.5 flex-none text-emerald-400" />
                <span>{AMY_WORKBENCH_BOUNDARY}</span>
            </footer>
        </aside>
    );
}
