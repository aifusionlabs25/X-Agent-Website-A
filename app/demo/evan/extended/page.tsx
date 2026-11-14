'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import EvanExtendedDemoRoom from '@/components/evan/EvanExtendedDemoRoom';

export default function EvanExtendedDemoPage() {
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [unlocked, setUnlocked] = useState(false);
    const [entered, setEntered] = useState(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/anam/evan/demo-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
            const result = await response.json();
            if (!response.ok || result.mode !== 'extended' || result.maxSeconds !== 1800) throw new Error(result.error || 'Unable to unlock this demo.');
            setCode('');
            setUnlocked(true);
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to unlock this demo.'); }
        finally { setBusy(false); }
    }

    if (entered) return <EvanExtendedDemoRoom />;

    return (
        <main className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#100718] px-6 py-12 text-white">
            <section className="w-full max-w-lg rounded-2xl border border-[#ffc857]/20 bg-[#1c0b2b] p-8 shadow-2xl">
                <p className="text-xs font-bold uppercase tracking-[.2em] text-[#ffc857]">Evan / Private demonstration</p>
                <h1 className="mt-4 font-[Georgia] text-4xl">More time to explore.</h1>
                <p className="mt-4 text-sm leading-6 text-[#d7cbe2]">Unlock a 30-minute demonstration on this protected page. The public Evan link always stays at three minutes, even in this browser. Private access expires after one hour.</p>
                {unlocked ? (
                    <div className="mt-6">
                        <p role="status" className="text-[#ffdc8a]">Your longer demo is unlocked.</p>
                        <button type="button" onClick={() => setEntered(true)} className="mt-5 block w-full rounded-xl bg-[#ffc857] px-5 py-3 text-center font-bold text-[#1c0b2b]">Continue to private Evan</button>
                    </div>
                ) : (
                    <form className="mt-6 space-y-4" onSubmit={submit}>
                        <label className="block text-sm font-semibold">Private access code
                            <input type="password" required maxLength={256} autoComplete="off" value={code} onChange={event => setCode(event.target.value)} className="mt-2 block w-full rounded-xl border border-white/20 bg-black/25 px-4 py-3 text-white outline-none focus:border-[#ffc857]" />
                        </label>
                        {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
                        <button disabled={busy} className="w-full rounded-xl bg-[#ffc857] px-5 py-3 font-bold text-[#1c0b2b] disabled:opacity-50">{busy ? 'Checking access…' : 'Unlock longer demo'}</button>
                    </form>
                )}
                <Link href="/demo/evan" className="mt-6 block text-sm text-white/70 underline underline-offset-4">Back to the 3-minute public demo</Link>
            </section>
        </main>
    );
}
