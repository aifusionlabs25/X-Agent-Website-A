import { NextResponse } from 'next/server';
import { ALL_AGENTS } from '@/lib/agents';
import { readJamesPersonaReadiness } from '@/lib/anam/james-persona-readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
    const james = ALL_AGENTS.find(agent => agent.slug === 'james');
    const apiKey = process.env.ANAM_API_KEY?.trim();
    if (!james || !apiKey) {
        return NextResponse.json({ ready: false, error: 'James readiness is unavailable' }, {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
        });
    }

    try {
        const readiness = await readJamesPersonaReadiness(james.personaId, { apiKey });
        return NextResponse.json(readiness, {
            status: readiness.ready ? 200 : 503,
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch {
        return NextResponse.json({ ready: false, error: 'James readiness validation failed' }, {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
        });
    }
}
