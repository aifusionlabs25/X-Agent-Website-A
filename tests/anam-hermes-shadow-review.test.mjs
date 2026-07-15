import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
    AMY_ANAM_HERMES_SHADOW_OUTPUT_VERSION,
    hashAmyAnamHermesShadowOutput,
    parseAmyAnamHermesShadowOutput,
} from '../lib/anam/hermes-shadow.ts';
import {
    AMY_ANAM_HERMES_LOCAL_REVIEW_VERSION,
    AMY_ANAM_HERMES_LOCAL_REVIEW_RETENTION_MS,
    readAmyAnamHermesLocalReviews,
    renderAmyAnamHermesLocalReviews,
    sanitizeAmyAnamHermesReviewText,
} from '../scripts/hermes/amy-anam-shadow-review.mjs';

function validOutput(overrides = {}) {
    return {
        schema_version: AMY_ANAM_HERMES_SHADOW_OUTPUT_VERSION,
        summary: 'The visitor asked for an analysis-only recap.',
        inquiry_type: 'product discovery',
        recommended_next_steps: ['Have a person review the factual recap.'],
        needs_human_review: false,
        quality_review: {
            repeated_question_risk: false,
            unsupported_claim_risk: false,
            pricing_or_inventory_claim_risk: false,
            technical_term_risk: true,
            privacy_risk: false,
        },
        safety: {
            shadow_only: true,
            tools_called: 0,
            emails_sent: 0,
            memory_writes: 0,
            outbound_actions: 0,
        },
        ...overrides,
    };
}

async function withOutputDirectory(t) {
    const outputDir = resolve(tmpdir(), `amy-anam-review-test-${randomUUID()}`);
    await mkdir(outputDir, { recursive: true });
    t.after(() => rm(outputDir, { recursive: true, force: true }));
    return outputDir;
}

async function writeOutput(outputDir, output, jobCharacter, modifiedAt) {
    const validatedOutput = parseAmyAnamHermesShadowOutput(JSON.stringify(output));
    const outputSha256 = hashAmyAnamHermesShadowOutput(validatedOutput);
    const outputPath = resolve(
        outputDir,
        `${jobCharacter.repeat(64)}.${outputSha256}.json`,
    );
    await writeFile(outputPath, `${JSON.stringify(validatedOutput, null, 2)}\n`, 'utf8');
    if (modifiedAt) await utimes(outputPath, modifiedAt, modifiedAt);
    return { outputPath, outputSha256 };
}

test('local review version is explicit and the viewer source has no action-capable imports', async () => {
    assert.equal(AMY_ANAM_HERMES_LOCAL_REVIEW_VERSION, 'amy_anam_hermes_local_review_v1');
    assert.equal(AMY_ANAM_HERMES_LOCAL_REVIEW_RETENTION_MS, 24 * 60 * 60 * 1000);
    const source = await readFile(
        new URL('../scripts/hermes/amy-anam-shadow-review.mjs', import.meta.url),
        'utf8',
    );

    assert.doesNotMatch(source, /node:(?:http|https|child_process)/);
    assert.doesNotMatch(source, /\b(?:fetch|writeFile|appendFile|unlink|rename|spawn)\s*\(/);
    assert.doesNotMatch(source, /process\.env/);
    assert.doesNotMatch(source, /ANAM_API_KEY|REDIS|AGENTMAIL|RESEND|WORKER_SECRET/);
    assert.doesNotMatch(source, /error\.message/);
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]).sort();
    assert.deepEqual(imports, [
        '../../lib/anam/hermes-shadow.ts',
        'node:fs/promises',
        'node:os',
        'node:path',
        'node:url',
    ]);
});

test('the viewer validates, sanitizes, and renders content without identifiers or authority', async (t) => {
    const outputDir = await withOutputDirectory(t);
    const hash = 'f'.repeat(64);
    const uuid = '11111111-2222-4333-8444-555555555555';
    const output = validOutput({
        summary: `\u001b]8;;https://unsafe.example\u0007A local summary\u001b]8;;\u0007 with\ncontrol text. ${hash} ${uuid} pat@example.com 602-555-0123 C:\\private\\amy.json`,
        inquiry_type: '\u001b[31mtechnical discovery\u001b[0m',
        recommended_next_steps: [
            'Review\u202E session: anam_session_12345678 with token: sk_abcdefghijklmnop.',
            'Inspect /tmp/private output/output.json only on this computer.',
        ],
    });
    const { outputPath, outputSha256 } = await writeOutput(outputDir, output, 'a');

    const reviews = await readAmyAnamHermesLocalReviews({ outputDir, all: true });
    assert.equal(reviews.length, 1);
    const rendered = renderAmyAnamHermesLocalReviews(reviews);

    assert.match(rendered, /ANALYSIS ONLY - NO AUTHORITY/);
    assert.match(rendered, /cannot approve, apply, send, store, or trigger anything/);
    assert.match(rendered, /Summary: A local summary with control text\./);
    assert.match(rendered, /Inquiry type: technical discovery/);
    assert.match(rendered, /tools 0; emails 0; memory writes 0; outbound actions 0/);
    assert.match(rendered, /\[hash redacted\]/);
    assert.match(rendered, /\[identifier redacted\]/);
    assert.match(rendered, /\[email redacted\]/);
    assert.match(rendered, /\[phone redacted\]/);
    assert.match(rendered, /\[path redacted\]/);
    assert.match(rendered, /\[secret redacted\]/);
    assert.doesNotMatch(rendered, /\u001b|\u0007|\u202E/);
    assert.doesNotMatch(rendered, new RegExp(hash));
    assert.doesNotMatch(rendered, new RegExp(uuid));
    assert.doesNotMatch(rendered, /pat@example\.com|602-555-0123|anam_session_12345678|sk_abcdefghijklmnop/);
    assert.doesNotMatch(rendered, new RegExp(outputSha256));
    assert.doesNotMatch(rendered, new RegExp('a'.repeat(64)));
    assert.doesNotMatch(rendered, new RegExp(outputPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(
        sanitizeAmyAnamHermesReviewText('Open C:\\Users\\AI Fusion Labs\\AppData\\Local\\Temp\\secret.json after review.'),
        'Open [path redacted]',
    );
    assert.equal(
        sanitizeAmyAnamHermesReviewText('Open \\\\server\\private share\\secret.json after review.'),
        'Open [path redacted]',
    );
    assert.equal(
        sanitizeAmyAnamHermesReviewText('Open file:///C:/Users/AI%20Fusion%20Labs/secret.json after review.'),
        'Open [path redacted]',
    );
    assert.equal(
        sanitizeAmyAnamHermesReviewText('Open /home/AI Fusion Labs/private/secret.json after review.'),
        'Open [path redacted]',
    );
});

test('latest is the default while all returns valid outputs in newest-first order', async (t) => {
    const outputDir = await withOutputDirectory(t);
    const now = Date.now();
    const older = validOutput({ summary: 'Older local review.' });
    const newer = validOutput({ summary: 'Newer local review.' });
    await writeOutput(outputDir, older, 'b', new Date(now - 2 * 60 * 1000));
    await writeOutput(outputDir, newer, 'c', new Date(now - 60 * 1000));
    await writeFile(resolve(outputDir, 'not-a-shadow-output.txt'), 'ignored', 'utf8');

    const latest = await readAmyAnamHermesLocalReviews({ outputDir, now });
    assert.equal(latest.length, 1);
    assert.equal(latest[0].output.summary, 'Newer local review.');

    const all = await readAmyAnamHermesLocalReviews({ outputDir, all: true, now });
    assert.deepEqual(all.map(review => review.output.summary), [
        'Newer local review.',
        'Older local review.',
    ]);
});

test('the viewer fails closed on content tampering and unsafe directories', async (t) => {
    const outputDir = await withOutputDirectory(t);
    const output = validOutput();
    const { outputPath } = await writeOutput(outputDir, output, 'd');
    await writeFile(outputPath, `${JSON.stringify({ ...output, summary: 'Tampered.' }, null, 2)}\n`, 'utf8');

    await assert.rejects(
        readAmyAnamHermesLocalReviews({ outputDir, all: true }),
        error => {
            assert.match(error.message, /content hash check/);
            assert.doesNotMatch(error.message, /[a-f0-9]{64}|amy-anam-review-test|\\|\//);
            return true;
        },
    );
    await assert.rejects(
        readAmyAnamHermesLocalReviews({ outputDir: resolve('.') }),
        /operating-system temp directory/,
    );
});

test('expired and future-dated outputs cannot become the latest local review', async (t) => {
    const outputDir = await withOutputDirectory(t);
    const now = Date.now();
    const expired = await writeOutput(
        outputDir,
        validOutput({ summary: 'Expired local review.' }),
        'e',
        new Date(now - AMY_ANAM_HERMES_LOCAL_REVIEW_RETENTION_MS - 1),
    );

    assert.deepEqual(await readAmyAnamHermesLocalReviews({ outputDir, all: true, now }), []);

    await rm(expired.outputPath);
    await writeOutput(
        outputDir,
        validOutput({ summary: 'Future local review.' }),
        'f',
        new Date(now + 10 * 60 * 1000),
    );
    await assert.rejects(
        readAmyAnamHermesLocalReviews({ outputDir, all: true, now }),
        /future-dated local output/,
    );
});

test('hard-linked shadow outputs are rejected before content is read', async (t) => {
    const outputDir = await withOutputDirectory(t);
    const { outputPath } = await writeOutput(outputDir, validOutput(), '9');
    await link(outputPath, resolve(outputDir, 'untrusted-hard-link.json'));

    await assert.rejects(
        readAmyAnamHermesLocalReviews({ outputDir, all: true }),
        /one regular local file/,
    );
});

test('an empty local output directory renders a useful read-only state', async (t) => {
    const outputDir = await withOutputDirectory(t);
    const reviews = await readAmyAnamHermesLocalReviews({ outputDir });
    const rendered = renderAmyAnamHermesLocalReviews(reviews);

    assert.match(rendered, /ANALYSIS ONLY - NO AUTHORITY/);
    assert.match(rendered, /No local Hermes shadow outputs are available/);
    assert.equal(sanitizeAmyAnamHermesReviewText('hello\nworld'), 'hello world');
});
