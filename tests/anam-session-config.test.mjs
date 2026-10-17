import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
    AMY_CARA4_VARIANT,
    AMY_PUBLIC_PERSONA_ID,
    isAmyCara4Variant,
    resolveAnamSessionPersona,
} from '../lib/anam/session-config.ts';

const TAYLOR_PERSONA_ID = '4183f1fe-9922-4ef5-ad47-9b1949dfdaa4';
const CANARY_PERSONA_ID = '11111111-2222-4333-8444-555555555555';
const allowedPersonaIds = [AMY_PUBLIC_PERSONA_ID, TAYLOR_PERSONA_ID];

test('all default Amy requests resolve to the protected configuration', () => {
    for (const requestedVariant of [undefined, null, '', '   ']) {
        assert.deepEqual(resolveAnamSessionPersona({
            requestedPersonaId: AMY_PUBLIC_PERSONA_ID,
            requestedVariant,
            allowedPersonaIds,
            amyCara4PersonaId: CANARY_PERSONA_ID,
        }), {
            ok: true,
            personaId: CANARY_PERSONA_ID,
            variant: AMY_CARA4_VARIANT,
        });
    }
});

test('other agents retain their existing default configuration', () => {
    assert.deepEqual(resolveAnamSessionPersona({
        requestedPersonaId: TAYLOR_PERSONA_ID,
        requestedVariant: undefined,
        allowedPersonaIds,
        amyCara4PersonaId: CANARY_PERSONA_ID,
    }), { ok: true, personaId: TAYLOR_PERSONA_ID });
});

test('missing Amy configuration never falls back to the legacy public persona', () => {
    for (const amyCara4PersonaId of [undefined, '', AMY_PUBLIC_PERSONA_ID]) {
        const result = resolveAnamSessionPersona({
            requestedPersonaId: AMY_PUBLIC_PERSONA_ID,
            requestedVariant: undefined,
            allowedPersonaIds,
            amyCara4PersonaId,
        });
        assert.equal(result.ok, false);
        assert.equal(result.status, 503);
    }
});

test('malformed variants cannot select a default session', () => {
    for (const requestedVariant of [false, 0, {}, [], ['amy-cara4']]) {
        const result = resolveAnamSessionPersona({
            requestedPersonaId: AMY_PUBLIC_PERSONA_ID,
            requestedVariant,
            allowedPersonaIds,
            amyCara4PersonaId: CANARY_PERSONA_ID,
        });
        assert.equal(result.ok, false);
        assert.equal(result.status, 400);
    }
});

test('the Amy-only canary resolves to its server-side persona ID', () => {
    assert.deepEqual(resolveAnamSessionPersona({
        requestedPersonaId: AMY_PUBLIC_PERSONA_ID,
        requestedVariant: AMY_CARA4_VARIANT,
        allowedPersonaIds,
        amyCara4PersonaId: ` ${CANARY_PERSONA_ID} `,
    }), {
        ok: true,
        personaId: CANARY_PERSONA_ID,
        variant: AMY_CARA4_VARIANT,
    });
});

test('the canary fails closed when its server-side ID is missing', () => {
    const result = resolveAnamSessionPersona({
        requestedPersonaId: AMY_PUBLIC_PERSONA_ID,
        requestedVariant: AMY_CARA4_VARIANT,
        allowedPersonaIds,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
});

test('the Amy canary cannot be applied to another agent', () => {
    const result = resolveAnamSessionPersona({
        requestedPersonaId: TAYLOR_PERSONA_ID,
        requestedVariant: AMY_CARA4_VARIANT,
        allowedPersonaIds,
        amyCara4PersonaId: CANARY_PERSONA_ID,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
});

test('unregistered personas and unknown variants are rejected', () => {
    const unregistered = resolveAnamSessionPersona({
        requestedPersonaId: CANARY_PERSONA_ID,
        requestedVariant: undefined,
        allowedPersonaIds,
        amyCara4PersonaId: CANARY_PERSONA_ID,
    });
    const unknownVariant = resolveAnamSessionPersona({
        requestedPersonaId: AMY_PUBLIC_PERSONA_ID,
        requestedVariant: 'cara-4-latest',
        allowedPersonaIds,
        amyCara4PersonaId: CANARY_PERSONA_ID,
    });

    assert.equal(unregistered.ok, false);
    assert.equal(unregistered.status, 403);
    assert.equal(unknownVariant.ok, false);
    assert.equal(unknownVariant.status, 400);
    assert.equal(isAmyCara4Variant(AMY_CARA4_VARIANT), true);
    assert.equal(isAmyCara4Variant('cara4'), false);
});

test('Amy behavior upgrade is provider-neutral and contains the current guardrails', async () => {
    const prompt = await fs.readFile(
        new URL('../config/anam/amy-cara4-behavior-upgrade.md', import.meta.url),
        'utf8',
    );

    assert.match(prompt, /Discovery comes before prescription/i);
    assert.match(prompt, /desired outcome to relevant context, then to the constraint/i);
    assert.doesNotMatch(prompt, /at least three confirmed facts/i);
    assert.match(prompt, /visitor-reported context, not application confirmation/i);
    assert.match(prompt, /no connected calendar availability/i);
    assert.match(prompt, /Use the visitor's name sparingly/i);
    assert.match(prompt, /Autopilot or remote deployment/i);
    assert.doesNotMatch(prompt, /Tavus|VoiceMeeter|end_call|show_session_brief|response_to_user/i);
});
