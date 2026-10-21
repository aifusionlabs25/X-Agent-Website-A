'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signIn, signOut } from 'next-auth/react';
import { startAuthentication, startRegistration } from 'xagent-webauthn-browser';
import AccessFrame from './AccessFrame';
import { safeAccessReturnTo } from './navigation';
import styles from './AgentAccessGate.module.css';

async function passkey(operation: string, extra: Record<string, unknown> = {}) {
    const response = await fetch('/api/access/passkey', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, ...extra }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Owner sign-in is unavailable.');
    return data;
}

export default function OwnerSignIn({ returnTo }: { returnTo: string }) {
    const [owner, setOwner] = useState(false);
    const [checking, setChecking] = useState(true);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [credentials, setCredentials] = useState<{ id: string; createdAt: string }[]>([]);
    const destination = safeAccessReturnTo(returnTo, '/access/admin');
    useEffect(() => {
        let active = true;
        fetch('/api/access', { cache: 'no-store' }).then(async response => {
            if (!response.ok) throw new Error('Owner sign-in is temporarily unavailable.');
            const account = await response.json();
            if (!active) return;
            setOwner(account.owner === true);
            if (account.owner) {
                const data = await passkey('list');
                if (active) setCredentials(data.credentials);
            }
        }).catch(caught => { if (active) setError(caught.message); }).finally(() => { if (active) setChecking(false); });
        return () => { active = false; };
    }, []);
    async function run(action: () => Promise<void>) {
        setBusy(true); setError(''); setMessage('');
        try { await action(); } catch (caught) {
            setError(caught instanceof Error && caught.name === 'NotAllowedError'
                ? 'Passkey cancelled or unavailable. You can use your owner email instead.'
                : caught instanceof Error ? caught.message : 'Please try again.');
        } finally { setBusy(false); }
    }
    async function login() {
        const { options } = await passkey('authenticate-options');
        const response = await startAuthentication({ optionsJSON: options });
        await passkey('authenticate-verify', { response });
        window.location.assign(destination);
    }
    async function register() {
        const { options } = await passkey('register-options');
        const response = await startRegistration({ optionsJSON: options });
        await passkey('register-verify', { response });
        setCredentials((await passkey('list')).credentials);
        setMessage('Passkey added. Next time, choose “Sign in with passkey.”');
    }
    return <AccessFrame>
        <h1 className={styles.title}>Your owner entrance.</h1>
        <p className={styles.description}>One sign-in for every enabled X Agent and your access controls. Use Windows Hello, your phone, or your owner email.</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {message && <p role="status" className={styles.notice}>{message}</p>}
        {checking ? <p role="status">Checking your account…</p> : owner ? <>
            <div className={styles.actions}>
                <Link className={styles.primary} href={destination}>Continue to owner controls</Link>
                <button className={styles.secondary} disabled={busy || credentials.length >= 5} onClick={() => void run(register)}>Add a passkey</button>
                <button className={styles.secondary} disabled={busy} onClick={() => void run(async () => { await signOut({ redirect: false }); window.location.reload(); })}>Sign out</button>
            </div>
            <p className={styles.footnote}>Passkeys are tied to this website address. A preview passkey will not unlock the live site. Removing a passkey also ends its access on the next protected request.</p>
            {credentials.map((item, index) => <div key={item.id} className={styles.actions}>
                <span>Passkey {index + 1} · {new Date(item.createdAt).toLocaleDateString()}</span>
                <button className={styles.secondary} disabled={busy} onClick={() => void run(async () => {
                    await passkey('remove', { id: item.id }); window.location.reload();
                })}>Remove</button>
            </div>)}
        </> : <>
            <div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => void run(login)}>{busy ? 'Please wait…' : 'Sign in with passkey'}</button></div>
            <form className={styles.form} onSubmit={event => { event.preventDefault(); void run(async () => {
                const callbackUrl = `/access/owner?returnTo=${encodeURIComponent(destination)}`;
                const result = await signIn('email', { email: email.trim(), callbackUrl, redirect: false });
                if (!result?.ok || result.error) throw new Error('The sign-in link could not be sent.');
                setMessage('Check your inbox. Sign in with your owner email, then add your first passkey.');
            }); }}>
                <label className={styles.field} htmlFor="owner-email">First visit or recovery? Use your owner email.</label>
                <input className={styles.input} id="owner-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="Your owner email" />
                <button className={styles.secondary} disabled={busy || !email.trim()}>Email me a sign-in link</button>
            </form>
            <p className={styles.footnote}>Only a configured owner account can manage access or register an owner passkey. Sessions last four hours.</p>
        </>}
    </AccessFrame>;
}
