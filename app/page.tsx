import HeroBillboard from '@/components/home/HeroBillboard';
import AgentCarouselRow from '@/components/home/AgentCarouselRow';
import TechSpecsSection from '@/components/home/TechSpecsSection';
import { ALL_AGENTS, SALES_AGENTS, SERVICE_AGENTS } from '@/lib/agents';
export default function HomePage() {
  return (
    <main className="min-h-screen bg-zinc-950">
      {/* Phase 3: Hero Billboard */}
      <HeroBillboard />

      {/* Phase 5: Technology / Specs immediately below Hero */}
      <TechSpecsSection />

      {/* Phase 4: Agent Carousels */}
      <div id="agents" className="pt-8">
        <AgentCarouselRow title="Top Picks — Sales & SDR" agents={SALES_AGENTS} />
        <AgentCarouselRow title="Operations & Service Agents" agents={SERVICE_AGENTS} />
        <AgentCarouselRow title="Full Agent Roster" agents={ALL_AGENTS} />
      </div>
    </main>
  );
}
