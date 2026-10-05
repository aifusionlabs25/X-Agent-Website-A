import type { Metadata } from 'next';
import { connection } from 'next/server';
import JamesCanary from '@/components/james/JamesCanary';
import { readAmyAnamSpineConfig } from '@/lib/anam/session-spine';
import { readDemoAccessMode } from '@/lib/james-canary/demo-email';

export const metadata: Metadata = { title: 'James — legal pad demo', robots: { index: false, follow: false } };
export default async function Page() {
    await connection();
    const launchReady = readAmyAnamSpineConfig().gatesOpen && Boolean(process.env.ANAM_API_KEY);
    return <JamesCanary apiPath="/api/james-notepad" storageKey="james-notepad-session-v2" notepadDemo launchReady={launchReady} emailAccessMode={readDemoAccessMode()} />;
}
