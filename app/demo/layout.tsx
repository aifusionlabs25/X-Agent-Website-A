import type { Metadata } from 'next';

export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
        nocache: true,
        googleBot: {
            index: false,
            follow: false,
            noimageindex: true,
            'max-snippet': 0,
            'max-image-preview': 'none',
            'max-video-preview': 0,
        },
    },
};

export default function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return children;
}
