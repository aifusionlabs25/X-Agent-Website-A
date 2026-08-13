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
import { resolveMeetingPersonaSnapshot } from '@/lib/meeting-concierge/v1/persona-snapshot';

const AMY_MEETING_EXIT_INSTRUCTIONS = `MEETING-ONLY SESSION CONTROL — HIGHEST PRIORITY
- This runtime is an external video meeting, not Amy's X Agents website session. Never call end_amy_session here.
- When a participant directly asks Amy to leave, drop, disconnect, end her participation, or give the humans privacy, treat that as confirmed intent. Do not ask for confirmation. Call end_call once with confirmed true.
- "Amy, you can go," "Amy, please leave," "we need to continue privately," "that's all for Amy," and an explicit statement that the meeting is over are sufficient. A casual thanks or pause alone is not.
- Keep the exit human and immediate: acknowledge in one brief sentence, invoke end_call, ask no question, and introduce no new topic. If the tool ends the connection before another sentence is possible, leave silently.
- Never expose tool syntax or claim to have left unless end_call succeeds.`;

const amyMeetingConcierge = createMeetingConciergeHandlers({
    agentKey: 'amy',
    agentName: 'Amy',
    displayName: 'Amy Insight SDR',
    statusTokenSecret() {
        return readAmyAnamSpineConfig().signingSecret;
    },
    async resolvePersona({ apiKey, maxSessionLengthSeconds }) {
        const resolution = resolveAnamSessionPersona({
            requestedPersonaId: AMY_PUBLIC_PERSONA_ID,
            requestedVariant: AMY_CARA4_VARIANT,
            allowedPersonaIds: [AMY_PUBLIC_PERSONA_ID],
            amyCara4PersonaId: process.env.ANAM_AMY_CARA4_PERSONA_ID,
        });
        if (!resolution.ok) throw new Error('Amy Cara 4 persona is unavailable');
        return {
            personaConfig: await resolveMeetingPersonaSnapshot({
                apiKey,
                expectedPersonaId: resolution.personaId,
                removeToolNames: ['end_amy_session'],
                addToolNames: ['end_call'],
                addToolTypes: { end_call: 'SYSTEM' },
                systemPromptSuffix: AMY_MEETING_EXIT_INSTRUCTIONS,
                maxSessionLengthSeconds,
            }),
        };
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
export const DELETE = amyMeetingConcierge.DELETE;
