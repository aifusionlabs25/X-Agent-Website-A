import HeroBillboard from '@/components/home/HeroBillboard';
import AgentCarouselRow from '@/components/home/AgentCarouselRow';
import TechSpecsSection from '@/components/home/TechSpecsSection';
import HowItWorksSection from '@/components/home/HowItWorksSection';
import PricingSection from '@/components/home/PricingSection';
import TestimonialsSection from '@/components/home/TestimonialsSection';
import FAQSection from '@/components/home/FAQSection';
import BetaSignupSection from '@/components/home/BetaSignupSection';
import { ALL_AGENTS, SALES_AGENTS, SERVICE_AGENTS } from '@/lib/agents';

export default function HomePage() {
  const hideAmy = process.env.NEXT_PUBLIC_HIDE_AMY === 'true';

  const filterAgents = (agents: any[]) => hideAmy ? agents.filter(a => a.slug !== 'amy') : agents;

  const displaySales = filterAgents(SALES_AGENTS);
  const displayService = filterAgents(SERVICE_AGENTS);
  const displayAll = filterAgents(ALL_AGENTS);

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

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 pb-12">
            <p className="text-zinc-600 text-[10px] leading-relaxed max-w-2xl italic">
                * Taylor and other "Generic" designated agents represent fictional demo scenarios for Canyon Ridge Solutions. These experiences are built to demonstrate cross-industry automation capabilities and do not represent actual client affiliations.
            </p>
        </div>
      </div>


      {/* How It Works */}
      <HowItWorksSection />

      {/* Pricing */}
      <PricingSection />

      {/* Testimonials */}
      <TestimonialsSection />

      {/* FAQ */}
      <FAQSection />

      {/* Beta Sign-Up */}
      <BetaSignupSection />
    </main>
  );
}
