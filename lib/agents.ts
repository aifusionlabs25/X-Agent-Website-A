// lib/agents.ts — Single source of truth for all X Agent display data.
// Thumbnail paths match Nova's exact spec in /public/agents/thumbnails/

import { AgentData } from '@/components/home/AgentThumbnail';

export const ALL_AGENTS: AgentData[] = [
    {
        slug: 'dani',
        name: 'Dani',
        role: 'X Agent Director',
        personaId: '972e0055-4a8a-4ba5-8b77-39bc0dfb6a1c',
        thumbnailSrc: '/agents/thumbnails/Dani landing page hero 1.png',
        accentColor: '#6366f1',
        liveUrl: '/demo/dani',
    },
    {
        slug: 'amy',
        name: 'AMY',
        role: 'Insight SDR',
        personaId: '27e12daa-50fc-4384-93c2-ebca73f1f78d',
        thumbnailSrc: '/agents/thumbnails/Amy Insight SDR.jpg',
        accentColor: '#ec4899',
        liveUrl: '/demo/amy',
    },
    {
        slug: 'sarah-netic',
        name: 'SARAH',
        role: 'Netic SDR',
        personaId: 'edf6fdcb-acab-44b8-b974-ded72665ee26',
        thumbnailSrc: '/agents/thumbnails/Sarah Netic SDR.jpg',
        accentColor: '#f59e0b',
        liveUrl: '/demo/sarah-netic',
    },
    {
        slug: 'james',
        name: 'JAMES',
        role: 'Legal Intake',
        personaId: '81b70170-2e80-4e4b-a6fb-e04ac110dc4b',
        thumbnailSrc: '/agents/thumbnails/James Knowles Law Firm 1.jpg',
        accentColor: '#3b82f6',
        liveUrl: '/demo/james',
    },
    {
        slug: 'morgan',
        name: 'MORGAN',
        role: 'GoDeskless Field Specialist',
        personaId: '6dbc1e47-7768-403e-878a-94d7fcc3677b',
        thumbnailSrc: '/agents/thumbnails/Morgan GoDeskless FST.png',
        accentColor: '#10b981',
        liveUrl: '/demo/morgan',
    },
    {
        slug: 'luke',
        name: 'LUKE',
        role: 'After Hours Vet Triage',
        personaId: '8a339c9f-0666-46bd-ab27-e90acd0409dc',
        thumbnailSrc: '/agents/thumbnails/luke-vet-triage.png',
        accentColor: '#8b5cf6',
        liveUrl: '/demo/luke',
    },
    {
        slug: 'claire',
        name: 'CLAIRE',
        role: 'OpenTable Concierge',
        personaId: '071b0286-4cce-4808-bee2-e642f1062de3',
        thumbnailSrc: '/agents/thumbnails/Claire Flemings OpenTable.jpg',
        accentColor: '#f43f5e',
        liveUrl: '/demo/claire',
    },
];

// Sales row
export const SALES_AGENTS: AgentData[] = [
    ALL_AGENTS.find(a => a.slug === 'dani')!,
    ALL_AGENTS.find(a => a.slug === 'amy')!,
    ALL_AGENTS.find(a => a.slug === 'sarah-netic')!,
];

// Service row
export const SERVICE_AGENTS: AgentData[] = [
    ALL_AGENTS.find(a => a.slug === 'james')!,
    ALL_AGENTS.find(a => a.slug === 'morgan')!,
    ALL_AGENTS.find(a => a.slug === 'luke')!,
    ALL_AGENTS.find(a => a.slug === 'claire')!,
];
