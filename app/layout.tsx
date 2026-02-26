import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import SiteHeader from '@/components/layout/SiteHeader';
import SiteFooter from '@/components/layout/SiteFooter';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AI Fusion Labs – X Agents',
  description: 'Lifelike voice and video AI agents for sales, support, and operations. Meet the X Agents.',
  openGraph: {
    title: 'AI Fusion Labs – X Agents',
    description: 'Lifelike voice and video AI agents for any role.',
    siteName: 'AI Fusion Labs',
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
