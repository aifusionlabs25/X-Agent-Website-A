'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    AlertTriangle,
    Boxes,
    Check,
    ClipboardCheck,
    Clock3,
    House,
    MapPin,
    PackageCheck,
    Route,
    ShieldCheck,
    Truck,
    X,
} from 'lucide-react';
import {
    buildEvanMovePlan,
    EVAN_MOVE_PLANNER_BOUNDARY,
    EvanMovePlannerTurn,
    EvanMovePlannerView,
    MovePlanStop,
} from '@/lib/anam/evan-move-planner';
import type { EvanPlannerContact } from '@/lib/anam/evan-planner-contact';
import EvanRouteMap from '@/components/evan/EvanRouteMap';
import EvanSessionExit from '@/components/evan/EvanSessionExit';

interface EvanMovePlannerProps {
    isOpen: boolean;
    turns: EvanMovePlannerTurn[];
    addressStops?: MovePlanStop[] | null;
    contact?: EvanPlannerContact;
    requestedView?: EvanMovePlannerView;
    onClose: () => void;
    onExitSession?: () => void;
    isFinalizing?: boolean;
}

const TABS: Array<{ id: EvanMovePlannerView; label: string; icon: typeof Truck }> = [
    { id: 'brief', label: 'Move brief', icon: ClipboardCheck },
    { id: 'route', label: 'Route', icon: Route },
    { id: 'inventory', label: 'Move list', icon: Boxes },
    { id: 'readiness', label: 'Next steps', icon: ShieldCheck },
];

const EMPTY_COPY: Record<EvanMovePlannerView, string> = {
    brief: 'Share the move basics and Evan will assemble the working brief here.',
    route: 'Origin, destination, and additional stops will appear as they are discussed.',
    inventory: 'Services, specialty items, access factors, and care priorities will collect here.',
    readiness: 'Useful details to discuss with Evan and the Mullins team will appear here.',
};

function EmptyState({ view }: { view: EvanMovePlannerView }) {
    return (
        <div className="flex flex-col items-center justify-center border border-dashed border-[#6531c5]/25 bg-[#f5f0fb]/70 px-6 py-8 text-center">
            <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#6531c5]/15 bg-[#ffffff] shadow-[0_12px_30px_rgba(42,16,80,0.08)]">
                <Truck size={25} strokeWidth={1.6} className="text-[#5d24d6]" />
                <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-4 border-[#ffffff] bg-[#f6b93b]" />
            </div>
            <p className="font-serif text-[22px] text-[#2a1050]">Ready when you are.</p>
            <p className="mt-2 max-w-sm text-[13px] leading-5 text-[#6f5e7d]">{EMPTY_COPY[view]}</p>
        </div>
    );
}

function DetailChip({ children }: { children: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 border border-[#6531c5]/15 bg-[#ffffff] px-2 py-1 text-[12px] leading-5 font-medium text-[#43207f]">
            <Check size={14} className="text-[#f6b93b]" />
            {children}
        </span>
    );
}

function ContactCard({ contact }: { contact?: EvanPlannerContact }) {
    const fields = [
        { key: 'displayName', label: 'Name', value: contact?.displayName },
        { key: 'phone', label: 'Phone', value: contact?.phone },
        { key: 'email', label: 'Email', value: contact?.email },
        { key: 'contactPreference', label: 'Preferred contact', value: contact?.contactPreference },
        { key: 'callbackWindow', label: 'Best time to reach you', value: contact?.callbackWindow },
    ] as const;

    return (
        <section className="min-w-0 self-start border border-[#321064]/15 bg-[#fffaf0]" aria-label="Your contact details" data-testid="evan-planner-contact">
            <div className="border-b border-[#321064]/10 px-3 py-2.5">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#43207f]">Your contact details</h4>
                <p className="mt-1 text-[11px] leading-4 text-[#746180]">Optional. Tell Evan if a detail needs correcting.</p>
            </div>
            <dl className="divide-y divide-[#321064]/10 px-3">
                {fields.filter((field) => !contact?.hiddenFields.includes(field.key)).map((field) => (
                    <div key={field.key} className="py-2" data-testid={`evan-contact-${field.key}`}>
                        <dt className="text-[10px] font-bold uppercase tracking-[0.07em] text-[#7c6c89]">{field.label}</dt>
                        <dd className="mt-0.5 break-words text-[13px] font-medium leading-5 text-[#43207f] [overflow-wrap:anywhere]">
                            {field.value || <span className="font-normal text-[#8a7a95]">Not shared yet</span>}
                        </dd>
                        {field.key === 'email' && field.value && (
                            <p className="mt-0.5 text-[10px] leading-4 text-[#746180]">
                                {contact?.emailSource === 'check-in' ? 'From private check-in' : 'Heard in conversation · please confirm'}
                            </p>
                        )}
                    </div>
                ))}
            </dl>
            {contact?.proposedEmail && !contact.hiddenFields.includes('email') && (
                <div className="mx-3 mb-3 border-l-2 border-[#d99b20] pl-2 text-[11px] leading-4 text-[#6f5475]">
                    <p className="font-semibold">Spoken email change · needs confirmation</p>
                    <p className="mt-1 break-words [overflow-wrap:anywhere]">{contact.proposedEmail}</p>
                    <p className="mt-1">Your recap address has not changed.</p>
                </div>
            )}
            <p className="border-t border-[#321064]/10 px-3 py-2 text-[10px] leading-4 text-[#746180]">Working notes for Mullins to confirm. Your email recap settings stay unchanged.</p>
        </section>
    );
}

export default function EvanMovePlanner({ isOpen, turns, addressStops = null, contact, requestedView, onClose, onExitSession, isFinalizing = false }: EvanMovePlannerProps) {
    const [view, setView] = useState<EvanMovePlannerView>(requestedView ?? 'brief');
    const model = useMemo(() => buildEvanMovePlan(turns, addressStops), [turns, addressStops]);
    const briefHighlights = model.highlights.filter((signal) => signal.label.toLowerCase() !== 'route');

    useEffect(() => {
        if (!isOpen || !requestedView) return undefined;
        const frame = window.requestAnimationFrame(() => setView(requestedView));
        return () => window.cancelAnimationFrame(frame);
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
                    className="fixed inset-0 z-40 overflow-hidden border-l border-[#2a1050]/15 bg-[#faf7fd] text-[#321064] shadow-[-28px_0_90px_rgba(0,0,0,0.34)] lg:left-auto lg:w-[min(58vw,860px)]"
                    aria-label="Evan live move planner"
                    data-testid="evan-move-planner"
                >
                    <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:repeating-linear-gradient(0deg,#5d24d6_0,#5d24d6_1px,transparent_1px,transparent_6px)]" />
                    <div className="relative flex h-full min-h-0 flex-col">
                        <header className="flex-none border-b border-[#321064]/15 bg-[#2a1050] px-4 py-3 text-[#fffdf7] sm:px-5" data-testid="evan-planner-header">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white p-1.5">
                                        <Image
                                            src="/agents/thumbnails/Evan Mullins Moving logo.png"
                                            alt="Mullins Moving"
                                            width={64}
                                            height={64}
                                            className="h-full w-full object-contain"
                                        />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#ffdc8a]">Mullins Moving</p>
                                        <h2 className="truncate font-serif text-xl leading-tight sm:text-2xl">Live Move Planner</h2>
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
                            <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/10 pt-2 text-[10px] leading-4">
                                <span className="inline-flex items-center gap-2 font-semibold uppercase tracking-[0.09em] text-white/70">
                                    <span className={`h-2 w-2 rounded-full ${model.status === 'building' ? 'animate-pulse bg-[#ffc857]' : 'bg-white/35'}`} />
                                    {model.status === 'building' ? 'Building from this conversation' : 'Listening for move details'}
                                </span>
                                <span className="hidden text-white/45 sm:inline">No quote or booking created</span>
                            </div>
                        </header>

                        <nav className="flex flex-none overflow-x-auto border-b border-[#321064]/15 bg-[#eee7f8] px-2 sm:px-3" aria-label="Move Planner views">
                            {TABS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setView(id)}
                                    aria-pressed={view === id}
                                    className={`relative inline-flex min-h-11 min-w-max items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.09em] transition ${view === id ? 'text-[#321064]' : 'text-[#776886] hover:text-[#6230bb]'}`}
                                >
                                    <Icon size={15} />
                                    {label}
                                    {view === id && <motion.span layoutId="evan-planner-tab" className="absolute inset-x-3 bottom-0 h-[3px] bg-[#f6b93b]" />}
                                </button>
                            ))}
                        </nav>

                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5" data-testid="evan-planner-content">
                            {model.status === 'listening' && view === 'readiness' ? <EmptyState view={view} /> : (
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={view}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -6 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        {view === 'brief' && (
                                            <section data-testid="evan-planner-brief-view">
                                                <div className="flex items-start gap-3 border border-[#321064]/15 bg-[#ffffff] px-3 py-2.5">
                                                    <Route size={18} className="mt-0.5 flex-none text-[#d99b20]" />
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7540cf]">Route at a glance</p>
                                                        <p className="mt-0.5 break-words font-serif text-[22px] leading-7 text-[#2a1050]">
                                                            {model.stops.length ? model.stops.map((stop) => stop.city).join(' \u2192 ') : 'Where are you moving from and to?'}
                                                        </p>
                                                        {model.possibleStops.length > 0 && (
                                                            <p className="mt-1 text-[12px] leading-5 text-[#7b5714]" data-testid="evan-possible-stops">
                                                                <span className="font-semibold">Still considering: </span>
                                                                {model.possibleStops.map((stop) => `${stop.label || 'Stop'} in ${stop.city}`).join('; ')}.
                                                                {' '}Not added to your route.
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>

                                                <h3 className="mt-4 font-serif text-[24px] leading-8">Working move brief</h3>
                                                <p className="mt-0.5 text-[12px] leading-5 text-[#746180]">Your details take shape as you talk. You can correct or add to them at any time.</p>
                                                <div className="mt-3 grid items-start gap-3 sm:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
                                                    <div className="min-w-0">
                                                        <dl className="divide-y divide-[#321064]/10 border border-[#321064]/15 bg-[#ffffff]">
                                                            {briefHighlights.length ? briefHighlights.map((signal) => (
                                                                <div key={signal.label} className="grid gap-0.5 px-3 py-2.5 sm:grid-cols-[100px_minmax(0,1fr)] sm:gap-3">
                                                                    <dt className="text-[10px] font-bold uppercase leading-4 tracking-[0.08em] text-[#7c6c89]">{signal.label}</dt>
                                                                    <dd className="break-words text-[13px] font-medium leading-5 text-[#43207f]">{signal.value}</dd>
                                                                </div>
                                                            )) : <div className="px-3 py-4 text-[13px] leading-5 text-[#746180]"><dt className="sr-only">Move details</dt><dd>Tell Evan about your move date, home, and any help you need. Those details will appear here.</dd></div>}
                                                        </dl>
                                                        {model.carePriorities.length > 0 && (
                                                            <div className="mt-3 border-l-2 border-[#f6b93b] bg-[#eee5fb] px-3 py-2.5">
                                                                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6d35c5]">What matters to you</p>
                                                                <div className="mt-2 flex flex-wrap gap-1.5">{model.carePriorities.map((item) => <DetailChip key={item}>{item}</DetailChip>)}</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <ContactCard contact={contact} />
                                                </div>
                                            </section>
                                        )}

                                        {view === 'route' && (
                                            <section data-testid="evan-planner-route-view">
                                                <h3 className="font-serif text-xl leading-7">Move route</h3>
                                                {model.possibleStops.length > 0 ? (
                                                    <p className="mt-1 text-xs leading-4 text-[#7b5714]" data-testid="evan-possible-stops">
                                                        <span className="font-semibold">Possible, not on this route: </span>
                                                        {model.possibleStops.map((stop) => `${stop.label || 'stop'} in ${stop.city}`).join('; ')}.
                                                    </p>
                                                ) : <p className="mt-1 text-xs leading-4 text-[#746180]">{model.stops.length ? 'Live planning pins. City locations stay approximate until street addresses are confirmed.' : 'Tell Evan your pickup and destination. Your locations will appear here.'}</p>}

                                                <EvanRouteMap stops={model.stops} />

                                                {model.stops.length > 0 ? <div className="relative mt-5 ml-3 border-l-2 border-dashed border-[#5d24d6]/30 pl-8">
                                                    {model.stops.map((stop, index) => (
                                                        <div key={`${stop.kind}-${stop.displayAddress ?? stop.address ?? stop.city}-${index}`} className="relative pb-8 last:pb-0">
                                                            <div className={`absolute -left-[45px] top-0 flex h-7 w-7 items-center justify-center rounded-full border-4 border-[#faf7fd] text-xs font-bold text-white ${stop.kind === 'Origin' ? 'bg-[#5d24d6]' : stop.kind === 'Destination' ? 'bg-[#f6b93b]' : 'bg-[#9b6ee5]'}`}>
                                                                {index + 1}
                                                            </div>
                                                            <div className="border border-[#321064]/15 bg-[#ffffff] p-4 shadow-[0_8px_24px_rgba(31,72,50,0.07)]">
                                                                <div className="flex items-start justify-between gap-4">
                                                                    <div className="min-w-0">
                                                                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7f708b]">{stop.kind}{stop.label ? ` · ${stop.label}` : ''}</p>
                                                                        <p className="mt-1 font-serif text-2xl text-[#2a1050]">{stop.city}</p>
                                                                        {stop.displayAddress && <p className="mt-2 text-sm font-semibold leading-5 text-[#5d4670]">{stop.displayAddress}</p>}
                                                                        <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${stop.precision === 'address' ? 'bg-[#e8f7ed] text-[#237644]' : stop.precision === 'address-range' ? 'bg-[#fff3d5] text-[#8b6414]' : stop.precision === 'unresolved' ? 'bg-[#fde8e8] text-[#a33d3d]' : 'bg-[#eee7f8] text-[#6d35c5]'}`}>
                                                                            {stop.precision === 'address' ? <Check size={11} /> : <MapPin size={11} />}
                                                                            {stop.precision === 'address' ? 'Exact address pin' : stop.precision === 'address-range' ? 'Street-range pin' : stop.precision === 'unresolved' ? 'Address needs confirmation' : 'City-level pin'}
                                                                        </span>
                                                                    </div>
                                                                    <MapPin size={20} className="flex-none text-[#d99b20]" />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div> : null}
                                            </section>
                                        )}

                                        {view === 'inventory' && (
                                            <section data-testid="evan-planner-inventory-view">
                                                <h3 className="font-serif text-[24px] leading-8">Your move, at a glance</h3>
                                                <p className="mt-0.5 text-[12px] leading-5 text-[#746180]">What you have discussed with Evan so far.</p>
                                                {model.packingPlan && <p className="mt-2 border-l-2 border-[#f6b93b] bg-[#fffaf0] px-3 py-2 text-[12px] leading-5 text-[#43207f]" data-testid="evan-packing-plan">{model.packingPlan}</p>}
                                                <div className="mt-3 grid items-start gap-3 sm:grid-cols-2">
                                                    {[
                                                        { title: 'Help requested', items: model.services, icon: PackageCheck },
                                                        { title: 'Special handling', items: model.specialtyItems, icon: Boxes },
                                                        { title: 'Getting in and out', items: model.accessFactors, icon: House },
                                                        { title: 'What matters to you', items: model.carePriorities, icon: ShieldCheck },
                                                    ].map(({ title, items, icon: Icon }) => (
                                                        <div key={title} className="min-w-0 border border-[#321064]/15 bg-[#ffffff] px-3 py-2.5">
                                                            <div className="flex items-center gap-2 border-b border-[#321064]/10 pb-2">
                                                                <Icon size={16} className="flex-none text-[#d99b20]" />
                                                                <h4 className="text-[10px] font-bold uppercase leading-4 tracking-[0.1em] text-[#43207f]">{title}</h4>
                                                            </div>
                                                            {items.length ? (
                                                                <ul className="mt-2 space-y-1.5">{items.map((item) => (
                                                                    <li key={item} className="flex items-start gap-2 text-[13px] leading-5 text-[#685577]"><Check size={13} className="mt-1 flex-none text-[#d99b20]" />{item}</li>
                                                                ))}</ul>
                                                            ) : <p className="mt-2 text-[12px] leading-5 text-[#8a7a95]">Nothing noted yet.</p>}
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="mt-4 border border-[#d99b20]/30 bg-[#fffaf0] px-3 py-3" data-testid="evan-planner-service-options">
                                                    <h4 className="font-serif text-[20px] leading-6 text-[#2a1050]">Ask Mullins about</h4>
                                                    <p className="mt-1 text-[11px] leading-4 text-[#746180]">Options to discuss—not added to your move. The team confirms availability and pricing.</p>
                                                    <ul className="mt-3 grid gap-x-4 gap-y-2 text-[12px] leading-5 text-[#43207f] sm:grid-cols-2">
                                                        <li><span className="font-semibold">Packing &amp; unpacking</span><br />Help with selected rooms or the whole home.</li>
                                                        <li><span className="font-semibold">Loading &amp; unloading</span><br />Labor for your truck or storage container.</li>
                                                        <li><span className="font-semibold">Specialty-item care</span><br />Discuss fragile, valuable, or oversized items.</li>
                                                        <li><span className="font-semibold">Boxes, tape &amp; packing supplies</span><br />Availability to confirm with Mullins.</li>
                                                    </ul>
                                                </div>
                                            </section>
                                        )}

                                        {view === 'readiness' && (
                                            <section data-testid="evan-planner-next-steps-view">
                                                <h3 className="font-serif text-[24px] leading-8">Let’s plan the next step</h3>
                                                <p className="mt-1 text-[12px] leading-5 text-[#746180]">A few useful details to talk through—not a checklist you have to finish during this call.</p>

                                                <div className="mt-3 border border-[#321064]/15 bg-white">
                                                    <h4 className="border-b border-[#321064]/10 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#43207f]">Details to talk through</h4>
                                                    <ul className="divide-y divide-[#321064]/10">
                                                        {model.openItems.length ? model.openItems.map((item) => (
                                                            <li key={item} className="flex items-start gap-2.5 px-3 py-2.5">
                                                                <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[#d99b20]" />
                                                                <p className="min-w-0 text-[13px] leading-5 text-[#5a3d75]">{item}</p>
                                                            </li>
                                                        )) : (
                                                            <li className="px-3 py-3 text-[13px] leading-5 text-[#5a3d75]">Review your move brief with Evan and share anything else you would like the Mullins team to know.</li>
                                                        )}
                                                    </ul>
                                                </div>

                                                <div className="mt-3 flex items-start gap-3 border-l-2 border-[#f6b93b] bg-[#eee5fb] px-3 py-3">
                                                    <ShieldCheck size={18} className="mt-0.5 flex-none text-[#6d35c5]" />
                                                    <div>
                                                        <h4 className="text-[12px] font-semibold text-[#43207f]">Mullins confirms the details</h4>
                                                        <p className="mt-1 text-[12px] leading-5 text-[#746180]">The team can discuss an estimate or walkthrough and review pricing, availability, and special handling. Nothing is booked by this planner.</p>
                                                    </div>
                                                </div>

                                                {model.uncertainties.length > 0 && (
                                                    <div className="mt-3 border border-[#d9a62f]/35 bg-[#fff4d8] px-3 py-2.5">
                                                        <div className="flex items-center gap-2 text-[#6d35c5]"><AlertTriangle size={15} /><p className="text-[10px] font-bold uppercase tracking-[0.1em]">Still deciding? That’s okay.</p></div>
                                                        <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-[#6f5475]">{model.uncertainties.map((item) => <li key={item}>&quot;{item}&quot;</li>)}</ul>
                                                    </div>
                                                )}
                                            </section>
                                        )}
                                    </motion.div>
                                </AnimatePresence>
                            )}
                        </div>

                        <footer className="flex-none border-t border-[#321064]/15 bg-[#eee7f8] px-4 py-2 sm:px-5" data-testid="evan-planner-footer">
                            {onExitSession && (
                                <div className="mb-2 lg:hidden">
                                    <EvanSessionExit placement="planner" onExit={onExitSession} disabled={isFinalizing} />
                                </div>
                            )}
                            <div className="flex items-start gap-2 text-[10px] leading-4 text-[#746180]">
                                <Clock3 size={14} className="mt-0.5 flex-none text-[#7540cf]" />
                                <span>{EVAN_MOVE_PLANNER_BOUNDARY}</span>
                            </div>
                        </footer>
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    );
}
