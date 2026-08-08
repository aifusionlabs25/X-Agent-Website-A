import { Resend } from 'resend';
import { NextResponse } from 'next/server';
import { parseBetaSignup } from '@/lib/beta-signup';
import { escapeHtml } from '@/lib/sanitize-html';

export async function POST(req: Request) {
    try {
        if (!process.env.RESEND_API_KEY) {
            console.error('RESEND_API_KEY is not defined.');
            return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
        }
        const resend = new Resend(process.env.RESEND_API_KEY);

        const signup = parseBetaSignup(await req.json());
        if (!signup) {
            return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
        }

        const { name, email, company, useCase } = signup;

        const safeName = escapeHtml(name);
        const safeEmail = escapeHtml(email);
        const safeCompany = escapeHtml(company);
        const safeUseCase = escapeHtml(useCase);

        const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #333; max-width: 600px;">
            <div style="border-bottom: 2px solid #4F46E5; padding-bottom: 15px; margin-bottom: 20px;">
                <h2 style="color: #4F46E5; margin: 0;">🚀 New Beta Pilot Sign-Up</h2>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 8px 12px; font-weight: bold; color: #555; width: 140px;">Name</td>
                    <td style="padding: 8px 12px;">${safeName}</td>
                </tr>
                <tr style="background: #f9f9f9;">
                    <td style="padding: 8px 12px; font-weight: bold; color: #555;">Email</td>
                    <td style="padding: 8px 12px;"><a href="mailto:${safeEmail}" style="color: #4F46E5;">${safeEmail}</a></td>
                </tr>
                <tr>
                    <td style="padding: 8px 12px; font-weight: bold; color: #555;">Company / Role</td>
                    <td style="padding: 8px 12px;">${safeCompany}</td>
                </tr>
                <tr style="background: #f9f9f9;">
                    <td style="padding: 8px 12px; font-weight: bold; color: #555;">Use Case</td>
                    <td style="padding: 8px 12px;">${safeUseCase}</td>
                </tr>
            </table>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 0.85em;">This lead came from the X Agents Beta Sign-Up form at xagent.aifusionlabs.app</p>
        </div>
        `;

        const { error } = await resend.emails.send({
            from: 'X Agents Beta <alerts@aifusionlabs.app>',
            to: ['aifusionlabs@gmail.com'],
            replyTo: email,
            subject: `[BETA SIGNUP] ${name} — ${company}`,
            html,
        });

        if (error) {
            console.error('Beta signup delivery failed:', error);
            return NextResponse.json({ error: 'Failed to submit.' }, { status: 502 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Beta signup error:', error);
        return NextResponse.json({ error: 'Failed to submit.' }, { status: 500 });
    }
}
