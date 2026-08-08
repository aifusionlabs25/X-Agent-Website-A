import type { Metadata } from 'next';
import HeroBillboard from '@/components/home/HeroBillboard';
import AgentCarouselRow from '@/components/home/AgentCarouselRow';
import TechSpecsSection from '@/components/home/TechSpecsSection';
import HowItWorksSection from '@/components/home/HowItWorksSection';
import FAQSection from '@/components/home/FAQSection';
import BetaSignupSection from '@/components/home/BetaSignupSection';
import {
  ALL_AGENTS,
  EXTERNAL_AGENTS,
  SALES_AGENTS,
  SERVICE_AGENTS,
  type AgentCardData,
  type AgentData,
} from '@/lib/agents';

export const metadata: Metadata = {
  title: { absolute: 'X Agents | AI Fusion Labs' },
  alternates: { canonical: '/' },
  openGraph: {
    title: 'X Agents | AI Fusion Labs',
    description: 'Interactive AI agent demos for sales, intake, service, and operations workflows.',
    url: '/',
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
};

export default function HomePage() {
  const hideAmy = process.env.NEXT_PUBLIC_HIDE_AMY === 'true';

  const filterAgents = (agents: AgentData[]) => hideAmy ? agents.filter(a => a.slug !== 'amy') : agents;

  const displaySales = filterAgents(SALES_AGENTS);
  const displayService = filterAgents(SERVICE_AGENTS);
  const displayAll: AgentCardData[] = [
    ...filterAgents(ALL_AGENTS),
    ...EXTERNAL_AGENTS,
  ];

  return (
    <main className="min-h-screen bg-zinc-950">
      {/* Hero Billboard */}
      <HeroBillboard />

      {/* Technology / Specs */}
      <TechSpecsSection />

      {/* Agent Carousels */}
      <div id="agents" className="pt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-4">
          <p className="text-zinc-500 text-xs uppercase tracking-widest bg-zinc-900/50 inline-block px-3 py-1 rounded-full border border-zinc-800">
            Enterprise Demo Showcase • Built by AI Fusion Labs
          </p>
        </div>
        
        <AgentCarouselRow title="Top Picks — Sales & SDR" agents={displaySales} />
        <AgentCarouselRow title="Operations & Service Agents" agents={displayService} />
        <AgentCarouselRow title="Full Agent Roster" agents={displayAll} />

        <div className="pb-12" />
      </div>


      {/* How It Works */}
      <HowItWorksSection />

      {/* FAQ */}
      <FAQSection />

      {/* Beta Sign-Up */}
      <BetaSignupSection />
    </main>
  );
}
