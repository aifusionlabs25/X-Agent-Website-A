import { DANI_PERSONA_ID } from '@/lib/anam/persona-ids';
import {
    isTrustedBrowserOrigin,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    requestFingerprint,
} from '@/lib/anam/session-spine';
import { readDaniAnamBrowserSession, readDaniAnamSessionSecrets } from '@/lib/anam/dani-session';
import { readDaniAnamContactFromRequest } from '@/lib/anam/contact-token';
import { readDaniAnamFollowUpAuthorization } from '@/lib/anam/dani-agentmail';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';
import { createMeetingConciergeHandlers } from '@/lib/meeting-concierge/v1/server';
import { resolveMeetingPersonaSnapshot } from '@/lib/meeting-concierge/v1/persona-snapshot';

const DANI_MEETING_EXIT_INSTRUCTIONS = `MEETING-ONLY SESSION CONTROL — HIGHEST PRIORITY
- This runtime is an external video meeting, not Dani's X Agents website session. Never call end_dani_session here.
- When a participant directly asks Dani to leave, drop, disconnect, end her participation, or give the humans privacy, treat that as confirmed intent. Do not ask for confirmation. Call end_call once with confirmed true.
- "Dani, you can go," "Dani, please leave," "we need to continue privately," "that's all for Dani," and an explicit statement that the meeting is over are sufficient. A casual thanks or pause alone is not.
- Keep the exit human and immediate: acknowledge in one brief sentence, invoke end_call, ask no question, and introduce no new topic. If the tool ends the connection before another sentence is possible, leave silently.
- Never expose tool syntax or claim to have left unless end_call succeeds.`;

const daniMeetingConcierge = createMeetingConciergeHandlers({
    agentKey: 'dani',
    agentName: 'Dani',
    displayName: 'Dani AI Solutions Director',
    statusTokenSecret() {
        return readDaniAnamSessionSecrets().sessionSecret;
    },
    async resolvePersona({ apiKey, maxSessionLengthSeconds }) {
        return {
            personaConfig: await resolveMeetingPersonaSnapshot({
                apiKey,
                expectedPersonaId: DANI_PERSONA_ID,
                removeToolNames: [
                    'end_dani_session',
                    'send_dani_follow_up_email',
                    'confirm_dani_live_identity',
                ],
                addToolNames: ['end_call'],
                addToolTypes: { end_call: 'SYSTEM' },
                systemPromptSuffix: DANI_MEETING_EXIT_INSTRUCTIONS,
                maxSessionLengthSeconds,
            }),
        };
    },
    async readOrganizer(request) {
        const spine = readAmyAnamSpineConfig();
        const secrets = readDaniAnamSessionSecrets();
        if (!spine.gatesOpen || !secrets.configured) return null;
        const browser = readDaniAnamBrowserSession(request, secrets.sessionSecret);
        if (!browser) return null;
        const cookieContact = readDaniAnamContactFromRequest({
            request,
            browserSessionId: browser.id,
            secret: secrets.contactSecret,
        });
        const storedContact = cookieContact ?? await readDaniAnamFollowUpAuthorization({
            browserSessionId: browser.id,
            contactSecret: secrets.contactSecret,
        });
        if (
            storedContact?.purpose !== 'dani_follow_up'
            || storedContact.emailOwnershipVerified !== true
            || !storedContact.displayName
        ) return null;
        return {
            authenticated: true,
            displayName: storedContact.displayName,
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

export const GET = daniMeetingConcierge.GET;
export const POST = daniMeetingConcierge.POST;
export const DELETE = daniMeetingConcierge.DELETE;
