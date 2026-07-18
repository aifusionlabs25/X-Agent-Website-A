export const AMY_PUBLIC_PERSONA_ID = '8c7d5b42-b17e-4321-8bfa-381c8d93820f';
export const AMY_CARA4_VARIANT = 'amy-cara4';

type ResolveAnamSessionPersonaOptions = {
    requestedPersonaId: unknown;
    requestedVariant: unknown;
    allowedPersonaIds: Iterable<string>;
    amyCara4PersonaId?: string;
};

export type AnamPersonaResolution =
    | {
        ok: true;
        personaId: string;
        variant?: typeof AMY_CARA4_VARIANT;
    }
    | {
        ok: false;
        status: 400 | 403 | 503;
        error: string;
    };

export function resolveAnamSessionPersona({
    requestedPersonaId,
    requestedVariant,
    allowedPersonaIds,
    amyCara4PersonaId,
}: ResolveAnamSessionPersonaOptions): AnamPersonaResolution {
    const personaId = typeof requestedPersonaId === 'string'
        ? requestedPersonaId.trim()
        : '';

    if (!personaId) {
        return { ok: false, status: 400, error: 'Missing personaId in request body' };
    }

    const allowed = new Set(allowedPersonaIds);
    if (!allowed.has(personaId)) {
        return { ok: false, status: 403, error: 'Persona is not available on this site' };
    }

    const variant = typeof requestedVariant === 'string'
        ? requestedVariant.trim()
        : '';

    if (!variant) {
        return { ok: true, personaId };
    }

    if (variant !== AMY_CARA4_VARIANT) {
        return { ok: false, status: 400, error: 'Unsupported Anam session variant' };
    }

    if (personaId !== AMY_PUBLIC_PERSONA_ID) {
        return { ok: false, status: 400, error: 'The Cara 4 canary is available only for Amy' };
    }

    const canaryPersonaId = amyCara4PersonaId?.trim();
    if (!canaryPersonaId || canaryPersonaId === AMY_PUBLIC_PERSONA_ID) {
        return { ok: false, status: 503, error: 'Amy Cara 4 canary is not configured' };
    }

    return {
        ok: true,
        personaId: canaryPersonaId,
        variant: AMY_CARA4_VARIANT,
    };
}

export function isAmyCara4Variant(value: unknown): value is typeof AMY_CARA4_VARIANT {
    return value === AMY_CARA4_VARIANT;
}
