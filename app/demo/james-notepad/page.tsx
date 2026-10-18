import type { Metadata } from 'next';
import { connection } from 'next/server';
import JamesCanary from '@/components/james/JamesCanary';
import { readAmyAnamSpineConfig } from '@/lib/anam/session-spine';
import { readDemoAccessMode } from '@/lib/james-canary/demo-email';
import { jamesNotesFont } from '@/components/james/presentation-font';
import AgentAccessGate from '@/components/access/AgentAccessGate';

export const metadata: Metadata = {
    title: 'James — AI Intake Demo',
    description: 'Meet James, an AI intake demo that turns a conversation into a legal pad. Try fictional details only. Not legal advice.',
    openGraph: {
        title: 'James — AI Intake Demo',
        description: 'Meet James, an AI intake demo that turns a conversation into a legal pad. Try fictional details only. Not legal advice.',
        siteName: 'AI Fusion Labs',
        type: 'website',
    },
    twitter: {
        card: 'summary',
        title: 'James — AI Intake Demo',
        description: 'Meet James, an AI intake demo that turns a conversation into a legal pad. Try fictional details only. Not legal advice.',
    },
    robots: { index: false, follow: false },
};
export default async function Page() {
    await connection();
    const launchReady = readAmyAnamSpineConfig().gatesOpen && Boolean(process.env.ANAM_API_KEY);
    return <AgentAccessGate agent="james"><JamesCanary apiPath="/api/james-notepad" storageKey="james-notepad-session-v2" notepadDemo launchReady={launchReady} emailAccessMode={readDemoAccessMode()} publicPresentation notesFontClassName={jamesNotesFont.variable} /></AgentAccessGate>;
}
