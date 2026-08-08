import type { MetadataRoute } from 'next';
import { ALL_AGENTS } from '@/lib/agents';

const SITE_URL = 'https://xagent.aifusionlabs.app';

export default function sitemap(): MetadataRoute.Sitemap {
    return [
        {
            url: SITE_URL,
            changeFrequency: 'weekly',
            priority: 1,
        },
        ...ALL_AGENTS.map((agent) => ({
            url: `${SITE_URL}/agents/${agent.slug}`,
            changeFrequency: 'monthly' as const,
            priority: 0.8,
        })),
    ];
}
