'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    AlertTriangle,
    Boxes,
    Check,
    ChevronRight,
    ClipboardCheck,
    Clock3,
    House,
    MapPin,
    PackageCheck,
    Route,
    ShieldCheck,
    Sparkles,
    Truck,
    X,
} from 'lucide-react';
import {
    buildEvanMovePlan,
    EVAN_MOVE_PLANNER_BOUNDARY,
    EvanMovePlannerTurn,
    EvanMovePlannerView,
} from '@/lib/anam/evan-move-planner';

interface EvanMovePlannerProps {
    isOpen: boolean;
    turns: EvanMovePlannerTurn[];
    requestedView?: EvanMovePlannerView;
    onClose: () => void;
}

const TABS: Array<{ id: EvanMovePlannerView; label: string; icon: typeof Truck }> = [
    { id: 'brief', label: 'Move brief', icon: ClipboardCheck },
    { id: 'route', label: 'Route', icon: Route },
    { id: 'inventory', label: 'Move list', icon: Boxes },
    { id: 'readiness', label: 'Readiness', icon: ShieldCheck },
];

const EMPTY_COPY: Record<EvanMovePlannerView, string> = {
    brief: 'Share the move basics and Evan will assemble the working brief here.',
    route: 'Origin, destination, and additional stops will appear as they are discussed.',
    inventory: 'Services, specialty items, access factors, and care priorities will collect here.',
    readiness: 'The planner will identify captured signals and useful follow-up questions.',
};

function EmptyState({ view }: { view: EvanMovePlannerView }) {
    return (
        <div className="flex min-h-[330px] flex-col items-center justify-center border border-dashed border-[#234c38]/25 bg-[#f4f0e7]/70 px-8 text-center">
            <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[#234c38]/15 bg-[#fffdf8] shadow-[0_18px_60px_rgba(25,59,42,0.12)]">
                <Truck size={32} strokeWidth={1.6} className="text-[#1e4c35]" />
                <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-4 border-[#fffdf8] bg-[#e76f31]" />
            </div>
            <p className="font-serif text-2xl text-[#173825]">Ready when you are.</p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-[#587064]">{EMPTY_COPY[view]}</p>
        </div>
    );
}

function DetailChip({ children }: { children: string }) {
    return (
        <span className="inline-flex items-center gap-2 border border-[#1d4a34]/15 bg-[#fffdf8] px-3 py-2 text-sm font-medium text-[#244c39] shadow-[0_5px_16px_rgba(31,72,50,0.06)]">
            <Check size={14} className="text-[#e76f31]" />
            {children}
        </span>
    );
}

export default function EvanMovePlanner({ isOpen, turns, requestedView, onClose }: EvanMovePlannerProps) {
    const [view, setView] = useState<EvanMovePlannerView>('brief');
    const model = useMemo(() => buildEvanMovePlan(turns), [turns]);

    useEffect(() => {
        if (isOpen && requestedView) setView(requestedView);
    }, [isOpen, requestedView]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [isOpen, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.aside
                    initial={{ opacity: 0, x: 90 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 90 }}
                    transition={{ type: 'spring', damping: 27, stiffness: 250 }}
                    className="fixed inset-0 z-40 overflow-hidden border-l border-[#173825]/15 bg-[#f8f4eb] text-[#183a28] shadow-[-28px_0_90px_rgba(0,0,0,0.34)] lg:left-auto lg:w-[min(58vw,860px)]"
                    aria-label="Evan live move planner"
                    data-testid="evan-move-planner"
                >
                    <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:repeating-linear-gradient(0deg,#173825_0,#173825_1px,transparent_1px,transparent_6px)]" />
                    <div className="relative flex h-full flex-col">
                        <header className="flex-none border-b border-[#183a28]/15 bg-[#173825] px-5 py-4 text-[#fffaf0] sm:px-7 sm:py-5">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white p-1.5">
                                        <Image
                                            src="/agents/thumbnails/Evan Mullins Moving logo.png"
                                            alt="Mullins Moving"
                                            width={64}
                                            height={64}
                                            className="h-full w-full object-contain"
                                        />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#efaa79]">Mullins Moving</p>
                                        <h2 className="truncate font-serif text-2xl leading-tight sm:text-3xl">Live Move Planner</h2>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/75 transition hover:border-white/35 hover:bg-white/10 hover:text-white"
                                    aria-label="Close Move Planner"
                                >
                                    <X size={19} />
                                </button>
                            </div>
                            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-xs">
                                <span className="inline-flex items-center gap-2 font-semibold uppercase tracking-[0.14em] text-white/70">
                                    <span className={`h-2 w-2 rounded-full ${model.status === 'building' ? 'animate-pulse bg-[#f18a50]' : 'bg-white/35'}`} />
                                    {model.status === 'building' ? 'Building from this conversation' : 'Listening for move details'}
                                </span>
                                <span className="hidden text-white/45 sm:inline">No quote or booking created</span>
                            </div>
                        </header>

                        <nav className="flex flex-none overflow-x-auto border-b border-[#183a28]/15 bg-[#efe8db] px-3 sm:px-5" aria-label="Move Planner views">
                            {TABS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setView(id)}
                                    className={`relative inline-flex min-w-max items-center gap-2 px-3 py-4 text-xs font-bold uppercase tracking-[0.11em] transition sm:px-4 ${view === id ? 'text-[#183a28]' : 'text-[#6f7e75] hover:text-[#315743]'}`}
                                >
                                    <Icon size={15} />
                                    {label}
                                    {view === id && <motion.span layoutId="evan-planner-tab" className="absolute inset-x-3 bottom-0 h-[3px] bg-[#e76f31]" />}
                                </button>
                            ))}
                        </nav>

                        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
                            {model.status === 'listening' ? <EmptyState view={view} /> : (
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={view}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        {view === 'brief' && (
                                            <section>
                                                <div className="grid gap-3 sm:grid-cols-3">
                                                    <div className="border border-[#183a28]/15 bg-[#fffdf8] p-4 shadow-[0_8px_25px_rgba(31,72,50,0.07)] sm:col-span-2">
                                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#c95f2b]">Route at a glance</p>
                                                        <p className="mt-2 font-serif text-2xl leading-tight text-[#173825]">
                                                            {model.stops.length ? model.stops.map((stop) => stop.city).join(' \u2192 ') : 'Route still being clarified'}
                                                        </p>
                                                    </div>
                                                    <div className="border border-[#183a28]/15 bg-[#e76f31] p-4 text-white shadow-[0_8px_25px_rgba(139,63,25,0.2)]">
                                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/75">Brief completeness</p>
                                                        <p className="mt-1 font-serif text-4xl">{model.readiness}%</p>
                                                        <p className="mt-1 text-xs text-white/75">{model.capturedCategories} of {model.totalCategories} planning areas</p>
                                                    </div>
                                                </div>

                                                <div className="mt-7 flex items-end justify-between gap-4">
                                                    <div>
                                                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c95f2b]">What Evan heard</p>
                                                        <h3 className="mt-1 font-serif text-3xl">Working move brief</h3>
                                                    </div>
                                                    <Sparkles size={22} className="mb-1 text-[#d66b35]" />
                                                </div>
                                                <div className="mt-4 divide-y divide-[#183a28]/10 border-y border-[#183a28]/15 bg-[#fffdf8]">
                                                    {model.highlights.length ? model.highlights.map((signal) => (
                                                        <div key={signal.label} className="grid gap-1 px-4 py-4 sm:grid-cols-[150px_1fr] sm:gap-5">
                                                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#758177]">{signal.label}</p>
                                                            <p className="text-sm font-semibold leading-6 text-[#244b38]">{signal.value}</p>
                                                        </div>
                                                    )) : <p className="p-5 text-sm text-[#65766b]">The working brief will fill in as move details are discussed.</p>}
                                                </div>

                                                {model.carePriorities.length > 0 && (
                                                    <div className="mt-6 border-l-4 border-[#e76f31] bg-[#f2e6d8] p-4">
                                                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#9c4a26]">Customer care priorities</p>
                                                        <div className="mt-3 flex flex-wrap gap-2">{model.carePriorities.map((item) => <DetailChip key={item}>{item}</DetailChip>)}</div>
                                                    </div>
                                                )}
                                            </section>
                                        )}

                                        {view === 'route' && (
                                            <section>
                                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c95f2b]">Pickup to placement</p>
                                                <h3 className="mt-1 font-serif text-3xl">Move route</h3>
                                                <p className="mt-2 text-sm leading-6 text-[#63766a]">Stops appear in the order mentioned. Mullins staff will confirm addresses, access, and routing.</p>

                                                <div className="relative mt-7 ml-3 border-l-2 border-dashed border-[#24543b]/30 pl-8">
                                                    {model.stops.length ? model.stops.map((stop, index) => (
                                                        <div key={`${stop.city}-${stop.kind}`} className="relative pb-8 last:pb-0">
                                                            <div className={`absolute -left-[45px] top-0 flex h-7 w-7 items-center justify-center rounded-full border-4 border-[#f8f4eb] text-xs font-bold text-white ${stop.kind === 'Origin' ? 'bg-[#24543b]' : stop.kind === 'Destination' ? 'bg-[#e76f31]' : 'bg-[#8b9d6d]'}`}>
                                                                {index + 1}
                                                            </div>
                                                            <div className="border border-[#183a28]/15 bg-[#fffdf8] p-4 shadow-[0_8px_24px_rgba(31,72,50,0.07)]">
                                                                <div className="flex items-start justify-between gap-4">
                                                                    <div>
                                                                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#78857b]">{stop.kind}</p>
                                                                        <p className="mt-1 font-serif text-2xl text-[#173825]">{stop.city}</p>
                                                                    </div>
                                                                    <MapPin size={20} className="text-[#d76b34]" />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )) : <EmptyState view="route" />}
                                                </div>
                                            </section>
                                        )}

                                        {view === 'inventory' && (
                                            <section>
                                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c95f2b]">Scope signals</p>
                                                <h3 className="mt-1 font-serif text-3xl">Move list</h3>
                                                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                                                    {[
                                                        { title: 'Requested support', items: model.services, icon: PackageCheck },
                                                        { title: 'Special handling', items: model.specialtyItems, icon: Boxes },
                                                        { title: 'Access factors', items: model.accessFactors, icon: House },
                                                        { title: 'Care priorities', items: model.carePriorities, icon: ShieldCheck },
                                                    ].map(({ title, items, icon: Icon }) => (
                                                        <div key={title} className="min-h-44 border border-[#183a28]/15 bg-[#fffdf8] p-5 shadow-[0_8px_24px_rgba(31,72,50,0.06)]">
                                                            <div className="flex items-center gap-3 border-b border-[#183a28]/10 pb-3">
                                                                <Icon size={18} className="text-[#d96c35]" />
                                                                <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-[#274c39]">{title}</h4>
                                                            </div>
                                                            {items.length ? (
                                                                <ul className="mt-4 space-y-3">{items.map((item) => (
                                                                    <li key={item} className="flex items-start gap-2 text-sm leading-5 text-[#526a5b]"><Check size={14} className="mt-0.5 flex-none text-[#d96c35]" />{item}</li>
                                                                ))}</ul>
                                                            ) : <p className="mt-4 text-sm leading-6 text-[#879188]">Not discussed yet.</p>}
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>
                                        )}

                                        {view === 'readiness' && (
                                            <section>
                                                <div className="flex flex-col gap-5 border border-[#183a28]/15 bg-[#173825] p-5 text-white shadow-[0_16px_50px_rgba(24,58,40,0.22)] sm:flex-row sm:items-center sm:justify-between">
                                                    <div>
                                                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#efaa79]">Intake readiness</p>
                                                        <h3 className="mt-1 font-serif text-3xl">{model.readiness}% complete</h3>
                                                        <p className="mt-2 max-w-md text-sm leading-6 text-white/65">A useful working measure - not a quote, booking, or operational approval.</p>
                                                    </div>
                                                    <div className="relative h-24 w-24 flex-none rounded-full" style={{ background: `conic-gradient(#ed7a3e ${model.readiness}%, rgba(255,255,255,.12) 0)` }}>
                                                        <div className="absolute inset-[7px] flex items-center justify-center rounded-full bg-[#173825] font-serif text-2xl">{model.capturedCategories}/{model.totalCategories}</div>
                                                    </div>
                                                </div>

                                                <div className="mt-7">
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c95f2b]">Useful next details</p>
                                                    <h3 className="mt-1 font-serif text-3xl">Before Mullins reviews</h3>
                                                    <div className="mt-4 space-y-3">
                                                        {model.openItems.length ? model.openItems.map((item, index) => (
                                                            <div key={item} className="flex items-start gap-4 border border-[#183a28]/15 bg-[#fffdf8] p-4 shadow-[0_7px_22px_rgba(31,72,50,0.06)]">
                                                                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#efe5d5] text-xs font-bold text-[#9b4a26]">{index + 1}</span>
                                                                <p className="flex-1 text-sm font-medium leading-6 text-[#355442]">{item}</p>
                                                                <ChevronRight size={16} className="mt-1 flex-none text-[#b2b9b3]" />
                                                            </div>
                                                        )) : (
                                                            <div className="flex items-center gap-3 border border-[#2e694a]/20 bg-[#e6efe5] p-5 text-sm font-semibold text-[#24543b]">
                                                                <ClipboardCheck size={19} /> The working brief has the core planning signals for staff review.
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {model.uncertainties.length > 0 && (
                                                    <div className="mt-6 border border-[#cf8f56]/35 bg-[#fff1dc] p-4">
                                                        <div className="flex items-center gap-2 text-[#9b4a26]"><AlertTriangle size={17} /><p className="text-xs font-bold uppercase tracking-[0.14em]">Customer-stated uncertainty</p></div>
                                                        <ul className="mt-3 space-y-2 text-sm leading-6 text-[#765842]">{model.uncertainties.map((item) => <li key={item}>&quot;{item}&quot;</li>)}</ul>
                                                    </div>
                                                )}
                                            </section>
                                        )}
                                    </motion.div>
                                </AnimatePresence>
                            )}
                        </div>

                        <footer className="flex-none border-t border-[#183a28]/15 bg-[#efe8db] px-5 py-3 sm:px-7">
                            <div className="flex items-start gap-2 text-[11px] leading-5 text-[#66786c]">
                                <Clock3 size={14} className="mt-0.5 flex-none text-[#c95f2b]" />
                                <span>{EVAN_MOVE_PLANNER_BOUNDARY}</span>
                            </div>
                        </footer>
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    );
}
