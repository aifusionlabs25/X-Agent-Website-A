import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => {
  try {
    return readFileSync(resolve(root, path), 'utf8');
  } catch {
    return '';
  }
};

const route = read('app/agents/[slug]/page.tsx');
const landing = read('components/agents/AmyInsightLanding.tsx');
const motion = read('components/agents/InsightMotionMark.tsx');
const styles = read('components/agents/AmyInsightLanding.module.css');
const thumbnail = read('components/home/AgentThumbnail.tsx');
const agents = read('lib/agents.ts');
const demo = read('app/demo/[slug]/page.tsx');
const player = read('components/AnamPlayer.tsx');
const amyConfig = agents.match(/slug:\s*['"]amy['"][\s\S]*?\n\s*\},/)?.[0] ?? '';

assert.match(
  thumbnail,
  /href=\{`\/agents\/\$\{agent\.slug\}`\}/,
  'selecting any agent card uses its canonical public detail route',
);
assert.match(
  amyConfig,
  /thumbnailSrc:\s*['"]\/agents\/thumbnails\/amy-insight-sdr-2026\.png['"]/,
  'Amy uses the production black-blazer roster portrait',
);
assert.match(
  amyConfig,
  /liveUrl:\s*['"]\/demo\/amy\?variant=cara4['"]/,
  'Amy retains the production Cara-4 conversation route without a machine-local audio bridge',
);

assert.match(
  route,
  /agent\.slug === ['"]amy['"][\s\S]*<AmyInsightLanding/,
  'Amy detail route delegates to the Insight-specific landing experience',
);
assert.match(route, /export async function generateMetadata/, 'Amy route provides page-specific metadata');
assert.match(route, /Amy · Senior SDR for Insight/, 'Amy metadata identifies the senior-SDR experience');
assert.match(landing, /Amy · Senior SDR for Insight/, 'landing names Amy as a senior Insight SDR');
assert.match(
  landing,
  /Bring your most important technology question into the room\./,
  'landing uses the approved editorial headline',
);
assert.match(landing, /Meet with Amy/, 'landing exposes the primary meeting CTA');
assert.match(
  landing,
  /<section className=\{styles\.hero\} aria-labelledby="amy-insight-heading">/,
  'hero section is named by its visible heading',
);
assert.match(
  landing,
  /<section className=\{styles\.process\} aria-labelledby="process-heading">/,
  'outcomes section is named by its visible heading',
);
assert.match(landing, /alt="Insight"/, 'Insight brand image has useful alternative text');
assert.match(
  landing,
  /alt="Amy, senior SDR for Insight"/,
  'Amy portrait has useful alternative text',
);
assert.match(
  landing,
  /const amyDemoHref = ALL_AGENTS\.find\(\(agent\) => agent\.slug === ['"]amy['"]\)\?\.liveUrl/,
  'landing resolves Amy CTA destinations through the shared agent configuration',
);
assert.equal(
  (landing.match(/href=\{amyDemoHref\}/g) ?? []).length,
  2,
  'both Amy landing CTAs launch the configured Anam experience',
);
assert.match(
  demo,
  /isAmyCara4Canary = agent\.slug === ['"]amy['"] && rawVariant === ['"]cara4['"][\s\S]*sessionVariant = isAmyCara4Canary \? AMY_CARA4_VARIANT/,
  'Amy demo resolves the production Cara-4 query to the server-owned session variant',
);
assert.match(
  demo,
  /<AnamPlayer[\s\S]*personaId=\{agent\.personaId\}[\s\S]*sessionVariant=\{sessionVariant\}[\s\S]*audioBridge=\{audioBridge\}/,
  'Amy demo supplies the configured persona, session variant, and audio bridge to AnamPlayer',
);
assert.match(
  player,
  /fetch\(['"]\/api\/anam-token['"][\s\S]*body:\s*JSON\.stringify\(\{ personaId, variant: sessionVariant \}\)/,
  'AnamPlayer asks the established token endpoint to resolve the server-owned Amy variant',
);
assert.match(landing, /Insight specialist/, 'landing explains the specialist handoff');
assert.match(
  landing,
  /styles\.copyMotion[\s\S]*<InsightMotionMark/,
  'recovered motion mark sits behind the headline copy',
);
assert.doesNotMatch(landing, /Prepared to discuss/i, 'portrait no longer carries the clashing overlay card');
assert.doesNotMatch(landing, /Private prototype/i, 'repetitive prototype label is removed');
assert.match(landing, /amy-insight-sdr-hero-polished\.webp/, 'landing uses the polished black-blazer portrait');
assert.ok(
  existsSync(resolve(root, 'public/agents/amy-insight-sdr-hero-polished.webp')),
  'polished portrait asset exists',
);
assert.ok(
  existsSync(resolve(root, 'public/agents/thumbnails/amy-insight-sdr-2026.png')),
  'production black-blazer roster portrait exists',
);
assert.match(
  landing,
  /Bring the initiative\. Leave with a clearer path forward\./,
  'lower section sells the outcome of the conversation',
);
assert.match(motion, /data-insight-motion/, 'motion mark exposes a stable QA selector');
assert.match(motion, /viewBox="0 0 400 400"/, 'motion mark preserves the recovered SVG geometry');
assert.match(motion, /aria-hidden="true"/, 'decorative motion is hidden from assistive technology');
assert.match(styles, /animation:[^;]*153s[^;]*linear[^;]*infinite/, 'motion preserves the recovered 153-second rotation');
assert.match(styles, /prefers-reduced-motion:\s*reduce/, 'motion respects reduced-motion preferences');
assert.match(styles, /\.primaryAction:focus-visible/, 'primary CTA has a visible keyboard focus style');
assert.match(styles, /@media \(max-width: 800px\)/, 'landing defines its tablet/mobile layout breakpoint');
assert.match(styles, /@media \(max-width: 520px\)/, 'landing defines its small-phone layout breakpoint');
assert.match(
  styles,
  /@media \(max-width: 800px\)[\s\S]*?\.stageGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  'outcome cards stack into one column on mobile',
);
assert.match(
  styles,
  /body:has\(#amy-insight-landing\)[^}]*header[^}]*display:\s*none/,
  'generic global navigation is hidden only on Amy landing',
);
assert.match(
  styles,
  /body:has\(#amy-insight-landing\)[^}]*footer[^}]*display:\s*none/,
  'generic global footer links are hidden only on Amy landing',
);
const portraitFrame = styles.match(/\.portraitFrame\s*\{([^}]*)\}/)?.[1] ?? '';
assert.doesNotMatch(styles, /\.visual::before\s*\{/, 'no leftover logo-like shape remains behind Amy');
assert.match(
  portraitFrame,
  /border:\s*1px\s+solid/,
  'portrait uses a refined one-pixel border rather than the old heavy frame',
);
assert.doesNotMatch(portraitFrame, /border-(?:top|right):/, 'old asymmetric magenta frame stays removed');
assert.match(portraitFrame, /box-shadow:[^;]*rgb/, 'portrait uses a layered branded shadow');
assert.doesNotMatch(styles, /background:\s*#211b1d/, 'lower section no longer uses the graveyard treatment');

console.log('Amy Insight landing regression: PASS');
