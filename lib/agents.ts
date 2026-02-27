// lib/agents.ts — Single source of truth for all X Agent display data.
// Thumbnail paths match Nova's exact spec in /public/agents/thumbnails/

import { AgentData } from '@/components/home/AgentThumbnail';

export const ALL_AGENTS: AgentData[] = [
    {
        slug: 'dani',
        name: 'Dani',
        role: 'X Agent Director',
        personaId: '61f0fd3e-7937-472a-958d-cdba76b33bf1',
        thumbnailSrc: '/agents/thumbnails/Dani landing page hero 1.png',
        accentColor: '#6366f1',
        liveUrl: '/demo/dani',
    },
    {
        slug: 'amy',
        name: 'AMY',
        role: 'Insight SDR',
        personaId: '8c7d5b42-b17e-4321-8bfa-381c8d93820f',
        thumbnailSrc: '/agents/thumbnails/Amy Insight SDR.jpg',
        accentColor: '#ec4899',
        liveUrl: '/demo/amy',
    },
    {
        slug: 'sarah-netic',
        name: 'SARAH',
        role: 'Netic SDR',
        personaId: '344ec465-cf81-4488-82d4-4e91084af89c',
        thumbnailSrc: '/agents/thumbnails/Sarah Netic SDR.jpg',
        accentColor: '#f59e0b',
        liveUrl: '/demo/sarah-netic',
    },
    {
        slug: 'james',
        name: 'JAMES',
        role: 'Legal Intake',
        personaId: '8a991c93-0c95-42c5-8c22-a67428946eb8',
        thumbnailSrc: '/agents/thumbnails/James Knowles Law Firm 1.jpg',
        accentColor: '#3b82f6',
        liveUrl: '/demo/james',
    },
    {
        slug: 'morgan',
        name: 'MORGAN',
        role: 'GoDeskless Field Specialist',
        personaId: '6826181f-45e3-404c-8fb8-1f7ff395df54',
        thumbnailSrc: '/agents/thumbnails/Morgan GoDeskless FST.png',
        accentColor: '#10b981',
        liveUrl: '/demo/morgan',
    },
    {
        slug: 'luke',
        name: 'LUKE',
        role: 'After Hours Vet Triage',
        personaId: '29a20fab-794f-42f3-b000-d8999ac45b55',
        thumbnailSrc: '/agents/thumbnails/luke-vet-triage.png',
        accentColor: '#8b5cf6',
        liveUrl: '/demo/luke',
    },
    {
        slug: 'claire',
        name: 'CLAIRE',
        role: 'OpenTable Concierge',
        personaId: 'd7560a16-dae5-4426-b338-9fbdc6412824',
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
