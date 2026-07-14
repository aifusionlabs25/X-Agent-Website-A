import { NextResponse } from 'next/server';
import { ALL_AGENTS } from '@/lib/agents';
import { resolveAnamSessionPersona } from '@/lib/anam/session-config';

export async function POST(req: Request) {
    try {
        const { personaId, variant } = await req.json();
        const resolution = resolveAnamSessionPersona({
            requestedPersonaId: personaId,
            requestedVariant: variant,
            allowedPersonaIds: ALL_AGENTS.map(agent => agent.personaId),
            amyCara4PersonaId: process.env.ANAM_AMY_CARA4_PERSONA_ID,
        });

        if (!resolution.ok) {
            return NextResponse.json(
                { error: resolution.error },
                { status: resolution.status }
            );
        }

        const anamApiKey = process.env.ANAM_API_KEY;

        if (!anamApiKey) {
            console.error('Missing ANAM_API_KEY environment variable.');
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 500 }
            );
        }

        const response = await fetch('https://api.anam.ai/v1/auth/session-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${anamApiKey}`,
            },
            body: JSON.stringify({
                personaConfig: {
                    personaId: resolution.personaId
                }
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to fetch Anam session token:', errorText);
            return NextResponse.json(
                { error: 'Failed to authenticate with Anam' },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json({
            sessionToken: data.sessionToken,
            variant: resolution.variant,
        });
    } catch (error) {
        console.error('Error in /api/anam-token:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
