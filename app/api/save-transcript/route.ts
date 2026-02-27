import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { Resend } from 'resend';
import { OpenAIService } from '@/lib/openai-service';
import { escapeHtml } from '@/lib/sanitize-html';

// Allow route to run for up to 60 seconds (Vercel max duration)
export const maxDuration = 60;

// Voice Email Extraction Helper
function extractConfirmedEmail(transcriptText: string): string | null {
    const match = transcriptText.match(/I heard\s+(.*?)(?:is that right|\?|$)/i);
    if (match && match[1]) {
        let email = match[1].toLowerCase().trim();
        email = email.replace(/^[.,!?]+|[.,!?]+$/g, '');
        email = email.replace(/(?:\b|\s+)at(?:\b|\s+)/g, '@');
        email = email.replace(/(?:\b|\s+)dot(?:\b|\s+)/g, '.');
        email = email.replace(/\s+/g, '');
        if (email.includes('@') && email.includes('.')) {
            return email;
        }
    }
    return null;
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { personaId, transcript } = body;

        if (!transcript || !Array.isArray(transcript)) {
            return NextResponse.json({ error: 'Invalid transcript format.' }, { status: 400 });
        }

        if (transcript.length === 0) {
            return NextResponse.json({ message: 'Transcript was empty, nothing to save.' }, { status: 200 });
        }

        // ==========================================
        // 1. SAVE LOCAL TRANSCRIPT FILE
        // ==========================================
        const formattedTranscript = transcript.map(entry => {
            const roleLabel = entry.role === 'user' ? 'User' : 'Agent';
            return `**[${roleLabel}]**: ${entry.content}\n`;
        }).join('\n');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `transcript_${personaId || 'unknown'}_${timestamp}.md`;
        let filePath = 'In-Memory (Vercel Production)';
        const sessionDate = new Date().toLocaleString();

        const fileContent = `# Anam Session Transcript
**Date:** ${sessionDate}  
**Persona ID:** ${personaId || 'Unknown'}

## Conversation Log
${formattedTranscript}

---
*Session Ended*
`;

        try {
            const dirPath = path.join(process.cwd(), 'transcripts');
            await fs.mkdir(dirPath, { recursive: true });
            filePath = path.join(dirPath, filename);

            await fs.writeFile(filePath, fileContent, 'utf-8');
            console.log(`[Transcript Saved] -> ${filePath}`);
        } catch (fsError: any) {
            console.warn('[Transcript] ⚠️ Running in Vercel Serverless. Bypassing local filesystem write and proceeding with in-memory transcript.', fsError.message);
        }

        // ==========================================
        // 2. OPENAI INTELLIGENCE EXTRACTION
        // ==========================================
        if (formattedTranscript.length < 50) {
            console.warn(`[Route] Transcript too short (${formattedTranscript.length} chars). Skipping AI/Email. `);
            return NextResponse.json({ success: true, file: filename }, { status: 200 });
        }

        console.log(`[Route] Commencing AI Analysis on ${formattedTranscript.length} chars...`);
        const aiService = new OpenAIService();
        const leadData = await aiService.analyzeTranscript(formattedTranscript);

        if (!leadData) {
            console.error('[Route] ❌ AI Extraction Failed.');
            return NextResponse.json({ success: true, file: filename, error: 'AI Extraction Failed' }, { status: 200 });
        }

        const visitorEmail = extractConfirmedEmail(formattedTranscript);
        console.log(`[Route] Extracted Visitor Email: ${visitorEmail || 'None'}`);

        // ==========================================
        // 3. DISPATCH EMAILS (RESEND)
        // ==========================================
        if (!process.env.RESEND_API_KEY) {
            console.error('❌ [Route] RESEND_API_KEY missing.');
            return NextResponse.json({ success: true, file: filename, error: 'Resend Key Missing' }, { status: 200 });
        }

        const resend = new Resend(process.env.RESEND_API_KEY);
        const internalEmailAddress = 'aifusionlabs@gmail.com';

        // Format a dynamic, descriptive filename for LLM data ingestion
        const visitorNameSlug = leadData.visitor_name
            ? leadData.visitor_name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
            : 'unknown_visitor';

        // Extract just the first section of the UUID for cleaner filenames (e.g. 61f0fd3e)
        const personaShortId = personaId ? personaId.split('-')[0] : 'unknown_id';
        // Hardcoding the agent name 'Dani' for this specific campaign, but this could be dynamic in the future
        const agentName = 'Dani';

        const dateSlug = timestamp.split('T')[0];

        // Output format: 61f0fd3e_Dani_with_rob_at_ai_fusion_labs_2026-02-26.md
        const attachmentFilename = `${personaShortId}_${agentName}_with_${visitorNameSlug}_${dateSlug}.md`;

        const transcriptAttachment = {
            filename: attachmentFilename,
            content: Buffer.from(fileContent, 'utf-8')
        };

        // A. Visitor Thank You (Client Email)
        if (visitorEmail) {
            const visitorHtml = `
            <div style="font-family: sans-serif; padding: 25px; line-height: 1.6; color: #111; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #4F46E5; margin-top: 0;">Thanks for chatting!</h2>
                <p style="white-space: pre-line; font-size: 16px;">
                    ${escapeHtml(leadData.visitor_recap_message)}
                </p>
                <br>
                <p style="text-align: center; margin-top: 25px;">
                    <a href="https://aifusionlabs.com/book-demo" style="background-color: #4F46E5; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Schedule a Human Demo</a>
                </p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0 20px 0;">
                <p style="color: #555; font-size: 0.9em; margin: 0;">
                    <strong>Dani</strong><br>
                    X-Agent Director<br>
                    AI Fusion Labs
                </p>
            </div>
            `;
            await resend.emails.send({
                from: 'Dani at AI Fusion Labs <hello@aifusionlabs.app>',
                to: [visitorEmail],
                subject: `Thanks for testing X-Agents!`,
                html: visitorHtml,
                attachments: [transcriptAttachment]
            });
            console.log('✅ [Route] Client Email Sent to', visitorEmail);
        }

        // B. Internal Session Summary (Session Email)
        const summaryHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.5; color: #333; background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px;">
            <div style="border-bottom: 2px solid #4F46E5; padding-bottom: 15px; margin-bottom: 20px;">
                <h2 style="color: #4F46E5; margin: 0;">X-Agent Session Summary</h2>
            </div>
            <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #eee; margin-bottom: 20px;">
                <p style="margin: 4px 0;"><strong>Date:</strong> ${sessionDate}</p>
                <p style="margin: 4px 0;"><strong>File:</strong> ${filename}</p>
            </div>
            <h3 style="color: #111; font-size: 16px;">TL;DR</h3>
            <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #eee; margin-bottom: 20px;">
                ${escapeHtml(leadData.tldr_summary)}
            </div>
            <h3 style="color: #111; font-size: 16px;">Top Questions Asked</h3>
            <ul style="background: #fff; padding: 15px 15px 15px 35px; border-radius: 6px; border: 1px solid #eee; margin-bottom: 20px;">
                ${leadData.top_questions.length > 0 ? leadData.top_questions.map((q: string) => `<li>${escapeHtml(q)}</li>`).join('') : '<li>None</li>'}
            </ul>
        </div>
        `;
        await resend.emails.send({
            from: 'Session Alerts <alerts@aifusionlabs.app>',
            to: internalEmailAddress,
            subject: `[SESSION END] X-Agent Chat Ended`,
            html: summaryHtml,
            attachments: [transcriptAttachment]
        });
        console.log('✅ [Route] Session Summary Email Sent.');

        // C. Internal Lead Intel (Lead Email)
        const scoreColor = leadData.lead_score >= 8 ? '#16a34a' : (leadData.lead_score >= 5 ? '#ca8a04' : '#dc2626');
        const intelHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.5; color: #333; background-color: #f0fdf4; border: 2px solid ${scoreColor}; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #ddd; padding-bottom: 15px; margin-bottom: 20px;">
                <h2 style="color: #111; margin: 0;">New Lead Intelligence</h2>
                <div style="text-align: right;">
                    <span style="font-size: 12px; text-transform: uppercase; color: #666; font-weight: bold;">Lead Score</span><br>
                    <span style="font-size: 28px; font-weight: 900; color: ${scoreColor};">${leadData.lead_score}/10</span>
                </div>
            </div>
            <div style="margin-bottom: 25px;">
                <h3 style="color: #111; font-size: 16px;">Intent Signals</h3>
                <ul style="background: #fff; padding: 15px 15px 15px 35px; border-radius: 6px; border: 1px solid #dce2f7; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    ${leadData.intent_signals.length > 0 ? leadData.intent_signals.map((s: string) => `<li><strong>${escapeHtml(s)}</strong></li>`).join('') : '<li>Weak Intent</li>'}
                </ul>
            </div>
            <div style="margin-bottom: 25px;">
                <h3 style="color: #111; font-size: 16px;">Core Pain Points</h3>
                <ul style="background: #fff; padding: 15px 15px 15px 35px; border-radius: 6px; border: 1px solid #dce2f7; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    ${leadData.pain_points.length > 0 ? leadData.pain_points.map((s: string) => `<li>${escapeHtml(s)}</li>`).join('') : '<li>Unspecified</li>'}
                </ul>
            </div>
            <div style="background: #fffbeb; border: 1px solid #fef08a; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
                <h3 style="color: #b45309; font-size: 16px; margin-top: 0;">Suggested Sales Representative Outreach</h3>
                <p style="white-space: pre-line; color: #78350f; font-style: italic;">
                    "${escapeHtml(leadData.suggested_follow_up_draft)}"
                </p>
            </div>
        </div>
        `;

        await resend.emails.send({
            from: 'Lead Intel <intel@aifusionlabs.app>',
            to: internalEmailAddress,
            subject: `[PROSPECT SCORE ${leadData.lead_score}/10] Intelligence Report`,
            html: intelHtml
        });
        console.log('✅ [Route] Lead Intel Email Sent.');

        return NextResponse.json({ success: true, file: filename, emails_sent: true }, { status: 200 });

    } catch (error) {
        console.error('Error saving transcript / dispatching emails:', error);
        return NextResponse.json({ error: 'Failed to process session.' }, { status: 500 });
    }
}
