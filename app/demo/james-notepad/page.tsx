import type { Metadata } from 'next';
import JamesCanary from '@/components/james/JamesCanary';

export const metadata: Metadata = { title: 'James — legal pad demo', robots: { index: false, follow: false } };
export default function Page() {
    return <JamesCanary apiPath="/api/james-notepad" storageKey="james-notepad-demo-session-v1" notepadDemo />;
}
