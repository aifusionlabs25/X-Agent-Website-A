import type { Metadata } from 'next';
import { ALL_AGENTS } from '@/lib/agents';
import AccessSignIn from '@/components/access/AccessSignIn';
import { safeAccessReturnTo } from '@/components/access/navigation';

export const metadata: Metadata = {
    title: 'Sign in · X Agents',
    robots: { index: false, follow: false },
};

export default async function AccessPage({ searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const query = await searchParams;
    const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
    const agent = ALL_AGENTS.find(item => item.slug === first(query.agent));
    const fallback = agent ? `/agents/${agent.slug}` : '/#agents';
    const returnTo = safeAccessReturnTo(first(query.returnTo) ?? first(query.callbackUrl), fallback);
    return <AccessSignIn agentSlug={agent?.slug} returnTo={returnTo}
        verifyRequest={first(query.checkEmail) === '1' || first(query.verifyRequest) === '1' || first(query.verifyRequest) === 'true'}
        signInError={Boolean(first(query.error))} />;
}
