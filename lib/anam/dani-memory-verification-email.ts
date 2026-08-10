import { sendAmyEmailWithAgentMail } from '../email/amy-email-provider.ts';
import { readDaniAnamAgentMailConfig } from './dani-agentmail.ts';

type VerificationEmailOptions = {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
};

export async function sendDaniAnamMemoryVerificationEmail(input: {
    email: string;
    verificationCode: string;
    scope?: 'follow_up' | 'memory' | 'memory_and_follow_up';
}, options: VerificationEmailOptions = {}) {
    if (!/^\d{6}$/.test(input.verificationCode)) {
        throw new Error('Dani memory verification code was invalid');
    }
    const config = readDaniAnamAgentMailConfig(options.env ?? process.env);
    if (!config.effectiveGateOpen) throw new Error('Dani memory verification email is unavailable');
    const code = input.verificationCode;
    const purpose = input.scope === 'follow_up'
        ? 'verify your email before Dani sends your post-session follow-up'
        : input.scope === 'memory_and_follow_up'
            ? 'verify your email for Dani returning memory and your post-session follow-up'
            : 'verify your email for Dani returning memory';
    return sendAmyEmailWithAgentMail({
        to: input.email,
        subject: 'Your Dani verification code',
        text: [
            `Use this one-time code to ${purpose}:`,
            '',
            code,
            '',
            'The code expires in 10 minutes. If you did not request it, you can ignore this message.',
            '',
            'AI Fusion Labs',
        ].join('\n'),
        html: [
            '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#172033">',
            `<p>Use this one-time code to ${purpose}:</p>`,
            `<p style="font-size:28px;font-weight:700;letter-spacing:8px;margin:24px 0">${code}</p>`,
            '<p>The code expires in 10 minutes. If you did not request it, you can ignore this message.</p>',
            '<p style="color:#667085">AI Fusion Labs</p>',
            '</div>',
        ].join(''),
    }, {
        fetchImpl: options.fetchImpl,
        env: config.providerEnv,
    });
}
