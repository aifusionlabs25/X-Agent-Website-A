import { NextResponse } from 'next/server';
import { LLMService } from '@/lib/openai-service';

export async function POST(req: Request) {
    try {
        const { transcript, model, provider } = await req.json();

        if (!transcript) {
            return NextResponse.json({ error: 'Missing transcript' }, { status: 400 });
        }

        console.log(`[Eval API] Running evaluation for model: ${model || 'default'} on provider: ${provider || 'default'}`);

        // Temporarily override env vars or pass them to constructor if we wanted more flexibility
        // For now, LLMService uses the priority: NVIDIA -> Local -> OpenAI
        const llmService = new LLMService();
        
        const leadData = await llmService.analyzeTranscript(transcript, 'the Agent', {
            model: model,
            provider: provider
        });

        if (!leadData) {
            return NextResponse.json({ error: 'Evaluation failed to return data' }, { status: 500 });
        }

        return NextResponse.json({ 
            success: true, 
            data: leadData,
            provider: provider || 'nvidia', // Defaulting to nvidia for now
            model: model || 'meta/llama-3.1-70b-instruct'
        });

    } catch (error) {
        console.error('[Eval API] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
