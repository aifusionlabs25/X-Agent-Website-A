import { readAccessIdentity } from '@/lib/access/auth';
import { accessDecision, accessJson, isAccessOwner } from '@/lib/access/policy';
import { isAccessAgent, isAccessCapability } from '@/lib/access/grants';

export async function GET(request: Request) {
    try {
        const search = new URL(request.url).searchParams;
        const agent = search.get('agent');
        if (!agent) {
            const identity = await readAccessIdentity(request);
            return accessJson({ mode: 'email', authenticated: Boolean(identity), authorized: false,
                email: identity?.email ?? null, displayName: identity?.name ?? null,
                owner: Boolean(identity && isAccessOwner(identity.email)) });
        }
        const capability = search.get('capability') ?? 'conversation';
        if (!isAccessAgent(agent) || !isAccessCapability(capability)) return accessJson({ error: 'Unknown agent or activity' }, 400);
        const decision = await accessDecision(request, agent, capability);
        return accessJson({
            mode: 'email', required: true, authenticated: Boolean(decision.identity), authorized: decision.authorized,
            email: decision.identity?.email ?? null, displayName: decision.identity?.name ?? null,
            owner: decision.owner, requested: decision.record?.status === 'pending'
                || Boolean(decision.record?.requestedCapabilities?.includes(capability)),
            expiresAt: decision.record?.expiresAt ?? null,
        });
    } catch {
        return accessJson({ error: 'Access is temporarily unavailable. Please try again shortly.' }, 503);
    }
}
