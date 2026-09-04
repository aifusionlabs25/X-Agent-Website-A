import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    if (slug !== 'amy') return {};
    return {
        title: 'Meet Amy · Insight SDR demo',
        description: 'An independently built AI Fusion Labs demonstration. Explore a fictional client scenario; human review remains essential.',
        openGraph: {
            title: 'Meet Amy · Insight SDR demo',
            description: 'AI-powered discovery and working briefs. Demonstration only; human review remains essential.',
        },
    };
}

export default function DemoLayout({ children }: { children: ReactNode }) { return children; }
