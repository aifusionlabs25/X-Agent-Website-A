import { NextResponse } from 'next/server';
import { ALL_AGENTS } from '@/lib/agents';
import { EVAN_PERSONA_ID, readEvanPersonaReadiness } from '@/lib/anam/persona-readiness';

const ALLOWED_PERSONA_IDS = new Set(ALL_AGENTS.map(agent => agent.personaId).filter(Boolean));

export async function POST(req: Request) {
    try {
        const { personaId } = await req.json();

        if (typeof personaId !== 'string' || !personaId) {
            return NextResponse.json(
                { error: 'Missing personaId in request body' },
                { status: 400 }
            );
        }

        if (!ALLOWED_PERSONA_IDS.has(personaId)) {
            return NextResponse.json(
                { error: 'Unknown agent persona' },
                { status: 403 }
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

        if (personaId === EVAN_PERSONA_ID) {
            try {
                const readiness = await readEvanPersonaReadiness(anamApiKey);
                if (!readiness.ready) {
                    console.error('Evan Anam configuration is out of sync.');
                    return NextResponse.json(
                        { error: 'Evan is temporarily unavailable while his configuration is checked.' },
                        { status: 503 }
                    );
                }
            } catch (error) {
                console.error('Unable to verify Evan Anam configuration:', error);
                return NextResponse.json(
                    { error: 'Evan is temporarily unavailable while his configuration is checked.' },
                    { status: 503 }
                );
            }
        }

        const response = await fetch('https://api.anam.ai/v1/auth/session-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${anamApiKey}`,
            },
            body: JSON.stringify({ personaConfig: { personaId } }),
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
        return NextResponse.json({ sessionToken: data.sessionToken });
    } catch (error) {
        console.error('Error in /api/anam-token:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
