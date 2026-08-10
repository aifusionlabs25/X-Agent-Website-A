import { NextResponse } from 'next/server';
import {
    DANI_ANAM_CONTACT_COOKIE,
    daniAnamContactCookieOptions,
} from '@/lib/anam/contact-token';
import {
    consumeDaniAnamFollowUpOtpChallenge,
    finalizeDaniAnamVerifiedFollowUpAuthorization,
    isDaniAnamFollowUpOtpChallengeId,
} from '@/lib/anam/dani-agentmail';
import {
    DANI_ANAM_GUEST_COOKIE,
    daniAnamSessionCookieOptions,
    readDaniAnamBrowserSession,
    readDaniAnamSessionSecrets,
} from '@/lib/anam/dani-session';
import {
    consumeDaniAnamOtpChallenge,
    readDaniAnamApprovedMemoryHistory,
    readDaniAnamMemoryConfig,
} from '@/lib/anam/dani-user-memory';
import {
    AmyAnamRequestError,
    isTrustedBrowserOrigin,
    readAmyAnamSpineConfig,
    readBoundedJsonObject,
} from '@/lib/anam/session-spine';
import { consumeAmyAnamDistributedRateLimit } from '@/lib/anam/session-spine-store';

function noStoreJson(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

export async function POST(request: Request) {
    let verificationStage = 'request_start';
    try {
        if (!isTrustedBrowserOrigin(request)) {
            return noStoreJson({ error: 'Request origin is not allowed' }, { status: 403 });
        }
        const spine = readAmyAnamSpineConfig();
        const daniSession = readDaniAnamSessionSecrets();
        if (!spine.gatesOpen || !daniSession.configured) {
            return noStoreJson({ error: 'Dani email verification is unavailable' }, { status: 503 });
        }
        const browser = readDaniAnamBrowserSession(request, daniSession.sessionSecret);
        if (!browser) {
            return noStoreJson({ error: 'Dani session ownership is required' }, { status: 401 });
        }
        const body = await readBoundedJsonObject(request, 2 * 1024);
        const allowedFields = new Set(['challengeId', 'verificationCode']);
        if (Object.keys(body).some(key => !allowedFields.has(key))) {
            return noStoreJson({ error: 'Verification request contained unsupported fields' }, { status: 400 });
        }
        const challengeId = typeof body.challengeId === 'string' ? body.challengeId.trim() : '';
        const verificationCode = typeof body.verificationCode === 'string'
            ? body.verificationCode.trim()
            : '';
        const rate = await consumeAmyAnamDistributedRateLimit({
            fingerprint: `dani-email-verify:${browser.id}`,
            limit: 7,
            windowSeconds: 15 * 60,
        });
        if (!rate.allowed) {
            return noStoreJson(
                { error: 'Too many verification attempts' },
                { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
            );
        }
        if (isDaniAnamFollowUpOtpChallengeId(challengeId)) {
            verificationStage = 'consume_follow_up_challenge';
            const result = await consumeDaniAnamFollowUpOtpChallenge({
                challengeId,
                browserSessionId: browser.id,
                verificationCode,
                contactSecret: daniSession.contactSecret,
            });
            if (result.status !== 'verified') {
                return noStoreJson({
                    error: result.status === 'locked'
                        ? 'That code can no longer be used. Request a new one.'
                        : 'The verification code was invalid or expired.',
                    verificationFailed: true,
                    accountExistenceReturned: false,
                }, { status: result.status === 'locked' ? 429 : 400 });
            }
            verificationStage = 'finalize_follow_up_authorization';
            const verifiedFollowUp = await finalizeDaniAnamVerifiedFollowUpAuthorization({
                browserSessionId: browser.id,
                contactToken: result.contactToken,
                contactSecret: daniSession.contactSecret,
            });
            if (!verifiedFollowUp.authorizationStored) {
                // The same encrypted, HttpOnly token is returned as a cookie below. The
                // Redis copy is only a handoff fallback and must not strand a visitor
                // after their one-time code has already been consumed.
                console.warn('[Dani Anam Follow-up Verification] Server handoff deferred', {
                    contactContentLogged: false,
                });
            }
            const response = noStoreJson({
                authenticated: true,
                verificationRequired: false,
                displayName: verifiedFollowUp.contact.displayName,
                memoryVerified: false,
                memoryCount: null,
                lastMemoryAt: null,
                followUpAuthorized: true,
                followUpAuthorizationStored: verifiedFollowUp.authorizationStored,
                secureEmailCaptured: true,
                guest: false,
                rawEmailReturned: false,
                identityHashReturned: false,
                memoryContentReturned: false,
                verificationCodeReturned: false,
            });
            response.cookies.set(
                DANI_ANAM_CONTACT_COOKIE,
                verifiedFollowUp.contactToken,
                daniAnamContactCookieOptions(),
            );
            response.cookies.set(DANI_ANAM_GUEST_COOKIE, '', daniAnamSessionCookieOptions(0));
            verificationStage = 'follow_up_complete';
            return response;
        }

        verificationStage = 'read_memory_configuration';
        const memory = readDaniAnamMemoryConfig();
        if (!memory.gatesOpen) {
            return noStoreJson({ error: 'Dani returning memory is unavailable' }, { status: 503 });
        }
        const result = await consumeDaniAnamOtpChallenge({
            challengeId,
            browserSessionId: browser.id,
            verificationCode,
        });
        if (result.status !== 'verified') {
            return noStoreJson({
                error: result.status === 'locked'
                    ? 'That code can no longer be used. Request a new one.'
                    : 'The verification code was invalid or expired.',
                verificationFailed: true,
                accountExistenceReturned: false,
            }, { status: result.status === 'locked' ? 429 : 400 });
        }

        const verifiedFollowUp = result.encryptedFollowUpToken
            ? await finalizeDaniAnamVerifiedFollowUpAuthorization({
                browserSessionId: browser.id,
                contactToken: result.encryptedFollowUpToken,
                contactSecret: daniSession.contactSecret,
            })
            : null;
        if (verifiedFollowUp && !verifiedFollowUp.authorizationStored) {
            // The encrypted, HttpOnly contact cookie below remains the authoritative
            // handoff. A transient Redis write must not consume the one-time code and
            // strand an otherwise verified visitor.
            console.warn('[Dani Anam Memory Verification] Server follow-up handoff deferred', {
                contactContentLogged: false,
            });
        }
        const history = await readDaniAnamApprovedMemoryHistory(result.identity);
        const response = noStoreJson({
            authenticated: true,
            verificationRequired: false,
            displayName: result.identity.displayName,
            memoryVerified: true,
            memoryCount: history.length,
            lastMemoryAt: history[0]?.approvedAt ?? null,
            followUpAuthorized: Boolean(verifiedFollowUp),
            followUpAuthorizationStored: verifiedFollowUp?.authorizationStored ?? false,
            secureEmailCaptured: Boolean(verifiedFollowUp),
            guest: false,
            rawEmailReturned: false,
            identityHashReturned: false,
            memoryContentReturned: false,
            verificationCodeReturned: false,
        });
        if (verifiedFollowUp) {
            response.cookies.set(
                DANI_ANAM_CONTACT_COOKIE,
                verifiedFollowUp.contactToken,
                daniAnamContactCookieOptions(),
            );
        } else {
            response.cookies.set(DANI_ANAM_CONTACT_COOKIE, '', daniAnamContactCookieOptions(0));
        }
        response.cookies.set(DANI_ANAM_GUEST_COOKIE, '', daniAnamSessionCookieOptions(0));
        return response;
    } catch (error) {
        if (error instanceof AmyAnamRequestError) {
            return noStoreJson({ error: error.message }, { status: error.status });
        }
        console.error('[Dani Anam Memory Verification] Failed', {
            stage: verificationStage,
            reason: error instanceof Error ? error.message : 'unknown_error',
            sensitiveContentLogged: false,
        });
        return noStoreJson({ error: 'Dani email verification failed' }, { status: 500 });
    }
}
