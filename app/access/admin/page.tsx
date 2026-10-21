'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AccessRecord, AccessCapability } from '@/lib/access/grants';

type Agent = { slug: string; name: string; role: string };
const LABELS: Record<AccessCapability, string> = { conversation: 'Conversations', meeting: 'Meeting invitations', actions: 'Email and external actions' };
const field = 'w-full rounded-xl border border-white/15 bg-zinc-950 px-4 py-3 text-sm text-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20';

export default function AccessAdminPage() {
    const [records, setRecords] = useState<(AccessRecord & { notificationStatus?: string })[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [disabledAgents, setDisabledAgents] = useState<string[]>([]);
    const [preview, setPreview] = useState(false);
    const [loading, setLoading] = useState(true);
    const [forbidden, setForbidden] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [saving, setSaving] = useState(false);
    const [email, setEmail] = useState('');
    const [agent, setAgent] = useState('');
    const [days, setDays] = useState(7);
    const [capabilities, setCapabilities] = useState<AccessCapability[]>(['conversation']);
    const [checkedAt, setCheckedAt] = useState(0);
    const openedRequest = useRef(false);
    const controller = useRef<AbortController | null>(null);

    const refresh = useCallback(() => {
        controller.current?.abort();
        const active = new AbortController();
        controller.current = active;
        return fetch('/api/access/admin', { cache: 'no-store', credentials: 'same-origin', signal: active.signal }).then(async response => {
            const data = await response.json();
            if (active.signal.aborted) return;
            setError('');
            if (!response.ok) { setForbidden([401, 403].includes(response.status)); throw new Error(data.error ?? 'Access controls are unavailable'); }
            if (!Array.isArray(data.records) || !Array.isArray(data.agents) || !Array.isArray(data.disabledAgents)) {
                throw new Error('Access controls could not be loaded. Please refresh.');
            }
            setPreview(data.preview === true);
            setForbidden(false); setRecords(data.records); setAgents(data.agents); setDisabledAgents(data.disabledAgents);
            setCheckedAt(Date.now());
            const requestId = new URLSearchParams(window.location.search).get('request');
            const selected = data.records.find((record: AccessRecord) => record.notificationId === requestId);
            if (selected && !openedRequest.current) {
                openedRequest.current = true;
                setEmail(selected.email); setAgent(selected.agent);
                setCapabilities([...new Set<AccessCapability>([...selected.capabilities, ...(selected.requestedCapabilities ?? [])])]);
                setNotice('Request opened from email. Review permissions and expiry before saving.');
            }
            setAgent(current => current || data.agents[0]?.slug || '');
        }).catch(caught => {
            if (active.signal.aborted) return;
            setRecords([]); setAgents([]); setDisabledAgents([]);
            setError(caught instanceof Error ? caught.message : 'Access controls are unavailable');
        }).finally(() => { if (!active.signal.aborted) setLoading(false); });
    }, []);
    useEffect(() => { void refresh(); return () => controller.current?.abort(); }, [refresh]);

    async function update(body: Record<string, unknown>, message: string) {
        setSaving(true); setError(''); setNotice('');
        try {
            const response = await fetch('/api/access/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? 'The change could not be saved');
            setNotice(message + (data.notification === 'pending' ? ' Email delivery is pending. Use Retry email below.' : data.notification === 'sent' ? ' Notification emails were accepted for delivery.' : '')); await refresh();
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'The change could not be saved'); }
        finally { setSaving(false); }
    }
    async function approve(event: FormEvent) {
        event.preventDefault();
        await update({ operation: 'approve', email, agent, capabilities, expiresAt: new Date(Date.now() + days * 86400000).toISOString() }, 'Access saved. The tester can sign in with this email address.');
    }
    function review(record: AccessRecord) {
        setEmail(record.email); setAgent(record.agent);
        setCapabilities([...new Set([...record.capabilities, ...(record.requestedCapabilities ?? [])])]);
        setNotice('Review the permissions and expiry, then save access.');
        document.getElementById('access-editor')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
        document.getElementById('access-editor-email')?.focus({ preventScroll: true });
    }

    return <main className="min-h-screen bg-[#090b12] px-5 pb-24 pt-28 text-zinc-100 sm:px-10">
        <div className="mx-auto max-w-6xl">
            <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"><ArrowLeft size={16} /> Back to X Agents</Link>
            <Link href="/access/owner" className="mb-6 ml-6 inline-block text-sm text-indigo-300">Owner sign-in &amp; passkeys</Link>
            <header className="mb-9 flex flex-wrap items-end justify-between gap-5">
                <div><p className="mb-3 text-xs font-semibold uppercase tracking-[.2em] text-indigo-300">Private pilot · Owner controls</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Decide who gets access.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Approve a person for specific agents. Sign-in verifies their email; these permissions determine what they can do.</p></div>
                <button onClick={() => { setLoading(true); void refresh(); }} disabled={loading || saving} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm hover:bg-white/5 disabled:opacity-50"><RefreshCw size={15} /> Refresh</button>
            </header>
            {error && <p role="alert" className="mb-6 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>}
            {notice && <p role="status" className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100"><Check size={16} />{notice}</p>}
            {loading ? <p className="py-12 text-zinc-400">Loading access controls…</p> : forbidden ? <div className="rounded-2xl border border-white/10 bg-white/[.03] p-8"><LockKeyhole className="mb-4 text-indigo-300" /><h2 className="text-xl font-semibold">Owner sign-in required</h2><p className="my-4 text-sm text-zinc-400">Use your owner passkey or email to manage approvals.</p><Link href={`/access/owner?returnTo=${encodeURIComponent(typeof window === 'undefined' ? '/access/admin' : window.location.pathname + window.location.search)}`} className="inline-block rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold hover:bg-indigo-400">Sign in</Link></div> : agents.length > 0 && <>
                {preview && <section className="mb-8 rounded-xl border border-amber-300/25 bg-amber-300/10 p-5">
                    <h2 className="font-semibold text-amber-100">Preview mailbox test</h2>
                    <p className="my-3 text-sm text-zinc-300">All notification copies go to the owner inbox. This sample visitor is fictional and has no live-site access. Choose an agent below, then send a sample request. Open the email to review and approve it.</p>
                    <button disabled={saving} onClick={() => void update({ operation: 'preview-request', agent }, 'Sample request saved.')} className="rounded-lg border border-amber-200/30 px-4 py-2 text-sm text-amber-100">Send sample request</button>
                </section>}
                <section id="access-editor" className="mb-10 grid scroll-mt-28 gap-8 rounded-2xl border border-white/10 bg-white/[.025] p-6 md:grid-cols-[.75fr_1.25fr] md:p-8">
                    <div><ShieldCheck className="mb-4 text-indigo-300" /><h2 className="text-xl font-semibold">Approve or update a tester</h2><p className="mt-3 text-sm leading-6 text-zinc-400">You can approve someone before they request access. They sign in using the exact email below. A decision email is sent to the visitor and a confirmation to the owner inbox.</p><p className="mt-4 text-sm leading-6 text-zinc-400">Revocation blocks new sessions and protected requests. A conversation or meeting already running may continue until it ends.</p></div>
                    <form onSubmit={approve} className="grid gap-5 sm:grid-cols-2">
                        <label className="space-y-2 text-sm sm:col-span-2"><span>Tester’s email</span><input id="access-editor-email" className={field} type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" /></label>
                        <label className="space-y-2 text-sm"><span>Agent</span><select className={field} value={agent} onChange={event => setAgent(event.target.value)}>{agents.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
                        <label className="space-y-2 text-sm"><span>Access lasts</span><select className={field} value={days} onChange={event => setDays(Number(event.target.value))}>{[1, 3, 7, 14, 30, 90].map(value => <option key={value} value={value}>{value} {value === 1 ? 'day' : 'days'}</option>)}</select></label>
                        <fieldset className="space-y-3 sm:col-span-2"><legend className="mb-3 text-sm">Permissions</legend>{(Object.keys(LABELS) as AccessCapability[]).map(capability => <label key={capability} className="flex items-center gap-3 text-sm text-zinc-300"><input type="checkbox" checked={capabilities.includes(capability)} onChange={event => setCapabilities(current => event.target.checked ? [...current, capability] : current.filter(item => item !== capability))} className="h-4 w-4 accent-indigo-400" />{LABELS[capability]}</label>)}</fieldset>
                        <button disabled={saving || !capabilities.length} className="rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold hover:bg-indigo-400 disabled:opacity-40 sm:col-span-2">{saving ? 'Saving…' : 'Save access'}</button>
                    </form>
                </section>
                <section className="mb-10"><h2 className="mb-4 text-xl font-semibold">Requests and approvals</h2><p className="mb-4 text-sm text-zinc-500">Most recent 200 records. Requests appear here after a tester verifies their email.</p>
                    {records.length === 0 ? <div className="rounded-xl border border-dashed border-white/15 p-8 text-sm text-zinc-400">No requests yet. You can approve your first tester above.</div> : <div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-xs uppercase tracking-wider text-zinc-400"><tr>{['Tester / agent', 'Status / expiry', 'Permissions', 'Actions'].map(label => <th key={label} className="px-5 py-4 font-medium">{label}</th>)}</tr></thead><tbody>{records.map(record => {
                        const expired = record.status === 'approved' && Boolean(record.expiresAt && Date.parse(record.expiresAt) <= checkedAt);
                        return <tr key={`${record.email}:${record.agent}`} className="border-t border-white/10 align-top"><td className="px-5 py-4"><p>{record.email}</p><p className="mt-1 text-xs text-zinc-500">{agents.find(item => item.slug === record.agent)?.name ?? record.agent}</p></td><td className="px-5 py-4"><span className={record.status === 'approved' && !expired ? 'text-emerald-300' : 'text-amber-200'}>{expired ? 'Expired' : record.status}</span>{record.expiresAt && <p className="mt-1 whitespace-nowrap text-xs text-zinc-500">{new Date(record.expiresAt).toLocaleDateString()}</p>}</td><td className="px-5 py-4 text-zinc-400">{record.capabilities.map(item => LABELS[item]).join(', ')}{Boolean(record.requestedCapabilities?.length) && <p className="mt-1 text-amber-200">Requested: {record.requestedCapabilities!.map(item => LABELS[item]).join(', ')}</p>}</td><td className="px-5 py-4"><div className="flex flex-wrap gap-3">{record.notificationStatus === 'pending' && <button disabled={saving} onClick={() => void update({ operation: 'retry-notification', email: record.email, agent: record.agent }, 'Email retry finished.')} className="text-amber-200">Retry email</button>}<button disabled={saving} onClick={() => review(record)} className="text-indigo-300 hover:text-indigo-100">Review</button>{record.status === 'approved' ? <button disabled={saving} onClick={() => void update({ operation: 'revoke', email: record.email, agent: record.agent }, 'Access revoked.')} className="text-red-300 hover:text-red-100">Revoke</button> : record.status === 'pending' && <button disabled={saving} onClick={() => void update({ operation: 'decline', email: record.email, agent: record.agent }, 'Request declined.')} className="text-zinc-400 hover:text-white">Decline</button>}</div></td></tr>;
                    })}</tbody></table></div>}
                </section>
                <section><h2 className="mb-4 text-xl font-semibold">Agent availability</h2><p className="mb-5 text-sm text-zinc-400">Pause access for everyone, including the owner. Public profiles stay visible.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{agents.map(item => { const disabled = disabledAgents.includes(item.slug); return <div key={item.slug} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.025] p-4"><div><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-zinc-500">{disabled ? 'Paused' : 'Approved testers only'}</p></div><button disabled={saving} onClick={() => void update({ operation: 'set-agent-state', agent: item.slug, disabled: !disabled }, `${item.name} access ${disabled ? 'resumed' : 'paused'}.`)} className={`rounded-lg border px-3 py-2 text-xs ${disabled ? 'border-emerald-400/30 text-emerald-200' : 'border-white/15 text-zinc-300'} disabled:opacity-40`}>{disabled ? 'Resume' : 'Pause'}</button></div>; })}</div></section>
            </>}
        </div>
    </main>;
}
