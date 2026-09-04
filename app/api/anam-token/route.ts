import { NextResponse } from 'next/server';
import { AMY_RETURNING_MEMORY_AVAILABLE } from '@/lib/anam/amy-demo-policy';
import { ALL_AGENTS } from '@/lib/agents';
import { readAmyAnamAgentMailConfig } from '@/lib/anam/outbound-email-config';
import { readDaniAnamAgentMailConfig } from '@/lib/anam/dani-agentmail';
import { readEvanAnamAgentMailConfig } from '@/lib/anam/evan-agentmail';
import { isEvanLocalTestMode } from '@/lib/anam/evan-local-test-mode';
import {
    readDaniAnamBrowserSession,
    readDaniAnamSessionSecrets,
} from '@/lib/anam/dani-session';
import {
    readAmyAnamContactFromRequest,
    readDaniAnamContactFromRequest,
} from '@/lib/anam/contact-token';
import { AMY_CARA4_VARIANT, resolveAnamSessionPersona } from '@/lib/anam/session-config';
import {
    DANI_PERSONA_ID,
    EVAN_PERSONA_ID,
    readAmyCara4PersonaReadiness,
    readDaniPersonaReadiness,
    readEvanPersonaReadiness,
} from '@/lib/anam/persona-readiness';
import {
    AMY_ANAM_BROWSER_COOKIE,
    AmyAnamRequestError,
    amyAnamCookieOptions,
    createAmyAnamBrowserSessionWithSecret,
    createAmyAnamLaunch,
    isTrustedBrowserOrigin,
    readAmyAnamBrowserSession,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
    requestFingerprint,
} from '@/lib/anam/session-spine';
import {
    consumeAmyAnamDistributedRateLimit,
    deleteAmyAnamLaunch,
    storeAmyAnamLaunch,
} from '@/lib/anam/session-spine-store';
import {
    buildAmyAnamMemoryAccessPolicy,
    readAmyAnamBrowserIdentity,
    readAmyAnamMemoryConfig,
} from '@/lib/anam/user-memory';
import {
    buildDaniAnamMemoryAccessPolicy,
    readDaniAnamBrowserIdentity,
    readDaniAnamMemoryConfig,
} from '@/lib/anam/dani-user-memory';

const ALLOWED_PERSONA_IDS = new Set(
    ALL_AGENTS.map(agent => agent.personaId).filter((personaId): personaId is string => Boolean(personaId)),
);

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(req: Request) {
    try {
        const { personaId, variant } = await readBoundedJsonObject(req, 2 * 1024);
        const resolution = resolveAnamSessionPersona({
            requestedPersonaId: personaId,
            requestedVariant: variant,
            allowedPersonaIds: ALLOWED_PERSONA_IDS,
            amyCara4PersonaId: process.env.ANAM_AMY_CARA4_PERSONA_ID,
        });

        if (!resolution.ok) {
            return noStoreJson(
                { error: resolution.error },
                { status: resolution.status }
            );
        }

        const spineConfig = readAmyAnamSpineConfig();
        const daniSessionSecrets = readDaniAnamSessionSecrets();
        const memoryConfig = readAmyAnamMemoryConfig();
        const daniMemoryConfig = readDaniAnamMemoryConfig();
        const agentMailConfig = readAmyAnamAgentMailConfig();
        const daniAgentMailConfig = readDaniAnamAgentMailConfig();
        const evanAgentMailConfig = readEvanAnamAgentMailConfig();
        const isAmyCara4 = resolution.variant === AMY_CARA4_VARIANT;
        const isDani = resolution.personaId === DANI_PERSONA_ID;
        const isEvan = resolution.personaId === EVAN_PERSONA_ID;
        const evanLocalTestMode = isEvan && isEvanLocalTestMode();
        if (isAmyCara4) {
            // Check-in cannot be bypassed by disabling a memory/tracking flag.
            if (!spineConfig.gatesOpen || !memoryConfig.gatesOpen) {
                return noStoreJson({ error: 'Amy check-in is temporarily unavailable' }, { status: 503 });
            }
            if (!isTrustedBrowserOrigin(req)) {
                return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
            }
            const rate = await consumeAmyAnamDistributedRateLimit({
                fingerprint: requestFingerprint(req, 'token'),
                limit: 10,
                windowSeconds: 10 * 60,
            });
            if (!rate.allowed) {
                return noStoreJson({ error: 'Too many session starts' }, {
                    status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) },
                });
            }
            const checkedInSession = readAmyAnamBrowserSession(req, spineConfig.signingSecret);
            if (!checkedInSession || !await readAmyAnamBrowserIdentity(checkedInSession.id)) {
                return noStoreJson({ error: 'Amy check-in is required' }, { status: 401 });
            }
            const contact = readAmyAnamContactFromRequest({
                request: req, browserSessionId: checkedInSession.id, secret: spineConfig.signingSecret,
            });
            if (contact?.purpose !== 'amy_follow_up') {
                return noStoreJson({ error: 'Amy check-in is required' }, { status: 401 });
            }
        }
        if (isDani && !daniSessionSecrets.configured) {
            console.error('[Dani Anam Session] Isolated session secrets are unavailable');
            return noStoreJson(
                { error: 'Dani session access is temporarily unavailable' },
                { status: 503 },
            );
        }
        if ((isAmyCara4 || isDani || (isEvan && !evanLocalTestMode)) && spineConfig.enabled && !spineConfig.gatesOpen) {
            console.error('[Amy Anam Spine] Enabled but unavailable');
            return noStoreJson(
                { error: 'Amy session tracking is temporarily unavailable' },
                { status: 503 },
            );
        }
        if (isAmyCara4 && memoryConfig.enabled && !memoryConfig.gatesOpen) {
            console.error('[Amy Anam Memory] Enabled but unavailable');
            return noStoreJson(
                { error: 'Amy returning memory is temporarily unavailable' },
                { status: 503 },
            );
        }

        const anamApiKey = process.env.ANAM_API_KEY;
        if (!anamApiKey) {
            console.error('Missing ANAM_API_KEY environment variable.');
            return noStoreJson(
                { error: 'Server configuration error' },
                { status: 500 },
            );
        }

        if (resolution.personaId === EVAN_PERSONA_ID) {
            let personaReadiness;
            try {
                personaReadiness = await readEvanPersonaReadiness(anamApiKey);
            } catch {
                console.error('[Evan Anam Configuration] Preflight unavailable');
                return noStoreJson(
                    { error: 'Evan is temporarily unavailable while his configuration is checked.' },
                    { status: 503 },
                );
            }
            if (!personaReadiness.ready) {
                console.error('[Evan Anam Configuration] Out of sync', {
                    personaIdMatches: personaReadiness.personaIdMatches,
                    identityMatches: personaReadiness.identityMatches,
                    cara4AvatarConfigured: personaReadiness.cara4AvatarConfigured,
                    missingToolNames: personaReadiness.missingToolNames,
                    missingPromptMarkers: personaReadiness.missingPromptMarkers,
                });
                return noStoreJson(
                    { error: 'Evan is temporarily unavailable while his configuration is checked.' },
                    { status: 503 },
                );
            }
        }
        if (isDani && daniMemoryConfig.enabled && !daniMemoryConfig.gatesOpen) {
            console.error('[Dani Anam Memory] Enabled but unavailable');
            return noStoreJson(
                { error: 'Dani returning memory is temporarily unavailable' },
                { status: 503 },
            );
        }

        if (isDani) {
            let personaReadiness;
            try {
                personaReadiness = await readDaniPersonaReadiness(anamApiKey);
            } catch {
                console.error('[Dani Anam Configuration] Preflight unavailable');
                return noStoreJson(
                    { error: 'Dani is temporarily unavailable while her configuration is checked.' },
                    { status: 503 },
                );
            }
            if (!personaReadiness.ready) {
                console.error('[Dani Anam Configuration] Out of sync', {
                    personaIdMatches: personaReadiness.personaIdMatches,
                    identityMatches: personaReadiness.identityMatches,
                    publishedRevisionMatches: personaReadiness.publishedRevisionMatches,
                    cara4AvatarConfigured: personaReadiness.cara4AvatarConfigured,
                    avatarIdMatches: personaReadiness.avatarIdMatches,
                    voiceIdMatches: personaReadiness.voiceIdMatches,
                    llmIdMatches: personaReadiness.llmIdMatches,
                    promptHashMatches: personaReadiness.promptHashMatches,
                    voiceDetectionConfigured: personaReadiness.voiceDetectionConfigured,
                    sessionDataRetentionConfigured: personaReadiness.sessionDataRetentionConfigured,
                    anamTranscriptionPipelineConfigured: personaReadiness.anamTranscriptionPipelineConfigured,
                    toolAttachmentMatches: personaReadiness.toolAttachmentMatches,
                    missingToolNames: personaReadiness.missingToolNames,
                    missingPromptMarkers: personaReadiness.missingPromptMarkers,
                });
                return noStoreJson(
                    { error: 'Dani is temporarily unavailable while her configuration is restored.' },
                    { status: 503 },
                );
            }
        }

        if (isAmyCara4) {
            let personaReadiness;
            try {
                personaReadiness = await readAmyCara4PersonaReadiness(
                    resolution.personaId,
                    { apiKey: anamApiKey },
                );
            } catch {
                console.error('[Amy Anam Configuration] Preflight unavailable');
                return noStoreJson(
                    { error: 'Amy configuration validation is temporarily unavailable' },
                    { status: 503 },
                );
            }
            if (!personaReadiness.ready) {
                console.error('[Amy Anam Configuration] Out of sync', {
                    releaseId: personaReadiness.releaseId,
                    deploymentStatus: personaReadiness.deploymentStatus,
                    releaseManifestValid: personaReadiness.releaseManifestValid,
                    releaseManifestPublished: personaReadiness.releaseManifestPublished,
                    releaseManifestComplete: personaReadiness.releaseManifestComplete,
                    knowledgeManifestCrossPinMatches: personaReadiness.knowledgeManifestCrossPinMatches,
                    personaIdMatches: personaReadiness.personaIdMatches,
                    identityMatches: personaReadiness.identityMatches,
                    cara4AvatarConfigured: personaReadiness.cara4AvatarConfigured,
                    avatarIdMatches: personaReadiness.avatarIdMatches,
                    voiceIdMatches: personaReadiness.voiceIdMatches,
                    llmIdMatches: personaReadiness.llmIdMatches,
                    initialMessageMatches: personaReadiness.initialMessageMatches,
                    sessionDataRetentionConfigured: personaReadiness.sessionDataRetentionConfigured,
                    anamTranscriptionPipelineConfigured: personaReadiness.anamTranscriptionPipelineConfigured,
                    toolAttachmentMatches: personaReadiness.toolAttachmentMatches,
                    missingToolNames: personaReadiness.missingToolNames,
                    unexpectedToolNames: personaReadiness.unexpectedToolNames,
                    mismatchedToolNames: personaReadiness.mismatchedToolNames,
                    duplicateToolNames: personaReadiness.duplicateToolNames,
                    duplicateToolIds: personaReadiness.duplicateToolIds,
                    promptMarkerContractMatches: personaReadiness.promptMarkerContractMatches,
                    promptHashPinned: personaReadiness.promptHashPinned,
                    promptHashMatches: personaReadiness.promptHashMatches,
                    missingPromptMarkers: personaReadiness.missingPromptMarkers,
                    duplicatePromptMarkers: personaReadiness.duplicatePromptMarkers,
                    misorderedPromptMarkerPairs: personaReadiness.misorderedPromptMarkerPairs,
                    overlappingPromptMarkerPairs: personaReadiness.overlappingPromptMarkerPairs,
                    knowledgeToolMatches: personaReadiness.knowledgeToolMatches,
                    knowledgeToolIdMatches: personaReadiness.knowledgeToolIdMatches,
                    knowledgeToolNameMatches: personaReadiness.knowledgeToolNameMatches,
                    knowledgeToolTypeMatches: personaReadiness.knowledgeToolTypeMatches,
                    knowledgeDocumentFolderIdsMatch: personaReadiness.knowledgeDocumentFolderIdsMatch,
                    knowledgeGroupMatches: personaReadiness.knowledgeGroupMatches,
                    knowledgeGroupIdMatches: personaReadiness.knowledgeGroupIdMatches,
                    knowledgeGroupNameMatches: personaReadiness.knowledgeGroupNameMatches,
                    knowledgeGroupDescriptionMatches: personaReadiness.knowledgeGroupDescriptionMatches,
                    manifestFailures: personaReadiness.manifestFailures,
                    failedInvariants: personaReadiness.failedInvariants,
                });
                return noStoreJson(
                    { error: 'Amy configuration is out of sync. Please try again after it has been restored.' },
                    { status: 503 },
                );
            }
        }

        let launch: ReturnType<typeof createAmyAnamLaunch> | null = null;
        let browserCookieToken: string | null = null;
        let memoryPolicyContext: string | null = null;
        let memoryUnlockAvailable = false;
        let agentMailAvailable = false;

        if ((isAmyCara4 || isDani || isEvan) && spineConfig.gatesOpen) {
            if (!isTrustedBrowserOrigin(req)) {
                return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
            }

            const ipRate = isAmyCara4 ? { allowed: true, retryAfterSeconds: 0 } : await consumeAmyAnamDistributedRateLimit({
                fingerprint: requestFingerprint(req, 'token'),
                limit: 10,
                windowSeconds: 10 * 60,
            });
            if (!ipRate.allowed) {
                return noStoreJson(
                    { error: 'Too many session starts' },
                    { status: 429, headers: { 'Retry-After': String(ipRate.retryAfterSeconds) } },
                );
            }

            let browserSession = isDani
                ? readDaniAnamBrowserSession(req, daniSessionSecrets.sessionSecret)
                : readAmyAnamBrowserSession(req, spineConfig.signingSecret);
            if (!browserSession && isAmyCara4 && memoryConfig.gatesOpen) {
                return noStoreJson(
                    { error: 'Amy memory check-in is required' },
                    { status: 401 },
                );
            }
            if (!browserSession && isEvan) {
                return noStoreJson(
                    { error: 'Choose an email recap or continue without email first' },
                    { status: 401 },
                );
            }
            if (!browserSession && isDani) {
                return noStoreJson(
                    { error: 'Choose Dani email follow-up or continue without email first' },
                    { status: 401 },
                );
            }
            if (!browserSession) {
                const created = createAmyAnamBrowserSessionWithSecret(spineConfig.signingSecret);
                browserSession = created.session;
                browserCookieToken = created.token;
            }

            if (isAmyCara4 && memoryConfig.gatesOpen) {
                const identity = await readAmyAnamBrowserIdentity(browserSession.id);
                if (!identity) {
                    return noStoreJson(
                        { error: 'Amy memory check-in is required' },
                        { status: 401 },
                    );
                }
                memoryUnlockAvailable = AMY_RETURNING_MEMORY_AVAILABLE && identity.memoryConsent
                    && Boolean(identity.emailIdentityHash);
                memoryPolicyContext = buildAmyAnamMemoryAccessPolicy(memoryUnlockAvailable);
                agentMailAvailable = agentMailConfig.effectiveGateOpen && Boolean(
                    readAmyAnamContactFromRequest({
                        request: req,
                        browserSessionId: browserSession.id,
                        secret: spineConfig.signingSecret,
                    }),
                );
            }
            if (isEvan) {
                const contact = readAmyAnamContactFromRequest({
                    request: req,
                    browserSessionId: browserSession.id,
                    secret: spineConfig.signingSecret,
                });
                agentMailAvailable = evanAgentMailConfig.effectiveGateOpen
                    && contact?.purpose === 'evan_follow_up';
            }
            if (isDani) {
                if (daniMemoryConfig.gatesOpen) {
                    const identity = await readDaniAnamBrowserIdentity(browserSession.id);
                    memoryUnlockAvailable = Boolean(identity?.memoryConsent);
                    memoryPolicyContext = buildDaniAnamMemoryAccessPolicy(memoryUnlockAvailable);
                }
                const contact = readDaniAnamContactFromRequest({
                    request: req,
                    browserSessionId: browserSession.id,
                    secret: daniSessionSecrets.contactSecret,
                });
                agentMailAvailable = daniAgentMailConfig.effectiveGateOpen
                    && contact?.purpose === 'dani_follow_up';
            }

            const browserRate = await consumeAmyAnamDistributedRateLimit({
                fingerprint: `token-browser:${browserSession.id}`,
                limit: 5,
                windowSeconds: 10 * 60,
            });
            if (!browserRate.allowed) {
                const response = noStoreJson(
                    { error: 'Too many session starts' },
                    { status: 429, headers: { 'Retry-After': String(browserRate.retryAfterSeconds) } },
                );
                if (browserCookieToken) {
                    response.cookies.set(
                        AMY_ANAM_BROWSER_COOKIE,
                        browserCookieToken,
                        amyAnamCookieOptions(),
                    );
                }
                return response;
            }

            launch = createAmyAnamLaunch(
                browserSession.id,
                resolution.personaId,
                Date.now(),
                isDani ? 'dani' : isEvan ? 'evan' : 'amy',
            );
            if (!await storeAmyAnamLaunch(launch)) {
                throw new Error('Amy Anam launch could not be reserved');
            }
        }

        let response: Response;
        try {
            response = await fetch('https://api.anam.ai/v1/auth/session-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${anamApiKey}`,
                },
                body: JSON.stringify({
                    ...(launch ? { clientLabel: launch.clientLabel } : {}),
                    personaConfig: {
                        personaId: resolution.personaId,
                    },
                }),
                signal: AbortSignal.timeout(10_000),
            });
        } catch {
            if (launch) await deleteAmyAnamLaunch(launch.launchId).catch(() => undefined);
            throw new Error('Anam session token request failed');
        }

        if (!response.ok) {
            if (launch) await deleteAmyAnamLaunch(launch.launchId).catch(() => undefined);
            console.error('Failed to fetch Anam session token:', { status: response.status });
            return noStoreJson(
                { error: 'Failed to authenticate with Anam' },
                { status: response.status }
            );
        }

        const data = await response.json().catch(() => null);
        if (!data || typeof data.sessionToken !== 'string') {
            if (launch) await deleteAmyAnamLaunch(launch.launchId).catch(() => undefined);
            throw new Error('Anam session token response was invalid');
        }

        const result = noStoreJson({
            sessionToken: data.sessionToken,
            variant: resolution.variant,
            sessionSpineEnabled: Boolean(launch),
            ...(launch ? { launchId: launch.launchId } : {}),
            memoryPolicyContextAvailable: Boolean(memoryPolicyContext),
            memoryUnlockAvailable,
            ...(memoryPolicyContext ? { memoryPolicyContext } : {}),
            agentMailAvailable,
            rawEmailReturned: false,
            identityHashReturned: false,
        });
        if (browserCookieToken) {
            result.cookies.set(
                AMY_ANAM_BROWSER_COOKIE,
                browserCookieToken,
                amyAnamCookieOptions(),
            );
        }
        return result;
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        console.error('[Anam Token] Request failed');
        return noStoreJson(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
