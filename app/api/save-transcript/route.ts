import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { Resend } from 'resend';
import { LLMService } from '@/lib/openai-service';
import { GoogleSheetsService } from '@/lib/google-sheets';
import { escapeHtml } from '@/lib/sanitize-html';
import { ALL_AGENTS } from '@/lib/agents';

// Allow route to run for up to 60 seconds (Vercel max duration)
export const maxDuration = 60;

// Helper removed: We now rely on OpenAI to intelligently extract the visitor email.
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
        const agent = ALL_AGENTS.find(a => a.personaId === personaId);
        const agentName = agent ? agent.name : 'UnknownAgent';
        const agentRole = agent ? agent.role : 'AI Representative';
        const tenantName = agent?.tenant || 'AI Fusion Labs';
        const companyUrl = agent?.companyUrl || 'https://aifusionlabs.com/book-demo';
        const logoSrc = agent?.logoSrc ? `https://raw.githubusercontent.com/aifusionlabs25/X-Agent-Website-A/main/public${encodeURI(agent.logoSrc)}` : null;
        const msgCount = transcript.length;
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
        const sessionDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).format(new Date());

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
        } catch (fsError) {
            console.warn('[Transcript] ⚠️ Running in Vercel Serverless. Bypassing local filesystem write and proceeding with in-memory transcript.', fsError instanceof Error ? fsError.message : String(fsError));
        }

        // ==========================================
        // 2. OPENAI INTELLIGENCE EXTRACTION
        // ==========================================
        if (formattedTranscript.length < 50) {
            console.warn(`[Route] Transcript too short (${formattedTranscript.length} chars). Skipping AI/Email. `);
            return NextResponse.json({ success: true, file: filename }, { status: 200 });
        }

        console.log(`[Route] Commencing AI Analysis on ${formattedTranscript.length} chars...`);
        const llmService = new LLMService();
        const leadData = await llmService.analyzeTranscript(formattedTranscript, agentName);

        if (!leadData) {
            console.error('[Route] ❌ AI Extraction Failed.');
            return NextResponse.json({ success: true, file: filename, error: 'AI Extraction Failed' }, { status: 200 });
        }

        const rawEmail = leadData.visitor_email;
        let visitorEmail = rawEmail ? rawEmail.replace(/\s+/g, '').toLowerCase() : null;
        
        // Simple validation to ensure it looks like an email before trying to send
        if (visitorEmail && !visitorEmail.includes('@')) {
            console.warn(`[Route] ⚠️ Invalid email format extracted: ${visitorEmail}. Nullifying.`);
            visitorEmail = null;
        }

        console.log(`[Route] Extracted/Sanitized Visitor Email: ${visitorEmail || 'None'} (Raw: ${rawEmail || 'None'})`);

        // ==========================================
        // 2.5 GOOGLE SHEETS LOGGING
        // ==========================================
        if (process.env.GOOGLE_SHEET_ID) {
            try {
                const sheetsService = new GoogleSheetsService();
                const success = await sheetsService.appendLead({
                    conversation_id: personaId + '-' + Date.now().toString().slice(-6),
                    lead_name: leadData.visitor_name,
                    lead_email: leadData.visitor_email,
                    lead_phone: leadData.visitor_phone,
                    inquiry_type: leadData.inquiry_type,
                    budget: leadData.budget,
                    timeline: leadData.timeline,
                    qualification_status: leadData.qualification_status,
                    competitors_or_blockers: leadData.competitors_or_blockers,
                    recommended_next_steps: leadData.recommended_next_steps,
                    tavus_recording_url: 'Browser Session (No Video URL)'
                });
                console.log(`[Route] Sheet Append Result: ${success ? 'SUCCESS' : 'FAILURE'}`);
            } catch (sheetErr) {
                console.error('⚠️ [Route] Google Sheets Logging Failed:', sheetErr);
            }
        }

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

        const dateSlug = timestamp.split('T')[0];

        // Output format: 61f0fd3e_Dani_with_rob...2026-02-26.md
        const attachmentFilename = `${personaShortId}_${agentName}_with_${visitorNameSlug}_${dateSlug}.md`;

        const transcriptAttachment = {
            filename: attachmentFilename,
            content: Buffer.from(fileContent, 'utf-8')
        };

        // A. Visitor Thank You (Client Email)
        if (visitorEmail) {
            const visitorHtml = `
        <div style="font-family: sans-serif; padding: 25px; line-height: 1.6; color: #111; max-width: 600px; margin: 0 auto;">
            ${logoSrc ? `<img src="${logoSrc}" alt="${tenantName} Logo" style="max-height: 45px; margin-bottom: 15px;" /><br>` : ''}
            <h2 style="color: #4F46E5; margin-top: 0;">Thanks for chatting!</h2>
            <p style="white-space: pre-line; font-size: 16px;">
                ${escapeHtml(leadData.visitor_recap_message)}
            </p>
            <br>
            <p style="text-align: center; margin-top: 25px;">
                <a href="${companyUrl}" style="background-color: #4F46E5; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Schedule a Human Demo</a>
            </p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0 20px 0;">
            <p style="color: #555; font-size: 0.9em; margin: 0;">
                <strong>${agentName}</strong><br>
                ${agentRole}<br>
                ${tenantName}
            </p>
        </div>
        `;
            await resend.emails.send({
                from: 'AI Fusion Labs <hello@aifusionlabs.app>',
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
                <p style="margin: 4px 0;"><strong>File:</strong> ${attachmentFilename}</p>
                <p style="margin: 4px 0;"><strong>Session Length:</strong> ${msgCount} messages exchanged</p>
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
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px;">
                <div>
                    <h3 style="margin-bottom: 10px; color: #111; font-size: 16px;">👤 Contact Info</h3>
                    <p style="margin: 5px 0;"><strong>Name:</strong> ${escapeHtml(leadData.visitor_name || 'Unknown')}</p>
                    <p style="margin: 5px 0;"><strong>Email:</strong> ${escapeHtml(leadData.visitor_email || 'Unknown')}</p>
                    <p style="margin: 5px 0;"><strong>Phone:</strong> ${escapeHtml(leadData.visitor_phone || 'Unknown')}</p>
                </div>
                <div>
                    <h3 style="margin-bottom: 10px; color: #111; font-size: 16px;">💼 Project Specs</h3>
                    <p style="margin: 5px 0;"><strong>Type:</strong> ${escapeHtml(leadData.inquiry_type || 'Unknown')}</p>
                    <p style="margin: 5px 0;"><strong>Status:</strong> ${escapeHtml(leadData.qualification_status || 'Unknown')}</p>
                    <p style="margin: 5px 0;"><strong>Current Infra:</strong> ${escapeHtml(leadData.current_infrastructure || 'Unknown')}</p>
                </div>
            </div>
            
            <h3 style="color: #111; font-size: 16px;">📦 Hardware / Software Details</h3>
            <div style="background: #f0fdf4; padding: 15px 20px; border-radius: 4px; border: 1px solid #bbf7d0; color: #166534; font-weight: bold; margin-bottom: 25px;">
                ${escapeHtml(leadData.product_details || 'No specific units mentioned.')}
            </div>

            <h3 style="color: #111; font-size: 16px;">💰 Budget & Timeline</h3>
            <ul style="background: #fff; padding: 15px 20px; border-radius: 4px; border: 1px solid #e5e5e5; margin-bottom: 25px;">
                <li><strong>Budget:</strong> ${escapeHtml(leadData.budget || 'Unknown')}</li>
                <li><strong>Timeline:</strong> ${escapeHtml(leadData.timeline || 'Unknown')}</li>
            </ul>

            <h3 style="color: #DC2626; font-size: 16px;">🚧 Blockers / Competitors</h3>
            <ul style="background: #fee2e2; padding: 15px 20px; border-radius: 4px; border: 1px solid #fecaca; color: #991b1b; margin-bottom: 25px;">
                ${leadData.competitors_or_blockers && leadData.competitors_or_blockers.length > 0 ? leadData.competitors_or_blockers.map((r: string) => `<li>${escapeHtml(r)}</li>`).join('') : '<li>No obvious blockers detected.</li>'}
            </ul>

            <div style="margin-bottom: 25px;">
                <h3 style="color: #111; font-size: 16px;">Core Pain Points</h3>
                <ul style="background: #fff; padding: 15px 15px 15px 35px; border-radius: 6px; border: 1px solid #dce2f7; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    ${leadData.pain_points.length > 0 ? leadData.pain_points.map((s: string) => `<li>${escapeHtml(s)}</li>`).join('') : '<li>Unspecified</li>'}
                </ul>
            </div>
            
            <div style="margin-bottom: 25px;">
                <h3 style="color: #111; font-size: 16px;">📋 Recommended Next Steps</h3>
                <ul style="background: #fffbeb; padding: 15px 15px 15px 35px; border-radius: 6px; border: 2px solid #EAB308;">
                    ${leadData.recommended_next_steps && leadData.recommended_next_steps.length > 0 ? leadData.recommended_next_steps.map((step: string) => `<li><strong>${escapeHtml(step)}</strong></li>`).join('') : '<li>None</li>'}
                </ul>
            </div>

            <div style="background: #fffbeb; border: 1px solid #fef08a; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
                <h3 style="color: #b45309; font-size: 16px; margin-top: 0;">Suggested Sales Representative Outreach</h3>
                <p style="white-space: pre-line; color: #78350f; font-style: italic;">
                    ${escapeHtml(leadData.suggested_follow_up_draft)}
                </p>
            </div>
        </div>
        `;

        await resend.emails.send({
            from: 'Lead Intel <intel@aifusionlabs.app>',
            to: internalEmailAddress,
            subject: `[PROSPECT SCORE ${leadData.lead_score}/10] Intelligence Report for ${escapeHtml(leadData.visitor_name || 'Unknown User')}`,
            html: intelHtml
        });
        console.log('✅ [Route] Lead Intel Email Sent.');

        return NextResponse.json({ success: true, file: filename, emails_sent: true }, { status: 200 });

    } catch (error) {
        console.error('Error saving transcript / dispatching emails:', error);
        return NextResponse.json({ error: 'Failed to process session.' }, { status: 500 });
    }
}
