import { readAccessIdentity } from '@/lib/access/auth';
import { deliverAccessNotifications } from '@/lib/access/notifications';
import { accessJson, agentAccessDisabled } from '@/lib/access/policy';
import { consumeAccessRate, isAccessAgent, isAccessCapability, requestAccess } from '@/lib/access/grants';
import { AmyAnamRequestError, isTrustedBrowserOrigin, readBoundedJsonObject, requestFingerprint } from '@/lib/anam/session-spine';

export async function POST(request: Request) {
    try {
        if (!isTrustedBrowserOrigin(request)) return accessJson({ error: 'Request origin is not allowed' }, 403);
        const identity = await readAccessIdentity(request);
        if (!identity) return accessJson({ error: 'Sign in before requesting access' }, 401);
        const body = await readBoundedJsonObject(request, 1024);
        const capability = body.capability ?? 'conversation';
        if (!isAccessAgent(body.agent) || !isAccessCapability(capability)) return accessJson({ error: 'Unknown agent or activity' }, 400);
        if (agentAccessDisabled(body.agent)) return accessJson({ error: 'This agent is currently unavailable' }, 403);
        if (!await consumeAccessRate(`request:${identity.id}`, 20, 3600)
            || !await consumeAccessRate(requestFingerprint(request, 'shared-access-request'), 50, 3600)) {
            return accessJson({ error: 'Too many access requests. Please try again later.' }, 429);
        }
        const record = await requestAccess(identity.email, body.agent, capability);
        const notification = record.notificationKind === 'request' ? await deliverAccessNotifications(record) : 'not-required';
        return accessJson({ requested: true, notification });
    } catch (error) {
        if (error instanceof AmyAnamRequestError) return accessJson({ error: error.message }, error.status);
        return accessJson({ error: 'Your request could not be saved. Please try again.' }, 503);
    }
}
