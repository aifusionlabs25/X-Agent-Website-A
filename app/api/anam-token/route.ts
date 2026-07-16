import { NextResponse } from 'next/server';
import { ALL_AGENTS } from '@/lib/agents';
import { AMY_CARA4_VARIANT, resolveAnamSessionPersona } from '@/lib/anam/session-config';
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
            allowedPersonaIds: ALL_AGENTS.map(agent => agent.personaId),
            amyCara4PersonaId: process.env.ANAM_AMY_CARA4_PERSONA_ID,
        });

        if (!resolution.ok) {
            return noStoreJson(
                { error: resolution.error },
                { status: resolution.status }
            );
        }

        const spineConfig = readAmyAnamSpineConfig();
        const memoryConfig = readAmyAnamMemoryConfig();
        const isAmyCara4 = resolution.variant === AMY_CARA4_VARIANT;
        if (isAmyCara4 && spineConfig.enabled && !spineConfig.gatesOpen) {
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

        let launch: ReturnType<typeof createAmyAnamLaunch> | null = null;
        let browserCookieToken: string | null = null;
        let memoryPolicyContext: string | null = null;
        let memoryUnlockAvailable = false;

        if (isAmyCara4 && spineConfig.gatesOpen) {
            if (!isTrustedBrowserOrigin(req)) {
                return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
            }

            const ipRate = await consumeAmyAnamDistributedRateLimit({
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

            let browserSession = readAmyAnamBrowserSession(req, spineConfig.signingSecret);
            if (!browserSession && memoryConfig.gatesOpen) {
                return noStoreJson(
                    { error: 'Amy memory check-in is required' },
                    { status: 401 },
                );
            }
            if (!browserSession) {
                const created = createAmyAnamBrowserSessionWithSecret(spineConfig.signingSecret);
                browserSession = created.session;
                browserCookieToken = created.token;
            }

            if (memoryConfig.gatesOpen) {
                const identity = await readAmyAnamBrowserIdentity(browserSession.id);
                if (!identity) {
                    return noStoreJson(
                        { error: 'Amy memory check-in is required' },
                        { status: 401 },
                    );
                }
                memoryUnlockAvailable = identity.memoryConsent
                    && Boolean(identity.emailIdentityHash);
                memoryPolicyContext = buildAmyAnamMemoryAccessPolicy(memoryUnlockAvailable);
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

            launch = createAmyAnamLaunch(browserSession.id, resolution.personaId);
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
