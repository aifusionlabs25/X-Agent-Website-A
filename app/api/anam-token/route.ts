import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { personaId } = await req.json();

        if (!personaId) {
            return NextResponse.json(
                { error: 'Missing personaId in request body' },
                { status: 400 }
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
                    personaId: personaId
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
        return NextResponse.json({ sessionToken: data.sessionToken });
    } catch (error) {
        console.error('Error in /api/anam-token:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
