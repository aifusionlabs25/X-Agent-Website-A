import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { ALL_AGENTS, EXTERNAL_AGENTS } from '../lib/agents.ts';
import { parseBetaSignup } from '../lib/beta-signup.ts';

const EXPECTED_SHARED_AGENTS = [
    'amy',
    'claire',
    'dani',
    'evan',
    'james',
    'michael',
    'morgan',
    'sarah-netic',
];

test('the shared public registry contains only the eight active shared agents', () => {
    assert.deepEqual(
        ALL_AGENTS.map((agent) => agent.slug).sort(),
        EXPECTED_SHARED_AGENTS,
    );
    assert.equal(ALL_AGENTS.some((agent) => agent.slug === 'taylor'), false);
    assert.equal(ALL_AGENTS.some((agent) => agent.slug === 'luke'), false);
});

test('Claire uses a generic public role without restaurant-platform affiliation', () => {
    const claire = ALL_AGENTS.find((agent) => agent.slug === 'claire');

    assert.equal(claire?.role, 'Restaurant Reservation Specialist');
    assert.doesNotMatch(claire?.role ?? '', /OpenTable|Fleming/i);
});

test('Jordan remains a standalone external deployment', async () => {
    assert.equal(EXTERNAL_AGENTS.length, 1);
    assert.deepEqual(EXTERNAL_AGENTS[0], {
        slug: 'jordan',
        name: 'JORDAN',
        role: 'Enterprise Technology Strategist',
        thumbnailSrc: '/agents/thumbnails/jordan-harborlane.jpg',
        accentColor: '#2dd4bf',
        externalUrl: 'https://jordan-harborlane-cara4-robs-projects-e72bad73.vercel.app',
    });
    assert.equal('personaId' in EXTERNAL_AGENTS[0], false);

    const portrait = await fs.stat(
        new URL('../public/agents/thumbnails/jordan-harborlane.jpg', import.meta.url),
    );
    assert.equal(portrait.isFile(), true);
    assert.equal(portrait.size, 105_794);
});

test('active site navigation has no dead placeholder or pricing links', async () => {
    const [header, footer, homepage] = await Promise.all([
        fs.readFile(new URL('../components/layout/SiteHeader.tsx', import.meta.url), 'utf8'),
        fs.readFile(new URL('../components/layout/SiteFooter.tsx', import.meta.url), 'utf8'),
        fs.readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    ]);

    for (const source of [header, footer]) {
        assert.doesNotMatch(source, /href=["']#["']/);
        assert.doesNotMatch(source, /href=["']#(?:agents|specs|how-it-works|faq|beta-signup)["']/);
    }

    assert.doesNotMatch(footer, /#pricing|Privacy Policy/);
    assert.doesNotMatch(homepage, /TestimonialsSection|Taylor|Canyon Ridge/);
});

test('beta signup validation is bounded and rejects header or markup injection', () => {
    assert.deepEqual(
        parseBetaSignup({
            name: '  Ada Lovelace  ',
            email: 'ada@example.com',
            company: 'Analytical Engines',
            useCase: 'CRM Automation',
        }),
        {
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            company: 'Analytical Engines',
            useCase: 'CRM Automation',
        },
    );

    assert.equal(parseBetaSignup(null), null);
    assert.equal(parseBetaSignup({ name: '<b>Ada</b>', email: 'ada@example.com\r\nBcc:bad@example.com', company: 'A', useCase: 'Other' }), null);
    assert.equal(parseBetaSignup({ name: 'Ada', email: 'ada@example.com', company: 'A', useCase: 'Invented option' }), null);
    assert.equal(parseBetaSignup({ name: 'A'.repeat(121), email: 'ada@example.com', company: 'A', useCase: 'Other' }), null);
});
