'use client';

import { useMemo } from 'react';
import {
    ArrowDown,
    BookOpenText,
    Check,
    FileText,
    GitBranch,
    Network,
    ShieldCheck,
    Sparkles,
    X,
} from 'lucide-react';
import {
    AMY_WORKBENCH_BOUNDARY,
    AmyWorkbenchTurn,
    AmyWorkbenchView,
    buildAmyWorkbenchModel,
} from '@/lib/anam/workbench';

interface AmyAnamWorkbenchProps {
    isOpen: boolean;
    view: AmyWorkbenchView;
    turns: AmyWorkbenchTurn[];
    roadmapTopic?: string;
    onViewChange: (view: AmyWorkbenchView) => void;
    onClose: () => void;
}

const TABS: Array<{ id: AmyWorkbenchView; label: string; icon: typeof FileText }> = [
    { id: 'notes', label: 'Live Notes', icon: BookOpenText },
    { id: 'brief', label: 'Live Brief', icon: FileText },
    { id: 'roadmap', label: 'Roadmap', icon: GitBranch },
    { id: 'visual', label: 'Visual', icon: Network },
];

function EmptySignal() {
    return (
        <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-white/15 bg-white/[0.025] px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#ff3b91]/30 bg-[#ff3b91]/10 text-[#ff68a9]">
                <Sparkles size={20} />
            </div>
            <p className="mt-5 text-sm font-semibold text-white">Ready for the first useful signal</p>
            <p className="mt-2 max-w-xs text-xs leading-5 text-zinc-400">
                Amy will organize the objective, environment, constraints, and next decision as the conversation develops.
            </p>
        </div>
    );
}

export default function AmyAnamWorkbench({
    isOpen,
    view,
    turns,
    roadmapTopic = '',
    onViewChange,
    onClose,
}: AmyAnamWorkbenchProps) {
    const model = useMemo(() => buildAmyWorkbenchModel(turns, roadmapTopic), [roadmapTopic, turns]);

    return (
        <aside
            aria-hidden={!isOpen}
            inert={!isOpen}
            className={`absolute inset-y-0 right-0 z-40 flex w-full max-w-[620px] flex-col overflow-hidden border-l border-white/10 bg-[#0b0b0d]/[0.985] text-white shadow-[-32px_0_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl transition duration-500 ease-out lg:w-[46vw] ${
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
                            <p className="mt-0.5 text-xs text-zinc-400">Current-session planning workspace</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                        aria-label="Close Amy Intelligence"
                    >
                        <X size={17} />
                    </button>
                </div>

                <div className="relative mt-5 grid grid-cols-4 gap-px overflow-hidden rounded-sm border border-white/10 bg-white/10" role="tablist" aria-label="Amy Intelligence views">
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
                                className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 bg-[#101014] px-1 text-[10px] font-semibold transition sm:flex-row sm:gap-1.5 sm:text-xs ${
                                    selected ? 'bg-white text-black' : 'text-zinc-400 hover:bg-[#18181d] hover:text-white'
                                }`}
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

                {model.status === 'listening' ? (
                    <EmptySignal />
                ) : view === 'notes' ? (
                    <section aria-labelledby="amy-notes-heading">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff68a9]">What Amy has organized</p>
                        <h3 id="amy-notes-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Live Notes</h3>
                        <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-400">A compact view of current-session signals, not a raw transcript or completed assessment.</p>
                        <div className="mt-6 divide-y divide-white/10 border-y border-white/10">
                            {model.notes.map((note) => (
                                <article key={`${note.label}:${note.value}`} className="grid gap-2 py-5 sm:grid-cols-[132px_1fr] sm:gap-5">
                                    <div className="flex items-start gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-500">
                                        <Check size={13} className="mt-px flex-none text-[#ff68a9]" />
                                        {note.label}
                                    </div>
                                    <p className="text-sm leading-6 text-zinc-200">{note.value}</p>
                                </article>
                            ))}
                        </div>
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
                                    {(model.brief.environment.length ? model.brief.environment : ['Still to clarify']).map((item) => (
                                        <span key={item} className="border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300">{item}</span>
                                    ))}
                                </div>
                            </div>
                            <div className="border border-white/10 p-5">
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Priorities and guardrails</p>
                                <ul className="mt-3 space-y-2 text-xs leading-5 text-zinc-300">
                                    {(model.brief.priorities.length ? model.brief.priorities : ['Still to clarify']).map((item) => (
                                        <li key={item} className="flex gap-2"><span className="mt-2 h-1 w-1 flex-none rounded-full bg-[#ff68a9]" />{item}</li>
                                    ))}
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
                                <ul className="mt-3 space-y-2 text-sm text-zinc-300">
                                    {model.brief.openQuestions.map((question) => <li key={question}>- {question}</li>)}
                                </ul>
                            </div>
                        )}
                    </section>
                ) : view === 'roadmap' ? (
                    <section aria-labelledby="amy-roadmap-heading">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff68a9]">Illustrative planning sequence</p>
                        <h3 id="amy-roadmap-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{model.roadmap.title}</h3>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">{model.roadmap.outcome}</p>
                        <div className="relative mt-8 space-y-3">
                            {model.roadmap.phases.map((phase) => (
                                <article key={phase.number} className="grid grid-cols-[40px_1fr] gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#ff2f8a]/45 bg-[#130d11] text-[10px] font-bold text-[#ff68a9]">{phase.number}</div>
                                    <div className="border border-white/10 bg-white/[0.025] px-5 py-4">
                                        <h4 className="text-sm font-semibold text-white">{phase.title}</h4>
                                        <p className="mt-1 text-xs leading-5 text-zinc-400">{phase.detail}</p>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </section>
                ) : (
                    <section aria-labelledby="amy-visual-heading">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff68a9]">Conversation working canvas</p>
                        <h3 id="amy-visual-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Decision flow</h3>
                        <p className="mt-2 text-sm leading-6 text-zinc-400">A visual path from the desired outcome to the next decision.</p>
                        <div className="mt-8 grid gap-3">
                            {model.visual.map((node, index) => (
                                <div key={node.label}>
                                    <article className={`border p-5 ${node.state === 'known' ? 'border-white/15 bg-white/[0.035]' : 'border-dashed border-amber-300/25 bg-amber-300/[0.035]'}`}>
                                        <div className="flex items-center justify-between gap-4">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">{node.label}</p>
                                            <span className={`text-[9px] font-bold uppercase tracking-[0.12em] ${node.state === 'known' ? 'text-emerald-300' : 'text-amber-300'}`}>{node.state}</span>
                                        </div>
                                        <p className="mt-3 text-sm leading-6 text-zinc-200">{node.value}</p>
                                    </article>
                                    {index < model.visual.length - 1 && <div className="flex h-7 items-center justify-center text-zinc-600"><ArrowDown size={16} /></div>}
                                </div>
                            ))}
                        </div>
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
