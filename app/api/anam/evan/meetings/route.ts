import { EVAN_PERSONA_ID } from '@/lib/anam/persona-ids';
import {
    isTrustedBrowserOrigin,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    requestFingerprint,
} from '@/lib/anam/session-spine';
import { readAmyAnamContactFromRequest } from '@/lib/anam/contact-token';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';
import { createMeetingConciergeHandlers } from '@/lib/meeting-concierge/v1/server';
import { resolveMeetingPersonaSnapshot } from '@/lib/meeting-concierge/v1/persona-snapshot';

const EVAN_MEETING_EXIT_INSTRUCTIONS = `MEETING-ONLY SESSION CONTROL — HIGHEST PRIORITY
- This runtime is an external video meeting, not Evan's X Agents website session. Never call end_mullins_session here.
- When a participant directly asks Evan to leave, drop, disconnect, end his participation, or give the humans privacy, treat that as confirmed intent. Do not ask for confirmation. Call end_call once with confirmed true.
- "Evan, you can go," "Evan, please leave," "we need to continue privately," "that's all for Evan," and an explicit statement that the meeting is over are sufficient. A casual thanks or pause alone is not.
- Keep the exit warm and immediate: say one brief goodbye, invoke end_call, ask no question, and introduce no new topic. If the tool ends the connection before another sentence is possible, leave silently.
- Never expose tool syntax or claim to have left unless end_call succeeds.

MEETING-ONLY MULLINS BOUNDARIES
- Continue using the saved Mullins Moving knowledge and intake boundaries. Never issue a quote, price, booking, crew assignment, timing guarantee, valuation guarantee, or availability confirmation.
- This meeting has no Live Move Planner surface and no website email workflow. Never call show_move_planner or send_mullins_follow_up_email.
- In a group call, wait until someone says "Evan" or directly asks you a question before responding. Do not interrupt participant-to-participant conversation.`;

const evanMeetingConcierge = createMeetingConciergeHandlers({
    agentKey: 'evan',
    agentName: 'Evan',
    displayName: 'Evan Mullins Moving Concierge',
    statusTokenSecret() {
        return readAmyAnamSpineConfig().signingSecret;
    },
    async resolvePersona({ apiKey, maxSessionLengthSeconds }) {
        return {
            personaConfig: await resolveMeetingPersonaSnapshot({
                apiKey,
                expectedPersonaId: EVAN_PERSONA_ID,
                removeToolNames: [
                    'end_mullins_session',
                    'send_mullins_follow_up_email',
                    'show_move_planner',
                ],
                addToolNames: ['end_call'],
                addToolTypes: { end_call: 'SYSTEM' },
                systemPromptSuffix: EVAN_MEETING_EXIT_INSTRUCTIONS,
                maxSessionLengthSeconds,
            }),
        };
    },
    async readOrganizer(request) {
        const spine = readAmyAnamSpineConfig();
        if (!spine.gatesOpen) return null;
        const browser = readAmyAnamBrowserSession(request, spine.signingSecret);
        if (!browser) return null;
        const contact = readAmyAnamContactFromRequest({
            request,
            browserSessionId: browser.id,
            secret: spine.signingSecret,
        });
        if (contact?.purpose !== 'evan_follow_up' || !contact.displayName) return null;
        return {
            authenticated: true,
            displayName: contact.displayName,
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

export const GET = evanMeetingConcierge.GET;
export const POST = evanMeetingConcierge.POST;
export const DELETE = evanMeetingConcierge.DELETE;
