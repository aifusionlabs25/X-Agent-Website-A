// lib/agents.ts — Single source of truth for all X Agent display data.
// Thumbnail paths match Nova's exact spec in /public/agents/thumbnails/

export interface AgentData {
  slug: string;
  name: string;
  role: string;
  personaId: string;
  thumbnailSrc: string;
  accentColor: string;
  liveUrl: string;
  tenant?: string; // Fictional tenant name for demo agents
  companyUrl?: string; // Target URL for follow-up
  logoSrc?: string; // Dynamic path for logo
}

export const ALL_AGENTS: AgentData[] = [
  {
    slug: "dani",
    name: "Dani",
    role: "X Agent Director",
    personaId: "61f0fd3e-7937-472a-958d-cdba76b33bf1",
    thumbnailSrc: "/agents/thumbnails/Dani landing page hero 1.png",
    accentColor: "#6366f1",
    liveUrl: "/demo/dani",
  },
  {
    slug: "taylor",
    name: "TAYLOR",
    role: "Generic SDR",
    personaId: "4183f1fe-9922-4ef5-ad47-9b1949dfdaa4",
    thumbnailSrc: "/agents/thumbnails/Taylor_Canyon_Ridge_thumb_512.png",
    accentColor: "#10b981",
    liveUrl: "/demo/taylor",
    tenant: "Canyon Ridge Solutions",
  },
  {
    slug: "michael",
    name: "MICHAEL",
    role: "Real Estate Intake Specialist",
    personaId: "99b55da2-6ddb-473a-bd6f-52e393fb914d",
    thumbnailSrc: "/agents/thumbnails/Michael.jpg",
    accentColor: "#0ea5e9",
    liveUrl: "/demo/michael",
    tenant: "Fulton Homes",
  },
  {
    slug: "sarah-netic",
    name: "SARAH",
    role: "Netic SDR",
    personaId: "344ec465-cf81-4488-82d4-4e91084af89c",
    thumbnailSrc: "/agents/thumbnails/Sarah Netic SDR.jpg",
    accentColor: "#f59e0b",
    liveUrl: "/demo/sarah-netic",
  },
  {
    slug: "james",
    name: "JAMES",
    role: "Legal Intake",
    personaId: "8a991c93-0c95-42c5-8c22-a67428946eb8",
    thumbnailSrc: "/agents/thumbnails/James Knowles Law Firm 1.jpg",
    accentColor: "#3b82f6",
    liveUrl: "/demo/james",
  },
  {
    slug: "morgan",
    name: "MORGAN",
    role: "GoDeskless Field Specialist",
    personaId: "6826181f-45e3-404c-8fb8-1f7ff395df54",
    thumbnailSrc: "/agents/thumbnails/Morgan GoDeskless FST.png",
    accentColor: "#10b981",
    liveUrl: "/demo/morgan",
  },
  {
    slug: "luke",
    name: "LUKE",
    role: "After Hours Vet Triage",
    personaId: "29a20fab-794f-42f3-b000-d8999ac45b55",
    thumbnailSrc: "/agents/thumbnails/luke-vet-triage.png",
    accentColor: "#8b5cf6",
    liveUrl: "/demo/luke",
  },
  {
    slug: "claire",
    name: "CLAIRE",
    role: "OpenTable Concierge",
    personaId: "d7560a16-dae5-4426-b338-9fbdc6412824",
    thumbnailSrc: "/agents/thumbnails/Claire Flemings OpenTable.jpg",
    accentColor: "#f43f5e",
    liveUrl: "/demo/claire",
  },
  {
    slug: "amy",
    name: "AMY",
    role: "Insight Enterprise SDR",
    personaId: "8c7d5b42-b17e-4321-8bfa-381c8d93820f",
    thumbnailSrc: "/agents/thumbnails/amy-insight-sdr-2026.png",
    accentColor: "#ec4899",
    liveUrl: "/demo/amy",
    tenant: "Insight Enterprises",
  },
  {
    slug: "evan",
    name: "EVAN",
    role: "Moving Concierge",
    personaId: "4b7e933a-ea04-4b84-b418-72c0762545e6",
    thumbnailSrc: "/agents/thumbnails/Evan Mullins Moving.png",
    accentColor: "#f97316",
    liveUrl: "/demo/evan",
    tenant: "Mullins Moving",
    companyUrl: "https://www.mullins-moving.com/",
    logoSrc: "/agents/thumbnails/Evan Mullins Moving logo.png",
  },
];

// Sales row
export const SALES_AGENTS: AgentData[] = [
  ALL_AGENTS.find((a) => a.slug === "taylor")!,
  ALL_AGENTS.find((a) => a.slug === "michael")!,
  ALL_AGENTS.find((a) => a.slug === "sarah-netic")!,
  ALL_AGENTS.find((a) => a.slug === "amy")!,
];

// Service row
export const SERVICE_AGENTS: AgentData[] = [
  ALL_AGENTS.find((a) => a.slug === "james")!,
  ALL_AGENTS.find((a) => a.slug === "morgan")!,
  ALL_AGENTS.find((a) => a.slug === "luke")!,
  ALL_AGENTS.find((a) => a.slug === "claire")!,
  ALL_AGENTS.find((a) => a.slug === "evan")!,
];
