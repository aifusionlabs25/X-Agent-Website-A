import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import SiteHeader from '@/components/layout/SiteHeader';
import SiteFooter from '@/components/layout/SiteFooter';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://xagent.aifusionlabs.app'),
  title: {
    default: 'X Agents | AI Fusion Labs',
    template: '%s | AI Fusion Labs',
  },
  description: 'Interactive AI agent demos for sales, intake, service, and operations workflows.',
  applicationName: 'X Agents by AI Fusion Labs',
  openGraph: {
    title: 'X Agents | AI Fusion Labs',
    description: 'Interactive AI agent demos for sales, intake, service, and operations workflows.',
    siteName: 'AI Fusion Labs',
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'X Agents by AI Fusion Labs',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'X Agents | AI Fusion Labs',
    description: 'Interactive AI agent demos for sales, intake, service, and operations workflows.',
    images: ['/opengraph-image'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${inter.className} bg-zinc-950 text-white antialiased`}>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
