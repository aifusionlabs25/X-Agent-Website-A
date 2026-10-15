import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import './ai-transparency.css';
import SiteHeader from '@/components/layout/SiteHeader';
import SiteFooter from '@/components/layout/SiteFooter';
import AITransparencyNotice from '@/components/layout/AITransparencyNotice';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'X Agents by AI Fusion Labs — Autonomous AI for SMB Automation',
  description: 'X Agents: Lifelike AI for sales/ops automation. Beta pilots for SMBs—join now.',
  openGraph: {
    title: 'X Agents by AI Fusion Labs — Autonomous AI for SMB Automation',
    description: 'Explore lifelike AI agents for sales and operations, with real-time voice, video, and business-tool integrations.',
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
        <AITransparencyNotice />
      </body>
    </html>
  );
}
