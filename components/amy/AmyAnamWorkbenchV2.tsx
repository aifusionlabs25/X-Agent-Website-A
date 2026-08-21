'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    BookOpenText,
    BrainCircuit,
    Check,
    ChevronLeft,
    ChevronRight,
    FileText,
    GitBranch,
    Maximize2,
    Minimize2,
    Network,
    PackageSearch,
    ShieldCheck,
    Sparkles,
    X,
} from 'lucide-react';
import {
    AMY_WORKBENCH_BOUNDARY,
    buildAmyWorkbenchModel,
} from '@/lib/anam/workbench-v2';
import type {
    AmyWorkbenchFactChange,
    AmyWorkbenchTurn,
    AmyWorkbenchView,
} from '@/lib/anam/workbench-v2';

interface AmyAnamWorkbenchProps {
    isOpen: boolean;
    view: AmyWorkbenchView;
    turns: AmyWorkbenchTurn[];
    roadmapTopic?: string;
    catalogQuery?: string;
    requestedView?: AmyWorkbenchView;
    revision?: number;
    appliedChanges?: AmyWorkbenchFactChange[];
    visualSlideIndex: number;
    onVisualSlideIndexChange: (index: number) => void;
    onViewChange: (view: AmyWorkbenchView) => void;
    onClose: () => void;
}

const TABS: Array<{ id: AmyWorkbenchView; label: string; icon: typeof FileText }> = [
    { id: 'capabilities', label: 'Overview', icon: BrainCircuit },
    { id: 'notes', label: 'Notes', icon: BookOpenText },
    { id: 'brief', label: 'Brief', icon: FileText },
    { id: 'roadmap', label: 'Roadmap', icon: GitBranch },
    { id: 'visual', label: 'Visual', icon: Network },
    { id: 'catalog', label: 'Catalog', icon: PackageSearch },
];

const AMY_CAPABILITIES = [
    {
        title: 'Clarify the opportunity',
        detail: 'Listen for the business outcome, urgency, impact, stakeholders, constraints, and decision path without turning the conversation into a questionnaire.',
    },
    {
        title: 'Build working context',
        detail: 'Organize confirmed current-session facts into Live Notes, a Live Brief, a directional Roadmap, a Visual Brief, or solution categories when requested.',
    },
    {
        title: 'Hold the specialist boundary',
        detail: 'Translate technical signals into business meaning, identify what still needs validation, and stop before architecture, product selection, pricing, compliance judgment, or commitments.',
    },
    {
        title: 'Complete the session package',
        detail: 'After the session closes, support the authorized visitor recap, working visual, admin copy, and internal Insight intake workflow without exposing the private check-in address.',
    },
] as const;

const NOTE_SECTIONS = ['Organization', 'Scale', 'Environment', 'Priorities', 'Procurement', 'Constraints', 'Timing', 'Identity', 'Requested outputs', 'Decisions'] as const;

const VISUAL_SLIDE_LABELS: Record<string, string> = {
    executive_snapshot: 'Executive snapshot',
    decision_context: 'Decision context',
    evidence_and_constraints: 'Evidence + constraints',
    recommended_path: 'Recommended path',
    validation_path: 'Validation path',
    decisions_and_next_steps: 'Next decision',
};

const FACT_CHANGE_LABELS: Record<AmyWorkbenchFactChange['kind'], string> = {
    added: 'Added',
    updated: 'Updated',
    removed: 'Removed',
};
const EMPTY_FACT_CHANGES: AmyWorkbenchFactChange[] = [];

function factChangeValue(change: AmyWorkbenchFactChange): string {
    if (change.kind === 'removed') return change.previousValue ?? change.value;
    return change.value;
}

function EmptySignal() {
    return (
        <div className="flex min-h-72 flex-col items-center justify-center border border-dashed border-white/15 bg-white/[0.025] px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#ff3b91]/30 bg-[#ff3b91]/10 text-[#ff68a9]">
                <Sparkles size={20} />
            </div>
            <p className="mt-5 text-sm font-semibold text-white">Ready for the first useful signal</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-400">
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
    requestedView,
    revision = 0,
    appliedChanges = EMPTY_FACT_CHANGES,
    visualSlideIndex,
    onVisualSlideIndexChange,
    onViewChange,
    onClose,
}: AmyAnamWorkbenchProps) {
    const model = useMemo(
        () => buildAmyWorkbenchModel(turns, roadmapTopic, catalogQuery, requestedView),
        [catalogQuery, requestedView, roadmapTopic, turns],
    );
    const [isExpanded, setIsExpanded] = useState(false);
    const isVisualView = view === 'visual';
    const activeSlide = model.visualBrief.slides[visualSlideIndex] ?? model.visualBrief.slides[0];
    const displayedAppliedChanges = revision > 1 && !isVisualView ? appliedChanges.slice(0, 3) : [];

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isExpanded) setIsExpanded(false);
            if (view === 'visual' && event.key === 'ArrowLeft') onVisualSlideIndexChange(Math.max(0, visualSlideIndex - 1));
            if (view === 'visual' && event.key === 'ArrowRight') onVisualSlideIndexChange(Math.min(model.visualBrief.slides.length - 1, visualSlideIndex + 1));
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isExpanded, isOpen, model.visualBrief.slides.length, onVisualSlideIndexChange, view, visualSlideIndex]);

    useEffect(() => {
        if (!isOpen) return;
        const previousBodyOverflow = document.body.style.overflow;
        const previousRootOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousRootOverflow;
        };
    }, [isOpen]);

    const closeWorkbench = () => {
        setIsExpanded(false);
        onClose();
    };

    return (
        <aside
            aria-hidden={!isOpen}
            inert={!isOpen}
            aria-label="Amy Intelligence feature panel"
            data-expanded={isExpanded}
            className={`absolute z-[70] flex w-full flex-col overflow-hidden bg-[#0b0b0d]/[0.985] text-white shadow-[-32px_0_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl transition-[transform,opacity,width] duration-500 ease-out ${
                isExpanded
                    ? 'inset-0 max-w-none border-l-0'
                    : 'inset-y-0 right-0 border-l border-white/10 lg:w-[min(62vw,980px)]'
            } ${
                isOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'
            }`}
        >
            <header className={`relative overflow-hidden border-b border-white/10 px-5 sm:px-7 ${isVisualView ? 'pb-2 pt-3' : 'pb-4 pt-5'}`}>
                <div className="pointer-events-none absolute -right-24 -top-32 h-64 w-64 rounded-full bg-[#ff2f8a]/10 blur-3xl" />
                <div className="relative flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className={`flex flex-none items-center justify-center rounded-sm bg-[#ff2f8a] text-white shadow-[0_16px_40px_rgba(255,47,138,0.28)] ${isVisualView ? 'h-9 w-9' : 'h-11 w-11'}`}>
                            <Sparkles size={20} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff68a9]">Insight intelligence layer</p>
                            <h2 className="truncate text-xl font-semibold tracking-[-0.02em]">Amy Intelligence</h2>
                            <p className={`mt-0.5 text-zinc-400 ${isVisualView ? 'text-xs' : 'text-sm'}`}>Live planning, visuals, and solution context</p>
                        </div>
                    </div>
                    <div className="flex flex-none items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setIsExpanded((expanded) => !expanded)}
                            className="flex h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                            aria-label={isExpanded ? 'Exit full screen' : 'Open full screen'}
                            aria-pressed={isExpanded}
                            title={isExpanded ? 'Exit full screen (Esc)' : 'Open full screen'}
                        >
                            {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                            <span className="hidden sm:inline">{isExpanded ? 'Restore' : 'Full screen'}</span>
                        </button>
                        <button type="button" onClick={closeWorkbench} className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white" aria-label="Close Amy Intelligence">
                            <X size={17} />
                        </button>
                    </div>
                </div>

                <div className={`relative grid grid-cols-6 gap-px overflow-hidden rounded-sm border border-white/10 bg-white/10 ${isVisualView ? 'mt-3' : 'mt-5'}`} role="tablist" aria-label="Amy Intelligence views">
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
                                className={`flex min-w-0 flex-col items-center justify-center gap-1 bg-[#101014] px-1 text-[11px] font-semibold transition sm:flex-row sm:gap-1.5 sm:text-sm ${isVisualView ? 'min-h-11' : 'min-h-14'} ${selected ? 'bg-white text-black' : 'text-zinc-300 hover:bg-[#18181d] hover:text-white'}`}
                            >
                                <Icon size={14} />
                                <span className="truncate">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </header>

            <div className={`min-h-0 flex-1 px-5 sm:px-7 ${isVisualView ? 'flex flex-col overflow-y-auto py-3 md:overflow-hidden' : 'overflow-y-auto py-6'}`}>
                {revision > 0 && view !== 'capabilities' && (
                    <section
                        className={`${isVisualView ? 'mb-2 px-3 py-2' : 'mb-5 px-4 py-3'} border ${appliedChanges.length > 0 ? 'border-emerald-300/20 bg-emerald-300/[0.055]' : 'border-amber-300/20 bg-amber-300/[0.055]'}`}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2" role="status" aria-live="polite" aria-atomic="true">
                            <p className={`text-xs font-bold uppercase tracking-[0.14em] ${appliedChanges.length > 0 ? 'text-emerald-300' : 'text-amber-200'}`}>
                                Revision {revision} {revision === 1 ? 'built' : appliedChanges.length > 0 ? 'updated' : 'checked'}
                            </p>
                            <p className="text-xs text-zinc-400">
                                {revision === 1
                                    ? `${appliedChanges.length} supported ${appliedChanges.length === 1 ? 'fact' : 'facts'} captured`
                                    : appliedChanges.length > 0
                                    ? `${appliedChanges.length} supported ${appliedChanges.length === 1 ? 'fact' : 'facts'} changed`
                                    : 'No supported facts changed'}
                            </p>
                        </div>
                        {displayedAppliedChanges.length > 0 && (
                            <ul className="mt-3 space-y-2 text-xs leading-5 text-zinc-300" aria-label={`Supported fact changes in revision ${revision}`}>
                                {displayedAppliedChanges.map((change) => (
                                    <li key={`${change.kind}:${change.section}:${change.label}:${change.value}`} className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:gap-3">
                                        <span className="font-bold uppercase tracking-[0.1em] text-zinc-500">{FACT_CHANGE_LABELS[change.kind]}</span>
                                        <span className="line-clamp-2 sm:line-clamp-none"><strong className="text-zinc-200">{change.label}:</strong> {factChangeValue(change)}</span>
                                    </li>
                                ))}
                                {appliedChanges.length > displayedAppliedChanges.length && (
                                    <li className="text-zinc-500">+ {appliedChanges.length - displayedAppliedChanges.length} more supported changes in this revision</li>
                                )}
                            </ul>
                        )}
                    </section>
                )}
                <div className={`flex flex-wrap items-center justify-between gap-3 ${isVisualView ? 'mb-2' : 'mb-5'}`}>
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">Active lane</p>
                        <p className={`${isVisualView ? 'mt-0 text-xs' : 'mt-1 text-sm'} font-semibold text-zinc-100`}>{view === 'capabilities' ? 'Capability overview' : model.lane}</p>
                    </div>
                    <div
                        className={`inline-flex items-center gap-2 border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] ${model.status === 'live' && model.quality.level === 'grounded' ? 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300' : 'border-amber-300/20 bg-amber-300/[0.06] text-amber-200'}`}
                        aria-live="polite"
                    >
                        <span className={`h-1.5 w-1.5 rounded-full ${model.status === 'live' && model.quality.level === 'grounded' ? 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.9)]' : 'bg-amber-300'}`} />
                        {view === 'capabilities' ? 'Product tour' : model.status === 'live' ? `${model.quality.label} · ${model.signalCount} signals` : 'Listening'}
                    </div>
                </div>

                {view === 'capabilities' ? (
                    <section aria-labelledby="amy-capabilities-heading">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#ff68a9]">What Amy does</p>
                        <h3 id="amy-capabilities-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Turn a first conversation into a useful next step</h3>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">This is a product-capability overview. It is not a customer assessment, authenticated executive view, solution design, or completed handoff.</p>
                        <div className="mt-7 grid gap-4 sm:grid-cols-2">
                            {AMY_CAPABILITIES.map((capability, index) => (
                                <article key={capability.title} className="relative overflow-hidden border border-white/10 bg-white/[0.025] p-5">
                                    <span className="absolute right-4 top-4 text-xs font-bold text-zinc-600">0{index + 1}</span>
                                    <BrainCircuit size={18} className="text-[#ff68a9]" />
                                    <h4 className="mt-4 text-base font-semibold text-white">{capability.title}</h4>
                                    <p className="mt-2 text-sm leading-6 text-zinc-400">{capability.detail}</p>
                                </article>
                            ))}
                        </div>
                        <div className="mt-6 flex items-start gap-3 border border-emerald-300/20 bg-emerald-300/[0.045] p-4 text-sm leading-6 text-emerald-100/80">
                            <ShieldCheck size={16} className="mt-0.5 flex-none text-emerald-300" />
                            <span>Amy accelerates qualification and context capture. Insight specialists and responsible customer owners validate architecture, product fit, procurement, compliance, pricing, availability, and delivery.</span>
                        </div>
                    </section>
                ) : model.status === 'listening' && view !== 'catalog' ? (
                    <EmptySignal />
                ) : view === 'notes' ? (
                    <section aria-labelledby="amy-notes-heading">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#ff68a9]">Canonical session model</p>
                        <h3 id="amy-notes-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Live Notes</h3>
                        <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-400">Confirmed current-session signals. Corrections replace older wording; uncertain speech stays separate.</p>
                        <div className="mt-6 space-y-5">
                            {NOTE_SECTIONS.map((section) => {
                                const sectionFacts = model.facts.filter((fact) => fact.section === section);
                                if (!sectionFacts.length) return null;
                                return (
                                    <article key={section} className="border-t border-white/10 pt-4">
                                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-400">{section}</p>
                                        <div className="mt-3 space-y-3">
                                            {sectionFacts.map((fact) => (
                                                <div key={`${fact.label}:${fact.value}`} className="grid gap-1 sm:grid-cols-[132px_1fr] sm:gap-4">
                                                    <div className="flex items-start gap-2 text-sm text-zinc-400"><Check size={14} className="mt-0.5 flex-none text-[#ff68a9]" />{fact.label}</div>
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
                                <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-300">Applied corrections</p>
                                {model.corrections.map((item) => <p key={`${item.from}:${item.to}`} className="mt-2 text-xs text-zinc-300"><span className="line-through text-zinc-600">{item.from}</span> <span className="mx-2">→</span> {item.to}</p>)}
                            </div>
                        )}
                        {model.uncertainItems.length > 0 && (
                            <div className="mt-4 border border-amber-300/20 bg-amber-300/[0.05] p-4">
                                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-amber-300"><AlertTriangle size={14} /> Needs clarification</p>
                                {model.uncertainItems.map((item) => <p key={item} className="mt-2 text-sm leading-6 text-zinc-400">{item}</p>)}
                            </div>
                        )}
                    </section>
                ) : view === 'brief' ? (
                    <section aria-labelledby="amy-brief-heading">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#ff68a9]">Account-team working summary</p>
                        <h3 id="amy-brief-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Live Brief</h3>
                        <div className="mt-6 border border-white/10 bg-white/[0.035] p-5">
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-400">Current objective</p>
                            <p className="mt-3 text-lg leading-7 text-zinc-100">{model.brief.objective}</p>
                        </div>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <div className="border border-white/10 p-5">
                                <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-400">Environment</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {(model.brief.environment.length ? model.brief.environment : ['Still to clarify']).map((item) => <span key={item} className="border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-zinc-300">{item}</span>)}
                                </div>
                            </div>
                            <div className="border border-white/10 p-5">
                                <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-400">Priorities and guardrails</p>
                                <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
                                    {(model.brief.priorities.length ? model.brief.priorities : ['Still to clarify']).map((item) => <li key={item} className="flex gap-2"><span className="mt-2 h-1 w-1 flex-none rounded-full bg-[#ff68a9]" />{item}</li>)}
                                </ul>
                            </div>
                        </div>
                        <div className="mt-4 border-l-2 border-[#ff2f8a] bg-[#ff2f8a]/[0.065] px-5 py-4">
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#ff68a9]">Suggested next decision</p>
                            <p className="mt-2 text-sm leading-6 text-zinc-200">{model.brief.nextStep}</p>
                        </div>
                        {model.brief.openQuestions.length > 0 && (
                            <div className="mt-6">
                                <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-400">Still to clarify</p>
                                <ul className="mt-3 space-y-2 text-sm text-zinc-300">{model.brief.openQuestions.map((question) => <li key={question}>- {question}</li>)}</ul>
                            </div>
                        )}
                    </section>
                ) : view === 'roadmap' ? (
                    <section aria-labelledby="amy-roadmap-heading">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#ff68a9]">Illustrative planning sequence</p>
                        <h3 id="amy-roadmap-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{model.roadmap.title}</h3>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">{model.roadmap.outcome}</p>
                        {model.roadmap.facts.length > 0 && (
                            <div className="mt-5 flex flex-wrap gap-2">{model.roadmap.facts.slice(0, 7).map((fact) => <span key={`${fact.label}:${fact.value}`} className="border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-zinc-300"><strong className="text-zinc-400">{fact.label}:</strong> {fact.value}</span>)}</div>
                        )}
                        <div className="relative mt-8 space-y-3">
                            {model.roadmap.phases.map((phase) => (
                                <article key={phase.number} className="grid grid-cols-[40px_1fr] gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#ff2f8a]/45 bg-[#130d11] text-xs font-bold text-[#ff68a9]">{phase.number}</div>
                                    <div className="border border-white/10 bg-white/[0.025] px-5 py-4"><h4 className="text-base font-semibold text-white">{phase.title}</h4><p className="mt-1 text-sm leading-6 text-zinc-400">{phase.detail}</p></div>
                                </article>
                            ))}
                        </div>
                    </section>
                ) : view === 'visual' ? (
                    <section aria-labelledby="amy-visual-heading" className="flex min-h-0 flex-1 flex-col">
                        <div className="flex flex-none items-end justify-between gap-4">
                            <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ff68a9]">{model.quality.level === 'grounded' ? 'Conversation-grounded decision brief' : 'Developing conversation working brief'}</p><h3 id="amy-visual-heading" className="mt-0.5 text-xl font-semibold tracking-[-0.035em]">Visual Brief</h3></div>
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-400">{visualSlideIndex + 1} / {model.visualBrief.slides.length}</p>
                        </div>
                        {model.quality.level === 'developing' && model.quality.missing.length > 0 && (
                            <div className="mt-2 flex flex-none items-start gap-3 border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-xs leading-5 text-amber-100/80">
                                <AlertTriangle size={16} className="mt-0.5 flex-none text-amber-300" />
                                <span>This brief is still forming. Clarify {model.quality.missing.join(', ')} before treating it as leadership-ready.</span>
                            </div>
                        )}
                        <div className="mt-2 min-h-0 flex-1">
                            <div
                                className="relative grid h-full min-h-[300px] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden rounded-[2px] border border-[#f4c6d9] bg-[#fffaf7] px-[clamp(1rem,3vw,2.25rem)] py-[clamp(0.85rem,2vh,1.75rem)] text-[#302529] shadow-[0_26px_80px_rgba(0,0,0,0.35)]"
                                aria-live="polite"
                            >
                                <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full border border-[#e80064]/10" />
                                <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-[#ef0065]/[0.055] blur-2xl" />
                                <div className="relative flex items-center justify-between gap-4 border-b border-[#3a292f]/10 pb-2">
                                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#c50055]">{activeSlide.eyebrow}</p>
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8e7b82]">Insight · Working view</span>
                                </div>
                                <div className="relative mt-[clamp(0.7rem,1.6vh,1.35rem)] max-w-3xl">
                                    <h4 className="max-w-2xl text-[clamp(1.65rem,3vw,3rem)] [font-family:Georgia,'Times_New_Roman',serif] font-normal leading-[0.98] tracking-[-0.045em] text-[#2d2326]">{activeSlide.title}</h4>
                                    <p className="mt-3 max-w-2xl text-[clamp(0.78rem,1.3vw,0.95rem)] leading-6 text-[#6f5f64]">{activeSlide.summary}</p>
                                </div>
                                <div className="relative mt-[clamp(0.7rem,1.7vh,1.25rem)] grid min-h-0 content-start gap-2 md:grid-cols-3">
                                    {activeSlide.bullets.map((bullet, index) => (
                                        <div key={bullet} className={`${index === 0 ? 'border-[#d6005b] bg-[#d6005b] text-white' : 'border-[#eadde2] bg-white/80 text-[#56474c]'} min-h-0 border px-3 py-3 text-[clamp(0.72rem,1.15vw,0.875rem)] leading-5 shadow-[0_10px_28px_rgba(74,38,52,0.05)]`}>
                                            <span className={`mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] ${index === 0 ? 'text-pink-100' : 'text-[#c50055]'}`}>Signal {String(index + 1).padStart(2, '0')}</span>
                                            {bullet}
                                        </div>
                                    ))}
                                </div>
                                <p className="relative mt-3 border-t border-[#3a292f]/10 pt-2 text-[11px] leading-4 text-[#86747a]">{activeSlide.boundary}</p>
                            </div>
                        </div>
                        <div className="mt-2 flex flex-none items-center gap-2" aria-label="Visual Brief controls">
                            <button type="button" onClick={() => onVisualSlideIndexChange(Math.max(0, visualSlideIndex - 1))} disabled={visualSlideIndex === 0} className="inline-flex h-8 flex-none items-center gap-1 rounded-full border border-white/10 px-3 text-xs text-zinc-300 transition hover:bg-white/5 disabled:opacity-30" aria-label="Previous Visual Brief slide"><ChevronLeft size={14} /> Previous</button>
                            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto" aria-label="Visual Brief slide picker">
                            {model.visualBrief.slides.map((slide, index) => (
                                <button key={slide.id} type="button" onClick={() => onVisualSlideIndexChange(index)} aria-label={`Open slide ${index + 1}: ${VISUAL_SLIDE_LABELS[slide.id] ?? slide.eyebrow}`} aria-current={index === visualSlideIndex ? 'step' : undefined} className={`h-1.5 flex-none transition-all ${index === visualSlideIndex ? 'w-7 bg-[#ff2f8a]' : 'w-2 bg-white/20'}`} />
                            ))}
                            </div>
                            <button type="button" onClick={() => onVisualSlideIndexChange(Math.min(model.visualBrief.slides.length - 1, visualSlideIndex + 1))} disabled={visualSlideIndex === model.visualBrief.slides.length - 1} className="inline-flex h-8 flex-none items-center gap-1 rounded-full border border-white/10 px-3 text-xs text-zinc-300 transition hover:bg-white/5 disabled:opacity-30" aria-label="Next Visual Brief slide">Next <ChevronRight size={14} /></button>
                        </div>
                    </section>
                ) : (
                    <section aria-labelledby="amy-catalog-heading">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#ff68a9]">Directional solution context</p>
                        <h3 id="amy-catalog-heading" className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{model.catalog.title}</h3>
                        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">{model.catalog.summary}</p>
                        <div className="mt-7 grid gap-4 sm:grid-cols-2">
                            {model.catalog.categories.map((category, index) => (
                                <article key={category.title} className="group relative overflow-hidden border border-white/10 bg-white/[0.025] p-5 transition hover:border-[#ff2f8a]/30 hover:bg-white/[0.045]">
                                    <span className="absolute right-4 top-4 text-xs font-bold text-zinc-600">0{index + 1}</span>
                                    <PackageSearch size={18} className="text-[#ff68a9]" />
                                    <h4 className="mt-4 text-base font-semibold text-white">{category.title}</h4>
                                    <p className="mt-2 text-sm leading-6 text-zinc-400">{category.description}</p>
                                    <div className="mt-4 flex flex-wrap gap-2">{category.examples.map((example) => <span key={example} className="border border-white/10 bg-black/20 px-2 py-1 text-xs text-zinc-300">{example}</span>)}</div>
                                </article>
                            ))}
                        </div>
                        <div className="mt-6 flex items-start gap-3 border border-amber-300/20 bg-amber-300/[0.045] p-4 text-sm leading-6 text-amber-100/80"><ShieldCheck size={16} className="mt-0.5 flex-none text-amber-300" /><span>{model.catalog.boundary}</span></div>
                    </section>
                )}
            </div>

            <footer className={`items-start gap-3 border-t border-white/10 bg-black/30 px-5 text-xs text-zinc-400 sm:px-7 ${isVisualView ? 'hidden py-2 md:flex md:leading-4' : 'flex py-4 leading-5'}`}>
                <ShieldCheck size={15} className="mt-0.5 flex-none text-emerald-400" />
                <span>{AMY_WORKBENCH_BOUNDARY}</span>
            </footer>
        </aside>
    );
}
