import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('Dani entry gate uses the editorial studio system without changing access contracts', async () => {
    const gate = await read('../components/dani/DaniContactGate.tsx');

    assert.match(gate, /data-dani-surface="entry"/);
    assert.match(gate, /Bring the problem\. I&apos;ll help frame the path\./);
    assert.match(gate, /dani-x-agent-director-cara4-2026\.jpg/);
    assert.match(gate, /min-h-\[100svh\]/);
    assert.match(gate, /env\(safe-area-inset-bottom\)/);
    assert.match(gate, /Email my recap/);
    assert.match(gate, /Remember me across sessions/);
    assert.match(gate, /<fieldset aria-describedby="dani-email-purpose-help">/);
    assert.match(gate, /checked=\{followUpConsent\}/);
    assert.match(gate, /checked=\{memoryConsent\}/);
    assert.match(gate, /setEmailFollowUpAvailable\(followUpAvailable\)/);
    assert.match(gate, /recap consent is per conversation/i);
    assert.doesNotMatch(gate, /payload\.guest === true[\s\S]*setReady\(true\)/);
    assert.match(gate, /fetch\('\/api\/anam\/dani\/access'/);
    assert.match(gate, /\{ guest: true \}/);
    assert.match(gate, /\{ displayName, email, followUpConsent, memoryConsent \}/);
    assert.doesNotMatch(gate, /followUpConsent: true/);
    assert.match(gate, /!followUpConsent && !memoryConsent/);
    assert.match(gate, /<DaniMemoryControls \/>/);
    assert.match(gate, /\/api\/anam\/dani\/access\/verify/);
    assert.doesNotMatch(gate, /from-indigo|to-cyan|bg-indigo/);
});

test('Dani live session has route-scoped identity, safe controls, clean framing, and a true completion return', async () => {
    const [demo, player, completionRoute, header, footer] = await Promise.all([
        read('../app/demo/[slug]/page.tsx'),
        read('../components/AnamPlayer.tsx'),
        read('../app/api/anam/session/complete/route.ts'),
        read('../components/layout/SiteHeader.tsx'),
        read('../components/layout/SiteFooter.tsx'),
    ]);

    assert.match(demo, /data-dani-surface=\{isDani \? 'live-session'/);
    assert.match(demo, /AI Fusion Labs \/ Dani/);
    assert.match(demo, /Working session/);
    assert.match(demo, /End session/);
    assert.match(demo, /xagent:dani-request-end/);
    assert.match(player, /activeClient\.stopStreaming\(\)/);
    assert.match(player, /completeOnce\('user_requested_end'\)/);
    assert.match(player, /1_500/);
    assert.match(completionRoute, /'user_requested_end'/);
    assert.doesNotMatch(demo, /AI Solutions Director/);
    assert.doesNotMatch(demo, /Clarity, in conversation\./);
    assert.doesNotMatch(demo, /One focused question at a time\./);
    assert.match(player, /personaId === DANI_PERSONA_ID \? 'h-full w-full scale-\[\.97\]/);
    assert.match(player, /md:scale-\[\.94\]/);
    assert.match(player, /motion-reduce:transform-none/);
    assert.match(demo, /\/agents\/dani\?session=complete/);
    assert.match(demo, /env\(safe-area-inset-bottom\)/);
    assert.match(header, /pathname === '\/agents\/dani'/);
    assert.match(header, /pathname === '\/demo\/dani'/);
    assert.match(footer, /pathname === '\/agents\/dani'/);
    assert.match(footer, /pathname === '\/demo\/dani'/);
});

test('Dani agent route renders direct and post-session editorial states', async () => {
    const [route, landing, css] = await Promise.all([
        read('../app/agents/[slug]/page.tsx'),
        read('../components/dani/DaniEditorialLanding.tsx'),
        read('../components/dani/DaniEditorial.module.css'),
    ]);

    assert.match(route, /DaniEditorialLanding sessionComplete=\{rawSessionState === 'complete'\}/);
    assert.match(landing, /Good work\. You moved the idea forward\./);
    assert.match(landing, /Bring the problem\. Leave with a clearer path\./);
    assert.match(landing, /Sent only when requested/);
    assert.match(landing, /No CRM update or commercial commitment was made/);
    assert.match(landing, /data-dani-surface=\{sessionComplete \? 'post-session' : 'landing'\}/);
    assert.doesNotMatch(landing, /Dani \/ AI Fusion Labs/);
    assert.doesNotMatch(landing, /Clarity before complexity\./);
    assert.match(landing, /lg:grid-cols-\[minmax\(29rem,1\.02fr\)_minmax\(28rem,\.98fr\)\]/);
    assert.match(landing, /max-w-\[42rem\]/);
    assert.match(landing, /text-\[clamp\(3rem,4\.6vw,5\.25rem\)\]/);
    assert.doesNotMatch(landing, /6\.5rem|8\.5rem|max-w-\[50rem\]/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /\.entryPortraitImage/);
    assert.match(css, /@media \(min-width: 768px\) and \(max-height: 850px\)/);
    assert.match(css, /\.entryHeading/);
    assert.match(css, /\.entryAction/);
    assert.match(css, /\.landingPortraitImage/);
    assert.match(landing, /<DaniMemoryControls placement="inline" \/>/);
});

test('Dani recall controls are verified-only, content-free, and require explicit destructive confirmation', async () => {
    const [controls, css] = await Promise.all([
        read('../components/dani/DaniMemoryControls.tsx'),
        read('../components/dani/DaniEditorial.module.css'),
    ]);

    assert.match(controls, /fetch\('\/api\/anam\/dani\/memory'/);
    assert.match(controls, /payload\.memoryVerified !== true/);
    assert.match(controls, /method: 'DELETE'/);
    assert.match(controls, /Delete all Dani recall\?/);
    assert.match(controls, /Delete all and revoke/);
    assert.match(controls, /window\.location\.pathname === '\/demo\/dani'/);
    assert.match(controls, /window\.location\.assign\('\/agents\/dani\?memory=cleared'\)/);
    assert.match(controls, /Future sessions start without recall\./);
    assert.doesNotMatch(controls, /Dani starts fresh from here\./);
    assert.match(controls, /Note contents are intentionally not shown/);
    assert.doesNotMatch(controls, /approvedSummary\b|transcript\b/);
    assert.match(controls, /role="dialog"/);
    assert.match(controls, /aria-modal="true"/);
    assert.match(css, /\.memoryDock[\s\S]*top: max\(4\.75rem, calc\(env\(safe-area-inset-top\) \+ 4\.25rem\)\)/);
    assert.match(css, /\.memoryBackdrop[\s\S]*max\(5\.25rem/);
    assert.match(css, /@media \(max-height: 620px\)/);
});
