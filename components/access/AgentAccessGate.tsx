'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { ArrowRight, Check, LoaderCircle, RotateCcw } from 'lucide-react';
import { ALL_AGENTS } from '@/lib/agents';
import AccessFrame from './AccessFrame';
import { safeAccessReturnTo } from './navigation';
import styles from './AgentAccessGate.module.css';

export type AgentAccessCapability = 'conversation' | 'meeting';
type AccessStatus = {
    scope: string;
    authorized: boolean;
    authenticated: boolean;
    requested: boolean;
    owner: boolean;
    email: string | null;
};

type AgentAccessGateProps = {
    agent: string;
    capability?: AgentAccessCapability;
    embedded?: boolean;
    showAuthorizedCheckpoint?: boolean;
    children: ReactNode;
};

export default function AgentAccessGate(props: AgentAccessGateProps) {
    return <AgentAccessBoundary key={`${props.agent}:${props.capability ?? 'conversation'}`} {...props} />;
}

function AgentAccessBoundary({ agent: agentSlug, capability = 'conversation', embedded = false, showAuthorizedCheckpoint = false, children }: AgentAccessGateProps) {
    const agent = ALL_AGENTS.find(item => item.slug === agentSlug);
    const name = agent?.name ? agent.name.charAt(0).toUpperCase() + agent.name.slice(1).toLowerCase() : 'this agent';
    const scope = `${agentSlug}:${capability}`;
    const [status, setStatus] = useState<AccessStatus | null>(null);
    const [checking, setChecking] = useState(true);
    const [busy, setBusy] = useState(false);
    const [continued, setContinued] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [returnTo, setReturnTo] = useState(`/agents/${agentSlug}`);
    const controller = useRef<AbortController | null>(null);

    const checkAccess = useCallback(() => {
        controller.current?.abort();
        const active = new AbortController();
        controller.current = active;
        const query = new URLSearchParams({ agent: agentSlug, capability });
        return fetch(`/api/access?${query}`, {
            credentials: 'same-origin', cache: 'no-store', signal: active.signal,
        }).then(async response => {
            const data = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Access could not be checked. Please try again.');
            if (typeof data.authenticated !== 'boolean' || typeof data.authorized !== 'boolean') {
                throw new Error('Access could not be confirmed. Please try again.');
            }
            if (active.signal.aborted) return;
            setReturnTo(safeAccessReturnTo(window.location.pathname + window.location.search + window.location.hash));
            setStatus({ scope, authorized: data.authorized === true, authenticated: data.authenticated === true,
                requested: data.requested === true, owner: data.owner === true,
                email: typeof data.email === 'string' ? data.email : null });
        }).catch(caught => {
            if (active.signal.aborted) return;
            setStatus(null);
            setError(caught instanceof Error ? caught.message : 'Access is temporarily unavailable.');
        }).finally(() => {
            if (!active.signal.aborted) setChecking(false);
        });
    }, [agentSlug, capability, scope]);

    useEffect(() => {
        void checkAccess();
        return () => controller.current?.abort();
    }, [checkAccess]);

    function refreshAccess() {
        setChecking(true);
        setError(null);
        void checkAccess();
    }

    async function requestAccess() {
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const response = await fetch('/api/access/request', {
                method: 'POST', credentials: 'same-origin', cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent: agentSlug, capability }),
            });
            const data = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Your request could not be submitted.');
            setNotice(data.notification === 'pending' ? 'Your request is saved. Email notification is delayed; the owner can still review it.' : 'Your access request was submitted. We’ll email you when the owner makes a decision.');
            setChecking(true);
            await checkAccess();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Your request could not be submitted.');
        } finally {
            setBusy(false);
        }
    }

    async function logout() {
        setBusy(true);
        setError(null);
        try {
            await signOut({ redirect: false });
            setStatus(null);
            setNotice(null);
            setChecking(true);
            await checkAccess();
        } catch {
            setError('Sign-out could not be confirmed. Please try again.');
        } finally {
            setBusy(false);
        }
    }

    const current = status?.scope === scope ? status : null;
    if (!checking && !error && current?.authorized === true && current.authenticated === true && showAuthorizedCheckpoint && !continued) return (
        <AccessFrame agent={agent} embedded={embedded} backHref="/#agents">
            <h1 className={styles.title}>{current.owner ? `Owner access to ${name} is active.` : `Access to ${name} is approved.`}</h1>
            <p className={styles.description}>{current.owner
                ? 'Your owner account can continue without requesting approval. Choose how you would like to meet Dani next.'
                : 'You are approved to continue. Choose how you would like to meet Dani next.'}</p>
            {current.email && <p className={styles.identity}>Signed in as <strong>{current.email}</strong></p>}
            <div className={styles.actions}>
                <button type="button" className={styles.primary} onClick={() => setContinued(true)}>Continue to Dani<ArrowRight size={17} /></button>
                <button type="button" className={styles.secondary} onClick={() => void logout()} disabled={busy}>Sign out</button>
                {current.owner && <Link className={styles.secondary} href="/access/admin">Manage access</Link>}
            </div>
        </AccessFrame>
    );
    if (!checking && !error && current?.authorized === true && current.authenticated === true) return <>
        {children}
        {current.owner && <div className={styles.ownerToolbar}>
            <span>Owner access active · approval bypassed</span>
            <button type="button" onClick={() => void logout()} disabled={busy}>Sign out to test visitor view</button>
            <Link href="/access/admin" target="_blank" rel="noopener noreferrer">Manage access ↗</Link>
        </div>}
    </>;
    const signInHref = `/access?${new URLSearchParams({ agent: agentSlug, capability, returnTo })}`;
    return (
        <AccessFrame agent={agent} embedded={embedded} backHref={showAuthorizedCheckpoint ? '/#agents' : undefined}>
            {checking || (!current && !error) ? <div className={styles.loading} role="status"><LoaderCircle size={21} className={styles.spinner} /><p>Checking access to {name}…</p></div> : <>
                <h1 className={styles.title}>{current?.authenticated ? current.requested ? 'Your request is pending.' : `Meet ${name}, with approval.` : `Sign in to meet ${name}.`}</h1>
                <p className={styles.description}>{current?.authenticated
                    ? current.requested ? 'The owner will review your request. Watch your email for a decision, or check its status here.' : `Request permission to ${capability === 'meeting' ? `invite ${name} into a meeting` : `start a conversation with ${name}`}.`
                    : 'Use your email to sign in, then request access. Each agent is available only to approved visitors.'}</p>
                {current?.email && <p className={styles.identity}>Signed in as <strong>{current.email}</strong></p>}
                {error && <p className={styles.error} role="alert">{error}</p>}
                {notice && <p className={styles.notice} role="status"><Check size={16} />{notice}</p>}
                <div className={styles.actions}>
                    {error && !current ? <button className={styles.primary} onClick={refreshAccess}><RotateCcw size={16} />Try again</button>
                        : !current?.authenticated ? <Link className={styles.primary} href={signInHref}>Sign in with email<ArrowRight size={17} /></Link>
                            : !current.requested ? <button className={styles.primary} onClick={() => void requestAccess()} disabled={busy}>{busy ? <LoaderCircle size={16} className={styles.spinner} /> : null}Request access<ArrowRight size={17} /></button>
                                : <button className={styles.primary} onClick={refreshAccess} disabled={busy}><RotateCcw size={16} />Check status</button>}
                    {current?.authenticated && <button className={styles.secondary} onClick={() => void logout()} disabled={busy}>Sign out</button>}
                    {current?.owner && <Link className={styles.secondary} href="/access/admin">Manage access</Link>}
                </div>
                <p className={styles.footnote}>Access approval is separate from each agent&apos;s email and memory preferences.</p>
            </>}
        </AccessFrame>
    );
}
