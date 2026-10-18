import { readAccessIdentity } from './auth.ts';
import { isAccessAgent, isAccessCapability, normalizeAccessEmail, readAccessRecord, recordAllows, listDisabledAccessAgents, storeAccessBrowser, readAccessBrowser, type AccessCapability } from './grants.ts';
import { isTrustedBrowserOrigin } from '../anam/session-spine.ts';

export function accessJson(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
}

export function isAccessOwner(email: string): boolean {
    // This is the existing site owner's address, also used by the site's
    // operations configuration. Deployment config can explicitly replace it.
    const configured = process.env.XAGENT_ACCESS_OWNER_EMAILS ?? 'aifusionlabs@gmail.com';
    const owners = configured.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    return owners.includes(normalizeAccessEmail(email));
}

export function agentAccessDisabled(agent: string): boolean {
    const disabled = (process.env.XAGENT_ACCESS_DISABLED_AGENTS ?? '').split(',').map(value => value.trim());
    return disabled.includes('*') || disabled.includes(agent);
}

export async function accessDecision(request: Request, agent: string, capability: AccessCapability = 'conversation') {
    if (!isAccessAgent(agent) || !isAccessCapability(capability)) throw new Error('Unknown access target');
    const identity = await readAccessIdentity(request);
    const owner = Boolean(identity && isAccessOwner(identity.email));
    const record = identity && !owner ? await readAccessRecord(identity.email, agent) : null;
    const disabled = agentAccessDisabled(agent) || (identity ? (await listDisabledAccessAgents()).includes(agent) : false);
    return {
        identity, owner, record,
        authorized: !disabled && Boolean(identity) && (owner || recordAllows(record, capability)),
    };
}

export async function requireAgentAccess(request: Request, agent: string, capability: AccessCapability = 'conversation'): Promise<Response | null> {
    try {
        if (!isAccessAgent(agent) || !isAccessCapability(capability)) return accessJson({ error: 'Agent access is not available' }, 403);
        if (!['GET', 'HEAD'].includes(request.method) && !isTrustedBrowserOrigin(request)) {
            return accessJson({ error: 'Request origin is not allowed' }, 403);
        }
        const decision = await accessDecision(request, agent, capability);
        if (!decision.identity) return accessJson({ error: 'Sign in to request agent access', accessRequired: true }, 401);
        if (!decision.authorized) return accessJson({ error: 'Owner approval is required for this agent and activity', accessRequired: true }, 403);
        return null;
    } catch {
        return accessJson({ error: 'Agent access is temporarily unavailable' }, 503);
    }
}

export async function requireOwnerAccess(request: Request): Promise<Response | null> {
    try {
        if (!['GET', 'HEAD'].includes(request.method) && !isTrustedBrowserOrigin(request)) {
            return accessJson({ error: 'Request origin is not allowed' }, 403);
        }
        const identity = await readAccessIdentity(request);
        if (!identity) return accessJson({ error: 'Sign in to continue' }, 401);
        if (!isAccessOwner(identity.email)) return accessJson({ error: 'Owner access is required' }, 403);
        return null;
    } catch {
        return accessJson({ error: 'Owner access is temporarily unavailable' }, 503);
    }
}

export async function bindAgentAccessBrowser(request: Request, agent: string, browserId: string): Promise<void> {
    const identity = await readAccessIdentity(request);
    if (!identity) throw new Error('Verified account is required');
    await storeAccessBrowser({ userId: identity.id, email: normalizeAccessEmail(identity.email), agent, browserId });
}

// Check-in creates an agent-local context. Launch still checks the specific activity.
export async function requireAgentEntryAccess(request: Request, agent: string): Promise<Response | null> {
    const conversation = await requireAgentAccess(request, agent, 'conversation');
    if (!conversation || conversation.status !== 403) return conversation;
    return requireAgentAccess(request, agent, 'meeting');
}

export async function requireAgentEntryBrowserAccess(request: Request, agent: string, browserId: string): Promise<Response | null> {
    const conversation = await requireAgentBrowserAccess(request, agent, browserId, 'conversation');
    if (!conversation || conversation.status !== 403) return conversation;
    return requireAgentBrowserAccess(request, agent, browserId, 'meeting');
}

// Used in addition to the agent's signed-cookie/session ownership checks.
// Switching signed-in accounts in one browser must not expose old notes.
export async function requireAgentBrowserAccess(request: Request, agent: string, browserId: string, capability: AccessCapability = 'conversation'): Promise<Response | null> {
    const denied = await requireAgentAccess(request, agent, capability);
    if (denied) return denied;
    try {
        const identity = await readAccessIdentity(request);
        const binding = await readAccessBrowser(agent, browserId);
        if (!identity || !binding || binding.userId !== identity.id || binding.email !== normalizeAccessEmail(identity.email)) {
            return accessJson({ error: 'Start a fresh session with your signed-in account' }, 403);
        }
        return null;
    } catch {
        return accessJson({ error: 'Session access is temporarily unavailable' }, 503);
    }
}

// Background delivery rechecks the current grant, independently of the cookie
// captured when the original session was started. Legacy/unbound work is denied.
export async function isStoredBrowserAccessAllowed(agent: string, browserId: string, capability: AccessCapability = 'actions'): Promise<boolean> {
    try {
        if (!isAccessAgent(agent) || !isAccessCapability(capability) || agentAccessDisabled(agent)) return false;
        if ((await listDisabledAccessAgents()).includes(agent)) return false;
        const binding = await readAccessBrowser(agent, browserId);
        if (!binding) return false;
        return isAccessOwner(binding.email) || recordAllows(await readAccessRecord(binding.email, agent), capability);
    } catch { return false; }
}
