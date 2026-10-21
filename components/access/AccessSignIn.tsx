'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { signIn, signOut } from 'next-auth/react';
import { ArrowRight, LoaderCircle, Mail, RotateCcw } from 'lucide-react';
import { ALL_AGENTS } from '@/lib/agents';
import AccessFrame from './AccessFrame';
import { safeAccessReturnTo } from './navigation';
import styles from './AgentAccessGate.module.css';

type AccountStatus = { authenticated: boolean; email: string | null; owner: boolean };

export default function AccessSignIn({ agentSlug, returnTo, verifyRequest = false, signInError = false }: {
    agentSlug?: string;
    returnTo: string;
    verifyRequest?: boolean;
    signInError?: boolean;
}) {
    const agent = ALL_AGENTS.find(item => item.slug === agentSlug);
    const [email, setEmail] = useState('');
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [account, setAccount] = useState<AccountStatus | null>(null);
    const [checking, setChecking] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(signInError ? 'That sign-in could not be completed. Please request a new link.' : null);
    const [statusError, setStatusError] = useState(false);
    const controller = useRef<AbortController | null>(null);
    const destination = safeAccessReturnTo(returnTo, agent ? `/agents/${agent.slug}` : '/#agents');

    const checkAccount = useCallback(() => {
        controller.current?.abort();
        const active = new AbortController();
        controller.current = active;
        return fetch('/api/access', { cache: 'no-store', credentials: 'same-origin', signal: active.signal }).then(async response => {
            const data = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (!response.ok || typeof data.authenticated !== 'boolean') throw new Error('Sign-in is temporarily unavailable. Please try again.');
            if (active.signal.aborted) return;
            setAccount({ authenticated: data.authenticated, owner: data.owner === true, email: typeof data.email === 'string' ? data.email : null });
        }).catch(caught => {
            if (active.signal.aborted) return;
            setAccount(null);
            setStatusError(true);
            setError(caught instanceof Error ? caught.message : 'Sign-in is temporarily unavailable.');
        }).finally(() => {
            if (!active.signal.aborted) setChecking(false);
        });
    }, []);

    useEffect(() => {
        void checkAccount();
        return () => controller.current?.abort();
    }, [checkAccount]);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const address = email.trim();
            const response = await signIn('email', { email: address, redirect: false, callbackUrl: destination });
            if (!response?.ok || response.error) throw new Error('A sign-in link could not be sent. Please try again.');
            setSentTo(address);
            setEmail('');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'A sign-in link could not be sent.');
        } finally {
            setSubmitting(false);
        }
    }

    async function logout() {
        setSubmitting(true);
        setError(null);
        try {
            await signOut({ redirect: false });
            setSentTo(null);
            setChecking(true);
            setStatusError(false);
            await checkAccount();
        } catch {
            setError('Sign-out could not be confirmed. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }

    const awaitingLink = sentTo !== null || verifyRequest;
    return <AccessFrame agent={agent}>
        {checking ? <div className={styles.loading} role="status"><LoaderCircle className={styles.spinner} size={21} />Checking your account…</div> : <>
            <h1 className={styles.title}>{account?.authenticated ? 'You’re signed in.' : awaitingLink ? 'Check your email.' : 'Your email is your key.'}</h1>
            <p className={styles.description}>{account?.authenticated
                ? 'Continue to your agent to view or request access.'
                : awaitingLink ? 'Open the sign-in link in your inbox to continue. You can also check your spam folder.'
                    : 'We’ll send you a link to sign in. After that, you can request permission to use an agent.'}</p>
            {account?.authenticated && account.email && <p className={styles.identity}>Signed in as<strong>{account.email}</strong></p>}
            {sentTo && <p className={styles.notice} role="status"><Mail size={17} />Sign-in link sent to {sentTo}.</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}
            {statusError ? <div className={styles.actions}><button className={styles.primary} onClick={() => { setError(null); setChecking(true); setStatusError(false); void checkAccount(); }}><RotateCcw size={16} />Try again</button></div>
                : account?.authenticated ? <div className={styles.actions}>
                    <Link href={destination} className={styles.primary}>Continue<ArrowRight size={17} /></Link>
                    {account.owner && <Link href="/access/admin" className={styles.secondary}>Manage access</Link>}
                    <button className={styles.secondary} onClick={() => void logout()} disabled={submitting}>Sign out</button>
                </div> : <form className={styles.form} onSubmit={submit}>
                    <label className={styles.field} htmlFor="access-email">{awaitingLink ? 'Send another link' : 'Email address'}</label>
                    <input className={styles.input} id="access-email" name="email" type="email" required autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" disabled={submitting} />
                    <div className={styles.actions}><button type="submit" className={styles.primary} disabled={submitting || !email.trim()}>{submitting ? <LoaderCircle className={styles.spinner} size={16} /> : <Mail size={16} />}{submitting ? 'Sending link…' : 'Email me a sign-in link'}</button></div>
                </form>}
            <p className={styles.footnote}>Signing in verifies your email. Agent access is granted separately by the owner.</p>
            <Link className={styles.backLink} href={`/access/owner?returnTo=${encodeURIComponent(destination)}`}>Owner sign-in</Link>
        </>}
    </AccessFrame>;
}
