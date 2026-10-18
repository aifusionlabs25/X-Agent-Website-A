import { ALL_AGENTS } from '@/lib/agents';
import { readAccessIdentity } from '@/lib/access/auth';
import { accessJson, requireOwnerAccess } from '@/lib/access/policy';
import { consumeAccessRate, isAccessAgent, isAccessCapability, listAccessRecords, normalizeAccessEmail,
    readAccessRecord, writeAccessRecord, listDisabledAccessAgents, setAccessAgentDisabled, type AccessCapability } from '@/lib/access/grants';
import { AmyAnamRequestError, readBoundedJsonObject } from '@/lib/anam/session-spine';

export async function GET(request: Request) {
    const denied = await requireOwnerAccess(request);
    if (denied) return denied;
    try {
        const [records, disabledAgents] = await Promise.all([listAccessRecords(), listDisabledAccessAgents()]);
        return accessJson({ records, disabledAgents, agents: ALL_AGENTS.map(({ slug, name, role }) => ({ slug, name, role })) });
    } catch {
        return accessJson({ error: 'Access records are temporarily unavailable' }, 503);
    }
}

export async function POST(request: Request) {
    const denied = await requireOwnerAccess(request);
    if (denied) return denied;
    try {
        const identity = await readAccessIdentity(request);
        if (!identity) return accessJson({ error: 'Sign in again' }, 401);
        if (!await consumeAccessRate(`admin:${identity.id}`, 120, 3600)) return accessJson({ error: 'Too many updates. Please wait.' }, 429);
        const body = await readBoundedJsonObject(request, 4096);
        if (!isAccessAgent(body.agent)) return accessJson({ error: 'Select a valid agent' }, 400);
        if (body.operation === 'set-agent-state') {
            if (typeof body.disabled !== 'boolean') return accessJson({ error: 'Select an access state' }, 400);
            await setAccessAgentDisabled(body.agent, body.disabled);
            return accessJson({ saved: true });
        }
        let email: string;
        try { email = normalizeAccessEmail(body.email); } catch { return accessJson({ error: 'Enter a valid email address' }, 400); }
        if (!['approve', 'revoke', 'decline'].includes(String(body.operation))) return accessJson({ error: 'Choose an access action' }, 400);
        const existing = await readAccessRecord(email, body.agent);
        let capabilities: AccessCapability[] = existing?.capabilities ?? [];
        let expiresAt: string | null = null;
        if (body.operation === 'approve') {
            if (!Array.isArray(body.capabilities) || !body.capabilities.length || !body.capabilities.every(isAccessCapability)) {
                return accessJson({ error: 'Choose at least one valid permission' }, 400);
            }
            capabilities = [...new Set(body.capabilities)] as AccessCapability[];
            const expiry = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
            if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 90 * 24 * 60 * 60 * 1000) {
                return accessJson({ error: 'Choose an expiry within the next 90 days' }, 400);
            }
            expiresAt = new Date(expiry).toISOString();
        }
        await writeAccessRecord({ email, agent: body.agent, capabilities, requestedCapabilities: [], expiresAt,
            status: body.operation === 'approve' ? 'approved' : body.operation === 'revoke' ? 'revoked' : 'declined',
            updatedAt: new Date().toISOString(), updatedBy: identity.email });
        return accessJson({ saved: true });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) return accessJson({ error: error.message }, error.status);
        return accessJson({ error: 'The access change could not be saved' }, 503);
    }
}
