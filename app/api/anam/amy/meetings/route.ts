import { AMY_CARA4_VARIANT, AMY_PUBLIC_PERSONA_ID, resolveAnamSessionPersona } from '@/lib/anam/session-config';
import {
    isTrustedBrowserOrigin,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    requestFingerprint,
} from '@/lib/anam/session-spine';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';
import { readAmyAnamContactFromRequest } from '@/lib/anam/contact-token';
import { readAmyAnamBrowserIdentity } from '@/lib/anam/user-memory';
import { createMeetingConciergeHandlers } from '@/lib/meeting-concierge/v1/server';

const amyMeetingConcierge = createMeetingConciergeHandlers({
    agentKey: 'amy',
    agentName: 'Amy',
    displayName: 'Amy Insight SDR',
    statusTokenSecret() {
        return readAmyAnamSpineConfig().signingSecret;
    },
    resolvePersonaId() {
        const resolution = resolveAnamSessionPersona({
            requestedPersonaId: AMY_PUBLIC_PERSONA_ID,
            requestedVariant: AMY_CARA4_VARIANT,
            allowedPersonaIds: [AMY_PUBLIC_PERSONA_ID],
            amyCara4PersonaId: process.env.ANAM_AMY_CARA4_PERSONA_ID,
        });
        if (!resolution.ok) throw new Error('Amy Cara 4 persona is unavailable');
        return resolution.personaId;
    },
    async readOrganizer(request) {
        const spine = readAmyAnamSpineConfig();
        if (!spine.gatesOpen) return null;
        const browser = readAmyAnamBrowserSession(request, spine.signingSecret);
        if (!browser) return null;
        const [contact, identity] = await Promise.all([
            Promise.resolve(readAmyAnamContactFromRequest({
                request,
                browserSessionId: browser.id,
                secret: spine.signingSecret,
            })),
            readAmyAnamBrowserIdentity(browser.id),
        ]);
        if (!identity || contact?.purpose !== 'amy_follow_up') return null;
        return {
            authenticated: true,
            displayName: identity.displayName,
            isolationId: browser.id,
        };
    },
    platform: {
        isTrustedBrowserOrigin,
        readBoundedJsonObject,
        requestFingerprint,
        consumeRateLimit: consumeAmyAnamDistributedRateLimit,
    },
});

export const GET = amyMeetingConcierge.GET;
export const POST = amyMeetingConcierge.POST;
